/**
 * Published-roster contracts and store-manager overrides (task 13.4;
 * Requirement 6.6/6.7 and 7; Property 14 override traceability).
 *
 * A store manager changes a published roster directly — emergency off,
 * reassign, time change, add or remove a shift. Each change is recorded as a
 * ShiftOverride with exactly one audit event, is marked ✎ in the grid and
 * notifies the affected cashiers. The change is checked against the PH labor
 * rules (`evaluateRosterChange` in `@lanewise/domain`):
 *
 *  - a new **warning** breach (consecutive days, weekly hours, minimum rest)
 *    may be saved only with a non-empty reason, recorded on the override;
 *  - a **block** (missed 24-hour rest after 6 consecutive working days, two
 *    overlapping shifts) is never saved.
 *
 * `overrideSaveDecision` is that rule as one pure function, used by the API,
 * the SPA's mock adapter and the shift editor alike.
 *
 * Times on a roster are local store time (Asia/Manila, UTC+8, no daylight
 * saving): a calendar date plus minutes since local midnight.
 */
import type { IsoDate, IsoDateTime } from './entities.js';

/** Store-local offset from UTC in minutes. Every SM store is in Asia/Manila (no DST). */
export const STORE_UTC_OFFSET_MINUTES = 480;

/** Latest end of a shift, in minutes after the local midnight it starts on (overnight up to 06:00). */
export const MAX_SHIFT_END_MINUTES = 30 * 60;

export const ROSTER_STATUSES = ['draft', 'published', 'superseded'] as const;
export type RosterStatus = (typeof ROSTER_STATUSES)[number];

export const SHIFT_OVERRIDE_TYPES = ['emergency_off', 'reassign', 'time_change', 'add', 'remove'] as const;
export type ShiftOverrideType = (typeof SHIFT_OVERRIDE_TYPES)[number];

/**
 * Every recorded ShiftOverride type: the store-manager changes above, the
 * task 17 fills of an open shift — by an accepted offer or a borrow — and the
 * task 18 approved staff requests: a swap, and a shift left open by approved
 * time off (P14, P19).
 */
export const SHIFT_OVERRIDE_RECORD_TYPES = [...SHIFT_OVERRIDE_TYPES, 'offer_fill', 'borrow_fill', 'swap', 'time_off'] as const;
export type ShiftOverrideRecordType = (typeof SHIFT_OVERRIDE_RECORD_TYPES)[number];

/** Why a cashier is marked off at short notice (shift editor, Req 7.5). */
export const EMERGENCY_OFF_REASONS = ['sickCall', 'family', 'other'] as const;
export type EmergencyOffReason = (typeof EMERGENCY_OFF_REASONS)[number];

export const SHIFT_ACTIVITY_KINDS = ['meal', 'training', 'huddle'] as const;
export type ShiftActivityKind = (typeof SHIFT_ACTIVITY_KINDS)[number];

/** An activity segment inside a shift, in minutes since local midnight. */
export interface RosterActivity {
  readonly kind: ShiftActivityKind;
  readonly startMin: number;
  readonly endMin: number;
}

export type LaborRuleCode = 'CONSECUTIVE_DAYS' | 'WEEKLY_HOURS' | 'MIN_REST' | 'MANDATORY_REST' | 'OVERLAP';
export type LaborSeverity = 'warning' | 'block';

/** One labor-rule breach (mirrors `LaborViolation` in `@lanewise/domain`). */
export interface LaborBreach {
  readonly rule: LaborRuleCode;
  readonly severity: LaborSeverity;
  readonly staffId: string;
  readonly date: IsoDate;
  readonly message: string;
}

export type OverrideCheckStatus = 'ok' | 'needsReason' | 'blocked';

/** The labor-rule check of one proposed change (live rule check in the shift editor). */
export interface OverrideCheck {
  readonly status: OverrideCheckStatus;
  /** Breaches the change introduces (not present before it). */
  readonly breaches: readonly LaborBreach[];
  /** Blocking breaches left after the change for the affected cashiers — never saved. */
  readonly blocking: readonly LaborBreach[];
}

