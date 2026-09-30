import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  averageWaitSec,
  erlangC,
  offeredLoad,
  requiredAgents,
  serviceLevel,
} from '../src/erlang.js';

describe('Erlang C primitives', () => {
  it('offered load A = λ·h (λ per hour, h in seconds)', () => {
    expect(offeredLoad(240, 150)).toBeCloseTo(10, 12);
  });

  it('P(wait) is 1 when the system is unstable (c ≤ A)', () => {
    expect(erlangC(10, 10)).toBe(1);
    expect(erlangC(5, 10)).toBe(1);
  });

  it('P(wait) is 0 when there is no load', () => {
    expect(erlangC(3, 0)).toBe(0);
  });

  it('property: P(wait) and service level are monotone in the number of agents', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.1, max: 80, noNaN: true }), fc.integer({ min: 0, max: 30 }), (a, extra) => {
        const c = Math.floor(a) + 1 + extra;
        const pw1 = erlangC(c, a);
        const pw2 = erlangC(c + 1, a);
        expect(pw2).toBeLessThanOrEqual(pw1 + 1e-12);
        expect(pw1).toBeGreaterThanOrEqual(0);
        expect(pw1).toBeLessThanOrEqual(1);
        const sl1 = serviceLevel(c, a, 150, 60);
        const sl2 = serviceLevel(c + 1, a, 150, 60);
        expect(sl2).toBeGreaterThanOrEqual(sl1 - 1e-12);
      }),
    );
  });

  it('property: requiredAgents returns the minimum c meeting the target', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 2000, noNaN: true }),
        fc.integer({ min: 30, max: 400 }),
        fc.constantFrom(0.8, 0.85, 0.9, 0.95),
        fc.constantFrom(20, 30, 60, 90),
        (lambda, aht, sl, t) => {
          const c = requiredAgents(lambda, aht, { serviceLevel: sl, thresholdSec: t });
          const a = offeredLoad(lambda, aht);
          if (a <= 0) {
            expect(c).toBe(0);
            return;
          }
          expect(c).toBeGreaterThan(a);
          expect(serviceLevel(c, a, aht, t)).toBeGreaterThanOrEqual(sl);
          if (c - 1 > a) expect(serviceLevel(c - 1, a, aht, t)).toBeLessThan(sl);
        },
      ),
    );
  });
});

/**
 * DOM-001 Fixture A — Erlang C worked example (exact).
 * λ = 240/h, h = 2.5 min (150 s), A = 10 Erlangs.
 */
describe('Parity Fixture A — Erlang C worked example', () => {
  const lambda = 240;
  const aht = 150;
  const a = offeredLoad(lambda, aht);
  const table = [
    { c: 11, util: 0.91, pWait: 0.68, waitSec: 102, within60: 54 },
    { c: 12, util: 0.83, pWait: 0.45, waitSec: 34, within60: 80 },
    { c: 13, util: 0.77, pWait: 0.28, waitSec: 14, within60: 91 },
    { c: 14, util: 0.71, pWait: 0.17, waitSec: 7, within60: 97 },
    { c: 15, util: 0.67, pWait: 0.1, waitSec: 3, within60: 99 },
  ] as const;

  it('offered load is 10 Erlangs and 11 is the stability floor', () => {
    expect(a).toBeCloseTo(10, 12);
    expect(erlangC(10, a)).toBe(1);
    expect(erlangC(11, a)).toBeLessThan(1);
  });

  it.each(table)('c=$c matches the report row (util/P(wait) to 2 dp, wait ±10%, % served)', (row) => {
    expect(Math.abs(a / row.c - row.util)).toBeLessThanOrEqual(0.005 + 1e-9);
    // The report truncates P(wait) to 2 dp (0.2853 is printed 0.28): allow one
    // rounding unit either way.
    expect(Math.abs(erlangC(row.c, a) - row.pWait)).toBeLessThan(0.01);
    const wait = averageWaitSec(row.c, a, aht);
    expect(Math.abs(wait - row.waitSec) / row.waitSec).toBeLessThanOrEqual(0.1);
    // % served is printed as a whole percent; c=14 computes 96.5% (printed 97).
    expect(Math.abs(serviceLevel(row.c, a, aht, 60) * 100 - row.within60)).toBeLessThanOrEqual(1);
  });

  it('returns exactly 13 cashiers for a 90%-within-60 s target', () => {
    expect(requiredAgents(lambda, aht, { serviceLevel: 0.9, thresholdSec: 60 })).toBe(13);
  });
});
