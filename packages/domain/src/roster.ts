/**
 * Named roster assignment — DOM-001 "Roster assignment": assign named staff to
 * built shifts honoring contract type, preferred rest day, availability and
 * the PH labor rules. Deterministic greedy with a total tie-break order; any
 * shift that cannot be filled without a labor-rule breach is left open.
 *
 * Parity note (DOM-001): the name-to-shift mapping may differ from v3 where
 * the assignment has ties; the shift set and total hours are invariant.
 */
import { dayOfWeek } from './calendar.js';
import { absoluteHour, checkLaborRules, type AssignedShift, type LaborViolation, type StaffMember } from './labor.js';
import type { LaborRuleVersion } from './rules.js';
import type { ContractType, Shift } from './types.js';

export interface RosterInput {
  readonly shifts: readonly Shift[];
  readonly staff: readonly StaffMember[];
  readonly rules: LaborRuleVersion;
  /** Already-worked shifts before the period (e.g. last week's tail), for rest/consecutive-day checks. */
  readonly prior?: readonly AssignedShift[];
}

export interface RosterResult {
  readonly assignments: readonly AssignedShift[];
  readonly openShifts: readonly Shift[];
  readonly violations: readonly LaborViolation[];
}

/** Which staff contract types may work a shift type, in order of preference. */
const ELIGIBLE: Readonly<Record<ContractType, readonly ContractType[]>> = {
  FT: ['FT'],
  PT: ['PT', 'FLOAT'],
  FLOAT: ['FLOAT', 'PT'],
};

export function assignRoster(input: RosterInput): RosterResult {
  const { rules } = input;
  const prior = input.prior ?? [];
  const byStaff = new Map<string, AssignedShift[]>();
  for (const p of prior) byStaff.set(p.staffId, [...(byStaff.get(p.staffId) ?? []), p]);
  const paid = new Map<string, number>();
  const staffSorted = [...input.staff].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const shifts = [...input.shifts].sort(
    (a, b) =>
      absoluteHour(a.date, a.start) - absoluteHour(b.date, b.start) ||
      b.end - a.end ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const assignments: AssignedShift[] = [];
  const openShifts: Shift[] = [];

  for (const shift of shifts) {
    const types = ELIGIBLE[shift.type];
    let chosen: StaffMember | null = null;
    let chosenRank: readonly number[] | null = null;
    for (const s of staffSorted) {
      if (s.departmentId !== shift.departmentId) continue;
      const typeRank = types.indexOf(s.contractType);
      if (typeRank < 0) continue;
      if (s.unavailableDates.includes(shift.date)) continue;
      const mine = byStaff.get(s.id) ?? [];
      if (mine.some((m) => m.date === shift.date)) continue;
      const candidate: AssignedShift = { ...shift, staffId: s.id };
      // Never introduce a breach (pre-existing breaches in `prior` are not held against the person).
      if (checkLaborRules([...mine, candidate], rules, [s]).length > checkLaborRules(mine, rules, [s]).length) continue;
      const rank = [typeRank, dayOfWeek(shift.date) === s.preferredRestDay ? 1 : 0, paid.get(s.id) ?? 0];
      if (chosenRank === null || lexLess(rank, chosenRank)) {
        chosen = s;
        chosenRank = rank;
      }
    }
    if (chosen === null) {
      openShifts.push(shift);
      continue;
    }
    const a: AssignedShift = { ...shift, staffId: chosen.id };
    assignments.push(a);
    byStaff.set(chosen.id, [...(byStaff.get(chosen.id) ?? []), a]);
    paid.set(chosen.id, (paid.get(chosen.id) ?? 0) + shift.paidHours);
  }

  return {
    assignments,
    openShifts,
    violations: checkLaborRules([...prior, ...assignments], rules, input.staff),
  };
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
