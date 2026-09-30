import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  addDays,
  dateRange,
  dayOfWeek,
  dayTypeOf,
  fromDayNumber,
  holidayOn,
  isPayday,
  seasonalPeriodOf,
  shapeKindOf,
  toDayNumber,
  tradingHoursOn,
  weekStart,
} from '../src/calendar.js';

describe('calendar', () => {
  it('knows the weekday of the fixture dates', () => {
    expect(dayOfWeek('2026-12-19')).toBe(6); // Saturday
    expect(dayOfWeek('2026-12-20')).toBe(0); // Sunday
    expect(dayOfWeek('2026-12-24')).toBe(4); // Thursday
    expect(dayOfWeek('2025-08-01')).toBe(5); // Friday
  });

  it('property: day-number round trip and addDays are consistent', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40_000 }), fc.integer({ min: -400, max: 400 }), (n, k) => {
        const d = fromDayNumber(n);
        expect(toDayNumber(d)).toBe(n);
        expect(toDayNumber(addDays(d, k))).toBe(n + k);
        expect(dayOfWeek(weekStart(d))).toBe(1);
      }),
    );
  });

  it('rejects malformed dates', () => {
    expect(() => toDayNumber('2026/12/19')).toThrow();
  });

  it('flags paydays on the 15th and the last day of the month', () => {
    expect(isPayday('2026-12-15')).toBe(true);
    expect(isPayday('2026-11-30')).toBe(true);
    expect(isPayday('2026-12-31')).toBe(true);
    expect(isPayday('2026-02-28')).toBe(true);
    expect(isPayday('2026-12-19')).toBe(false);
  });

  it('resolves PH holidays and day types, including the moving National Heroes Day', () => {
    expect(holidayOn('2025-08-25')?.id).toBe('heroes-day');
    expect(holidayOn('2026-08-31')?.id).toBe('heroes-day');
    expect(dayTypeOf('2026-12-25')).toBe('regularHoliday');
    expect(dayTypeOf('2026-12-24')).toBe('special');
    expect(dayTypeOf('2026-12-30')).toBe('regularHoliday');
    expect(dayTypeOf('2026-12-19')).toBe('regular');
  });

  it('maps dates to the v3 seasonal sub-periods', () => {
    expect(seasonalPeriodOf('2025-08-10')).toBe('base');
    expect(seasonalPeriodOf('2025-09-15')).toBe('base');
    expect(seasonalPeriodOf('2025-09-16')).toBe('late-sep');
    expect(seasonalPeriodOf('2026-11-15')).toBe('nov-1-15');
    expect(seasonalPeriodOf('2026-12-19')).toBe('dec-18-23');
    expect(seasonalPeriodOf('2026-12-27')).toBe('dec-26-29');
  });

  it('classifies hourly shapes (holidays use the Sunday shape; December is separate)', () => {
    expect(shapeKindOf('2026-12-19')).toBe('decSaturday');
    expect(shapeKindOf('2026-12-24')).toBe('decSundayHoliday');
    expect(shapeKindOf('2026-10-07')).toBe('weekday');
  });

  it('resolves trading hours: MM-DD override > month > default', () => {
    const rule = {
      default: { open: 8, close: 22 },
      byMonth: { 12: { open: 8, close: 23 } },
      byMonthDay: { '12-24': { close: 19 } },
    };
    expect(tradingHoursOn(rule, '2026-10-01')).toEqual({ open: 8, close: 22 });
    expect(tradingHoursOn(rule, '2026-12-19')).toEqual({ open: 8, close: 23 });
    expect(tradingHoursOn(rule, '2026-12-24')).toEqual({ open: 8, close: 19 });
    expect(dateRange('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
});
