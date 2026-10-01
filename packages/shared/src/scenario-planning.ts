/**
 * Scenario planning contracts (task 11; Req 8.1–8.6; P3, P4, P5, P6).
 *
 * Pure helpers shared by the API and the SPA:
 *
 *  - scenario settings (the v3 inputs the engine consumes) with defaults and
 *    a dependency-free validator;
 *  - the staleness rule (P5): a scenario is stale exactly when a pinned
 *    snapshot or rule version is superseded by a newer current one, or its
 *    settings changed after its last run;
 *  - the submit gate (stale or never-run scenarios cannot be submitted);
 *  - compare: settings diff and result deltas (headcount, hours, cost, peak
 *    lanes), overall and by store.
 */
import type { IsoDate, IsoDateTime } from './entities.js';
import { isIsoDate, type ContractTypeKey } from './rules.js';
import type { ScenarioStatus } from './scenario.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Full-time shift pattern: paid hours + unpaid meal hour (SCR-031 "Shift rules"). */
export const FT_SHIFT_PATTERNS = ['8+1', '7+1'] as const;
export type FtShiftPattern = (typeof FT_SHIFT_PATTERNS)[number];

/** Per-department demand override; `null` keeps the value learned from POS. */
export interface ScenarioDepartmentOverride {
  readonly departmentId: string;
  /** Normal-weekday transactions per day. */
  readonly baselineTxPerDay: number | null;
  /** Average handle time (minutes per transaction). */
  readonly handleTimeMin: number | null;
  /** Seasonal uplift over the baseline (%). */
  readonly upliftPct: number | null;
}

export const DEPARTMENT_OVERRIDE_FIELDS = ['baselineTxPerDay', 'handleTimeMin', 'upliftPct'] as const;
export type DepartmentOverrideField = (typeof DEPARTMENT_OVERRIDE_FIELDS)[number];

export interface ScenarioSettingsValues {
  /** Year-over-year volume growth multiplier, e.g. 1.05 for +5 %. */
  readonly growth: number;
  readonly allowPartTime: boolean;
  /** Season window planned by a run (inclusive). */
  readonly planningFrom: IsoDate;
  readonly planningTo: IsoDate;
  /** Day whose network peak is reported (e.g. the busiest Saturday). */
  readonly peakDay: IsoDate;
  readonly notes: string;
  // Overrides of the pinned rule versions. `null` = use the rule's value
  // (`ScenarioDetail.defaults`), so a scenario only records what it changes.
  /** Service and labor standards: share of customers served within `waitSeconds` (%). */
  readonly servedWithinPct: number | null;
  readonly waitSeconds: number | null;
  /** Cashiers per open lane (breaks, training, absence), e.g. 1.17. */
  readonly shrinkage: number | null;
  readonly minOpenLanes: number | null;
  /** Shift rules. */
  readonly ftShiftPattern: FtShiftPattern | null;
  readonly ptShiftHours: number | null;
  readonly maxPtSharePct: number | null;
  readonly mealEarliestAfterHours: number | null;
  readonly absenceReservePct: number | null;
  /** Labor rules (roster). */
  readonly ftMaxDaysPerWeek: number | null;
  readonly ftMaxHoursPerWeek: number | null;
  readonly ptMaxDaysPerWeek: number | null;
  readonly ptMaxHoursPerWeek: number | null;
  readonly minRestHours: number | null;
  readonly maxConsecutiveDays: number | null;
  readonly respectPreferredRestDay: boolean | null;
  /** Per-department demand overrides (only departments with at least one override). */
  readonly departmentOverrides: readonly ScenarioDepartmentOverride[];
}

/** Settings that override a pinned rule value (`null` = rule default). */
export const SCENARIO_OVERRIDE_KEYS = [
  'servedWithinPct',
  'waitSeconds',
  'shrinkage',
  'minOpenLanes',
  'ftShiftPattern',
  'ptShiftHours',
  'maxPtSharePct',
  'mealEarliestAfterHours',
  'absenceReservePct',
  'ftMaxDaysPerWeek',
  'ftMaxHoursPerWeek',
  'ptMaxDaysPerWeek',
  'ptMaxHoursPerWeek',
  'minRestHours',
  'maxConsecutiveDays',
  'respectPreferredRestDay',
] as const;
export type ScenarioOverrideKey = (typeof SCENARIO_OVERRIDE_KEYS)[number];

