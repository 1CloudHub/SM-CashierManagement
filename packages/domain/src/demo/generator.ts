/**
 * Deterministic synthetic POS history generator (spec Req 19.6) following the
 * prototype v3 demo-data shape (DOM-001 Fixture B): hourly rows per store and
 * department, Aug 1 – Dec 31 2025, 16 columns, with a built-in understaffing
 * pattern in the last-year lanes-open template.
 *
 * All figures are synthetic. They exercise the method; they are not a claim
 * about SM trading.
 */
import {
  dateRange,
  dayNoteOf,
  dayOfWeek,
  dayTypeOf,
  holidayOn,
  isPayday,
  monthOf,
  seasonalPeriodOf,
  shapeKindOf,
  tradingHoursOn,
  type SeasonalPeriod,
  type ShapeKind,
} from '../calendar.js';
import { requiredAgents } from '../erlang.js';
import type { HourlyHistoryRow, ServiceTarget, StoreFormat } from '../types.js';
import { DEMO_DEPARTMENT_SEEDS, DEMO_STORES, type DemandProfile, type DepartmentSeed } from './master.js';
import { createPrng, hashSeed } from './prng.js';

export const DEMO_SEED = 20251231;
export const DEMO_HISTORY_FROM = '2025-08-01';
export const DEMO_HISTORY_TO = '2025-12-31';
export const DEMO_SNAPSHOT_ID = 'snapshot-demo-v3-2025';

/** Generator "truth" per demand profile. */
export interface ProfileTruth {
  /** Sun..Sat multipliers (Mon–Thu = 1). */
  readonly dow: readonly number[];
  readonly payday: number;
  readonly seasonal: Readonly<Record<SeasonalPeriod, number>>;
  readonly holiday: Readonly<Record<string, number>>;
}

const GROCERY_SEASON: Record<SeasonalPeriod, number> = {
  base: 1,
  'late-sep': 1.02,
  oct: 1.05,
  'nov-1-15': 1.08,
  'nov-16-30': 1.12,
  'dec-1-10': 1.3,
  'dec-11-17': 1.5,
  'dec-18-23': 1.8,
  'dec-24-25': 1,
  'dec-26-29': 1.35,
  'dec-30-31': 1,
};

const STORE_SEASON: Record<SeasonalPeriod, number> = {
  base: 1,
  'late-sep': 1.03,
  oct: 1.08,
  'nov-1-15': 1.15,
  'nov-16-30': 1.3,
  'dec-1-10': 1.6,
  'dec-11-17': 1.9,
  'dec-18-23': 2.2,
  'dec-24-25': 1,
  'dec-26-29': 1.4,
  'dec-30-31': 1,
};

const TOYS_SEASON: Record<SeasonalPeriod, number> = {
  ...STORE_SEASON,
  'nov-16-30': 1.45,
  'dec-1-10': 1.9,
  'dec-11-17': 2.3,
  'dec-18-23': 2.68,
  'dec-26-29': 1.5,
};

const GROCERY_HOLIDAYS: Record<string, number> = {
  'ninoy-aquino-day': 1.05,
  'heroes-day': 1.1,
  'all-saints-day': 0.8,
  'all-souls-day': 0.9,
  'bonifacio-day': 1.15,
  'immaculate-conception': 1.2,
  'christmas-eve': 2.68,
  'christmas-day': 0.55,
  'rizal-day': 1.6,
  'new-years-eve': 2.0,
};

const STORE_HOLIDAYS: Record<string, number> = {
  'ninoy-aquino-day': 1.2,
  'heroes-day': 1.3,
  'all-saints-day': 0.9,
  'all-souls-day': 1.0,
  'bonifacio-day': 1.4,
  'immaculate-conception': 1.5,
  'christmas-eve': 2.2,
  'christmas-day': 1.2,
  'rizal-day': 1.8,
  'new-years-eve': 1.3,
};

const GROCERY_DOW = [1.3, 1, 1, 1, 1, 1.1, 1.213];
const STORE_DOW = [1.5, 1, 1, 1, 1, 1.1, 1.4];

