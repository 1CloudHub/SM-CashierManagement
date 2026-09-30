/**
 * Ingestion validation (task 9.1; Req 17.2, 17.3). Pure: file text in,
 * row-numbered warnings/errors and normalised records out.
 *
 * A file with any error cannot be loaded (`canLoad === false`); the previous
 * snapshot stays current. Warnings are allowed after explicit confirmation.
 * Row numbers are spreadsheet rows (header = 1); row 0 is the whole file.
 */
import { normaliseHeader, type ColumnMapping, type DatasetType, type IngestionIssue, type IsoDate } from '@lanewise/shared';
import { resolveColumns } from './columns.js';
import { parseCsv } from './csv.js';

/** Largest number of data rows accepted in one file. */
export const MAX_DATA_ROWS = 500_000;

export interface PosRecord {
  readonly storeCode: string;
  readonly department: string;
  readonly date: IsoDate;
  readonly hour: number;
  readonly transactions: number;
  readonly lanesOpen: number | null;
  readonly avgHandleTimeMin: number | null;
}

export const STORE_FORMATS = ['sm_supermarket', 'sm_hypermarket', 'savemore', 'sm_store'] as const;
export type StoreFormat = (typeof STORE_FORMATS)[number];

export interface MasterRecord {
  readonly storeCode: string;
  readonly storeName: string;
  readonly regionCode: string;
  readonly format: StoreFormat;
  readonly department: string;
  readonly installedLanes: number;
  readonly handleTimeMin: number;
  readonly open: string;
  readonly close: string;
}

export const EMPLOYMENT_TYPES = ['regular', 'seasonal', 'part_time'] as const;

export interface StaffRecord {
  readonly employeeNo: string;
  readonly name: string;
  readonly storeCode: string;
  readonly department: string;
  readonly employmentType: (typeof EMPLOYMENT_TYPES)[number];
  /** 0 = Sunday … 6 = Saturday. */
  readonly preferredRestDay: number | null;
  readonly email: string | null;
}

export type DatasetRecord = PosRecord | MasterRecord | StaffRecord;

/** Master data the POS and staff files are checked against (same provenance). */
export interface ReferenceData {
  readonly departments: readonly { readonly storeCode: string; readonly department: string; readonly installedLanes: number }[];
}

export interface ValidateOptions {
  /** Load date: master/staff snapshots cover this day. */
  readonly asOf: IsoDate;
  readonly mapping?: ColumnMapping;
  /** `null` or empty when no master data is loaded yet. */
  readonly reference: ReferenceData | null;
}

export interface ValidationOutcome {
  /** Data rows (non-blank records after the header). */
  readonly rowCount: number;
  readonly validRowCount: number;
  readonly warningCount: number;
  readonly errorCount: number;
  /** Sorted by row, then column. */
  readonly issues: readonly IngestionIssue[];
  readonly canLoad: boolean;
  readonly coversFrom: IsoDate;
  readonly coversTo: IsoDate;
  /** Normalised valid records (all rows, when `canLoad`). */
  readonly records: readonly DatasetRecord[];
}

// ---------------------------------------------------------------------------
// Cell parsers
// ---------------------------------------------------------------------------

type Cell = { ok: true; value: string } | { ok: false };
type RowIssue = Omit<IngestionIssue, 'row'>;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-4]):([0-5]\d)$/;
const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function isCalendarDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function minutes(value: string): number {
  const m = TIME.exec(value) as RegExpExecArray;
  return Number(m[1]) * 60 + Number(m[2]);
}

function restDay(value: string): number | null {
  const v = value.trim().toLowerCase();
  if (/^[0-6]$/.test(v)) return Number(v);
  const byName = DAYS.findIndex((d) => d === v || d.slice(0, 3) === v);
  return byName >= 0 ? byName : null;
}

const key = (...parts: string[]): string => parts.map((p) => p.toLowerCase()).join('\u0000');

// ---------------------------------------------------------------------------
// Row reader: reads cells by canonical field and collects issues
// ---------------------------------------------------------------------------

class RowReader {
  readonly issues: RowIssue[] = [];

  constructor(
    private readonly cells: readonly string[],
    private readonly index: Readonly<Record<string, number | undefined>>,
  ) {}

