/**
 * Scenario management — `/scenarios` (task 11; Req 8.1–8.6; SCR-030/031/032;
 * P1, P3–P7, P12).
 *
 * Each route in `SCENARIO_ROUTES` declares its one task 8.1 guard on the RBAC
 * matrix "Scenarios" rows: `scenarios: view` (view / compare; Store Managers
 * see Published only), `scenario_settings: edit` (create / duplicate / edit
 * settings / run / archive — Planner) and `scenario_submit: edit` (submit —
 * Planner). Scenarios are network objects, so no route has a scope target;
 * the stores inside run results are filtered to the active role's scope and
 * every ₱ figure is a `costFigure` shaped by the router (task 21).
 */
import {
  DEFAULT_SCENARIO_SETTINGS,
  SCENARIO_STATUSES,
  can,
  compareScenarioResults,
  diffScenarioSettings,
  isStoreInScope,
  seesPublishedScenariosOnly,
  shapeCost,
  validateScenarioSettings,
  type ScenarioRunResults,
  type ScenarioStatus,
} from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize, type RouteGuard } from '../auth/guards.js';
import { requirePrincipal, type Principal, type RequestContext } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction, type AuditedTx } from '../db/audit.js';
import * as planning from '../db/repositories/scenario-planning.js';
import { ScenarioStateError } from '../db/repositories/scenarios.js';
import { PG_ERRORS, pgErrorCode } from '../db/rows.js';
import { costFigure, costViewer } from '../http/cost.js';
import { ApiError, errors } from '../http/errors.js';
import type { HttpMethod, Router } from '../http/router.js';
import type { ApiResponse, RoutedRequest } from '../http/types.js';
import { parseInput } from '../http/validation.js';
import type { StoredRunResults } from '../scenarios/engine.js';

export interface ScenarioRouteDeps {
  /** The database pool; throws a 503 `ApiError` when none is configured. */
  readonly db: () => pg.Pool;
}

interface HandlerArgs {
  readonly request: RoutedRequest;
  readonly context: RequestContext;
  readonly principal: Principal;
  readonly pool: pg.Pool;
}

export interface ScenarioRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly guard: RouteGuard;
  readonly handler: (args: HandlerArgs) => Promise<ApiResponse>;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const name = z
  .string()
  .max(120)
  .refine((s) => s.trim().length > 0, { message: 'A name is required.' });
const season = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, { message: 'Use lowercase letters, digits and dashes, e.g. christmas-2026.' });

const createBody = z
  .object({ name, season, settings: z.unknown().optional(), synthetic: z.boolean().optional() })
  .strict();
const editBody = z.object({ name: name.optional(), settings: z.unknown().optional() }).strict();
const duplicateBody = z.object({ name: name.optional() }).strict();
const emptyBody = z.object({}).strict();

const listQuery = z
  .object({
    status: z.enum(SCENARIO_STATUSES).optional(),
    season: z.string().max(80).optional(),
    q: z.string().max(120).optional(),
    stale: z.enum(['true', 'false']).optional(),
  })
  .passthrough();
const compareQuery = z.object({ a: z.string(), b: z.string() }).passthrough();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idParam(request: RoutedRequest): string {
  const id = request.params.scenarioId ?? '';
  if (!UUID.test(id)) throw errors.notFound();
  return id;
}

function settingsOrError(value: unknown) {
  const result = validateScenarioSettings(value);
  if (!result.ok) {
    throw new ApiError('validation_failed', 'Some settings are missing or invalid.', {
      details: result.issues.map((i) => ({ path: `body.settings.${i.path}`, message: i.message })),
    });
  }
  return result.settings;
}

