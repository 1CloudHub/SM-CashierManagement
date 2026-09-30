/**
 * Ingestion workflow persistence (task 9; Req 17, 18; P5, P7, P9, P18).
 *
 *   validate  -> run 'validated' (clean) or 'blocked' (errors; prior dataset kept)
 *   load      -> new immutable snapshot supersedes the current one of the same
 *                type and provenance; scenarios pinning the superseded snapshot
 *                are flagged stale and their owners notified
 *   cancel    -> run 'cancelled'
 *
 * Every mutation records exactly one audit event (P7) in its own transaction.
 * A snapshot and everything checked against it are one provenance (P18).
 */
import { randomUUID } from 'node:crypto';
import {
  DATASET_TYPES,
  provenanceInfo,
  type AffectedScenario,
  type ColumnMapping,
  type DatasetSnapshot,
  type DatasetSummary,
  type DatasetType,
  type IngestionIssue,
  type IngestionRunDto,
  type IngestionStatus,
  type IsoDate,
  type ProvenanceInfo,
} from '@lanewise/shared';
import type pg from 'pg';
import { errors } from '../../http/errors.js';
import { affectedByLoad, type ScenarioPin } from '../../ingestion/staleness.js';
import type { ReferenceData } from '../../ingestion/validate.js';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { isoOrNull, PG_ERRORS, pgErrorCode, queryMaybe, queryOne } from '../rows.js';
import { SNAPSHOT_COLUMNS, toSnapshot, type SnapshotRow } from './ingestion.js';

/** Issues kept per run (counts stay exact); the rest are summarised in one line. */
export const MAX_STORED_ISSUES = 20_000;

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface RunRow extends pg.QueryResultRow {
  id: string;
  dataset_type: DatasetType;
  user_id: string;
  user_name: string | null;
  file_name: string;
  file_key: string | null;
  row_count: number;
  valid_row_count: number;
  warning_count: number;
  error_count: number;
  status: IngestionStatus;
  snapshot_id: string | null;
  synthetic: boolean;
  covers_from: string | null;
  covers_to: string | null;
  started_at: Date;
  finished_at: Date | null;
  stale_scenario_ids: string[];
  base_snapshot_id: string | null;
  normalized_key: string | null;
  normalized_sha256: string | null;
}

const RUN_SELECT = `
  SELECT r.id, r.dataset_type, r.user_id, u.name AS user_name, r.file_name, r.file_key, r.row_count,
         r.valid_row_count, r.warning_count, r.error_count, r.status, r.snapshot_id, r.synthetic,
         r.covers_from, r.covers_to, r.started_at, r.finished_at, r.stale_scenario_ids,
         r.base_snapshot_id, r.normalized_key, r.normalized_sha256
    FROM ingestion_run r LEFT JOIN app_user u ON u.id = r.user_id`;

