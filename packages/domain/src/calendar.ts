/**
 * Planning calendar: pure date arithmetic on ISO dates, PH holidays, paydays
 * and the prototype v3 seasonal sub-periods (DOM-001 "Notes on the v3 model").
 */
import type { DayType, IsoDate, TradingHours, TradingHoursRule } from './types.js';

const MS_PER_DAY = 86_400_000;

function parse(date: IsoDate): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid ISO date: ${date}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Days since 1970-01-01 (UTC calendar arithmetic; no time zones involved). */
export function toDayNumber(date: IsoDate): number {
  const { y, m, d } = parse(date);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function fromDayNumber(day: number): IsoDate {
  const dt = new Date(day * MS_PER_DAY);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(date) + days);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** Inclusive list of dates from `from` to `to`. */
export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let n = toDayNumber(from); n <= toDayNumber(to); n += 1) out.push(fromDayNumber(n));
  return out;
}

/** Day of week, 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: IsoDate): number {
  // 1970-01-01 was a Thursday (4).
  return (((toDayNumber(date) + 4) % 7) + 7) % 7;
}

export function monthOf(date: IsoDate): number {
  return parse(date).m;
}

export function dayOfMonth(date: IsoDate): number {
  return parse(date).d;
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Monday on or before `date` (roster weeks run Monday–Sunday). */
export function weekStart(date: IsoDate): IsoDate {
  const dow = dayOfWeek(date);
  return addDays(date, -((dow + 6) % 7));
}

/** Payday: the 15th and the last day of the month (v3 payday flag). */
export function isPayday(date: IsoDate): boolean {
  const { y, m, d } = parse(date);
  return d === 15 || d === lastDayOfMonth(y, m);
}

export interface Holiday {
  /** Stable id so a holiday's learned factor carries across years. */
  readonly id: string;
  readonly name: string;
  readonly dayType: Exclude<DayType, 'regular'>;
}

/** Last Monday of August (National Heroes Day). */
function heroesDay(year: number): IsoDate {
  let day = toDayNumber(`${year}-08-31`);
  while (dayOfWeek(fromDayNumber(day)) !== 1) day -= 1;
  return fromDayNumber(day);
}

/**
 * PH holidays inside the Aug–Dec planning window (Proclamation-style list for
 * the demo; the authoritative calendar is a rule version, DOM-003).
 */
export function holidayOn(date: IsoDate): Holiday | null {
  const { y, m, d } = parse(date);
  const md = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (date === heroesDay(y)) return { id: 'heroes-day', name: 'National Heroes Day', dayType: 'regularHoliday' };
  switch (md) {
    case '08-21':
      return { id: 'ninoy-aquino-day', name: 'Ninoy Aquino Day', dayType: 'special' };
    case '11-01':
      return { id: 'all-saints-day', name: "All Saints' Day", dayType: 'special' };
    case '11-02':
      return { id: 'all-souls-day', name: "All Souls' Day", dayType: 'special' };
    case '11-30':
      return { id: 'bonifacio-day', name: 'Bonifacio Day', dayType: 'regularHoliday' };
    case '12-08':
      return { id: 'immaculate-conception', name: 'Feast of the Immaculate Conception', dayType: 'special' };
    case '12-24':
      return { id: 'christmas-eve', name: 'Christmas Eve', dayType: 'special' };
    case '12-25':
      return { id: 'christmas-day', name: 'Christmas Day', dayType: 'regularHoliday' };
    case '12-30':
      return { id: 'rizal-day', name: 'Rizal Day', dayType: 'regularHoliday' };
    case '12-31':
      return { id: 'new-years-eve', name: 'Last Day of the Year', dayType: 'special' };
    default:
      return null;
  }
}

export function dayTypeOf(date: IsoDate): DayType {
  return holidayOn(date)?.dayType ?? 'regular';
}

/** v3 seasonal sub-periods. `base` (Aug 1 – Sep 15) carries factor 1 by definition. */
export type SeasonalPeriod =
  | 'base'
  | 'late-sep'
  | 'oct'
  | 'nov-1-15'
  | 'nov-16-30'
  | 'dec-1-10'
  | 'dec-11-17'
  | 'dec-18-23'
  | 'dec-24-25'
  | 'dec-26-29'
  | 'dec-30-31';

export const SEASONAL_PERIODS: readonly SeasonalPeriod[] = [
  'base',
  'late-sep',
  'oct',
  'nov-1-15',
  'nov-16-30',
  'dec-1-10',
  'dec-11-17',
  'dec-18-23',
  'dec-24-25',
  'dec-26-29',
  'dec-30-31',
];

/**
 * Seasonal sub-period of a date. Dates outside Aug–Dec fall back to `base`.
 * Dec 24/25 and Dec 30/31 are holiday-only periods (their factor is carried by
 * the per-holiday factor; the period factor is 1).
 */
export function seasonalPeriodOf(date: IsoDate): SeasonalPeriod {
  const { m, d } = parse(date);
  if (m === 9 && d >= 16) return 'late-sep';
  if (m === 10) return 'oct';
  if (m === 11) return d <= 15 ? 'nov-1-15' : 'nov-16-30';
  if (m === 12) {
    if (d <= 10) return 'dec-1-10';
    if (d <= 17) return 'dec-11-17';
    if (d <= 23) return 'dec-18-23';
    if (d <= 25) return 'dec-24-25';
    if (d <= 29) return 'dec-26-29';
    return 'dec-30-31';
  }
  return 'base';
}

/** Hourly-shape class (weekday / Saturday / Sunday-or-holiday; separate December shapes). */
export type ShapeKind = 'weekday' | 'saturday' | 'sundayHoliday' | 'decWeekday' | 'decSaturday' | 'decSundayHoliday';

export const SHAPE_KINDS: readonly ShapeKind[] = [
  'weekday',
  'saturday',
  'sundayHoliday',
  'decWeekday',
  'decSaturday',
  'decSundayHoliday',
];

export function shapeKindOf(date: IsoDate): ShapeKind {
  const dec = monthOf(date) === 12;
  const dow = dayOfWeek(date);
  if (dow === 0 || holidayOn(date) !== null) return dec ? 'decSundayHoliday' : 'sundayHoliday';
  if (dow === 6) return dec ? 'decSaturday' : 'saturday';
  return dec ? 'decWeekday' : 'weekday';
}

/** Short human note used in the history `dayNote` column. */
export function dayNoteOf(date: IsoDate): string {
  const h = holidayOn(date);
  if (h) return h.name;
  if (isPayday(date)) return 'Payday';
  return '';
}

/** Resolve a department's trading hours on a date (MM-DD override > month > default). */
export function tradingHoursOn(rule: TradingHoursRule, date: IsoDate): TradingHours {
  const { m, d } = parse(date);
  const base = rule.byMonth?.[m] ?? rule.default;
  const md = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const override = rule.byMonthDay?.[md];
  return { open: override?.open ?? base.open, close: override?.close ?? base.close };
}
