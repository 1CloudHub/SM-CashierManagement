/**
 * The inputs behind the planning views and jobs (task 14; P6, P18).
 *
 * Every figure on the network view, department plan, hiring plan and
 * leadership summary is computed by `@lanewise/domain` from exactly the
 * snapshots and rule versions a scenario run pinned, and carries those ids as
 * its provenance. The org lookup maps engine store/department ids to the
 * database rows of the same provenance (seeded demo stores have code
 * `DEMO-<ID>`, task 23).
 */
import {
  planDepartmentDay,
  planNetworkDay,
  type DepartmentDayPlan,
  type NetworkDayPlan,
  type PlanningContext,
} from '@lanewise/domain';
import type { PlanningProvenance, ScenarioSettingsValues } from '@lanewise/shared';
import type { Queryable } from '../db/pool.js';
import * as planning from '../db/repositories/scenario-planning.js';
import { planningContextFor, type PinnedRuleVersion, type PinnedSnapshot } from '../scenarios/engine.js';

export interface OrgStore {
  readonly id: string;
  readonly name: string;
  readonly regionId: string;
  readonly format: string;
}

export interface OrgDepartment {
  readonly id: string;
  readonly name: string;
  readonly store: OrgStore;
  readonly installedLanes: number;
}

/** Engine ids → database rows of the run's provenance. */
export interface OrgLookup {
  readonly storeFor: (domainStoreId: string) => OrgStore | null;
  readonly departmentFor: (domainDepartmentId: string) => OrgDepartment | null;
  /** Database department id → engine department id. */
  readonly domainDepartmentId: (departmentId: string) => string | null;
}

export interface RunInputs {
  readonly runId: string;
  readonly runAt: string;
  readonly snapshots: readonly PinnedSnapshot[];
  readonly ruleVersions: readonly PinnedRuleVersion[];
}

export interface PlanningBasis {
  readonly scenario: planning.ScenarioRecord;
  /** The latest succeeded network run, whose pins every view uses (`null`: never run). */
  readonly run: RunInputs | null;
  readonly orgRows: OrgRows;
}

export async function loadRunInputs(db: Queryable, runId: string): Promise<Omit<RunInputs, 'runAt'>> {
  const snaps = await db.query<{ dataset_type: string; snapshot_id: string; storage_key: string | null; synthetic: boolean }>(
    `SELECT x.dataset_type, x.snapshot_id, d.storage_key, d.synthetic
       FROM scenario_run_snapshot x JOIN dataset_snapshot d ON d.id = x.snapshot_id
      WHERE x.run_id = $1 ORDER BY x.dataset_type`,
    [runId],
  );
  const rules = await db.query<{ rule_version_id: string; rule_set_type: string; effective_from: string; payload: Record<string, unknown> }>(
    `SELECT x.rule_version_id, rs.rule_set_type, v.effective_from::text AS effective_from, v.payload
       FROM scenario_run_rule_version x
       JOIN rule_version v ON v.id = x.rule_version_id
       JOIN rule_set rs ON rs.id = x.rule_set_id
      WHERE x.run_id = $1 ORDER BY x.rule_version_id`,
    [runId],
  );
  return {
    runId,
    snapshots: snaps.rows.map((s) => ({ datasetType: s.dataset_type, snapshotId: s.snapshot_id, storageKey: s.storage_key, synthetic: s.synthetic })),
    ruleVersions: rules.rows.map((r) => ({
      ruleVersionId: r.rule_version_id,
      ruleSetType: r.rule_set_type,
      effectiveFrom: r.effective_from,
      payload: r.payload,
    })),
  };
}

export interface OrgRows {
  readonly stores: readonly { id: string; name: string; region_id: string; format: string; code: string }[];
  readonly departments: readonly { id: string; name: string; store_id: string; installed_lanes: number }[];
}

export async function loadOrgRows(db: Queryable, synthetic: boolean): Promise<OrgRows> {
  const stores = await db.query<OrgRows['stores'][number]>(
    'SELECT id, name, region_id, format, code FROM store WHERE synthetic = $1',
    [synthetic],
  );
  const departments = await db.query<OrgRows['departments'][number]>(
    'SELECT id, name, store_id, installed_lanes FROM department WHERE synthetic = $1',
    [synthetic],
  );
  return { stores: stores.rows, departments: departments.rows };
}

/**
 * Joins the engine's stores/departments to the database rows: stores by the
 * seeded code `DEMO-<ID>`, departments by (store, name), which is unique.
 */
