/**
 * Override planning and labor-rule checks, without a database (task 13.4;
 * Req 7.3/7.4; P14): a change whose after-state leaves an affected cashier
 * with a blocking breach (missed 24-hour rest after 6 consecutive days,
 * overlap) is always `blocked`; any other new breach needs a reason.
 */
import { DEMO_LABOR_RULES, checkLaborRules, type StaffMember } from '@lanewise/domain';
import { localToInstant, overrideSaveDecision, type ShiftOverrideRequest } from '@lanewise/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { affectedStaff, checkOverride, planOverride, toAssignedShift, type StoredShift } from '../../src/rosters/overrides.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const DEPT = 'dddddddd-0000-4000-8000-000000000003';
const STAFF: StaffMember[] = [A, B].map((id) => ({
  id,
  name: id,
  storeId: 's',
  departmentId: DEPT,
  contractType: 'FT',
  preferredRestDay: 0,
  unavailableDates: [],
}));

const date = (day: number) => `2026-12-${String(7 + day).padStart(2, '0')}`;

function shift(id: string, staffId: string | null, day: number, startH: number, hours: number): StoredShift {
  return {
    id,
    rosterId: 'r',
    staffId,
    departmentId: DEPT,
    startsAt: new Date(localToInstant(date(day), startH * 60)),
    endsAt: new Date(localToInstant(date(day), (startH + hours) * 60)),
    activities: [],
    status: 'scheduled',
  };
}

/** Each cashier works a random subset of 14 days; a few open shifts too. */
const worldArb = fc
  .tuple(
    fc.array(fc.tuple(fc.boolean(), fc.integer({ min: 6, max: 14 }), fc.integer({ min: 4, max: 10 })), { minLength: 14, maxLength: 14 }),
    fc.array(fc.tuple(fc.boolean(), fc.integer({ min: 6, max: 14 }), fc.integer({ min: 4, max: 10 })), { minLength: 14, maxLength: 14 }),
    fc.array(fc.tuple(fc.integer({ min: 0, max: 13 }), fc.integer({ min: 6, max: 16 })), { maxLength: 3 }),
  )
  .map(([a, b, open]) => [
    ...a.flatMap(([on, h, len], d) => (on ? [shift(`a${d}`, A, d, h, len)] : [])),
    ...b.flatMap(([on, h, len], d) => (on ? [shift(`b${d}`, B, d, h, len)] : [])),
    ...open.map(([d, h], i) => shift(`o${i}`, null, d, h, 8)),
  ]);

const requestArb = (shifts: readonly StoredShift[]): fc.Arbitrary<{ request: ShiftOverrideRequest; target: StoredShift | null }> => {
  const ids = shifts.map((s) => s.id);
  const pick = fc.constantFrom(...ids).map((id) => shifts.find((s) => s.id === id) as StoredShift);
  const other = (s: StoredShift) => (s.staffId === A ? B : A);
  return fc.oneof(
    pick.map((t) => ({ request: { type: 'reassign', shiftId: t.id, toStaffId: other(t) } as ShiftOverrideRequest, target: t })),
    pick.map((t) => ({
      request: { type: 'emergency_off', shiftId: t.id, replacementStaffId: other(t), offReason: 'sickCall' } as ShiftOverrideRequest,
      target: t,
    })),
    fc.tuple(pick, fc.integer({ min: 0, max: 13 }), fc.integer({ min: 0, max: 20 }), fc.integer({ min: 2, max: 12 })).map(([t, d, h, len]) => ({
      request: { type: 'time_change', shiftId: t.id, date: date(d), startMin: h * 60, endMin: (h + len) * 60 } as ShiftOverrideRequest,
      target: t,
    })),
    pick.map((t) => ({ request: { type: 'remove', shiftId: t.id } as ShiftOverrideRequest, target: t })),
    fc.tuple(fc.constantFrom<string | null>(A, B, null), fc.integer({ min: 0, max: 13 }), fc.integer({ min: 0, max: 18 })).map(([s, d, h]) => ({
      request: { type: 'add', staffId: s, departmentId: DEPT, date: date(d), startMin: h * 60, endMin: (h + 6) * 60 } as ShiftOverrideRequest,
      target: null,
    })),
  );
};

