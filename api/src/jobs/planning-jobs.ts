/**
 * Background planning jobs: request, status and processing (task 14.2; Req
 * 10.1, 10.2; NFR-REL-001/002; P6, P7, P18).
 *
 *  - **Cached per scenario version.** A job's `idempotency_key` hashes its
 *    type, the scenario's settings and pinned inputs and its parameters; a
 *    request for the same version returns the queued, running or finished
 *    job instead of starting another.
 *  - **Reproducible.** The job pins exactly the scenario's snapshots and rule
 *    versions when requested (P6) and stores the settings it used.
 *  - **Resumable and idempotent.** Each department is a checkpointed unit; a
 *    redelivered message skips finished units, and a finished job is never
 *    processed again.
 *  - **Audited and notified.** The request writes one audit event (P7); the
 *    requester is notified when the job finishes or fails (Req 10.2).
 */
import { createHash } from 'node:crypto';
import { CONTRACT_TYPES, type ContractType, type StaffMember } from '@lanewise/domain';
import {
  readScenarioSettings,
  type PlanningJob,
  type PlanningJobStatus,
  type PlanningJobType,
  type ScenarioSettingsValues,
} from '@lanewise/shared';
import type pg from 'pg';
import { audit, type AuditedTx } from '../db/audit.js';
import { withTransaction, type Queryable } from '../db/pool.js';
import type { ScenarioRecord } from '../db/repositories/scenario-planning.js';
import { isoOrNull, queryMaybe, queryOne } from '../db/rows.js';
import { loadOrgRows, loadRunInputs, orgLookup } from '../planning/basis.js';
import { EngineInputError, planningContextFor } from '../scenarios/engine.js';
import { hiringUnit, rosterUnit, type HiringUnitResult, type RosterUnitResult, type StoredHiringResults, type StoredRosterResults } from './units.js';

export const RUN_TYPE: Readonly<Record<PlanningJobType, 'hiring' | 'roster'>> = { hiring_plan: 'hiring', long_roster: 'roster' };
const JOB_TYPE: Readonly<Record<string, PlanningJobType>> = { hiring: 'hiring_plan', roster: 'long_roster' };

export interface JobParams {
  readonly settings: ScenarioSettingsValues;
  readonly from: string;
  readonly to: string;
  /** Long rosters may be limited to one department (database id). */
  readonly departmentId?: string;
}