function toRunDto(row: RunRow): IngestionRunDto {
  return {
    id: row.id,
    datasetType: row.dataset_type,
    userId: row.user_id,
    userName: row.user_name,
    fileName: row.file_name,
    rowCount: row.row_count,
    validRowCount: row.valid_row_count,
    warningCount: row.warning_count,
    errorCount: row.error_count,
    status: row.status,
    snapshotId: row.snapshot_id,
    synthetic: row.synthetic,
    coversFrom: row.covers_from,
    coversTo: row.covers_to,
    startedAt: row.started_at.toISOString(),
    finishedAt: isoOrNull(row.finished_at),
    staleScenarioCount: row.stale_scenario_ids.length,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface RunListFilter {
  readonly datasetType?: DatasetType | undefined;
  /** Default 50, max 500. */
  readonly limit?: number | undefined;
}

export async function listRuns(db: Queryable, filter: RunListFilter = {}): Promise<IngestionRunDto[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const { rows } = await db.query<RunRow>(
    `${RUN_SELECT}
      WHERE ($1::text IS NULL OR r.dataset_type = $1)
      ORDER BY r.started_at DESC, r.id DESC LIMIT $2`,
    [filter.datasetType ?? null, limit],
  );
  return rows.map(toRunDto);
}

export interface RunDetail {
  readonly run: IngestionRunDto;
  readonly issues: readonly IngestionIssue[];
  readonly staleScenarioIds: readonly string[];
  /** The snapshot that was current when the file was validated. */
  readonly baseSnapshotId: string | null;
}

export async function getRun(db: Queryable, id: string): Promise<RunDetail | null> {
  const row = await queryMaybe<RunRow & { issues: IngestionIssue[] }>(
    db,
    `${RUN_SELECT.replace('r.normalized_sha256', 'r.normalized_sha256, r.issues')} WHERE r.id = $1`,
    [id],
  );
  if (!row) return null;
  return {
    run: toRunDto(row),
    issues: row.issues,
    staleScenarioIds: row.stale_scenario_ids,
    baseSnapshotId: row.base_snapshot_id,
  };
}

export async function currentSnapshot(
  db: Queryable,
  type: DatasetType,
  synthetic: boolean,
  lock = false,
): Promise<DatasetSnapshot | null> {
  const row = await queryMaybe<SnapshotRow>(
    db,
    `SELECT ${SNAPSHOT_COLUMNS} FROM dataset_snapshot
      WHERE dataset_type = $1 AND synthetic = $2 AND superseded_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [type, synthetic],
  );
  return row && toSnapshot(row);
}

interface PinRow extends pg.QueryResultRow {
  scenario_id: string;
  snapshot_id: string;
  status: string;
  stale: boolean;
  name: string;
  owner_id: string;
}

/** Scenarios that loading over `snapshotId` would make stale (Req 17.4). */
export async function affectedScenarios(db: Queryable, snapshotId: string | null): Promise<AffectedScenario[]> {
  if (snapshotId === null) return [];
  const { rows } = await db.query<PinRow>(
    `SELECT s.id AS scenario_id, p.snapshot_id, s.status, s.stale, s.name, s.owner_id
       FROM scenario_snapshot p JOIN scenario s ON s.id = p.scenario_id
      WHERE p.snapshot_id = $1
      ORDER BY s.name, s.id`,
    [snapshotId],
  );
  const pins: ScenarioPin[] = rows.map((r) => ({ scenarioId: r.scenario_id, snapshotId: r.snapshot_id, status: r.status, stale: r.stale }));
  const byId = new Map(rows.map((r) => [r.scenario_id, r]));
  return affectedByLoad(pins, snapshotId).map((c) => {
    const r = byId.get(c.scenarioId) as PinRow;
    return { id: r.scenario_id, name: r.name, status: r.status, ownerId: r.owner_id, alreadyStale: c.alreadyStale };
  });
}

/** Active departments of one provenance, the reference for POS/staff files. */
export async function referenceData(db: Queryable, synthetic: boolean): Promise<ReferenceData> {
  const { rows } = await db.query<{ store_code: string; department: string; installed_lanes: number }>(
    `SELECT s.code AS store_code, d.name AS department, d.installed_lanes
       FROM department d JOIN store s ON s.id = d.store_id
      WHERE d.synthetic = $1 AND d.active AND s.active`,
    [synthetic],
  );
  return { departments: rows.map((r) => ({ storeCode: r.store_code, department: r.department, installedLanes: r.installed_lanes })) };
}

export interface SnapshotListFilter {
  readonly datasetType?: DatasetType | undefined;
  readonly currentOnly?: boolean | undefined;
  /** Default 50, max 500. */
  readonly limit?: number | undefined;
}

export async function listSnapshots(db: Queryable, filter: SnapshotListFilter = {}): Promise<DatasetSnapshot[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const { rows } = await db.query<SnapshotRow>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM dataset_snapshot
      WHERE ($1::text IS NULL OR dataset_type = $1) AND (NOT $2 OR superseded_at IS NULL)
      ORDER BY loaded_at DESC, id DESC LIMIT $3`,
    [filter.datasetType ?? null, filter.currentOnly ?? false, limit],
  );
  return rows.map(toSnapshot);
}

export async function getSnapshot(db: Queryable, id: string): Promise<DatasetSnapshot | null> {
  const row = await queryMaybe<SnapshotRow>(db, `SELECT ${SNAPSHOT_COLUMNS} FROM dataset_snapshot WHERE id = $1`, [id]);
  return row && toSnapshot(row);
}

/** SCR-050 rows: per dataset type, the snapshot in use (real first) and the latest run. */
export async function datasetSummaries(db: Queryable): Promise<DatasetSummary[]> {
  const current = await listSnapshots(db, { currentOnly: true, limit: 500 });
  const { rows } = await db.query<RunRow>(
    `SELECT DISTINCT ON (r.dataset_type) ${RUN_SELECT.replace(/^\s*SELECT /, '')}
      ORDER BY r.dataset_type, r.started_at DESC, r.id DESC`,
  );
  return DATASET_TYPES.map((type) => {
    const currentReal = current.find((s) => s.type === type && !s.synthetic) ?? null;
    const currentSynthetic = current.find((s) => s.type === type && s.synthetic) ?? null;
    const lastRun = rows.find((r) => r.dataset_type === type);
    return {
      type,
      current: currentReal ?? currentSynthetic,
      currentReal,
      currentSynthetic,
      lastRun: lastRun ? toRunDto(lastRun) : null,
    };
  });
}

/** Provenance of the datasets in use (P9): sample data while any is synthetic. */
export async function inUseProvenance(db: Queryable): Promise<ProvenanceInfo> {
  const summaries = await datasetSummaries(db);
  return provenanceInfo(summaries.flatMap((s) => (s.current ? [{ type: s.type, synthetic: s.current.synthetic }] : [])));
}

// ---------------------------------------------------------------------------
// Notifications (Req 20.1: ingestion outcomes, staleness)
// ---------------------------------------------------------------------------

interface NotificationInput {
  readonly event: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly params: Record<string, unknown>;
  readonly synthetic: boolean;
}

/** Notifies every active user holding any of `roles` (rules stewards, planners). */
async function notifyRoles(tx: AuditedTx, roles: readonly string[], n: NotificationInput): Promise<void> {
  await tx.query(
    `INSERT INTO notification (user_id, event, object_type, object_id, severity, params, synthetic)
     SELECT DISTINCT u.id, $2::text, $3::text, $4::text, $5::text, $6::jsonb, $7::boolean
       FROM app_user u JOIN role_assignment ra ON ra.user_id = u.id
      WHERE u.status = 'active' AND ra.role = ANY($1::text[])`,
    [roles, n.event, n.objectType, n.objectId, n.severity, JSON.stringify(n.params), n.synthetic],
  );
}

async function notifyUser(tx: AuditedTx, userId: string, n: NotificationInput): Promise<void> {
  await tx.query(
    `INSERT INTO notification (user_id, event, object_type, object_id, severity, params, synthetic)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, n.event, n.objectType, n.objectId, n.severity, JSON.stringify(n.params), n.synthetic],
  );
}

const INGESTION_RECIPIENTS = ['RST', 'PLN'] as const;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface RecordValidationInput {
  readonly runId?: string;
  readonly datasetType: DatasetType;
  readonly fileName: string;
  readonly fileKey: string;
  readonly fileSha256: string;
  readonly fileSizeBytes: number;
  readonly synthetic: boolean;
  readonly columnMapping: ColumnMapping;
  readonly rowCount: number;
  readonly validRowCount: number;
  readonly issues: readonly IngestionIssue[];
  readonly coversFrom: IsoDate;
  readonly coversTo: IsoDate;
  /** Normalised data written to storage; present exactly when the file can load. */
  readonly normalized: { readonly key: string; readonly sha256: string } | null;
}

export interface ValidationRecord {
  readonly run: IngestionRunDto;
  readonly impact: readonly AffectedScenario[];
}

/** Keeps at most MAX_STORED_ISSUES issues, replacing the tail with one summary line. */
export function capIssues(issues: readonly IngestionIssue[]): IngestionIssue[] {
  if (issues.length <= MAX_STORED_ISSUES) return [...issues];
  const kept = issues.slice(0, MAX_STORED_ISSUES - 1);
  const rest = issues.length - kept.length;
  return [
    ...kept,
    { row: 0, severity: 'warning', code: 'issues_truncated', message: `${rest} more issues are not listed; fix the ones above and upload again.` },
  ];
}

/** Records a validated or blocked run (Req 17.2, 17.3, 17.5). */
export async function recordValidation(tx: AuditedTx, input: RecordValidationInput): Promise<ValidationRecord> {
  const warnings = input.issues.filter((i) => i.severity === 'warning').length;
  const errorCount = input.issues.length - warnings;
  if ((errorCount === 0) !== (input.normalized !== null)) {
    throw new Error('normalised data must be stored exactly when the file has no errors');
  }
  const base = await currentSnapshot(tx, input.datasetType, input.synthetic);
  const status: IngestionStatus = errorCount === 0 ? 'validated' : 'blocked';
  const { id } = await queryOne<{ id: string }>(
    tx,
    `INSERT INTO ingestion_run
       (id, dataset_type, user_id, file_name, file_key, file_sha256, file_size_bytes, row_count, valid_row_count,
        warning_count, error_count, issues, status, synthetic, covers_from, covers_to, column_mapping,
        normalized_key, normalized_sha256, base_snapshot_id, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now())
     RETURNING id`,
    [
      input.runId ?? randomUUID(),
      input.datasetType,
      tx.actor.userId,
      input.fileName,
      input.fileKey,
      input.fileSha256,
      input.fileSizeBytes,
      input.rowCount,
      input.validRowCount,
      warnings,
      errorCount,
      JSON.stringify(capIssues(input.issues)),
      status,
      input.synthetic,
      input.coversFrom,
      input.coversTo,
      JSON.stringify(input.columnMapping),
      input.normalized?.key ?? null,
      input.normalized?.sha256 ?? null,
      base?.id ?? null,
    ],
  );
  const detail = (await getRun(tx, id)) as RunDetail;

  if (status === 'blocked') {
    await notifyRoles(tx, INGESTION_RECIPIENTS, {
      event: 'ingestion.failed',
      objectType: 'ingestion_run',
      objectId: id,
      severity: 'critical',
      params: { datasetType: input.datasetType, fileName: input.fileName, errors: errorCount },
      synthetic: input.synthetic,
    });
  }
  await audit.record(tx, {
    action: 'ingestion',
    event: status === 'blocked' ? 'ingestion.blocked' : 'ingestion.validated',
    objectType: 'ingestion_run',
    objectId: id,
    after: {
      datasetType: input.datasetType,
      fileName: input.fileName,
      rowCount: input.rowCount,
      warnings,
      errors: errorCount,
      status,
      baseSnapshotId: base?.id ?? null,
    },
    synthetic: input.synthetic,
  });
  return { run: detail.run, impact: status === 'validated' ? await affectedScenarios(tx, base?.id ?? null) : [] };
}

export interface LoadResult {
  readonly run: IngestionRunDto;
  readonly snapshot: DatasetSnapshot;
  readonly staleScenarios: readonly AffectedScenario[];
}

async function lockRun(tx: AuditedTx, id: string): Promise<RunRow> {
  const locked = await queryMaybe<{ id: string }>(tx, 'SELECT id FROM ingestion_run WHERE id = $1 FOR UPDATE', [id]);
  if (!locked) throw errors.notFound();
  return queryOne<RunRow>(tx, `${RUN_SELECT} WHERE r.id = $1`, [id]);
}

/**
 * Loads a validated run: a new immutable snapshot supersedes the current one
 * of the same type and provenance, pinned scenarios are flagged stale and
 * their owners notified (Req 17.4), and rules stewards/planners are told the
 * load succeeded.
 */
export async function loadRun(tx: AuditedTx, id: string, options: { confirmWarnings: boolean }): Promise<LoadResult> {
  const run = await lockRun(tx, id);
  if (run.status !== 'validated') {
    throw errors.conflict(
      run.status === 'blocked'
        ? 'This file has errors and cannot be loaded; the previous dataset stays in use.'
        : `This upload is ${run.status} and cannot be loaded.`,
    );
  }
  if (run.warning_count > 0 && !options.confirmWarnings) {
    throw errors.validationFailed('Confirm the warnings to load this file.', [
      { path: 'body.confirmWarnings', message: 'Must be true when the file has warnings.' },
    ]);
  }
  const current = await currentSnapshot(tx, run.dataset_type, run.synthetic, true);
  if ((current?.id ?? null) !== run.base_snapshot_id) {
    throw errors.conflict('The dataset changed since this file was validated. Validate it again to see the current impact.');
  }

  const stale = await affectedScenarios(tx, current?.id ?? null);
  const snapshotId = randomUUID();
  if (current) {
    await tx.query('UPDATE dataset_snapshot SET superseded_at = now(), superseded_by = $2 WHERE id = $1', [current.id, snapshotId]);
  }
  const snapshot = toSnapshot(
    await queryOne<SnapshotRow>(
      tx,
      `INSERT INTO dataset_snapshot
         (id, dataset_type, covers_from, covers_to, row_count, storage_key, content_sha256, source_run_id, synthetic, loaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${SNAPSHOT_COLUMNS}`,
      [
        snapshotId,
        run.dataset_type,
        run.covers_from,
        run.covers_to,
        run.valid_row_count,
        run.normalized_key,
        run.normalized_sha256,
        run.id,
        run.synthetic,
        tx.actor.userId,
      ],
    ),
  );

  const newlyStale = stale.filter((s) => !s.alreadyStale).map((s) => s.id);
  if (newlyStale.length > 0) {
    await tx.query(
      `UPDATE scenario SET stale = true, stale_reason = $2 WHERE id = ANY($1::uuid[])`,
      [newlyStale, `Data snapshot superseded: ${run.dataset_type} data reloaded`],
    );
  }
  for (const s of stale) {
    await notifyUser(tx, s.ownerId, {
      event: 'scenario.stale',
      objectType: 'scenario',
      objectId: s.id,
      severity: 'warning',
      params: { scenarioName: s.name, reason: 'data_refreshed', datasetType: run.dataset_type, snapshotId },
      synthetic: run.synthetic,
    });
  }
  await tx.query(
    `UPDATE ingestion_run
        SET status = 'loaded', snapshot_id = $2, loaded_by = $3, stale_scenario_ids = $4::uuid[], finished_at = now()
      WHERE id = $1`,
    [run.id, snapshotId, tx.actor.userId, stale.map((s) => s.id)],
  );
  await notifyRoles(tx, INGESTION_RECIPIENTS, {
    event: 'ingestion.succeeded',
    objectType: 'ingestion_run',
    objectId: run.id,
    severity: 'info',
    params: { datasetType: run.dataset_type, rows: run.valid_row_count, staleScenarios: stale.length },
    synthetic: run.synthetic,
  });
  await audit.record(tx, {
    action: 'ingestion',
    event: 'dataset.loaded',
    objectType: 'ingestion_run',
    objectId: run.id,
    before: { status: 'validated', currentSnapshotId: current?.id ?? null },
    after: {
      status: 'loaded',
      snapshotId,
      supersededSnapshotId: current?.id ?? null,
      rowCount: run.valid_row_count,
      warnings: run.warning_count,
      staleScenarioIds: stale.map((s) => s.id),
    },
    synthetic: run.synthetic,
  });
  const loaded = (await getRun(tx, run.id)) as RunDetail;
  return { run: loaded.run, snapshot, staleScenarios: stale };
}

export async function cancelRun(tx: AuditedTx, id: string): Promise<IngestionRunDto> {
  const run = await lockRun(tx, id);
  if (run.status !== 'validated') throw errors.conflict(`This upload is ${run.status} and cannot be cancelled.`);
  await tx.query(`UPDATE ingestion_run SET status = 'cancelled', finished_at = now() WHERE id = $1`, [id]);
  await audit.record(tx, {
    action: 'ingestion',
    event: 'ingestion.cancelled',
    objectType: 'ingestion_run',
    objectId: id,
    before: { status: 'validated' },
    after: { status: 'cancelled' },
    synthetic: run.synthetic,
  });
  return ((await getRun(tx, id)) as RunDetail).run;
}

/**
 * Sets or clears a snapshot's synthetic flag. The caller has already checked
 * that the active role may (only a Rules Steward clears it, Req 17.6). A
 * snapshot pinned by scenarios or runs of the other provenance cannot change
 * (P18), nor can one that would clash with the current snapshot of the other
 * provenance.
 */
export async function setSnapshotSynthetic(tx: AuditedTx, id: string, synthetic: boolean): Promise<DatasetSnapshot> {
  const before = await queryMaybe<SnapshotRow>(tx, `SELECT ${SNAPSHOT_COLUMNS} FROM dataset_snapshot WHERE id = $1 FOR UPDATE`, [id]);
  if (!before) throw errors.notFound();
  if (before.synthetic === synthetic) throw errors.conflict(`The dataset is already ${synthetic ? 'synthetic' : 'real'}.`);
  let row: SnapshotRow;
  try {
    row = await queryOne<SnapshotRow>(
      tx,
      `UPDATE dataset_snapshot SET synthetic = $2, synthetic_changed_at = now(), synthetic_changed_by = $3
        WHERE id = $1 RETURNING ${SNAPSHOT_COLUMNS}`,
      [id, synthetic, tx.actor.userId],
    );
  } catch (error) {
    const code = pgErrorCode(error);
    if (code === PG_ERRORS.foreignKeyViolation) {
      throw errors.conflict('Scenarios use this dataset, so its sample-data flag cannot change. Load the data again instead.');
    }
    if (code === PG_ERRORS.uniqueViolation) {
      throw errors.conflict(`A current ${synthetic ? 'synthetic' : 'real'} dataset of this type already exists.`);
    }
    throw error;
  }
  await audit.record(tx, {
    action: 'edit',
    event: synthetic ? 'snapshot.synthetic_flagged' : 'snapshot.synthetic_cleared',
    objectType: 'dataset_snapshot',
    objectId: id,
    before: { synthetic: before.synthetic },
    after: { synthetic },
    synthetic: before.synthetic || synthetic,
  });
  return toSnapshot(row);
}
