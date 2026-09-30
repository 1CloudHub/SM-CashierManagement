/**
 * Parity suite — spec task 6.4 (Requirement 4, Properties P2 and P6).
 *
 * Runs the full pipeline on the seeded demo snapshot and asserts the DOM-001
 * parity tolerance (integers exact; cost ±0.5 %; roster on shift set and
 * hours) against fixtures A–C. Fixture A (the Erlang C worked example) lives
 * in erlang.test.ts because it needs no dataset.
 *
 * IMPORTANT — provenance of the snapshot: the prototype v3 seeded dataset is
 * not in the repository. src/demo/ reconstructs it from DOM-001's documented
 * shape (Fixture B) and its volume/shape/lane parameters were calibrated so the
 * pipeline reproduces the Fixture C figures. These tests therefore pin the
 * rebuild to v3's published outputs on a reconstructed snapshot; they will be
 * re-pointed at the original v3 snapshot/calculator output when it is added
 * to docs/references/prototype-v3/.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyShrinkage } from '../src/lanes.js';
import {
  createDemoContext,
  createDemoSnapshot,
  DEMO_DEPARTMENTS,
  DEMO_STORES,
  understaffingByMonth,
  type DemoSnapshot,
} from '../src/demo/index.js';
import { normalWeekdayTransactions, type DepartmentForecastModel } from '../src/forecast.js';
import {
  planDepartmentDay,
  planNetworkDay,
  type DepartmentDayPlan,
  type NetworkDayPlan,
  type PlanningContext,
} from '../src/pipeline.js';
import { DEMO_RULE_SET, type RuleSet } from '../src/rules.js';
import { coverageOf } from '../src/shifts.js';

/** 24 departments × 9 dates, as in the v3 report's consistency check. */
const PARITY_DATES = [
  '2026-10-15', // payday
  '2026-10-31', // payday (Saturday)
  '2026-11-30', // payday + Bonifacio Day
  '2026-12-15', // payday
  '2026-12-19', // Saturday before Christmas (Fixture C)
  '2026-12-20', // Sunday before Christmas
  '2026-12-24', // Christmas Eve
  '2026-12-25', // Christmas Day
  '2026-12-30', // Rizal Day
] as const;

const NORMAL_WEEKDAY = '2026-09-08'; // Tuesday in the base period, not a payday or holiday

let snapshot: DemoSnapshot;
let ctx: PlanningContext;
let ctxFtOnly: PlanningContext;
let dec19: NetworkDayPlan;
let dec19FtOnly: NetworkDayPlan;
let dec24: NetworkDayPlan;

function dept(plan: NetworkDayPlan, id: string): DepartmentDayPlan {
  const d = plan.departments.find((p) => p.departmentId === id);
  if (!d) throw new Error(`missing ${id}`);
  return d;
}
function modelOf(id: string): DepartmentForecastModel {
  const m = ctx.models.get(id);
  if (!m) throw new Error(`missing model ${id}`);
  return m;
}
const maxNeed = (p: DepartmentDayPlan): number => Math.max(...p.hours.map((h) => h.lanesNeeded));
const installed = (id: string): number => DEMO_DEPARTMENTS.find((d) => d.id === id)?.installedLanes ?? -1;

beforeAll(() => {
  snapshot = createDemoSnapshot();
  ctx = createDemoContext({ snapshot });
  ctxFtOnly = createDemoContext({ snapshot, settings: { allowPartTime: false } });
  dec19 = planNetworkDay(ctx, '2026-12-19');
  dec19FtOnly = planNetworkDay(ctxFtOnly, '2026-12-19');
  dec24 = planNetworkDay(ctx, '2026-12-24');
});

describe('Fixture B — demo dataset shape', () => {
  it('has 47,548 hourly rows for 8 stores, 4 formats and 24 departments, Aug 1 – Dec 31 2025', () => {
    const h = snapshot.history;
    expect(h).toHaveLength(47_548);
    expect(new Set(h.map((r) => r.storeId)).size).toBe(8);
    expect(new Set(h.map((r) => r.format))).toEqual(new Set(['Supermarket', 'Hypermarket', 'SM Store', 'SaveMore']));
    expect(new Set(h.map((r) => r.departmentId)).size).toBe(24);
    const dates = h.map((r) => r.date).sort();
    expect(dates[0]).toBe('2025-08-01');
    expect(dates[dates.length - 1]).toBe('2025-12-31');
    expect(DEMO_STORES).toHaveLength(8);
  });

  it('has the 16 documented columns', () => {
    expect(Object.keys(snapshot.history[0] ?? {}).sort()).toEqual(
      [
        'storeId', 'format', 'region', 'departmentId', 'date', 'dayOfWeek', 'dayType', 'payday', 'dayNote', 'hour',
        'transactions', 'items', 'sales', 'avgHandleTimeSec', 'lanesOpen', 'lanesInstalled',
      ].sort(),
    );
  });

  it('carries the built-in understaffing pattern (~19 % of hours short in August → ~59 % in December)', () => {
    const u = understaffingByMonth(snapshot.history);
    expect(Math.abs((u.get(8) ?? 0) - 0.19)).toBeLessThanOrEqual(0.02);
    expect(Math.abs((u.get(12) ?? 0) - 0.59)).toBeLessThanOrEqual(0.02);
    const months = [8, 9, 10, 11, 12].map((m) => u.get(m) ?? 0);
    expect(months[4]).toBeGreaterThan(months[0] ?? 1);
  });

  it('is deterministic: the same seed gives identical data, another seed does not (Req 19.6)', () => {
    const again = createDemoSnapshot();
    expect(again.history).toEqual(snapshot.history);
    const other = createDemoSnapshot(7);
    expect(other.history).toHaveLength(snapshot.history.length);
    expect(other.history.map((r) => r.transactions)).not.toEqual(snapshot.history.map((r) => r.transactions));
    expect(other.snapshotId).not.toBe(snapshot.snapshotId);
  });
});

