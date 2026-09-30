/**
 * Business rule sets and versions (Requirement 16; P6, P7; design.md ›
 * Rule-version publishing, RBAC matrix; DOM-003).
 *
 * - Every rule set is a series of immutable, effective-dated versions.
 * - Cost rules (wages, premium and holiday multipliers, transport allowance)
 *   need Finance approval before they can be published (Q6); non-cost rules
 *   are published directly by the Rules Steward.
 * - Rule payloads are validated against the shapes the staffing engine
 *   consumes (`@lanewise/domain` rules.ts: StaffingRuleVersion,
 *   LaborRuleVersion, WageRuleVersion, PremiumRuleVersion,
 *   HiringRuleVersion), minus `id` and `effectiveFrom`, which live on the
 *   version itself. The validators are dependency-free so the SPA and the API
 *   run the same checks.
 */
import type { ApiErrorDetail } from './api.js';
import type { IsoDate, IsoDateTime } from './entities.js';
import type { RoleCode } from './roles.js';

// ---------------------------------------------------------------------------
// Rule-set catalogue
// ---------------------------------------------------------------------------

/** Rule-set types (mirrors the `rule_set.rule_set_type` check in migration 0002). */
export const RULE_SET_TYPES = [
  'holidays',
  'wages',
  'premiums',
  'lead_times',
  'labor',
  'service_levels',
  'transport_allowance',
] as const;

export type RuleSetType = (typeof RULE_SET_TYPES)[number];

/** Rule sets that change pay and therefore need Finance approval (Req 16.3, Q6, Q23). */
export const COST_RULE_SET_TYPES = ['wages', 'premiums', 'transport_allowance'] as const satisfies readonly RuleSetType[];

export function isRuleSetType(value: unknown): value is RuleSetType {
  return typeof value === 'string' && (RULE_SET_TYPES as readonly string[]).includes(value);
}

