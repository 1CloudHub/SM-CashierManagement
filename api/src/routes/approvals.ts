/**
 * Approval workflow — `/approvals` (task 12; Req 9.1–9.7; SCR-033; P7, P10,
 * P12).
 *
 * Each route in `APPROVAL_ROUTES` declares its one task 8.1 guard on the RBAC
 * matrix approval rows:
 *  - `approval_plan: view` (Executive, HR, Finance) — the queue and a
 *    scenario's tracker;
 *  - `approval_headcount: approve` (HR), `approval_budget: approve`
 *    (Finance), `approval_plan: approve` (Executive) — the step decisions;
 *  - `approval_offsystem: edit` (Executive) — recording headcount or budget
 *    as secured outside the system.
 * Scenarios are network objects, so no route has a scope target; the stores
 * inside the results preview are filtered to the active role's scope and
 * every ₱ figure is a `costFigure` shaped by the router (task 21).
 *
 * Handlers re-check each action against the shared workflow model, and the
 * database enforces the same rules (approver role, required comment,
 * sequencing, final decisions, pause on stale).
 */
import {
  APPROVAL_COMMENT_MAX,
  APPROVAL_REFERENCE_MAX,
  APPROVAL_STEP_KINDS,
  OUTSIDE_STEPS,
  STEP_DECISIONS,
  approvalActionsFor,
  awaitsRole,
  compareScenarioResults,
  decisionNeedsComment,
  isPlanReady,
  shapeCost,
  type ApprovalQueueItem,
  type ApprovalStepKind,
  type ScenarioRunResults,
} from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize, type RouteGuard } from '../auth/guards.js';
import { requirePrincipal, type Principal, type RequestContext } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction, type AuditedTx } from '../db/audit.js';
import * as approvals from '../db/repositories/approvals.js';
import * as planning from '../db/repositories/scenario-planning.js';
import { ScenarioStateError } from '../db/repositories/scenarios.js';
import { PG_ERRORS, pgErrorCode } from '../db/rows.js';
import { costViewer } from '../http/cost.js';
import { ApiError, errors } from '../http/errors.js';
import type { HttpMethod, Router } from '../http/router.js';
import type { ApiResponse, RoutedRequest } from '../http/types.js';
import { parseInput } from '../http/validation.js';
import { listItem, resultsFor } from './scenarios.js';

export interface ApprovalRouteDeps {
  /** The database pool; throws a 503 `ApiError` when none is configured. */
  readonly db: () => pg.Pool;
}

interface HandlerArgs {
  readonly request: RoutedRequest;
  readonly context: RequestContext;
  readonly principal: Principal;
  readonly pool: pg.Pool;
}

export interface ApprovalRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly guard: RouteGuard;
  readonly handler: (args: HandlerArgs) => Promise<ApiResponse>;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const nonBlank = (max: number, message: string) =>
  z
    .string()
    .max(max)
    .refine((s) => s.trim().length > 0, { message });

const submissionNo = z.number().int().positive().optional();

function decisionBody(step: ApprovalStepKind) {
  return z
    .object({
      decision: z.enum(STEP_DECISIONS[step] as [string, ...string[]]),
      comment: z.string().max(APPROVAL_COMMENT_MAX).optional(),
      submissionNo,
    })
    .strict()
    .superRefine((body, ctx) => {
      if (decisionNeedsComment(body.decision as never) && (body.comment ?? '').trim().length === 0) {
        ctx.addIssue({ code: 'custom', path: ['comment'], message: 'A comment is required to request changes or reject.' });
      }
    });
}

const outsideBody = z
  .object({
    step: z.enum(OUTSIDE_STEPS),
    reference: nonBlank(APPROVAL_REFERENCE_MAX, 'A reference is required, e.g. the email subject and date.'),
    note: nonBlank(APPROVAL_COMMENT_MAX, 'A note is required.'),
    submissionNo,
  })
  .strict();

const listQuery = z.object({ state: z.enum(['pending', 'all']).optional() }).passthrough();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idParam(request: RoutedRequest): string {
  const id = request.params.scenarioId ?? '';
  if (!UUID.test(id)) throw errors.notFound();
  return id;
}