  raw(field: string): string {
    const at = this.index[field];
    return at === undefined ? '' : (this.cells[at] ?? '').trim();
  }

  error(column: string, code: string, message: string): void {
    this.issues.push({ column, severity: 'error', code, message });
  }

  warn(column: string, code: string, message: string): void {
    this.issues.push({ column, severity: 'warning', code, message });
  }

  required(field: string): Cell {
    const value = this.raw(field);
    if (value.length === 0) {
      this.error(field, 'required', `${field} is required.`);
      return { ok: false };
    }
    return { ok: true, value };
  }

  int(field: string, min: number, max: number, required: boolean): number | null | undefined {
    const value = this.raw(field);
    if (value.length === 0) {
      if (required) this.error(field, 'required', `${field} is required.`);
      return required ? undefined : null;
    }
    const n = Number(value);
    if (!INTEGER.test(value) || n < min || n > max) {
      this.error(field, 'invalid_number', `${field} must be a whole number from ${min} to ${max} (got "${value}").`);
      return undefined;
    }
    return n;
  }

  positive(field: string, required: boolean): number | null | undefined {
    const value = this.raw(field);
    if (value.length === 0) {
      if (required) this.error(field, 'required', `${field} is required.`);
      return required ? undefined : null;
    }
    const n = Number(value);
    if (!DECIMAL.test(value) || !(n > 0)) {
      this.error(field, 'invalid_number', `${field} must be a number greater than 0 (got "${value}").`);
      return undefined;
    }
    if (n < 0.5 || n > 10) this.warn(field, 'handle_time_out_of_range', `${field} of ${value} minutes is outside the usual 0.5–10 minutes.`);
    return n;
  }
}

// ---------------------------------------------------------------------------
// Dataset validators
// ---------------------------------------------------------------------------

interface DatasetState {
  readonly seen: Map<string, number>;
  readonly stores: Map<string, { name: string; region: string; format: string; row: number }>;
  readonly emails: Map<string, number>;
  dates: { min: string; max: string } | null;
}

type RowValidator = (
  r: RowReader,
  row: number,
  state: DatasetState,
  reference: Map<string, number> | null,
) => DatasetRecord | null;

function checkReference(r: RowReader, reference: Map<string, number> | null, store: string, dept: string): number | undefined {
  if (!reference) return undefined;
  const lanes = reference.get(key(store, dept));
  if (lanes === undefined) {
    r.error('department', 'unknown_department', `Store ${store} has no department "${dept}" in the master data.`);
  }
  return lanes;
}

function duplicate(r: RowReader, state: DatasetState, k: string, row: number, what: string): boolean {
  const first = state.seen.get(k);
  if (first !== undefined) {
    r.error('', 'duplicate_row', `Duplicate ${what}: already on row ${first}.`);
    return true;
  }
  state.seen.set(k, row);
  return false;
}

const validatePos: RowValidator = (r, row, state, reference) => {
  const store = r.required('store_code');
  const dept = r.required('department');
  const dateRaw = r.required('date');
  let date: string | undefined;
  if (dateRaw.ok) {
    if (isCalendarDate(dateRaw.value)) date = dateRaw.value;
    else r.error('date', 'invalid_date', `date must be a calendar date as YYYY-MM-DD (got "${dateRaw.value}").`);
  }
  const hour = r.int('hour', 0, 23, true);
  const transactions = r.int('transactions', 0, 1_000_000, true);
  const lanesOpen = r.int('lanes_open', 0, 500, false);
  const aht = r.positive('avg_handle_time_min', false);
  if (!store.ok || !dept.ok) return null;
  const installed = checkReference(r, reference, store.value, dept.value);
  if (installed !== undefined && typeof lanesOpen === 'number' && lanesOpen > installed) {
    r.warn('lanes_open', 'lanes_over_installed', `lanes_open ${lanesOpen} is greater than the ${installed} installed lanes.`);
  }
  if (date === undefined || hour == null || transactions == null || lanesOpen === undefined || aht === undefined) return null;
  if (duplicate(r, state, key(store.value, dept.value, date, String(hour)), row, 'store, department, date and hour')) return null;
  if (r.issues.some((i) => i.severity === 'error')) return null;
  state.dates = state.dates
    ? { min: date < state.dates.min ? date : state.dates.min, max: date > state.dates.max ? date : state.dates.max }
    : { min: date, max: date };
  return { storeCode: store.value, department: dept.value, date, hour, transactions, lanesOpen, avgHandleTimeMin: aht };
};

