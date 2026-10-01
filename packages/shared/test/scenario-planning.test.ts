/**
 * Scenario planning contracts (task 11; Req 8.4–8.6; P5): settings
 * validation, the staleness rule, the submit gate and compare deltas.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENARIO_SETTINGS,
  SCENARIO_SETTING_KEYS,
  SCENARIO_STATUSES,
  compareScenarioResults,
  diffScenarioSettings,
  formatStaleReasons,
  parseStaleReasons,
  readScenarioSettings,
  scenarioStaleness,
  scenarioSubmitBlocker,
  validateScenarioSettings,
  type ScenarioRunResults,
  type ScenarioSettingsValues,
} from '../src/index.js';

const isoTime = fc
  .date({ min: new Date('2026-01-01T00:00:00Z'), max: new Date('2027-12-31T00:00:00Z'), noInvalidDate: true })
  .map((d) => d.toISOString());

const settingsArb: fc.Arbitrary<ScenarioSettingsValues> = fc.record({
  growth: fc.double({ min: 0.5, max: 2, noNaN: true }),
  allowPartTime: fc.boolean(),
  planningFrom: fc.constant('2026-12-01'),
  planningTo: fc.constantFrom('2026-12-24', '2026-12-31'),
  peakDay: fc.constantFrom('2026-12-19', '2026-12-05'),
  notes: fc.string({ maxLength: 40 }),
});

describe('scenario settings', () => {
  it('accepts the defaults and every in-range combination', () => {
    expect(validateScenarioSettings(DEFAULT_SCENARIO_SETTINGS).ok).toBe(true);
    fc.assert(fc.property(settingsArb, (s) => validateScenarioSettings(s).ok));
  });

  it('rejects out-of-range growth, inverted or over-long seasons, a peak day outside the season and unknown keys', () => {
    const bad = (patch: Record<string, unknown>) => validateScenarioSettings({ ...DEFAULT_SCENARIO_SETTINGS, ...patch });
    const paths = (patch: Record<string, unknown>) => {
      const r = bad(patch);
      return r.ok ? [] : r.issues.map((i) => i.path);
    };
    expect(paths({ growth: 3 })).toContain('growth');
    expect(paths({ growth: Number.NaN })).toContain('growth');
    expect(paths({ planningTo: '2026-11-01' })).toContain('planningTo');
    expect(paths({ planningTo: '2027-06-01' })).toContain('planningTo');
    expect(paths({ peakDay: '2027-01-05' })).toContain('peakDay');
    expect(bad({ typo: 1 }).ok).toBe(false);
    expect(validateScenarioSettings(null).ok).toBe(false);
  });

  it('reads stored settings leniently and round-trips valid settings', () => {
    fc.assert(fc.property(settingsArb, (s) => {
      expect(readScenarioSettings({ ...s, serviceTarget: {} })).toEqual(s);
    }));
    expect(readScenarioSettings({ growth: 'x' })).toEqual(DEFAULT_SCENARIO_SETTINGS);
  });

  it('diffs exactly the keys that differ', () => {
    fc.assert(
      fc.property(settingsArb, settingsArb, (a, b) => {
        const changes = diffScenarioSettings(a, b);
        expect(changes.map((c) => c.key)).toEqual(SCENARIO_SETTING_KEYS.filter((k) => a[k] !== b[k]));
        for (const c of changes) expect([c.from, c.to]).toEqual([a[c.key], b[c.key]]);
        expect(diffScenarioSettings(a, a)).toEqual([]);
      }),
    );
  });
});

describe('P5 stale correctness', () => {
  const pinsArb = fc.dictionary(fc.constantFrom('pos', 'master', 'staff'), fc.constantFrom('s1', 's2', 's3'), { minKeys: 1 });
  const currentArb = fc.dictionary(fc.constantFrom('pos', 'master', 'staff'), fc.constantFrom('s1', 's2', 's3'));
  const rulesArb = fc.dictionary(fc.constantFrom('wages', 'labor'), fc.constantFrom('v1', 'v2'));

  it('is stale exactly when a pin is superseded or settings changed after the last run', () => {
    fc.assert(
      fc.property(pinsArb, currentArb, rulesArb, rulesArb, isoTime, fc.option(isoTime, { nil: null }), (ps, cs, pr, cr, changed, run) => {
        const result = scenarioStaleness({
          pinnedSnapshots: ps,
          currentSnapshots: cs,
          pinnedRuleVersions: pr,
          currentRuleVersions: cr,
          settingsChangedAt: changed,
          lastRunAt: run,
        });
        const snapOld = Object.entries(ps).some(([k, v]) => cs[k] !== undefined && cs[k] !== v);
        const rulesOld = Object.entries(pr).some(([k, v]) => cr[k] !== undefined && cr[k] !== v);
        const settingsOld = run !== null && Date.parse(changed) > Date.parse(run);
        expect(result.stale).toBe(snapOld || rulesOld || settingsOld);
        expect(result.reasons.includes('snapshot_superseded')).toBe(snapOld);
        expect(result.reasons.includes('rules_superseded')).toBe(rulesOld);
        expect(result.reasons.includes('settings_changed')).toBe(settingsOld);
        expect(parseStaleReasons(formatStaleReasons(result.reasons))).toEqual(result.reasons);
      }),
    );
  });

  it('never lets a stale, unrun or non-draft scenario be submitted', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SCENARIO_STATUSES), fc.boolean(), fc.boolean(), (status, stale, hasSucceededRun) => {
        const blocker = scenarioSubmitBlocker({ status, stale, hasSucceededRun });
        expect(blocker === null).toBe(status === 'draft' && !stale && hasSucceededRun);
        if (status === 'draft' && stale) expect(blocker).toBe('stale');
      }),
    );
  });
});

describe('compare', () => {
  const storeArb = fc.record({
    storeId: fc.constantFrom('a', 'b', 'c'),
    storeName: fc.constantFrom('Alpha', 'Bravo', 'Charlie'),
    regionId: fc.constant('r'),
    headcount: fc.nat(500),
    paidHours: fc.nat(10_000),
    cost: fc.option(fc.nat(1_000_000), { nil: undefined }),
    peakLanes: fc.nat(60),
  });
  const resultsArb: fc.Arbitrary<ScenarioRunResults> = fc
    .record({
      headcount: fc.nat(1000),
      paidHours: fc.nat(100_000),
      cost: fc.option(fc.nat(10_000_000), { nil: undefined }),
      lanes: fc.nat(300),
      stores: fc.uniqueArray(storeArb, { selector: (s) => s.storeId, maxLength: 3 }),
    })
    .map(({ headcount, paidHours, cost, lanes, stores }) => ({
      from: '2026-12-01',
      to: '2026-12-31',
      headcount,
      headcountByType: { FT: headcount, PT: 0, FLOAT: 0 },
      paidHours,
      ...(cost === undefined ? {} : { cost }),
      peak: { date: '2026-12-19', hour: 17, lanesOpen: lanes },
      stores: stores.map(({ cost: c, ...s }) => (c === undefined ? s : { ...s, cost: c })),
    }));

  it('deltas are b − a, cost only when both sides carry it, every store once', () => {
    fc.assert(
      fc.property(fc.option(resultsArb, { nil: null }), fc.option(resultsArb, { nil: null }), (a, b) => {
        const c = compareScenarioResults(a, b);
        expect(c.headcount.delta).toBe(a && b ? b.headcount - a.headcount : null);
        expect(c.peakLanes.delta).toBe(a && b ? b.peak.lanesOpen - a.peak.lanesOpen : null);
        expect(c.cost !== undefined).toBe(a?.cost !== undefined && b?.cost !== undefined);
        const ids = new Set([...(a?.stores ?? []), ...(b?.stores ?? [])].map((s) => s.storeId));
        expect(c.stores.map((s) => s.storeId).sort()).toEqual([...ids].sort());
        for (const s of c.stores) {
          if (s.headcount.delta !== null) expect(s.headcount.delta).toBe((s.headcount.b ?? 0) - (s.headcount.a ?? 0));
        }
      }),
    );
  });
});
