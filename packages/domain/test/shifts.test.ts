import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEMO_STAFFING_RULES } from '../src/rules.js';
import { buildShifts, coverageOf, shiftKey, summarizeShifts } from '../src/shifts.js';

const rules = DEMO_STAFFING_RULES.shifts;

const curveArb = fc
  .record({
    open: fc.integer({ min: 6, max: 11 }),
    values: fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 16 }),
  })
  .map(({ open, values }) => values.map((cashiersRequired, i) => ({ hour: open + i, cashiersRequired })));

describe('shift builder (DOM-001 shift construction)', () => {
  it('covers a simple curve with FT base load and a meal inside its window', () => {
    const requirement = Array.from({ length: 12 }, (_, i) => ({ hour: 8 + i, cashiersRequired: 2 }));
    const shifts = buildShifts({ departmentId: 'd', date: '2026-12-19', requirement, rules, allowPartTime: true });
    const cover = coverageOf(shifts, requirement.map((r) => r.hour));
    requirement.forEach((r, i) => expect(cover[i]).toBeGreaterThanOrEqual(r.cashiersRequired));
    const ft = shifts.filter((s) => s.type === 'FT');
    expect(ft.length).toBeGreaterThan(0);
    for (const s of ft) {
      expect(s.end - s.start).toBe(rules.ftSpanHours);
      expect(s.paidHours).toBe(rules.ftSpanHours - rules.ftMealHours);
    }
  });

  it.each([true, false])('property: no hour is left short and every FT meal is inside its window (allowPartTime=%s)', (allowPartTime) => {
    fc.assert(
      fc.property(curveArb, (requirement) => {
        const shifts = buildShifts({ departmentId: 'd', date: '2026-12-19', requirement, rules, allowPartTime });
        const hours = requirement.map((r) => r.hour);
        const cover = coverageOf(shifts, hours);
        requirement.forEach((r, i) => expect(cover[i]).toBeGreaterThanOrEqual(r.cashiersRequired));
        const open = hours[0] ?? 0;
        const close = (hours[hours.length - 1] ?? 0) + 1;
        for (const s of shifts) {
          expect(Number.isInteger(s.start)).toBe(true);
          expect(s.start).toBeGreaterThanOrEqual(open);
          expect(s.end).toBeLessThanOrEqual(close);
          if (s.type === 'FT') {
            expect(s.mealHour).not.toBeNull();
            const meal = s.mealHour ?? -1;
            expect(meal).toBeGreaterThanOrEqual(s.start + rules.mealWindow.earliestOffset);
            expect(meal).toBeLessThanOrEqual(s.start + rules.mealWindow.latestOffset);
            expect(s.paidHours).toBe(s.end - s.start - rules.ftMealHours);
          } else {
            expect(s.mealHour).toBeNull();
            expect(s.paidHours).toBe(s.end - s.start);
          }
          if (!allowPartTime) expect(s.type).not.toBe('PT');
        }
      }),
    );
  });

  it('property: deterministic — the same curve always yields the same shift set', () => {
    fc.assert(
      fc.property(curveArb, (requirement) => {
        const a = buildShifts({ departmentId: 'd', date: '2026-12-19', requirement, rules, allowPartTime: true });
        const b = buildShifts({ departmentId: 'd', date: '2026-12-19', requirement, rules, allowPartTime: true });
        expect(a.map(shiftKey)).toEqual(b.map(shiftKey));
      }),
    );
  });

  it('summaries add up by contract type', () => {
    const requirement = Array.from({ length: 15 }, (_, i) => ({ hour: 8 + i, cashiersRequired: 3 + (i % 5) }));
    const shifts = buildShifts({ departmentId: 'd', date: '2026-12-19', requirement, rules, allowPartTime: true });
    const s = summarizeShifts(shifts);
    expect(s.count).toBe(shifts.length);
    expect(s.byType.FT.count + s.byType.PT.count + s.byType.FLOAT.count).toBe(s.count);
    expect(s.byType.FT.paidHours + s.byType.PT.paidHours + s.byType.FLOAT.paidHours).toBe(s.paidHours);
  });

  it('returns no shifts for a closed day', () => {
    expect(buildShifts({ departmentId: 'd', date: '2026-12-19', requirement: [], rules, allowPartTime: true })).toEqual([]);
  });
});
