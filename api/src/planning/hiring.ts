/**
 * Hiring plan (SCR-023), long-roster results and the leadership summary
 * (SCR-024) bodies (task 14.2, 14.3; Req 10.1–10.3, 18.3; P1, P6, P9).
 *
 * Built from a succeeded background job's stored results, limited to the
 * viewer's in-scope stores (every total re-summed from in-scope rows, P1),
 * with the job's pinned inputs as provenance (P6) and every ₱ value a
 * `costFigure` (task 21).
 */
import {
  growthPct,
  hiringKpisFor,
  isStoreInScope,
  milestoneStatus,
  offersDueOf,
  type CostDraft,
  type HiringDepartmentRow,
  type HiringMilestone,
  type HiringPlanView,
  type HiringStoreRow,
  type LeadershipSummary,
  type LongRosterView,
  type PlanningContractType,
  type PlanningJob,
  type PlanningProvenance,
  type Scope,
} from '@lanewise/shared';
import { costFigure } from '../http/cost.js';
import { mergeWaves, type HiringUnitResult, type StoredHiringResults, type StoredRosterResults } from '../jobs/units.js';

type ByType = Record<PlanningContractType, number>;
const TYPES: readonly PlanningContractType[] = ['FT', 'PT', 'FLOAT'];
const sumType = (x: ByType) => x.FT + x.PT + x.FLOAT;
const addTypes = (a: ByType, b: ByType): ByType => ({ FT: a.FT + b.FT, PT: a.PT + b.PT, FLOAT: a.FLOAT + b.FLOAT });

function inScope(scope: Scope | null, row: { storeId: string; regionId: string }): boolean {
  return scope !== null && isStoreInScope(scope, { id: row.storeId, regionId: row.regionId });
}

function argmaxWeek(weekly: Readonly<Record<string, number>>): string | null {
  let best: string | null = null;
  for (const [week, n] of Object.entries(weekly).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (best === null || n > (weekly[best] ?? 0)) best = week;
  }
  return best;
}

function minDate(dates: readonly string[]): string | null {
  return [...dates].sort()[0] ?? null;
}

interface RawHiring {
  readonly stores: (Omit<HiringStoreRow, 'cost' | 'departments'> & { cost: number; departments: (Omit<HiringDepartmentRow, 'cost'> & { cost: number })[] })[];
  readonly timeline: HiringMilestone[];
  readonly waves: { needBy: string; recruitStart: string; storeIds: string[] }[];
  readonly departments: number;
}

/** Hiring results limited to the scope, grouped by store, with the action timeline. */
export function scopedHiring(results: StoredHiringResults, scope: Scope | null, today: string): RawHiring {
  const units = results.departments.filter((d) => inScope(scope, d));
  const waves = mergeWaves(units);
  const needBy = (u: HiringUnitResult) => minDate(waves.filter((w) => w.lines.some((l) => l.departmentId === u.departmentId)).map((w) => w.needBy));
  const weeks = Math.max(1, (Date.parse(results.to) - Date.parse(results.from)) / 86_400_000 + 1) / 7;

  const storeIds: string[] = [];
  for (const u of units) if (!storeIds.includes(u.storeId)) storeIds.push(u.storeId);
  const stores = storeIds.map((storeId) => {
    const own = units.filter((u) => u.storeId === storeId);
    const first = own[0] as HiringUnitResult;
    const departments = own.map((u) => ({
      departmentId: u.departmentId,
      departmentName: u.departmentName,
      baseline: sumType(u.baseline),
      season: sumType(u.season),
      hires: sumType(u.hires),
      hiresByType: u.hires,
      neededBy: needBy(u),
      busiestWeek: argmaxWeek(u.weeklyHeadcount),
      shifts: u.shifts,
      paidHours: u.paidHours,
      cost: u.cost,
      ftAvgWeeklyHours: u.season.FT > 0 ? Math.round((u.ftPaidHours / weeks / u.season.FT) * 10) / 10 : null,
    }));
    const weekly: Record<string, number> = {};
    for (const u of own) for (const [w, n] of Object.entries(u.weeklyHeadcount)) weekly[w] = (weekly[w] ?? 0) + n;
    const hiresByType = own.reduce<ByType>((acc, u) => addTypes(acc, u.hires), { FT: 0, PT: 0, FLOAT: 0 });
    return {
      storeId,
      storeName: first.storeName,
      regionId: first.regionId,
      baseline: departments.reduce((n, d) => n + d.baseline, 0),
      season: departments.reduce((n, d) => n + d.season, 0),
      hires: sumType(hiresByType),
      hiresByType,
      neededBy: minDate(departments.flatMap((d) => (d.neededBy ? [d.neededBy] : []))),
      busiestWeek: argmaxWeek(weekly),
      shifts: departments.reduce((n, d) => n + d.shifts, 0),
      paidHours: departments.reduce((n, d) => n + d.paidHours, 0),
      cost: Math.round(departments.reduce((n, d) => n + d.cost, 0) * 100) / 100,
      departments,
    };
  });

  const timeline: HiringMilestone[] = waves
    .flatMap((w) => {
      const count = w.lines.reduce((n, l) => n + l.count, 0);
      return w.milestones.map((m) => ({
        date: m.date,
        name: m.name,
        contractType: w.contractType,
        count,
        waveId: w.id,
        status: milestoneStatus(m.date, today),
      }));
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.waveId < b.waveId ? -1 : 1));

  return {
    stores,
    timeline,
    waves: waves.map((w) => ({ needBy: w.needBy, recruitStart: w.recruitStart, storeIds: [...new Set(w.lines.map((l) => l.storeId))] })),
    departments: units.length,
  };
}

