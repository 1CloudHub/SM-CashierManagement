/**
 * Rule versions consumed by the pipeline (DOM-003). Every result records the
 * rule-version ids it used (spec Req 4.3, Property 6).
 *
 * DOM-003 is still a scaffold, so the DEMO_* versions below are documented
 * demo assumptions, not SM policy. They are pinned values: changing them means
 * publishing a new version with a new id, never mutating an existing one.
 */
import type { ContractType, DayType, IsoDate, ServiceTarget } from './types.js';

/** Lane sizing and shift-construction rules (DOM-001 stages 2–5). */
export interface StaffingRuleVersion {
  readonly id: string;
  readonly effectiveFrom: IsoDate;
  readonly serviceTarget: ServiceTarget;
  /** Shrinkage uplift (breaks, training, absence): cashiers = ceil(lanes × (1 + shrinkage)). */
  readonly shrinkage: number;
  readonly shifts: ShiftRules;
}

export interface ShiftRules {
  /** FT shift span in hours, including the unpaid meal hour. */
  readonly ftSpanHours: number;
  /** Unpaid meal-break length for FT shifts (hours). */
  readonly ftMealHours: number;
  /** Meal hour allowed window as offsets from shift start (inclusive). */
  readonly mealWindow: { readonly earliestOffset: number; readonly latestOffset: number };
  /** Minimum hours of real deficit an FT shift must cover to be placed as base load. */
  readonly ftMinUsefulHours: number;
  /** Relief FT shifts (used when part-time is not allowed): minimum useful hours. */
  readonly reliefMinUsefulHours: number;
  readonly ptMinHours: number;
  readonly ptMaxHours: number;
  /** Minimum hours of deficit a PT shift must cover ("PT for short peaks"). */
  readonly ptMinUsefulHours: number;
  readonly floatMinHours: number;
  readonly floatMaxHours: number;
  /** Minimum hours of deficit a float shift must cover ("float cashiers around the peak"). */
  readonly floatMinUsefulHours: number;
}

/** PH labor rules applied to named rosters (spec Req 6.7, 7.3, 7.4). */
export interface LaborRuleVersion {
  readonly id: string;
  readonly effectiveFrom: IsoDate;
  /** Consecutive working days above which a warning is raised. */
  readonly maxConsecutiveDays: number;
  /** Working days after which a mandatory rest is due (PH Labor Code Art. 91: 6). */
  readonly restAfterConsecutiveDays: number;
  /** Mandatory rest length (hours) after `restAfterConsecutiveDays` days — hard block. */
  readonly mandatoryRestHours: number;
  /** Minimum rest between two shifts (hours) — warning. */
  readonly minRestBetweenShiftsHours: number;
  /** Maximum paid hours per roster week by contract type — warning. */
  readonly maxWeeklyHours: Readonly<Record<ContractType, number>>;
}

/** Wage rule version: base hourly rate by region (₱/hour). */
export interface WageRuleVersion {
  readonly id: string;
  readonly effectiveFrom: IsoDate;
  readonly hourlyRateByRegion: Readonly<Record<string, number>>;
  /** Fallback hourly rate when a region is not listed. */
  readonly defaultHourlyRate: number;
  /** Employer on-cost loading (13th month, SSS/PhilHealth/Pag-IBIG), e.g. 0.12. */
  readonly employerLoading: number;
}

/** Premium-pay rule version (day-type multipliers, night differential, overtime). */
export interface PremiumRuleVersion {
  readonly id: string;
  readonly effectiveFrom: IsoDate;
  readonly dayTypeMultiplier: Readonly<Record<DayType, number>>;
  /** Night differential uplift, e.g. 0.10 for +10 %. */
  readonly nightDifferential: number;
  /** Night window [start, end) in clock hours; hours ≥ start or < end are night hours. */
  readonly nightStartHour: number;
  readonly nightEndHour: number;
  readonly overtimeMultiplier: number;
  /** Paid hours per shift above which overtime applies. */
  readonly regularHoursPerShift: number;
}

/** Hiring rules: lead times, contract hours and recruiting buffer (DOM-003 planning lead times). */
export interface HiringRuleVersion {
  readonly id: string;
  readonly effectiveFrom: IsoDate;
  readonly leadTimeDays: Readonly<Record<ContractType, number>>;
  /** Contracted paid hours per week by contract type (team sizing). */
  readonly contractWeeklyHours: Readonly<Record<ContractType, number>>;
  readonly recruitingBuffer: number;
  /** Milestones as days before the need-by date (ordered, largest first). */
  readonly milestones: readonly { readonly name: string; readonly daysBeforeNeedBy: Readonly<Record<ContractType, number>> }[];
}

/** A pinned bundle of rule versions used for one run. */
export interface RuleSet {
  readonly id: string;
  readonly staffing: StaffingRuleVersion;
  readonly labor: LaborRuleVersion;
  readonly wage: WageRuleVersion;
  readonly premium: PremiumRuleVersion;
  readonly hiring: HiringRuleVersion;
}

