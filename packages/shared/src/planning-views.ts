/**
 * Network view, department day plan, hiring plan, background jobs and the
 * leadership summary (task 14; Req 5, 10, 18.3; P1, P2, P6, P9, P18).
 *
 * Contracts shared by the API and the SPA, plus the pure aggregation and
 * export helpers both use:
 *
 *  - `departmentFigures` is the one place a department-day's headline figures
 *    are derived. The all-stores view and the single-department view both
 *    call it, and store / network totals are sums of those rows
 *    (`aggregateNetwork`), so a department shows identical figures in either
 *    view (DOM-001 consistency invariant, P2).
 *  - Every view carries `PlanningProvenance`: the scenario, the run whose
 *    pinned snapshots and rule versions produced it, and whether the data is
 *    synthetic (P6, P9, P18).
 *  - Exports are CSV built with `buildCsvExport` (header block with scenario,
 *    rules, snapshot, time and user; `SAMPLE DATA` marker while synthetic).
 *
 * ₱ fields are optional: the API removes the ones the viewer may not see
 * (task 21 cost visibility).
 */
import { buildCsvExport } from './ingestion.js';

export type PlanningContractType = 'FT' | 'PT' | 'FLOAT';
export const PLANNING_CONTRACT_TYPES: readonly PlanningContractType[] = ['FT', 'PT', 'FLOAT'];
export type PlanningDayType = 'regular' | 'special' | 'regularHoliday';

/** What produced a view: the scenario run and exactly the inputs it pinned (P6). */
export interface PlanningProvenance {
  readonly scenarioId: string;
  readonly scenarioName: string;
  readonly scenarioStatus: string;
  /** The run whose inputs produced these figures (`null` before the first run). */
  readonly runId: string | null;
  readonly runAt: string | null;
  /** Snapshot id per dataset type. */
  readonly snapshotIds: Readonly<Record<string, string>>;
  readonly ruleVersionIds: readonly string[];
  /** Seeded demo data (sample-data marker, P9); never mixed with real data (P18). */
  readonly synthetic: boolean;
  /** Settings or inputs changed since the run (P5): show the Recalculate banner. */
  readonly stale: boolean;
}

// ---------------------------------------------------------------------------
// Department-day figures (the P2 unit)
// ---------------------------------------------------------------------------

/** Minimal engine output for one department-day (mapped from `@lanewise/domain`). */
export interface DepartmentDayInput {
  readonly departmentId: string;
  readonly departmentName: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly regionId: string;
  readonly storeFormat: string;
  readonly installedLanes: number;
  readonly forecastTransactions: number;
  readonly hours: readonly {
    readonly hour: number;
    readonly lanesNeeded: number;
    readonly lanesOpen: number;
    readonly cashiersRequired: number;
    readonly overCapacity: boolean;
  }[];
  readonly shifts: readonly { readonly type: PlanningContractType; readonly paidHours: number }[];
  readonly cost: number;
}

export interface DepartmentHourCell {
  readonly hour: number;
  /** Cashiers needed on lanes (uncapped). */
  readonly lanesNeeded: number;
  readonly lanesOpen: number;
  /** Share of installed lanes needed, rounded to a whole percent. */
  readonly pressurePct: number;
  readonly overCapacity: boolean;
}

