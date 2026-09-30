/**
 * PH labor-rule checks for named rosters (DOM-001 "Roster assignment";
 * spec Req 6.7, 7.3, 7.4):
 *
 * - CONSECUTIVE_DAYS  (warning)  more than `maxConsecutiveDays` working days in a row
 * - WEEKLY_HOURS      (warning)  paid hours in a Monday-start roster week above the contract cap
 * - MIN_REST          (warning)  less than `minRestBetweenShiftsHours` between two shifts
 * - MANDATORY_REST    (block)    no 24-hour rest after `restAfterConsecutiveDays` (6) working days
 * - OVERLAP           (block)    two shifts for the same person overlap in time
 *
 * Warnings may be saved with a reason; blocks can never be saved.
 */
import { toDayNumber, weekStart } from './calendar.js';
import type { LaborRuleVersion } from './rules.js';
import type { ContractType, IsoDate, Shift } from './types.js';

export interface StaffMember {
  readonly id: string;
  readonly name: string;
  readonly storeId: string;
  readonly departmentId: string;
  readonly contractType: ContractType;
  /** Preferred rest day, 0 = Sunday … 6 = Saturday. */
  readonly preferredRestDay: number;
  /** Dates the person cannot work (leave, unavailability exceptions). */
  readonly unavailableDates: readonly IsoDate[];
}

export interface AssignedShift extends Shift {
  readonly staffId: string;
}

export type LaborRuleCode = 'CONSECUTIVE_DAYS' | 'WEEKLY_HOURS' | 'MIN_REST' | 'MANDATORY_REST' | 'OVERLAP';
export type Severity = 'warning' | 'block';

export interface LaborViolation {
  readonly rule: LaborRuleCode;
  readonly severity: Severity;
  readonly staffId: string;
  /** Date the breach lands on (the offending shift's date, or the week start for WEEKLY_HOURS). */
  readonly date: IsoDate;
  readonly message: string;
}

/** Absolute hour index of a clock hour on a date (for cross-day rest arithmetic). */
export function absoluteHour(date: IsoDate, hour: number): number {
  return toDayNumber(date) * 24 + hour;
}

export function violationKey(v: LaborViolation): string {
  return `${v.rule}|${v.staffId}|${v.date}`;
}

function checkOne(staffId: string, shifts: readonly AssignedShift[], rules: LaborRuleVersion, typeOf: ContractType): LaborViolation[] {
  const out: LaborViolation[] = [];
  const sorted = [...shifts].sort(
    (a, b) => absoluteHour(a.date, a.start) - absoluteHour(b.date, b.start) || (a.id < b.id ? -1 : 1),
  );

  // Pairwise: overlap and minimum rest between consecutive shifts.
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!prev || !cur) continue;
    const gap = absoluteHour(cur.date, cur.start) - absoluteHour(prev.date, prev.end);
    if (gap < 0) {
      out.push({
        rule: 'OVERLAP',
        severity: 'block',
        staffId,
        date: cur.date,
        message: `Shift ${cur.start}:00–${cur.end}:00 on ${cur.date} overlaps the previous shift.`,
      });
    } else if (gap < rules.minRestBetweenShiftsHours) {
      out.push({
        rule: 'MIN_REST',
        severity: 'warning',
        staffId,
        date: cur.date,
        message: `Only ${gap} h rest before the shift on ${cur.date} (minimum ${rules.minRestBetweenShiftsHours} h).`,
      });
    }
  }

  // Consecutive working days and the mandatory rest after `restAfterConsecutiveDays`.
  const days = [...new Set(sorted.map((s) => toDayNumber(s.date)))].sort((a, b) => a - b);
  const dateOf = new Map(sorted.map((s) => [toDayNumber(s.date), s.date]));
  let run = 0;
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i] ?? 0;
    run = i > 0 && days[i - 1] === day - 1 ? run + 1 : 1;
    const date = dateOf.get(day) ?? '';
    if (run > rules.restAfterConsecutiveDays) {
      out.push({
        rule: 'MANDATORY_REST',
        severity: 'block',
        staffId,
        date,
        message: `Day ${run} in a row on ${date}: a ${rules.mandatoryRestHours}-hour rest is mandatory after ${rules.restAfterConsecutiveDays} consecutive working days.`,
      });
    } else if (run > rules.maxConsecutiveDays) {
      out.push({
        rule: 'CONSECUTIVE_DAYS',
        severity: 'warning',
        staffId,
        date,
        message: `Day ${run} in a row on ${date} (policy maximum ${rules.maxConsecutiveDays}).`,
      });
    }
    if (run === rules.restAfterConsecutiveDays) {
      // The rest after the 6th day must itself be at least 24 hours long.
      const lastEnd = Math.max(...sorted.filter((s) => toDayNumber(s.date) === day).map((s) => absoluteHour(s.date, s.end)));
      const next = sorted.find((s) => absoluteHour(s.date, s.start) >= lastEnd && toDayNumber(s.date) > day);
      if (next && toDayNumber(next.date) !== day + 1) {
        const gap = absoluteHour(next.date, next.start) - lastEnd;
        if (gap < rules.mandatoryRestHours) {
          out.push({
            rule: 'MANDATORY_REST',
            severity: 'block',
            staffId,
            date: next.date,
            message: `Only ${gap} h rest after ${rules.restAfterConsecutiveDays} consecutive working days (mandatory ${rules.mandatoryRestHours} h).`,
          });
        }
      }
    }
  }

  // Weekly paid hours per Monday-start roster week.
  const weekly = new Map<IsoDate, number>();
  for (const s of sorted) weekly.set(weekStart(s.date), (weekly.get(weekStart(s.date)) ?? 0) + s.paidHours);
  const cap = rules.maxWeeklyHours[typeOf];
  for (const [week, hours] of [...weekly.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (hours > cap) {
      out.push({
        rule: 'WEEKLY_HOURS',
        severity: 'warning',
        staffId,
        date: week,
        message: `${hours} paid hours in the week of ${week} (maximum ${cap} h for ${typeOf}).`,
      });
    }
  }
  return out;
}