/** Scenario settings (the v3 inputs). */
export interface ScenarioSettings {
  /** Year-over-year volume growth applied to the learned 2025 baseline. */
  readonly growth: number;
  readonly allowPartTime: boolean;
}

export const DEMO_STAFFING_RULES: StaffingRuleVersion = {
  id: 'staffing-demo-2026.1',
  effectiveFrom: '2025-01-01',
  serviceTarget: { serviceLevel: 0.9, thresholdSec: 60 },
  // Breaks, training and absence. Meal hours are modelled explicitly by the
  // shift builder, so this is below the ×1.25–1.40 all-in uplift quoted in
  // DOM-001 Fixture A (1.17 × 9/8 meal ≈ 1.32 all-in).
  shrinkage: 0.17,
  shifts: {
    ftSpanHours: 9,
    ftMealHours: 1,
    mealWindow: { earliestOffset: 4, latestOffset: 6 },
    ftMinUsefulHours: 9,
    reliefMinUsefulHours: 2,
    ptMinHours: 4,
    ptMaxHours: 4,
    ptMinUsefulHours: 1,
    floatMinHours: 8,
    floatMaxHours: 8,
    floatMinUsefulHours: 7,
  },
};

export const DEMO_LABOR_RULES: LaborRuleVersion = {
  id: 'labor-ph-demo-2026.1',
  effectiveFrom: '2025-01-01',
  maxConsecutiveDays: 6,
  restAfterConsecutiveDays: 6,
  mandatoryRestHours: 24,
  minRestBetweenShiftsHours: 10,
  maxWeeklyHours: { FT: 48, PT: 30, FLOAT: 40 },
};

/**
 * Demo wage version. Base daily minimum wage ÷ 8 by region (2025 wage-order
 * levels, rounded) — demo assumption until DOM-003 "Wage orders" is filled.
 * The employer on-cost loading is a demo assumption set so the seeded
 * network day (Dec 19 2026) costs ≈ ₱322k, the v3 figure (DOM-001 Fixture C).
 */
export const DEMO_WAGE_RULES: WageRuleVersion = {
  id: 'wage-demo-2026.1',
  effectiveFrom: '2025-01-01',
  hourlyRateByRegion: {
    NCR: 86.875,
    'Central Luzon': 68.75,
    'Central Visayas': 67.5,
    'Western Visayas': 66.25,
    'Davao Region': 65.625,
  },
  defaultHourlyRate: 80,
  employerLoading: 0.14,
};

export const DEMO_PREMIUM_RULES: PremiumRuleVersion = {
  id: 'premium-ph-demo-2026.1',
  effectiveFrom: '2025-01-01',
  dayTypeMultiplier: { regular: 1, special: 1.3, regularHoliday: 2 },
  nightDifferential: 0.1,
  nightStartHour: 22,
  nightEndHour: 6,
  overtimeMultiplier: 1.25,
  regularHoursPerShift: 8,
};

export const DEMO_HIRING_RULES: HiringRuleVersion = {
  id: 'hiring-demo-2026.1',
  effectiveFrom: '2025-01-01',
  leadTimeDays: { FT: 42, PT: 28, FLOAT: 21 },
  contractWeeklyHours: { FT: 48, PT: 24, FLOAT: 32 },
  recruitingBuffer: 0.1,
  milestones: [
    { name: 'Requisition approved', daysBeforeNeedBy: { FT: 42, PT: 28, FLOAT: 21 } },
    { name: 'Job posted', daysBeforeNeedBy: { FT: 38, PT: 25, FLOAT: 19 } },
    { name: 'Interviews complete', daysBeforeNeedBy: { FT: 28, PT: 18, FLOAT: 14 } },
    { name: 'Offers accepted', daysBeforeNeedBy: { FT: 21, PT: 14, FLOAT: 10 } },
    { name: 'Onboarding and POS training', daysBeforeNeedBy: { FT: 7, PT: 5, FLOAT: 5 } },
    { name: 'Start on the floor', daysBeforeNeedBy: { FT: 0, PT: 0, FLOAT: 0 } },
  ],
};

export const DEMO_RULE_SET: RuleSet = {
  id: 'ruleset-demo-2026.1',
  staffing: DEMO_STAFFING_RULES,
  labor: DEMO_LABOR_RULES,
  wage: DEMO_WAGE_RULES,
  premium: DEMO_PREMIUM_RULES,
  hiring: DEMO_HIRING_RULES,
};

export const DEFAULT_SETTINGS: ScenarioSettings = { growth: 1.05, allowPartTime: true };

/**
 * Pick the version effective on `date`: the latest `effectiveFrom` ≤ date
 * (ties broken by id for determinism). Returns null if none is effective yet.
 */
export function resolveVersion<T extends { readonly id: string; readonly effectiveFrom: IsoDate }>(
  versions: readonly T[],
  date: IsoDate,
): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom > date) continue;
    if (
      best === null ||
      v.effectiveFrom > best.effectiveFrom ||
      (v.effectiveFrom === best.effectiveFrom && v.id > best.id)
    ) {
      best = v;
    }
  }
  return best;
}