/** Single-valued settings, in display (and compare) order. */
export const SCENARIO_SCALAR_SETTING_KEYS = [
  'growth',
  'allowPartTime',
  'planningFrom',
  'planningTo',
  'peakDay',
  ...SCENARIO_OVERRIDE_KEYS,
  'notes',
] as const;
export type ScenarioScalarSettingKey = (typeof SCENARIO_SCALAR_SETTING_KEYS)[number];

export const SCENARIO_SETTING_KEYS = [...SCENARIO_SCALAR_SETTING_KEYS, 'departmentOverrides'] as const;
export type ScenarioSettingKey = (typeof SCENARIO_SETTING_KEYS)[number];

/** Numeric override keys and their accepted ranges (inclusive). */
export const SCENARIO_NUMERIC_RANGES = {
  servedWithinPct: { min: 50, max: 99, integer: false },
  waitSeconds: { min: 10, max: 600, integer: true },
  shrinkage: { min: 1, max: 2, integer: false },
  minOpenLanes: { min: 0, max: 20, integer: true },
  ptShiftHours: { min: 2, max: 8, integer: false },
  maxPtSharePct: { min: 0, max: 100, integer: false },
  mealEarliestAfterHours: { min: 2, max: 6, integer: false },
  absenceReservePct: { min: 0, max: 30, integer: false },
  ftMaxDaysPerWeek: { min: 1, max: 7, integer: true },
  ftMaxHoursPerWeek: { min: 8, max: 72, integer: false },
  ptMaxDaysPerWeek: { min: 1, max: 7, integer: true },
  ptMaxHoursPerWeek: { min: 4, max: 48, integer: false },
  minRestHours: { min: 6, max: 24, integer: false },
  maxConsecutiveDays: { min: 1, max: 13, integer: true },
} as const satisfies Partial<Record<ScenarioOverrideKey, { min: number; max: number; integer: boolean }>>;
export type ScenarioNumericOverrideKey = keyof typeof SCENARIO_NUMERIC_RANGES;

export const DEPARTMENT_OVERRIDE_RANGES = {
  baselineTxPerDay: { min: 0, max: 100_000, integer: false },
  handleTimeMin: { min: 0.1, max: 30, integer: false },
  upliftPct: { min: -50, max: 500, integer: false },
} as const satisfies Record<DepartmentOverrideField, { min: number; max: number; integer: boolean }>;

/** Most department rows a scenario may override. */
export const SCENARIO_MAX_DEPARTMENT_OVERRIDES = 500;

export const DEFAULT_SCENARIO_SETTINGS: ScenarioSettingsValues = {
  growth: 1.05,
  allowPartTime: true,
  planningFrom: '2026-12-01',
  planningTo: '2026-12-31',
  peakDay: '2026-12-19',
  notes: '',
  servedWithinPct: null,
  waitSeconds: null,
  shrinkage: null,
  minOpenLanes: null,
  ftShiftPattern: null,
  ptShiftHours: null,
  maxPtSharePct: null,
  mealEarliestAfterHours: null,
  absenceReservePct: null,
  ftMaxDaysPerWeek: null,
  ftMaxHoursPerWeek: null,
  ptMaxDaysPerWeek: null,
  ptMaxHoursPerWeek: null,
  minRestHours: null,
  maxConsecutiveDays: null,
  respectPreferredRestDay: null,
  departmentOverrides: [],
};

/**
 * The value each override falls back to — the pinned rule versions' values
 * (or the documented engine default where no rule carries it). The API sends
 * it with every scenario so SCR-031 can mark "edited · default X".
 */
export type ScenarioSettingDefaults = { readonly [K in ScenarioOverrideKey]: NonNullable<ScenarioSettingsValues[K]> };

