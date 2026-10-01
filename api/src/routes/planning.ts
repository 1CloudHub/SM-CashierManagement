/**
 * Network view, department day plan, hiring plan, long rosters and the
 * leadership summary — `/scenarios/:scenarioId/…` (task 14; Req 5, 10, 18.3;
 * SCR-020/021/023/024; P1, P2, P6, P7, P9, P12).
 *
 * Each route in `PLANNING_ROUTES` declares its one task 8.1 guard on the
 * RBAC matrix rows "Network view", "Department day plan", "Hiring plan",
 * "Weekly roster" and "Leadership summary" (view / edit / export). Results
 * are planned from the scenario run's pinned inputs (P6) and limited to the
 * active role's scope (P1); a department outside the scope is the same 404
 * as a missing one. Every ₱ figure is a `costFigure` shaped by the router
 * (task 21). Exports are CSV (and a print-ready A4 page for the summary),
 * carry the sample-data marker while synthetic (P9) and record one export
 * audit event (P7).
 */
import {
  LONG_ROSTER_MAX_DAYS,
  LONG_ROSTER_MIN_DAYS,
  departmentDayCsv,
  hiringPlanCsv,
  isStoreInScope,
  leadershipSummaryCsv,
  networkViewCsv,
  seesPublishedScenariosOnly,
  shapeCost,
  type CostDraft,
  type DepartmentDayView,
  type FileDownload,
  type HiringPlanView,
  type LeadershipSummary,
  type NetworkView,
  type PlanningJob,
  type PlanningJobType,
} from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize, type RouteGuard } from '../auth/guards.js';
import { requirePrincipal, type Principal, type RequestContext } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction } from '../db/audit.js';
import { recordExport } from '../db/repositories/exports.js';
import * as scenarioRepo from '../db/repositories/scenario-planning.js';
import { PG_ERRORS, pgErrorCode } from '../db/rows.js';
import { costViewer } from '../http/cost.js';
import { errors } from '../http/errors.js';
import type { HttpMethod, Router } from '../http/router.js';
import type { ApiResponse, RoutedRequest } from '../http/types.js';
import { parseInput } from '../http/validation.js';
import * as jobs from '../jobs/planning-jobs.js';
import type { JobQueue } from '../jobs/queue.js';
import type { StoredHiringResults, StoredRosterResults } from '../jobs/units.js';
import { loadOrgRows, loadPlanningBasis, loadRunInputs, provenanceOf, type PlanningBasis } from '../planning/basis.js';
import { buildHiringPlanView, buildLeadershipSummary, buildLongRosterView, leadershipSummaryHtml } from '../planning/hiring.js';
import { PlanningInputError, buildDepartmentDayView, buildNetworkView, departmentInScope } from '../planning/views.js';
import { EngineInputError } from '../scenarios/engine.js';

export interface PlanningRouteDeps {
  readonly db: () => pg.Pool;
  /** Background jobs: SQS in AWS, in-process otherwise. */
  readonly jobs: () => JobQueue;
}

interface HandlerArgs {
  readonly request: RoutedRequest;
  readonly context: RequestContext;
  readonly principal: Principal;
  readonly pool: pg.Pool;
  readonly queue: () => JobQueue;
}

export interface PlanningRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly guard: RouteGuard;
  readonly handler: (args: HandlerArgs) => Promise<ApiResponse>;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use a date like 2026-12-19.' });
const optionalId = z.string().max(64).optional();

const networkQuery = z
  .object({ date: isoDate.optional(), region: optionalId, format: optionalId, store: optionalId, dept: optionalId })
  .passthrough();
const dayQuery = z.object({ date: isoDate.optional() }).passthrough();
const summaryExportQuery = z.object({ format: z.enum(['csv', 'html']).optional() }).passthrough();
const emptyBody = z.object({}).strict();
const rosterBody = z.object({ from: isoDate, to: isoDate, departmentId: z.string().regex(UUID).optional() }).strict();

