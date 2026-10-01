/**
 * Scenario management reads and mutations (task 11; Req 8; P3–P7, P18).
 *
 * Builds on the persistence primitives in `scenarios.ts`: pins the current
 * snapshots and rule versions on create, computes staleness from the pins
 * against what is current now (P5), runs the engine and records each run with
 * exactly the inputs it used (P6), duplicates (optionally re-pinned — the
 * "refresh"), archives. Every mutation records exactly one audit event (P7).
 * The DB triggers from migration 0003 independently enforce the lifecycle,
 * settings frozen outside Draft (P4) and single-published (P3).
 */
import {
  formatStaleReasons,
  readScenarioSettings,
  scenarioStaleness,
  scenarioSubmitBlocker,
  type ScenarioRuleVersionPin,
  type ScenarioRunStatus,
  type ScenarioSettingsValues,
  type ScenarioSnapshotPin,
  type ScenarioStatus,
  type Staleness,
  type StaleReason,
} from '@lanewise/shared';
import type pg from 'pg';
import { EngineInputError, runScenarioEngine, type StoredRunResults } from '../../scenarios/engine.js';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { isoOrNull, queryMaybe, queryOne } from '../rows.js';
import { createScenario, getScenario, ScenarioStateError, submitScenario, type Scenario } from './scenarios.js';

// ---------------------------------------------------------------------------
// Current inputs and staleness
// ---------------------------------------------------------------------------

export interface CurrentInputs {
  /** Current snapshot id per dataset type. */
  readonly snapshots: Record<string, string>;
  /** In-force published rule version id per rule set. */
  readonly ruleVersions: Record<string, string>;
}

export async function currentInputs(db: Queryable, synthetic: boolean): Promise<CurrentInputs> {
  const snaps = await db.query<{ dataset_type: string; id: string }>(
    `SELECT dataset_type, id FROM dataset_snapshot WHERE synthetic = $1 AND superseded_at IS NULL`,
    [synthetic],
  );
  const rules = await db.query<{ rule_set_id: string; id: string }>(
    `SELECT DISTINCT ON (rule_set_id) rule_set_id, id FROM rule_version
      WHERE synthetic = $1 AND status = 'published'
      ORDER BY rule_set_id, effective_from DESC, version DESC`,
    [synthetic],
  );
  return {
    snapshots: Object.fromEntries(snaps.rows.map((r) => [r.dataset_type, r.id])),
    ruleVersions: Object.fromEntries(rules.rows.map((r) => [r.rule_set_id, r.id])),
  };
}

interface PinRows {
  snapshots: { dataset_type: string; snapshot_id: string }[];
  rule_versions: { rule_set_id: string; rule_version_id: string }[];
}

