/**
 * Data ingestion wire contracts (Requirement 17, task 9; SCR-050/051) and the
 * sample-data provenance helpers used by every export (Requirement 18, P9).
 */
import type { DatasetSnapshot, DatasetType, IsoDate, IsoDateTime } from './entities.js';
import type { RoleCode } from './roles.js';

/** Largest accepted upload (bytes). The presigned PUT URL signs the exact size. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Upload content types accepted for ingestion files. */
export const UPLOAD_CONTENT_TYPES = ['text/csv'] as const;
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];

export type IngestionSeverity = 'warning' | 'error';

/**
 * One row-numbered validation finding (Req 17.2). `row` is the spreadsheet row
 * number: the header is row 1, the first data row is row 2, and 0 means the
 * file as a whole (e.g. a missing column).
 */
export interface IngestionIssue {
  readonly row: number;
  readonly column?: string;
  readonly severity: IngestionSeverity;
  /** Stable machine code, e.g. `required`, `lanes_over_installed`. */
  readonly code: string;
  readonly message: string;
}

export type IngestionStatus = 'validating' | 'validated' | 'blocked' | 'loaded' | 'failed' | 'cancelled';

/** A scenario that becomes stale when a load supersedes the snapshot it pins (Req 17.4). */
export interface AffectedScenario {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly ownerId: string;
  readonly alreadyStale: boolean;
}

export interface IngestionRunDto {
  readonly id: string;
  readonly datasetType: DatasetType;
  readonly userId: string;
  readonly userName: string | null;
  readonly fileName: string;
  readonly rowCount: number;
  readonly validRowCount: number;
  readonly warningCount: number;
  readonly errorCount: number;
  readonly status: IngestionStatus;
  readonly snapshotId: string | null;
  readonly synthetic: boolean;
  readonly coversFrom: IsoDate | null;
  readonly coversTo: IsoDate | null;
  readonly startedAt: IsoDateTime;
  readonly finishedAt: IsoDateTime | null;
  /** Scenarios marked stale by this load (only once loaded). */
  readonly staleScenarioCount: number;
}

/** Sample-data provenance attached to data responses (P9). */
export interface ProvenanceInfo {
  /** True while any dataset in use is flagged synthetic: show the banner. */
  readonly sampleData: boolean;
  readonly syntheticDatasetTypes: readonly DatasetType[];
}

export type WithProvenance<T> = T & { readonly provenance: ProvenanceInfo };

/** `POST /ingestions/uploads` */
export interface UploadUrlRequest {
  readonly datasetType: DatasetType;
  readonly fileName: string;
  readonly contentType: UploadContentType;
  readonly sizeBytes: number;
}

export interface UploadUrlResponse {
  readonly fileKey: string;
  readonly uploadUrl: string;
  /** Headers the client must send with the PUT (they are signed). */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: IsoDateTime;
}

/** Canonical field name -> source column header (SCR-051 step 2). */
export type ColumnMapping = Readonly<Record<string, string>>;

/** `POST /ingestions`: validate an uploaded file. */
export interface CreateIngestionRequest {
  readonly datasetType: DatasetType;
  readonly fileKey: string;
  readonly fileName: string;
  /** The steward's "this dataset is synthetic / sample data" flag (Req 17.6). */
  readonly synthetic: boolean;
  readonly columnMapping?: ColumnMapping;
}

/** Validation outcome of `POST /ingestions` and `GET /ingestions/:id`. */
export interface IngestionDetail {
  readonly run: IngestionRunDto;
  /** At most `ISSUES_PREVIEW_LIMIT` issues; the full list is in the report. */
  readonly issues: readonly IngestionIssue[];
  readonly issuesTruncated: boolean;
  /** Scenarios that will be (or were) marked stale by loading this file. */
  readonly impact: readonly AffectedScenario[];
}

export const ISSUES_PREVIEW_LIMIT = 200;

/** `POST /ingestions/:id/load` */
export interface LoadIngestionRequest {
  /** Must be true when the run has warnings (explicit confirmation). */
  readonly confirmWarnings: boolean;
}

export interface LoadIngestionResponse {
  readonly run: IngestionRunDto;
  readonly snapshot: DatasetSnapshot;
  readonly staleScenarios: readonly AffectedScenario[];
}

/** A generated file returned as JSON so the SPA can download it with its bearer token. */
export interface FileDownload {
  readonly fileName: string;
  readonly contentType: string;
  readonly content: string;
}