function param(request: RoutedRequest, name: string): string {
  const id = request.params[name] ?? '';
  if (!UUID.test(id)) throw errors.notFound();
  return id;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

// ---------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------

function visible(principal: Principal, status: string): boolean {
  return principal.activeRole !== null && (!seesPublishedScenariosOnly(principal.activeRole) || status === 'published');
}

/** Loads the scenario's planning basis; a missing or invisible scenario is a 404. */
async function basisFor(pool: pg.Pool, principal: Principal, scenarioId: string): Promise<PlanningBasis> {
  const basis = await loadPlanningBasis(pool, scenarioId);
  if (!basis || !visible(principal, basis.scenario.status)) throw errors.notFound();
  return basis;
}

async function scenarioFor(pool: pg.Pool, principal: Principal, scenarioId: string): Promise<scenarioRepo.ScenarioRecord> {
  const scenario = await scenarioRepo.getScenarioRecord(pool, scenarioId);
  if (!scenario || !visible(principal, scenario.status)) throw errors.notFound();
  return scenario;
}

/** Engine and input refusals as the shared error model. */
function planning<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof PlanningInputError) {
      if (error.code === 'outside_window') {
        throw errors.validationFailed(error.message, [{ path: 'query.date', message: error.message }]);
      }
      throw errors.conflict(error.message);
    }
    if (error instanceof EngineInputError) throw errors.conflict(error.message);
    throw error;
  }
}

function exportName(...parts: string[]): string {
  return parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100);
}

async function audited(
  pool: pg.Pool,
  principal: Principal,
  context: RequestContext,
  input: Parameters<typeof recordExport>[1],
): Promise<void> {
  await withAuditedTransaction(pool, actorFromPrincipal(principal, context.requestId), (tx) => recordExport(tx, input));
}

function exportHeader(principal: Principal, context: RequestContext, request: RoutedRequest) {
  return { generatedAt: context.now().toISOString(), generatedBy: principal.email, filters: new URLSearchParams(request.query).toString() };
}

function networkFor(request: RoutedRequest, principal: Principal, basis: PlanningBasis): CostDraft<NetworkView> {
  const q = parseInput(networkQuery, request.query, 'query');
  return planning(() =>
    buildNetworkView(principal, basis, q.date ?? basis.scenario.settings.peakDay, {
      ...(q.region ? { regionId: q.region } : {}),
      ...(q.format ? { storeFormat: q.format } : {}),
      ...(q.store ? { storeId: q.store } : {}),
      ...(q.dept ? { departmentId: q.dept } : {}),
    }),
  );
}

function departmentDayFor(request: RoutedRequest, principal: Principal, basis: PlanningBasis): CostDraft<DepartmentDayView> {
  const departmentId = param(request, 'departmentId');
  const q = parseInput(dayQuery, request.query, 'query');
  return planning(() => {
    const target = departmentInScope(principal, basis, departmentId);
    if (!target) throw errors.notFoundOrNoAccess();
    return buildDepartmentDayView(basis, target, q.date ?? basis.scenario.settings.peakDay);
  });
}

async function hiringViewFor(pool: pg.Pool, principal: Principal, context: RequestContext, scenarioId: string): Promise<CostDraft<HiringPlanView>> {
  const scenario = await scenarioFor(pool, principal, scenarioId);
  const params = hiringParams(scenario);
  const [latest, succeeded, currentKey] = await Promise.all([
    jobs.latestJob(pool, scenarioId, 'hiring_plan'),
    jobs.latestSucceededJob<StoredHiringResults>(pool, scenarioId, 'hiring_plan'),
    jobs.jobKey(pool, 'hiring_plan', scenario, params),
  ]);
  const inputs = succeeded ? await loadRunInputs(pool, succeeded.job.id) : null;
  const provenance = provenanceOf(
    scenario,
    inputs && succeeded ? { ...inputs, runAt: succeeded.job.finishedAt } : null,
    succeeded !== null && succeeded.key !== currentKey,
  );
  return buildHiringPlanView({
    scope: principal.scope,
    provenance,
    job: latest,
    from: params.from,
    to: params.to,
    results: succeeded?.results ?? null,
    today: context.now().toISOString().slice(0, 10),
  });
}

function hiringParams(scenario: scenarioRepo.ScenarioRecord): jobs.JobParams {
  return { settings: scenario.settings, from: scenario.settings.planningFrom, to: scenario.settings.planningTo };
}