describe('Fixture C — scenario outputs (integers exact; cost ±0.5 %)', () => {
  it('SM Supermarket – Quezon City, main lanes, Sat Dec 19 2026: 3,863 transactions (2.25× a normal weekday), 19 cashiers at the 1 PM peak (vs 12)', () => {
    const qc = dept(dec19, 'smsm-qc:main');
    expect(Math.round(qc.forecastTransactions)).toBe(3_863);
    const normal = normalWeekdayTransactions(modelOf('smsm-qc:main'), ctx.settings.growth);
    expect(Math.round((qc.forecastTransactions / normal) * 100) / 100).toBe(2.25);
    expect(qc.peak).toEqual({ hour: 13, lanesOpen: 19 });
    expect(planDepartmentDay(ctx, 'smsm-qc:main', NORMAL_WEEKDAY).peak.lanesOpen).toBe(12);
  });

  it('SM Store – Manila, Kids & toys, Sun Dec 20 2026: 3.9× a normal weekday', () => {
    const toys = planDepartmentDay(ctx, 'sms-mnl:kids-toys', '2026-12-20');
    const normal = normalWeekdayTransactions(modelOf('sms-mnl:kids-toys'), ctx.settings.growth);
    expect(Math.round((toys.forecastTransactions / normal) * 10) / 10).toBe(3.9);
  });

  it('Network, Dec 19 2026: 254 cashiers on lanes at the 5 PM peak', () => {
    expect(dec19.peak).toEqual({ hour: 17, lanesOpen: 254 });
  });

  it('Network, Dec 19 2026: roster calls for 555 cashiers (314 FT · 188 PT · 53 float) and 3,688 paid hours', () => {
    const s = dec19.shiftSummary;
    expect(s.count).toBe(555);
    expect(s.byType.FT.count).toBe(314);
    expect(s.byType.PT.count).toBe(188);
    expect(s.byType.FLOAT.count).toBe(53);
    expect(s.paidHours).toBe(3_688);
  });

  it('Network, Dec 19 2026: cost ≈ ₱322,000 (±0.5 %)', () => {
    expect(Math.abs(dec19.cost - 322_000) / 322_000).toBeLessThanOrEqual(0.005);
  });

  it('SM Hypermarket – Pampanga, Dec 19 2026: busiest single store, 46 cashiers at noon', () => {
    const pam = dec19.stores.find((s) => s.storeId === 'smhm-pam');
    expect(pam?.peak).toEqual({ hour: 12, lanesOpen: 46 });
    for (const s of dec19.stores.filter((x) => x.storeId !== 'smhm-pam')) expect(s.peak.lanesOpen).toBeLessThan(46);
  });

  it('Christmas Eve over-capacity: Pampanga main needs all 44 installed; Cebu City main 26 vs 24; SaveMore Iloilo main 13 vs 12', () => {
    const pam = dept(dec24, 'smhm-pam:main');
    expect(maxNeed(pam)).toBe(44);
    expect(installed('smhm-pam:main')).toBe(44);
    expect(pam.overCapacityHours).toEqual([]);
    const ceb = dept(dec24, 'smsm-ceb:main');
    expect([maxNeed(ceb), installed('smsm-ceb:main')]).toEqual([26, 24]);
    expect(ceb.overCapacityHours.length).toBeGreaterThan(0);
    const ilo = dept(dec24, 'svm-ilo:main');
    expect([maxNeed(ilo), installed('svm-ilo:main')]).toEqual([13, 12]);
    expect(ilo.overCapacityHours.length).toBeGreaterThan(0);
    const flagged = dec24.departments.filter((d) => d.overCapacityHours.length > 0).map((d) => d.departmentId).sort();
    expect(flagged).toEqual(['smsm-ceb:main', 'svm-ilo:main']);
  });

  it('Part-time saving: network Dec 19 3,688 vs 3,880 FT-only (~5 %); QC main Dec 19 296 vs 304 (~3 %); QC main Dec 20 304 either way', () => {
    expect(dec19FtOnly.shiftSummary.paidHours).toBe(3_880);
    expect(dec19FtOnly.shiftSummary.byType.PT.count).toBe(0);
    expect(dept(dec19, 'smsm-qc:main').shiftSummary.paidHours).toBe(296);
    expect(dept(dec19FtOnly, 'smsm-qc:main').shiftSummary.paidHours).toBe(304);
    expect(planDepartmentDay(ctx, 'smsm-qc:main', '2026-12-20').shiftSummary.paidHours).toBe(304);
    expect(planDepartmentDay(ctxFtOnly, 'smsm-qc:main', '2026-12-20').shiftSummary.paidHours).toBe(304);
  });
});