const validateMaster: RowValidator = (r, row, state) => {
  const store = r.required('store_code');
  const name = r.required('store_name');
  const region = r.required('region_code');
  const formatRaw = r.required('format');
  const dept = r.required('department');
  let format: StoreFormat | undefined;
  if (formatRaw.ok) {
    const f = normaliseHeader(formatRaw.value);
    if ((STORE_FORMATS as readonly string[]).includes(f)) format = f as StoreFormat;
    else r.error('format', 'invalid_format', `format must be one of SM Supermarket, SM Hypermarket, SaveMore, SM Store (got "${formatRaw.value}").`);
  }
  const lanes = r.int('installed_lanes', 0, 500, true);
  if (lanes === 0) r.warn('installed_lanes', 'no_lanes', 'installed_lanes is 0: this department cannot be staffed.');
  const aht = r.positive('handle_time_min', true);
  const open = r.required('open');
  const close = r.required('close');
  let hours: { open: string; close: string } | undefined;
  if (open.ok && close.ok) {
    if (!TIME.test(open.value)) r.error('open', 'invalid_time', `open must be a time as HH:MM (got "${open.value}").`);
    else if (!TIME.test(close.value)) r.error('close', 'invalid_time', `close must be a time as HH:MM (got "${close.value}").`);
    else if (minutes(close.value) <= minutes(open.value) || minutes(open.value) >= 24 * 60) {
      r.error('close', 'invalid_trading_hours', `close ${close.value} must be after open ${open.value}.`);
    } else hours = { open: open.value, close: close.value };
  }
  if (!store.ok || !name.ok || !region.ok || !dept.ok || format === undefined || lanes == null || aht == null || !hours) return null;
  const known = state.stores.get(key(store.value));
  if (known && (known.name !== name.value || known.region !== region.value || known.format !== format)) {
    r.error('store_code', 'inconsistent_store', `Store ${store.value} has a different name, region or format than on row ${known.row}.`);
    return null;
  }
  if (duplicate(r, state, key(store.value, dept.value), row, 'store and department')) return null;
  if (r.issues.some((i) => i.severity === 'error')) return null;
  if (!known) state.stores.set(key(store.value), { name: name.value, region: region.value, format, row });
  return {
    storeCode: store.value,
    storeName: name.value,
    regionCode: region.value,
    format,
    department: dept.value,
    installedLanes: lanes,
    handleTimeMin: aht,
    open: hours.open,
    close: hours.close,
  };
};

const validateStaff: RowValidator = (r, row, state, reference) => {
  const no = r.required('employee_no');
  const name = r.required('name');
  const store = r.required('store_code');
  const dept = r.required('department');
  const typeRaw = r.required('employment_type');
  let employmentType: StaffRecord['employmentType'] | undefined;
  if (typeRaw.ok) {
    const t = normaliseHeader(typeRaw.value);
    if ((EMPLOYMENT_TYPES as readonly string[]).includes(t)) employmentType = t as StaffRecord['employmentType'];
    else r.error('employment_type', 'invalid_employment_type', `employment_type must be regular, seasonal or part time (got "${typeRaw.value}").`);
  }
  const restRaw = r.raw('preferred_rest_day');
  let rest: number | null | undefined = null;
  if (restRaw.length > 0) {
    rest = restDay(restRaw) ?? undefined;
    if (rest === undefined) r.error('preferred_rest_day', 'invalid_rest_day', `preferred_rest_day must be a weekday name or 0–6 (got "${restRaw}").`);
  }
  const emailRaw = r.raw('email').toLowerCase();
  let email: string | null | undefined = null;
  if (emailRaw.length > 0) {
    if (!EMAIL.test(emailRaw)) {
      r.error('email', 'invalid_email', `email "${emailRaw}" is not a valid email address.`);
      email = undefined;
    } else if (state.emails.has(emailRaw)) {
      r.error('email', 'duplicate_email', `email ${emailRaw} is already used on row ${state.emails.get(emailRaw)}.`);
      email = undefined;
    } else {
      state.emails.set(emailRaw, row);
      email = emailRaw;
    }
  }
  if (!no.ok || !name.ok || !store.ok || !dept.ok) return null;
  checkReference(r, reference, store.value, dept.value);
  if (employmentType === undefined || rest === undefined || email === undefined) return null;
  if (duplicate(r, state, key(store.value, no.value), row, 'employee number in this store')) return null;
  if (r.issues.some((i) => i.severity === 'error')) return null;
  return {
    employeeNo: no.value,
    name: name.value,
    storeCode: store.value,
    department: dept.value,
    employmentType,
    preferredRestDay: rest,
    email,
  };
};

