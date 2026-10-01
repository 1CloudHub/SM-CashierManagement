/**
 * Network view (SCR-020) and department day plan (SCR-021) bodies (task 14.1;
 * Req 5; P1, P2, P6).
 *
 * Both views derive each department's headline figures with the shared
 * `departmentFigures`, so a department shows the same numbers alone and in
 * the all-stores view (P2). Only in-scope stores are planned into a response
 * and every total is summed from in-scope rows (P1). Every ₱ value is a
 * `costFigure`, resolved per role by the router (task 21).
 */
import { averageWaitSec, dayTypeOf, offeredLoad, serviceLevel, type DepartmentDayPlan } from '@lanewise/domain';
import {
  aggregateNetwork,
  departmentFigures,
  isStoreInScope,
  matchesNetworkFilter,
  type CostDraft,
  type DepartmentDayInput,
  type DepartmentDayView,
  type DepartmentFigures,
  type NetworkFilter,
  type NetworkView,
} from '@lanewise/shared';
import type { Principal } from '../context.js';
import { costFigure } from '../http/cost.js';
import {
  contextForRun,
  departmentDayFor,
  networkDayFor,
  orgLookup,
  provenanceOf,
  type OrgDepartment,
  type OrgLookup,
  type PlanningBasis,
  type RunInputs,
} from './basis.js';

/** Maps an engine department-day onto the shared figures input. */
export function departmentInput(plan: DepartmentDayPlan, dept: OrgDepartment): DepartmentDayInput {
  return {
    departmentId: dept.id,
    departmentName: dept.name,
    storeId: dept.store.id,
    storeName: dept.store.name,
    regionId: dept.store.regionId,
    storeFormat: dept.store.format,
    installedLanes: dept.installedLanes,
    forecastTransactions: plan.forecastTransactions,
    hours: plan.hours.map((h) => ({
      hour: h.hour,
      lanesNeeded: h.lanesNeeded,
      lanesOpen: h.lanesOpen,
      cashiersRequired: h.cashiersRequired,
      overCapacity: h.overCapacity,
    })),
    shifts: plan.shifts.map((s) => ({ type: s.type, paidHours: s.paidHours })),
    cost: plan.cost.total,
  };
}

function storeRef(f: Pick<DepartmentFigures, 'storeId' | 'regionId'>) {
  return { id: f.storeId, regionId: f.regionId };
}

function departmentDraft(f: DepartmentFigures & { cost: number }): CostDraft<DepartmentFigures> {
  return { ...f, cost: costFigure({ level: 'department', store: storeRef(f) }, f.cost) };
}

function inScope(principal: Principal, dept: OrgDepartment): boolean {
  return principal.scope !== null && isStoreInScope(principal.scope, { id: dept.store.id, regionId: dept.store.regionId });
}

export class PlanningInputError extends Error {
  constructor(
    readonly code: 'not_run' | 'outside_window',
    message: string,
  ) {
    super(message);
    this.name = 'PlanningInputError';
  }
}

/** The run to plan from, or a `not_run` refusal. */
export function requireRun(basis: PlanningBasis): RunInputs {
  if (!basis.run) throw new PlanningInputError('not_run', 'Run this scenario to see its network view and department plans.');
  return basis.run;
}

/** Dates are limited to the scenario's planning window. */
export function requireDateInWindow(basis: PlanningBasis, date: string): void {
  const { planningFrom, planningTo } = basis.scenario.settings;
  if (date < planningFrom || date > planningTo) {
    throw new PlanningInputError('outside_window', `Pick a date between ${planningFrom} and ${planningTo}.`);
  }
}

function lookupFor(basis: PlanningBasis, run: RunInputs): OrgLookup {
  return orgLookup(basis.orgRows, contextForRun(run, basis.scenario.settings));
}

/** SCR-020: every in-scope store and department for a date, filtered (Req 5.1). */
export function buildNetworkView(principal: Principal, basis: PlanningBasis, date: string, filter: NetworkFilter): CostDraft<NetworkView> {
  const run = requireRun(basis);
  requireDateInWindow(basis, date);
  const org = lookupFor(basis, run);
  const day = networkDayFor(run, basis.scenario.settings, date);
  const rows = day.departments.flatMap((plan) => {
    const dept = org.departmentFor(plan.departmentId);
    if (!dept || !inScope(principal, dept)) return [];
    const f = departmentFigures(departmentInput(plan, dept));
    return matchesNetworkFilter(f, filter) ? [f] : [];
  });
  const agg = aggregateNetwork(rows);
  return {
    provenance: provenanceOf(basis.scenario, run),
    date,
    dayType: dayTypeOf(date),
    hours: agg.hours,
    kpis: { ...agg.kpis, cost: costFigure({ level: 'network' }, agg.kpis.cost) },
    stores: agg.stores.map((s) => ({
      ...s,
      cost: costFigure({ level: 'store', store: storeRef(s) }, s.cost),
      departments: s.departments.map(departmentDraft),
    })),
  };
}

/** The in-scope department for a database id, or `null` (the route answers 404 either way). */
export function departmentInScope(principal: Principal, basis: PlanningBasis, departmentId: string): { dept: OrgDepartment; domainId: string } | null {
  const run = requireRun(basis);
  const org = lookupFor(basis, run);
  const domainId = org.domainDepartmentId(departmentId);
  const dept = domainId ? org.departmentFor(domainId) : null;
  return dept && domainId && inScope(principal, dept) ? { dept, domainId } : null;
}

/** SCR-021: one department's hour-by-hour plan and suggested shifts (Req 5.2). */
export function buildDepartmentDayView(
  basis: PlanningBasis,
  target: { dept: OrgDepartment; domainId: string },
  date: string,
): CostDraft<DepartmentDayView> {
  const run = requireRun(basis);
  requireDateInWindow(basis, date);
  const ctx = contextForRun(run, basis.scenario.settings);
  const plan = departmentDayFor(run, basis.scenario.settings, target.domainId, date);
  const service = ctx.rules.staffing.serviceTarget;
  const figures = departmentFigures(departmentInput(plan, target.dept));
  const scheduled = (hour: number) => plan.shifts.filter((s) => hour >= s.start && hour < s.end && s.mealHour !== hour).length;
  return {
    provenance: provenanceOf(basis.scenario, run),
    date,
    dayType: plan.dayType,
    serviceTarget: { serviceLevel: service.serviceLevel, thresholdSec: service.thresholdSec },
    shrinkage: ctx.rules.staffing.shrinkage,
    figures: departmentDraft(figures),
    hours: plan.hours.map((h) => {
      const load = offeredLoad(h.lambda, h.ahtSec);
      const lanes = h.lanesOpen;
      return {
        hour: h.hour,
        transactions: h.lambda,
        erlangs: Math.round(load * 100) / 100,
        lanesNeeded: h.lanesNeeded,
        lanesOpen: lanes,
        cashiersRequired: h.cashiersRequired,
        scheduled: scheduled(h.hour),
        utilization: lanes > 0 ? Math.min(1, load / lanes) : 0,
        serviceLevel: lanes > load ? serviceLevel(lanes, load, h.ahtSec, service.thresholdSec) : load === 0 ? 1 : 0,
        avgWaitSec: lanes > load ? averageWaitSec(lanes, load, h.ahtSec) : 0,
        overCapacity: h.overCapacity,
      };
    }),
    shifts: plan.shifts.map((s) => ({ id: s.id, type: s.type, start: s.start, end: s.end, mealHour: s.mealHour, paidHours: s.paidHours })),
  };
}
