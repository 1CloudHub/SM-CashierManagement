/**
 * Core input/output types for the LaneWise staffing domain.
 *
 * The domain package is deliberately self-contained (no dependency on other
 * repo packages): the API/shared layers map their own DTOs onto these types.
 * All dates are ISO calendar dates (`YYYY-MM-DD`) interpreted in store-local
 * time (Asia/Manila); hours are integer clock hours 0–23 (an interval `h`
 * covers `[h:00, h+1:00)`), matching the prototype v3 hourly grain.
 */

/** ISO calendar date `YYYY-MM-DD`. */
export type IsoDate = string;

/** Clock hour 0–23; hour `h` is the interval `[h:00, h+1:00)`. */
export type Hour = number;

export type StoreFormat = 'Supermarket' | 'Hypermarket' | 'SM Store' | 'SaveMore';

export type ContractType = 'FT' | 'PT' | 'FLOAT';

export const CONTRACT_TYPES: readonly ContractType[] = ['FT', 'PT', 'FLOAT'];

/** PH day type used for premium pay and the forecast calendar. */
export type DayType = 'regular' | 'special' | 'regularHoliday';

export interface Store {
  readonly id: string;
  readonly name: string;
  readonly format: StoreFormat;
  readonly region: string;
}

export interface Department {
  readonly id: string;
  readonly storeId: string;
  readonly name: string;
  readonly installedLanes: number;
  /** Minimum lanes kept open whenever the department trades (v3 minimum-lane floor). */
  readonly minLanes: number;
  readonly tradingHours: TradingHoursRule;
}

/**
 * Trading-hours master data: a default, optional per-month override and
 * optional `MM-DD` overrides (e.g. early close on Christmas Eve).
 */
export interface TradingHoursRule {
  readonly default: TradingHours;
  readonly byMonth?: Readonly<Record<number, TradingHours>>;
  readonly byMonthDay?: Readonly<Record<string, Partial<TradingHours>>>;
}

/** One hourly row of POS history (DOM-001 Fixture B column set). */
export interface HourlyHistoryRow {
  readonly storeId: string;
  readonly format: StoreFormat;
  readonly region: string;
  readonly departmentId: string;
  readonly date: IsoDate;
  readonly dayOfWeek: number;
  readonly dayType: DayType;
  readonly payday: boolean;
  readonly dayNote: string;
  readonly hour: Hour;
  readonly transactions: number;
  readonly items: number;
  readonly sales: number;
  /** Average handle time, seconds per transaction. */
  readonly avgHandleTimeSec: number;
  readonly lanesOpen: number;
  readonly lanesInstalled: number;
}

/** Trading hours for a department on a date: open hour (inclusive) to close hour (exclusive). */
export interface TradingHours {
  readonly open: Hour;
  readonly close: Hour;
}

/** Service-level target: `serviceLevel` share of customers served within `thresholdSec`. */
export interface ServiceTarget {
  readonly serviceLevel: number;
  readonly thresholdSec: number;
}

/** Hourly demand for one department-day. */
export interface HourlyDemand {
  readonly hour: Hour;
  /** Expected arrivals λ (transactions per hour), rounded to 4 dp (DOM-001 parity). */
  readonly lambda: number;
  /** Average handle time in seconds. */
  readonly ahtSec: number;
}

/** Shift as built by the shift builder (unnamed). */
export interface Shift {
  /** Deterministic id, unique within its department-day. */
  readonly id: string;
  readonly departmentId: string;
  readonly date: IsoDate;
  readonly type: ContractType;
  /** Start hour (shifts start on the hour — v3 limitation preserved). */
  readonly start: Hour;
  /** End hour (exclusive). May exceed 24 only if trading hours do. */
  readonly end: Hour;
  /** Meal-break hour (FT shifts only; 1 hour unpaid). */
  readonly mealHour: Hour | null;
  /** Paid hours = span minus unpaid meal. */
  readonly paidHours: number;
}

/** Provenance recorded on every result (spec Req 4.3, Property 6). */
export interface Provenance {
  /** Id of the pinned rule-set bundle. */
  readonly rulesVersionId: string;
  /** Id of every individual rule version in the bundle (staffing, labor, wage, premium, hiring). */
  readonly ruleVersionIds: Readonly<Record<string, string>>;
  readonly snapshotId: string;
}
