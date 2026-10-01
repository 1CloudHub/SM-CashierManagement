/**
 * CSV parsing for ingestion files (task 9.1). Property tests: parse is the
 * inverse of RFC 4180 serialisation, and row numbers match spreadsheet rows.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/ingestion/csv.js';

function quote(cell: string): string {
  return /[",\r\n]/.test(cell) || cell.trim() !== cell ? `"${cell.replace(/"/g, '""')}"` : cell;
}

const cell = fc.oneof(
  fc.string({ maxLength: 8 }),
  fc.constantFrom('a,b', 'say "hi"', 'two\nlines', 'crlf\r\nx', ' pad ', 'Ñiño ₱1,000'),
);
// First cell non-empty so no generated row is blank (blank rows are skipped).
const row = (width: number) =>
  fc.tuple(fc.string({ minLength: 1, maxLength: 6 }).filter((s) => s.trim().length > 0), fc.array(cell, { minLength: width - 1, maxLength: width - 1 }))
    .map(([first, rest]) => [first, ...rest]);
const table = fc.integer({ min: 1, max: 5 }).chain((w) => fc.array(row(w), { minLength: 1, maxLength: 12 }));

describe('parseCsv', () => {
  it('round-trips any RFC 4180 table (LF or CRLF, with or without BOM and trailing newline)', () => {
    fc.assert(
      fc.property(table, fc.constantFrom('\n', '\r\n'), fc.boolean(), fc.boolean(), (rows, eol, bom, trailing) => {
        const text = (bom ? '﻿' : '') + rows.map((r) => r.map(quote).join(',')).join(eol) + (trailing ? eol : '');
        const parsed = parseCsv(text);
        expect(parsed.issues).toEqual([]);
        expect(parsed.records.map((r) => r.cells)).toEqual(rows.map((r) => r.map((c) => (quote(c) === c ? c.trim() : c))));
      }),
    );
  });

  it('numbers records by spreadsheet row and skips blank lines without renumbering', () => {
    const parsed = parseCsv('h1,h2\n\na,b\n , \nc,d\n');
    expect(parsed.records.map((r) => [r.row, r.cells[0]])).toEqual([
      [1, 'h1'],
      [3, 'a'],
      [5, 'c'],
    ]);
  });

  it('reports an unterminated quote as a file-level error', () => {
    const parsed = parseCsv('a,b\n"open,1\n');
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]).toMatchObject({ severity: 'error', code: 'malformed_csv', row: 2 });
  });

  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        const parsed = parseCsv(text);
        for (const r of parsed.records) expect(r.row).toBeGreaterThanOrEqual(1);
      }),
    );
  });
});