/**
 * Check every rule for every person in `assignments`. `staff` supplies the
 * contract type for weekly-hour caps (unknown staff default to FT caps).
 */
export function checkLaborRules(
  assignments: readonly AssignedShift[],
  rules: LaborRuleVersion,
  staff: readonly StaffMember[] = [],
): LaborViolation[] {
  const byStaff = new Map<string, AssignedShift[]>();
  for (const a of assignments) {
    const list = byStaff.get(a.staffId) ?? [];
    list.push(a);
    byStaff.set(a.staffId, list);
  }
  const typeOf = new Map(staff.map((s) => [s.id, s.contractType]));
  const out: LaborViolation[] = [];
  for (const id of [...byStaff.keys()].sort()) {
    out.push(...checkOne(id, byStaff.get(id) ?? [], rules, typeOf.get(id) ?? 'FT'));
  }
  return out;
}

export type ChangeStatus = 'ok' | 'needsReason' | 'blocked';

export interface ChangeEvaluation {
  readonly status: ChangeStatus;
  /** True when the change may be saved as submitted. */
  readonly canSave: boolean;
  /** Violations introduced by the change (not present before it). */
  readonly newViolations: readonly LaborViolation[];
  /** Blocking violations present after the change. */
  readonly blocking: readonly LaborViolation[];
  /** Reason recorded on the override when warnings were accepted. */
  readonly reason: string | null;
}

/**
 * Evaluate a manager's roster change (spec Req 7.3 / 7.4): any blocking
 * breach (missed mandatory 24-hour rest, overlap) can never be saved; a new
 * warning-level breach can be saved only with a non-empty reason.
 */
export function evaluateRosterChange(
  before: readonly AssignedShift[],
  after: readonly AssignedShift[],
  rules: LaborRuleVersion,
  staff: readonly StaffMember[] = [],
  reason?: string,
): ChangeEvaluation {
  const beforeKeys = new Set(checkLaborRules(before, rules, staff).map(violationKey));
  const afterViolations = checkLaborRules(after, rules, staff);
  const newViolations = afterViolations.filter((v) => !beforeKeys.has(violationKey(v)));
  const blocking = afterViolations.filter((v) => v.severity === 'block');
  const trimmed = reason?.trim() ?? '';
  if (blocking.length > 0) {
    return { status: 'blocked', canSave: false, newViolations, blocking, reason: null };
  }
  if (newViolations.length > 0) {
    return trimmed.length > 0
      ? { status: 'needsReason', canSave: true, newViolations, blocking, reason: trimmed }
      : { status: 'needsReason', canSave: false, newViolations, blocking, reason: null };
  }
  return { status: 'ok', canSave: true, newViolations, blocking, reason: trimmed.length > 0 ? trimmed : null };
}