export interface DepartmentFigures {
  readonly departmentId: string;
  readonly departmentName: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly regionId: string;
  readonly storeFormat: string;
  readonly installedLanes: number;
  readonly forecastTransactions: number;
  readonly peakHour: number;
  readonly peakLanes: number;
  /** Shifts rostered for the day (one cashier each). */
  readonly cashiers: number;
  readonly cashiersByType: Readonly<Record<PlanningContractType, number>>;
  readonly paidHours: number;
  readonly cost?: number;
  /** Hours whose need exceeds the installed lanes. */
  readonly overCapacityHours: readonly number[];
  /** Largest uncapped need in an over-capacity hour (0 when none). */
  readonly maxLanesNeeded: number;
  readonly hours: readonly DepartmentHourCell[];
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function peakOf(byHour: readonly { hour: number; value: number }[]): { hour: number; value: number } {
  let best = { hour: -1, value: -1 };
  for (const h of [...byHour].sort((a, b) => a.hour - b.hour)) if (h.value > best.value) best = h;
  return { hour: best.hour, value: Math.max(0, best.value) };
}

/** Headline figures of one department-day; identical wherever the department is shown (P2). */
export function departmentFigures(input: DepartmentDayInput): RawDepartmentFigures {
  const byType: Record<PlanningContractType, number> = { FT: 0, PT: 0, FLOAT: 0 };
  for (const s of input.shifts) byType[s.type] += 1;
  const peak = peakOf(input.hours.map((h) => ({ hour: h.hour, value: h.lanesOpen })));
  const over = input.hours.filter((h) => h.overCapacity);
  return {
    departmentId: input.departmentId,
    departmentName: input.departmentName,
    storeId: input.storeId,
    storeName: input.storeName,
    regionId: input.regionId,
    storeFormat: input.storeFormat,
    installedLanes: input.installedLanes,
    forecastTransactions: input.forecastTransactions,
    peakHour: peak.hour,
    peakLanes: peak.value,
    cashiers: input.shifts.length,
    cashiersByType: byType,
    paidHours: input.shifts.reduce((s, x) => s + x.paidHours, 0),
    cost: round2(input.cost),
    overCapacityHours: over.map((h) => h.hour),
    maxLanesNeeded: over.reduce((m, h) => Math.max(m, h.lanesNeeded), 0),
    hours: input.hours.map((h) => ({
      hour: h.hour,
      lanesNeeded: h.lanesNeeded,
      lanesOpen: h.lanesOpen,
      pressurePct: input.installedLanes > 0 ? Math.round((h.lanesNeeded / input.installedLanes) * 100) : 0,
      overCapacity: h.overCapacity,
    })),
  };
}

// ---------------------------------------------------------------------------
// Network view (SCR-020)
// ---------------------------------------------------------------------------

export interface NetworkStoreRow {
  readonly storeId: string;
  readonly storeName: string;
  readonly regionId: string;
  readonly storeFormat: string;
  readonly installedLanes: number;
  readonly forecastTransactions: number;
  readonly peakHour: number;
  readonly peakLanes: number;
  readonly cashiers: number;
  readonly paidHours: number;
  readonly cost?: number;
  /** Cashiers needed on lanes per hour (sum of departments), for the stacked chart. */
  readonly lanesByHour: readonly { readonly hour: number; readonly lanesOpen: number }[];
  readonly departments: readonly DepartmentFigures[];
}

export interface NetworkKpis {
  readonly stores: number;
  readonly departments: number;
  readonly peakHour: number;
  readonly peakLanes: number;
  readonly cashiers: number;
  readonly cashiersByType: Readonly<Record<PlanningContractType, number>>;
  readonly paidHours: number;
  readonly cost?: number;
  readonly overCapacityDepartments: number;
}

export interface NetworkView {
  readonly provenance: PlanningProvenance;
  readonly date: string;
  readonly dayType: PlanningDayType;
  /** The trading hours shown as columns (union over in-scope departments). */
  readonly hours: readonly number[];
  readonly kpis: NetworkKpis;
  readonly stores: readonly NetworkStoreRow[];
}

/** Department figures before cost shaping: cost is a plain ₱ number. */
export type RawDepartmentFigures = Omit<DepartmentFigures, 'cost'> & { readonly cost: number };

/** Raw (unshaped) aggregation: cost is a plain number on every row. */
export interface NetworkAggregate {
  readonly hours: readonly number[];
  readonly kpis: Omit<NetworkKpis, 'cost'> & { readonly cost: number };
  readonly stores: readonly (Omit<NetworkStoreRow, 'cost' | 'departments'> & {
    readonly cost: number;
    readonly departments: readonly RawDepartmentFigures[];
  })[];
}

/**
 * Store and network totals as sums of department rows (P2: no figure is
 * computed twice). Store peak is the peak of the hourly sum, as the engine's
 * `planNetworkDay` does.
 */
export function aggregateNetwork(rows: readonly RawDepartmentFigures[]): NetworkAggregate {
  const hours = [...new Set(rows.flatMap((r) => r.hours.map((h) => h.hour)))].sort((a, b) => a - b);
  const storeIds: string[] = [];
  for (const r of rows) if (!storeIds.includes(r.storeId)) storeIds.push(r.storeId);
  const sumByHour = (list: readonly DepartmentFigures[]) =>
    hours.map((hour) => ({
      hour,
      lanesOpen: list.reduce((s, r) => s + (r.hours.find((h) => h.hour === hour)?.lanesOpen ?? 0), 0),
    }));
  const stores = storeIds.map((storeId) => {
    const own = rows.filter((r) => r.storeId === storeId);
    const first = own[0] as DepartmentFigures;
    const lanesByHour = sumByHour(own);
    const peak = peakOf(lanesByHour.map((h) => ({ hour: h.hour, value: h.lanesOpen })));
    return {
      storeId,
      storeName: first.storeName,
      regionId: first.regionId,
      storeFormat: first.storeFormat,
      installedLanes: own.reduce((s, r) => s + r.installedLanes, 0),
      forecastTransactions: own.reduce((s, r) => s + r.forecastTransactions, 0),
      peakHour: peak.hour,
      peakLanes: peak.value,
      cashiers: own.reduce((s, r) => s + r.cashiers, 0),
      paidHours: own.reduce((s, r) => s + r.paidHours, 0),
      cost: round2(own.reduce((s, r) => s + r.cost, 0)),
      lanesByHour,
      departments: own,
    };
  });
  const network = peakOf(sumByHour(rows).map((h) => ({ hour: h.hour, value: h.lanesOpen })));
  const byType: Record<PlanningContractType, number> = { FT: 0, PT: 0, FLOAT: 0 };
  for (const r of rows) for (const t of PLANNING_CONTRACT_TYPES) byType[t] += r.cashiersByType[t];
  return {
    hours,
    kpis: {
      stores: stores.length,
      departments: rows.length,
      peakHour: network.hour,
      peakLanes: network.value,
      cashiers: rows.reduce((s, r) => s + r.cashiers, 0),
      cashiersByType: byType,
      paidHours: rows.reduce((s, r) => s + r.paidHours, 0),
      cost: round2(rows.reduce((s, r) => s + r.cost, 0)),
      overCapacityDepartments: rows.filter((r) => r.overCapacityHours.length > 0).length,
    },
    stores,
  };
}

/** Network-view filters (the SCR-020 context bar). Empty values mean "all". */
export interface NetworkFilter {
  readonly regionId?: string;
  readonly storeFormat?: string;
  readonly storeId?: string;
  readonly departmentId?: string;
}

export function matchesNetworkFilter(row: Pick<DepartmentFigures, 'regionId' | 'storeFormat' | 'storeId' | 'departmentId'>, f: NetworkFilter): boolean {
  return (
    (!f.regionId || row.regionId === f.regionId) &&
    (!f.storeFormat || row.storeFormat === f.storeFormat) &&
    (!f.storeId || row.storeId === f.storeId) &&
    (!f.departmentId || row.departmentId === f.departmentId)
  );
}

// ---------------------------------------------------------------------------
// Department day plan (SCR-021)
// ---------------------------------------------------------------------------

export interface DepartmentHourRow {
  readonly hour: number;
  /** Forecast arrivals λ in the hour. */
  readonly transactions: number;
  /** Offered load in Erlangs. */
  readonly erlangs: number;
  readonly lanesNeeded: number;
  readonly lanesOpen: number;
  /** Cashiers to roster after shrinkage. */
  readonly cashiersRequired: number;
  /** Cashiers on shift (excluding meal hours). */
  readonly scheduled: number;
  /** Lane utilisation (0–1) at `lanesOpen`. */
  readonly utilization: number;
  /** Share served within the target wait (0–1) at `lanesOpen`. */
  readonly serviceLevel: number;
  readonly avgWaitSec: number;
  readonly overCapacity: boolean;
}

export interface DepartmentShiftRow {
  readonly id: string;
  readonly type: PlanningContractType;
  readonly start: number;
  readonly end: number;
  readonly mealHour: number | null;
  readonly paidHours: number;
}

export interface DepartmentDayView {
  readonly provenance: PlanningProvenance;
  readonly date: string;
  readonly dayType: PlanningDayType;
  /** The service target behind the Erlang C columns. */
  readonly serviceTarget: { readonly serviceLevel: number; readonly thresholdSec: number };
  readonly shrinkage: number;
  /** The same figures the network view shows for this department (P2). */
  readonly figures: DepartmentFigures;
  readonly hours: readonly DepartmentHourRow[];
  readonly shifts: readonly DepartmentShiftRow[];
}

/** Cashiers on shift per hour (meal hour excluded), for the shift builder footer. */
export function scheduledByHour(shifts: readonly DepartmentShiftRow[], hours: readonly number[]): number[] {
  return hours.map((h) => shifts.filter((s) => h >= s.start && h < s.end && s.mealHour !== h).length);
}

// ---------------------------------------------------------------------------
// Background jobs (task 14.2)
// ---------------------------------------------------------------------------

export const PLANNING_JOB_TYPES = ['hiring_plan', 'long_roster'] as const;
export type PlanningJobType = (typeof PLANNING_JOB_TYPES)[number];
export type PlanningJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** Rosters longer than this run as background jobs (Req 10.2). */
export const LONG_ROSTER_MIN_DAYS = 29;
/** Upper bound on a long-roster job (one planning window). */
export const LONG_ROSTER_MAX_DAYS = 92;

export interface PlanningJob {
  readonly id: string;
  readonly type: PlanningJobType;
  readonly scenarioId: string;
  readonly status: PlanningJobStatus;
  /** 0–1. */
  readonly progress: number;
  /** Departments processed so far / in total ("14 of 24 departments"). */
  readonly unitsDone: number;
  readonly unitsTotal: number;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly errorMessage: string | null;
  /** Long rosters: the period. */
  readonly from: string | null;
  readonly to: string | null;
}

export function isJobActive(job: Pick<PlanningJob, 'status'> | null): boolean {
  return job !== null && (job.status === 'queued' || job.status === 'running');
}

/** The SQS message body for a job (the worker loads everything else from the database). */
export interface PlanningJobMessage {
  readonly type: PlanningJobType;
  readonly jobId: string;
}

// ---------------------------------------------------------------------------
// Hiring plan (SCR-023)
// ---------------------------------------------------------------------------

export interface HiringDepartmentRow {
  readonly departmentId: string;
  readonly departmentName: string;
  readonly baseline: number;
  readonly season: number;
  readonly hires: number;
  readonly hiresByType: Readonly<Record<PlanningContractType, number>>;
  readonly neededBy: string | null;
  readonly busiestWeek: string | null;
  readonly shifts: number;
  readonly paidHours: number;
  readonly cost?: number;
  /** Average weekly paid hours per FT team member over the season. */
  readonly ftAvgWeeklyHours: number | null;
}

export interface HiringStoreRow {
  readonly storeId: string;
  readonly storeName: string;
  readonly regionId: string;
  readonly baseline: number;
  readonly season: number;
  readonly hires: number;
  readonly hiresByType: Readonly<Record<PlanningContractType, number>>;
  readonly neededBy: string | null;
  readonly busiestWeek: string | null;
  readonly shifts: number;
  readonly paidHours: number;
  readonly cost?: number;
  readonly departments: readonly HiringDepartmentRow[];
}

export type MilestoneStatus = 'done' | 'overdue' | 'due_soon' | 'upcoming';

export interface HiringMilestone {
  readonly date: string;
  readonly name: string;
  readonly contractType: PlanningContractType;
  /** Hires in the wave this milestone belongs to. */
  readonly count: number;
  readonly waveId: string;
  readonly status: MilestoneStatus;
}

export interface HiringKpis {
  readonly seasonalHires: number;
  readonly hiresByType: Readonly<Record<PlanningContractType, number>>;
  readonly baselineTeam: number;
  readonly peakTeam: number;
  readonly firstNeededBy: string | null;
  readonly recruitFrom: string | null;
  readonly seasonPaidHours: number;
  readonly seasonCost?: number;
}

export interface HiringPlanView {
  readonly provenance: PlanningProvenance;
  readonly job: PlanningJob | null;
  readonly from: string;
  readonly to: string;
  /** `null` until a hiring-plan job has succeeded for the scenario's current inputs. */
  readonly plan: {
    readonly kpis: HiringKpis;
    readonly timeline: readonly HiringMilestone[];
    readonly stores: readonly HiringStoreRow[];
  } | null;
}

/** Days ahead a milestone counts as "due soon" (Req 10.4). */
export const MILESTONE_DUE_SOON_DAYS = 7;

/** Status of a milestone on `today` (ISO dates compare lexically). */
export function milestoneStatus(date: string, today: string, done = false): MilestoneStatus {
  if (done) return 'done';
  if (date < today) return 'overdue';
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + MILESTONE_DUE_SOON_DAYS);
  return date <= soon.toISOString().slice(0, 10) ? 'due_soon' : 'upcoming';
}

