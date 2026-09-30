/**
 * Hourly demand forecast — DOM-001 "Demand forecasting model" and the v3 factor
 * model: Mon–Thu baseline, day-of-week factors, payday factor, seasonal factors
 * per sub-period, per-holiday factors, hourly shapes (weekday / Saturday /
 * Sunday-holiday, separate December shapes) and handle time by period.
 *
 * Factors are learned from one season of hourly history (2025) and projected
 * onto a planning date with a growth setting.
 */
import {
  dayOfWeek,
  holidayOn,
  isPayday,
  SEASONAL_PERIODS,
  seasonalPeriodOf,
  SHAPE_KINDS,
  shapeKindOf,
  tradingHoursOn,
  type SeasonalPeriod,
  type ShapeKind,
} from './calendar.js';
import type { Department, HourlyDemand, HourlyHistoryRow, IsoDate } from './types.js';

/** Learned forecast model for one department. */
export interface DepartmentForecastModel {
  readonly departmentId: string;
  /** Mean daily transactions on base-period Mon–Thu (non-payday, non-holiday) days. */
  readonly baselineDaily: number;
  /** Day-of-week factor indexed 0 = Sunday … 6 = Saturday (Mon–Thu = 1). */
  readonly dowFactor: readonly number[];
  readonly paydayFactor: number;
  readonly seasonalFactor: Readonly<Record<SeasonalPeriod, number>>;
  /** Factor per holiday id (relative to baseline × dow × seasonal × payday). */
  readonly holidayFactor: Readonly<Record<string, number>>;
  /** Share of daily transactions by clock hour (length 24) per shape kind. */
  readonly hourlyShape: Readonly<Record<ShapeKind, readonly number[]>>;
  /** Transaction-weighted mean handle time (seconds) by seasonal period. */
  readonly ahtByPeriod: Readonly<Record<SeasonalPeriod, number>>;
}

export interface DepartmentDayForecast {
  readonly departmentId: string;
  readonly date: IsoDate;
  /** Forecast daily transactions (sum of hourly λ, unrounded). */
  readonly dailyTransactions: number;
  readonly hours: readonly HourlyDemand[];
}

/** Round to 4 decimal places (DOM-001 parity grain for λ). */
export function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

interface DayAgg {
  date: IsoDate;
  total: number;
  hourly: number[];
  ahtWeighted: number;
}