export function isCostRuleSetType(type: RuleSetType): boolean {
  return (COST_RULE_SET_TYPES as readonly RuleSetType[]).includes(type);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const RULE_VERSION_STATUSES = [
  'draft',
  'submitted',
  'changes_requested',
  'approved',
  'published',
  'superseded',
] as const;

export type RuleVersionStatus = (typeof RULE_VERSION_STATUSES)[number];

/** Statuses of the one open (not yet published) version a rule set may have. */
export const OPEN_RULE_VERSION_STATUSES = [
  'draft',
  'submitted',
  'changes_requested',
  'approved',
] as const satisfies readonly RuleVersionStatus[];

export const RULE_VERSION_ACTIONS = ['edit', 'submit', 'approve', 'request_changes', 'publish'] as const;
export type RuleVersionAction = (typeof RULE_VERSION_ACTIONS)[number];

/** Content (payload, effective date, change note) is editable only here; later states are frozen (P6). */
export function isRuleVersionEditable(status: RuleVersionStatus): boolean {
  return status === 'draft' || status === 'changes_requested';
}

/**
 * The status a version moves to when `action` is taken, or `null` when the
 * action is not allowed. Cost rules: draft → submitted → approved (Finance) →
 * published, or submitted → changes_requested → (edit) draft. Non-cost rules:
 * published straight from draft or submitted; Finance never reviews them.
 * Superseding happens only as a side effect of publishing a newer version.
 */
export function ruleVersionTransition(
  status: RuleVersionStatus,
  isCostRule: boolean,
  action: RuleVersionAction,
): RuleVersionStatus | null {
  switch (action) {
    case 'edit':
      return isRuleVersionEditable(status) ? 'draft' : null;
    case 'submit':
      return isRuleVersionEditable(status) ? 'submitted' : null;
    case 'approve':
      return isCostRule && status === 'submitted' ? 'approved' : null;
    case 'request_changes':
      return isCostRule && status === 'submitted' ? 'changes_requested' : null;
    case 'publish':
      if (isCostRule) return status === 'approved' ? 'published' : null;
      return status === 'draft' || status === 'submitted' ? 'published' : null;
  }
}

// ---------------------------------------------------------------------------
// Permissions (design.md RBAC matrix: "Business rules" rows). Server-side
// enforcement is task 8.1's authorize middleware; each rule route declares one
// of these.
// ---------------------------------------------------------------------------

export const RULE_PERMISSION_KEYS = ['rules.view', 'rules.edit', 'rules.approve_cost', 'rules.publish'] as const;
export type RulePermission = (typeof RULE_PERMISSION_KEYS)[number];

export const RULE_PERMISSIONS: Readonly<Record<RulePermission, readonly RoleCode[]>> = {
  /** View rule sets, versions, history and diffs. */
  'rules.view': ['EXE', 'PLN', 'HR', 'FIN', 'RST'],
  /** Create and edit draft versions and submit them. */
  'rules.edit': ['RST'],
  /** Approve or request changes on a submitted cost rule. */
  'rules.approve_cost': ['FIN'],
  /** Publish: the Rules Steward any eligible version; Finance an approved cost rule ("Approve and publish"). */
  'rules.publish': ['RST', 'FIN'],
};

export function hasRulePermission(role: RoleCode | null, permission: RulePermission): boolean {
  return role !== null && RULE_PERMISSIONS[permission].includes(role);
}

/** Whether `role` may publish a version in `status` (Req 16.3, 16.4). */
export function canPublishRuleVersion(role: RoleCode | null, isCostRule: boolean, status: RuleVersionStatus): boolean {
  if (!hasRulePermission(role, 'rules.publish')) return false;
  if (ruleVersionTransition(status, isCostRule, 'publish') === null) return false;
  // Finance only publishes the cost rules it has approved.
  return role === 'RST' || isCostRule;
}

// ---------------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------------

export interface RuleSetSummary {
  readonly id: string;
  readonly type: RuleSetType;
  readonly name: string;
  readonly isCostRule: boolean;
  /** The in-force series head, if any. */
  readonly currentVersion: RuleVersionSummary | null;
  /** The one open (unpublished) version, if any. */
  readonly openVersion: RuleVersionSummary | null;
  /** Scenarios (not archived/superseded) pinned to any version of this set. */
  readonly scenarioCount: number;
}

export interface RuleVersionSummary {
  readonly id: string;
  readonly ruleSetId: string;
  readonly version: number;
  readonly effectiveFrom: IsoDate;
  readonly status: RuleVersionStatus;
  readonly isCostRule: boolean;
  readonly updatedAt: IsoDateTime;
}

export interface RuleVersionDetail extends RuleVersionSummary {
  readonly ruleSetType: RuleSetType;
  readonly ruleSetName: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly changeNote: string;
  readonly createdBy: string;
  readonly createdByName: string | null;
  readonly submittedAt: IsoDateTime | null;
  readonly financeApprovedBy: string | null;
  readonly financeApprovedByName: string | null;
  readonly financeApprovedAt: IsoDateTime | null;
  /** Finance's comment on the last request for changes. */
  readonly reviewComment: string | null;
  readonly publishedBy: string | null;
  readonly publishedByName: string | null;
  readonly publishedAt: IsoDateTime | null;
  readonly synthetic: boolean;
}

export interface RuleVersionImpact {
  /** Scenarios that will be (or were) flagged stale when this version publishes. */
  readonly scenarioIds: readonly string[];
}

export interface RuleVersionDiff {
  readonly fromVersionId: string | null;
  readonly toVersionId: string;
  readonly changes: readonly RulePayloadChange[];
}

// ---------------------------------------------------------------------------
// Payload shapes (engine contract)
// ---------------------------------------------------------------------------

export type ContractTypeKey = 'FT' | 'PT' | 'FLOAT';
export type DayTypeKey = 'regular' | 'special' | 'regularHoliday';

/** `service_levels` → domain StaffingRuleVersion. */
export interface ServiceLevelsRulePayload {
  readonly serviceTarget: { readonly serviceLevel: number; readonly thresholdSec: number };
  readonly shrinkage: number;
  readonly shifts: {
    readonly ftSpanHours: number;
    readonly ftMealHours: number;
    readonly mealWindow: { readonly earliestOffset: number; readonly latestOffset: number };
    readonly ftMinUsefulHours: number;
    readonly reliefMinUsefulHours: number;
    readonly ptMinHours: number;
    readonly ptMaxHours: number;
    readonly ptMinUsefulHours: number;
    readonly floatMinHours: number;
    readonly floatMaxHours: number;
    readonly floatMinUsefulHours: number;
  };
}

/** `labor` → domain LaborRuleVersion. */
export interface LaborRulePayload {
  readonly maxConsecutiveDays: number;
  readonly restAfterConsecutiveDays: number;
  readonly mandatoryRestHours: number;
  readonly minRestBetweenShiftsHours: number;
  readonly maxWeeklyHours: Readonly<Record<ContractTypeKey, number>>;
}

/** `wages` → domain WageRuleVersion. */
export interface WagesRulePayload {
  readonly hourlyRateByRegion: Readonly<Record<string, number>>;
  readonly defaultHourlyRate: number;
  readonly employerLoading: number;
}

/** `premiums` → domain PremiumRuleVersion. */
export interface PremiumsRulePayload {
  readonly dayTypeMultiplier: Readonly<Record<DayTypeKey, number>>;
  readonly nightDifferential: number;
  readonly nightStartHour: number;
  readonly nightEndHour: number;
  readonly overtimeMultiplier: number;
  readonly regularHoursPerShift: number;
}

/** `lead_times` → domain HiringRuleVersion. */
export interface LeadTimesRulePayload {
  readonly leadTimeDays: Readonly<Record<ContractTypeKey, number>>;
  readonly contractWeeklyHours: Readonly<Record<ContractTypeKey, number>>;
  readonly recruitingBuffer: number;
  readonly milestones: readonly {
    readonly name: string;
    readonly daysBeforeNeedBy: Readonly<Record<ContractTypeKey, number>>;
  }[];
}

/** `holidays` → the PH holiday calendar (domain calendar Holiday by date). */
export interface HolidaysRulePayload {
  readonly holidays: readonly {
    readonly date: IsoDate;
    readonly name: string;
    readonly dayType: Exclude<DayTypeKey, 'regular'>;
  }[];
}

/** `transport_allowance` → flat allowance (₱) by travel-time band (Q23), bands ascending. */
export interface TransportAllowanceRulePayload {
  readonly bands: readonly { readonly upToMinutes: number; readonly amount: number }[];
}

export interface RulePayloadByType {
  readonly service_levels: ServiceLevelsRulePayload;
  readonly labor: LaborRulePayload;
  readonly wages: WagesRulePayload;
  readonly premiums: PremiumsRulePayload;
  readonly lead_times: LeadTimesRulePayload;
  readonly holidays: HolidaysRulePayload;
  readonly transport_allowance: TransportAllowanceRulePayload;
}

// ---------------------------------------------------------------------------
// Minimal schema combinators (no runtime dependencies)
// ---------------------------------------------------------------------------

type Path = readonly (string | number)[];
type Issues = ApiErrorDetail[];
type Check = (value: unknown, path: Path, issues: Issues) => void;

const joinPath = (path: Path): string => path.join('.');
const fail = (issues: Issues, path: Path, message: string): void => {
  issues.push({ path: joinPath(path), message });
};
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

interface NumOptions {
  readonly min?: number;
  readonly max?: number;
  /** Strictly greater than `min`. */
  readonly exclusiveMin?: boolean;
  readonly exclusiveMax?: boolean;
  readonly int?: boolean;
}

function num(o: NumOptions = {}): Check {
  return (v, path, issues) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fail(issues, path, 'Must be a number.');
    if (o.int && !Number.isInteger(v)) return fail(issues, path, 'Must be a whole number.');
    if (o.min !== undefined && (o.exclusiveMin ? v <= o.min : v < o.min)) {
      return fail(issues, path, `Must be ${o.exclusiveMin ? 'more than' : 'at least'} ${o.min}.`);
    }
    if (o.max !== undefined && (o.exclusiveMax ? v >= o.max : v > o.max)) {
      return fail(issues, path, `Must be ${o.exclusiveMax ? 'less than' : 'at most'} ${o.max}.`);
    }
  };
}