/** Totals over in-scope stores only (P1: a region- or store-scoped viewer never sees others' hires). */
export function hiringKpisFor(
  stores: readonly (HiringStoreRow & { readonly cost: number })[],
  waves: readonly { readonly needBy: string; readonly recruitStart: string; readonly storeIds: readonly string[] }[],
): HiringKpis & { readonly seasonCost: number } {
  const ids = new Set(stores.map((s) => s.storeId));
  const relevant = waves.filter((w) => w.storeIds.some((id) => ids.has(id)));
  const byType: Record<PlanningContractType, number> = { FT: 0, PT: 0, FLOAT: 0 };
  for (const s of stores) for (const t of PLANNING_CONTRACT_TYPES) byType[t] += s.hiresByType[t];
  const min = (xs: string[]) => (xs.length === 0 ? null : [...xs].sort()[0] ?? null);
  return {
    seasonalHires: stores.reduce((n, s) => n + s.hires, 0),
    hiresByType: byType,
    baselineTeam: stores.reduce((n, s) => n + s.baseline, 0),
    peakTeam: stores.reduce((n, s) => n + s.season, 0),
    firstNeededBy: min(relevant.map((w) => w.needBy)),
    recruitFrom: min(relevant.map((w) => w.recruitStart)),
    seasonPaidHours: stores.reduce((n, s) => n + s.paidHours, 0),
    seasonCost: round2(stores.reduce((n, s) => n + s.cost, 0)),
  };
}

