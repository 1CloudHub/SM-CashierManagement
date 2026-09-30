import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addDays } from '../src/calendar.js';
import { checkLaborRules, evaluateRosterChange, type AssignedShift, type StaffMember } from '../src/labor.js';
import { DEMO_LABOR_RULES } from '../src/rules.js';
import type { ContractType } from '../src/types.js';

const rules = DEMO_LABOR_RULES;
let seq = 0;

function shift(staffId: string, date: string, start: number, end: number, type: ContractType = 'FT'): AssignedShift {
  seq += 1;
  const meal = type === 'FT' && end - start >= 9 ? start + 4 : null;
  return {
    id: `s${seq}`,
    departmentId: 'd',
    date,
    type,
    start,
    end,
    mealHour: meal,
    paidHours: end - start - (meal === null ? 0 : 1),
    staffId,
  };
}

function days(staffId: string, from: string, n: number, start = 8, end = 17): AssignedShift[] {
  return Array.from({ length: n }, (_, i) => shift(staffId, addDays(from, i), start, end));
}

const ana: StaffMember = {
  id: 'ana',
  name: 'Ana Reyes',
  storeId: 's',
  departmentId: 'd',
  contractType: 'FT',
  preferredRestDay: 0,
  unavailableDates: [],
};

describe('PH labor-rule checks', () => {
  it('passes a compliant 6-on / 1-off week', () => {
    expect(checkLaborRules(days('ana', '2026-12-14', 6), rules, [ana])).toEqual([]);
  });

  it('hard-blocks a 7th consecutive working day (missed 24-hour rest)', () => {
    const v = checkLaborRules(days('ana', '2026-12-14', 7), rules, [ana]);
    const block = v.filter((x) => x.rule === 'MANDATORY_REST');
    expect(block).toHaveLength(1);
    expect(block[0]?.severity).toBe('block');
    expect(block[0]?.date).toBe('2026-12-20');
    expect(block[0]?.message).toMatch(/24-hour rest/);
  });

  it('hard-blocks a rest shorter than 24 h after 6 consecutive days even across a calendar gap', () => {
    // Day 6 ends at 26:00 (02:00 next day); next shift starts the day after at 00:00 → 22 h.
    const run = [...days('ana', '2026-12-14', 5), shift('ana', '2026-12-19', 17, 26), shift('ana', '2026-12-21', 0, 8, 'PT')];
    const v = checkLaborRules(run, rules, [ana]);
    expect(v.some((x) => x.rule === 'MANDATORY_REST' && x.severity === 'block' && x.date === '2026-12-21')).toBe(true);
  });

  it('warns on rest under 10 h between shifts', () => {
    const v = checkLaborRules([shift('ana', '2026-12-14', 13, 22), shift('ana', '2026-12-15', 6, 15)], rules, [ana]);
    expect(v).toEqual([expect.objectContaining({ rule: 'MIN_REST', severity: 'warning', date: '2026-12-15' })]);
  });

  it('warns on weekly hours above the contract cap', () => {
    const long = Array.from({ length: 6 }, (_, i) => shift('ana', addDays('2026-12-14', i), 8, 18, 'PT'));
    const v = checkLaborRules(long, rules, [{ ...ana, contractType: 'PT' }]);
    expect(v).toEqual([expect.objectContaining({ rule: 'WEEKLY_HOURS', severity: 'warning', date: '2026-12-14' })]);
  });

  it('blocks overlapping shifts for the same person', () => {
    const v = checkLaborRules([shift('ana', '2026-12-14', 8, 17), shift('ana', '2026-12-14', 12, 16, 'PT')], rules, [ana]);
    expect(v.some((x) => x.rule === 'OVERLAP' && x.severity === 'block')).toBe(true);
  });

  it('warns (not blocks) when a stricter policy maximum of consecutive days is exceeded', () => {
    const strict = { ...rules, maxConsecutiveDays: 5 };
    const v = checkLaborRules(days('ana', '2026-12-14', 6), strict, [ana]);
    expect(v).toEqual([expect.objectContaining({ rule: 'CONSECUTIVE_DAYS', severity: 'warning', date: '2026-12-19' })]);
  });

  it('property: any run of 7+ consecutive working days always produces a block', () => {
    fc.assert(
      fc.property(fc.integer({ min: 7, max: 14 }), fc.integer({ min: 6, max: 14 }), fc.integer({ min: 0, max: 60 }), (n, start, offset) => {
        const v = checkLaborRules(days('x', addDays('2026-10-01', offset), n, start, start + 8), rules);
        expect(v.filter((x) => x.severity === 'block').length).toBe(n - rules.restAfterConsecutiveDays);
      }),
    );
  });

  it('property: runs of at most 6 days with ≥ 24 h breaks never block', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 6 }), { minLength: 1, maxLength: 5 }), (runs) => {
        const all: AssignedShift[] = [];
        let d = '2026-10-05';
        for (const r of runs) {
          all.push(...days('x', d, r));
          d = addDays(d, r + 1);
        }
        expect(checkLaborRules(all, rules).filter((x) => x.severity === 'block')).toEqual([]);
      }),
    );
  });
});

describe('roster change evaluation (spec Req 7.3 / 7.4)', () => {
  const before = days('ana', '2026-12-14', 6);

  it('saves a compliant change without a reason', () => {
    const after = [...before.slice(0, 5), shift('ana', '2026-12-19', 9, 18)];
    const r = evaluateRosterChange(before, after, rules, [ana]);
    expect(r).toMatchObject({ status: 'ok', canSave: true, newViolations: [] });
  });

  it('requires a reason for a warning-level breach and records it', () => {
    const base = before.slice(0, 4);
    // Late close on Friday followed by an early open on Saturday: 8 h rest (< 10 h).
    const after = [...base, shift('ana', '2026-12-18', 13, 22), shift('ana', '2026-12-19', 6, 15)];
    const noReason = evaluateRosterChange(before.slice(0, 5), after, rules, [ana]);
    expect(noReason.status).toBe('needsReason');
    expect(noReason.canSave).toBe(false);
    const blank = evaluateRosterChange(before.slice(0, 5), after, rules, [ana], '   ');
    expect(blank.canSave).toBe(false);
    const withReason = evaluateRosterChange(before.slice(0, 5), after, rules, [ana], '  Emergency cover for a sick colleague ');
    expect(withReason).toMatchObject({ status: 'needsReason', canSave: true, reason: 'Emergency cover for a sick colleague' });
    expect(withReason.newViolations.map((v) => v.rule)).toEqual(['MIN_REST']);
  });

  it('never saves a change that removes the mandatory 24-hour rest, even with a reason', () => {
    const after = [...before, shift('ana', '2026-12-20', 8, 17)];
    const r = evaluateRosterChange(before, after, rules, [ana], 'Peak weekend');
    expect(r.status).toBe('blocked');
    expect(r.canSave).toBe(false);
    expect(r.blocking.map((v) => v.rule)).toEqual(['MANDATORY_REST']);
  });
});
