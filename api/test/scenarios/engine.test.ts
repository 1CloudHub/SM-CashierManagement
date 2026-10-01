/**
 * Scenario engine overrides (SCR-031 settings): the pinned rule values are
 * the defaults, and each applied override changes the run in the expected
 * direction. Pure (no database): the demo snapshot is regenerated in memory.
 */
import { DEMO_RULE_SET, demo } from '@lanewise/domain';
import { DEFAULT_SCENARIO_SETTINGS, ENGINE_SETTING_DEFAULTS, type ScenarioSettingsValues } from '@lanewise/shared';
import { describe, expect, it } from 'vitest';
import { demoId } from '../../src/db/demo/dataset.js';
import {
  applyRuleOverrides,
  baseHourlyRateFromPins,
  departmentBaselines,
  runScenarioEngine,
  settingDefaultsFromPins,
  type PinnedRuleVersion,
  type StoredRunResults,
} from '../../src/scenarios/engine.js';

const POS = { datasetType: 'pos', snapshotId: 'snap-pos', synthetic: true, storageKey: 'demo://x/pos' };
// One week keeps each run fast; the peak day falls inside it.
const WEEK: ScenarioSettingsValues = {
  ...DEFAULT_SCENARIO_SETTINGS,
  planningFrom: '2026-12-15',
  planningTo: '2026-12-21',
  peakDay: '2026-12-19',
};

function run(settings: Partial<ScenarioSettingsValues>, staff = false): StoredRunResults {
  return runScenarioEngine({
    settings: { ...WEEK, ...settings },
    snapshots: [POS],
    ruleVersions: [],
    storeFor: () => null,
    ...(staff
      ? {
          currentStaff: demo.DEMO_DEPARTMENTS.flatMap((d) => [
            { departmentId: demoId('department', d.id), contractType: 'FT' as const, count: 2 },
          ]),
        }
      : {}),
  });
}

const total = (r: StoredRunResults, k: 'headcount' | 'paidHours' | 'peakLanes') => r.stores.reduce((s, x) => s + x[k], 0);

describe('scenario setting defaults', () => {
  it('derives the defaults from the pinned rule payloads, else the engine defaults', () => {
    expect(settingDefaultsFromPins([])).toEqual(ENGINE_SETTING_DEFAULTS);
    const pins: PinnedRuleVersion[] = [
      {
        ruleVersionId: 'rv-s',
        ruleSetType: 'service_levels',
        effectiveFrom: '2025-01-01',
        payload: {
          ...DEMO_RULE_SET.staffing,
          serviceTarget: { serviceLevel: 0.8, thresholdSec: 120 },
          shrinkage: 0.2,
          shifts: { ...DEMO_RULE_SET.staffing.shifts, ftSpanHours: 8, ptMaxHours: 5, mealWindow: { earliestOffset: 3, latestOffset: 5 } },
        },
      },
      {
        ruleVersionId: 'rv-l',
        ruleSetType: 'labor',
        effectiveFrom: '2025-01-01',
        payload: { ...DEMO_RULE_SET.labor, maxWeeklyHours: { FT: 44, PT: 24, FLOAT: 40 }, minRestBetweenShiftsHours: 12, maxConsecutiveDays: 5 },
      },
      { ruleVersionId: 'rv-w', ruleSetType: 'wages', effectiveFrom: '2025-01-01', payload: { ...DEMO_RULE_SET.wage, defaultHourlyRate: 95 } },
    ];
    expect(settingDefaultsFromPins(pins)).toEqual({
      ...ENGINE_SETTING_DEFAULTS,
      servedWithinPct: 80,
      waitSeconds: 120,
      shrinkage: 1.2,
      ftShiftPattern: '7+1',
      ptShiftHours: 5,
      mealEarliestAfterHours: 3,
      ftMaxHoursPerWeek: 44,
      ptMaxHoursPerWeek: 24,
      minRestHours: 12,
      maxConsecutiveDays: 5,
    });
    expect(baseHourlyRateFromPins(pins)).toBe(95);
    expect(baseHourlyRateFromPins([])).toBe(DEMO_RULE_SET.wage.defaultHourlyRate);
  });

  it('applies overrides onto the rule set', () => {
    const rules = applyRuleOverrides(DEMO_RULE_SET, {
      ...WEEK,
      servedWithinPct: 95,
      waitSeconds: 30,
      shrinkage: 1.2,
      absenceReservePct: 5,
      ftShiftPattern: '7+1',
      ptShiftHours: 5,
      mealEarliestAfterHours: 5,
      ftMaxHoursPerWeek: 44,
      ptMaxHoursPerWeek: 20,
      minRestHours: 12,
      maxConsecutiveDays: 5,
    });
    expect(rules.staffing.serviceTarget).toEqual({ serviceLevel: 0.95, thresholdSec: 30 });
    expect(rules.staffing.shrinkage).toBeCloseTo(1.2 * 1.05 - 1, 10);
    expect(rules.staffing.shifts).toMatchObject({ ftSpanHours: 8, ftMealHours: 1, ptMinHours: 5, ptMaxHours: 5 });
    expect(rules.staffing.shifts.mealWindow).toEqual({ earliestOffset: 5, latestOffset: 6 });
    expect(rules.labor.maxWeeklyHours).toMatchObject({ FT: 44, PT: 20 });
    expect(rules.labor).toMatchObject({ minRestBetweenShiftsHours: 12, maxConsecutiveDays: 5 });
    // No overrides: the pinned rules unchanged.
    expect(applyRuleOverrides(DEMO_RULE_SET, WEEK)).toEqual(DEMO_RULE_SET);
  });

  it('lists the demo departments with DB ids and POS-learned baselines', () => {
    const rows = departmentBaselines(POS, '2026-12-19');
    expect(rows).toHaveLength(demo.DEMO_DEPARTMENTS.length);
    const qc = rows.find((r) => r.departmentId === demoId('department', 'smsm-qc:main'));
    expect(qc).toMatchObject({ storeId: demoId('store', 'smsm-qc'), departmentName: 'Main lanes', storeName: 'SM Supermarket – Quezon City' });
    expect(qc?.baselineTxPerDay).toBeGreaterThan(1500);
    expect(qc?.handleTimeMin).toBeCloseTo(146 / 60, 1);
    expect(qc?.upliftPct).toBeGreaterThan(50); // Dec 18–23 runs well above the base period.
    expect(departmentBaselines({ ...POS, synthetic: false, storageKey: 's3://real' }, '2026-12-19')).toEqual([]);
    expect(departmentBaselines(null, '2026-12-19')).toEqual([]);
  });
});