/** Runs one audited approval action; maps workflow and constraint refusals to 403/404/409. */
async function mutate(pool: pg.Pool, principal: Principal, context: RequestContext, fn: (tx: AuditedTx) => Promise<unknown>): Promise<void> {
  try {
    await withAuditedTransaction(pool, actorFromPrincipal(principal, context.requestId), fn);
  } catch (error) {
    if (error instanceof approvals.ApprovalBlockedError) {
      if (error.blocker === 'not_permitted') throw errors.forbidden();
      throw new ApiError('conflict', error.message, { details: [{ path: 'blocker', message: error.blocker }] });
    }
    if (error instanceof ScenarioStateError) {
      if (error.message === 'scenario not found') throw errors.notFound();
      throw errors.conflict(error.message);
    }
    const code = pgErrorCode(error);
    if (code === PG_ERRORS.checkViolation) throw errors.conflict('This approval action is not allowed for the scenario in its current state.');
    if (code === PG_ERRORS.uniqueViolation) throw errors.conflict('This season already has a published scenario.');
    if (code === PG_ERRORS.foreignKeyViolation) throw errors.notFound();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Response shaping
// ---------------------------------------------------------------------------

async function detail(pool: pg.Pool, principal: Principal, id: string) {
  const [record, header] = await Promise.all([planning.getScenarioRecord(pool, id), approvals.getApprovalHeader(pool, id)]);
  if (!record || !header) throw errors.notFound();
  const all = (await approvals.stepsByScenario(pool, [id])).get(id) ?? [];
  // The tracker reflects the live staleness: a stale Submitted scenario is paused.
  const state = approvals.approvalState({ ...header, stale: record.stale }, all);
  const steps = APPROVAL_STEP_KINDS.flatMap((k) => all.filter((s) => s.submissionNo === header.submissionNo && s.step === k));
  const earlier = [...new Set(all.map((s) => s.submissionNo).filter((n) => n !== header.submissionNo))].sort((a, b) => b - a);

  const run = await planning.getLatestRun(pool, id);
  const results = run?.results ? resultsFor(principal, run.results) : null;
  const published = await approvals.publishedPeer(pool, record.season, record.synthetic, id);
  let changes = null;
  if (published && results) {
    const peerRun = await planning.getLatestRun(pool, published.id);
    const viewer = costViewer(principal);
    const shaped = (r: ReturnType<typeof resultsFor>) => shapeCost<ScenarioRunResults>(r, viewer);
    changes = compareScenarioResults(peerRun?.results ? shaped(resultsFor(principal, peerRun.results)) : null, shaped(results));
  }

  return {
    scenario: { ...listItem(record), notes: record.settings.notes },
    submissionNo: header.submissionNo,
    submittedBy: header.submittedBy,
    submittedAt: header.submittedAt,
    steps,
    history: earlier.map((n) => ({ submissionNo: n, steps: all.filter((s) => s.submissionNo === n) })),
    planReady: isPlanReady(state),
    checks: { runComplete: record.hasSucceededRun, notStale: !record.stale },
    actions: approvalActionsFor(principal.activeRole, state),
    results,
    published,
    changes,
  };
}

async function detailResponse(pool: pg.Pool, principal: Principal, id: string): Promise<ApiResponse> {
  return { statusCode: 200, body: { approval: await detail(pool, principal, id) } };
}

function decisionRoute(step: ApprovalStepKind, guard: RouteGuard): ApprovalRoute {
  const schema = decisionBody(step);
  return {
    method: 'POST',
    path: `/approvals/:scenarioId/${step}`,
    guard,
    handler: async ({ request, context, principal, pool }) => {
      const id = idParam(request);
      const body = parseInput(schema, request.body ?? {}, 'body');
      await approvals.refreshPause(pool, id);
      await mutate(pool, principal, context, (tx) =>
        approvals.decide(tx, {
          scenarioId: id,
          step,
          decision: body.decision as approvals.DecideInput['decision'],
          ...(body.comment !== undefined ? { comment: body.comment } : {}),
          ...(body.submissionNo !== undefined ? { submissionNo: body.submissionNo } : {}),
        }),
      );
      return detailResponse(pool, principal, id);
    },
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const APPROVAL_ROUTES: readonly ApprovalRoute[] = [
  {
    method: 'GET',
    path: '/approvals',
    guard: authorize('approval_plan', 'view'),
    handler: async ({ request, principal, pool }) => {
      const q = parseInput(listQuery, request.query, 'query');
      const headers = await approvals.listApprovalHeaders(pool, { pendingOnly: q.state !== 'all' });
      const steps = await approvals.stepsByScenario(pool, headers.map((h) => h.id));
      const items: ApprovalQueueItem[] = headers.map((h) => {
        const state = approvals.approvalState(h, steps.get(h.id) ?? []);
        return {
          scenarioId: h.id,
          name: h.name,
          season: h.season,
          status: h.status,
          stale: h.stale,
          submissionNo: h.submissionNo,
          submittedBy: h.submittedBy,
          submittedAt: h.submittedAt,
          steps: state.steps.filter((s) => s.submissionNo === h.submissionNo),
          planReady: isPlanReady(state),
          awaitingYou: awaitsRole(principal.activeRole, state),
          synthetic: h.synthetic,
        };
      });
      return { statusCode: 200, body: { approvals: items } };
    },
  },
  {
    method: 'GET',
    path: '/approvals/:scenarioId',
    guard: authorize('approval_plan', 'view'),
    handler: async ({ request, principal, pool }) => detailResponse(pool, principal, idParam(request)),
  },
  decisionRoute('headcount', authorize('approval_headcount', 'approve')),
  decisionRoute('budget', authorize('approval_budget', 'approve')),
  decisionRoute('plan', authorize('approval_plan', 'approve')),
  {
    method: 'POST',
    path: '/approvals/:scenarioId/secured-outside',
    guard: authorize('approval_offsystem', 'edit'),
    handler: async ({ request, context, principal, pool }) => {
      const id = idParam(request);
      const body = parseInput(outsideBody, request.body ?? {}, 'body');
      await approvals.refreshPause(pool, id);
      await mutate(pool, principal, context, (tx) =>
        approvals.recordOutside(tx, {
          scenarioId: id,
          step: body.step,
          reference: body.reference,
          note: body.note,
          ...(body.submissionNo !== undefined ? { submissionNo: body.submissionNo } : {}),
        }),
      );
      return detailResponse(pool, principal, id);
    },
  },
];

/** Registers every approval route behind its declared guard. */
export function registerApprovalRoutes(router: Router, deps: ApprovalRouteDeps): Router {
  for (const route of APPROVAL_ROUTES) {
    router.add(route.method, route.path, route.guard, async (request, context) =>
      route.handler({ request, context, principal: requirePrincipal(context), pool: deps.db() }),
    );
  }
  return router;
}