/** Maps domain and constraint refusals to 409/404 so the client sees a stable error model. */
async function mutate<T>(pool: pg.Pool, principal: Principal, context: RequestContext, fn: (tx: AuditedTx) => Promise<T>): Promise<T> {
  try {
    return await withAuditedTransaction(pool, actorFromPrincipal(principal, context.requestId), fn);
  } catch (error) {
    if (error instanceof ScenarioStateError) {
      if (error.message === 'scenario not found') throw errors.notFound();
      throw errors.conflict(error.message);
    }
    const code = pgErrorCode(error);
    if (code === PG_ERRORS.checkViolation) throw errors.conflict('This change is not allowed for the scenario in its current state.');
    if (code === PG_ERRORS.uniqueViolation) throw errors.conflict('This season already has a published scenario.');
    if (code === PG_ERRORS.foreignKeyViolation) throw errors.notFound();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Response shaping
// ---------------------------------------------------------------------------

function visible(principal: Principal, record: planning.ScenarioRecord): boolean {
  return principal.activeRole !== null && (!seesPublishedScenariosOnly(principal.activeRole) || record.status === 'published');
}

/** Results limited to in-scope stores (P1), with every ₱ figure tagged for cost visibility. */
export function resultsFor(principal: Principal, stored: StoredRunResults) {
  const scope = principal.scope;
  const stores = stored.stores.filter((s) => scope !== null && isStoreInScope(scope, { id: s.storeId, regionId: s.regionId }));
  const headcountByType = { FT: 0, PT: 0, FLOAT: 0 };
  for (const s of stores) for (const k of ['FT', 'PT', 'FLOAT'] as const) headcountByType[k] += s.headcountByType[k];
  const lanes = Array.from({ length: 24 }, (_, h) => stores.reduce((sum, s) => sum + (s.peakDayLanes[h] ?? 0), 0));
  let peakHour = 0;
  lanes.forEach((v, h) => {
    if (v > (lanes[peakHour] ?? 0)) peakHour = h;
  });
  return {
    from: stored.from,
    to: stored.to,
    headcount: stores.reduce((s, x) => s + x.headcount, 0),
    headcountByType,
    paidHours: stores.reduce((s, x) => s + x.paidHours, 0),
    cost: costFigure({ level: 'network' }, Math.round(stores.reduce((s, x) => s + x.cost, 0) * 100) / 100),
    peak: { date: stored.peakDay, hour: peakHour, lanesOpen: lanes[peakHour] ?? 0 },
    stores: stores.map((s) => ({
      storeId: s.storeId,
      storeName: s.storeName,
      regionId: s.regionId,
      headcount: s.headcount,
      paidHours: s.paidHours,
      cost: costFigure({ level: 'store', store: { id: s.storeId, regionId: s.regionId } }, s.cost),
      peakLanes: s.peakLanes,
    })),
  };
}

export function listItem(r: planning.ScenarioRecord) {
  return {
    id: r.id,
    name: r.name,
    season: r.season,
    status: r.status,
    isPublished: r.isPublished,
    stale: r.stale,
    staleReasons: r.staleReasons,
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    parentScenarioId: r.parentScenarioId,
    planningFrom: r.planningFrom,
    planningTo: r.planningTo,
    dataAsOf: r.dataAsOf,
    lastRunAt: r.lastRunAt,
    updatedAt: r.updatedAt,
    synthetic: r.synthetic,
  };
}

async function detail(pool: pg.Pool, principal: Principal, id: string) {
  const record = await planning.getScenarioRecord(pool, id);
  if (!record || !visible(principal, record)) throw errors.notFound();
  const [snapshots, ruleVersions, run] = await Promise.all([
    planning.getSnapshotPins(pool, id),
    planning.getRuleVersionPins(pool, id, record.synthetic),
    planning.getLatestRun(pool, id),
  ]);
  return {
    ...listItem(record),
    settings: record.settings,
    snapshots,
    ruleVersions,
    latestRun: run && {
      id: run.id,
      status: run.status,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      errorMessage: run.errorMessage,
      snapshotIds: run.snapshotIds,
      ruleVersionIds: run.ruleVersionIds,
      results: run.results && resultsFor(principal, run.results),
    },
    editable: record.status === 'draft' && can(principal.activeRole, 'scenario_settings', 'edit'),
    submitBlocker: planning.submitBlockerOf(record),
  };
}

async function detailResponse(pool: pg.Pool, principal: Principal, id: string, statusCode = 200): Promise<ApiResponse> {
  return { statusCode, body: { scenario: await detail(pool, principal, id) } };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const SCENARIO_ROUTES: readonly ScenarioRoute[] = [
  {
    method: 'GET',
    path: '/scenarios',
    guard: authorize('scenarios', 'view'),
    handler: async ({ request, principal, pool }) => {
      const q = parseInput(listQuery, request.query, 'query');
      const publishedOnly = principal.activeRole !== null && seesPublishedScenariosOnly(principal.activeRole);
      let statuses: ScenarioStatus[] | undefined = q.status ? [q.status] : undefined;
      if (publishedOnly) statuses = (statuses ?? ['published']).filter((s) => s === 'published');
      const records = await planning.listScenarios(pool, {
        ...(statuses ? { statuses } : {}),
        ...(q.season ? { season: q.season } : {}),
        ...(q.q ? { query: q.q } : {}),
        staleOnly: q.stale === 'true',
      });
      return { statusCode: 200, body: { scenarios: records.map(listItem) } };
    },
  },
  {
    method: 'POST',
    path: '/scenarios',
    guard: authorize('scenario_settings', 'edit'),
    handler: async ({ request, context, principal, pool }) => {
      const body = parseInput(createBody, request.body ?? {}, 'body');
      const settings = settingsOrError(body.settings ?? DEFAULT_SCENARIO_SETTINGS);
      // Default provenance: real data when it has been loaded, else the seeded demo data (P18: never mixed).
      const synthetic = body.synthetic ?? !(await planning.hasCurrentData(pool, false));
      const created = await mutate(pool, principal, context, (tx) =>
        planning.createPinnedScenario(tx, { name: body.name.trim(), season: body.season, settings, synthetic }),
      );
      return detailResponse(pool, principal, created.id, 201);
    },
  },
  {
    // Registered before `/scenarios/:scenarioId` so "compare" is not read as an id.
    method: 'GET',
    path: '/scenarios/compare',
    guard: authorize('scenarios', 'view'),
    handler: async ({ request, principal, pool }) => {
      const q = parseInput(compareQuery, request.query, 'query');
      if (!UUID.test(q.a) || !UUID.test(q.b)) throw errors.notFound();
      const [a, b] = await Promise.all([detail(pool, principal, q.a), detail(pool, principal, q.b)]);
      const viewer = costViewer(principal);
      const shaped = (d: typeof a) =>
        d.latestRun?.results ? shapeCost<ScenarioRunResults>(d.latestRun.results, viewer) : null;
      const types = [...new Set([...a.snapshots, ...b.snapshots].map((s) => s.datasetType))].sort();
      const sets = [...new Set([...a.ruleVersions, ...b.ruleVersions].map((r) => r.ruleSetName))].sort();
      return {
        statusCode: 200,
        body: {
          a,
          b,
          settings: diffScenarioSettings(a.settings, b.settings),
          inputs: {
            snapshots: types.map((t) => ({
              datasetType: t,
              a: a.snapshots.find((s) => s.datasetType === t)?.snapshotId ?? null,
              b: b.snapshots.find((s) => s.datasetType === t)?.snapshotId ?? null,
            })),
            ruleVersions: sets.map((n) => ({
              ruleSetName: n,
              a: a.ruleVersions.find((r) => r.ruleSetName === n)?.version ?? null,
              b: b.ruleVersions.find((r) => r.ruleSetName === n)?.version ?? null,
            })),
          },
          results: compareScenarioResults(shaped(a), shaped(b)),
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/scenarios/:scenarioId',
    guard: authorize('scenarios', 'view'),
    handler: async ({ request, principal, pool }) => detailResponse(pool, principal, idParam(request)),
  },
  {
    method: 'PATCH',
    path: '/scenarios/:scenarioId',
    guard: authorize('scenario_settings', 'edit'),
    handler: async ({ request, context, principal, pool }) => {
      const id = idParam(request);
      const body = parseInput(editBody, request.body ?? {}, 'body');
      const settings = body.settings === undefined ? undefined : settingsOrError(body.settings);
      await mutate(pool, principal, context, (tx) =>
        planning.editScenario(tx, id, {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(settings !== undefined ? { settings } : {}),
        }),
      );
      return detailResponse(pool, principal, id);
    },
  },
  {
    method: 'POST',
    path: '/scenarios/:scenarioId/duplicate',
    guard: authorize('scenario_settings', 'edit'),
    handler: async ({ request, context, principal, pool }) => {
      const id = idParam(request);
      const body = parseInput(duplicateBody, request.body ?? {}, 'body');
      const created = await mutate(pool, principal, context, (tx) =>
        planning.duplicateScenario(tx, id, { ...(body.name ? { name: body.name.trim() } : {}), repin: false }),
      );
      return detailResponse(pool, principal, created.id, 201);
    },
  },
  {
    method: 'POST',
    path: '/scenarios/:scenarioId/refresh',
    guard: authorize('scenario_settings', 'edit'),
    handler: async ({ request, context, principal, pool }) => {
      const id = idParam(request);
      parseInput(emptyBody, request.body ?? {}, 'body');
      const created = await mutate(pool, principal, context, (tx) => planning.duplicateScenario(tx, id, { repin: true }));
      return detailResponse(pool, principal, created.id, 201);
    },
  },
  {
    method: 'POST',
    path: '/scenarios/:scenarioId/run',
    guard: authorize('scenario_settings', 'edit'),
    handler: async ({ request, context, principal, pool }) => {
      const id = idParam(request);
      parseInput(emptyBody, request.body ?? {}, 'body');
      await mutate(pool, principal, context, (tx) => planning.runScenario(tx, id));
      return detailResponse(pool, principal, id, 201);
    },
  },
  {
    method: 'POST',
    path: '/scenarios/:scenarioId/submit',
    guard: authorize('scenario_submit', 'edit'),
    handler: async ({ request, context, principal, pool }) => {
      const id = idParam(request);
      parseInput(emptyBody, request.body ?? {}, 'body');
      await mutate(pool, principal, context, (tx) => planning.submitFreshScenario(tx, id));
      return detailResponse(pool, principal, id);
    },
  },
  {
    method: 'POST',
    path: '/scenarios/:scenarioId/archive',
    guard: authorize('scenario_settings', 'edit'),
    handler: async ({ request, context, principal, pool }) => {
      const id = idParam(request);
      parseInput(emptyBody, request.body ?? {}, 'body');
      await mutate(pool, principal, context, (tx) => planning.archiveScenario(tx, id));
      return detailResponse(pool, principal, id);
    },
  },
];

/** Registers every scenario route behind its declared guard. */
export function registerScenarioRoutes(router: Router, deps: ScenarioRouteDeps): Router {
  for (const route of SCENARIO_ROUTES) {
    router.add(route.method, route.path, route.guard, async (request, context) =>
      route.handler({ request, context, principal: requirePrincipal(context), pool: deps.db() }),
    );
  }
  return router;
}
