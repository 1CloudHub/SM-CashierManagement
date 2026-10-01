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
  CONTRACT_TYPES,
  DEFAULT_SETTINGS,
  DEMO_RULE_SET,
  SEASONAL_PERIODS,
  buildHiringPlan,
  demo,
  learnForecastModels,
  planNetworkDay,
  planSeason,
  seasonalPeriodOf,
  sizeTeams,
  type ContractType,
  type CurrentStaffCount,
  type Department,
  type DepartmentForecastModel,
  type HiringRuleVersion,
  type LaborRuleVersion,
  type PlanningContext,
  type PremiumRuleVersion,
  type RuleSet,
  type StaffingRuleVersion,
  type WageRuleVersion,
} from '@lanewise/domain';
import {
  DEFAULT_SCENARIO_SETTINGS,
  ENGINE_SETTING_DEFAULTS,
  type FtShiftPattern,
  type ScenarioDepartmentBaseline,
  type ScenarioSettingDefaults,
  type ScenarioSettingsValues,
} from '@lanewise/shared';
import { demoId } from '../db/demo/dataset.js';

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
  /** Seasonal hires (season team above current active staff); absent on runs recorded before hires were kept. */
  readonly hires?: number;
  /** Earliest hiring-wave need-by date for this store (null: no hires); absent on older runs. */
  readonly firstNeededBy?: string | null;
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

// ---------------------------------------------------------------------------
// Defaults (what a `null` override falls back to)
// ---------------------------------------------------------------------------

const PATTERN_SPANS: Readonly<Record<FtShiftPattern, { paid: number; meal: number }>> = {
  '8+1': { paid: 8, meal: 1 },
  '7+1': { paid: 7, meal: 1 },
};

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

/**
 * The value each scenario override falls back to: the engine defaults
 * overlaid with what the pinned rule versions carry (`ScenarioDetail.defaults`).
 * Keys no rule carries (min open lanes, PT share, absence reserve, days per
 * week, preferred rest day) keep `ENGINE_SETTING_DEFAULTS`.
 */
export function settingDefaultsFromPins(pins: readonly PinnedRuleVersion[]): ScenarioSettingDefaults {
  const { staffing, labor } = ruleSetFromPins(pins);
  const paid = staffing.shifts.ftSpanHours - staffing.shifts.ftMealHours;
  const pattern = (Object.keys(PATTERN_SPANS) as FtShiftPattern[]).find(
    (p) => PATTERN_SPANS[p].paid === paid && PATTERN_SPANS[p].meal === staffing.shifts.ftMealHours,
  );
  return {
    ...ENGINE_SETTING_DEFAULTS,
    servedWithinPct: round(staffing.serviceTarget.serviceLevel * 100, 2),
    waitSeconds: staffing.serviceTarget.thresholdSec,
    shrinkage: round(1 + staffing.shrinkage, 4),
    ftShiftPattern: pattern ?? ENGINE_SETTING_DEFAULTS.ftShiftPattern,
    ptShiftHours: staffing.shifts.ptMaxHours,
    mealEarliestAfterHours: staffing.shifts.mealWindow.earliestOffset,
    ftMaxHoursPerWeek: labor.maxWeeklyHours.FT,
    ptMaxHoursPerWeek: labor.maxWeeklyHours.PT,
    minRestHours: labor.minRestBetweenShiftsHours,
    maxConsecutiveDays: labor.maxConsecutiveDays,
  };
}

/**
 * The read-only base hourly rate shown on SCR-031: the pinned wage rule's
 * `defaultHourlyRate` (the fallback rate, not a region's — rates by region
 * stay on the wage rule itself). A ₱ figure; callers tag it as network cost.
 */
export function baseHourlyRateFromPins(pins: readonly PinnedRuleVersion[]): number {
  return ruleSetFromPins(pins).wage.defaultHourlyRate;
}

