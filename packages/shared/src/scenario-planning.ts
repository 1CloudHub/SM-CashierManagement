/**
 * Scenario planning contracts (task 11; Req 8.1–8.6; P3, P4, P5, P6).
 *
 * Pure helpers shared by the API and the SPA:
 *
 *  - scenario settings (the v3 inputs the engine consumes) with defaults and
 *    a dependency-free validator;
 *  - the staleness rule (P5): a scenario is stale exactly when a pinned
 *    snapshot or rule version is superseded by a newer current one, or its
 *    settings changed after its last run;
 *  - the submit gate (stale or never-run scenarios cannot be submitted);
 *  - compare: settings diff and result deltas (headcount, hours, cost, peak
 *    lanes), overall and by store.
 */
import type { IsoDate, IsoDateTime } from './entities.js';
import { isIsoDate, type ContractTypeKey } from './rules.js';
import type { ScenarioStatus } from './scenario.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface ScenarioSettingsValues {
  /** Year-over-year volume growth multiplier, e.g. 1.05 for +5 %. */
  readonly growth: number;
  readonly allowPartTime: boolean;
  /** Season window planned by a run (inclusive). */
  readonly planningFrom: IsoDate;
  readonly planningTo: IsoDate;
  /** Day whose network peak is reported (e.g. the busiest Saturday). */
  readonly peakDay: IsoDate;
  readonly notes: string;
}

export const SCENARIO_SETTING_KEYS = ['growth', 'allowPartTime', 'planningFrom', 'planningTo', 'peakDay', 'notes'] as const;
export type ScenarioSettingKey = (typeof SCENARIO_SETTING_KEYS)[number];

export const DEFAULT_SCENARIO_SETTINGS: ScenarioSettingsValues = {
  growth: 1.05,
  allowPartTime: true,
  planningFrom: '2026-12-01',
  planningTo: '2026-12-31',
  peakDay: '2026-12-19',
  notes: '',
};

export const SCENARIO_GROWTH_RANGE = { min: 0.5, max: 2 } as const;
/** Longest season a synchronous run plans (days). */
export const SCENARIO_MAX_PLANNING_DAYS = 92;

export interface ScenarioSettingsIssue {
  readonly path: ScenarioSettingKey;
  readonly message: string;
}

export type ScenarioSettingsValidation =
  | { readonly ok: true; readonly settings: ScenarioSettingsValues }
  | { readonly ok: false; readonly issues: readonly ScenarioSettingsIssue[] };

const DAY_MS = 86_400_000;

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * Validates complete settings. Unknown keys are rejected so a typo never
 * silently falls back to a default.
 */
export function validateScenarioSettings(value: unknown): ScenarioSettingsValidation {
  const issues: ScenarioSettingsIssue[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, issues: [{ path: 'growth', message: 'Settings must be an object.' }] };
  }
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!(SCENARIO_SETTING_KEYS as readonly string[]).includes(key)) {
      issues.push({ path: 'notes', message: `Unknown setting "${key}".` });
    }
  }
  const { growth, allowPartTime, planningFrom, planningTo, peakDay, notes } = v;
  if (typeof growth !== 'number' || !Number.isFinite(growth) || growth < SCENARIO_GROWTH_RANGE.min || growth > SCENARIO_GROWTH_RANGE.max) {
    issues.push({ path: 'growth', message: `Must be a number from ${SCENARIO_GROWTH_RANGE.min} to ${SCENARIO_GROWTH_RANGE.max}.` });
  }
  if (typeof allowPartTime !== 'boolean') issues.push({ path: 'allowPartTime', message: 'Must be true or false.' });
  if (!isIsoDate(planningFrom)) issues.push({ path: 'planningFrom', message: 'Must be a date (YYYY-MM-DD).' });
  if (!isIsoDate(planningTo)) issues.push({ path: 'planningTo', message: 'Must be a date (YYYY-MM-DD).' });
  if (!isIsoDate(peakDay)) issues.push({ path: 'peakDay', message: 'Must be a date (YYYY-MM-DD).' });
  if (isIsoDate(planningFrom) && isIsoDate(planningTo)) {
    const span = daysBetween(planningFrom, planningTo);
    if (span < 0) issues.push({ path: 'planningTo', message: 'Must be on or after the start date.' });
    else if (span + 1 > SCENARIO_MAX_PLANNING_DAYS) {
      issues.push({ path: 'planningTo', message: `A season can cover at most ${SCENARIO_MAX_PLANNING_DAYS} days.` });
    }
    if (isIsoDate(peakDay) && (peakDay < planningFrom || peakDay > planningTo)) {
      issues.push({ path: 'peakDay', message: 'Must fall within the season.' });
    }
  }
  if (typeof notes !== 'string' || notes.length > 2000) issues.push({ path: 'notes', message: 'At most 2000 characters.' });
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    settings: {
      growth: growth as number,
      allowPartTime: allowPartTime as boolean,
      planningFrom: planningFrom as IsoDate,
      planningTo: planningTo as IsoDate,
      peakDay: peakDay as IsoDate,
      notes: notes as string,
    },
  };
}

