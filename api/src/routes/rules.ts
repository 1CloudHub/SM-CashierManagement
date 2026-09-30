/**
 * Business rule sets and versions — `/rule-sets`, `/rule-versions` (task 10;
 * Req 16; SCR-060, SCR-061; P6, P7, P12).
 *
 * Each route declares its one required permission in `RULE_ROUTES`; the
 * permission maps to a task 8.1 `authorize(resource, action)` guard through
 * `RULE_PERMISSION_GRANTS` (the RBAC matrix "Business rules" rows). Publishing
 * needs a different grant for cost rules (Finance) and non-cost rules (Rules
 * Steward), which depends on the version addressed, so the publish route is
 * guarded by `rules.view` and its handler requires the kind-specific grant.
 */
import {
  ENGINE_PAYLOAD_IDENTITY_KEYS,
  RULE_PERMISSION_GRANTS,
  canPublishRuleVersion,
  diffRulePayloads,
  hasRulePermission,
  isIsoDate,
  publishPermissionFor,
  isRuleVersionEditable,
  validateRulePayload,
  type RulePermission,
  type RuleSetType,
  type RuleVersionDetail,
  type RuleVersionDiff,
} from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize, type RouteGuard } from '../auth/guards.js';
import { requirePrincipal, type Principal, type RequestContext } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction, type AuditedTx } from '../db/audit.js';
import * as rulesRepo from '../db/repositories/rules.js';
import { PG_ERRORS, pgErrorCode } from '../db/rows.js';
import { ApiError, errors } from '../http/errors.js';
import type { HttpMethod, Router } from '../http/router.js';
import type { ApiResponse, RoutedRequest } from '../http/types.js';
import { parseInput } from '../http/validation.js';

export interface RuleRouteDeps {
  /** The database pool; throws a 503 `ApiError` when none is configured. */
  readonly db: () => pg.Pool;
}

/** The task 8.1 guard for a rule permission. */
export function ruleGuard(permission: RulePermission): RouteGuard {
  const { resource, action } = RULE_PERMISSION_GRANTS[permission];
  return authorize(resource, action);
}

interface HandlerArgs {
  readonly request: RoutedRequest;
  readonly context: RequestContext;
  readonly principal: Principal;
  readonly pool: pg.Pool;
}

export interface RuleRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly permission: RulePermission;
  readonly handler: (args: HandlerArgs) => Promise<ApiResponse>;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const isoDate = z.string().refine(isIsoDate, { message: 'Must be a date (YYYY-MM-DD).' });
const changeNote = z.string().max(2000);
const payload = z.record(z.string(), z.unknown());

const createVersionBody = z
  .object({
    effectiveFrom: isoDate,
    /** Omitted: start from the in-force (or latest) version's payload. */
    payload: payload.optional(),
    changeNote: changeNote.optional(),
    synthetic: z.boolean().optional(),
  })
  .strict();

const editVersionBody = z
  .object({ effectiveFrom: isoDate.optional(), payload: payload.optional(), changeNote: changeNote.optional() })
  .strict();

const approveBody = z.object({ comment: z.string().max(2000).optional() }).strict();
const requestChangesBody = z
  .object({ comment: z.string().max(2000).refine((s) => s.trim().length > 0, { message: 'A comment is required.' }) })
  .strict();

const provenanceQuery = z.object({ synthetic: z.enum(['true', 'false']).optional() }).passthrough();
const diffQuery = z.object({ against: z.string().optional() }).passthrough();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Path ids that are not UUIDs are simply unknown resources. */
function idParam(request: RoutedRequest, name: string): string {
  const id = request.params[name] ?? '';
  if (!UUID.test(id)) throw errors.notFound();
  return id;
}

function payloadErrors(type: RuleSetType, value: unknown, prefix: string): void {
  const result = validateRulePayload(type, value);
  if (!result.ok) {
    throw new ApiError('validation_failed', 'Some rule values are missing or invalid.', {
      details: result.issues.map((i) => ({ path: i.path ? `${prefix}.${i.path}` : prefix, message: i.message })),
    });
  }
}

function requireChangeNote(version: RuleVersionDetail): void {
  if (version.changeNote.trim().length === 0) {
    throw new ApiError('validation_failed', 'Add a change note first.', {
      details: [{ path: 'changeNote', message: 'A change note is required.' }],
    });
  }
}

