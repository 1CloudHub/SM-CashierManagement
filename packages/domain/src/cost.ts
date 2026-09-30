/**
 * Cost model — DOM-001 "Cost model": paid hours × applicable wage rate ×
 * premium multipliers (PH day type, +10 % night differential after 22:00,
 * overtime), from the pinned wage and premium rule versions (DOM-003).
 */
import { dayTypeOf } from './calendar.js';
import type { PremiumRuleVersion, WageRuleVersion } from './rules.js';
import type { Shift } from './types.js';

export interface CostRules {
  readonly wage: WageRuleVersion;
  readonly premium: PremiumRuleVersion;
}

export interface ShiftCost {
  readonly shiftId: string;
  readonly paidHours: number;
  readonly cost: number;
}

export interface CostBreakdown {
  readonly total: number;
  readonly paidHours: number;
  readonly byShift: readonly ShiftCost[];
  readonly wageRuleVersionId: string;
  readonly premiumRuleVersionId: string;
}

export function hourlyRate(wage: WageRuleVersion, region: string): number {
  return (wage.hourlyRateByRegion[region] ?? wage.defaultHourlyRate) * (1 + wage.employerLoading);
}

function isNightHour(premium: PremiumRuleVersion, clockHour: number): boolean {
  const h = ((clockHour % 24) + 24) % 24;
  return h >= premium.nightStartHour || h < premium.nightEndHour;
}

/** Cost of one shift worked in `region`. Meal hours are unpaid. */
export function costShift(shift: Shift, region: string, rules: CostRules): ShiftCost {
  const rate = hourlyRate(rules.wage, region);
  const dayMult = rules.premium.dayTypeMultiplier[dayTypeOf(shift.date)];
  let cost = 0;
  let worked = 0;
  for (let h = shift.start; h < shift.end; h += 1) {
    if (shift.mealHour === h) continue;
    worked += 1;
    let mult = dayMult;
    if (isNightHour(rules.premium, h)) mult *= 1 + rules.premium.nightDifferential;
    if (worked > rules.premium.regularHoursPerShift) mult *= rules.premium.overtimeMultiplier;
    cost += rate * mult;
  }
  return { shiftId: shift.id, paidHours: worked, cost };
}

/** Cost a set of shifts; `regionOf` maps a shift to its store's wage region. */
export function costShifts(
  shifts: readonly Shift[],
  regionOf: (shift: Shift) => string,
  rules: CostRules,
): CostBreakdown {
  const byShift = shifts.map((s) => costShift(s, regionOf(s), rules));
  return {
    total: byShift.reduce((acc, c) => acc + c.cost, 0),
    paidHours: byShift.reduce((acc, c) => acc + c.paidHours, 0),
    byShift,
    wageRuleVersionId: rules.wage.id,
    premiumRuleVersionId: rules.premium.id,
  };
}