describe('P14 checkOverride', () => {
  it('blocks exactly the changes that leave an affected cashier with a blocking breach; warnings need a reason', () => {
    fc.assert(
      fc.property(
        worldArb.filter((w) => w.some((s) => s.staffId !== null)).chain((w) => fc.tuple(fc.constant(w), requestArb(w))),
        ([world, { request, target }]) => {
          if ((request.type === 'reassign' || request.type === 'emergency_off') && target?.staffId === null) return;
          const plan = planOverride(request, target);
          const check = checkOverride(plan, { shifts: world, staff: STAFF, rules: DEMO_LABOR_RULES });

          const who = new Set(affectedStaff(plan));
          const targetId = target?.id ?? '__added__';
          const afterShifts = [
            ...world.filter((s) => s.id !== targetId),
            ...(plan.after ? [{ ...plan.after, id: targetId, rosterId: 'r', status: 'scheduled' as const }] : []),
          ].flatMap((s) => (s.staffId !== null && who.has(s.staffId) ? [toAssignedShift({ ...s, staffId: s.staffId }, 'FT')] : []));
          const afterBlocks = checkLaborRules(afterShifts, DEMO_LABOR_RULES, STAFF).filter((v) => v.severity === 'block');

          expect(check.status === 'blocked').toBe(afterBlocks.length > 0);
          const decision = overrideSaveDecision(check, null);
          const withReason = overrideSaveDecision(check, 'Typhoon cover');
          if (afterBlocks.length > 0) {
            // The 24-hour-rest (or overlap) breach is never saved, reason or not.
            expect(decision.ok).toBe(false);
            expect(withReason.ok).toBe(false);
          } else if (check.breaches.length > 0) {
            expect(decision).toEqual({ ok: false, code: 'reason_required' });
            expect(withReason).toMatchObject({ ok: true, reason: 'Typhoon cover', ruleBreaches: check.breaches });
          } else {
            expect(decision.ok).toBe(true);
          }
          // Breaches only ever concern the cashiers the change touches.
          for (const b of [...check.breaches, ...check.blocking]) expect(who.has(b.staffId)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('blocks a 7th consecutive working day and asks a reason for short rest', () => {
    const six = [0, 1, 2, 3, 4, 5].map((d) => shift(`a${d}`, A, d, 9, 9));
    const open = shift('open', null, 6, 9, 9);
    const seventh = checkOverride(planOverride({ type: 'reassign', shiftId: 'open', toStaffId: A }, { ...open, staffId: B }), {
      shifts: [...six, open],
      staff: STAFF,
      rules: DEMO_LABOR_RULES,
    });
    expect(seventh.status).toBe('blocked');
    expect(seventh.blocking.map((b) => b.rule)).toContain('MANDATORY_REST');

    const late = checkOverride(
      planOverride({ type: 'time_change', shiftId: 'a1', date: date(1), startMin: 14 * 60, endMin: 24 * 60 }, six[1] ?? null),
      { shifts: [...six.slice(0, 3)], staff: STAFF, rules: DEMO_LABOR_RULES },
    );
    expect(late.status).toBe('needsReason');
    expect(late.breaches.map((b) => b.rule)).toEqual(['MIN_REST']);
  });

  it('refuses changes that make no sense for the shift', () => {
    const s = shift('a0', A, 0, 9, 8);
    expect(() => planOverride({ type: 'reassign', shiftId: 'a0', toStaffId: A }, s)).toThrow(/already assigned/);
    expect(() => planOverride({ type: 'emergency_off', shiftId: 'o', replacementStaffId: null, offReason: 'other' }, { ...s, staffId: null })).toThrow(
      /open/,
    );
  });
});