export const DEMO_PROFILE_TRUTH: Readonly<Record<DemandProfile, ProfileTruth>> = {
  grocery: { dow: GROCERY_DOW, payday: 1.15, seasonal: GROCERY_SEASON, holiday: GROCERY_HOLIDAYS },
  express: { dow: GROCERY_DOW, payday: 1.1, seasonal: GROCERY_SEASON, holiday: GROCERY_HOLIDAYS },
  generalMerchandise: { dow: STORE_DOW, payday: 1.2, seasonal: STORE_SEASON, holiday: STORE_HOLIDAYS },
  fashion: { dow: STORE_DOW, payday: 1.2, seasonal: STORE_SEASON, holiday: STORE_HOLIDAYS },
  kidsToys: { dow: STORE_DOW, payday: 1.15, seasonal: TOYS_SEASON, holiday: STORE_HOLIDAYS },
  home: { dow: STORE_DOW, payday: 1.2, seasonal: STORE_SEASON, holiday: STORE_HOLIDAYS },
  beauty: { dow: STORE_DOW, payday: 1.2, seasonal: STORE_SEASON, holiday: STORE_HOLIDAYS },
  shoesBags: { dow: STORE_DOW, payday: 1.2, seasonal: STORE_SEASON, holiday: STORE_HOLIDAYS },
};

/** A traffic bump: centre (clock time, e.g. 13.5 = middle of the 1 PM hour), width, height. */
export type Bump = readonly [centre: number, width: number, height: number];

export interface ShapeTruth {
  readonly floor: number;
  readonly bumps: readonly Bump[];
}

export const DEMO_SHAPES: Readonly<Record<StoreFormat, Readonly<Record<ShapeKind, ShapeTruth>>>> = {
  Supermarket: {
    weekday: { floor: 0.3, bumps: [[12.5, 1.3, 1], [18.5, 1.5, 1.1]] },
    saturday: { floor: 0.35, bumps: [[13.5, 1.8, 1.3], [17.5, 1.8, 1]] },
    sundayHoliday: { floor: 0.35, bumps: [[12.5, 2, 1.2], [17.5, 1.8, 1]] },
    decWeekday: { floor: 0.4, bumps: [[12.5, 1.8, 1], [18.5, 2, 1.2]] },
    decSaturday: { floor: 0.6, bumps: [[13, 2.2, 0.9], [17.3, 2.2, 0.9]] },
    decSundayHoliday: { floor: 0.6, bumps: [[13, 2.2, 1.4], [17, 2.2, 1.2]] },
  },
  Hypermarket: {
    weekday: { floor: 0.35, bumps: [[12.5, 1.6, 1.1], [18.5, 1.8, 1]] },
    saturday: { floor: 0.35, bumps: [[12.5, 1.8, 1.35], [17.5, 1.8, 0.95]] },
    sundayHoliday: { floor: 0.35, bumps: [[12.5, 2, 1.3], [17.5, 1.8, 1]] },
    decWeekday: { floor: 0.4, bumps: [[12.5, 1.8, 1.1], [18.5, 2, 1.1]] },
    decSaturday: { floor: 0.5, bumps: [[12.5, 2, 1], [17.5, 2, 0.93]] },
    decSundayHoliday: { floor: 1.2, bumps: [[12.5, 2.2, 1.3], [17.5, 2, 1.05]] },
  },
  'SM Store': {
    weekday: { floor: 0.3, bumps: [[13.5, 1.6, 0.7], [18.5, 1.8, 1.2]] },
    saturday: { floor: 0.3, bumps: [[14.5, 1.8, 0.9], [17.5, 1.8, 1.3]] },
    sundayHoliday: { floor: 0.3, bumps: [[14.5, 2, 1], [17.5, 1.8, 1.2]] },
    decWeekday: { floor: 0.35, bumps: [[13.5, 1.8, 0.8], [18.5, 2, 1.3]] },
    decSaturday: { floor: 0.35, bumps: [[14.5, 2, 0.8], [17.8, 2, 1.4]] },
    decSundayHoliday: { floor: 0.35, bumps: [[14.5, 2.2, 1], [17.5, 2, 1.3]] },
  },
  SaveMore: {
    weekday: { floor: 0.35, bumps: [[11.5, 1.6, 0.8], [17.5, 1.6, 1.2]] },
    saturday: { floor: 0.35, bumps: [[11.5, 1.8, 0.9], [17.5, 1.8, 1.3]] },
    sundayHoliday: { floor: 0.35, bumps: [[11.5, 2, 1], [17.5, 1.8, 1.2]] },
    decWeekday: { floor: 0.4, bumps: [[11.5, 1.8, 0.9], [17.5, 1.8, 1.3]] },
    decSaturday: { floor: 0.4, bumps: [[11.5, 2, 0.9], [17.8, 2, 1.4]] },
    decSundayHoliday: { floor: 0.4, bumps: [[11.5, 2.2, 1], [17.5, 2, 1.3]] },
  },
};