// ---------------------------------------------------------------------------
// Long roster job results
// ---------------------------------------------------------------------------

export interface LongRosterWeekRow {
  readonly storeId: string;
  readonly storeName: string;
  readonly regionId: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly weekStart: string;
  readonly shifts: number;
  readonly assigned: number;
  readonly openShifts: number;
  readonly paidHours: number;
  readonly laborWarnings: number;
  readonly cost?: number;
}

export interface LongRosterView {
  readonly provenance: PlanningProvenance;
  readonly job: PlanningJob;
  readonly weeks: readonly LongRosterWeekRow[] | null;
}

// ---------------------------------------------------------------------------
// Leadership summary (SCR-024)
// ---------------------------------------------------------------------------

export interface LeadershipSummary {
  readonly provenance: PlanningProvenance;
  readonly generatedAt: string;
  readonly season: string;
  readonly from: string;
  readonly to: string;
  readonly storeCount: number;
  readonly departmentCount: number;
  /** Shown as the "Illustrative: sample data" badge and print marker (Req 18.3, P9). */
  readonly sampleData: boolean;
  /** `null` when no hiring plan has been calculated for the scenario's current inputs. */
  readonly hiring: {
    readonly kpis: HiringKpis;
    readonly timeline: readonly HiringMilestone[];
    readonly stores: readonly Pick<HiringStoreRow, 'storeId' | 'storeName' | 'baseline' | 'hires' | 'neededBy'>[];
  } | null;
  /** The scenario run's peak and totals (from task 11 run results). */
  readonly peak: { readonly date: string; readonly hour: number; readonly lanesOpen: number } | null;
  readonly offersDue: string | null;
}