/**
 * Reads stored settings leniently: known keys of the right type are kept,
 * anything else falls back to the default (older rows may carry extra keys).
 */
export function readScenarioSettings(stored: unknown): ScenarioSettingsValues {
  const v = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>;
  const d = DEFAULT_SCENARIO_SETTINGS;
  return {
    growth: typeof v.growth === 'number' && Number.isFinite(v.growth) ? v.growth : d.growth,
    allowPartTime: typeof v.allowPartTime === 'boolean' ? v.allowPartTime : d.allowPartTime,
    planningFrom: isIsoDate(v.planningFrom) ? v.planningFrom : d.planningFrom,
    planningTo: isIsoDate(v.planningTo) ? v.planningTo : d.planningTo,
    peakDay: isIsoDate(v.peakDay) ? v.peakDay : d.peakDay,
    notes: typeof v.notes === 'string' ? v.notes : d.notes,
  };
}

export interface ScenarioSettingsChange {
  readonly key: ScenarioSettingKey;
  readonly from: ScenarioSettingsValues[ScenarioSettingKey];
  readonly to: ScenarioSettingsValues[ScenarioSettingKey];
}

/** Settings that differ between A and B, in display order (SCR-032 "only changed"). */
export function diffScenarioSettings(a: ScenarioSettingsValues, b: ScenarioSettingsValues): ScenarioSettingsChange[] {
  return SCENARIO_SETTING_KEYS.filter((k) => a[k] !== b[k]).map((key) => ({ key, from: a[key], to: b[key] }));
}

// ---------------------------------------------------------------------------
// Staleness (P5)
// ---------------------------------------------------------------------------

export const STALE_REASONS = ['snapshot_superseded', 'rules_superseded', 'settings_changed'] as const;
export type StaleReason = (typeof STALE_REASONS)[number];

export interface StalenessInput {
  /** Pinned snapshot id per dataset type. */
  readonly pinnedSnapshots: Readonly<Record<string, string>>;
  /** The current (latest loaded) snapshot id per dataset type, same provenance. */
  readonly currentSnapshots: Readonly<Record<string, string | undefined>>;
  /** Pinned rule version id per rule set. */
  readonly pinnedRuleVersions: Readonly<Record<string, string>>;
  /** The in-force published rule version id per rule set, same provenance. */
  readonly currentRuleVersions: Readonly<Record<string, string | undefined>>;
  readonly settingsChangedAt: IsoDateTime;
  readonly lastRunAt: IsoDateTime | null;
}

export interface Staleness {
  readonly stale: boolean;
  readonly reasons: readonly StaleReason[];
}

function superseded(pinned: Readonly<Record<string, string>>, current: Readonly<Record<string, string | undefined>>): boolean {
  return Object.entries(pinned).some(([key, id]) => {
    const now = current[key];
    return now !== undefined && now !== id;
  });
}

/**
 * Stale exactly when a pinned snapshot or rule version has been superseded
 * by a different current one, or settings changed after the last run (P5).
 * A scenario that has never run is not stale — it is "not run yet", which
 * blocks submission separately.
 */