/** Learn one department's forecast model from its hourly history rows. */
export function learnDepartmentModel(departmentId: string, rows: readonly HourlyHistoryRow[]): DepartmentForecastModel {
  const days = new Map<IsoDate, DayAgg>();
  for (const r of rows) {
    if (r.departmentId !== departmentId) continue;
    let agg = days.get(r.date);
    if (!agg) {
      agg = { date: r.date, total: 0, hourly: new Array<number>(24).fill(0), ahtWeighted: 0 };
      days.set(r.date, agg);
    }
    agg.total += r.transactions;
    agg.hourly[r.hour] = (agg.hourly[r.hour] ?? 0) + r.transactions;
    agg.ahtWeighted += r.avgHandleTimeSec * r.transactions;
  }
  const all = [...days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (all.length === 0) throw new Error(`No history for department ${departmentId}`);

  const isPlain = (d: DayAgg): boolean => !isPayday(d.date) && holidayOn(d.date) === null;
  const inBase = (d: DayAgg): boolean => seasonalPeriodOf(d.date) === 'base';

  const baseline = mean(
    all.filter((d) => inBase(d) && isPlain(d) && dayOfWeek(d.date) >= 1 && dayOfWeek(d.date) <= 4).map((d) => d.total),
  );
  if (baseline === null || baseline <= 0) throw new Error(`No base-period weekdays for ${departmentId}`);

  const dowFactor = [0, 1, 2, 3, 4, 5, 6].map((dow) => {
    if (dow >= 1 && dow <= 4) return 1;
    const m = mean(all.filter((d) => inBase(d) && isPlain(d) && dayOfWeek(d.date) === dow).map((d) => d.total));
    return m === null ? 1 : m / baseline;
  });
  const dowOf = (date: IsoDate): number => dowFactor[dayOfWeek(date)] ?? 1;

  const paydayFactor =
    mean(
      all
        .filter((d) => inBase(d) && isPayday(d.date) && holidayOn(d.date) === null)
        .map((d) => d.total / (baseline * dowOf(d.date))),
    ) ?? 1;

  const seasonalEntries = SEASONAL_PERIODS.map((p): [SeasonalPeriod, number] => {
    if (p === 'base') return [p, 1];
    const m = mean(
      all.filter((d) => seasonalPeriodOf(d.date) === p && isPlain(d)).map((d) => d.total / (baseline * dowOf(d.date))),
    );
    return [p, m ?? 1];
  });
  const seasonalFactor = Object.fromEntries(seasonalEntries) as Record<SeasonalPeriod, number>;

  const holidaySamples = new Map<string, number[]>();
  for (const d of all) {
    const h = holidayOn(d.date);
    if (!h) continue;
    const expected =
      baseline * dowOf(d.date) * seasonalFactor[seasonalPeriodOf(d.date)] * (isPayday(d.date) ? paydayFactor : 1);
    const list = holidaySamples.get(h.id) ?? [];
    list.push(d.total / expected);
    holidaySamples.set(h.id, list);
  }
  const holidayFactor: Record<string, number> = {};
  for (const [id, xs] of [...holidaySamples.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    holidayFactor[id] = mean(xs) ?? 1;
  }

  const shapeEntries = SHAPE_KINDS.map((kind): [ShapeKind, number[]] => {
    const sel = all.filter((d) => shapeKindOf(d.date) === kind);
    const sums = new Array<number>(24).fill(0);
    let total = 0;
    for (const d of sel) {
      for (let h = 0; h < 24; h += 1) sums[h] = (sums[h] ?? 0) + (d.hourly[h] ?? 0);
      total += d.total;
    }
    return [kind, sums.map((s) => (total > 0 ? s / total : 0))];
  });
  const hourlyShape = Object.fromEntries(shapeEntries) as Record<ShapeKind, number[]>;

  const ahtEntries = SEASONAL_PERIODS.map((p): [SeasonalPeriod, number] => {
    const sel = all.filter((d) => seasonalPeriodOf(d.date) === p);
    const tx = sel.reduce((s, d) => s + d.total, 0);
    const w = sel.reduce((s, d) => s + d.ahtWeighted, 0);
    return [p, tx > 0 ? w / tx : 0];
  });
  // Periods without history inherit the base-period handle time.
  const baseAht = ahtEntries.find(([p]) => p === 'base')?.[1] ?? 0;
  const ahtByPeriod = Object.fromEntries(ahtEntries.map(([p, v]) => [p, v > 0 ? v : baseAht])) as Record<
    SeasonalPeriod,
    number
  >;

  return {
    departmentId,
    baselineDaily: baseline,
    dowFactor,
    paydayFactor,
    seasonalFactor,
    holidayFactor,
    hourlyShape,
    ahtByPeriod,
  };
}

/** Learn models for every department (keyed by department id). */
export function learnForecastModels(
  departments: readonly Department[],
  rows: readonly HourlyHistoryRow[],
): ReadonlyMap<string, DepartmentForecastModel> {
  const byDept = new Map<string, HourlyHistoryRow[]>();
  for (const r of rows) {
    const list = byDept.get(r.departmentId) ?? [];
    list.push(r);
    byDept.set(r.departmentId, list);
  }
  const out = new Map<string, DepartmentForecastModel>();
  for (const d of departments) out.set(d.id, learnDepartmentModel(d.id, byDept.get(d.id) ?? []));
  return out;
}

/** Forecast daily transactions for a date (before the hourly split). */
export function forecastDailyTransactions(model: DepartmentForecastModel, date: IsoDate, growth: number): number {
  const holiday = holidayOn(date);
  return (
    model.baselineDaily *
    growth *
    (model.dowFactor[dayOfWeek(date)] ?? 1) *
    model.seasonalFactor[seasonalPeriodOf(date)] *
    (isPayday(date) ? model.paydayFactor : 1) *
    (holiday ? (model.holidayFactor[holiday.id] ?? 1) : 1)
  );
}

/** "Normal weekday" volume: the Mon–Thu baseline projected with growth. */
export function normalWeekdayTransactions(model: DepartmentForecastModel, growth: number): number {
  return model.baselineDaily * growth;
}

/**
 * Hourly forecast for one department-day. The shape is restricted to the
 * department's trading hours on that date and renormalised; λ is rounded to
 * 4 dp.
 */
export function forecastDepartmentDay(
  model: DepartmentForecastModel,
  department: Department,
  date: IsoDate,
  growth: number,
): DepartmentDayForecast {
  const daily = forecastDailyTransactions(model, date, growth);
  const { open, close } = tradingHoursOn(department.tradingHours, date);
  const shape = model.hourlyShape[shapeKindOf(date)];
  let openShare = 0;
  for (let h = open; h < close; h += 1) openShare += shape[h] ?? 0;
  const aht = model.ahtByPeriod[seasonalPeriodOf(date)];
  const hours: HourlyDemand[] = [];
  for (let h = open; h < close; h += 1) {
    const share = openShare > 0 ? (shape[h] ?? 0) / openShare : 1 / (close - open);
    hours.push({ hour: h, lambda: round4(daily * share), ahtSec: aht });
  }
  return { departmentId: department.id, date, dailyTransactions: daily, hours };
}
