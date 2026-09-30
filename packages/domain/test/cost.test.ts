import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { costShift, costShifts, hourlyRate } from '../src/cost.js';
import { DEMO_PREMIUM_RULES, DEMO_WAGE_RULES, resolveVersion, type WageRuleVersion } from '../src/rules.js';
import type { Shift } from '../src/types.js';

const rules = { wage: DEMO_WAGE_RULES, premium: DEMO_PREMIUM_RULES };
const rateNcr = hourlyRate(DEMO_WAGE_RULES, 'NCR');

function s(date: string, start: number, end: number, mealHour: number | null = null): Shift {
  return { id: `${date}-${start}`, departmentId: 'd', date, type: 'FT', start, end, mealHour, paidHours: end - start - (mealHour === null ? 0 : 1) };
}

describe('cost model (DOM-001: hours × wage × premium multipliers)', () => {
  it('prices a regular-day FT shift at base rate, meal unpaid', () => {
    const c = costShift(s('2026-12-16', 8, 17, 12), 'NCR', rules);
    expect(c.paidHours).toBe(8);
    expect(c.cost).toBeCloseTo(8 * rateNcr, 9);
  });

  it('applies the +10 % night differential for hours from 22:00', () => {
    const c = costShift(s('2026-12-16', 15, 23), 'NCR', rules);
    expect(c.cost).toBeCloseTo(7 * rateNcr + 1 * rateNcr * 1.1, 9);
  });

  it('applies PH day-type multipliers (special 130 %, regular holiday 200 %)', () => {
    expect(costShift(s('2026-12-24', 8, 12), 'NCR', rules).cost).toBeCloseTo(4 * rateNcr * 1.3, 9);
    expect(costShift(s('2026-12-25', 8, 12), 'NCR', rules).cost).toBeCloseTo(4 * rateNcr * 2, 9);
  });

  it('applies overtime beyond the regular hours per shift', () => {
    const c = costShift(s('2026-12-16', 8, 18), 'NCR', rules);
    expect(c.cost).toBeCloseTo(8 * rateNcr + 2 * rateNcr * 1.25, 9);
  });

  it('uses the region rate with employer loading, falling back to the default rate', () => {
    expect(hourlyRate(DEMO_WAGE_RULES, 'NCR')).toBeCloseTo(86.875 * 1.14, 9);
    expect(hourlyRate(DEMO_WAGE_RULES, 'Mars')).toBeCloseTo(80 * 1.14, 9);
  });

  it('records the wage and premium rule versions used (P6)', () => {
    const b = costShifts([s('2026-12-16', 8, 17, 12)], () => 'NCR', rules);
    expect(b.wageRuleVersionId).toBe(DEMO_WAGE_RULES.id);
    expect(b.premiumRuleVersionId).toBe(DEMO_PREMIUM_RULES.id);
  });

  it('property: cost is linear in the wage rate', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.5, max: 3, noNaN: true }), fc.integer({ min: 6, max: 14 }), (k, start) => {
        const scaled: WageRuleVersion = {
          ...DEMO_WAGE_RULES,
          id: 'scaled',
          hourlyRateByRegion: Object.fromEntries(Object.entries(DEMO_WAGE_RULES.hourlyRateByRegion).map(([r, v]) => [r, v * k])),
        };
        const shift = s('2026-12-19', start, start + 9, start + 4);
        const a = costShift(shift, 'NCR', rules).cost;
        const b = costShift(shift, 'NCR', { ...rules, wage: scaled }).cost;
        expect(b).toBeCloseTo(a * k, 6);
      }),
    );
  });
});

describe('rule version resolution', () => {
  const v1 = { id: 'w-1', effectiveFrom: '2025-01-01' };
  const v2 = { id: 'w-2', effectiveFrom: '2026-11-01' };
  it('picks the latest version effective on the date', () => {
    expect(resolveVersion([v1, v2], '2026-10-31')?.id).toBe('w-1');
    expect(resolveVersion([v2, v1], '2026-11-01')?.id).toBe('w-2');
    expect(resolveVersion([v1, v2], '2024-12-31')).toBeNull();
  });
});