export function scenarioStaleness(input: StalenessInput): Staleness {
  const reasons: StaleReason[] = [];
  if (superseded(input.pinnedSnapshots, input.currentSnapshots)) reasons.push('snapshot_superseded');
  if (superseded(input.pinnedRuleVersions, input.currentRuleVersions)) reasons.push('rules_superseded');
  if (input.lastRunAt !== null && Date.parse(input.settingsChangedAt) > Date.parse(input.lastRunAt)) {
    reasons.push('settings_changed');
  }
  return { stale: reasons.length > 0, reasons };
}

/** Stored `scenario.stale_reason` text (comma-separated codes). */
export function formatStaleReasons(reasons: readonly StaleReason[]): string | null {
  return reasons.length > 0 ? reasons.join(',') : null;
}

export function parseStaleReasons(text: string | null): StaleReason[] {
  if (!text) return [];
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is StaleReason => (STALE_REASONS as readonly string[]).includes(s));
}

export type SubmitBlocker = 'not_draft' | 'stale' | 'not_run';

/** Whether a scenario may be submitted for approval (Req 8.5, P5). */
export function scenarioSubmitBlocker(s: {
  readonly status: ScenarioStatus;
  readonly stale: boolean;
  readonly hasSucceededRun: boolean;
}): SubmitBlocker | null {
  if (s.status !== 'draft') return 'not_draft';
  if (s.stale) return 'stale';
  if (!s.hasSucceededRun) return 'not_run';
  return null;
}

// ---------------------------------------------------------------------------
// Run results and compare
// ---------------------------------------------------------------------------

export interface ScenarioPeak {
  readonly date: IsoDate;
  readonly hour: number;
  readonly lanesOpen: number;
}

export interface ScenarioStoreResult {
  readonly storeId: string;
  readonly storeName: string;
  readonly regionId: string;
  /** Season team size (peak-week headcount incl. buffer). */
  readonly headcount: number;
  readonly paidHours: number;
  /** ₱ season cost; absent when the viewer may not see it (task 21). */
  readonly cost?: number;
  /** Peak lanes open on the peak day. */
  readonly peakLanes: number;
}

export interface ScenarioRunResults {
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly headcount: number;
  readonly headcountByType: Readonly<Record<ContractTypeKey, number>>;
  readonly paidHours: number;
  /** ₱ season cost over the viewer's in-scope stores; absent when hidden. */
  readonly cost?: number;
  readonly peak: ScenarioPeak;
  readonly stores: readonly ScenarioStoreResult[];
}

export interface MetricDelta {
  readonly a: number | null;
  readonly b: number | null;
  /** b − a, or null when either side is missing. */
  readonly delta: number | null;
}

export function metricDelta(a: number | null | undefined, b: number | null | undefined): MetricDelta {
  const av = a ?? null;
  const bv = b ?? null;
  return { a: av, b: bv, delta: av === null || bv === null ? null : bv - av };
}

export interface StoreComparison {
  readonly storeId: string;
  readonly storeName: string;
  readonly headcount: MetricDelta;
  readonly paidHours: MetricDelta;
  /** Absent when the viewer may not see cost for this store on either side. */
  readonly cost?: MetricDelta;
  readonly peakLanes: MetricDelta;
}

export interface ResultsComparison {
  readonly headcount: MetricDelta;
  readonly paidHours: MetricDelta;
  readonly cost?: MetricDelta;
  readonly peakLanes: MetricDelta;
  readonly stores: readonly StoreComparison[];
}

/**
 * Result deltas for SCR-032. Either side may be missing (never run); cost
 * deltas appear only when both sides carry the (already shaped) figure.
 */