/** Per-type row of SCR-050. */
export interface DatasetSummary {
  readonly type: DatasetType;
  /** The snapshot in use: the current real snapshot, else the current synthetic one. */
  readonly current: DatasetSnapshot | null;
  readonly currentReal: DatasetSnapshot | null;
  readonly currentSynthetic: DatasetSnapshot | null;
  readonly lastRun: IngestionRunDto | null;
}

export interface DatasetListResponse {
  readonly datasets: readonly DatasetSummary[];
}

/** `PATCH /snapshots/:id` */
export interface UpdateSnapshotRequest {
  readonly synthetic: boolean;
}

/** Canonical columns per dataset type; `required` columns must be mapped. */
export interface DatasetColumn {
  readonly field: string;
  readonly required: boolean;
}

export const DATASET_COLUMNS: Readonly<Record<DatasetType, readonly DatasetColumn[]>> = {
  pos: [
    { field: 'store_code', required: true },
    { field: 'department', required: true },
    { field: 'date', required: true },
    { field: 'hour', required: true },
    { field: 'transactions', required: true },
    { field: 'lanes_open', required: false },
    { field: 'avg_handle_time_min', required: false },
  ],
  master: [
    { field: 'store_code', required: true },
    { field: 'store_name', required: true },
    { field: 'region_code', required: true },
    { field: 'format', required: true },
    { field: 'department', required: true },
    { field: 'installed_lanes', required: true },
    { field: 'handle_time_min', required: true },
    { field: 'open', required: true },
    { field: 'close', required: true },
  ],
  staff: [
    { field: 'employee_no', required: true },
    { field: 'name', required: true },
    { field: 'store_code', required: true },
    { field: 'department', required: true },
    { field: 'employment_type', required: true },
    { field: 'preferred_rest_day', required: false },
    { field: 'email', required: false },
  ],
};

/** Normalises a header for automatic column matching ("Store Code" -> "store_code"). */
export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ---------------------------------------------------------------------------
// Provenance (Req 18; P9)
// ---------------------------------------------------------------------------

export const SAMPLE_DATA_MARKER = 'SAMPLE DATA';

/** Provenance of the datasets in use: sample data while any of them is synthetic. */
export function provenanceInfo(
  inUse: readonly { readonly type: DatasetType; readonly synthetic: boolean }[],
): ProvenanceInfo {
  const types: DatasetType[] = [];
  for (const d of inUse) if (d.synthetic && !types.includes(d.type)) types.push(d.type);
  return { sampleData: types.length > 0, syntheticDatasetTypes: types };
}

/**
 * Whether `role` may change a dataset's synthetic flag from `from` to `to`.
 * Only a Rules Steward manages ingestion, and only a Rules Steward may clear
 * the flag (Req 17.6). A no-op is refused so it is never audited as a change.
 */
export function canChangeSyntheticFlag(role: RoleCode, from: boolean, to: boolean): boolean {
  if (from === to) return false;
  return role === 'RST';
}

/**
 * Escapes one CSV cell (RFC 4180) and neutralises spreadsheet formula
 * injection by prefixing cells that start with = + - @ (or tab/CR) with `'`.
 */
export function csvEscape(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export interface CsvExportInput {
  readonly title: string;
  readonly generatedAt: IsoDateTime;
  readonly generatedBy: string;
  /** True while synthetic data is in use: the first line is the marker (Req 18.2). */
  readonly sampleData: boolean;
  /** Extra header-block lines, e.g. ["Dataset", "pos"]. */
  readonly meta: readonly (readonly [string, string])[];
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Builds a CSV export: the SAMPLE DATA marker (when synthetic data is in use),
 * a header block, a blank line, then the table. Lines end with CRLF.
 */
export function buildCsvExport(input: CsvExportInput): string {
  const line = (cells: readonly string[]): string => cells.map(csvEscape).join(',');
  const lines: string[] = [];
  if (input.sampleData) lines.push(SAMPLE_DATA_MARKER);
  lines.push(line(['Export', input.title]));
  lines.push(line(['Generated at', input.generatedAt]));
  lines.push(line(['Generated by', input.generatedBy]));
  for (const [k, v] of input.meta) lines.push(line([k, v]));
  lines.push('');
  lines.push(line(input.columns));
  for (const row of input.rows) lines.push(line(row));
  return `${lines.join('\r\n')}\r\n`;
}
