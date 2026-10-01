/**
 * Column mapping for ingestion files (SCR-051 step 2). Pure.
 *
 * Without an explicit mapping, headers are matched to canonical fields by
 * normalised name ("Store Code" -> `store_code`). An explicit mapping
 * (canonical field -> header) overrides auto-matching for the fields it names.
 */
import { DATASET_COLUMNS, normaliseHeader, type ColumnMapping, type DatasetType, type IngestionIssue } from '@lanewise/shared';

export interface ResolvedColumns {
  /** Canonical field -> column index in the file (absent when unmapped). */
  readonly index: Readonly<Record<string, number | undefined>>;
  /** File-level (row 0) errors: missing required columns, bad mapping. */
  readonly issues: readonly IngestionIssue[];
}

export function resolveColumns(
  type: DatasetType,
  headers: readonly string[],
  mapping: ColumnMapping = {},
): ResolvedColumns {
  const columns = DATASET_COLUMNS[type];
  const known = new Set(columns.map((c) => c.field));
  const issues: IngestionIssue[] = [];
  const index: Record<string, number | undefined> = {};

  for (const [field, header] of Object.entries(mapping).sort(([a], [b]) => a.localeCompare(b))) {
    if (!known.has(field)) {
      issues.push({ row: 0, column: field, severity: 'error', code: 'unknown_field', message: `"${field}" is not a column of this dataset.` });
      continue;
    }
    const at = headers.indexOf(header);
    if (at < 0) {
      issues.push({ row: 0, column: field, severity: 'error', code: 'unmapped_header', message: `The file has no column "${header}" (mapped to ${field}).` });
      continue;
    }
    index[field] = at;
  }

  const normalised = headers.map(normaliseHeader);
  for (const column of columns) {
    if (column.field in mapping) {
      if (index[column.field] === undefined && !column.required) continue;
      if (index[column.field] !== undefined) continue;
    } else {
      const at = normalised.indexOf(column.field);
      if (at >= 0) {
        index[column.field] = at;
        continue;
      }
    }
    if (column.required && !issues.some((i) => i.column === column.field)) {
      issues.push({
        row: 0,
        column: column.field,
        severity: 'error',
        code: 'missing_column',
        message: `Required column "${column.field}" is missing.`,
      });
    }
  }
  return { index, issues };
}