/**
 * Applies the scenario's overrides on top of the pinned rule set.
 *
 * Applied: service target (served-within % and wait seconds), shrinkage and
 * absence reserve (uplift = shrinkage × (1 + reserve) − 1), FT shift pattern
 * (span = paid + meal), PT shift length (min = max = the setting), earliest
 * meal offset, and the labor rules (FT/PT max weekly hours, min rest between
 * shifts, max consecutive days). Note the season planner itself only consumes
 * the staffing rules; the labor values are carried in the rule set for the
 * roster checks that read it.
 *
 * Recorded but NOT applied by the season planner (the domain has no input for
 * them yet): `maxPtSharePct`, `ftMaxDaysPerWeek`, `ptMaxDaysPerWeek`,
 * `respectPreferredRestDay`. `minOpenLanes` and the department overrides act
 * on the departments and forecast models (see `contextFor`).
 */
export function applyRuleOverrides(base: RuleSet, settings: ScenarioSettingsValues): RuleSet {
  const st = base.staffing;
  const lb = base.labor;
  const pattern = settings.ftShiftPattern === null ? null : PATTERN_SPANS[settings.ftShiftPattern];
  const span = pattern ? pattern.paid + pattern.meal : st.shifts.ftSpanHours;
  const earliest = settings.mealEarliestAfterHours ?? st.shifts.mealWindow.earliestOffset;
  const shrinkFactor = settings.shrinkage ?? 1 + st.shrinkage;
  const reserve = settings.absenceReservePct ?? 0;
  const staffing: StaffingRuleVersion = {
    ...st,
    serviceTarget: {
      serviceLevel: settings.servedWithinPct !== null ? settings.servedWithinPct / 100 : st.serviceTarget.serviceLevel,
      thresholdSec: settings.waitSeconds ?? st.serviceTarget.thresholdSec,
    },
    shrinkage:
      settings.shrinkage === null && settings.absenceReservePct === null ? st.shrinkage : shrinkFactor * (1 + reserve / 100) - 1,
    shifts: {
      ...st.shifts,
      ftSpanHours: span,
      ftMealHours: pattern ? pattern.meal : st.shifts.ftMealHours,
      // Keep the "useful hours" bar the same distance below the span.
      ftMinUsefulHours: pattern
        ? Math.max(1, span - (st.shifts.ftSpanHours - st.shifts.ftMinUsefulHours))
        : st.shifts.ftMinUsefulHours,
      ptMinHours: settings.ptShiftHours ?? st.shifts.ptMinHours,
      ptMaxHours: settings.ptShiftHours ?? st.shifts.ptMaxHours,
      mealWindow: { earliestOffset: earliest, latestOffset: Math.max(st.shifts.mealWindow.latestOffset, earliest) },
    },
  };
  const labor: LaborRuleVersion = {
    ...lb,
    maxWeeklyHours: {
      ...lb.maxWeeklyHours,
      FT: settings.ftMaxHoursPerWeek ?? lb.maxWeeklyHours.FT,
      PT: settings.ptMaxHoursPerWeek ?? lb.maxWeeklyHours.PT,
    },
    minRestBetweenShiftsHours: settings.minRestHours ?? lb.minRestBetweenShiftsHours,
    maxConsecutiveDays: settings.maxConsecutiveDays ?? lb.maxConsecutiveDays,
  };
  return { ...base, staffing, labor };
}

// ---------------------------------------------------------------------------
// Demo snapshot (cached: generating + learning takes ~0.8 s)
// ---------------------------------------------------------------------------

interface DemoCache {
  readonly snapshot: demo.DemoSnapshot;
  readonly models: ReadonlyMap<string, DepartmentForecastModel>;
}

let demoCache: DemoCache | null = null;

function demoData(): DemoCache {
  if (!demoCache) {
    const snapshot = demo.createDemoSnapshot();
    demoCache = { snapshot, models: learnForecastModels(demo.DEMO_DEPARTMENTS, snapshot.history) };
  }
  return demoCache;
}

/** Seeded demo snapshots (synthetic, `demo://` or no storage key) are regenerated, not read. */
export function isDemoSnapshot(snapshot: Pick<PinnedSnapshot, 'synthetic' | 'storageKey'>): boolean {
  return snapshot.synthetic && (snapshot.storageKey === null || snapshot.storageKey.startsWith('demo://'));
}