export function compareScenarioResults(a: ScenarioRunResults | null, b: ScenarioRunResults | null): ResultsComparison {
  const ids = new Map<string, string>();
  for (const s of [...(a?.stores ?? []), ...(b?.stores ?? [])]) if (!ids.has(s.storeId)) ids.set(s.storeId, s.storeName);
  const stores: StoreComparison[] = [...ids.entries()]
    .sort(([, x], [, y]) => x.localeCompare(y))
    .map(([storeId, storeName]) => {
      const sa = a?.stores.find((s) => s.storeId === storeId);
      const sb = b?.stores.find((s) => s.storeId === storeId);
      const withCost = sa?.cost !== undefined && sb?.cost !== undefined;
      return {
        storeId,
        storeName,
        headcount: metricDelta(sa?.headcount, sb?.headcount),
        paidHours: metricDelta(sa?.paidHours, sb?.paidHours),
        ...(withCost ? { cost: metricDelta(sa.cost, sb.cost) } : {}),
        peakLanes: metricDelta(sa?.peakLanes, sb?.peakLanes),
      };
    });
  const withCost = a?.cost !== undefined && b?.cost !== undefined;
  return {
    headcount: metricDelta(a?.headcount, b?.headcount),
    paidHours: metricDelta(a?.paidHours, b?.paidHours),
    ...(withCost ? { cost: metricDelta(a.cost, b.cost) } : {}),
    peakLanes: metricDelta(a?.peak.lanesOpen, b?.peak.lanesOpen),
    stores,
  };
}

// ---------------------------------------------------------------------------
// API DTOs (`/scenarios`)
// ---------------------------------------------------------------------------

export interface ScenarioListItem {
  readonly id: string;
  readonly name: string;
  readonly season: string;
  readonly status: ScenarioStatus;
  /** ★ — the season's Published scenario (P3). */
  readonly isPublished: boolean;
  readonly stale: boolean;
  readonly staleReasons: readonly StaleReason[];
  readonly ownerId: string;
  readonly ownerName: string;
  readonly parentScenarioId: string | null;
  readonly planningFrom: IsoDate;
  readonly planningTo: IsoDate;
  /** Loaded time of the pinned POS snapshot ("Data as of"). */
  readonly dataAsOf: IsoDateTime | null;
  readonly lastRunAt: IsoDateTime | null;
  readonly updatedAt: IsoDateTime;
  readonly synthetic: boolean;
}

export interface ScenarioSnapshotPin {
  readonly datasetType: string;
  readonly snapshotId: string;
  readonly loadedAt: IsoDateTime;
  /** False when a newer snapshot of this type has been loaded. */
  readonly current: boolean;
}

export interface ScenarioRuleVersionPin {
  readonly ruleSetId: string;
  readonly ruleSetName: string;
  readonly ruleSetType: string;
  readonly ruleVersionId: string;
  readonly version: number;
  readonly effectiveFrom: IsoDate;
  /** False when a newer version of this rule set has been published. */
  readonly current: boolean;
}

export type ScenarioRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ScenarioRunSummary {
  readonly id: string;
  readonly status: ScenarioRunStatus;
  readonly createdAt: IsoDateTime;
  readonly finishedAt: IsoDateTime | null;
  readonly errorMessage: string | null;
  /** Exactly the inputs this run used (P6). */
  readonly snapshotIds: Readonly<Record<string, string>>;
  readonly ruleVersionIds: readonly string[];
  readonly results: ScenarioRunResults | null;
}

export interface ScenarioDetail extends ScenarioListItem {
  readonly settings: ScenarioSettingsValues;
  readonly snapshots: readonly ScenarioSnapshotPin[];
  readonly ruleVersions: readonly ScenarioRuleVersionPin[];
  readonly latestRun: ScenarioRunSummary | null;
  /** Settings editable (Draft only, P4) and the viewer may edit. */
  readonly editable: boolean;
  readonly submitBlocker: SubmitBlocker | null;
}

export interface ScenarioComparison {
  readonly a: ScenarioDetail;
  readonly b: ScenarioDetail;
  readonly settings: readonly ScenarioSettingsChange[];
  readonly inputs: {
    readonly snapshots: readonly { readonly datasetType: string; readonly a: string | null; readonly b: string | null }[];
    readonly ruleVersions: readonly { readonly ruleSetName: string; readonly a: number | null; readonly b: number | null }[];
  };
  readonly results: ResultsComparison;
}