/** Maps domain and constraint refusals to 409/404 so the client sees a stable error model. */
async function mutate<T>(pool: pg.Pool, principal: Principal, context: RequestContext, fn: (tx: AuditedTx) => Promise<T>): Promise<T> {
  try {
    return await withAuditedTransaction(pool, actorFromPrincipal(principal, context.requestId), fn);
  } catch (error) {
    if (error instanceof rulesRepo.RuleVersionStateError) throw errors.conflict(error.message);
    const code = pgErrorCode(error);
    if (code === PG_ERRORS.uniqueViolation) throw errors.conflict('This rule set already has an open draft version.');
    if (code === PG_ERRORS.checkViolation) throw errors.conflict('This change is not allowed for the version in its current state.');
    if (code === PG_ERRORS.foreignKeyViolation) throw errors.notFound();
    throw error;
  }
}

async function loadVersion(pool: pg.Pool, id: string): Promise<RuleVersionDetail> {
  const version = await rulesRepo.getRuleVersion(pool, id);
  if (!version) throw errors.notFound();
  return version;
}

async function versionResponse(pool: pg.Pool, id: string, statusCode = 200): Promise<ApiResponse> {
  return { statusCode, body: { version: await loadVersion(pool, id) } };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const RULE_ROUTES: readonly RuleRoute[] = [
  {
    method: 'GET',
    path: '/rule-sets',
    permission: 'rules.view',
    handler: async ({ request, pool }) => {
      const q = parseInput(provenanceQuery, request.query, 'query');
      return { statusCode: 200, body: { ruleSets: await rulesRepo.listRuleSets(pool, { synthetic: q.synthetic === 'true' }) } };
    },
  },
  {
    method: 'GET',
    path: '/rule-sets/:ruleSetId/versions',
    permission: 'rules.view',
    handler: async ({ request, pool }) => {
      const q = parseInput(provenanceQuery, request.query, 'query');
      const ruleSet = await rulesRepo.getRuleSet(pool, idParam(request, 'ruleSetId'));
      if (!ruleSet) throw errors.notFound();
      const versions = await rulesRepo.listRuleVersions(pool, ruleSet.id, { synthetic: q.synthetic === 'true' });
      return { statusCode: 200, body: { ruleSet, versions } };
    },
  },
  {
    method: 'POST',
    path: '/rule-sets/:ruleSetId/versions',
    permission: 'rules.edit',
    handler: async ({ request, context, principal, pool }) => {
      const ruleSet = await rulesRepo.getRuleSet(pool, idParam(request, 'ruleSetId'));
      if (!ruleSet) throw errors.notFound();
      const body = parseInput(createVersionBody, request.body ?? {}, 'body');
      const synthetic = body.synthetic ?? false;
      let content = body.payload;
      if (content === undefined) {
        // "New draft" starts from the in-force version, else the latest one.
        const history = await rulesRepo.listRuleVersions(pool, ruleSet.id, { synthetic });
        const base = history.find((v) => v.status === 'published') ?? history[0];
        if (!base) {
          throw new ApiError('validation_failed', 'This rule set has no version yet; provide the rule values.', {
            details: [{ path: 'body.payload', message: 'Required.' }],
          });
        }
        // The copied engine identity (`id`, `effectiveFrom`) belongs to the old version.
        content = Object.fromEntries(
          Object.entries((await loadVersion(pool, base.id)).payload).filter(
            ([k]) => !(ENGINE_PAYLOAD_IDENTITY_KEYS as readonly string[]).includes(k),
          ),
        );
      }
      payloadErrors(ruleSet.type, content, 'body.payload');
      const created = await mutate(pool, principal, context, (tx) =>
        rulesRepo.createRuleVersion(tx, {
          ruleSetId: ruleSet.id,
          effectiveFrom: body.effectiveFrom,
          payload: content,
          ...(body.changeNote !== undefined ? { changeNote: body.changeNote } : {}),
          synthetic,
        }),
      );
      return versionResponse(pool, created.id, 201);
    },
  },
  {
    method: 'GET',
    path: '/rule-versions/:versionId',
    permission: 'rules.view',
    handler: async ({ request, pool }) => {
      const version = await loadVersion(pool, idParam(request, 'versionId'));
      const impact = await rulesRepo.getRuleVersionImpact(pool, version.id);
      return { statusCode: 200, body: { version, impact } };
    },
  },
  {
    method: 'PATCH',
    path: '/rule-versions/:versionId',
    permission: 'rules.edit',
    handler: async ({ request, context, principal, pool }) => {
      const version = await loadVersion(pool, idParam(request, 'versionId'));
      const body = parseInput(editVersionBody, request.body ?? {}, 'body');
      if (!isRuleVersionEditable(version.status)) throw errors.conflict(`A ${version.status} version can no longer be edited.`);
      if (body.payload !== undefined) payloadErrors(version.ruleSetType, body.payload, 'body.payload');
      await mutate(pool, principal, context, (tx) =>
        rulesRepo.editRuleVersion(tx, version.id, {
          ...(body.payload !== undefined ? { payload: body.payload } : {}),
          ...(body.effectiveFrom !== undefined ? { effectiveFrom: body.effectiveFrom } : {}),
          ...(body.changeNote !== undefined ? { changeNote: body.changeNote } : {}),
        }),
      );
      return versionResponse(pool, version.id);
    },
  },
  {
    method: 'POST',
    path: '/rule-versions/:versionId/submit',
    permission: 'rules.edit',
    handler: async ({ request, context, principal, pool }) => {
      const version = await loadVersion(pool, idParam(request, 'versionId'));
      requireChangeNote(version);
      payloadErrors(version.ruleSetType, version.payload, 'payload');
      await mutate(pool, principal, context, (tx) => rulesRepo.submitRuleVersion(tx, version.id));
      return versionResponse(pool, version.id);
    },
  },
  {
    method: 'POST',
    path: '/rule-versions/:versionId/approve',
    permission: 'rules.approve_cost',
    handler: async ({ request, context, principal, pool }) => {
      const id = idParam(request, 'versionId');
      const body = parseInput(approveBody, request.body ?? {}, 'body');
      await mutate(pool, principal, context, (tx) => rulesRepo.decideRuleVersion(tx, id, 'approve', body.comment));
      return versionResponse(pool, id);
    },
  },
  {
    method: 'POST',
    path: '/rule-versions/:versionId/request-changes',
    permission: 'rules.approve_cost',
    handler: async ({ request, context, principal, pool }) => {
      const id = idParam(request, 'versionId');
      const body = parseInput(requestChangesBody, request.body ?? {}, 'body');
      await mutate(pool, principal, context, (tx) => rulesRepo.decideRuleVersion(tx, id, 'request_changes', body.comment));
      return versionResponse(pool, id);
    },
  },
  {
    method: 'POST',
    path: '/rule-versions/:versionId/publish',
    // Narrowed in the handler by the version's cost flag (see file header).
    permission: 'rules.view',
    handler: async ({ request, context, principal, pool }) => {
      const version = await loadVersion(pool, idParam(request, 'versionId'));
      // Finance publishes approved cost rules; the Rules Steward non-cost rules (Req 16.3, 16.4).
      if (!hasRulePermission(principal.activeRole, publishPermissionFor(version.isCostRule))) throw errors.forbidden();
      requireChangeNote(version);
      payloadErrors(version.ruleSetType, version.payload, 'payload');
      if (!canPublishRuleVersion(principal.activeRole, version.isCostRule, version.status)) {
        throw errors.conflict(
          version.isCostRule && version.status !== 'approved'
            ? 'A cost rule needs Finance approval before it can be published.'
            : `A ${version.status} version cannot be published.`,
        );
      }
      const result = await mutate(pool, principal, context, (tx) => rulesRepo.publishRuleVersion(tx, version.id));
      return {
        statusCode: 200,
        body: {
          version: await loadVersion(pool, version.id),
          supersededVersionId: result.supersededVersionId,
          staleScenarioIds: result.staleScenarioIds,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/rule-versions/:versionId/diff',
    permission: 'rules.view',
    handler: async ({ request, pool }) => {
      const version = await loadVersion(pool, idParam(request, 'versionId'));
      const q = parseInput(diffQuery, request.query, 'query');
      let base: RuleVersionDetail | null;
      if (q.against !== undefined) {
        if (!UUID.test(q.against)) throw errors.notFound();
        base = await loadVersion(pool, q.against);
        if (base.ruleSetId !== version.ruleSetId) {
          throw new ApiError('validation_failed', 'Compare versions of the same rule set.', {
            details: [{ path: 'query.against', message: 'Must be a version of the same rule set.' }],
          });
        }
      } else {
        base = await rulesRepo.getPreviousRuleVersion(pool, version.id);
      }
      const body: RuleVersionDiff = {
        fromVersionId: base?.id ?? null,
        toVersionId: version.id,
        changes: diffRulePayloads(base?.payload ?? {}, version.payload),
      };
      return { statusCode: 200, body };
    },
  },
];

/** Registers every rule route behind its declared permission's guard. */
export function registerRuleRoutes(router: Router, deps: RuleRouteDeps): Router {
  for (const route of RULE_ROUTES) {
    router.add(route.method, route.path, ruleGuard(route.permission), async (request, context) =>
      route.handler({ request, context, principal: requirePrincipal(context), pool: deps.db() }),
    )
  }
  return router;
}
