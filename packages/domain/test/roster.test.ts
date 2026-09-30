import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { dateRange } from '../src/calendar.js';
import { createDemoContext, generateStaffPool } from '../src/demo/index.js';
import { checkLaborRules, type StaffMember } from '../src/labor.js';
import { planDepartmentDay, type PlanningContext } from '../src/pipeline.js';
import { assignRoster } from '../src/roster.js';
import { DEMO_LABOR_RULES } from '../src/rules.js';
import { shiftKey } from '../src/shifts.js';
import { CONTRACT_TYPES, type ContractType, type Shift } from '../src/types.js';

let ctx: PlanningContext;
const WEEK = dateRange('2026-12-14', '2026-12-20');
const DEPT = 'smsm-qc:main';
let weekShifts: Shift[];

function poolFor(shifts: readonly Shift[], extra: number, seed = 2026): StaffMember[] {
  const counts = Object.fromEntries(
    CONTRACT_TYPES.map((t) => {
      const perDay = WEEK.map((d) => shifts.filter((s) => s.type === t && s.date === d).length);
      return [t, Math.ceil((Math.max(0, ...perDay) * 7) / 6) + extra];
    }),
  ) as Record<ContractType, number>;
  return generateStaffPool({ storeId: 'smsm-qc', departmentId: DEPT, counts, periodStart: WEEK[0] ?? '', periodDays: 7, seed });
}

beforeAll(() => {
  ctx = createDemoContext();
  weekShifts = WEEK.flatMap((d) => [...planDepartmentDay(ctx, DEPT, d).shifts]);
});

describe('named roster assignment (DOM-001 roster assignment)', () => {
  it('fills every shift of a peak week for QC main lanes without any labor-rule breach', () => {
    const staff = poolFor(weekShifts, 2);
    const r = assignRoster({ shifts: weekShifts, staff, rules: DEMO_LABOR_RULES });
    expect(r.openShifts).toEqual([]);
    expect(r.violations).toEqual([]);
    expect(checkLaborRules(r.assignments, DEMO_LABOR_RULES, staff)).toEqual([]);
  });

  it('roster invariant: the shift set and total hours are preserved (name mapping may differ)', () => {
    const staff = poolFor(weekShifts, 1);
    const r = assignRoster({ shifts: weekShifts, staff, rules: DEMO_LABOR_RULES });
    const keys = [...r.assignments, ...r.openShifts].map(shiftKey).sort();
    expect(keys).toEqual(weekShifts.map(shiftKey).sort());
    const hours = [...r.assignments, ...r.openShifts].reduce((s, x) => s + x.paidHours, 0);
    expect(hours).toBe(weekShifts.reduce((s, x) => s + x.paidHours, 0));
  });

  it('honours availability and contract types', () => {
    const staff = poolFor(weekShifts, 2);
    const r = assignRoster({ shifts: weekShifts, staff, rules: DEMO_LABOR_RULES });
    const byId = new Map(staff.map((s) => [s.id, s]));
    for (const a of r.assignments) {
      const person = byId.get(a.staffId);
      expect(person).toBeDefined();
      expect(person?.unavailableDates).not.toContain(a.date);
      if (a.type === 'FT') expect(person?.contractType).toBe('FT');
    }
  });

  it('leaves shifts open rather than breach the rules when staff are short', () => {
    const staff = poolFor(weekShifts, 0).filter((_, i) => i % 3 !== 0);
    const r = assignRoster({ shifts: weekShifts, staff, rules: DEMO_LABOR_RULES });
    expect(r.openShifts.length).toBeGreaterThan(0);
    expect(r.violations).toEqual([]);
  });

  it('property: for any staff pool size, assignments never breach a rule and the shift set is preserved', () => {
    fc.assert(
      fc.property(fc.integer({ min: -3, max: 3 }), fc.integer({ min: 1, max: 10_000 }), (extra, seed) => {
        const staff = poolFor(weekShifts, Math.max(0, extra), seed).slice(0, Math.max(1, 30 + extra * 5));
        const r = assignRoster({ shifts: weekShifts, staff, rules: DEMO_LABOR_RULES });
        expect(r.violations).toEqual([]);
        expect(r.assignments.length + r.openShifts.length).toBe(weekShifts.length);
      }),
      { numRuns: 15 },
    );
  });
});