interface JobRow extends pg.QueryResultRow {
  id: string;
  scenario_id: string;
  run_type: string;
  status: PlanningJobStatus;
  progress: string;
  units_done: number;
  units_total: number;
  params: JobParams;
  error_message: string | null;
  requested_by: string;
  synthetic: boolean;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

const JOB_COLUMNS = `id, scenario_id, run_type, status, progress, units_done, units_total, params, error_message,
  requested_by, synthetic, created_at, started_at, finished_at`;

function toJob(row: JobRow): PlanningJob {
  return {
    id: row.id,
    type: JOB_TYPE[row.run_type] ?? 'hiring_plan',
    scenarioId: row.scenario_id,
    status: row.status,
    progress: Number(row.progress),
    unitsDone: row.units_done,
    unitsTotal: row.units_total,
    createdAt: row.created_at.toISOString(),
    startedAt: isoOrNull(row.started_at),
    finishedAt: isoOrNull(row.finished_at),
    errorMessage: row.error_message,
    from: row.params.from ?? null,
    to: row.params.to ?? null,
  };
}

/** The pins a job would use now: the scenario's own snapshot and rule-version pins. */
async function scenarioPins(db: Queryable, scenarioId: string): Promise<{ snapshots: string[]; ruleVersions: string[] }> {
  const s = await db.query<{ snapshot_id: string }>('SELECT snapshot_id FROM scenario_snapshot WHERE scenario_id = $1 ORDER BY snapshot_id', [scenarioId]);
  const r = await db.query<{ rule_version_id: string }>(
    'SELECT rule_version_id FROM scenario_rule_version WHERE scenario_id = $1 ORDER BY rule_version_id',
    [scenarioId],
  );
  return { snapshots: s.rows.map((x) => x.snapshot_id), ruleVersions: r.rows.map((x) => x.rule_version_id) };
}

/** The cache key of a job for the scenario's current version (settings + pins + parameters). */
export async function jobKey(db: Queryable, type: PlanningJobType, scenario: ScenarioRecord, params: JobParams): Promise<string> {
  const pins = await scenarioPins(db, scenario.id);
  const digest = createHash('sha256')
    .update(JSON.stringify({ type, scenario: scenario.id, settings: params.settings, pins, from: params.from, to: params.to, dept: params.departmentId ?? null }))
    .digest('hex');
  return `${type}:${scenario.id}:${digest.slice(0, 32)}`;
}

export async function findJobByKey(db: Queryable, key: string): Promise<PlanningJob | null> {
  const row = await queryMaybe<JobRow>(db, `SELECT ${JOB_COLUMNS} FROM scenario_run WHERE idempotency_key = $1`, [key]);
  return row ? toJob(row) : null;
}

export async function getJob(db: Queryable, scenarioId: string, jobId: string, type: PlanningJobType): Promise<PlanningJob | null> {
  const row = await queryMaybe<JobRow>(
    db,
    `SELECT ${JOB_COLUMNS} FROM scenario_run WHERE id = $1 AND scenario_id = $2 AND run_type = $3`,
    [jobId, scenarioId, RUN_TYPE[type]],
  );
  return row ? toJob(row) : null;
}

/** The newest job of a type for a scenario (any status). */
export async function latestJob(db: Queryable, scenarioId: string, type: PlanningJobType): Promise<PlanningJob | null> {
  const row = await queryMaybe<JobRow>(
    db,
    `SELECT ${JOB_COLUMNS} FROM scenario_run WHERE scenario_id = $1 AND run_type = $2 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [scenarioId, RUN_TYPE[type]],
  );
  return row ? toJob(row) : null;
}

/** The newest succeeded job of a type, with its stored results and cache key. */
export async function latestSucceededJob<R>(
  db: Queryable,
  scenarioId: string,
  type: PlanningJobType,
): Promise<{ job: PlanningJob; key: string | null; results: R; params: JobParams } | null> {
  const row = await queryMaybe<JobRow & { idempotency_key: string | null; results: R }>(
    db,
    `SELECT ${JOB_COLUMNS.split(', ').map((c) => `r.${c.trim()}`).join(', ')}, r.idempotency_key, res.results
       FROM scenario_run r JOIN scenario_run_result res ON res.run_id = r.id
      WHERE r.scenario_id = $1 AND r.run_type = $2 AND r.status = 'succeeded'
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
    [scenarioId, RUN_TYPE[type]],
  );
  return row ? { job: toJob(row), key: row.idempotency_key, results: row.results, params: row.params } : null;
}

/**
 * Creates a queued job pinned to the scenario's current snapshots and rule
 * versions, with one audit event (P6, P7). The caller has checked the cache.
 */
export async function createJob(
  tx: AuditedTx,
  input: { type: PlanningJobType; scenario: ScenarioRecord; params: JobParams; key: string },
): Promise<PlanningJob> {
  const { scenario, params, type } = input;
  const row = await queryOne<JobRow>(
    tx,
    `INSERT INTO scenario_run (scenario_id, run_type, status, progress, idempotency_key, requested_by, synthetic, params)
     VALUES ($1, $2, 'queued', 0, $3, $4, $5, $6) RETURNING ${JOB_COLUMNS}`,
    [scenario.id, RUN_TYPE[type], input.key, tx.actor.userId, scenario.synthetic, JSON.stringify(params)],
  );
  await tx.query(
    `INSERT INTO scenario_run_snapshot (run_id, dataset_type, snapshot_id, synthetic)
     SELECT $1, dataset_type, snapshot_id, synthetic FROM scenario_snapshot WHERE scenario_id = $2`,
    [row.id, scenario.id],
  );
  await tx.query(
    `INSERT INTO scenario_run_rule_version (run_id, rule_set_id, rule_version_id, synthetic)
     SELECT $1, rule_set_id, rule_version_id, synthetic FROM scenario_rule_version WHERE scenario_id = $2`,
    [row.id, scenario.id],
  );
  await audit.record(tx, {
    action: 'create',
    event: 'planning_job.requested',
    objectType: 'scenario',
    objectId: scenario.id,
    after: { jobId: row.id, type, from: params.from, to: params.to, departmentId: params.departmentId ?? null },
    synthetic: scenario.synthetic,
  });
  return toJob(row);
}

/**
 * Unfinished jobs older than this are treated as lost (worker timeouts ×
 * retries are far shorter), so a dead-lettered job never blocks a new request.
 */
export const STUCK_JOB_MS = 60 * 60 * 1000;

export function isStuck(job: Pick<PlanningJob, 'status' | 'createdAt'>, now: Date): boolean {
  return (job.status === 'queued' || job.status === 'running') && now.getTime() - Date.parse(job.createdAt) > STUCK_JOB_MS;
}

/** Marks a job failed with a reason and frees its cache key so it can be requested again. */
export async function failJob(db: Queryable, jobId: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE scenario_run SET status = 'failed', error_message = $2, finished_at = now(), idempotency_key = NULL
      WHERE id = $1 AND status IN ('queued', 'running')`,
    [jobId, reason],
  );
  await notify(db, jobId, 'planning_job.failed', 'warning');
}

async function notify(db: Queryable, jobId: string, event: string, severity: 'info' | 'warning'): Promise<void> {
  await db.query(
    `INSERT INTO notification (user_id, event, object_type, object_id, severity, params, synthetic)
     SELECT r.requested_by, $2, 'scenario', r.scenario_id::text, $3,
            jsonb_build_object('jobId', r.id, 'jobType', r.run_type, 'scenarioName', s.name), r.synthetic
       FROM scenario_run r JOIN scenario s ON s.id = r.scenario_id WHERE r.id = $1`,
    [jobId, event, severity],
  );
}

// ---------------------------------------------------------------------------
// Processing (the worker; also the in-process fallback)
// ---------------------------------------------------------------------------

export type ProcessOutcome = 'succeeded' | 'failed' | 'skipped';

async function baselineCounts(db: Queryable, synthetic: boolean): Promise<Map<string, Record<ContractType, number>>> {
  const { rows } = await db.query<{ department_id: string; contract_type: string; n: number }>(
    `SELECT department_id,
            coalesce(weekly_pattern->>'contractType',
                     CASE employment_type WHEN 'part_time' THEN 'PT' WHEN 'seasonal' THEN 'FLOAT' ELSE 'FT' END) AS contract_type,
            count(*)::int AS n
       FROM staff WHERE active AND synthetic = $1 GROUP BY 1, 2`,
    [synthetic],
  );
  const out = new Map<string, Record<ContractType, number>>();
  for (const r of rows) {
    const cur = out.get(r.department_id) ?? { FT: 0, PT: 0, FLOAT: 0 };
    if ((CONTRACT_TYPES as readonly string[]).includes(r.contract_type)) cur[r.contract_type as ContractType] += r.n;
    out.set(r.department_id, cur);
  }
  return out;
}

async function staffFor(db: Queryable, departmentId: string, domainDepartmentId: string, from: string, to: string): Promise<StaffMember[]> {
  const { rows } = await db.query<{ id: string; name: string; store_id: string; contract_type: string; rest: number | null; off: string[] }>(
    `SELECT s.id, s.name, s.store_id,
            coalesce(s.weekly_pattern->>'contractType',
                     CASE s.employment_type WHEN 'part_time' THEN 'PT' WHEN 'seasonal' THEN 'FLOAT' ELSE 'FT' END) AS contract_type,
            s.preferred_rest_day AS rest,
            coalesce((SELECT array_agg(DISTINCT d::date::text ORDER BY d::date::text)
                        FROM staff_availability a,
                             generate_series(a.starts_at::date, (a.ends_at - interval '1 second')::date, interval '1 day') d
                       WHERE a.staff_id = s.id AND a.kind = 'unavailable'
                         AND a.ends_at > $2::date AND a.starts_at < ($3::date + 1)), '{}') AS off
       FROM staff s WHERE s.department_id = $1 AND s.active ORDER BY s.id`,
    [departmentId, from, to],
  );
  return rows
    .filter((r) => (CONTRACT_TYPES as readonly string[]).includes(r.contract_type))
    .map((r) => ({
      id: r.id,
      name: r.name,
      storeId: r.store_id,
      departmentId: domainDepartmentId,
      contractType: r.contract_type as ContractType,
      preferredRestDay: r.rest ?? 0,
      unavailableDates: r.off,
    }));
}

/**
 * Processes one job: claims it, plans every department not yet checkpointed,
 * then stores the merged result and notifies the requester. Safe to call
 * again for the same job at any point (SQS redelivery, duplicate messages).
 * Unexpected errors are rethrown so the queue retries (resuming from the
 * checkpoints) and finally dead-letters the message.
 */
export async function processPlanningJob(pool: pg.Pool, jobId: string): Promise<ProcessOutcome> {
  const claimed = await queryMaybe<JobRow>(
    pool,
    `UPDATE scenario_run SET status = 'running', started_at = coalesce(started_at, now())
      WHERE id = $1 AND status IN ('queued', 'running') AND run_type IN ('hiring', 'roster')
      RETURNING ${JOB_COLUMNS}`,
    [jobId],
  );
  if (!claimed) return 'skipped';
  const params = claimed.params;
  const settings = readScenarioSettings(params.settings);

  const inputs = await loadRunInputs(pool, jobId);
  let ctx;
  try {
    ctx = planningContextFor({ settings, snapshots: inputs.snapshots, ruleVersions: inputs.ruleVersions });
  } catch (error) {
    if (!(error instanceof EngineInputError)) throw error;
    await failJob(pool, jobId, error.message);
    return 'failed';
  }
  const org = orgLookup(await loadOrgRows(pool, claimed.synthetic), ctx);
  const units = ctx.departments
    .map((d) => ({ domainId: d.id, dept: org.departmentFor(d.id) }))
    .filter((u): u is { domainId: string; dept: NonNullable<typeof u.dept> } => u.dept !== null)
    .filter((u) => !params.departmentId || u.dept.id === params.departmentId)
    .sort((a, b) => (a.dept.id < b.dept.id ? -1 : 1));
  if (units.length === 0) {
    await failJob(pool, jobId, 'No departments in this scenario match the job.');
    return 'failed';
  }
  await pool.query('UPDATE scenario_run SET units_total = $2 WHERE id = $1', [jobId, units.length]);

  const done = new Set(
    (await pool.query<{ unit_key: string }>('SELECT unit_key FROM scenario_run_checkpoint WHERE run_id = $1', [jobId])).rows.map((r) => r.unit_key),
  );
  const baseline = claimed.run_type === 'hiring' ? await baselineCounts(pool, claimed.synthetic) : null;
  for (const unit of units) {
    if (done.has(unit.dept.id)) continue;
    const result =
      claimed.run_type === 'hiring'
        ? hiringUnit(ctx, unit.domainId, unit.dept, baseline?.get(unit.dept.id) ?? { FT: 0, PT: 0, FLOAT: 0 }, params.from, params.to)
        : rosterUnit(ctx, unit.domainId, unit.dept, await staffFor(pool, unit.dept.id, unit.domainId, params.from, params.to), params.from, params.to);
    await pool.query(
      `INSERT INTO scenario_run_checkpoint (run_id, unit_key, synthetic, result) VALUES ($1, $2, $3, $4)
       ON CONFLICT (run_id, unit_key) DO NOTHING`,
      [jobId, unit.dept.id, claimed.synthetic, JSON.stringify(result)],
    );
    await pool.query(
      `UPDATE scenario_run SET units_done = n, progress = round(n::numeric / $2 * 0.99, 4)
         FROM (SELECT count(*)::int AS n FROM scenario_run_checkpoint WHERE run_id = $1) c
        WHERE id = $1 AND status = 'running'`,
      [jobId, units.length],
    );
  }

  return withTransaction(pool, async (tx) => {
    const locked = await queryMaybe<{ status: string }>(tx, 'SELECT status FROM scenario_run WHERE id = $1 FOR UPDATE', [jobId]);
    if (locked?.status !== 'running') return 'skipped';
    const checkpoints = await tx.query<{ result: HiringUnitResult & RosterUnitResult }>(
      'SELECT result FROM scenario_run_checkpoint WHERE run_id = $1 ORDER BY unit_key',
      [jobId],
    );
    const departments = checkpoints.rows.map((r) => r.result);
    const results: StoredHiringResults | StoredRosterResults =
      claimed.run_type === 'hiring'
        ? { kind: 'hiring', from: params.from, to: params.to, hiringRuleVersionId: ctx.rules.hiring.id, departments }
        : { kind: 'roster', from: params.from, to: params.to, departments };
    await tx.query(
      `INSERT INTO scenario_run_result (run_id, synthetic, results) VALUES ($1, $2, $3) ON CONFLICT (run_id) DO NOTHING`,
      [jobId, claimed.synthetic, JSON.stringify(results)],
    );
    await tx.query(
      `UPDATE scenario_run SET status = 'succeeded', progress = 1, units_done = units_total, finished_at = now(), results_ref = $2
        WHERE id = $1`,
      [jobId, `db:scenario_run_result/${jobId}`],
    );
    await notify(tx, jobId, 'planning_job.succeeded', 'info');
    return 'succeeded';
  });
}