const VALIDATORS: Record<DatasetType, RowValidator> = { pos: validatePos, master: validateMaster, staff: validateStaff };

function sortIssues(issues: IngestionIssue[]): IngestionIssue[] {
  return issues.sort((a, b) => a.row - b.row || (a.column ?? '').localeCompare(b.column ?? '') || a.code.localeCompare(b.code));
}

/** Validates one ingestion file. Deterministic; never throws on bad input. */
export function validateDataset(type: DatasetType, text: string, options: ValidateOptions): ValidationOutcome {
  const parsed = parseCsv(text);
  const issues: IngestionIssue[] = [...parsed.issues];
  const [header, ...data] = parsed.records;
  const fail = (extra: IngestionIssue[], rowCount: number): ValidationOutcome => {
    const all = sortIssues([...issues, ...extra]);
    return {
      rowCount,
      validRowCount: 0,
      warningCount: all.filter((i) => i.severity === 'warning').length,
      errorCount: all.filter((i) => i.severity === 'error').length,
      issues: all,
      canLoad: false,
      coversFrom: options.asOf,
      coversTo: options.asOf,
      records: [],
    };
  };

  if (!header || data.length === 0) {
    return fail([{ row: 0, severity: 'error', code: 'empty_file', message: 'The file has no data rows.' }], data.length);
  }
  if (data.length > MAX_DATA_ROWS) {
    return fail(
      [{ row: 0, severity: 'error', code: 'too_many_rows', message: `The file has more than ${MAX_DATA_ROWS} rows; split it.` }],
      data.length,
    );
  }
  if (parsed.issues.length > 0) return fail([], data.length);

  const columns = resolveColumns(type, header.cells, options.mapping);
  if (columns.issues.length > 0) return fail([...columns.issues], data.length);

  let reference: Map<string, number> | null = null;
  if (type !== 'master') {
    if (options.reference && options.reference.departments.length > 0) {
      reference = new Map(options.reference.departments.map((d) => [key(d.storeCode, d.department), d.installedLanes]));
    } else {
      issues.push({
        row: 0,
        severity: 'warning',
        code: 'no_master_reference',
        message: 'No store master data is loaded, so stores and departments were not checked.',
      });
    }
  }

  const state: DatasetState = { seen: new Map(), stores: new Map(), emails: new Map(), dates: null };
  const validate = VALIDATORS[type];
  const records: DatasetRecord[] = [];
  for (const record of data) {
    const reader = new RowReader(record.cells, columns.index);
    const result = validate(reader, record.row, state, reference);
    for (const issue of reader.issues) {
      issues.push(issue.column ? { row: record.row, ...issue } : { row: record.row, severity: issue.severity, code: issue.code, message: issue.message });
    }
    if (result) records.push(result);
  }

  const all = sortIssues(issues);
  const errorCount = all.filter((i) => i.severity === 'error').length;
  const covers = type === 'pos' && state.dates ? state.dates : { min: options.asOf, max: options.asOf };
  return {
    rowCount: data.length,
    validRowCount: records.length,
    warningCount: all.length - errorCount,
    errorCount,
    issues: all,
    canLoad: errorCount === 0,
    coversFrom: covers.min,
    coversTo: covers.max,
    records: errorCount === 0 ? records : [],
  };
}