async function summaryFor(pool: pg.Pool, principal: Principal, context: RequestContext, scenarioId: string): Promise<CostDraft<LeadershipSummary>> {
  const scenario = await scenarioFor(pool, principal, scenarioId);
  const succeeded = await jobs.latestSucceededJob<StoredHiringResults>(pool, scenarioId, 'hiring_plan');
  const currentKey = await jobs.jobKey(pool, 'hiring_plan', scenario, hiringParams(scenario));
  const inputs = succeeded ? await loadRunInputs(pool, succeeded.job.id) : null;
  // The network peak over in-scope stores, exactly as the network view shows it (P1, P2).
  const basis = await loadPlanningBasis(pool, scenarioId);
  let peak: LeadershipSummary['peak'] = null;
  if (basis?.run) {
    try {
      const kpis = buildNetworkView(principal, basis, scenario.settings.peakDay, {}).kpis as { peakHour: number; peakLanes: number };
      peak = { date: scenario.settings.peakDay, hour: kpis.peakHour, lanesOpen: kpis.peakLanes };
    } catch (error) {
      if (!(error instanceof EngineInputError) && !(error instanceof PlanningInputError)) throw error;
    }
  }
  return buildLeadershipSummary({
    scope: principal.scope,
    provenance: provenanceOf(
      scenario,
      inputs && succeeded ? { ...inputs, runAt: succeeded.job.finishedAt } : null,
      succeeded !== null && succeeded.key !== currentKey,
    ),
    season: scenario.season,
    from: scenario.settings.planningFrom,
    to: scenario.settings.planningTo,
    generatedAt: context.now().toISOString(),
    results: succeeded?.results ?? null,
    peak,
  });
}

/**
 * Requests a job for the scenario's current version: the cached job when one
 * is queued, running or done for exactly these inputs (200), else a new
 * queued job handed to the worker (202) with one audit event.
 */