/**
 * Engine defaults for overrides no pinned rule version carries (the
 * documented `@lanewise/domain` demo rule values). The API overlays the
 * pinned rule payloads on these to build `ScenarioDetail.defaults`.
 */
export const ENGINE_SETTING_DEFAULTS: ScenarioSettingDefaults = {
  servedWithinPct: 90,
  waitSeconds: 60,
  shrinkage: 1.17,
  minOpenLanes: 1,
  ftShiftPattern: '8+1',
  ptShiftHours: 4,
  maxPtSharePct: 100,
  mealEarliestAfterHours: 4,
  absenceReservePct: 0,
  ftMaxDaysPerWeek: 6,
  ftMaxHoursPerWeek: 48,
  ptMaxDaysPerWeek: 6,
  ptMaxHoursPerWeek: 30,
  minRestHours: 10,
  maxConsecutiveDays: 6,
  respectPreferredRestDay: true,
};

/** The value a run uses for `key`: the override, else the rule default. */
export function effectiveSetting<K extends ScenarioOverrideKey>(
  settings: ScenarioSettingsValues,
  defaults: ScenarioSettingDefaults,
  key: K,
): ScenarioSettingDefaults[K] {
  const v = settings[key];
  return (v ?? defaults[key]) as ScenarioSettingDefaults[K];
}

/** Department baseline learned from the pinned POS snapshot (SCR-031 overrides table). */
export interface ScenarioDepartmentBaseline {
  readonly departmentId: string;
  readonly departmentName: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly baselineTxPerDay: number;
  readonly handleTimeMin: number;
  readonly upliftPct: number;
}

export const SCENARIO_GROWTH_RANGE = { min: 0.5, max: 2 } as const;
/** Longest season a synchronous run plans (days). */
export const SCENARIO_MAX_PLANNING_DAYS = 92;

export interface ScenarioSettingsIssue {
  readonly path: ScenarioSettingKey;
  readonly message: string;
  /** For `departmentOverrides`: the row and field at fault. */
  readonly index?: number;
  readonly departmentId?: string;
  readonly field?: DepartmentOverrideField | 'departmentId';
}

export type ScenarioSettingsValidation =
  | { readonly ok: true; readonly settings: ScenarioSettingsValues }
  | { readonly ok: false; readonly issues: readonly ScenarioSettingsIssue[] };

const DAY_MS = 86_400_000;

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function inRange(value: unknown, range: { readonly min: number; readonly max: number; readonly integer: boolean }): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= range.min &&
    value <= range.max &&
    (!range.integer || Number.isInteger(value))
  );
}

function rangeMessage(range: { readonly min: number; readonly max: number; readonly integer: boolean }): string {
  return `Must be ${range.integer ? 'a whole number' : 'a number'} from ${range.min} to ${range.max}, or empty for the default.`;
}

/**
 * Validates complete settings. Unknown keys are rejected so a typo never
 * silently falls back to a default. Override keys may be left out (they mean
 * "use the rule default"), so clients written before they existed keep working.
 */
