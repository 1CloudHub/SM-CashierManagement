/**
 * Ingestion validation (task 9.1; Req 17.2, 17.3). Property tests over
 * generated POS / master / staff files:
 *   - clean files produce no errors, every row is valid and loadable;
 *   - a corruption in data row k produces an error that names row k, and the
 *     file is not loadable (the load is blocked, Req 17.3);
 *   - issue rows are always within the file, sorted, and validRowCount +
 *     rows-with-errors = rowCount;
 *   - column order does not matter (auto-mapping), and validation is
 *     deterministic.
 */
import { DATASET_COLUMNS, type DatasetType } from '@lanewise/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { resolveColumns } from '../../src/ingestion/columns.js';
import { validateDataset, type ReferenceData, type ValidationOutcome } from '../../src/ingestion/validate.js';

const AS_OF = '2026-09-30';

function csv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const q = (c: string): string => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return [header, ...rows].map((r) => r.map(q).join(',')).join('\n');
}

function invariants(outcome: ValidationOutcome): void {
  const rows = outcome.issues.map((i) => i.row);
  expect(rows).toEqual([...rows].sort((a, b) => a - b));
  for (const r of rows) {
    expect(r).toBeGreaterThanOrEqual(0);
  }
  const errorRows = new Set(outcome.issues.filter((i) => i.severity === 'error' && i.row > 1).map((i) => i.row));
  const fileError = outcome.issues.some((i) => i.severity === 'error' && i.row <= 1);
  if (fileError) expect(outcome.validRowCount).toBe(0);
  else expect(outcome.validRowCount + errorRows.size).toBe(outcome.rowCount);
  expect(outcome.canLoad).toBe(outcome.errorCount === 0);
  expect(outcome.errorCount).toBe(outcome.issues.filter((i) => i.severity === 'error').length);
  expect(outcome.warningCount).toBe(outcome.issues.filter((i) => i.severity === 'warning').length);
}

// --- generators ------------------------------------------------------------

const STORES = ['SMQC', 'SMMOA', 'SMMEG'];
const DEPTS = ['Main lanes', 'Express'];
const reference: ReferenceData = {
  departments: STORES.flatMap((s) => DEPTS.map((d) => ({ storeCode: s, department: d, installedLanes: 12 }))),
};

const posRow = fc.record({
  store: fc.constantFrom(...STORES),
  dept: fc.constantFrom(...DEPTS),
  day: fc.integer({ min: 1, max: 28 }),
  hour: fc.integer({ min: 0, max: 23 }),
  tx: fc.integer({ min: 0, max: 900 }),
  lanes: fc.option(fc.integer({ min: 0, max: 12 }), { nil: undefined }),
});
const posFile = fc
  .uniqueArray(posRow, { minLength: 1, maxLength: 40, selector: (r) => `${r.store}|${r.dept}|${r.day}|${r.hour}` })
  .map((rows) =>
    rows.map((r) => [
      r.store,
      r.dept,
      `2025-12-${String(r.day).padStart(2, '0')}`,
      String(r.hour),
      String(r.tx),
      r.lanes === undefined ? '' : String(r.lanes),
      '',
    ]),
  );
const POS_HEADER = DATASET_COLUMNS.pos.map((c) => c.field);

const masterFile = fc
  .uniqueArray(fc.record({ store: fc.constantFrom(...STORES), dept: fc.constantFrom(...DEPTS), lanes: fc.integer({ min: 1, max: 40 }) }), {
    minLength: 1,
    maxLength: 6,
    selector: (r) => `${r.store}|${r.dept}`,
  })
  .map((rows) =>
    rows.map((r) => [r.store, `SM ${r.store}`, 'NCR', 'SM Supermarket', r.dept, String(r.lanes), '2.5', '10:00', '22:00']),
  );
const MASTER_HEADER = DATASET_COLUMNS.master.map((c) => c.field);

const staffFile = fc
  .uniqueArray(
    fc.record({
      no: fc.integer({ min: 1, max: 9999 }),
      store: fc.constantFrom(...STORES),
      dept: fc.constantFrom(...DEPTS),
      type: fc.constantFrom('regular', 'seasonal', 'part_time', 'Part time'),
      rest: fc.constantFrom('', 'Sun', 'monday', '3'),
    }),
    { minLength: 1, maxLength: 20, selector: (r) => r.no },
  )
  .map((rows) => rows.map((r) => [`E-${r.no}`, 'Ana Reyes', r.store, r.dept, r.type, r.rest, `e${r.no}@smretail.com`]));