/** Builds the check from the breaches a change introduces and the blocks it leaves. */
export function overrideCheckOf(breaches: readonly LaborBreach[], blocking: readonly LaborBreach[]): OverrideCheck {
  const status: OverrideCheckStatus =
    blocking.length > 0 || breaches.some((b) => b.severity === 'block')
      ? 'blocked'
      : breaches.length > 0
        ? 'needsReason'
        : 'ok';
  return { status, breaches, blocking };
}

export type OverrideSaveDecision =
  | { readonly ok: true; readonly reason: string | null; readonly ruleBreaches: readonly LaborBreach[] }
  | { readonly ok: false; readonly code: 'blocked' | 'reason_required' };

/**
 * P14: whether a checked change may be saved. Blocks never save; new
 * warnings save only with a non-empty reason, and the saved override then
 * carries both the reason and the breaches.
 */
export function overrideSaveDecision(check: OverrideCheck, reason: string | null | undefined): OverrideSaveDecision {
  const trimmed = reason?.trim() ?? '';
  if (check.status === 'blocked') return { ok: false, code: 'blocked' };
  if (check.status === 'needsReason' && trimmed.length === 0) return { ok: false, code: 'reason_required' };
  return { ok: true, reason: trimmed.length > 0 ? trimmed : null, ruleBreaches: check.breaches };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

interface OverrideBase {
  /** Required when the change introduces a labor-rule warning (Req 7.3). */
  readonly reason?: string;
}

/** A shift's local times: the date it starts on and minutes since that midnight. */
export interface LocalShiftTimes {
  readonly date: IsoDate;
  readonly startMin: number;
  readonly endMin: number;
}

export type ShiftOverrideRequest =
  | (OverrideBase & {
      readonly type: 'emergency_off';
      readonly shiftId: string;
      /** The cover picked from the ranked list; null leaves the shift open (planner notified). */
      readonly replacementStaffId: string | null;
      readonly offReason: EmergencyOffReason;
    })
  | (OverrideBase & { readonly type: 'reassign'; readonly shiftId: string; readonly toStaffId: string })
  | (OverrideBase &
      LocalShiftTimes & {
        readonly type: 'time_change';
        readonly shiftId: string;
        readonly activities?: readonly RosterActivity[];
      })
  | (OverrideBase &
      LocalShiftTimes & {
        readonly type: 'add';
        /** Null adds an open shift. */
        readonly staffId: string | null;
        readonly departmentId: string;
      })
  | (OverrideBase & { readonly type: 'remove'; readonly shiftId: string });

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ValidatedOverride =
  | { readonly ok: true; readonly request: ShiftOverrideRequest }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REASON = 500;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidDate(s: unknown): s is IsoDate {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

const isMinute = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_SHIFT_END_MINUTES;

/** Dependency-free validation of a `POST …/overrides` body (shape only; the API checks ids and rules). */
export function validateShiftOverrideRequest(value: unknown): ValidatedOverride {
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  if (!isRecord(value)) return { ok: false, issues: [{ path: '', message: 'Expected an object.' }] };
  const type = value.type;
  if (typeof type !== 'string' || !(SHIFT_OVERRIDE_TYPES as readonly string[]).includes(type)) {
    return { ok: false, issues: [{ path: 'type', message: `Use one of ${SHIFT_OVERRIDE_TYPES.join(', ')}.` }] };
  }
  const allowed: Record<ShiftOverrideType, readonly string[]> = {
    emergency_off: ['shiftId', 'replacementStaffId', 'offReason'],
    reassign: ['shiftId', 'toStaffId'],
    time_change: ['shiftId', 'date', 'startMin', 'endMin', 'activities'],
    add: ['staffId', 'departmentId', 'date', 'startMin', 'endMin'],
    remove: ['shiftId'],
  };
  const known = new Set(['type', 'reason', ...allowed[type as ShiftOverrideType]]);
  for (const key of Object.keys(value)) if (!known.has(key)) issue(key, 'Unknown field.');

  const reason = value.reason;
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > MAX_REASON)) {
    issue('reason', `Give the reason as text of at most ${MAX_REASON} characters.`);
  }
  const id = (key: string, nullable = false) => {
    const v = value[key];
    if (nullable && v === null) return;
    if (typeof v !== 'string' || v.trim().length === 0) issue(key, 'Required.');
  };
  const times = () => {
    if (!isValidDate(value.date)) issue('date', 'Use a calendar date, e.g. 2026-12-19.');
    if (!isMinute(value.startMin) || (value.startMin as number) >= 24 * 60) issue('startMin', 'Use whole minutes after local midnight.');
    if (!isMinute(value.endMin)) issue('endMin', 'Use whole minutes after local midnight.');
    if (isMinute(value.startMin) && isMinute(value.endMin) && value.endMin <= value.startMin) {
      issue('endMin', 'The shift must end after it starts.');
    }
  };

  switch (type as ShiftOverrideType) {
    case 'emergency_off':
      id('shiftId');
      if (value.replacementStaffId === undefined) issue('replacementStaffId', 'Pick a replacement or null for none.');
      else id('replacementStaffId', true);
      if (!(EMERGENCY_OFF_REASONS as readonly unknown[]).includes(value.offReason)) {
        issue('offReason', `Use one of ${EMERGENCY_OFF_REASONS.join(', ')}.`);
      }
      break;
    case 'reassign':
      id('shiftId');
      id('toStaffId');
      break;
    case 'time_change':
      id('shiftId');
      times();
      if (value.activities !== undefined) {
        if (!Array.isArray(value.activities) || value.activities.length > 12) {
          issue('activities', 'Give at most 12 activities.');
        } else {
          value.activities.forEach((a: unknown, i) => {
            if (
              !isRecord(a) ||
              !(SHIFT_ACTIVITY_KINDS as readonly unknown[]).includes(a.kind) ||
              !isMinute(a.startMin) ||
              !isMinute(a.endMin) ||
              a.endMin <= a.startMin ||
              (isMinute(value.startMin) && a.startMin < value.startMin) ||
              (isMinute(value.endMin) && a.endMin > value.endMin)
            ) {
              issue(`activities.${i}`, 'Each activity needs a kind and must sit inside the shift.');
            }
          });
        }
      }
      break;
    case 'add':
      id('staffId', true);
      id('departmentId');
      times();
      break;
    case 'remove':
      id('shiftId');
      break;
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, request: value as unknown as ShiftOverrideRequest };
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export type RosterContract = 'FT' | 'PT' | 'FLOAT';

export interface RosterSummary {
  readonly id: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly status: RosterStatus;
  readonly publishedAt: IsoDateTime | null;
  readonly overrideCount: number;
  readonly synthetic: boolean;
}

export interface RosterDepartmentDto {
  readonly id: string;
  readonly name: string;
}

/** A cashier on the roster: the store's own staff plus anyone borrowed onto one of its shifts. */
export interface RosterStaffMember {
  readonly id: string;
  readonly employeeNo: string;
  readonly name: string;
  readonly contract: RosterContract;
  readonly departmentId: string;
  readonly trainedDepartmentIds: readonly string[];
  /** Set when the cashier's home store is another store. */
  readonly borrowedFrom: string | null;
  /** Travel time (minutes) of a borrowed cashier to this store, when known (Req 14.3). */
  readonly borrowedTravelMin?: number | null;
}

/** The ✎ marker: the latest store-manager change to the shift. */
export interface ShiftEditMarker {
  readonly type: ShiftOverrideRecordType;
  readonly by: string;
  readonly at: IsoDateTime;
}

export interface RosterShiftDto extends LocalShiftTimes {
  readonly id: string;
  /** Null = open shift. */
  readonly staffId: string | null;
  readonly departmentId: string;
  readonly activities: readonly RosterActivity[];
  readonly status: 'scheduled' | 'cancelled';
  readonly edited: ShiftEditMarker | null;
}

export interface ShiftOverrideDto {
  readonly id: string;
  readonly shiftId: string;
  readonly type: ShiftOverrideRecordType;
  readonly fromStaffId: string | null;
  readonly toStaffId: string | null;
  readonly reason: string | null;
  readonly offReason: EmergencyOffReason | null;
  readonly ruleBreaches: readonly LaborBreach[];
  readonly by: string;
  readonly at: IsoDateTime;
}

export interface RosterDetail {
  readonly roster: RosterSummary;
  readonly departments: readonly RosterDepartmentDto[];
  readonly staff: readonly RosterStaffMember[];
  readonly shifts: readonly RosterShiftDto[];
  readonly overrides: readonly ShiftOverrideDto[];
  /** Labor-rule checks for the roster's cashiers over the roster period (Req 6.7). */
  readonly laborChecks: readonly LaborBreach[];
  /** True when the active role may record overrides here (Store Manager, published roster). */
  readonly canOverride: boolean;
}

export interface RosterListResponse {
  readonly rosters: readonly RosterSummary[];
}

/** A ranked replacement for a shift (Req 7.5). */
export interface ReplacementCandidate {
  readonly staffId: string;
  readonly employeeNo: string;
  readonly name: string;
  readonly contract: RosterContract;
  readonly sameDepartment: boolean;
  /** Paid hours already rostered in the shift's Monday-start week. */
  readonly weekHours: number;
  readonly check: OverrideCheck;
}

export interface ReplacementListResponse {
  readonly shiftId: string;
  readonly candidates: readonly ReplacementCandidate[];
}

export interface ShiftOverrideResponse {
  readonly override: ShiftOverrideDto;
  readonly check: OverrideCheck;
  readonly roster: RosterDetail;
}

export interface OverrideCheckResponse {
  readonly check: OverrideCheck;
}

/** Ranking for replacements: saveable first (ok, then needs a reason), same department, fewest hours, name. */
export function rankReplacements(candidates: readonly ReplacementCandidate[]): ReplacementCandidate[] {
  const order: Record<OverrideCheckStatus, number> = { ok: 0, needsReason: 1, blocked: 2 };
  return [...candidates].sort(
    (a, b) =>
      order[a.check.status] - order[b.check.status] ||
      Number(b.sameDepartment) - Number(a.sameDepartment) ||
      a.weekHours - b.weekHours ||
      a.name.localeCompare(b.name) ||
      (a.staffId < b.staffId ? -1 : a.staffId > b.staffId ? 1 : 0),
  );
}

// ---------------------------------------------------------------------------
// Local time helpers
// ---------------------------------------------------------------------------

/** UTC instant of a local store date + minutes after its midnight. */
export function localToInstant(date: IsoDate, minutes: number): IsoDateTime {
  const ms = Date.parse(`${date}T00:00:00Z`) + (minutes - STORE_UTC_OFFSET_MINUTES) * 60_000;
  return new Date(ms).toISOString();
}

/** Local store date and minutes after its midnight for a UTC instant. */
export function instantToLocal(instant: IsoDateTime | Date): { date: IsoDate; minutes: number } {
  const ms = (instant instanceof Date ? instant.getTime() : Date.parse(instant)) + STORE_UTC_OFFSET_MINUTES * 60_000;
  const local = new Date(ms);
  return {
    date: local.toISOString().slice(0, 10),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** A shift's local times from its UTC start and end (end minutes counted from the start date's midnight). */
export function shiftLocalTimes(startsAt: IsoDateTime | Date, endsAt: IsoDateTime | Date): LocalShiftTimes {
  const start = instantToLocal(startsAt);
  const startMs = startsAt instanceof Date ? startsAt.getTime() : Date.parse(startsAt);
  const endMs = endsAt instanceof Date ? endsAt.getTime() : Date.parse(endsAt);
  return { date: start.date, startMin: start.minutes, endMin: start.minutes + Math.round((endMs - startMs) / 60_000) };
}
