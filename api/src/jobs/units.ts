/**
 * Work units of the background planning jobs (task 14.2; Req 10.1, 10.2; P2).
 *
 * A job is split into one unit per department so it can report progress
 * ("14 of 24 departments"), checkpoint each finished unit and resume after a
 * redelivery. Units are pure functions of the engine context, so a unit
 * computed twice gives the same result (idempotent).
 *
 * Hiring: the engine's wave phasing (`buildHiringPlan`) is keyed by
 * department and contract type, so planning each department on its own and
 * merging the waves by id gives exactly the network plan (P2 parity with the
 * v3 hiring plan).
 */
import {
  CONTRACT_TYPES,
  assignRoster,
  buildHiringPlan,
  dateRange,
  planDepartmentDay,
  weekStart,
  weeklyRequirements,
  type ContractType,
  type HiringWave,
  type Milestone,
  type PlanningContext,
  type StaffMember,
} from '@lanewise/domain';
import type { OrgDepartment } from '../planning/basis.js';

type ByType = Record<ContractType, number>;
const zero = (): ByType => ({ FT: 0, PT: 0, FLOAT: 0 });

export interface StoredWave {
  readonly id: string;
  readonly contractType: ContractType;
  readonly needBy: string;
  readonly recruitStart: string;
  readonly milestones: readonly Milestone[];
  /** Database department ids and counts. */
  readonly lines: readonly { readonly departmentId: string; readonly storeId: string; readonly count: number }[];
}

export interface HiringUnitResult {
  readonly departmentId: string;
  readonly departmentName: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly regionId: string;
  readonly baseline: ByType;
  readonly season: ByType;
  readonly hires: ByType;
  /** Headcount needed per roster week (all contract types). */
  readonly weeklyHeadcount: Readonly<Record<string, number>>;
  readonly shifts: number;
  readonly paidHours: number;
  readonly ftPaidHours: number;
  readonly cost: number;
  readonly waves: readonly StoredWave[];
}

export interface StoredHiringResults {
  readonly kind: 'hiring';
  readonly from: string;
  readonly to: string;
  readonly hiringRuleVersionId: string;
  readonly departments: readonly HiringUnitResult[];
}

/** One department's season: daily plans → team sizes → waves against current staff. */
export function hiringUnit(
  ctx: PlanningContext,
  domainDepartmentId: string,
  dept: OrgDepartment,
  baseline: ByType,
  from: string,
  to: string,
): HiringUnitResult {
  const plans = dateRange(from, to).map((date) => planDepartmentDay(ctx, domainDepartmentId, date));
  const input = plans.map((p) => ({ storeId: p.storeId, departmentId: p.departmentId, date: p.date, shifts: p.shifts }));
  const current = CONTRACT_TYPES.map((t) => ({ departmentId: domainDepartmentId, contractType: t, count: baseline[t] }));
  const plan = buildHiringPlan(input, current, ctx.rules.hiring);
  const season = zero();
  for (const t of plan.teamSizes) season[t.contractType] += t.headcount;
  const hires = zero();
  for (const w of plan.waves) hires[w.contractType] += w.total;
  const weeklyHeadcount: Record<string, number> = {};
  for (const w of weeklyRequirements(input, ctx.rules.hiring)) {
    weeklyHeadcount[w.weekStart] = (weeklyHeadcount[w.weekStart] ?? 0) + w.headcount;
  }
  const shifts = plans.flatMap((p) => p.shifts);
  return {
    departmentId: dept.id,
    departmentName: dept.name,
    storeId: dept.store.id,
    storeName: dept.store.name,
    regionId: dept.store.regionId,
    baseline,
    season,
    hires,
    weeklyHeadcount,
    shifts: shifts.length,
    paidHours: shifts.reduce((s, x) => s + x.paidHours, 0),
    ftPaidHours: shifts.filter((s) => s.type === 'FT').reduce((s, x) => s + x.paidHours, 0),
    cost: Math.round(plans.reduce((s, p) => s + p.cost.total, 0) * 100) / 100,
    waves: plan.waves.map((w: HiringWave) => ({
      id: w.id,
      contractType: w.contractType,
      needBy: w.needBy,
      recruitStart: w.recruitStart,
      milestones: w.milestones,
      lines: w.lines.map((l) => ({ departmentId: dept.id, storeId: dept.store.id, count: l.count })),
    })),
  };
}

/** Network waves: per-department waves merged by id (same contract type and need-by week). */
export function mergeWaves(units: readonly Pick<HiringUnitResult, 'waves'>[]): StoredWave[] {
  const byId = new Map<string, StoredWave>();
  for (const u of units) {
    for (const w of u.waves) {
      const cur = byId.get(w.id);
      byId.set(w.id, cur ? { ...cur, lines: [...cur.lines, ...w.lines] } : w);
    }
  }
  return [...byId.values()].sort((a, b) => (a.needBy < b.needBy ? -1 : a.needBy > b.needBy ? 1 : a.contractType < b.contractType ? -1 : 1));
}

export interface RosterWeek {
  readonly weekStart: string;
  readonly shifts: number;
  readonly assigned: number;
  readonly openShifts: number;
  readonly paidHours: number;
  readonly laborWarnings: number;
  readonly cost: number;
}

export interface RosterUnitResult {
  readonly departmentId: string;
  readonly departmentName: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly regionId: string;
  readonly weeks: readonly RosterWeek[];
}

export interface StoredRosterResults {
  readonly kind: 'roster';
  readonly from: string;
  readonly to: string;
  readonly departments: readonly RosterUnitResult[];
}

/**
 * One department's long roster: shifts built per day, named staff assigned
 * under the PH labor rules (`assignRoster`), summarised per roster week. No
 * names leave the worker (P11: results never expose a cashier).
 */
export function rosterUnit(
  ctx: PlanningContext,
  domainDepartmentId: string,
  dept: OrgDepartment,
  staff: readonly StaffMember[],
  from: string,
  to: string,
): RosterUnitResult {
  const plans = dateRange(from, to).map((date) => planDepartmentDay(ctx, domainDepartmentId, date));
  const roster = assignRoster({ shifts: plans.flatMap((p) => p.shifts), staff, rules: ctx.rules.labor });
  const assigned = new Set(roster.assignments.map((a) => a.id + a.date));
  const weeks = new Map<string, { shifts: number; assigned: number; open: number; hours: number; warnings: number; cost: number }>();
  const week = (date: string) => {
    const key = weekStart(date);
    let w = weeks.get(key);
    if (!w) {
      w = { shifts: 0, assigned: 0, open: 0, hours: 0, warnings: 0, cost: 0 };
      weeks.set(key, w);
    }
    return w;
  };
  for (const p of plans) {
    const w = week(p.date);
    w.cost += p.cost.total;
    for (const s of p.shifts) {
      w.shifts += 1;
      w.hours += s.paidHours;
      if (assigned.has(s.id + s.date)) w.assigned += 1;
      else w.open += 1;
    }
  }
  for (const v of roster.violations) week(v.date).warnings += 1;
  return {
    departmentId: dept.id,
    departmentName: dept.name,
    storeId: dept.store.id,
    storeName: dept.store.name,
    regionId: dept.store.regionId,
    weeks: [...weeks.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([weekStartDate, w]) => ({
        weekStart: weekStartDate,
        shifts: w.shifts,
        assigned: w.assigned,
        openShifts: w.open,
        paidHours: w.hours,
        laborWarnings: w.warnings,
        cost: Math.round(w.cost * 100) / 100,
      })),
  };
}