const STAFF_HEADER = DATASET_COLUMNS.staff.map((c) => c.field);

const CASES: Record<DatasetType, { header: readonly string[]; file: fc.Arbitrary<string[][]>; corrupt: readonly [number, string][] }> = {
  pos: { header: POS_HEADER, file: posFile, corrupt: [[0, ''], [2, '2025-13-40'], [3, '24'], [4, '-1'], [5, 'x']] },
  master: { header: MASTER_HEADER, file: masterFile, corrupt: [[0, ''], [3, 'kiosk'], [5, 'many'], [6, '0'], [8, '09:00']] },
  staff: { header: STAFF_HEADER, file: staffFile, corrupt: [[1, ''], [4, 'contractor'], [5, 'Funday'], [6, 'not-an-email']] },
};

describe.each(Object.keys(CASES) as DatasetType[])('validateDataset(%s)', (type) => {
  const { header, file, corrupt } = CASES[type];

  it('a clean file has no errors and every row is valid', () => {
    fc.assert(
      fc.property(file, (rows) => {
        const outcome = validateDataset(type, csv(header, rows), { asOf: AS_OF, reference });
        invariants(outcome);
        expect(outcome.issues.filter((i) => i.severity === 'error')).toEqual([]);
        expect(outcome.rowCount).toBe(rows.length);
        expect(outcome.validRowCount).toBe(rows.length);
        expect(outcome.records).toHaveLength(rows.length);
        expect(outcome.canLoad).toBe(true);
      }),
    );
  });

  it('a corrupted cell in data row k blocks the load with an error on row k', () => {
    fc.assert(
      fc.property(file, fc.nat(), fc.constantFrom(...corrupt), (rows, k, [col, bad]) => {
        const idx = k % rows.length;
        const broken = rows.map((r, i) => (i === idx ? r.map((c, j) => (j === col ? bad : c)) : r));
        const outcome = validateDataset(type, csv(header, broken), { asOf: AS_OF, reference });
        invariants(outcome);
        expect(outcome.canLoad).toBe(false);
        expect(outcome.issues.some((i) => i.severity === 'error' && i.row === idx + 2)).toBe(true);
      }),
    );
  });

  it('column order does not matter and validation is deterministic', () => {
    fc.assert(
      fc.property(file, fc.func(fc.integer()), (rows, rank) => {
        const order = header.map((_, i) => i).sort((a, b) => rank(a) - rank(b) || a - b);
        const permuted = csv(
          order.map((i) => header[i] as string),
          rows.map((r) => order.map((i) => r[i] as string)),
        );
        const a = validateDataset(type, csv(header, rows), { asOf: AS_OF, reference });
        const b = validateDataset(type, permuted, { asOf: AS_OF, reference });
        expect(b).toEqual(a);
        expect(validateDataset(type, permuted, { asOf: AS_OF, reference })).toEqual(b);
      }),
    );
  });
});

