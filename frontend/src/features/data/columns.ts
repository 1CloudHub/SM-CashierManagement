/**
 * Column mapping for SCR-051 step 2 (requirement 17.1): read the uploaded
 * file's header row client-side, auto-match it to the canonical columns of the
 * dataset type, and check the steward's mapping before upload.
 *
 * Pure and framework-free so it is property-tested (columns.test.ts).
 */
import {
  DATASET_COLUMNS,
  normaliseHeader,
  type ColumnMapping,
  type DatasetType,
} from '@lanewise/shared'

/** Bytes read from the start of the file to find the header row. */
export const HEADER_SNIFF_BYTES = 64 * 1024

/**
 * Parses the first CSV record (RFC 4180: quoted cells, doubled quotes, CRLF,
 * a leading BOM). Returns the trimmed, non-empty header cells in order.
 */
export function parseHeaderRow(text: string): string[] {
  const src = text.replace(/^\uFEFF/, '')
  const cells: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  for (; i < src.length; i += 1) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 1
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      cells.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') break
    else cell += ch
  }
  cells.push(cell)
  return cells.map((c) => c.trim()).filter((c) => c.length > 0)
}

/** Reads the header row of a file (first `HEADER_SNIFF_BYTES`). */
export async function readHeaderRow(file: Blob): Promise<string[]> {
  const head = file.slice(0, HEADER_SNIFF_BYTES)
  const text =
    typeof head.text === 'function'
      ? await head.text()
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result ?? ''))
          reader.onerror = () => reject(reader.error)
          reader.readAsText(head)
        })
  return parseHeaderRow(text)
}

/** Field -> chosen source header; `''` means "not mapped". */
export type DraftMapping = Record<string, string>

/**
 * Auto-matches headers to the canonical fields of `type` by normalised name
 * ("Store Code" -> `store_code`). Each header is used at most once and the
 * first header with a given normalised name wins; unmatched fields map to ''.
 */
export function autoMapColumns(type: DatasetType, headers: readonly string[]): DraftMapping {
  const byNormalised = new Map<string, string>()
  for (const h of headers) {
    const n = normaliseHeader(h)
    if (n && !byNormalised.has(n)) byNormalised.set(n, h)
  }
  const used = new Set<string>()
  const mapping: DraftMapping = {}
  for (const { field } of DATASET_COLUMNS[type]) {
    const header = byNormalised.get(field)
    if (header !== undefined && !used.has(header)) {
      mapping[field] = header
      used.add(header)
    } else mapping[field] = ''
  }
  return mapping
}

export interface MappingProblems {
  /** Required fields with no column chosen. */
  readonly missingRequired: readonly string[]
  /** Headers chosen for more than one field. */
  readonly duplicateHeaders: readonly string[]
}

export function mappingProblems(type: DatasetType, mapping: DraftMapping): MappingProblems {
  const missingRequired = DATASET_COLUMNS[type]
    .filter((c) => c.required && !mapping[c.field])
    .map((c) => c.field)
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const { field } of DATASET_COLUMNS[type]) {
    const h = mapping[field]
    if (!h) continue
    if (seen.has(h)) dup.add(h)
    seen.add(h)
  }
  return { missingRequired, duplicateHeaders: [...dup] }
}

export function isMappingComplete(type: DatasetType, mapping: DraftMapping): boolean {
  const p = mappingProblems(type, mapping)
  return p.missingRequired.length === 0 && p.duplicateHeaders.length === 0
}

/** The wire mapping: only fields with a chosen column. */
export function toColumnMapping(type: DatasetType, mapping: DraftMapping): ColumnMapping {
  const out: Record<string, string> = {}
  for (const { field } of DATASET_COLUMNS[type]) if (mapping[field]) out[field] = mapping[field]
  return out
}

/** A CSV file by name or type (browsers report CSV inconsistently). */
export function looksLikeCsv(file: { name: string; type: string }): boolean {
  return /\.csv$/i.test(file.name) || file.type === 'text/csv'
}