function text(maxLength = 200): Check {
  return (v, path, issues) => {
    if (typeof v !== 'string') return fail(issues, path, 'Must be text.');
    if (v.trim().length === 0) return fail(issues, path, 'Must not be blank.');
    if (v.length > maxLength) fail(issues, path, `Must be at most ${maxLength} characters.`);
  };
}

function oneOf(values: readonly string[]): Check {
  return (v, path, issues) => {
    if (typeof v !== 'string' || !values.includes(v)) fail(issues, path, `Must be one of: ${values.join(', ')}.`);
  };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date `YYYY-MM-DD`. */
export function isIsoDate(v: unknown): v is IsoDate {
  if (typeof v !== 'string') return false;
  const m = ISO_DATE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const date: Check = (v, path, issues) => {
  if (!isIsoDate(v)) fail(issues, path, 'Must be a date (YYYY-MM-DD).');
};

/** A strict object: every listed key required, no others. */
function obj(shape: Readonly<Record<string, Check>>, refine?: (v: Record<string, unknown>, path: Path, issues: Issues) => void): Check {
  return (v, path, issues) => {
    if (!isPlainObject(v)) return fail(issues, path, 'Must be an object.');
    const before = issues.length;
    for (const [key, check] of Object.entries(shape)) {
      if (!Object.prototype.hasOwnProperty.call(v, key)) fail(issues, [...path, key], 'Required.');
      else check(v[key], [...path, key], issues);
    }
    for (const key of Object.keys(v)) {
      if (!Object.prototype.hasOwnProperty.call(shape, key)) fail(issues, [...path, key], 'Unknown field.');
    }
    // Cross-field checks only run on an otherwise well-formed object.
    if (refine && issues.length === before) refine(v, path, issues);
  };
}

/** A free-form map from a non-blank key to `value`. */
function dict(value: Check, o: { minKeys?: number; maxKeys?: number } = {}): Check {
  return (v, path, issues) => {
    if (!isPlainObject(v)) return fail(issues, path, 'Must be an object.');
    const keys = Object.keys(v);
    if (o.minKeys !== undefined && keys.length < o.minKeys) fail(issues, path, `Needs at least ${o.minKeys} entr${o.minKeys === 1 ? 'y' : 'ies'}.`);
    if (o.maxKeys !== undefined && keys.length > o.maxKeys) fail(issues, path, `Allows at most ${o.maxKeys} entries.`);
    for (const key of keys) {
      if (key.trim().length === 0 || key.length > 100) fail(issues, [...path, key], 'Invalid name.');
      else value(v[key], [...path, key], issues);
    }
  };
}

function list(item: Check, o: { minLength?: number; maxLength?: number } = {}, refine?: (v: readonly unknown[], path: Path, issues: Issues) => void): Check {
  return (v, path, issues) => {
    if (!Array.isArray(v)) return fail(issues, path, 'Must be a list.');
    if (o.minLength !== undefined && v.length < o.minLength) return fail(issues, path, `Needs at least ${o.minLength} item(s).`);
    if (o.maxLength !== undefined && v.length > o.maxLength) return fail(issues, path, `Allows at most ${o.maxLength} items.`);
    const before = issues.length;
    v.forEach((x, i) => item(x, [...path, i], issues));
    if (refine && issues.length === before) refine(v, path, issues);
  };
}

const byContract = (check: Check): Check => obj({ FT: check, PT: check, FLOAT: check });

// ---------------------------------------------------------------------------
// Schemas per rule-set type
// ---------------------------------------------------------------------------

const hours24 = num({ min: 0, max: 24 });

const SCHEMAS: Readonly<Record<RuleSetType, Check>> = {
  service_levels: obj({
    serviceTarget: obj({
      serviceLevel: num({ min: 0, max: 1, exclusiveMin: true, exclusiveMax: true }),
      thresholdSec: num({ min: 1, max: 3600, int: true }),
    }),
    shrinkage: num({ min: 0, max: 2 }),
    shifts: obj(
      {
        ftSpanHours: num({ min: 0, max: 24, exclusiveMin: true }),
        ftMealHours: hours24,
        mealWindow: obj({ earliestOffset: hours24, latestOffset: hours24 }),
        ftMinUsefulHours: hours24,
        reliefMinUsefulHours: hours24,
        ptMinHours: num({ min: 0, max: 24, exclusiveMin: true }),
        ptMaxHours: num({ min: 0, max: 24, exclusiveMin: true }),
        ptMinUsefulHours: hours24,
        floatMinHours: num({ min: 0, max: 24, exclusiveMin: true }),
        floatMaxHours: num({ min: 0, max: 24, exclusiveMin: true }),
        floatMinUsefulHours: hours24,
      },
      (s, path, issues) => {
        const n = (k: string): number => s[k] as number;
        const mw = s.mealWindow as { earliestOffset: number; latestOffset: number };
        if (n('ptMinHours') > n('ptMaxHours')) fail(issues, [...path, 'ptMaxHours'], 'Must be at least the part-time minimum.');
        if (n('floatMinHours') > n('floatMaxHours')) fail(issues, [...path, 'floatMaxHours'], 'Must be at least the float minimum.');
        if (n('ftMealHours') >= n('ftSpanHours')) fail(issues, [...path, 'ftMealHours'], 'Must be shorter than the shift.');
        if (mw.earliestOffset > mw.latestOffset) fail(issues, [...path, 'mealWindow', 'latestOffset'], 'Must not be before the earliest offset.');
        if (mw.latestOffset >= n('ftSpanHours')) fail(issues, [...path, 'mealWindow', 'latestOffset'], 'Must fall inside the shift.');
      },
    ),
  }),
  labor: obj({
    maxConsecutiveDays: num({ min: 1, max: 14, int: true }),
    restAfterConsecutiveDays: num({ min: 1, max: 14, int: true }),
    mandatoryRestHours: num({ min: 1, max: 168, int: true }),
    minRestBetweenShiftsHours: num({ min: 0, max: 24 }),
    maxWeeklyHours: byContract(num({ min: 1, max: 168 })),
  }),
  wages: obj({
    hourlyRateByRegion: dict(num({ min: 0, max: 100_000, exclusiveMin: true }), { minKeys: 1, maxKeys: 50 }),
    defaultHourlyRate: num({ min: 0, max: 100_000, exclusiveMin: true }),
    employerLoading: num({ min: 0, max: 1 }),
  }),
  premiums: obj(
    {
      dayTypeMultiplier: obj({
        regular: num({ min: 1, max: 10 }),
        special: num({ min: 1, max: 10 }),
        regularHoliday: num({ min: 1, max: 10 }),
      }),
      nightDifferential: num({ min: 0, max: 1 }),
      nightStartHour: num({ min: 0, max: 23, int: true }),
      nightEndHour: num({ min: 0, max: 23, int: true }),
      overtimeMultiplier: num({ min: 1, max: 10 }),
      regularHoursPerShift: num({ min: 1, max: 24, int: true }),
    },
    (p, path, issues) => {
      if (p.nightStartHour === p.nightEndHour) fail(issues, [...path, 'nightEndHour'], 'Must differ from the night start.');
    },
  ),
  lead_times: obj({
    leadTimeDays: byContract(num({ min: 0, max: 365, int: true })),
    contractWeeklyHours: byContract(num({ min: 1, max: 168 })),
    recruitingBuffer: num({ min: 0, max: 1 }),
    milestones: list(
      obj({ name: text(100), daysBeforeNeedBy: byContract(num({ min: 0, max: 365, int: true })) }),
      { minLength: 1, maxLength: 20 },
      (items, path, issues) => {
        // Ordered largest first (domain HiringRuleVersion.milestones).
        const ms = items as { daysBeforeNeedBy: Record<ContractTypeKey, number> }[];
        for (let i = 1; i < ms.length; i += 1) {
          for (const c of ['FT', 'PT', 'FLOAT'] as const) {
            if ((ms[i]?.daysBeforeNeedBy[c] ?? 0) > (ms[i - 1]?.daysBeforeNeedBy[c] ?? 0)) {
              fail(issues, [...path, i, 'daysBeforeNeedBy', c], 'Milestones must be ordered from earliest to latest.');
            }
          }
        }
      },
    ),
  }),
  holidays: obj({
    holidays: list(
      obj({ date, name: text(100), dayType: oneOf(['special', 'regularHoliday']) }),
      { maxLength: 400 },
      (items, path, issues) => {
        const seen = new Set<string>();
        items.forEach((h, i) => {
          const d = (h as { date: string }).date;
          if (seen.has(d)) fail(issues, [...path, i, 'date'], 'Each date may appear only once.');
          seen.add(d);
        });
      },
    ),
  }),
  transport_allowance: obj({
    bands: list(
      obj({ upToMinutes: num({ min: 1, max: 1440, int: true }), amount: num({ min: 0, max: 100_000 }) }),
      { minLength: 1, maxLength: 20 },
      (items, path, issues) => {
        const bs = items as { upToMinutes: number }[];
        for (let i = 1; i < bs.length; i += 1) {
          if ((bs[i]?.upToMinutes ?? 0) <= (bs[i - 1]?.upToMinutes ?? 0)) {
            fail(issues, [...path, i, 'upToMinutes'], 'Bands must be in ascending order of travel time.');
          }
        }
      },
    ),
  }),
};

export type RulePayloadValidation<T extends RuleSetType = RuleSetType> =
  | { readonly ok: true; readonly value: RulePayloadByType[T] }
  | { readonly ok: false; readonly issues: readonly ApiErrorDetail[] };

/**
 * Validates an untrusted rule payload against the engine contract for its
 * rule-set type. Issue paths are dot-joined relative to the payload.
 */
export function validateRulePayload<T extends RuleSetType>(type: T, payload: unknown): RulePayloadValidation<T> {
  const issues: Issues = [];
  SCHEMAS[type](payload, [], issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: payload as RulePayloadByType[T] };
}

// ---------------------------------------------------------------------------
// Version diff (SCR-061 history)
// ---------------------------------------------------------------------------

export interface RulePayloadChange {
  /** Path segments from the payload root (object keys or array indexes). */
  readonly path: readonly (string | number)[];
  readonly kind: 'added' | 'removed' | 'changed';
  readonly before?: unknown;
  readonly after?: unknown;
}

/**
 * Leaf-level differences between two JSON payloads. Objects are compared key
 * by key (keys in `before` order, then new keys); arrays index by index.
 * A value that changes type (e.g. object → number) is one `changed` entry.
 */
export function diffRulePayloads(before: unknown, after: unknown): RulePayloadChange[] {
  const out: RulePayloadChange[] = [];
  const walk = (a: unknown, b: unknown, path: (string | number)[]): void => {
    if (Array.isArray(a) && Array.isArray(b)) {
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i += 1) {
        if (i >= b.length) out.push({ path: [...path, i], kind: 'removed', before: a[i] });
        else if (i >= a.length) out.push({ path: [...path, i], kind: 'added', after: b[i] });
        else walk(a[i], b[i], [...path, i]);
      }
      return;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      for (const k of Object.keys(a)) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) out.push({ path: [...path, k], kind: 'removed', before: a[k] });
        else walk(a[k], b[k], [...path, k]);
      }
      for (const k of Object.keys(b)) {
        if (!Object.prototype.hasOwnProperty.call(a, k)) out.push({ path: [...path, k], kind: 'added', after: b[k] });
      }
      return;
    }
    if (!Object.is(a, b) && !(a === 0 && b === 0)) out.push({ path, kind: 'changed', before: a, after: b });
  };
  walk(before, after, []);
  return out;
}

/** Applies changes from `diffRulePayloads(base, x)` to `base`, returning `x` (without mutating `base`). */
export function applyRulePayloadChanges(base: unknown, changes: readonly RulePayloadChange[]): unknown {
  const clone = (v: unknown): unknown => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as unknown));
  let root = clone(base);
  // Removals of array items run from the highest index down so indexes stay valid.
  const ordered = [
    ...changes.filter((c) => c.kind !== 'removed'),
    ...changes.filter((c) => c.kind === 'removed').reverse(),
  ];
  for (const c of ordered) {
    if (c.path.length === 0) {
      root = clone(c.after);
      continue;
    }
    let parent = root as Record<string | number, unknown>;
    for (const seg of c.path.slice(0, -1)) parent = parent[seg] as Record<string | number, unknown>;
    const last = c.path[c.path.length - 1] as string | number;
    if (c.kind === 'removed') {
      if (Array.isArray(parent)) parent.splice(last as number, 1);
      else delete parent[last];
    } else {
      Object.defineProperty(parent, last, { value: clone(c.after), enumerable: true, writable: true, configurable: true });
    }
  }
  return root;
}