export function orgLookup(rows: OrgRows, ctx: Pick<PlanningContext, 'departments'>): OrgLookup {
  const byCode = new Map(
    rows.stores.map((s) => [s.code, { id: s.id, name: s.name, regionId: s.region_id, format: s.format } satisfies OrgStore]),
  );
  const storeFor = (domainStoreId: string): OrgStore | null => byCode.get(`DEMO-${domainStoreId.toUpperCase()}`) ?? null;
  const deptByStoreName = new Map(rows.departments.map((d) => [`${d.store_id}|${d.name}`, d]));
  const departments = new Map<string, OrgDepartment>();
  const reverse = new Map<string, string>();
  for (const d of ctx.departments) {
    const store = storeFor(d.storeId);
    const row = store ? deptByStoreName.get(`${store.id}|${d.name}`) : undefined;
    if (!store || !row) continue;
    departments.set(d.id, { id: row.id, name: row.name, store, installedLanes: row.installed_lanes });
    reverse.set(row.id, d.id);
  }
  return {
    storeFor,
    departmentFor: (domainDepartmentId) => departments.get(domainDepartmentId) ?? null,
    domainDepartmentId: (departmentId) => reverse.get(departmentId) ?? null,
  };
}

export async function latestSucceededRun(db: Queryable, scenarioId: string, runType: 'network' | 'hiring' | 'roster'): Promise<{ id: string; at: string } | null> {
  const { rows } = await db.query<{ id: string; at: Date }>(
    `SELECT id, coalesce(finished_at, created_at) AS at FROM scenario_run
      WHERE scenario_id = $1 AND run_type = $2 AND status = 'succeeded'
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [scenarioId, runType],
  );
  const row = rows[0];
  return row ? { id: row.id, at: row.at.toISOString() } : null;
}

/** Loads the scenario, its latest succeeded run's pins and the org lookup (`null`: no such scenario). */
export async function loadPlanningBasis(db: Queryable, scenarioId: string): Promise<PlanningBasis | null> {
  const scenario = await planning.getScenarioRecord(db, scenarioId);
  if (!scenario) return null;
  const latest = await latestSucceededRun(db, scenarioId, 'network');
  const run = latest ? { ...(await loadRunInputs(db, latest.id)), runAt: latest.at } : null;
  return { scenario, run, orgRows: await loadOrgRows(db, scenario.synthetic) };
}

export function provenanceOf(
  scenario: planning.ScenarioRecord,
  run: Pick<RunInputs, 'runId' | 'snapshots' | 'ruleVersions'> & { readonly runAt: string | null } | null,
  extraStale = false,
): PlanningProvenance {
  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    scenarioStatus: scenario.status,
    runId: run?.runId ?? null,
    runAt: run?.runAt ?? null,
    snapshotIds: Object.fromEntries((run?.snapshots ?? []).map((s) => [s.datasetType, s.snapshotId])),
    ruleVersionIds: (run?.ruleVersions ?? []).map((r) => r.ruleVersionId).sort(),
    synthetic: scenario.synthetic,
    stale: scenario.stale || extraStale,
  };
}

// ---------------------------------------------------------------------------
// Engine contexts and day plans, memoised per run (views must feel immediate)
// ---------------------------------------------------------------------------

const CONTEXTS = new Map<string, PlanningContext>();
const DAYS = new Map<string, NetworkDayPlan>();
const MAX_CONTEXTS = 4;
const MAX_DAYS = 24;

function remember<V>(cache: Map<string, V>, max: number, key: string, make: () => V): V {
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const value = make();
  cache.set(key, value);
  while (cache.size > max) cache.delete(cache.keys().next().value as string);
  return value;
}

function contextKey(runId: string, settings: Pick<ScenarioSettingsValues, 'growth' | 'allowPartTime'>): string {
  return `${runId}|${settings.growth}|${settings.allowPartTime}`;
}

/** The engine context for a run's pins and the given settings (memoised; results are immutable, P6). */
export function contextForRun(run: Omit<RunInputs, 'runAt'>, settings: Pick<ScenarioSettingsValues, 'growth' | 'allowPartTime'>): PlanningContext {
  return remember(CONTEXTS, MAX_CONTEXTS, contextKey(run.runId, settings), () =>
    planningContextFor({ settings, snapshots: run.snapshots, ruleVersions: run.ruleVersions }),
  );
}

/** All departments planned for one date with the same function the single-department view uses (P2). */
export function networkDayFor(run: Omit<RunInputs, 'runAt'>, settings: Pick<ScenarioSettingsValues, 'growth' | 'allowPartTime'>, date: string): NetworkDayPlan {
  const ctx = contextForRun(run, settings);
  return remember(DAYS, MAX_DAYS, `${contextKey(run.runId, settings)}|${date}`, () => planNetworkDay(ctx, date));
}

/**
 * One department planned on its own (`planDepartmentDay`), independently of
 * the network view; P2 requires the two to agree, and the route tests check it.
 */
export function departmentDayFor(
  run: Omit<RunInputs, 'runAt'>,
  settings: Pick<ScenarioSettingsValues, 'growth' | 'allowPartTime'>,
  domainDepartmentId: string,
  date: string,
): DepartmentDayPlan {
  return planDepartmentDay(contextForRun(run, settings), domainDepartmentId, date);
}
