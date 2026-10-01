/**
 * RFC 4180 CSV parsing for ingestion files (task 9.1). Pure: text in,
 * row-numbered records and file-level issues out.
 *
 * - Accepts LF or CRLF line endings and an optional UTF-8 BOM.
 * - Quoted cells keep their content verbatim (commas, quotes as `""`, line
 *   breaks); unquoted cells are trimmed.
 * - `row` is the spreadsheet row number of the record's first line (header =
 *   row 1), counting physical lines so it matches what a user sees in Excel.
 * - Blank lines are skipped but still counted.
 */
import type { IngestionIssue } from '@lanewise/shared';

export interface CsvRecord {
  readonly row: number;
  readonly cells: readonly string[];
}

export interface CsvParseResult {
  readonly records: readonly CsvRecord[];
  readonly issues: readonly IngestionIssue[];
}

export function parseCsv(input: string): CsvParseResult {
  const text = input.startsWith('﻿') ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  const issues: IngestionIssue[] = [];

  let line = 1;
  let recordStartLine = 1;
  let cells: string[] = [];
  let cell = '';
  let quoted = false; // current cell started with a quote
  let inQuotes = false;
  let quoteStartLine = 1;
  let i = 0;

  const endCell = (): void => {
    cells.push(quoted ? cell : cell.trim());
    cell = '';
    quoted = false;
  };
  const endRecord = (): void => {
    endCell();
    if (cells.some((c) => c.length > 0)) records.push({ row: recordStartLine, cells });
    cells = [];
  };

  while (i < text.length) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === '\n') line += 1;
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell.trim().length === 0 && !quoted) {
      // Opening quote (leading spaces before it are ignored).
      cell = '';
      quoted = true;
      inQuotes = true;
      quoteStartLine = line;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endCell();
      i += 1;
      continue;
    }
    if (ch === '\r' && text[i + 1] === '\n') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRecord();
      line += 1;
      recordStartLine = line;
      i += 1;
      continue;
    }
    if (quoted) {
      // Text after a closing quote: keep it (lenient), but only non-space.
      if (ch.trim().length > 0) cell += ch;
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }

  if (inQuotes) {
    issues.push({
      row: quoteStartLine,
      severity: 'error',
      code: 'malformed_csv',
      message: 'A quoted value is never closed; the rest of the file cannot be read.',
    });
    return { records, issues };
  }
  endRecord();
  return { records, issues };
}
