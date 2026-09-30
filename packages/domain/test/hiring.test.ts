import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addDays, dateRange, weekStart } from '../src/calendar.js';
import { createDemoContext } from '../src/demo/index.js';
import { buildHiringPlan, sizeTeams, weeklyRequirements, type DepartmentShiftsForDate } from '../src/hiring.js';
import { planSeason, type SeasonPlan } from '../src/pipeline.js';
import { DEMO_HIRING_RULES } from '../src/rules.js';
import type { ContractType, Shift } from '../src/types.js';

const rules = DEMO_HIRING_RULES;

function mk(date: string, type: ContractType, n: number, paid: number): DepartmentShiftsForDate {
  const shifts: Shift[] = Array.from({ length: n }, (_, i) => ({
    id: `${date}-${type}-${i}`,
    departmentId: 's:d',
    date,
    type,
    start: 8,
    end: 8 + paid + (type === 'FT' ? 1 : 0),
    mealHour: type === 'FT' ? 12 : null,
    paidHours: paid,
  }));
  return { storeId: 's', departmentId: 's:d', date, shifts };
}

describe('team sizing (DOM-001)', () => {
  it('sizes by the larger of hours ÷ contract hours and peak daily shifts × 7/6, plus buffer', () => {
    // 7 days × 10 FT shifts × 8 h = 560 h → 560/48 = 11.67; peak daily 10 × 7/6 = 11.67 → ×1.1 → 12.83 → 13.
    const week = dateRange('2026-12-14', '2026-12-20').map((d) => mk(d, 'FT', 10, 8));
    const req = weeklyRequirements(week, rules).find((r) => r.contractType === 'FT');
    expect(req?.headcount).toBe(13);
    expect(req?.paidHours).toBe(560);
    expect(req?.peakDailyShifts).toBe(10);
  });

  it('takes the peak week for the season', () => {
    const quiet = dateRange('2026-11-02', '2026-11-08').map((d) => mk(d, 'PT', 2, 4));
    const busy = dateRange('2026-12-14', '2026-12-20').map((d) => mk(d, 'PT', 6, 4));
    const t = sizeTeams([...quiet, ...busy], rules).find((x) => x.contractType === 'PT');
    expect(t?.peakWeek).toBe('2026-12-14');
    expect(t?.headcount).toBe(Math.ceil(((6 * 7) / 6) * 1.1 - 1e-9));
  });
});

describe('hiring plan and waves (spec Req 10.1)', () => {
  const plans = [
    ...dateRange('2026-11-02', '2026-11-08').map((d) => mk(d, 'FT', 6, 8)),
    ...dateRange('2026-11-30', '2026-12-06').map((d) => mk(d, 'FT', 9, 8)),
    ...dateRange('2026-12-14', '2026-12-20').map((d) => mk(d, 'FT', 12, 8)),
  ];

  it('phases the gap to current staff into lead-time-driven waves with milestones', () => {
    const plan = buildHiringPlan(plans, [{ departmentId: 's:d', contractType: 'FT', count: 5 }], rules);
    const ftSize = plan.teamSizes.find((t) => t.contractType === 'FT')?.headcount ?? 0;
    expect(plan.totalHires).toBe(ftSize - 5);
    expect(plan.waves.map((w) => w.needBy)).toEqual(['2026-11-02', '2026-11-30', '2026-12-14']);
    for (const w of plan.waves) {
      expect(w.recruitStart).toBe(addDays(w.needBy, -rules.leadTimeDays.FT));
      expect(w.milestones.map((m) => m.name)).toEqual(rules.milestones.map((m) => m.name));
      expect(w.milestones[w.milestones.length - 1]?.date).toBe(w.needBy);
      const dates = w.milestones.map((m) => m.date);
      expect([...dates].sort()).toEqual(dates);
    }
    expect(plan.hiresByStoreAndRole).toEqual([{ storeId: 's', contractType: 'FT', hires: plan.totalHires }]);
    expect(plan.hiringRuleVersionId).toBe(rules.id);
  });

  it('hires nobody when current staff already cover the peak', () => {
    const plan = buildHiringPlan(plans, [{ departmentId: 's:d', contractType: 'FT', count: 100 }], rules);
    expect(plan.totalHires).toBe(0);
    expect(plan.waves).toEqual([]);
  });

  it('property: current staff + hires always reach the season requirement, never exceed it', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 8 }), fc.integer({ min: 0, max: 30 }), (weekly, current) => {
        const ps = weekly.flatMap((n, i) => dateRange(addDays('2026-10-05', i * 7), addDays('2026-10-11', i * 7)).map((d) => mk(d, 'FT', n, 8)));
        const plan = buildHiringPlan(ps, [{ departmentId: 's:d', contractType: 'FT', count: current }], rules);
        const need = plan.teamSizes.find((t) => t.contractType === 'FT')?.headcount ?? 0;
        expect(plan.totalHires).toBe(Math.max(0, need - current));
        for (const w of plan.waves) expect(weekStart(w.needBy)).toBe(w.needBy);
      }),
    );
  });
});

describe('seasonal hiring plan on the seeded demo snapshot', () => {
  let season: SeasonPlan;
  beforeAll(() => {
    season = planSeason(createDemoContext(), '2026-10-01', '2026-12-31');
  });

  it('plans every department-day of the Oct–Dec 2026 season and records provenance (P6)', () => {
    expect(season.departmentDays).toHaveLength(92 * 24);
    expect(season.provenance.snapshotId).toBe('snapshot-demo-v3-2025');
    expect(season.provenance.ruleVersionIds).toMatchObject({ hiring: rules.id });
  });

  it('builds hires by store and role that ramp towards Christmas', () => {
    const plan = buildHiringPlan(season.departmentDays, [], rules);
    expect(plan.totalHires).toBeGreaterThan(0);
    const total = plan.teamSizes.reduce((s, t) => s + t.headcount, 0);
    expect(plan.totalHires).toBe(total);
    const stores = new Set(plan.hiresByStoreAndRole.map((h) => h.storeId));
    expect(stores.size).toBe(8);
    // The network headcount requirement peaks in the Christmas weeks.
    const byWeek = new Map<string, number>();
    for (const w of weeklyRequirements(season.departmentDays, rules)) byWeek.set(w.weekStart, (byWeek.get(w.weekStart) ?? 0) + w.headcount);
    const peak = [...byWeek.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
    expect(peak >= '2026-12-14' && peak <= '2026-12-21').toBe(true);
    // Waves are phased: the first wave starts recruiting before the season opens.
    expect(plan.waves[0]?.recruitStart && plan.waves[0].recruitStart < '2026-10-01').toBe(true);
  });
});