describe('scenario engine overrides', () => {
  const base = run({});

  it('records hires per store and the earliest need-by date', () => {
    expect(base.stores.every((s) => typeof s.hires === 'number')).toBe(true);
    // Nobody on staff: every head of the season team is a hire.
    expect(base.stores.reduce((s, x) => s + (x.hires ?? 0), 0)).toBe(total(base, 'headcount'));
    const needBy = base.stores.map((s) => s.firstNeededBy ?? null).filter((d): d is string => d !== null);
    expect(needBy.length).toBeGreaterThan(0);
    expect(needBy.every((d) => d >= '2026-12-14' && d <= WEEK.planningTo)).toBe(true);
    const staffed = run({}, true);
    expect(staffed.stores.reduce((s, x) => s + (x.hires ?? 0), 0)).toBeLessThan(base.stores.reduce((s, x) => s + (x.hires ?? 0), 0));
  });

  it('a stricter service target (shorter wait, more served) never reduces headcount or lanes', () => {
    const strict = run({ waitSeconds: 20, servedWithinPct: 95 });
    expect(total(strict, 'headcount')).toBeGreaterThanOrEqual(total(base, 'headcount'));
    expect(total(strict, 'peakLanes')).toBeGreaterThan(total(base, 'peakLanes'));
  });

  it('the FT shift pattern changes paid hours', () => {
    const shorter = run({ ftShiftPattern: '7+1' });
    expect(total(shorter, 'paidHours')).not.toBe(total(base, 'paidHours'));
  });

  it('more shrinkage or an absence reserve adds paid hours', () => {
    expect(total(run({ shrinkage: 1.4 }), 'paidHours')).toBeGreaterThan(total(base, 'paidHours'));
    expect(total(run({ absenceReservePct: 20 }), 'paidHours')).toBeGreaterThan(total(base, 'paidHours'));
  });

  it('min open lanes raises lanes in quiet departments', () => {
    expect(total(run({ minOpenLanes: 4 }), 'paidHours')).toBeGreaterThan(total(base, 'paidHours'));
  });

  it('department overrides change only that department’s store', () => {
    const id = demoId('department', 'smsm-qc:main');
    const busier = run({ departmentOverrides: [{ departmentId: id, baselineTxPerDay: 3000, handleTimeMin: 3, upliftPct: 100 }] });
    const qc = (r: StoredRunResults) => r.stores.find((s) => s.storeId === 'smsm-qc');
    expect(qc(busier)?.paidHours).toBeGreaterThan(qc(base)?.paidHours ?? Infinity);
    const others = (r: StoredRunResults) => r.stores.filter((s) => s.storeId !== 'smsm-qc').map((s) => s.paidHours);
    expect(others(busier)).toEqual(others(base));
    // Lower uplift than learned reduces the work.
    const quieter = run({ departmentOverrides: [{ departmentId: id, baselineTxPerDay: null, handleTimeMin: null, upliftPct: 0 }] });
    expect(qc(quieter)?.paidHours).toBeLessThan(qc(base)?.paidHours ?? 0);
    // Unknown ids (another provenance) are ignored.
    expect(run({ departmentOverrides: [{ departmentId: 'nope', baselineTxPerDay: 1, handleTimeMin: null, upliftPct: null }] }).stores).toEqual(
      base.stores,
    );
  });
});