function storeCost<T extends { storeId: string; regionId: string; cost: number }>(row: T) {
  return costFigure({ level: 'store', store: { id: row.storeId, regionId: row.regionId } }, row.cost);
}

export function buildHiringPlanView(input: {
  readonly scope: Scope | null;
  readonly provenance: PlanningProvenance;
  readonly job: PlanningJob | null;
  readonly from: string;
  readonly to: string;
  readonly results: StoredHiringResults | null;
  readonly today: string;
}): CostDraft<HiringPlanView> {
  if (!input.results) return { provenance: input.provenance, job: input.job, from: input.from, to: input.to, plan: null };
  const raw = scopedHiring(input.results, input.scope, input.today);
  const kpis = hiringKpisFor(raw.stores, raw.waves);
  return {
    provenance: input.provenance,
    job: input.job,
    from: input.results.from,
    to: input.results.to,
    plan: {
      kpis: { ...kpis, seasonCost: costFigure({ level: 'network' }, kpis.seasonCost) },
      timeline: raw.timeline,
      stores: raw.stores.map((s) => ({
        ...s,
        cost: storeCost(s),
        departments: s.departments.map((d) => ({
          ...d,
          cost: costFigure({ level: 'department', store: { id: s.storeId, regionId: s.regionId } }, d.cost),
        })),
      })),
    },
  };
}

export function buildLongRosterView(input: {
  readonly scope: Scope | null;
  readonly provenance: PlanningProvenance;
  readonly job: PlanningJob;
  readonly results: StoredRosterResults | null;
}): CostDraft<LongRosterView> {
  const weeks = input.results
    ? input.results.departments
        .filter((d) => inScope(input.scope, d))
        .flatMap((d) =>
          d.weeks.map((w) => ({
            storeId: d.storeId,
            storeName: d.storeName,
            regionId: d.regionId,
            departmentId: d.departmentId,
            departmentName: d.departmentName,
            ...w,
            cost: costFigure({ level: 'department', store: { id: d.storeId, regionId: d.regionId } }, w.cost),
          })),
        )
    : null;
  return { provenance: input.provenance, job: input.job, weeks };
}

export function buildLeadershipSummary(input: {
  readonly scope: Scope | null;
  readonly provenance: PlanningProvenance;
  readonly season: string;
  readonly from: string;
  readonly to: string;
  readonly generatedAt: string;
  readonly results: StoredHiringResults | null;
  readonly peak: LeadershipSummary['peak'];
}): CostDraft<LeadershipSummary> {
  const today = input.generatedAt.slice(0, 10);
  const raw = input.results ? scopedHiring(input.results, input.scope, today) : null;
  const kpis = raw ? hiringKpisFor(raw.stores, raw.waves) : null;
  return {
    provenance: input.provenance,
    generatedAt: input.generatedAt,
    season: input.season,
    from: input.from,
    to: input.to,
    storeCount: raw?.stores.length ?? 0,
    departmentCount: raw?.departments ?? 0,
    sampleData: input.provenance.synthetic,
    hiring:
      raw && kpis
        ? {
            kpis: { ...kpis, seasonCost: costFigure({ level: 'network' }, kpis.seasonCost) },
            timeline: raw.timeline,
            stores: raw.stores.map((s) => ({ storeId: s.storeId, storeName: s.storeName, baseline: s.baseline, hires: s.hires, neededBy: s.neededBy })),
          }
        : null,
    peak: input.peak,
    offersDue: raw ? offersDueOf(raw.timeline) : null,
  };
}

// ---------------------------------------------------------------------------
// Print-ready leadership summary (A4; Req 10.3, 18.3)
// ---------------------------------------------------------------------------

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
const num = (n: number): string => n.toLocaleString('en-PH');