/** Handle-time multiplier by period (bigger Christmas baskets). */
export const DEMO_AHT_PERIOD: Readonly<Record<SeasonalPeriod, number>> = {
  base: 1,
  'late-sep': 1,
  oct: 1.01,
  'nov-1-15': 1.02,
  'nov-16-30': 1.03,
  'dec-1-10': 1.05,
  'dec-11-17': 1.06,
  'dec-18-23': 1.08,
  'dec-24-25': 1.1,
  'dec-26-29': 1.04,
  'dec-30-31': 1.08,
};

/** Service target used to size the last-year lanes-open template. */
const TEMPLATE_TARGET: ServiceTarget = { serviceLevel: 0.9, thresholdSec: 60 };
/**
 * Last-year lanes-open template: sized on a day of the same weekday whose
 * volume only catches up `seasonalCatchUp` of the seasonal uplift, as `scale`
 * × the Erlang need of a shape flattened by `flatness` (0 = follows demand,
 * 1 = flat). This produces the documented understaffing pattern (a minority of
 * hours short in August, most hours short in December).
 */
export const DEMO_LANES_TEMPLATE: {
  readonly scale: number;
  readonly flatness: number;
  readonly seasonalCatchUp: number;
} = { scale: 1.0, flatness: 0.45, seasonalCatchUp: 0.6 };

const DAILY_NOISE_SD = 0.04;
const HOURLY_NOISE_SD = 0.05;
const AHT_NOISE_SD = 0.02;

function shapeWeight(shape: ShapeTruth, hour: number): number {
  let w = shape.floor;
  for (const [centre, width, height] of shape.bumps) {
    const z = (hour + 0.5 - centre) / width;
    w += height * Math.exp(-0.5 * z * z);
  }
  return w;
}

function nonDecKind(kind: ShapeKind): ShapeKind {
  switch (kind) {
    case 'decWeekday':
      return 'weekday';
    case 'decSaturday':
      return 'saturday';
    case 'decSundayHoliday':
      return 'sundayHoliday';
    default:
      return kind;
  }
}

function expectedDaily(seed: DepartmentSeed, date: string): number {
  const t = DEMO_PROFILE_TRUTH[seed.profile];
  const h = holidayOn(date);
  return (
    seed.baseDaily *
    (t.dow[dayOfWeek(date)] ?? 1) *
    t.seasonal[seasonalPeriodOf(date)] *
    (isPayday(date) ? t.payday : 1) *
    (h ? (t.holiday[h.id] ?? 1) : 1)
  );
}

