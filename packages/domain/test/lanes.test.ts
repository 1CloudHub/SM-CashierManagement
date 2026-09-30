import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { requiredAgents } from '../src/erlang.js';
import { applyShrinkage, safeCeil, sizeLanes } from '../src/lanes.js';
import { DEMO_STAFFING_RULES } from '../src/rules.js';
import type { Department } from '../src/types.js';

const dept: Department = {
  id: 's1:main',
  storeId: 's1',
  name: 'Main lanes',
  installedLanes: 12,
  minLanes: 2,
  tradingHours: { default: { open: 8, close: 22 } },
};

describe('lane sizing and shrinkage (DOM-001)', () => {
  it('shrinkage uses a float-safe ceiling', () => {
    expect(safeCeil(10 * 1.3)).toBe(13);
    expect(applyShrinkage(13, 0.25)).toBe(17); // Fixture A: 13 lanes → ~16–18 rostered
    expect(applyShrinkage(13, 0.4)).toBe(19);
    expect(applyShrinkage(0, 0.3)).toBe(0);
  });

  it('applies the minimum-lane floor, caps at installed lanes and flags over-capacity', () => {
    const plan = sizeLanes(
      [
        { hour: 8, lambda: 0, ahtSec: 150 },
        { hour: 12, lambda: 240, ahtSec: 150 },
        { hour: 13, lambda: 600, ahtSec: 150 },
      ],
      dept,
      DEMO_STAFFING_RULES,
    );
    expect(plan.map((h) => h.lanesNeeded)).toEqual([2, 13, requiredAgents(600, 150, DEMO_STAFFING_RULES.serviceTarget)]);
    expect(plan.map((h) => h.lanesOpen)).toEqual([2, 12, 12]);
    expect(plan.map((h) => h.overCapacity)).toEqual([false, true, true]);
    expect(plan[1]?.cashiersRequired).toBe(applyShrinkage(12, DEMO_STAFFING_RULES.shrinkage));
  });

  it('property: rostered cashiers ≥ open lanes ≥ floor, and open lanes ≤ installed', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 900, noNaN: true }), { minLength: 1, maxLength: 16 }), (lambdas) => {
        const plan = sizeLanes(
          lambdas.map((lambda, i) => ({ hour: 8 + i, lambda, ahtSec: 140 })),
          dept,
          DEMO_STAFFING_RULES,
        );
        for (const h of plan) {
          expect(h.lanesNeeded).toBeGreaterThanOrEqual(dept.minLanes);
          expect(h.lanesOpen).toBeLessThanOrEqual(dept.installedLanes);
          expect(h.cashiersRequired).toBeGreaterThanOrEqual(h.lanesOpen);
          expect(h.overCapacity).toBe(h.lanesNeeded > dept.installedLanes);
        }
      }),
    );
  });
});