/**
 * A self-contained, print-ready A4 page (the browser's Print → Save as PDF
 * produces the PDF). Shows the sample-data badge while synthetic data is in
 * use and the scenario's provenance in the footer. Status is text, never
 * colour alone. `summary` is already shaped for the viewer's cost access.
 */
export function leadershipSummaryHtml(summary: LeadershipSummary): string {
  const p = summary.provenance;
  const k = summary.hiring?.kpis;
  const kpi = (label: string, value: string, note = '') =>
    `<div class="kpi"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`;
  const kpis = k
    ? [
        kpi('Seasonal hires', num(k.seasonalHires), TYPES.map((t) => `${num(k.hiresByType[t])} ${t}`).join(' · ')),
        kpi('Peak-season team', num(k.peakTeam), `vs ${num(k.baselineTeam)} today`),
        kpi('First needed', k.firstNeededBy ?? '—', summary.offersDue ? `offers due ${summary.offersDue}` : ''),
        kpi('Season paid hours', num(k.seasonPaidHours)),
        ...(k.seasonCost !== undefined ? [kpi('Season cost', `PHP ${num(Math.round(k.seasonCost))}`)] : []),
      ].join('')
    : '<p>No hiring plan has been calculated for this scenario yet.</p>';
  const timeline = (summary.hiring?.timeline ?? [])
    .map((m) => `<tr><td>${esc(m.date)}</td><td>${esc(m.name)} (${esc(m.contractType)}, ${num(m.count)})</td><td>${esc(m.status.replace('_', ' '))}</td></tr>`)
    .join('');
  const stores = (summary.hiring?.stores ?? [])
    .map((s) => `<tr><td>${esc(s.storeName)}</td><td class="n">${num(s.baseline)}</td><td class="n">${num(s.hires)}</td><td class="n">${growthPct(s.baseline, s.hires)}%</td><td>${esc(s.neededBy ?? '—')}</td></tr>`)
    .join('');
  const bottom = k
    ? `About ${num(k.seasonalHires)} seasonal cashiers on top of a team of ${num(k.baselineTeam)} (+${growthPct(k.baselineTeam, k.seasonalHires)}%).${summary.offersDue ? ` Offers need to go out by ${summary.offersDue}.` : ''}`
    : 'Run the hiring plan to complete this summary.';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(p.scenarioName)} — leadership summary</title>
<style>
@page { size: A4; margin: 15mm; }
body { font-family: system-ui, sans-serif; font-size: 10pt; color: black; background: white; margin: 0; }
h1 { font-size: 16pt; margin: 0 0 2mm; } h2 { font-size: 11pt; margin: 5mm 0 2mm; }
.badge { display: inline-block; border: 2px solid black; padding: 1mm 2mm; font-weight: bold; }
.kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 2mm; }
.kpi { border: 2px solid black; padding: 2mm; } .label { font-size: 8pt; } .value { font-size: 14pt; font-weight: bold; } .note { font-size: 8pt; }
table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid black; padding: 1mm; text-align: left; } .n { text-align: right; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; } footer { margin-top: 5mm; font-size: 8pt; }
</style></head><body>
${summary.sampleData ? '<p class="badge">SAMPLE DATA — Illustrative: figures are simulated, not SM actuals.</p>' : ''}
<h1>${esc(p.scenarioName)}: cashier hiring plan</h1>
<p>${num(summary.storeCount)} stores · ${num(summary.departmentCount)} checkout departments · Season ${esc(summary.from)} to ${esc(summary.to)}</p>
<p><strong>Bottom line:</strong> ${esc(bottom)}</p>
<section class="kpis">${kpis}</section>
<div class="cols">
<section><h2>When: action timeline</h2><table><thead><tr><th>Date</th><th>Action</th><th>Status</th></tr></thead><tbody>${timeline}</tbody></table></section>
<section><h2>Where: hires by store</h2><table><thead><tr><th>Store</th><th class="n">Team today</th><th class="n">Hires</th><th class="n">Growth</th><th>First needed</th></tr></thead><tbody>${stores}</tbody></table></section>
</div>
${summary.peak ? `<p>Network peak: ${num(summary.peak.lanesOpen)} cashiers on lanes at ${summary.peak.hour}:00 on ${esc(summary.peak.date)}.</p>` : ''}
<footer>Generated ${esc(summary.generatedAt)} from scenario ${esc(p.scenarioName)} (${esc(p.scenarioStatus)}) · run ${esc(p.runId ?? 'none')} · rules ${esc(p.ruleVersionIds.join(' '))} · snapshots ${esc(Object.values(p.snapshotIds).join(' '))}${p.synthetic ? ' · SAMPLE DATA' : ''}</footer>
</body></html>
`;
}
