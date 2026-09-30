/**
 * P5 stale correctness, data side (task 9.2; Req 8.4, 17.4): when a load
 * supersedes a snapshot, exactly the live scenarios pinning that snapshot
 * become stale — no others, each once.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { affectedByLoad, STALE_ELIGIBLE_STATUSES, type ScenarioPin } from '../../src/ingestion/staleness.js';

const STATUSES = ['draft', 'submitted', 'approved', 'published', 'superseded', 'archived'] as const;
const SNAPSHOTS = ['s1', 's2', 's3'];

// Scenarios with one status/stale flag each, pinning one snapshot per dataset type.
const pinsArb: fc.Arbitrary<ScenarioPin[]> = fc
  .uniqueArray(
    fc.record({
      scenarioId: fc.uuid(),
      status: fc.constantFrom(...STATUSES),
      stale: fc.boolean(),
      snapshots: fc.subarray(SNAPSHOTS, { minLength: 1 }),
    }),
    { maxLength: 12, selector: (s) => s.scenarioId },
  )
  .map((scenarios) =>
    scenarios.flatMap((s) => s.snapshots.map((snapshotId) => ({ scenarioId: s.scenarioId, snapshotId, status: s.status, stale: s.stale }))),
  );

describe('affectedByLoad', () => {
  it('is exactly the live scenarios pinning the superseded snapshot', () => {
    fc.assert(
      fc.property(pinsArb, fc.option(fc.constantFrom(...SNAPSHOTS), { nil: null }), (pins, superseded) => {
        const result = affectedByLoad(pins, superseded);
        const ids = result.map((r) => r.scenarioId);
        expect(new Set(ids).size).toBe(ids.length);
        const expected = new Set(
          pins
            .filter((p) => superseded !== null && p.snapshotId === superseded && (STALE_ELIGIBLE_STATUSES as readonly string[]).includes(p.status))
            .map((p) => p.scenarioId),
        );
        expect(new Set(ids)).toEqual(expected);
        for (const r of result) {
          const pin = pins.find((p) => p.scenarioId === r.scenarioId && p.snapshotId === superseded);
          expect(r.alreadyStale).toBe(pin?.stale ?? false);
        }
      }),
    );
  });

  it('a first load (nothing superseded) affects nothing', () => {
    fc.assert(
      fc.property(pinsArb, (pins) => {
        expect(affectedByLoad(pins, null)).toEqual([]);
      }),
    );
  });
});
