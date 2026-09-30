import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { dateRange, dayOfWeek, holidayOn, isPayday, seasonalPeriodOf } from '../src/calendar.js';
import {
  forecastDailyTransactions,
  forecastDepartmentDay,
  learnDepartmentModel,
  normalWeekdayTransactions,
  round4,
} from '../src/forecast.js';
import type { Department, HourlyHistoryRow } from '../src/types.js';

const dept: Department = {
  id: 's1:main',
  storeId: 's1',
  name: 'Main lanes',
  installedLanes: 20,
  minLanes: 2,
  tradingHours: { default: { open: 8, close: 20 } },
};

/**
 * Noise-free history built from known factors: the learned model must recover
 * them exactly (up to floating-point error).
 */
function syntheticHistory(truth: { base: number; sat: number; sun: number; fri: number; payday: number; oct: number; xmasEve: number }): HourlyHistoryRow[] {
  const rows: HourlyHistoryRow[] = [];
  const shape = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 5, 4, 3, 4, 5, 3, 1];
  const sum = shape.reduce((a, b) => a + b, 0);
  for (const date of dateRange('2025-08-01', '2025-12-31')) {
    const dow = dayOfWeek(date);
    const dowF = dow === 6 ? truth.sat : dow === 0 ? truth.sun : dow === 5 ? truth.fri : 1;
    const p = seasonalPeriodOf(date);
    const seasonal = p === 'oct' ? truth.oct : 1;
    const h = holidayOn(date);
    const daily = truth.base * dowF * seasonal * (isPayday(date) ? truth.payday : 1) * (h?.id === 'christmas-eve' ? truth.xmasEve : 1);
    for (let hour = 8; hour < 20; hour += 1) {
      rows.push({
        storeId: 's1',
        format: 'Supermarket',
        region: 'NCR',
        departmentId: dept.id,
        date,
        dayOfWeek: dow,
        dayType: 'regular',
        payday: isPayday(date),
        dayNote: '',
        hour,
        transactions: (daily * (shape[hour] ?? 0)) / sum,
        items: 0,
        sales: 0,
        avgHandleTimeSec: 150,
        lanesOpen: 5,
        lanesInstalled: 20,
      });
    }
  }
  return rows;
}

describe('forecast model (DOM-001 demand forecasting)', () => {
  const truth = { base: 1000, sat: 1.25, sun: 1.3, fri: 1.1, payday: 1.15, oct: 1.05, xmasEve: 2 };
  const model = learnDepartmentModel(dept.id, syntheticHistory(truth));

  it('recovers the Mon–Thu baseline and the day-of-week / payday / seasonal factors', () => {
    expect(model.baselineDaily).toBeCloseTo(1000, 9);
    expect(model.dowFactor[6]).toBeCloseTo(1.25, 9);
    expect(model.dowFactor[0]).toBeCloseTo(1.3, 9);
    expect(model.dowFactor[5]).toBeCloseTo(1.1, 9);
    expect(model.dowFactor[2]).toBe(1);
    expect(model.paydayFactor).toBeCloseTo(1.15, 9);
    expect(model.seasonalFactor.oct).toBeCloseTo(1.05, 9);
    expect(model.seasonalFactor.base).toBe(1);
    expect(model.holidayFactor['christmas-eve']).toBeCloseTo(2, 9);
    expect(model.ahtByPeriod.oct).toBeCloseTo(150, 9);
  });

  it('projects a planning date with growth and splits it by the hourly shape', () => {
    // Sat Oct 10 2026, not a payday: 1000 × 1.05 growth × 1.25 Sat × 1.05 Oct.
    const daily = forecastDailyTransactions(model, '2026-10-10', 1.05);
    expect(daily).toBeCloseTo(1000 * 1.05 * 1.25 * 1.05, 6);
    expect(normalWeekdayTransactions(model, 1.05)).toBeCloseTo(1050, 9);
    const f = forecastDepartmentDay(model, dept, '2026-10-10', 1.05);
    expect(f.hours.map((h) => h.hour)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    const total = f.hours.reduce((s, h) => s + h.lambda, 0);
    expect(Math.abs(total - daily)).toBeLessThan(12 * 0.00005 + 1e-9);
  });

  it('λ is reported to exactly 4 decimal places (DOM-001 parity grain)', () => {
    const f = forecastDepartmentDay(model, dept, '2026-12-19', 1.05);
    for (const h of f.hours) expect(h.lambda).toBe(round4(h.lambda));
  });

  it('property: the forecast is linear in growth', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.5, max: 2, noNaN: true }), fc.integer({ min: 0, max: 91 }), (g, offset) => {
        const date = dateRange('2026-10-01', '2026-12-31')[offset] ?? '2026-10-01';
        const a = forecastDailyTransactions(model, date, 1);
        const b = forecastDailyTransactions(model, date, g);
        expect(b).toBeCloseTo(a * g, 6);
      }),
    );
  });

  it('throws for a department without history', () => {
    expect(() => learnDepartmentModel('nope', [])).toThrow(/No history/);
  });
});
