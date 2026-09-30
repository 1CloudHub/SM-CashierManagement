/**
 * Dataset ingestion and snapshots (DOM-002 Dataset/Snapshot, IngestionRun;
 * Req 17). File parsing/validation lives in `src/ingestion/` (pure); this
 * persists outcomes. The task-9 two-step workflow (validate, then load or
 * cancel) is in ./ingestion-workflow.ts; `ingestDataset` below records a
 * one-step load (seeding, tests).
 */
import { randomUUID } from 'node:crypto';
import type { DatasetSnapshot, DatasetType, IngestionStatus, IsoDate } from '@lanewise/shared';
import type pg from 'pg';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { isoOrNull, queryMaybe, queryOne } from '../rows.js';

export type { IngestionStatus } from '@lanewise/shared';

/** Minimal issue shape accepted by `ingestDataset` (the wire type adds `code`/`column`). */
export interface IngestionIssue {
  readonly row: number;
  readonly severity: 'warning' | 'error';
  readonly message: string;
}

export interface IngestionRun {
  readonly id: string;
  readonly datasetType: DatasetType;
  readonly userId: string;
  readonly fileName: string;
  readonly rowCount: number;
  readonly warningCount: number;
  readonly errorCount: number;
  readonly status: IngestionStatus;
  readonly snapshotId: string | null;
  readonly synthetic: boolean;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

export interface SnapshotRow extends pg.QueryResultRow {
  id: string;
  dataset_type: DatasetType;
  covers_from: string;
  covers_to: string;
  row_count: number;
  synthetic: boolean;
  loaded_at: Date;
}

export const SNAPSHOT_COLUMNS = 'id, dataset_type, covers_from, covers_to, row_count, synthetic, loaded_at';

export function toSnapshot(row: SnapshotRow): DatasetSnapshot {
  return {
    id: row.id,
    type: row.dataset_type,
    coversFrom: row.covers_from,
    coversTo: row.covers_to,
    rowCount: row.row_count,
    synthetic: row.synthetic,
    loadedAt: row.loaded_at.toISOString(),
  };
}

interface RunRow extends pg.QueryResultRow {
  id: string;
  dataset_type: DatasetType;
  user_id: string;
  file_name: string;
  row_count: number;
  warning_count: number;
  error_count: number;
  status: IngestionStatus;
  snapshot_id: string | null;
  synthetic: boolean;
  started_at: Date;
  finished_at: Date | null;
}

const RUN_COLUMNS =
  'id, dataset_type, user_id, file_name, row_count, warning_count, error_count, status, snapshot_id, synthetic, started_at, finished_at';

function toRun(row: RunRow): IngestionRun {
  return {
    id: row.id,
    datasetType: row.dataset_type,
    userId: row.user_id,
    fileName: row.file_name,
    rowCount: row.row_count,
    warningCount: row.warning_count,
    errorCount: row.error_count,
    status: row.status,
    snapshotId: row.snapshot_id,
    synthetic: row.synthetic,
    startedAt: row.started_at.toISOString(),
    finishedAt: isoOrNull(row.finished_at),
  };
}

/** The current (not superseded) snapshot of a dataset type and provenance. */
export async function getCurrentSnapshot(
  db: Queryable,
  type: DatasetType,
  synthetic: boolean,
): Promise<DatasetSnapshot | null> {
  const row = await queryMaybe<SnapshotRow>(
    db,
    `SELECT ${SNAPSHOT_COLUMNS} FROM dataset_snapshot
      WHERE dataset_type = $1 AND synthetic = $2 AND superseded_at IS NULL`,
    [type, synthetic],
  );
  return row && toSnapshot(row);
}

export interface IngestInput {
  readonly datasetType: DatasetType;
  readonly fileName: string;
  readonly fileKey?: string;
  readonly fileSha256?: string;
  readonly coversFrom: IsoDate;
  readonly coversTo: IsoDate;
  readonly rowCount: number;
  readonly issues: readonly IngestionIssue[];
  /** Seeded/sample upload (Req 17.6). A snapshot is entirely one provenance (P18). */
  readonly synthetic: boolean;
  readonly storageKey?: string;
}

export interface IngestResult {
  readonly run: IngestionRun;
  /** The new current snapshot, or null when the load was blocked. */
  readonly snapshot: DatasetSnapshot | null;
}

/**
 * Records one ingestion. With any error the load is blocked and the previous
 * snapshot stays current (Req 17.3); otherwise a new snapshot supersedes it.
 * Either way exactly one `ingestion` audit event is written.
 */
export async function ingestDataset(tx: AuditedTx, input: IngestInput): Promise<IngestResult> {
  const warnings = input.issues.filter((i) => i.severity === 'warning').length;
  const errorCount = input.issues.filter((i) => i.severity === 'error').length;
  let snapshot: DatasetSnapshot | null = null;
  let supersededSnapshotId: string | null = null;

  if (errorCount === 0) {
    const id = randomUUID();
    const previous = await tx.query<{ id: string }>(
      `UPDATE dataset_snapshot SET superseded_at = now(), superseded_by = $3
        WHERE dataset_type = $1 AND synthetic = $2 AND superseded_at IS NULL
        RETURNING id`,
      [input.datasetType, input.synthetic, id],
    );
    snapshot = toSnapshot(
      await queryOne<SnapshotRow>(
        tx,
        `INSERT INTO dataset_snapshot
           (id, dataset_type, covers_from, covers_to, row_count, storage_key, synthetic, loaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${SNAPSHOT_COLUMNS}`,
        [
          id,
          input.datasetType,
          input.coversFrom,
          input.coversTo,
          input.rowCount,
          input.storageKey ?? null,
          input.synthetic,
          tx.actor.userId,
        ],
      ),
    );
    // Stale-flagging of dependent scenarios is task 9.2/11.2.
    supersededSnapshotId = previous.rows[0]?.id ?? null;
  }

  const run = toRun(
    await queryOne<RunRow>(
      tx,
      `INSERT INTO ingestion_run
         (dataset_type, user_id, file_name, file_key, file_sha256, row_count, warning_count, error_count,
          issues, status, snapshot_id, synthetic, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       RETURNING ${RUN_COLUMNS}`,
      [
        input.datasetType,
        tx.actor.userId,
        input.fileName,
        input.fileKey ?? null,
        input.fileSha256 ?? null,
        input.rowCount,
        warnings,
        errorCount,
        JSON.stringify(input.issues),
        errorCount === 0 ? 'loaded' : 'blocked',
        snapshot?.id ?? null,
        input.synthetic,
      ],
    ),
  );

  await audit.record(tx, {
    action: 'ingestion',
    event: snapshot ? 'dataset.loaded' : 'dataset.load_blocked',
    objectType: 'ingestion_run',
    objectId: run.id,
    after: {
      datasetType: run.datasetType,
      fileName: run.fileName,
      rowCount: run.rowCount,
      warnings: run.warningCount,
      errors: run.errorCount,
      status: run.status,
      snapshotId: run.snapshotId,
      supersededSnapshotId,
    },
    synthetic: input.synthetic,
  });
  return { run, snapshot };
}
