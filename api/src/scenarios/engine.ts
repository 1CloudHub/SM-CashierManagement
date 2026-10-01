/**
 * Runs the domain engine (`@lanewise/domain`) for a scenario (task 11.1;
 * Req 4.3, 8.1; P6, P18).
 *
 * Inputs are exactly the scenario's pins: the POS snapshot drives the
 * forecast models and each pinned rule version replaces the matching engine
 * rule (service levels → staffing, labor, wages, premiums, lead times →
 * hiring). The result records the ids it used.
 *
 * Seeded demo snapshots (synthetic, `demo://` or no storage key) are
 * regenerated from the deterministic demo generator, so the run needs no S3
 * read and finishes well inside the API timeout (~0.7 s for the demo network
 * season). Runs on uploaded (real) data need the background job worker
 * (task 14) and are refused here with a clear reason.
 */
import {
  DEMO_RULE_SET,
  demo,
  planNetworkDay,
  planSeason,
  sizeTeams,
  type HiringRuleVersion,
  type LaborRuleVersion,
  type PlanningContext,
  type PremiumRuleVersion,
  type RuleSet,
  type StaffingRuleVersion,
  type WageRuleVersion,
} from '@lanewise/domain';
import type { ScenarioSettingsValues } from '@lanewise/shared';

export interface PinnedSnapshot {
  readonly datasetType: string;
  readonly snapshotId: string;
  readonly synthetic: boolean;
  readonly storageKey: string | null;
}

export interface PinnedRuleVersion {
  readonly ruleVersionId: string;
  readonly ruleSetType: string;
  readonly effectiveFrom: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** DB store row for a domain store id (region for cost visibility and scope). */
export interface StoreLookup {
  readonly id: string;
  readonly name: string;
  readonly regionId: string;
}

/** Stored per-store results; cost figures are raw ₱ here and tagged on the way out. */
export interface StoredStoreResult {
  readonly storeId: string;
  readonly storeName: string;
  readonly regionId: string;
  readonly headcount: number;
  readonly headcountByType: Readonly<Record<'FT' | 'PT' | 'FLOAT', number>>;
  readonly paidHours: number;
  readonly cost: number;
  readonly peakLanes: number;
  /** Lanes open per clock hour (0–23) on the peak day, to rebuild an in-scope network peak. */
  readonly peakDayLanes: readonly number[];
}

export interface StoredRunResults {
  readonly from: string;
  readonly to: string;
  readonly peakDay: string;
  readonly stores: readonly StoredStoreResult[];
  /** The rule versions the engine applied, by engine rule (P6). */
  readonly appliedRuleVersions: Readonly<Record<string, string>>;
  readonly snapshotId: string;
}

export class EngineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineInputError';
  }
}

/** Builds the engine rule set from pinned versions; unpinned rules keep the documented demo defaults. */
export function ruleSetFromPins(pins: readonly PinnedRuleVersion[]): RuleSet {
  const of = <T>(type: string, base: T & { id: string; effectiveFrom: string }): T => {
    const pin = pins.find((p) => p.ruleSetType === type);
    return pin ? ({ ...base, ...pin.payload, id: pin.ruleVersionId, effectiveFrom: pin.effectiveFrom } as T) : base;
  };
  const staffing = of<StaffingRuleVersion>('service_levels', DEMO_RULE_SET.staffing);
  const labor = of<LaborRuleVersion>('labor', DEMO_RULE_SET.labor);
  const wage = of<WageRuleVersion>('wages', DEMO_RULE_SET.wage);
  const premium = of<PremiumRuleVersion>('premiums', DEMO_RULE_SET.premium);
  const hiring = of<HiringRuleVersion>('lead_times', DEMO_RULE_SET.hiring);
  return {
    id: [staffing.id, labor.id, wage.id, premium.id, hiring.id].join('+'),
    staffing,
    labor,
    wage,
    premium,
    hiring,
  };
}

let demoSnapshotCache: demo.DemoSnapshot | null = null;

function contextFor(snapshot: PinnedSnapshot, rules: RuleSet, settings: ScenarioSettingsValues): PlanningContext {
  const isDemo = snapshot.synthetic && (snapshot.storageKey === null || snapshot.storageKey.startsWith('demo://'));
  if (!isDemo) {
    throw new EngineInputError('Runs on uploaded data are processed by the background job worker, which is not enabled yet.');
  }
  demoSnapshotCache ??= demo.createDemoSnapshot();
  const ctx = demo.createDemoContext({
    snapshot: demoSnapshotCache,
    rules,
    settings: { growth: settings.growth, allowPartTime: settings.allowPartTime },
  });
  return { ...ctx, snapshotId: snapshot.snapshotId };
}

/**
 * Plans the season and the peak day and summarises by store. `storeFor`
 * maps a domain store id to its DB row (null when the store is not loaded).
 */
export function runScenarioEngine(input: {
  readonly settings: ScenarioSettingsValues;
  readonly snapshots: readonly PinnedSnapshot[];
  readonly ruleVersions: readonly PinnedRuleVersion[];
  readonly storeFor: (domainStoreId: string) => StoreLookup | null;
}): StoredRunResults {
  const pos = input.snapshots.find((s) => s.datasetType === 'pos');
  if (!pos) throw new EngineInputError('The scenario has no POS snapshot pinned.');
  const rules = ruleSetFromPins(input.ruleVersions);
  const ctx = contextFor(pos, rules, input.settings);
  const { planningFrom, planningTo, peakDay } = input.settings;

  const season = planSeason(ctx, planningFrom, planningTo);
  const teams = sizeTeams(season.departmentDays, rules.hiring);
  const peak = planNetworkDay(ctx, peakDay);

  const stores: StoredStoreResult[] = ctx.stores.map((store) => {
    const days = season.departmentDays.filter((d) => d.storeId === store.id);
    const peakPlan = peak.stores.find((p) => p.storeId === store.id);
    const lanes = Array.from({ length: 24 }, (_, h) => peakPlan?.lanesByHour.get(h) ?? 0);
    const row = input.storeFor(store.id);
    const own = teams.filter((t) => t.storeId === store.id);
    const headcountByType = { FT: 0, PT: 0, FLOAT: 0 };
    for (const t of own) headcountByType[t.contractType] += t.headcount;
    return {
      storeId: row?.id ?? store.id,
      storeName: row?.name ?? store.name,
      regionId: row?.regionId ?? '',
      headcount: own.reduce((s, t) => s + t.headcount, 0),
      headcountByType,
      paidHours: days.reduce((s, d) => s + d.shiftSummary.paidHours, 0),
      cost: Math.round(days.reduce((s, d) => s + d.cost.total, 0) * 100) / 100,
      peakLanes: peakPlan?.peak.lanesOpen ?? 0,
      peakDayLanes: lanes,
    };
  });

  return {
    from: planningFrom,
    to: planningTo,
    peakDay,
    stores,
    appliedRuleVersions: season.provenance.ruleVersionIds,
    snapshotId: season.provenance.snapshotId,
  };
}