/** Growth of the peak team over the baseline, whole percent (0 with no baseline). */
export function growthPct(baseline: number, hires: number): number {
  return baseline > 0 ? Math.round((hires / baseline) * 100) : 0;
}

/** The "Offers accepted" milestone date of the first wave: when offers must be out. */
export function offersDueOf(timeline: readonly HiringMilestone[]): string | null {
  const offers = timeline.filter((m) => /offer/i.test(m.name)).map((m) => m.date).sort();
  return offers[0] ?? null;
}

// ---------------------------------------------------------------------------
// CSV exports (Req 5.3; header block per design.md › Export; P9 marker)
// ---------------------------------------------------------------------------

export interface ExportHeader {
  readonly generatedAt: string;
  readonly generatedBy: string;
  /** URL-encoded filters that produced the export. */
  readonly filters: string;
}

function provenanceMeta(p: PlanningProvenance, h: ExportHeader): [string, string][] {
  return [
    ['Scenario', `${p.scenarioName} (${p.scenarioStatus})`],
    ['Run', p.runId ?? 'not run'],
    ['Rules versions', [...p.ruleVersionIds].sort().join(' ')],
    ['Data snapshots', Object.entries(p.snapshotIds).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}:${v}`).join(' ')],
    ['Filters', h.filters || 'none'],
  ];
}

const money = (x: number | undefined): string => (x === undefined ? '' : x.toFixed(2));

/** CSV of the network view as filtered and scoped (store and department rows). */
export function networkViewCsv(view: NetworkView, header: ExportHeader): string {
  const costVisible = view.stores.some((s) => s.cost !== undefined || s.departments.some((d) => d.cost !== undefined));
  const columns = ['Store', 'Department', 'Forecast transactions', 'Peak on lanes', 'Peak hour', 'Installed lanes', 'Cashiers', 'Paid hours'];
  if (costVisible) columns.push('Cost PHP');
  columns.push('Over-capacity hours');
  type Figures = Pick<DepartmentFigures, 'forecastTransactions' | 'peakLanes' | 'peakHour' | 'installedLanes' | 'cashiers' | 'paidHours' | 'cost'>;
  const row = (store: string, dept: string, r: Figures, over: string) => {
    const cells = [store, dept, String(r.forecastTransactions), String(r.peakLanes), String(r.peakHour), String(r.installedLanes), String(r.cashiers), String(r.paidHours)];
    if (costVisible) cells.push(money(r.cost));
    cells.push(over);
    return cells;
  };
  const rows: string[][] = [];
  for (const s of view.stores) {
    rows.push(row(s.storeName, '', s, String(s.departments.reduce((n, d) => n + d.overCapacityHours.length, 0))));
    for (const d of s.departments) rows.push(row(s.storeName, d.departmentName, d, String(d.overCapacityHours.length)));
  }
  return buildCsvExport({
    title: `Network view ${view.date}`,
    generatedAt: header.generatedAt,
    generatedBy: header.generatedBy,
    sampleData: view.provenance.synthetic,
    meta: [...provenanceMeta(view.provenance, header), ['Date', view.date]],
    columns,
    rows,
  });
}

/** CSV of the hour-by-hour department plan. */
export function departmentDayCsv(view: DepartmentDayView, header: ExportHeader): string {
  const sched = scheduledByHour(view.shifts, view.hours.map((h) => h.hour));
  return buildCsvExport({
    title: `Department day plan ${view.figures.storeName} / ${view.figures.departmentName} ${view.date}`,
    generatedAt: header.generatedAt,
    generatedBy: header.generatedBy,
    sampleData: view.provenance.synthetic,
    meta: [...provenanceMeta(view.provenance, header), ['Date', view.date], ['Store', view.figures.storeName], ['Department', view.figures.departmentName]],
    columns: ['Hour', 'Transactions', 'Erlangs', 'Lanes needed', 'On lanes', 'Cashiers required', 'Scheduled', 'Utilization %', 'Served within target %', 'Average wait s', 'Over capacity'],
    rows: view.hours.map((h, i) => [
      String(h.hour),
      h.transactions.toFixed(1),
      h.erlangs.toFixed(2),
      String(h.lanesNeeded),
      String(h.lanesOpen),
      String(h.cashiersRequired),
      String(sched[i] ?? 0),
      String(Math.round(h.utilization * 100)),
      String(Math.round(h.serviceLevel * 100)),
      String(Math.round(h.avgWaitSec)),
      h.overCapacity ? 'yes' : 'no',
    ]),
  });
}

/** CSV of the hiring plan by store and department. */
export function hiringPlanCsv(view: HiringPlanView, header: ExportHeader): string {
  const costVisible = (view.plan?.stores ?? []).some((s) => s.cost !== undefined || s.departments.some((d) => d.cost !== undefined));
  const columns = ['Store', 'Department', 'Baseline team', 'Season team', 'Seasonal hires', 'FT hires', 'PT hires', 'Float hires', 'Needed by', 'Busiest week', 'Shifts', 'Paid hours'];
  if (costVisible) columns.push('Cost PHP');
  const rows: string[][] = [];
  for (const s of view.plan?.stores ?? []) {
    const line = (
      dept: string,
      r: Pick<HiringDepartmentRow, 'baseline' | 'season' | 'hires' | 'hiresByType' | 'neededBy' | 'busiestWeek' | 'shifts' | 'paidHours' | 'cost'>,
    ) => {
      const cells = [s.storeName, dept, String(r.baseline), String(r.season), String(r.hires), String(r.hiresByType.FT), String(r.hiresByType.PT), String(r.hiresByType.FLOAT), r.neededBy ?? '', r.busiestWeek ?? '', String(r.shifts), String(r.paidHours)];
      if (costVisible) cells.push(money(r.cost));
      return cells;
    };
    rows.push(line('', s));
    for (const d of s.departments) rows.push(line(d.departmentName, d));
  }
  return buildCsvExport({
    title: `Hiring plan ${view.from} to ${view.to}`,
    generatedAt: header.generatedAt,
    generatedBy: header.generatedBy,
    sampleData: view.provenance.synthetic,
    meta: provenanceMeta(view.provenance, header),
    columns,
    rows,
  });
}

/** CSV of the leadership summary (KPIs, timeline, hires by store). */
export function leadershipSummaryCsv(summary: LeadershipSummary, header: ExportHeader): string {
  const k = summary.hiring?.kpis;
  const costVisible = k?.seasonCost !== undefined;
  const rows: string[][] = [
    ['KPI', 'Seasonal hires', String(k?.seasonalHires ?? '')],
    ['KPI', 'Baseline team', String(k?.baselineTeam ?? '')],
    ['KPI', 'Peak-season team', String(k?.peakTeam ?? '')],
    ['KPI', 'First needed by', k?.firstNeededBy ?? ''],
    ['KPI', 'Offers due', summary.offersDue ?? ''],
    ['KPI', 'Season paid hours', String(k?.seasonPaidHours ?? '')],
  ];
  if (costVisible) rows.push(['KPI', 'Season cost PHP', money(k?.seasonCost)]);
  for (const m of summary.hiring?.timeline ?? []) rows.push(['Timeline', `${m.date} ${m.name} (${m.contractType} x${m.count})`, m.status]);
  for (const s of summary.hiring?.stores ?? []) rows.push(['Hires by store', s.storeName, `${s.hires} on ${s.baseline}`]);
  return buildCsvExport({
    title: `Leadership summary ${summary.provenance.scenarioName}`,
    generatedAt: header.generatedAt,
    generatedBy: header.generatedBy,
    sampleData: summary.sampleData,
    meta: [...provenanceMeta(summary.provenance, header), ['Season', `${summary.from} to ${summary.to}`]],
    columns: ['Section', 'Item', 'Value'],
    rows,
  });
}