describe('dataset-specific rules', () => {
  it('POS: lanes open above installed lanes is a warning, not an error', () => {
    const outcome = validateDataset(
      'pos',
      csv(POS_HEADER, [['SMQC', 'Main lanes', '2025-12-19', '14', '600', '13', '']]),
      { asOf: AS_OF, reference },
    );
    expect(outcome.canLoad).toBe(true);
    expect(outcome.issues).toEqual([
      expect.objectContaining({ row: 2, severity: 'warning', code: 'lanes_over_installed', column: 'lanes_open' }),
    ]);
  });

  it('POS: duplicate store/department/date/hour rows are errors naming the first row', () => {
    const row = ['SMQC', 'Main lanes', '2025-12-19', '14', '600', '', ''];
    const outcome = validateDataset('pos', csv(POS_HEADER, [row, row]), { asOf: AS_OF, reference });
    expect(outcome.canLoad).toBe(false);
    expect(outcome.issues).toEqual([expect.objectContaining({ row: 3, code: 'duplicate_row' })]);
    expect(outcome.issues[0]?.message).toContain('row 2');
  });

  it('POS: unknown store/department is an error when master data exists, a file warning otherwise', () => {
    const rows = [['SMXX', 'Main lanes', '2025-12-19', '14', '600', '', '']];
    const withRef = validateDataset('pos', csv(POS_HEADER, rows), { asOf: AS_OF, reference });
    expect(withRef.issues).toEqual([expect.objectContaining({ row: 2, code: 'unknown_department', severity: 'error' })]);
    const noRef = validateDataset('pos', csv(POS_HEADER, rows), { asOf: AS_OF, reference: null });
    expect(noRef.canLoad).toBe(true);
    expect(noRef.issues).toEqual([expect.objectContaining({ row: 0, code: 'no_master_reference', severity: 'warning' })]);
  });

  it('POS: covers the min..max date of the file', () => {
    const outcome = validateDataset(
      'pos',
      csv(POS_HEADER, [
        ['SMQC', 'Main lanes', '2025-12-19', '14', '600', '', ''],
        ['SMQC', 'Main lanes', '2025-08-01', '10', '100', '', ''],
      ]),
      { asOf: AS_OF, reference },
    );
    expect([outcome.coversFrom, outcome.coversTo]).toEqual(['2025-08-01', '2025-12-19']);
  });

  it('master/staff files cover the load date', () => {
    const outcome = validateDataset('staff', csv(STAFF_HEADER, [['E-1', 'Ana', 'SMQC', 'Main lanes', 'regular', '', '']]), {
      asOf: AS_OF,
      reference,
    });
    expect([outcome.coversFrom, outcome.coversTo]).toEqual([AS_OF, AS_OF]);
  });

  it('master: one store must have consistent name/region/format across rows', () => {
    const outcome = validateDataset(
      'master',
      csv(MASTER_HEADER, [
        ['SMQC', 'SM QC', 'NCR', 'SM Supermarket', 'Main lanes', '12', '2.5', '10:00', '22:00'],
        ['SMQC', 'SM North', 'NCR', 'SM Supermarket', 'Express', '4', '1.5', '10:00', '22:00'],
      ]),
      { asOf: AS_OF, reference: null },
    );
    expect(outcome.issues).toEqual([expect.objectContaining({ row: 3, code: 'inconsistent_store' })]);
  });

  it('a missing required column is a file-level error and nothing is valid', () => {
    const outcome = validateDataset('pos', csv(['store_code', 'date'], [['SMQC', '2025-12-19']]), {
      asOf: AS_OF,
      reference,
    });
    expect(outcome.canLoad).toBe(false);
    expect(outcome.validRowCount).toBe(0);
    expect(outcome.issues.filter((i) => i.row === 0 && i.code === 'missing_column').map((i) => i.column)).toEqual([
      'department',
      'hour',
      'transactions',
    ]);
  });

  it('an empty file is an error', () => {
    const outcome = validateDataset('master', '', { asOf: AS_OF, reference: null });
    expect(outcome.canLoad).toBe(false);
    expect(outcome.issues[0]).toMatchObject({ row: 0, code: 'empty_file' });
  });
});

describe('resolveColumns', () => {
  it('auto-maps headers by normalised name and honours an explicit mapping', () => {
    expect(resolveColumns('pos', ['Store Code', 'Department', 'Date', 'Hour', 'Transactions']).issues).toEqual([]);
    const mapped = resolveColumns('pos', ['Branch', 'Dept', 'Day', 'Hr', 'Tx'], {
      store_code: 'Branch',
      department: 'Dept',
      date: 'Day',
      hour: 'Hr',
      transactions: 'Tx',
    });
    expect(mapped.issues).toEqual([]);
    expect(mapped.index.transactions).toBe(4);
  });

  it('rejects a mapping to a header that is not in the file or a field that does not exist', () => {
    const result = resolveColumns('pos', POS_HEADER, { store_code: 'Nope', bogus: 'hour' });
    expect(result.issues.map((i) => i.code).sort()).toEqual(['unknown_field', 'unmapped_header']);
  });

  it('every required field whose header is present is mapped, for any header order', () => {
    fc.assert(
      fc.property(fc.constantFrom<DatasetType>('pos', 'master', 'staff'), fc.func(fc.integer()), (type, rank) => {
        const headers = DATASET_COLUMNS[type].map((c) => c.field.toUpperCase().replace(/_/g, ' '));
        headers.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
        const result = resolveColumns(type, headers);
        expect(result.issues).toEqual([]);
        for (const c of DATASET_COLUMNS[type]) expect(headers[result.index[c.field] as number]).toBe(c.field.toUpperCase().replace(/_/g, ' '));
      }),
    );
  });
});