export function validateScenarioSettings(value: unknown): ScenarioSettingsValidation {
  const issues: ScenarioSettingsIssue[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, issues: [{ path: 'growth', message: 'Settings must be an object.' }] };
  }
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!(SCENARIO_SETTING_KEYS as readonly string[]).includes(key)) {
      issues.push({ path: 'notes', message: `Unknown setting "${key}".` });
    }
  }
  const { growth, allowPartTime, planningFrom, planningTo, peakDay, notes } = v;
  if (typeof growth !== 'number' || !Number.isFinite(growth) || growth < SCENARIO_GROWTH_RANGE.min || growth > SCENARIO_GROWTH_RANGE.max) {
    issues.push({ path: 'growth', message: `Must be a number from ${SCENARIO_GROWTH_RANGE.min} to ${SCENARIO_GROWTH_RANGE.max}.` });
  }
  if (typeof allowPartTime !== 'boolean') issues.push({ path: 'allowPartTime', message: 'Must be true or false.' });
  if (!isIsoDate(planningFrom)) issues.push({ path: 'planningFrom', message: 'Must be a date (YYYY-MM-DD).' });
  if (!isIsoDate(planningTo)) issues.push({ path: 'planningTo', message: 'Must be a date (YYYY-MM-DD).' });
  if (!isIsoDate(peakDay)) issues.push({ path: 'peakDay', message: 'Must be a date (YYYY-MM-DD).' });
  if (isIsoDate(planningFrom) && isIsoDate(planningTo)) {
    const span = daysBetween(planningFrom, planningTo);
    if (span < 0) issues.push({ path: 'planningTo', message: 'Must be on or after the start date.' });
    else if (span + 1 > SCENARIO_MAX_PLANNING_DAYS) {
      issues.push({ path: 'planningTo', message: `A season can cover at most ${SCENARIO_MAX_PLANNING_DAYS} days.` });
    }
    if (isIsoDate(peakDay) && (peakDay < planningFrom || peakDay > planningTo)) {
      issues.push({ path: 'peakDay', message: 'Must fall within the season.' });
    }
  }
  if (typeof notes !== 'string' || notes.length > 2000) issues.push({ path: 'notes', message: 'At most 2000 characters.' });

  const numeric = {} as Record<ScenarioNumericOverrideKey, number | null>;
  for (const key of Object.keys(SCENARIO_NUMERIC_RANGES) as ScenarioNumericOverrideKey[]) {
    const raw = v[key];
    const range = SCENARIO_NUMERIC_RANGES[key];
    if (raw === undefined || raw === null) numeric[key] = null;
    else if (inRange(raw, range)) numeric[key] = raw;
    else issues.push({ path: key, message: rangeMessage(range) });
  }
  const pattern = v.ftShiftPattern ?? null;
  if (pattern !== null && !(FT_SHIFT_PATTERNS as readonly unknown[]).includes(pattern)) {
    issues.push({ path: 'ftShiftPattern', message: `Must be one of ${FT_SHIFT_PATTERNS.join(', ')}, or empty for the default.` });
  }
  const restDay = v.respectPreferredRestDay ?? null;
  if (restDay !== null && typeof restDay !== 'boolean') {
    issues.push({ path: 'respectPreferredRestDay', message: 'Must be true, false or empty for the default.' });
  }
  if (
    numeric.ptMaxHoursPerWeek !== null &&
    numeric.ftMaxHoursPerWeek !== null &&
    numeric.ptMaxHoursPerWeek > numeric.ftMaxHoursPerWeek
  ) {
    issues.push({ path: 'ptMaxHoursPerWeek', message: 'Must not exceed the full-time weekly maximum.' });
  }

  const departmentOverrides: ScenarioDepartmentOverride[] = [];
  const rawDepartments = v.departmentOverrides ?? [];
  if (!Array.isArray(rawDepartments) || rawDepartments.length > SCENARIO_MAX_DEPARTMENT_OVERRIDES) {
    issues.push({ path: 'departmentOverrides', message: `Must be a list of at most ${SCENARIO_MAX_DEPARTMENT_OVERRIDES} departments.` });
  } else {
    const seen = new Set<string>();
    rawDepartments.forEach((row: unknown, index) => {
      const r = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>;
      const id = r.departmentId;
      if (typeof id !== 'string' || id.trim() === '' || seen.has(id)) {
        issues.push({ path: 'departmentOverrides', index, field: 'departmentId', message: 'Each row needs a distinct department.' });
        return;
      }
      seen.add(id);
      const extra = Object.keys(r).filter((k) => k !== 'departmentId' && !(DEPARTMENT_OVERRIDE_FIELDS as readonly string[]).includes(k));
      if (extra.length > 0) {
        issues.push({ path: 'departmentOverrides', index, departmentId: id, field: 'departmentId', message: `Unknown field "${extra[0]}".` });
      }
      const out: Record<DepartmentOverrideField, number | null> = { baselineTxPerDay: null, handleTimeMin: null, upliftPct: null };
      for (const field of DEPARTMENT_OVERRIDE_FIELDS) {
        const raw = r[field];
        const range = DEPARTMENT_OVERRIDE_RANGES[field];
        if (raw === undefined || raw === null) continue;
        if (inRange(raw, range)) out[field] = raw;
        else issues.push({ path: 'departmentOverrides', index, departmentId: id, field, message: rangeMessage(range) });
      }
      if (DEPARTMENT_OVERRIDE_FIELDS.some((f) => out[f] !== null)) departmentOverrides.push({ departmentId: id, ...out });
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    settings: {
      growth: growth as number,
      allowPartTime: allowPartTime as boolean,
      planningFrom: planningFrom as IsoDate,
      planningTo: planningTo as IsoDate,
      peakDay: peakDay as IsoDate,
      notes: notes as string,
      ...numeric,
      ftShiftPattern: pattern as FtShiftPattern | null,
      respectPreferredRestDay: restDay as boolean | null,
      departmentOverrides,
    },
  };
}

function readDepartmentOverrides(stored: unknown): ScenarioDepartmentOverride[] {
  if (!Array.isArray(stored)) return [];
  const out: ScenarioDepartmentOverride[] = [];
  for (const row of stored as unknown[]) {
    const r = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>;
    if (typeof r.departmentId !== 'string' || out.some((o) => o.departmentId === r.departmentId)) continue;
    const pick = (f: DepartmentOverrideField) => (inRange(r[f], DEPARTMENT_OVERRIDE_RANGES[f]) ? (r[f] as number) : null);
    const o = { departmentId: r.departmentId, baselineTxPerDay: pick('baselineTxPerDay'), handleTimeMin: pick('handleTimeMin'), upliftPct: pick('upliftPct') };
    if (DEPARTMENT_OVERRIDE_FIELDS.some((f) => o[f] !== null)) out.push(o);
  }
  return out;
}

/**
 * Reads stored settings leniently: known keys of the right type are kept,
 * anything else falls back to the default (older rows may carry extra keys
 * or lack the override keys).
 */
export function readScenarioSettings(stored: unknown): ScenarioSettingsValues {
  const v = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>;
  const d = DEFAULT_SCENARIO_SETTINGS;
  const numeric = {} as Record<ScenarioNumericOverrideKey, number | null>;
  for (const key of Object.keys(SCENARIO_NUMERIC_RANGES) as ScenarioNumericOverrideKey[]) {
    numeric[key] = inRange(v[key], SCENARIO_NUMERIC_RANGES[key]) ? (v[key] as number) : null;
  }
  return {
    growth: typeof v.growth === 'number' && Number.isFinite(v.growth) ? v.growth : d.growth,
    allowPartTime: typeof v.allowPartTime === 'boolean' ? v.allowPartTime : d.allowPartTime,
    planningFrom: isIsoDate(v.planningFrom) ? v.planningFrom : d.planningFrom,
    planningTo: isIsoDate(v.planningTo) ? v.planningTo : d.planningTo,
    peakDay: isIsoDate(v.peakDay) ? v.peakDay : d.peakDay,
    notes: typeof v.notes === 'string' ? v.notes : d.notes,
    ...numeric,
    ftShiftPattern: (FT_SHIFT_PATTERNS as readonly unknown[]).includes(v.ftShiftPattern) ? (v.ftShiftPattern as FtShiftPattern) : null,
    respectPreferredRestDay: typeof v.respectPreferredRestDay === 'boolean' ? v.respectPreferredRestDay : null,
    departmentOverrides: readDepartmentOverrides(v.departmentOverrides),
  };
}

/** One changed single-valued setting, typed by key (so a formatter can switch on `key`). */
export type ScenarioSettingsChange = {
  readonly [K in ScenarioScalarSettingKey]: {
    readonly key: K;
    readonly from: ScenarioSettingsValues[K];
    readonly to: ScenarioSettingsValues[K];
  };
}[ScenarioScalarSettingKey];

/** Settings that differ between A and B, in display order (SCR-032 "only changed"). */
export function diffScenarioSettings(a: ScenarioSettingsValues, b: ScenarioSettingsValues): ScenarioSettingsChange[] {
  return SCENARIO_SCALAR_SETTING_KEYS.filter((k) => a[k] !== b[k]).map(
    (key) => ({ key, from: a[key], to: b[key] }) as ScenarioSettingsChange,
  );
}

/** One changed per-department override (SCR-032 "Cebu main lanes handle time 2.5 → 2.7"). */
export interface DepartmentSettingsChange {
  readonly departmentId: string;
  readonly field: DepartmentOverrideField;
  /** `null` = the learned value. */
  readonly from: number | null;
  readonly to: number | null;
}

/** Department overrides that differ between A and B, ordered by department id then field. */
export function diffDepartmentOverrides(
  a: readonly ScenarioDepartmentOverride[],
  b: readonly ScenarioDepartmentOverride[],
): DepartmentSettingsChange[] {
  const ids = [...new Set([...a, ...b].map((o) => o.departmentId))].sort();
  const out: DepartmentSettingsChange[] = [];
  for (const departmentId of ids) {
    const oa = a.find((o) => o.departmentId === departmentId);
    const ob = b.find((o) => o.departmentId === departmentId);
    for (const field of DEPARTMENT_OVERRIDE_FIELDS) {
      const from = oa?.[field] ?? null;
      const to = ob?.[field] ?? null;
      if (from !== to) out.push({ departmentId, field, from, to });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Staleness (P5)
// ---------------------------------------------------------------------------

export const STALE_REASONS = ['snapshot_superseded', 'rules_superseded', 'settings_changed'] as const;
export type StaleReason = (typeof STALE_REASONS)[number];

export interface StalenessInput {
  /** Pinned snapshot id per dataset type. */
  readonly pinnedSnapshots: Readonly<Record<string, string>>;
  /** The current (latest loaded) snapshot id per dataset type, same provenance. */
  readonly currentSnapshots: Readonly<Record<string, string | undefined>>;
  /** Pinned rule version id per rule set. */
  readonly pinnedRuleVersions: Readonly<Record<string, string>>;
  /** The in-force published rule version id per rule set, same provenance. */
  readonly currentRuleVersions: Readonly<Record<string, string | undefined>>;
  readonly settingsChangedAt: IsoDateTime;
  readonly lastRunAt: IsoDateTime | null;
}

export interface Staleness {
  readonly stale: boolean;
  readonly reasons: readonly StaleReason[];
}

function superseded(pinned: Readonly<Record<string, string>>, current: Readonly<Record<string, string | undefined>>): boolean {
  return Object.entries(pinned).some(([key, id]) => {
    const now = current[key];
    return now !== undefined && now !== id;
  });
}

/**
 * Stale exactly when a pinned snapshot or rule version has been superseded
 * by a different current one, or settings changed after the last run (P5).
 * A scenario that has never run is not stale — it is "not run yet", which
 * blocks submission separately.
 */
export function scenarioStaleness(input: StalenessInput): Staleness {
  const reasons: StaleReason[] = [];
  if (superseded(input.pinnedSnapshots, input.currentSnapshots)) reasons.push('snapshot_superseded');
  if (superseded(input.pinnedRuleVersions, input.currentRuleVersions)) reasons.push('rules_superseded');
  if (input.lastRunAt !== null && Date.parse(input.settingsChangedAt) > Date.parse(input.lastRunAt)) {
    reasons.push('settings_changed');
  }
  return { stale: reasons.length > 0, reasons };
}

/** Stored `scenario.stale_reason` text (comma-separated codes). */
export function formatStaleReasons(reasons: readonly StaleReason[]): string | null {
  return reasons.length > 0 ? reasons.join(',') : null;
}

export function parseStaleReasons(text: string | null): StaleReason[] {
  if (!text) return [];
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is StaleReason => (STALE_REASONS as readonly string[]).includes(s));
}

export type SubmitBlocker = 'not_draft' | 'stale' | 'not_run';

/** Whether a scenario may be submitted for approval (Req 8.5, P5). */
export function scenarioSubmitBlocker(s: {
  readonly status: ScenarioStatus;
  readonly stale: boolean;
  readonly hasSucceededRun: boolean;
}): SubmitBlocker | null {
  if (s.status !== 'draft') return 'not_draft';
  if (s.stale) return 'stale';
  if (!s.hasSucceededRun) return 'not_run';
  return null;
}

// ---------------------------------------------------------------------------
// Run results and compare
// ---------------------------------------------------------------------------

export interface ScenarioPeak {
  readonly date: IsoDate;
  readonly hour: number;
  readonly lanesOpen: number;
}

export interface ScenarioStoreResult {
  readonly storeId: string;
  readonly storeName: string;
  readonly regionId: string;
  /** Season team size (peak-week headcount incl. buffer). */
  readonly headcount: number;
  readonly paidHours: number;
  /** ₱ season cost; absent when the viewer may not see it (task 21). */
  readonly cost?: number;
  /** Peak lanes open on the peak day. */
  readonly peakLanes: number;
  /** Seasonal hires (team size above current staff); null for runs recorded before hires were kept. */
  readonly hires: number | null;
}

export interface ScenarioRunResults {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly headcount: number;
  readonly headcountByType: Readonly<Record<ContractTypeKey, number>>;
  readonly paidHours: number;
  /** ₱ season cost over the viewer's in-scope stores; absent when hidden. */
  readonly cost?: number;
  readonly peak: ScenarioPeak;
  /** Seasonal hires over the viewer's in-scope stores; null for older runs. */
  readonly seasonalHires: number | null;
  /** Earliest week a hire is needed by (in scope); null when no hires or an older run. */
  readonly firstNeededBy: IsoDate | null;
  readonly stores: readonly ScenarioStoreResult[];
}

export interface MetricDelta {
  readonly a: number | null;
  readonly b: number | null;
  /** b − a, or null when either side is missing. */
  readonly delta: number | null;
}

export function metricDelta(a: number | null | undefined, b: number | null | undefined): MetricDelta {
  const av = a ?? null;
  const bv = b ?? null;
  return { a: av, b: bv, delta: av === null || bv === null ? null : bv - av };
}

export interface StoreComparison {
  readonly storeId: string;
  readonly storeName: string;
  readonly hires: MetricDelta;
  readonly headcount: MetricDelta;
  readonly paidHours: MetricDelta;
  /** Absent when the viewer may not see cost for this store on either side. */
  readonly cost?: MetricDelta;
  readonly peakLanes: MetricDelta;
}

export interface ResultsComparison {
  readonly seasonalHires: MetricDelta;
  /** Peak-season team (season team size). */
  readonly headcount: MetricDelta;
  readonly paidHours: MetricDelta;
  readonly cost?: MetricDelta;
  readonly peakLanes: MetricDelta;
  readonly firstNeededBy: { readonly a: IsoDate | null; readonly b: IsoDate | null };
  readonly stores: readonly StoreComparison[];
}

/**
 * Result deltas for SCR-032. Either side may be missing (never run); cost
 * deltas appear only when both sides carry the (already shaped) figure.
 */
export function compareScenarioResults(a: ScenarioRunResults | null, b: ScenarioRunResults | null): ResultsComparison {
  const ids = new Map<string, string>();
  for (const s of [...(a?.stores ?? []), ...(b?.stores ?? [])]) if (!ids.has(s.storeId)) ids.set(s.storeId, s.storeName);
  const stores: StoreComparison[] = [...ids.entries()]
    .sort(([, x], [, y]) => x.localeCompare(y))
    .map(([storeId, storeName]) => {
      const sa = a?.stores.find((s) => s.storeId === storeId);
      const sb = b?.stores.find((s) => s.storeId === storeId);
      const withCost = sa?.cost !== undefined && sb?.cost !== undefined;
      return {
        storeId,
        storeName,
        hires: metricDelta(sa?.hires, sb?.hires),
        headcount: metricDelta(sa?.headcount, sb?.headcount),
        paidHours: metricDelta(sa?.paidHours, sb?.paidHours),
        ...(withCost ? { cost: metricDelta(sa.cost, sb.cost) } : {}),
        peakLanes: metricDelta(sa?.peakLanes, sb?.peakLanes),
      };
    });
  const withCost = a?.cost !== undefined && b?.cost !== undefined;
  return {
    seasonalHires: metricDelta(a?.seasonalHires, b?.seasonalHires),
    headcount: metricDelta(a?.headcount, b?.headcount),
    paidHours: metricDelta(a?.paidHours, b?.paidHours),
    ...(withCost ? { cost: metricDelta(a.cost, b.cost) } : {}),
    peakLanes: metricDelta(a?.peak.lanesOpen, b?.peak.lanesOpen),
    firstNeededBy: { a: a?.firstNeededBy ?? null, b: b?.firstNeededBy ?? null },
    stores,
  };
}

// ---------------------------------------------------------------------------
// API DTOs (`/scenarios`)
// ---------------------------------------------------------------------------

export interface ScenarioListItem {
  readonly id: string;
  readonly name: string;
  readonly season: string;
  readonly status: ScenarioStatus;
  /** ★ — the season's Published scenario (P3). */
  readonly isPublished: boolean;
  readonly stale: boolean;
  readonly staleReasons: readonly StaleReason[];
  readonly ownerId: string;
  readonly ownerName: string;
  readonly parentScenarioId: string | null;
  readonly planningFrom: IsoDate;
  readonly planningTo: IsoDate;
  /** Loaded time of the pinned POS snapshot ("Data as of"). */
  readonly dataAsOf: IsoDateTime | null;
  /** Latest publish time among the pinned rule versions ("Rules version"). */
  readonly rulesAsOf: IsoDateTime | null;
  readonly lastRunAt: IsoDateTime | null;
  readonly updatedAt: IsoDateTime;
  readonly synthetic: boolean;
}

export interface ScenarioSnapshotPin {
  readonly datasetType: string;
  readonly snapshotId: string;
  readonly loadedAt: IsoDateTime;
  /** False when a newer snapshot of this type has been loaded. */
  readonly current: boolean;
}

export interface ScenarioRuleVersionPin {
  readonly ruleSetId: string;
  readonly ruleSetName: string;
  readonly ruleSetType: string;
  readonly ruleVersionId: string;
  readonly version: number;
  readonly effectiveFrom: IsoDate;
  readonly publishedAt: IsoDateTime | null;
  /** False when a newer version of this rule set has been published. */
  readonly current: boolean;
}

export type ScenarioRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ScenarioRunSummary {
  readonly id: string;
  readonly status: ScenarioRunStatus;
  readonly createdAt: IsoDateTime;
  readonly finishedAt: IsoDateTime | null;
  readonly errorMessage: string | null;
  /** Exactly the inputs this run used (P6). */
  readonly snapshotIds: Readonly<Record<string, string>>;
  readonly ruleVersionIds: readonly string[];
  readonly results: ScenarioRunResults | null;
}

export interface ScenarioDetail extends ScenarioListItem {
  readonly settings: ScenarioSettingsValues;
  /** What each `null` override falls back to (the pinned rule values). */
  readonly defaults: ScenarioSettingDefaults;
  /** ₱ base hourly rate from the pinned wage rule (read-only on SCR-031); absent when hidden for the role. */
  readonly baseHourlyRate?: number;
  /** Departments in scope with their POS-learned baselines (the overrides table). */
  readonly departments: readonly ScenarioDepartmentBaseline[];
  readonly snapshots: readonly ScenarioSnapshotPin[];
  readonly ruleVersions: readonly ScenarioRuleVersionPin[];
  readonly latestRun: ScenarioRunSummary | null;
  /** Settings editable (Draft only, P4) and the viewer may edit. */
  readonly editable: boolean;
  readonly submitBlocker: SubmitBlocker | null;
}

export interface ScenarioComparison {
  readonly a: ScenarioDetail;
  readonly b: ScenarioDetail;
  readonly settings: readonly ScenarioSettingsChange[];
  readonly departmentSettings: readonly DepartmentSettingsChange[];
  readonly inputs: {
    readonly snapshots: readonly { readonly datasetType: string; readonly a: string | null; readonly b: string | null }[];
    readonly ruleVersions: readonly { readonly ruleSetName: string; readonly a: number | null; readonly b: number | null }[];
  };
  readonly results: ResultsComparison;
}
