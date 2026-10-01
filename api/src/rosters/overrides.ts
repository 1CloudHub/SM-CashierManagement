/**
 * Store-manager overrides on a published roster — the pure part (task 13.4;
 * Req 7; P14).
 *
 * Given the shift being changed and every scheduled shift of the affected
 * cashiers around it, `planOverride` works out the shift after the change and
 * `checkOverride` runs the PH labor rules from `@lanewise/domain` on the
 * before/after shift sets (`evaluateRosterChange`). The repository loads the
 * inputs and saves; this module decides, so P14 can be property-tested
 * without a database.
 */
import {
  evaluateRosterChange,
  type AssignedShift,
  type ContractType,
  type LaborRuleVersion,
  type LaborViolation,
  type StaffMember,
} from '@lanewise/domain';
import {
  localToInstant,
  overrideCheckOf,
  shiftLocalTimes,
  type LaborBreach,
  type OverrideCheck,
  type RosterActivity,
  type ShiftOverrideRequest,
} from '@lanewise/shared';

/** A shift as stored (UTC instants, activities in local minutes). */
export interface StoredShift {
  readonly id: string;
  readonly rosterId: string;
  readonly staffId: string | null;
  readonly departmentId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly activities: readonly RosterActivity[];
  readonly status: 'scheduled' | 'cancelled';
}

/** The shift's state after the change (`null` = removed). */
export interface ShiftAfter {
  readonly staffId: string | null;
  readonly departmentId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly activities: readonly RosterActivity[];
}

export interface PlannedOverride {
  readonly fromStaffId: string | null;
  readonly toStaffId: string | null;
  /** The shift before the change (`null` for an added shift). */
  readonly before: StoredShift | null;
  readonly after: ShiftAfter | null;
}

/** Thrown for a request that cannot apply to the addressed shift (mapped to 422). */
export class OverrideInputError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'OverrideInputError';
  }
}

/** The change a request makes to `shift` (null for `add`). */
export function planOverride(request: ShiftOverrideRequest, shift: StoredShift | null): PlannedOverride {
  if (request.type === 'add') {
    return {
      fromStaffId: null,
      toStaffId: request.staffId,
      before: null,
      after: {
        staffId: request.staffId,
        departmentId: request.departmentId,
        startsAt: new Date(localToInstant(request.date, request.startMin)),
        endsAt: new Date(localToInstant(request.date, request.endMin)),
        activities: [],
      },
    };
  }
  if (!shift) throw new OverrideInputError('shiftId', 'Pick a shift on this roster.');
  const keep: ShiftAfter = {
    staffId: shift.staffId,
    departmentId: shift.departmentId,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    activities: shift.activities,
  };
  switch (request.type) {
    case 'emergency_off':
      if (shift.staffId === null) throw new OverrideInputError('shiftId', 'This shift is open: there is nobody to mark off.');
      if (request.replacementStaffId === shift.staffId) {
        throw new OverrideInputError('replacementStaffId', 'Pick someone other than the cashier who is off.');
      }
      return { fromStaffId: shift.staffId, toStaffId: request.replacementStaffId, before: shift, after: { ...keep, staffId: request.replacementStaffId } };
    case 'reassign':
      if (shift.staffId === null) throw new OverrideInputError('shiftId', 'This shift is open: send an offer or add a cashier instead.');
      if (request.toStaffId === shift.staffId) throw new OverrideInputError('toStaffId', 'The shift is already assigned to this cashier.');
      return { fromStaffId: shift.staffId, toStaffId: request.toStaffId, before: shift, after: { ...keep, staffId: request.toStaffId } };
    case 'time_change':
      return {
        fromStaffId: shift.staffId,
        toStaffId: shift.staffId,
        before: shift,
        after: {
          ...keep,
          startsAt: new Date(localToInstant(request.date, request.startMin)),
          endsAt: new Date(localToInstant(request.date, request.endMin)),
          activities: request.activities ?? shift.activities.filter((a) => a.startMin >= request.startMin && a.endMin <= request.endMin),
        },
      };
    case 'remove':
      return { fromStaffId: shift.staffId, toStaffId: null, before: shift, after: null };
  }
}

/** Cashiers whose shifts a planned change touches. */
export function affectedStaff(plan: PlannedOverride): string[] {
  return [...new Set([plan.fromStaffId, plan.toStaffId].filter((id): id is string => id !== null))].sort();
}

function mealMinutes(activities: readonly RosterActivity[]): number {
  return activities.filter((a) => a.kind === 'meal').reduce((m, a) => m + (a.endMin - a.startMin), 0);
}

/** A stored shift as the domain's labor rules read it (hours since local midnight; may pass 24). */
export function toAssignedShift(
  shift: Pick<StoredShift, 'id' | 'departmentId' | 'startsAt' | 'endsAt' | 'activities'> & { staffId: string },
  contract: ContractType,
): AssignedShift {
  const t = shiftLocalTimes(shift.startsAt, shift.endsAt);
  return {
    id: shift.id,
    staffId: shift.staffId,
    departmentId: shift.departmentId,
    date: t.date,
    type: contract,
    start: t.startMin / 60,
    end: t.endMin / 60,
    mealHour: null,
    paidHours: Math.max(0, t.endMin - t.startMin - mealMinutes(shift.activities)) / 60,
  };
}

export const toBreach = (v: LaborViolation): LaborBreach => ({
  rule: v.rule,
  severity: v.severity,
  staffId: v.staffId,
  date: v.date,
  message: v.message,
});

export interface CheckInputs {
  /** Every scheduled shift on a published roster of the affected cashiers around the change. */
  readonly shifts: readonly StoredShift[];
  readonly staff: readonly StaffMember[];
  readonly rules: LaborRuleVersion;
}

const ADDED_ID = '__added__';

/**
 * P14: the labor-rule check of a planned change. Only the affected cashiers'
 * shifts are compared, so a breach elsewhere on the roster never blocks an
 * unrelated change — but any block left on an affected cashier does.
 */
export function checkOverride(plan: PlannedOverride, inputs: CheckInputs): OverrideCheck {
  const who = new Set(affectedStaff(plan));
  const contractOf = new Map(inputs.staff.map((s) => [s.id, s.contractType]));
  const assigned = (s: { id: string; staffId: string | null } & Omit<StoredShift, 'id' | 'staffId' | 'rosterId' | 'status'>) =>
    s.staffId !== null && who.has(s.staffId)
      ? [toAssignedShift({ ...s, staffId: s.staffId }, contractOf.get(s.staffId) ?? 'FT')]
      : [];
  const targetId = plan.before?.id ?? ADDED_ID;
  const others = inputs.shifts.filter((s) => s.status === 'scheduled' && s.id !== targetId);
  const before = [...others, ...(plan.before && plan.before.status === 'scheduled' ? [plan.before] : [])].flatMap(assigned);
  const after = [...others.flatMap(assigned), ...(plan.after ? assigned({ id: targetId, ...plan.after }) : [])];
  const result = evaluateRosterChange(before, after, inputs.rules, inputs.staff);
  return overrideCheckOf(result.newViolations.map(toBreach), result.blocking.map(toBreach));
}
