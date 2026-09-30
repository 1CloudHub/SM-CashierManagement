/**
 * End-to-end department-day and network-day planning (DOM-001 pipeline):
 * forecast → Erlang C lanes → shrinkage → shifts → cost.
 *
 * The network view is built from exactly the same department-day function, so
 * a department's figures are identical whether requested alone or as part of
 * the all-stores view (DOM-001 consistency invariant). Departments are
 * rostered independently and a store's hourly need is the sum of its
 * departments' needs in the same hour (v3 limitation, preserved).
 */
import { dateRange, dayTypeOf } from './calendar.js';
import { costShifts, type CostBreakdown } from './cost.js';
import { forecastDepartmentDay, type DepartmentForecastModel } from './forecast.js';
import { sizeLanes, type HourlyLanePlan } from './lanes.js';
import type { RuleSet, ScenarioSettings } from './rules.js';
import { buildShifts, mergeShiftSummaries, summarizeShifts, type ShiftSummary } from './shifts.js';
import type { DayType, Department, Hour, IsoDate, Provenance, Shift, Store } from './types.js';

export interface PlanningContext {
  readonly stores: readonly Store[];
  readonly departments: readonly Department[];
  readonly models: ReadonlyMap<string, DepartmentForecastModel>;
  readonly rules: RuleSet;
  readonly settings: ScenarioSettings;
  readonly snapshotId: string;
}

export interface DepartmentDayPlan {
  readonly departmentId: string;
  readonly storeId: string;
  readonly date: IsoDate;
  readonly dayType: DayType;
  readonly forecastTransactions: number;
  readonly hours: readonly HourlyLanePlan[];
  readonly peak: { readonly hour: Hour; readonly lanesOpen: number };
  readonly overCapacityHours: readonly Hour[];
  readonly shifts: readonly Shift[];
  readonly shiftSummary: ShiftSummary;
  readonly cost: CostBreakdown;
  readonly provenance: Provenance;
}

export interface StoreDayPlan {
  readonly storeId: string;
  /** Sum of department lanes open per hour. */
  readonly lanesByHour: ReadonlyMap<Hour, number>;
  readonly peak: { readonly hour: Hour; readonly lanesOpen: number };
  readonly shiftSummary: ShiftSummary;
  readonly cost: number;
}

export interface NetworkDayPlan {
  readonly date: IsoDate;
  readonly departments: readonly DepartmentDayPlan[];
  readonly stores: readonly StoreDayPlan[];
  readonly lanesByHour: ReadonlyMap<Hour, number>;
  readonly peak: { readonly hour: Hour; readonly lanesOpen: number };
  readonly shiftSummary: ShiftSummary;
  readonly cost: number;
  readonly provenance: Provenance;
}

export function provenanceOf(ctx: PlanningContext): Provenance {
  const r = ctx.rules;
  return {
    rulesVersionId: r.id,
    ruleVersionIds: {
      staffing: r.staffing.id,
      labor: r.labor.id,
      wage: r.wage.id,
      premium: r.premium.id,
      hiring: r.hiring.id,
    },
    snapshotId: ctx.snapshotId,
  };
}

function peakOf(byHour: ReadonlyMap<Hour, number>): { hour: Hour; lanesOpen: number } {
  let hour = -1;
  let lanes = -1;
  for (const [h, v] of [...byHour.entries()].sort(([a], [b]) => a - b)) {
    if (v > lanes) {
      lanes = v;
      hour = h;
    }
  }
  return { hour, lanesOpen: Math.max(0, lanes) };
}

function sumByHour(plans: readonly { hours: readonly HourlyLanePlan[] }[]): Map<Hour, number> {
  const out = new Map<Hour, number>();
  for (const p of plans) for (const h of p.hours) out.set(h.hour, (out.get(h.hour) ?? 0) + h.lanesOpen);
  return out;
}

/** Plan one department for one date. */
export function planDepartmentDay(ctx: PlanningContext, departmentId: string, date: IsoDate): DepartmentDayPlan {
  const department = ctx.departments.find((d) => d.id === departmentId);
  if (!department) throw new Error(`Unknown department ${departmentId}`);
  const store = ctx.stores.find((s) => s.id === department.storeId);
  if (!store) throw new Error(`Unknown store ${department.storeId}`);
  const model = ctx.models.get(departmentId);
  if (!model) throw new Error(`No forecast model for ${departmentId}`);

  const forecast = forecastDepartmentDay(model, department, date, ctx.settings.growth);
  const hours = sizeLanes(forecast.hours, department, ctx.rules.staffing);
  const shifts = buildShifts({
    departmentId,
    date,
    requirement: hours.map((h) => ({ hour: h.hour, cashiersRequired: h.cashiersRequired })),
    rules: ctx.rules.staffing.shifts,
    allowPartTime: ctx.settings.allowPartTime,
  });
  const cost = costShifts(shifts, () => store.region, ctx.rules);
  return {
    departmentId,
    storeId: store.id,
    date,
    dayType: dayTypeOf(date),
    forecastTransactions: forecast.dailyTransactions,
    hours,
    peak: peakOf(new Map(hours.map((h) => [h.hour, h.lanesOpen]))),
    overCapacityHours: hours.filter((h) => h.overCapacity).map((h) => h.hour),
    shifts,
    shiftSummary: summarizeShifts(shifts),
    cost,
    provenance: provenanceOf(ctx),
  };
}

export interface SeasonPlan {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly departmentDays: readonly DepartmentDayPlan[];
  readonly paidHours: number;
  readonly cost: number;
  readonly provenance: Provenance;
}

/** Plan every department for every date in [from, to] (input to team sizing and the hiring plan). */
export function planSeason(ctx: PlanningContext, from: IsoDate, to: IsoDate): SeasonPlan {
  const departmentDays: DepartmentDayPlan[] = [];
  for (const date of dateRange(from, to)) {
    for (const d of ctx.departments) departmentDays.push(planDepartmentDay(ctx, d.id, date));
  }
  return {
    from,
    to,
    departmentDays,
    paidHours: departmentDays.reduce((s, p) => s + p.shiftSummary.paidHours, 0),
    cost: departmentDays.reduce((s, p) => s + p.cost.total, 0),
    provenance: provenanceOf(ctx),
  };
}

/** Plan every in-context store and department for one date (the all-stores view). */
export function planNetworkDay(ctx: PlanningContext, date: IsoDate): NetworkDayPlan {
  const departments = ctx.departments.map((d) => planDepartmentDay(ctx, d.id, date));
  const stores: StoreDayPlan[] = ctx.stores.map((s) => {
    const own = departments.filter((p) => p.storeId === s.id);
    const lanesByHour = sumByHour(own);
    return {
      storeId: s.id,
      lanesByHour,
      peak: peakOf(lanesByHour),
      shiftSummary: mergeShiftSummaries(own.map((p) => p.shiftSummary)),
      cost: own.reduce((acc, p) => acc + p.cost.total, 0),
    };
  });
  const lanesByHour = sumByHour(departments);
  return {
    date,
    departments,
    stores,
    lanesByHour,
    peak: peakOf(lanesByHour),
    shiftSummary: mergeShiftSummaries(departments.map((p) => p.shiftSummary)),
    cost: departments.reduce((acc, p) => acc + p.cost.total, 0),
    provenance: provenanceOf(ctx),
  };
}