/** Generate the full synthetic hourly history (deterministic for a given seed). */
export function generateDemoHistory(seed: number = DEMO_SEED): HourlyHistoryRow[] {
  const rows: HourlyHistoryRow[] = [];
  const dates = dateRange(DEMO_HISTORY_FROM, DEMO_HISTORY_TO);
  for (const ds of DEMO_DEPARTMENT_SEEDS) {
    const d = ds.department;
    const store = DEMO_STORES.find((s) => s.id === d.storeId);
    if (!store) throw new Error(`Unknown store ${d.storeId}`);
    const rng = createPrng((seed ^ hashSeed(d.id)) >>> 0);
    const shapes = DEMO_SHAPES[store.format];
    for (const date of dates) {
      const { open, close } = tradingHoursOn(d.tradingHours, date);
      const kind = shapeKindOf(date);
      const shape = shapes[kind];
      const templateShape = shapes[nonDecKind(kind)];
      let wsum = 0;
      let tsum = 0;
      for (let h = open; h < close; h += 1) {
        wsum += shapeWeight(shape, h);
        tsum += shapeWeight(templateShape, h);
      }
      const daily = expectedDaily(ds, date) * Math.max(0.5, 1 + DAILY_NOISE_SD * rng.normal());
      // Last-year template: a normal (non-seasonal) day of the same weekday.
      const truth = DEMO_PROFILE_TRUTH[ds.profile];
      const templateDaily =
        ds.baseDaily *
        (truth.dow[dayOfWeek(date)] ?? 1) *
        (1 + DEMO_LANES_TEMPLATE.seasonalCatchUp * (truth.seasonal[seasonalPeriodOf(date)] - 1));
      for (let h = open; h < close; h += 1) {
        const lambda = (daily * shapeWeight(shape, h)) / wsum;
        const transactions = Math.max(0, Math.round(lambda * Math.max(0.3, 1 + HOURLY_NOISE_SD * rng.normal())));
        const aht =
          Math.round(ds.ahtSec * DEMO_AHT_PERIOD[seasonalPeriodOf(date)] * (1 + AHT_NOISE_SD * rng.normal()) * 10) / 10;
        const items = Math.round(transactions * ds.itemsPerTxn * (1 + 0.05 * rng.normal()));
        const sales = Math.round(items * ds.pricePerItem * (1 + 0.05 * rng.normal()) * 100) / 100;
        const f = DEMO_LANES_TEMPLATE.flatness;
        const templateLambda = templateDaily * ((1 - f) * (shapeWeight(templateShape, h) / tsum) + f / (close - open));
        const templateLanes = Math.round(
          DEMO_LANES_TEMPLATE.scale * requiredAgents(templateLambda, ds.ahtSec, TEMPLATE_TARGET),
        );
        const lanesOpen = Math.min(d.installedLanes, Math.max(d.minLanes, templateLanes));
        rows.push({
          storeId: store.id,
          format: store.format,
          region: store.region,
          departmentId: d.id,
          date,
          dayOfWeek: dayOfWeek(date),
          dayType: dayTypeOf(date),
          payday: isPayday(date),
          dayNote: dayNoteOf(date),
          hour: h,
          transactions,
          items: Math.max(0, items),
          sales: Math.max(0, sales),
          avgHandleTimeSec: aht,
          lanesOpen,
          lanesInstalled: d.installedLanes,
        });
      }
    }
  }
  return rows;
}

/** Share of trading hours per month where the lanes-open template is below the Erlang need. */
export function understaffingByMonth(
  rows: readonly HourlyHistoryRow[],
  target: ServiceTarget = TEMPLATE_TARGET,
  minLanesByDept: ReadonlyMap<string, number> = new Map(
    DEMO_DEPARTMENT_SEEDS.map((s) => [s.department.id, s.department.minLanes]),
  ),
): ReadonlyMap<number, number> {
  const short = new Map<number, number>();
  const total = new Map<number, number>();
  for (const r of rows) {
    const m = monthOf(r.date);
    const need = Math.min(
      r.lanesInstalled,
      Math.max(minLanesByDept.get(r.departmentId) ?? 1, requiredAgents(r.transactions, r.avgHandleTimeSec, target)),
    );
    total.set(m, (total.get(m) ?? 0) + 1);
    if (r.lanesOpen < need) short.set(m, (short.get(m) ?? 0) + 1);
  }
  return new Map([...total.entries()].map(([m, t]) => [m, (short.get(m) ?? 0) / t]));
}