/** DB department uuid → demo domain department id. */
const DEMO_DEPARTMENT_BY_UUID: ReadonlyMap<string, string> = new Map(
  demo.DEMO_DEPARTMENTS.map((d) => [demoId('department', d.id), d.id]),
);

/** Uplift (%) a model applies in the season period of `peakDay`. */
function upliftPctOf(model: DepartmentForecastModel, peakDay: string): number {
  return Math.round((model.seasonalFactor[seasonalPeriodOf(peakDay)] - 1) * 100);
}

/**
 * POS-learned baselines per department for the overrides table. Demo
 * snapshots only (uploaded data is learned by the job worker): `[]` otherwise.
 * Ids are the DB uuids (`demoId`), so overrides round-trip to the engine.
 */
export function departmentBaselines(pos: PinnedSnapshot | null, peakDay: string): DepartmentBaselineRow[] {
  if (!pos || !isDemoSnapshot(pos)) return [];
  const { models } = demoData();
  return demo.DEMO_DEPARTMENT_SEEDS.map((seed) => {
    const d = seed.department;
    const store = demo.DEMO_STORES.find((s) => s.id === d.storeId);
    const model = models.get(d.id);
    return {
      departmentId: demoId('department', d.id),
      departmentName: d.name,
      storeId: demoId('store', d.storeId),
      storeName: store?.name ?? d.storeId,
      regionId: demoId('region', store?.region ?? ''),
      baselineTxPerDay: round(model?.baselineDaily ?? seed.baseDaily, 1),
      handleTimeMin: round((model?.ahtByPeriod.base ?? seed.ahtSec) / 60, 2),
      upliftPct: model ? upliftPctOf(model, peakDay) : 0,
    };
  });
}

/** A baseline row plus the store's region (for the P1 scope filter; not sent to the client). */
export interface DepartmentBaselineRow extends ScenarioDepartmentBaseline {
  readonly regionId: string;
}

/** Applies a department's demand overrides to its learned forecast model. */
function overrideModel(
  model: DepartmentForecastModel,
  o: ScenarioSettingsValues['departmentOverrides'][number],
  peakDay: string,
): DepartmentForecastModel {
  let next = model;
  if (o.baselineTxPerDay !== null) next = { ...next, baselineDaily: o.baselineTxPerDay };
  if (o.handleTimeMin !== null && next.ahtByPeriod.base > 0) {
    // Scale every period so the base period equals the override (keeps the seasonal AHT shape).
    const k = (o.handleTimeMin * 60) / next.ahtByPeriod.base;
    next = {
      ...next,
      ahtByPeriod: Object.fromEntries(SEASONAL_PERIODS.map((p) => [p, next.ahtByPeriod[p] * k])) as DepartmentForecastModel['ahtByPeriod'],
    };
  }
  if (o.upliftPct !== null) {
    // The uplift is quoted for the peak day's period; scale every in-season
    // (non-base) period by the same ratio so that period lands on it and the
    // relative season shape is kept.
    const peakFactor = next.seasonalFactor[seasonalPeriodOf(peakDay)];
    const target = 1 + o.upliftPct / 100;
    const k = peakFactor > 0 ? target / peakFactor : 1;
    next = {
      ...next,
      seasonalFactor: Object.fromEntries(
        SEASONAL_PERIODS.map((p) => [p, p === 'base' ? next.seasonalFactor[p] : next.seasonalFactor[p] * k]),
      ) as DepartmentForecastModel['seasonalFactor'],
    };
  }
  return next;
}

/**
 * The engine context for pinned inputs (task 14 reuses it for the network
 * view, department plan and background jobs). Only growth and part-time are
 * taken from `settings` — callers memoise on those two — so the SCR-031 rule
 * and department overrides apply to scenario runs (`runScenarioEngine`) only.
 * Throws `EngineInputError` for uploaded data, which the engine cannot read yet.
 */