describe('Invariants across 24 departments × 9 dates', () => {
  it('consistency (P2): the single-department view equals the all-stores view for every store/department/date', () => {
    for (const date of PARITY_DATES) {
      const network = planNetworkDay(ctx, date);
      expect(network.departments).toHaveLength(24);
      for (const d of DEMO_DEPARTMENTS) {
        expect(planDepartmentDay(ctx, d.id, date)).toEqual(dept(network, d.id));
      }
      // Store and network totals are the sum of their departments (v3: store peak = sum of needs in the same hour).
      for (const s of network.stores) {
        const own = network.departments.filter((p) => p.storeId === s.storeId);
        for (const [hour, lanes] of s.lanesByHour) {
          expect(lanes).toBe(own.reduce((acc, p) => acc + (p.hours.find((h) => h.hour === hour)?.lanesOpen ?? 0), 0));
        }
      }
      expect(network.shiftSummary.paidHours).toBe(network.departments.reduce((a, p) => a + p.shiftSummary.paidHours, 0));
    }
  });

  it('roster invariant: no hour left short and every FT meal inside its allowed window', () => {
    const w = DEMO_RULE_SET.staffing.shifts.mealWindow;
    for (const date of PARITY_DATES) {
      for (const p of planNetworkDay(ctx, date).departments) {
        const cover = coverageOf(p.shifts, p.hours.map((h) => h.hour));
        p.hours.forEach((h, i) => {
          expect(cover[i]).toBeGreaterThanOrEqual(h.cashiersRequired);
          expect(h.cashiersRequired).toBe(applyShrinkage(h.lanesOpen, DEMO_RULE_SET.staffing.shrinkage));
        });
        for (const s of p.shifts.filter((x) => x.type === 'FT')) {
          expect(s.mealHour).not.toBeNull();
          expect((s.mealHour ?? -1) - s.start).toBeGreaterThanOrEqual(w.earliestOffset);
          expect((s.mealHour ?? 99) - s.start).toBeLessThanOrEqual(w.latestOffset);
        }
      }
    }
  });

  it('rule versioning (P6): results record rules version and snapshot; a new rule version never changes existing results', () => {
    const before = planDepartmentDay(ctx, 'smsm-qc:main', '2026-12-19');
    const frozen = JSON.stringify(before);
    expect(before.provenance).toEqual({
      rulesVersionId: DEMO_RULE_SET.id,
      ruleVersionIds: {
        staffing: DEMO_RULE_SET.staffing.id,
        labor: DEMO_RULE_SET.labor.id,
        wage: DEMO_RULE_SET.wage.id,
        premium: DEMO_RULE_SET.premium.id,
        hiring: DEMO_RULE_SET.hiring.id,
      },
      snapshotId: snapshot.snapshotId,
    });
    expect(before.cost.wageRuleVersionId).toBe(DEMO_RULE_SET.wage.id);

    const published: RuleSet = {
      ...DEMO_RULE_SET,
      id: 'ruleset-demo-2026.2',
      wage: { ...DEMO_RULE_SET.wage, id: 'wage-demo-2026.2', employerLoading: 0.2 },
    };
    const after = planDepartmentDay({ ...ctx, rules: published }, 'smsm-qc:main', '2026-12-19');
    expect(after.provenance.rulesVersionId).toBe('ruleset-demo-2026.2');
    expect(after.cost.total).toBeGreaterThan(before.cost.total);
    expect(JSON.stringify(before)).toBe(frozen);
    expect(JSON.stringify(planDepartmentDay(ctx, 'smsm-qc:main', '2026-12-19'))).toBe(frozen);
  });
});

describe('Golden master (regression lock on the full pipeline output)', () => {
  it('matches the recorded network outputs for the 9 parity dates', () => {
    const summary = PARITY_DATES.map((date) => {
      const n = planNetworkDay(ctx, date);
      return {
        date,
        peak: n.peak,
        shifts: n.shiftSummary,
        cost: Math.round(n.cost * 100) / 100,
        departments: n.departments.map((p) => ({
          id: p.departmentId,
          forecast: Math.round(p.forecastTransactions * 1e4) / 1e4,
          lambda: p.hours.map((h) => `${h.hour}:${h.lambda}`).join(' '),
          lanes: p.hours.map((h) => h.lanesOpen).join(' '),
          cashiers: p.hours.map((h) => h.cashiersRequired).join(' '),
          over: p.overCapacityHours.join(' '),
          shifts: p.shifts.map((s) => `${s.type}@${s.start}-${s.end}${s.mealHour === null ? '' : `/m${s.mealHour}`}`).join(' '),
        })),
      };
    });
    expect(summary).toMatchSnapshot();
  });
});
