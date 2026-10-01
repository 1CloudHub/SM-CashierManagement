/**
 * Roster override contracts (task 13.4; Req 7; P14): the save decision,
 * request validation, replacement ranking and the local-time helpers.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  instantToLocal,
  localToInstant,
  overrideCheckOf,
  overrideSaveDecision,
  rankReplacements,
  shiftLocalTimes,
  validateShiftOverrideRequest,
  type LaborBreach,
  type ReplacementCandidate,
} from '../src/index.js';

const breachArb = (severity?: 'warning' | 'block'): fc.Arbitrary<LaborBreach> =>
  fc.record({
    rule: fc.constantFrom('CONSECUTIVE_DAYS', 'WEEKLY_HOURS', 'MIN_REST', 'MANDATORY_REST', 'OVERLAP'),
    severity: severity ? fc.constant(severity) : fc.constantFrom('warning', 'block'),
    staffId: fc.constantFrom('s1', 's2'),
    date: fc.constantFrom('2026-12-19', '2026-12-20'),
    message: fc.string(),
  }) as fc.Arbitrary<LaborBreach>;

describe('P14 override save decision', () => {
  it('never saves a blocking breach, and saves a warning only with a reason recorded alongside it', () => {
    fc.assert(
      fc.property(
        fc.array(breachArb(), { maxLength: 4 }),
        fc.array(breachArb('block'), { maxLength: 2 }),
        fc.option(fc.string({ maxLength: 20 })),
        (breaches, blocking, reason) => {
          const check = overrideCheckOf(breaches, blocking);
          const decision = overrideSaveDecision(check, reason);
          const anyBlock = blocking.length > 0 || breaches.some((b) => b.severity === 'block');
          if (anyBlock) {
            expect(decision).toEqual({ ok: false, code: 'blocked' });
            return;
          }
          const hasReason = (reason ?? '').trim().length > 0;
          if (breaches.length > 0 && !hasReason) {
            expect(decision).toEqual({ ok: false, code: 'reason_required' });
            return;
          }
          expect(decision.ok).toBe(true);
          if (!decision.ok) return;
          expect(decision.ruleBreaches).toEqual(breaches);
          // Every saved breach carries a reason.
          if (decision.ruleBreaches.length > 0) expect(decision.reason?.length ?? 0).toBeGreaterThan(0);
          expect(decision.reason).toBe(hasReason ? (reason ?? '').trim() : null);
        },
      ),
    );
  });

  it('classifies checks', () => {
    const w: LaborBreach = { rule: 'MIN_REST', severity: 'warning', staffId: 's', date: '2026-12-19', message: '' };
    const b: LaborBreach = { ...w, rule: 'MANDATORY_REST', severity: 'block' };
    expect(overrideCheckOf([], []).status).toBe('ok');
    expect(overrideCheckOf([w], []).status).toBe('needsReason');
    expect(overrideCheckOf([w], [b]).status).toBe('blocked');
    expect(overrideCheckOf([b], []).status).toBe('blocked');
  });
});

describe('validateShiftOverrideRequest', () => {
  it('accepts each override type', () => {
    const ok = [
      { type: 'emergency_off', shiftId: 'a', replacementStaffId: null, offReason: 'sickCall' },
      { type: 'emergency_off', shiftId: 'a', replacementStaffId: 'b', offReason: 'family', reason: 'Only cover available' },
      { type: 'reassign', shiftId: 'a', toStaffId: 'b' },
      { type: 'time_change', shiftId: 'a', date: '2026-12-19', startMin: 540, endMin: 1080, activities: [{ kind: 'meal', startMin: 720, endMin: 780 }] },
      { type: 'add', staffId: null, departmentId: 'd', date: '2026-12-19', startMin: 1200, endMin: 1500 },
      { type: 'remove', shiftId: 'a' },
    ];
    for (const body of ok) expect(validateShiftOverrideRequest(body)).toMatchObject({ ok: true });
  });

  it('rejects bad shapes with field paths', () => {
    const cases: [unknown, string][] = [
      [null, ''],
      [{ type: 'swap' }, 'type'],
      [{ type: 'remove' }, 'shiftId'],
      [{ type: 'remove', shiftId: 'a', extra: 1 }, 'extra'],
      [{ type: 'reassign', shiftId: 'a', toStaffId: '' }, 'toStaffId'],
      [{ type: 'emergency_off', shiftId: 'a', offReason: 'sickCall' }, 'replacementStaffId'],
      [{ type: 'emergency_off', shiftId: 'a', replacementStaffId: null, offReason: 'bored' }, 'offReason'],
      [{ type: 'time_change', shiftId: 'a', date: '2026-02-30', startMin: 540, endMin: 600 }, 'date'],
      [{ type: 'time_change', shiftId: 'a', date: '2026-12-19', startMin: 600, endMin: 600 }, 'endMin'],
      [{ type: 'time_change', shiftId: 'a', date: '2026-12-19', startMin: 600, endMin: 900, activities: [{ kind: 'meal', startMin: 500, endMin: 560 }] }, 'activities.0'],
      [{ type: 'remove', shiftId: 'a', reason: 'x'.repeat(501) }, 'reason'],
    ];
    for (const [body, path] of cases) {
      const r = validateShiftOverrideRequest(body);
      expect(r.ok, JSON.stringify(body)).toBe(false);
      if (!r.ok) expect(r.issues.map((i) => i.path)).toContain(path);
    }
  });
});

describe('rankReplacements', () => {
  const c = (id: string, status: 'ok' | 'needsReason' | 'blocked', sameDepartment: boolean, weekHours: number): ReplacementCandidate => ({
    staffId: id,
    employeeNo: id,
    name: id,
    contract: 'FT',
    sameDepartment,
    weekHours,
    check: { status, breaches: [], blocking: [] },
  });
  it('puts saveable, same-department, least-loaded cashiers first', () => {
    const ranked = rankReplacements([c('a', 'blocked', true, 0), c('b', 'needsReason', true, 0), c('c', 'ok', false, 8), c('d', 'ok', true, 40), c('e', 'ok', true, 16)]);
    expect(ranked.map((r) => r.staffId)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });
});

describe('local store time', () => {
  it('round-trips a local date and minute through UTC (Asia/Manila)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 0, max: 24 * 60 - 1 }), (dayOffset, minutes) => {
        const date = new Date(Date.UTC(2025, 0, 1) + dayOffset * 86_400_000).toISOString().slice(0, 10);
        expect(instantToLocal(localToInstant(date, minutes))).toEqual({ date, minutes });
      }),
    );
    expect(localToInstant('2026-12-19', 9 * 60)).toBe('2026-12-19T01:00:00.000Z');
  });

  it('counts overnight end minutes from the start date', () => {
    expect(shiftLocalTimes(localToInstant('2026-12-19', 20 * 60), localToInstant('2026-12-20', 60))).toEqual({
      date: '2026-12-19',
      startMin: 1200,
      endMin: 1500,
    });
  });
});