function staleness(row: PinRows & { settings_changed_at: Date; last_run_at: Date | null }, current: CurrentInputs): Staleness {
  return scenarioStaleness({
    pinnedSnapshots: Object.fromEntries(row.snapshots.map((p) => [p.dataset_type, p.snapshot_id])),
    currentSnapshots: current.snapshots,
    pinnedRuleVersions: Object.fromEntries(row.rule_versions.map((p) => [p.rule_set_id, p.rule_version_id])),
    currentRuleVersions: current.ruleVersions,
    settingsChangedAt: row.settings_changed_at.toISOString(),
    lastRunAt: isoOrNull(row.last_run_at),
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface ScenarioListRow extends pg.QueryResultRow, PinRows {
  id: string;
  name: string;
  season: string;
  status: ScenarioStatus;
  owner_id: string;
  owner_name: string;
  parent_scenario_id: string | null;
  settings: Record<string, unknown>;
  settings_changed_at: Date;
  last_run_at: Date | null;
  updated_at: Date;
  synthetic: boolean;
  data_as_of: Date | null;
  has_succeeded_run: boolean;
}

const SELECT_LIST = `
  SELECT s.id, s.name, s.season, s.status, s.owner_id, u.name AS owner_name, s.parent_scenario_id, s.settings,
         s.settings_changed_at, s.last_run_at, s.updated_at, s.synthetic,
         (SELECT d.loaded_at FROM scenario_snapshot p JOIN dataset_snapshot d ON d.id = p.snapshot_id
           WHERE p.scenario_id = s.id AND p.dataset_type = 'pos') AS data_as_of,
         EXISTS (SELECT 1 FROM scenario_run r WHERE r.scenario_id = s.id AND r.run_type = 'network' AND r.status = 'succeeded') AS has_succeeded_run,
         coalesce((SELECT json_agg(json_build_object('dataset_type', p.dataset_type, 'snapshot_id', p.snapshot_id))
                     FROM scenario_snapshot p WHERE p.scenario_id = s.id), '[]') AS snapshots,
         coalesce((SELECT json_agg(json_build_object('rule_set_id', r.rule_set_id, 'rule_version_id', r.rule_version_id))
                     FROM scenario_rule_version r WHERE r.scenario_id = s.id), '[]') AS rule_versions
    FROM scenario s JOIN app_user u ON u.id = s.owner_id`;

export interface ScenarioRecord {
  readonly id: string;
  readonly name: string;
  readonly season: string;
  readonly status: ScenarioStatus;
  readonly isPublished: boolean;
  readonly stale: boolean;
  readonly staleReasons: readonly StaleReason[];
  readonly ownerId: string;
  readonly ownerName: string;
  readonly parentScenarioId: string | null;
  readonly settings: ScenarioSettingsValues;
  readonly planningFrom: string;
  readonly planningTo: string;
  readonly dataAsOf: string | null;
  readonly lastRunAt: string | null;
  readonly updatedAt: string;
  readonly synthetic: boolean;
  readonly hasSucceededRun: boolean;
}

function toRecord(row: ScenarioListRow, current: CurrentInputs): ScenarioRecord {
  const settings = readScenarioSettings(row.settings);
  const live = staleness(row, current);
  return {
    id: row.id,
    name: row.name,
    season: row.season,
    status: row.status,
    isPublished: row.status === 'published',
    stale: live.stale,
    staleReasons: live.reasons,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    parentScenarioId: row.parent_scenario_id,
    settings: { ...settings },
    planningFrom: settings.planningFrom,
    planningTo: settings.planningTo,
    dataAsOf: isoOrNull(row.data_as_of),
    lastRunAt: isoOrNull(row.last_run_at),
    updatedAt: row.updated_at.toISOString(),
    synthetic: row.synthetic,
    hasSucceededRun: row.has_succeeded_run,
  };
}

export interface ScenarioListFilter {
  readonly statuses?: readonly ScenarioStatus[];
  readonly season?: string;
  readonly query?: string;
  readonly staleOnly?: boolean;
}

export async function listScenarios(db: Queryable, filter: ScenarioListFilter): Promise<ScenarioRecord[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filter.statuses) {
    values.push(filter.statuses);
    where.push(`s.status = ANY($${values.length}::text[])`);
  }
  if (filter.season) {
    values.push(filter.season);
    where.push(`s.season = $${values.length}`);
  }
  if (filter.query) {
    values.push(`%${filter.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`s.name ILIKE $${values.length}`);
  }
  const { rows } = await db.query<ScenarioListRow>(
    `${SELECT_LIST} ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.updated_at DESC, s.id LIMIT 500`,
    values,
  );
  const current = { true: await currentInputs(db, true), false: await currentInputs(db, false) };
  const records = rows.map((r) => toRecord(r, current[`${r.synthetic}`]));
  return filter.staleOnly ? records.filter((r) => r.stale) : records;
}

export async function getScenarioRecord(db: Queryable, id: string): Promise<ScenarioRecord | null> {
  const row = await queryMaybe<ScenarioListRow>(db, `${SELECT_LIST} WHERE s.id = $1`, [id]);
  return row && toRecord(row, await currentInputs(db, row.synthetic));
}

export async function getSnapshotPins(db: Queryable, id: string): Promise<ScenarioSnapshotPin[]> {
  const { rows } = await db.query<{ dataset_type: string; snapshot_id: string; loaded_at: Date; superseded_at: Date | null }>(
    `SELECT p.dataset_type, p.snapshot_id, d.loaded_at, d.superseded_at
       FROM scenario_snapshot p JOIN dataset_snapshot d ON d.id = p.snapshot_id
      WHERE p.scenario_id = $1 ORDER BY p.dataset_type`,
    [id],
  );
  return rows.map((r) => ({
    datasetType: r.dataset_type,
    snapshotId: r.snapshot_id,
    loadedAt: r.loaded_at.toISOString(),
    current: r.superseded_at === null,
  }));
}

export async function getRuleVersionPins(db: Queryable, id: string, synthetic: boolean): Promise<ScenarioRuleVersionPin[]> {
  const current = await currentInputs(db, synthetic);
  const { rows } = await db.query<{
    rule_set_id: string;
    name: string;
    rule_set_type: string;
    rule_version_id: string;
    version: number;
    effective_from: string;
  }>(
    `SELECT p.rule_set_id, rs.name, rs.rule_set_type, p.rule_version_id, v.version, v.effective_from::text AS effective_from
       FROM scenario_rule_version p
       JOIN rule_version v ON v.id = p.rule_version_id
       JOIN rule_set rs ON rs.id = p.rule_set_id
      WHERE p.scenario_id = $1 ORDER BY rs.name`,
    [id],
  );
  return rows.map((r) => ({
    ruleSetId: r.rule_set_id,
    ruleSetName: r.name,
    ruleSetType: r.rule_set_type,
    ruleVersionId: r.rule_version_id,
    version: r.version,
    effectiveFrom: r.effective_from,
    current: (current.ruleVersions[r.rule_set_id] ?? r.rule_version_id) === r.rule_version_id,
  }));
}

export interface StoredRun {
  readonly id: string;
  readonly status: ScenarioRunStatus;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly errorMessage: string | null;
  readonly snapshotIds: Readonly<Record<string, string>>;
  readonly ruleVersionIds: readonly string[];
  readonly results: StoredRunResults | null;
}

/** The latest scenario run (network runs only; hiring and roster jobs are task 14 background jobs). */
export async function getLatestRun(db: Queryable, scenarioId: string): Promise<StoredRun | null> {
  const row = await queryMaybe<{
    id: string;
    status: ScenarioRunStatus;
    created_at: Date;
    finished_at: Date | null;
    error_message: string | null;
    snapshots: { dataset_type: string; snapshot_id: string }[];
    rule_version_ids: string[];
    results: StoredRunResults | null;
  }>(
    db,
    `SELECT r.id, r.status, r.created_at, r.finished_at, r.error_message,
            coalesce((SELECT json_agg(json_build_object('dataset_type', x.dataset_type, 'snapshot_id', x.snapshot_id))
                        FROM scenario_run_snapshot x WHERE x.run_id = r.id), '[]') AS snapshots,
            coalesce((SELECT array_agg(x.rule_version_id ORDER BY x.rule_version_id)
                        FROM scenario_run_rule_version x WHERE x.run_id = r.id), '{}') AS rule_version_ids,
            (SELECT res.results FROM scenario_run_result res WHERE res.run_id = r.id) AS results
       FROM scenario_run r WHERE r.scenario_id = $1 AND r.run_type = 'network'
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
    [scenarioId],
  );
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    finishedAt: isoOrNull(row.finished_at),
    errorMessage: row.error_message,
    snapshotIds: Object.fromEntries(row.snapshots.map((s) => [s.dataset_type, s.snapshot_id])),
    ruleVersionIds: row.rule_version_ids,
    results: row.results,
  };
}

export function submitBlockerOf(record: ScenarioRecord) {
  return scenarioSubmitBlocker({ status: record.status, stale: record.stale, hasSucceededRun: record.hasSucceededRun });
}

// ---------------------------------------------------------------------------
// Mutations (each records exactly one audit event, P7)
// ---------------------------------------------------------------------------

/** Writes the live staleness to the stored flag (no audit: derived state). */
async function syncStaleFlag(tx: AuditedTx, id: string): Promise<Staleness> {
  const row = await queryOne<ScenarioListRow>(tx, `${SELECT_LIST} WHERE s.id = $1`, [id]);
  const live = staleness(row, await currentInputs(tx, row.synthetic));
  await tx.query(
    `UPDATE scenario SET stale = $2, stale_reason = $3 WHERE id = $1 AND (stale, coalesce(stale_reason, '')) IS DISTINCT FROM ($2, coalesce($3, ''))`,
    [id, live.stale, formatStaleReasons(live.reasons)],
  );
  return live;
}

async function pinCurrent(tx: AuditedTx, id: string, synthetic: boolean): Promise<void> {
  const current = await currentInputs(tx, synthetic);
  await tx.query('DELETE FROM scenario_snapshot WHERE scenario_id = $1', [id]);
  await tx.query('DELETE FROM scenario_rule_version WHERE scenario_id = $1', [id]);
  await tx.query(
    `INSERT INTO scenario_snapshot (scenario_id, dataset_type, snapshot_id, synthetic)
     SELECT $1, d.dataset_type, d.id, $3 FROM dataset_snapshot d WHERE d.id = ANY($2::uuid[])`,
    [id, Object.values(current.snapshots), synthetic],
  );
  await tx.query(
    `INSERT INTO scenario_rule_version (scenario_id, rule_set_id, rule_version_id, synthetic)
     SELECT $1, v.rule_set_id, v.id, $3 FROM rule_version v WHERE v.id = ANY($2::uuid[])`,
    [id, Object.values(current.ruleVersions), synthetic],
  );
}

/** Whether every dataset type has a current snapshot of this provenance. */
export async function hasCurrentData(db: Queryable, synthetic: boolean): Promise<boolean> {
  return Object.keys((await currentInputs(db, synthetic)).snapshots).includes('pos');
}

/** Creates a Draft pinned to the current snapshots and rule versions (Req 8.1). */
export async function createPinnedScenario(
  tx: AuditedTx,
  input: { name: string; season: string; settings: ScenarioSettingsValues; synthetic: boolean; parentScenarioId?: string },
): Promise<Scenario> {
  const current = await currentInputs(tx, input.synthetic);
  return createScenario(tx, {
    name: input.name,
    season: input.season,
    settings: { ...input.settings },
    snapshotIds: Object.values(current.snapshots),
    ruleVersionIds: Object.values(current.ruleVersions),
    synthetic: input.synthetic,
    ...(input.parentScenarioId ? { parentScenarioId: input.parentScenarioId } : {}),
  });
}

/**
 * "Duplicate as draft": same settings and pins as the source, or — `repin`,
 * the stale "refresh" — pinned to the current data and rules instead.
 */
export async function duplicateScenario(
  tx: AuditedTx,
  sourceId: string,
  options: { name?: string; repin: boolean },
): Promise<Scenario> {
  const source = await getScenario(tx, sourceId);
  if (!source) throw new ScenarioStateError('scenario not found');
  const settings = readScenarioSettings(source.settings);
  const name = options.name ?? `${source.name} (copy)`;
  if (options.repin) {
    return createPinnedScenario(tx, {
      name,
      season: source.season,
      settings,
      synthetic: source.synthetic,
      parentScenarioId: source.id,
    });
  }
  return createScenario(tx, {
    name,
    season: source.season,
    settings: { ...settings },
    snapshotIds: Object.values(source.snapshotIds),
    ruleVersionIds: source.ruleVersionIds,
    synthetic: source.synthetic,
    parentScenarioId: source.id,
  });
}

/** Edits a Draft's name and/or settings (P4: the DB refuses outside Draft). */
export async function editScenario(
  tx: AuditedTx,
  id: string,
  patch: { name?: string; settings?: ScenarioSettingsValues },
): Promise<void> {
  const before = await getScenario(tx, id);
  if (!before) throw new ScenarioStateError('scenario not found');
  if (before.status !== 'draft') throw new ScenarioStateError(`a ${before.status} scenario is read-only; duplicate it as a draft`);
  await tx.query('SELECT id FROM scenario WHERE id = $1 FOR UPDATE', [id]);
  if (patch.settings !== undefined) {
    await tx.query('UPDATE scenario SET settings = $2 WHERE id = $1 AND settings IS DISTINCT FROM $2::jsonb', [
      id,
      JSON.stringify(patch.settings),
    ]);
  }
  if (patch.name !== undefined) await tx.query('UPDATE scenario SET name = $2 WHERE id = $1', [id, patch.name]);
  await syncStaleFlag(tx, id);
  const after = await getScenario(tx, id);
  await audit.record(tx, {
    action: 'edit',
    event: 'scenario.settings_edited',
    objectType: 'scenario',
    objectId: id,
    before: { name: before.name, settings: before.settings },
    after: { name: after?.name ?? null, settings: after?.settings ?? null },
    synthetic: before.synthetic,
  });
}

export async function archiveScenario(tx: AuditedTx, id: string): Promise<void> {
  const before = await getScenario(tx, id);
  if (!before) throw new ScenarioStateError('scenario not found');
  await tx.query(`UPDATE scenario SET status = 'archived' WHERE id = $1`, [id]);
  await audit.record(tx, {
    action: 'edit',
    event: 'scenario.archived',
    objectType: 'scenario',
    objectId: id,
    before: { status: before.status },
    after: { status: 'archived' },
    synthetic: before.synthetic,
  });
}

/** Submits a fresh, run Draft (P5: stale or never-run scenarios cannot be submitted). */
export async function submitFreshScenario(tx: AuditedTx, id: string): Promise<void> {
  await tx.query('SELECT id FROM scenario WHERE id = $1 FOR UPDATE', [id]);
  await syncStaleFlag(tx, id);
  const record = await getScenarioRecord(tx, id);
  if (!record) throw new ScenarioStateError('scenario not found');
  const blocker = submitBlockerOf(record);
  if (blocker === 'stale') throw new ScenarioStateError('This scenario is stale. Recalculate it before submitting.');
  if (blocker === 'not_run') throw new ScenarioStateError('Run this scenario before submitting it.');
  if (blocker === 'not_draft') throw new ScenarioStateError(`A ${record.status} scenario cannot be submitted.`);
  await submitScenario(tx, id);
}

/**
 * Recalculate: re-pins a Draft to the current snapshots and rule versions,
 * runs the engine and records the run with exactly the pins it used (P6).
 * An engine refusal is recorded as a failed run with its reason.
 */
export async function runScenario(tx: AuditedTx, id: string): Promise<{ runId: string; status: ScenarioRunStatus }> {
  await tx.query('SELECT id FROM scenario WHERE id = $1 FOR UPDATE', [id]);
  const scenario = await getScenario(tx, id);
  if (!scenario) throw new ScenarioStateError('scenario not found');
  if (scenario.status !== 'draft') throw new ScenarioStateError(`A ${scenario.status} scenario is read-only; duplicate it as a draft to recalculate.`);
  const before = { snapshotIds: scenario.snapshotIds, ruleVersionIds: scenario.ruleVersionIds };
  await pinCurrent(tx, id, scenario.synthetic);

  const snapshots = await tx.query<{ dataset_type: string; snapshot_id: string; storage_key: string | null; synthetic: boolean }>(
    `SELECT p.dataset_type, p.snapshot_id, d.storage_key, d.synthetic
       FROM scenario_snapshot p JOIN dataset_snapshot d ON d.id = p.snapshot_id WHERE p.scenario_id = $1`,
    [id],
  );
  const rules = await tx.query<{ rule_set_id: string; rule_version_id: string; rule_set_type: string; effective_from: string; payload: Record<string, unknown> }>(
    `SELECT p.rule_set_id, p.rule_version_id, rs.rule_set_type, v.effective_from::text AS effective_from, v.payload
       FROM scenario_rule_version p JOIN rule_version v ON v.id = p.rule_version_id JOIN rule_set rs ON rs.id = p.rule_set_id
      WHERE p.scenario_id = $1`,
    [id],
  );
  const stores = await tx.query<{ id: string; name: string; region_id: string; code: string }>(
    `SELECT id, name, region_id, code FROM store WHERE synthetic = $1`,
    [scenario.synthetic],
  );
  // Demo stores are seeded with code DEMO-<DOMAIN-ID> (task 23).
  const byCode = new Map(stores.rows.map((s) => [s.code, s]));

  let results: StoredRunResults | null = null;
  let error: string | null = null;
  try {
    results = runScenarioEngine({
      settings: readScenarioSettings(scenario.settings),
      snapshots: snapshots.rows.map((s) => ({
        datasetType: s.dataset_type,
        snapshotId: s.snapshot_id,
        storageKey: s.storage_key,
        synthetic: s.synthetic,
      })),
      ruleVersions: rules.rows.map((r) => ({
        ruleVersionId: r.rule_version_id,
        ruleSetType: r.rule_set_type,
        effectiveFrom: r.effective_from,
        payload: r.payload,
      })),
      storeFor: (domainId) => {
        const row = byCode.get(`DEMO-${domainId.toUpperCase()}`);
        return row ? { id: row.id, name: row.name, regionId: row.region_id } : null;
      },
    });
  } catch (e) {
    if (!(e instanceof EngineInputError)) throw e;
    error = e.message;
  }

  const run = await queryOne<{ id: string }>(
    tx,
    `INSERT INTO scenario_run (scenario_id, run_type, status, progress, results_ref, error_message, requested_by, synthetic,
                               started_at, finished_at)
     VALUES ($1, 'network', $2, $3, NULL, $4, $5, $6, now(), now()) RETURNING id`,
    [id, results ? 'running' : 'failed', results ? 0 : 1, error, tx.actor.userId, scenario.synthetic],
  );
  await tx.query(
    `INSERT INTO scenario_run_snapshot (run_id, dataset_type, snapshot_id, synthetic)
     SELECT $1, dataset_type, snapshot_id, synthetic FROM scenario_snapshot WHERE scenario_id = $2`,
    [run.id, id],
  );
  await tx.query(
    `INSERT INTO scenario_run_rule_version (run_id, rule_set_id, rule_version_id, synthetic)
     SELECT $1, rule_set_id, rule_version_id, synthetic FROM scenario_rule_version WHERE scenario_id = $2`,
    [run.id, id],
  );
  if (results) {
    await tx.query(`INSERT INTO scenario_run_result (run_id, synthetic, results) VALUES ($1, $2, $3)`, [
      run.id,
      scenario.synthetic,
      JSON.stringify(results),
    ]);
    await tx.query(
      `UPDATE scenario_run SET status = 'succeeded', progress = 1, results_ref = $2 WHERE id = $1`,
      [run.id, `db:scenario_run_result/${run.id}`],
    );
    await tx.query('UPDATE scenario SET last_run_at = now() WHERE id = $1', [id]);
  }
  await syncStaleFlag(tx, id);
  const after = await getScenario(tx, id);
  await audit.record(tx, {
    action: 'edit',
    event: results ? 'scenario.run_succeeded' : 'scenario.run_failed',
    objectType: 'scenario',
    objectId: id,
    before,
    after: {
      runId: run.id,
      snapshotIds: after?.snapshotIds ?? {},
      ruleVersionIds: after?.ruleVersionIds ?? [],
      error,
    },
    synthetic: scenario.synthetic,
  });
  return { runId: run.id, status: results ? 'succeeded' : 'failed' };
}