async function requestJob(
  args: HandlerArgs,
  type: PlanningJobType,
  scenario: scenarioRepo.ScenarioRecord,
  params: jobs.JobParams,
): Promise<ApiResponse> {
  const { pool, principal, context } = args;
  const key = await jobs.jobKey(pool, type, scenario, params);
  const cached = await jobs.findJobByKey(pool, key);
  if (cached && jobs.isStuck(cached, context.now())) {
    // Its message was dead-lettered or the worker died for good: free the key.
    await jobs.failJob(pool, cached.id, 'The job stopped responding. Run it again.');
  } else if (cached) {
    return { statusCode: 200, body: { job: cached, cached: true } };
  }
  let job: PlanningJob;
  try {
    job = await withAuditedTransaction(pool, actorFromPrincipal(principal, context.requestId), (tx) =>
      jobs.createJob(tx, { type, scenario, params, key }),
    );
  } catch (error) {
    // A concurrent request created it first: return that one.
    if (pgErrorCode(error) === PG_ERRORS.uniqueViolation) {
      const raced = await jobs.findJobByKey(pool, key);
      if (raced) return { statusCode: 200, body: { job: raced, cached: true } };
    }
    throw error;
  }
  try {
    await args.queue().enqueue({ type, jobId: job.id });
  } catch {
    await jobs.failJob(pool, job.id, 'The job could not be queued. Try again.');
    throw errors.serviceUnavailable();
  }
  const current = await jobs.getJob(pool, scenario.id, job.id, type);
  return { statusCode: 202, body: { job: current ?? job, cached: false } };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const PLANNING_ROUTES: readonly PlanningRoute[] = [
  {
    method: 'GET',
    path: '/scenarios/:scenarioId/network',
    guard: authorize('network_view', 'view'),
    handler: async ({ request, principal, pool }) => {
      const basis = await basisFor(pool, principal, param(request, 'scenarioId'));
      return { statusCode: 200, body: { view: networkFor(request, principal, basis) } };
    },
  },
  {
    method: 'GET',
    path: '/scenarios/:scenarioId/network/export',
    guard: authorize('network_view', 'export'),
    handler: async ({ request, context, principal, pool }) => {
      const basis = await basisFor(pool, principal, param(request, 'scenarioId'));
      const view = shapeCost<NetworkView>(networkFor(request, principal, basis), costViewer(principal));
      const content = networkViewCsv(view, exportHeader(principal, context, request));
      await audited(pool, principal, context, {
        screen: 'SCR-020',
        format: 'csv',
        objectType: 'scenario',
        objectId: basis.scenario.id,
        rowCount: view.stores.reduce((n, s) => n + 1 + s.departments.length, 0),
        query: new URLSearchParams(request.query).toString(),
        synthetic: view.provenance.synthetic,
      });
      const body: FileDownload = { fileName: exportName('network', basis.scenario.name, view.date) + '.csv', contentType: 'text/csv', content };
      return { statusCode: 200, body };
    },
  },
  {
    method: 'GET',
    path: '/scenarios/:scenarioId/departments/:departmentId/day',
    guard: authorize('department_plan', 'view'),
    handler: async ({ request, principal, pool }) => {
      const basis = await basisFor(pool, principal, param(request, 'scenarioId'));
      return { statusCode: 200, body: { view: departmentDayFor(request, principal, basis) } };
    },
  },
  {
    method: 'GET',
    path: '/scenarios/:scenarioId/departments/:departmentId/day/export',
    guard: authorize('department_plan', 'export'),
    handler: async ({ request, context, principal, pool }) => {
      const basis = await basisFor(pool, principal, param(request, 'scenarioId'));
      const view = shapeCost<DepartmentDayView>(departmentDayFor(request, principal, basis), costViewer(principal));
      const content = departmentDayCsv(view, exportHeader(principal, context, request));
      await audited(pool, principal, context, {
        screen: 'SCR-021',
        format: 'csv',
        objectType: 'scenario',
        objectId: basis.scenario.id,
        rowCount: view.hours.length,
        query: new URLSearchParams({ ...request.query, department: view.figures.departmentId }).toString(),
        synthetic: view.provenance.synthetic,
      });
      const body: FileDownload = {
        fileName: exportName('department', view.figures.storeName, view.figures.departmentName, view.date) + '.csv',
        contentType: 'text/csv',
        content,
      };
      return { statusCode: 200, body };
    },
  },
  {
    method: 'GET',
    path: '/scenarios/:scenarioId/hiring-plan',
    guard: authorize('hiring_plan', 'view'),
    handler: async ({ request, context, principal, pool }) => ({
      statusCode: 200,
      body: { view: await hiringViewFor(pool, principal, context, param(request, 'scenarioId')) },
    }),
  },
  {
    method: 'POST',
    path: '/scenarios/:scenarioId/hiring-plan/jobs',
    guard: authorize('hiring_plan', 'edit'),
    handler: async (args) => {
      const scenario = await scenarioFor(args.pool, args.principal, param(args.request, 'scenarioId'));
      parseInput(emptyBody, args.request.body ?? {}, 'body');
      return requestJob(args, 'hiring_plan', scenario, hiringParams(scenario));
    },
  },
  {
    method: 'GET',
    path: '/scenarios/:scenarioId/hiring-plan/jobs/:jobId',
    guard: authorize('hiring_plan', 'view'),
    handler: async ({ request, principal, pool }) => {
      const scenario = await scenarioFor(pool, principal, param(request, 'scenarioId'));
      const job = await jobs.getJob(pool, scenario.id, param(request, 'jobId'), 'hiring_plan');
      if (!job) throw errors.notFound();
      return { statusCode: 200, body: { job } };
    },
  },
  {
    method: 'GET',
    path: '/scenarios/:scenarioId/hiring-plan/export',
    guard: authorize('hiring_plan', 'export'),
    handler: async ({ request, context, principal, pool }) => {
      const scenarioId = param(request, 'scenarioId');
      const view = shapeCost<HiringPlanView>(await hiringViewFor(pool, principal, context, scenarioId), costViewer(principal));
      if (!view.plan) throw errors.conflict('Run the hiring plan before exporting it.');
      const content = hiringPlanCsv(view, exportHeader(principal, context, request));
      await audited(pool, principal, context, {
        screen: 'SCR-023',
        format: 'csv',
        objectType: 'scenario',
        objectId: scenarioId,
        rowCount: view.plan.stores.reduce((n, s) => n + 1 + s.departments.length, 0),
        query: new URLSearchParams(request.query).toString(),
        synthetic: view.provenance.synthetic,
      });
      const body: FileDownload = { fileName: exportName('hiring-plan', view.provenance.scenarioName) + '.csv', contentType: 'text/csv', content };
      return { statusCode: 200, body };
    },
  },
  {
    method: 'POST',
    path: '/scenarios/:scenarioId/rosters/jobs',
    guard: authorize('weekly_roster', 'edit'),
    handler: async (args) => {
      const { request, principal, pool } = args;
      const scenario = await scenarioFor(pool, principal, param(request, 'scenarioId'));
      const body = parseInput(rosterBody, request.body ?? {}, 'body');
      const days = daysBetween(body.from, body.to);
      if (days < LONG_ROSTER_MIN_DAYS || days > LONG_ROSTER_MAX_DAYS) {
        throw errors.validationFailed(`Background rosters cover ${LONG_ROSTER_MIN_DAYS} to ${LONG_ROSTER_MAX_DAYS} days; rosters up to four weeks open directly.`, [
          { path: 'body.to', message: 'Pick a longer or shorter period.' },
        ]);
      }
      if (body.departmentId) {
        const org = await loadOrgRows(pool, scenario.synthetic);
        const dept = org.departments.find((d) => d.id === body.departmentId);
        const store = dept && org.stores.find((s) => s.id === dept.store_id);
        const ok = store && principal.scope !== null && isStoreInScope(principal.scope, { id: store.id, regionId: store.region_id });
        if (!ok) throw errors.notFoundOrNoAccess();
      } else if (principal.scope?.type !== 'global' && principal.scope?.type !== 'region') {
        throw errors.validationFailed('Pick a department for the roster.', [{ path: 'body.departmentId', message: 'Required for your scope.' }]);
      }
      return requestJob(args, 'long_roster', scenario, {
        settings: scenario.settings,
        from: body.from,
        to: body.to,
        ...(body.departmentId ? { departmentId: body.departmentId } : {}),
      });
    },
  },
  {
    method: 'GET',
    path: '/scenarios/:scenarioId/rosters/jobs/:jobId',
    guard: authorize('weekly_roster', 'view'),
    handler: async ({ request, principal, pool }) => {
      const scenario = await scenarioFor(pool, principal, param(request, 'scenarioId'));
      const job = await jobs.getJob(pool, scenario.id, param(request, 'jobId'), 'long_roster');
      if (!job) throw errors.notFound();
      const inputs = await loadRunInputs(pool, job.id);
      const results =
        job.status === 'succeeded'
          ? (await pool.query<{ results: StoredRosterResults }>('SELECT results FROM scenario_run_result WHERE run_id = $1', [job.id])).rows[0]?.results ?? null
          : null;
      return {
        statusCode: 200,
        body: {
          view: buildLongRosterView({ scope: principal.scope, provenance: provenanceOf(scenario, { ...inputs, runAt: job.finishedAt }), job, results }),
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/scenarios/:scenarioId/summary',
    guard: authorize('leadership_summary', 'view'),
    handler: async ({ request, context, principal, pool }) => ({
      statusCode: 200,
      body: { summary: await summaryFor(pool, principal, context, param(request, 'scenarioId')) },
    }),
  },
  {
    method: 'GET',
    path: '/scenarios/:scenarioId/summary/export',
    guard: authorize('leadership_summary', 'export'),
    handler: async ({ request, context, principal, pool }) => {
      const scenarioId = param(request, 'scenarioId');
      const q = parseInput(summaryExportQuery, request.query, 'query');
      const format = q.format ?? 'html';
      const summary = shapeCost<LeadershipSummary>(await summaryFor(pool, principal, context, scenarioId), costViewer(principal));
      const content =
        format === 'csv' ? leadershipSummaryCsv(summary, exportHeader(principal, context, request)) : leadershipSummaryHtml(summary);
      await audited(pool, principal, context, {
        screen: 'SCR-024',
        format: format === 'csv' ? 'csv' : 'pdf',
        objectType: 'scenario',
        objectId: scenarioId,
        rowCount: summary.hiring?.stores.length ?? 0,
        query: new URLSearchParams(request.query).toString(),
        synthetic: summary.sampleData,
      });
      const body: FileDownload = {
        fileName: exportName('leadership-summary', summary.provenance.scenarioName) + (format === 'csv' ? '.csv' : '.html'),
        contentType: format === 'csv' ? 'text/csv' : 'text/html',
        content,
      };
      return { statusCode: 200, body };
    },
  },
];

/** Registers every planning route behind its declared guard. */
export function registerPlanningRoutes(router: Router, deps: PlanningRouteDeps): Router {
  for (const route of PLANNING_ROUTES) {
    router.add(route.method, route.path, route.guard, async (request, context) =>
      route.handler({ request, context, principal: requirePrincipal(context), pool: deps.db(), queue: deps.jobs }),
    );
  }
  return router;
}