export function planningContextFor(input: {
  readonly settings: Pick<ScenarioSettingsValues, 'growth' | 'allowPartTime'>;
  readonly snapshots: readonly PinnedSnapshot[];
  readonly ruleVersions: readonly PinnedRuleVersion[];
}): PlanningContext {
  const pos = input.snapshots.find((s) => s.datasetType === 'pos');
  if (!pos) throw new EngineInputError('The scenario has no POS snapshot pinned.');
  const settings: ScenarioSettingsValues = {
    ...DEFAULT_SCENARIO_SETTINGS,
    growth: input.settings.growth,
    allowPartTime: input.settings.allowPartTime,
  };
  return contextFor(pos, ruleSetFromPins(input.ruleVersions), settings);
}

function contextFor(snapshot: PinnedSnapshot, rules: RuleSet, settings: ScenarioSettingsValues): PlanningContext {
  if (!isDemoSnapshot(snapshot)) {
    throw new EngineInputError('Runs on uploaded data are processed by the background job worker, which is not enabled yet.');
  }
  const { models } = demoData();
  const minOpen = settings.minOpenLanes;
  const departments: Department[] = demo.DEMO_DEPARTMENTS.map((d) =>
    minOpen === null ? d : { ...d, minLanes: Math.min(d.installedLanes, Math.max(d.minLanes, minOpen)) },
  );
  const overrides = new Map<string, ScenarioSettingsValues['departmentOverrides'][number]>();
  for (const o of settings.departmentOverrides) {
    const domainId = DEMO_DEPARTMENT_BY_UUID.get(o.departmentId);
    if (domainId) overrides.set(domainId, o); // Unknown ids (another provenance) are ignored.
  }
  const learned = new Map(models);
  for (const [id, o] of overrides) {
    const m = learned.get(id);
    if (m) learned.set(id, overrideModel(m, o, settings.peakDay));
  }
  return {
    stores: demo.DEMO_STORES,
    departments,
    models: learned,
    rules,
    settings: { ...DEFAULT_SETTINGS, growth: settings.growth, allowPartTime: settings.allowPartTime },
    // The run records the pinned DB snapshot id (the demo history is regenerated for it).
    snapshotId: snapshot.snapshotId,
  };
}

/** Active staff per DB department and contract type (the hiring plan's "current"). */
export interface CurrentStaffRow {
  readonly departmentId: string;
  readonly contractType: ContractType;
  readonly count: number;
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
  /** Current active staff (DB department ids); omitted = nobody on staff yet. */
  readonly currentStaff?: readonly CurrentStaffRow[];
}): StoredRunResults {
  const pos = input.snapshots.find((s) => s.datasetType === 'pos');
  if (!pos) throw new EngineInputError('The scenario has no POS snapshot pinned.');
  const rules = applyRuleOverrides(ruleSetFromPins(input.ruleVersions), input.settings);
  const ctx = contextFor(pos, rules, input.settings);
  const { planningFrom, planningTo, peakDay } = input.settings;

  const season = planSeason(ctx, planningFrom, planningTo);
  const teams = sizeTeams(season.departmentDays, rules.hiring);
  const peak = planNetworkDay(ctx, peakDay);

  const current: CurrentStaffCount[] = [];
  for (const row of input.currentStaff ?? []) {
    const departmentId = DEMO_DEPARTMENT_BY_UUID.get(row.departmentId) ?? row.departmentId;
    if (!(CONTRACT_TYPES as readonly string[]).includes(row.contractType)) continue;
    const existing = current.findIndex((c) => c.departmentId === departmentId && c.contractType === row.contractType);
    if (existing >= 0) {
      const c = current[existing];
      if (c) current[existing] = { ...c, count: c.count + row.count };
    } else current.push({ departmentId, contractType: row.contractType, count: row.count });
  }
  const hiring = buildHiringPlan(season.departmentDays, current, rules.hiring);
  const hiresByStore = new Map<string, number>();
  const needByByStore = new Map<string, string>();
  for (const wave of hiring.waves) {
    for (const line of wave.lines) {
      hiresByStore.set(line.storeId, (hiresByStore.get(line.storeId) ?? 0) + line.count);
      const prev = needByByStore.get(line.storeId);
      if (line.count > 0 && (prev === undefined || wave.needBy < prev)) needByByStore.set(line.storeId, wave.needBy);
    }
  }

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
      hires: hiresByStore.get(store.id) ?? 0,
      firstNeededBy: needByByStore.get(store.id) ?? null,
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
