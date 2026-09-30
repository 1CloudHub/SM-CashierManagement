/**
 * Lane sizing and shrinkage — DOM-001 "Erlang C lane sizing" and "Shrinkage".
 *
 * Per interval: Erlang C lanes to the service target → minimum-lane floor →
 * cap at installed lanes (flagging over-capacity) → shrinkage uplift to the
 * cashiers that must be rostered.
 */
import { requiredAgents } from './erlang.js';
import type { StaffingRuleVersion } from './rules.js';
import type { Department, Hour, HourlyDemand } from './types.js';

export interface HourlyLanePlan {
  readonly hour: Hour;
  readonly lambda: number;
  readonly ahtSec: number;
  /** Erlang C lanes for the service target (0 with no arrivals). */
  readonly erlangLanes: number;
  /** Lanes needed after the minimum-lane floor (uncapped). */
  readonly lanesNeeded: number;
  /** Lanes that can actually open: min(needed, installed) — "cashiers on lanes". */
  readonly lanesOpen: number;
  /** Need exceeds installed lanes (v3 over-capacity flag). */
  readonly overCapacity: boolean;
  /** Cashiers to roster after shrinkage: ceil(lanesOpen × (1 + shrinkage)). */
  readonly cashiersRequired: number;
}

/** ceil that ignores binary floating-point noise (10 × 1.3 = 13.000000000000002 → 13). */
export function safeCeil(x: number): number {
  return Math.ceil(x - 1e-9);
}

/** Shrinkage uplift: lanes that must be open → cashiers that must be rostered. */
export function applyShrinkage(lanes: number, shrinkage: number): number {
  if (lanes <= 0) return 0;
  return safeCeil(lanes * (1 + shrinkage));
}

export function sizeLanes(
  demand: readonly HourlyDemand[],
  department: Department,
  rules: StaffingRuleVersion,
): HourlyLanePlan[] {
  return demand.map((d) => {
    const erlangLanes = requiredAgents(d.lambda, d.ahtSec, rules.serviceTarget);
    const lanesNeeded = Math.max(department.minLanes, erlangLanes);
    const lanesOpen = Math.min(lanesNeeded, department.installedLanes);
    return {
      hour: d.hour,
      lambda: d.lambda,
      ahtSec: d.ahtSec,
      erlangLanes,
      lanesNeeded,
      lanesOpen,
      overCapacity: lanesNeeded > department.installedLanes,
      cashiersRequired: applyShrinkage(lanesOpen, rules.shrinkage),
    };
  });
}
