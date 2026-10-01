/**
 * Domain micro-benchmarks (no DB): the DOM-001 pipeline for the whole demo
 * network over the demo season — forecast → Erlang C lanes → shifts (planSeason),
 * team sizing + hiring plan, peak network day, and named roster assignment —
 * at the demo size (8 stores / 24 departments) and scaled to 27 stores.
 */
import { assignRoster, buildHiringPlan, dateRange, planNetworkDay, planSeason, sizeTeams, type Shift } from '@lanewise/domain';
import { DEMO_PLAN_FROM, DEMO_PLAN_TO } from '../../../api/src/db/demo/dataset.js';
import { metric, type Metric } from './metrics.js';
import { baseNetwork, scaledNetwork, type NetworkFixture } from './network.js';
import { now, timed } from './stats.js';

const PEAK_DAY = '2026-12-19';

interface StageTimes {
  season: number;
  hiring: number;
  peak: number;
  roster: number;
  total: number;
  departmentDays: number;
  shifts: number;
}

function runPipeline(net: NetworkFixture, from: string, to: string, withRoster: boolean): StageTimes {
  const { ctx } = net;
  const t0 = now();
  const season = planSeason(ctx, from, to);
  const t1 = now();
  sizeTeams(season.departmentDays, ctx.rules.hiring);
  buildHiringPlan(season.departmentDays, [], ctx.rules.hiring);
  const t2 = now();
  planNetworkDay(ctx, PEAK_DAY);
  const t3 = now();
  const byDept = new Map<string, Shift[]>();
  for (const p of season.departmentDays) {
    const list = byDept.get(p.departmentId) ?? [];
    list.push(...p.shifts);
    byDept.set(p.departmentId, list);
  }
  let shifts = 0;
  for (const [deptId, list] of byDept) {
    shifts += list.length;
    if (withRoster) assignRoster({ shifts: list, staff: net.staff.filter((s) => s.departmentId === deptId), rules: ctx.rules.labor });
  }
  const t4 = now();
  return { season: t1 - t0, hiring: t2 - t1, peak: t3 - t2, roster: t4 - t3, total: t4 - t0, departmentDays: season.departmentDays.length, shifts };
}

export async function domainBenchmarks(opts: { runs: number; rosterRuns: number; scaledRoster: boolean; log: (s: string) => void }): Promise<Metric[]> {
  const out: Metric[] = [];
  const build = await timed(() => baseNetwork());
  out.push(
    metric(
      { id: 'domain.context_build', group: 'domain', name: 'Demo context build (POS history generation + model learning), once per process', notes: 'one-off; the API memoises it' },
      [build.ms],
    ),
  );
  const days = dateRange(DEMO_PLAN_FROM, DEMO_PLAN_TO).length;

  for (const stores of [undefined, 27] as const) {
    const net = scaledNetwork(stores);
    const label = `${net.storeCount} stores / ${net.ctx.departments.length} depts × ${days} days`;
    opts.log(`domain: planning pipeline ${label} × ${opts.runs}`);
    runPipeline(net, DEMO_PLAN_FROM, DEMO_PLAN_TO, false); // warm-up (JIT)
    const runs: StageTimes[] = [];
    for (let i = 0; i < opts.runs; i += 1) runs.push(runPipeline(net, DEMO_PLAN_FROM, DEMO_PLAN_TO, false));
    const r0 = runs[0]!;
    const key = stores ? `scaled${stores}` : 'demo';
    const ctxNote = `${r0.departmentDays} dept-days, ${r0.shifts} shifts, ${net.staff.length} staff`;
    out.push(
      metric({ id: `domain.${key}.season`, group: 'domain', name: `Season plan (forecast → lanes → shifts), ${label}`, notes: ctxNote }, runs.map((r) => r.season)),
      metric({ id: `domain.${key}.hiring`, group: 'domain', name: `Team sizing + hiring plan, ${label}` }, runs.map((r) => r.hiring)),
      metric({ id: `domain.${key}.peak`, group: 'domain', name: `Peak network day (planNetworkDay), ${net.storeCount} stores` }, runs.map((r) => r.peak)),
      metric(
        {
          id: `domain.${key}.hiring_plan_compute`,
          group: 'domain',
          name: `Full-network hiring plan compute (season + hiring), ${label}`,
          target: { nfr: 'NFR-PERF-004', stat: 'p95', maxMs: 60_000 },
          notes: stores ? 'demo network cloned to the NFR’s 27 stores; CPU only, no DB' : 'CPU only, no DB',
        },
        runs.map((r) => r.season + r.hiring),
      ),
    );
    if (stores && !opts.scaledRoster) continue;
    // Named roster assignment is far slower (see README): fewer runs.
    opts.log(`domain: roster assignment ${label} × ${opts.rosterRuns}`);
    const rr: StageTimes[] = [];
    for (let i = 0; i < opts.rosterRuns; i += 1) rr.push(runPipeline(net, DEMO_PLAN_FROM, DEMO_PLAN_TO, true));
    out.push(
      metric({ id: `domain.${key}.roster`, group: 'domain', name: `Named roster assignment (assignRoster, every dept), ${label}`, notes: ctxNote }, rr.map((r) => r.roster)),
      metric({ id: `domain.${key}.scenario_run`, group: 'domain', name: `Full scenario pipeline (season + hiring + peak day + rosters), ${label}` }, rr.map((r) => r.total)),
    );
  }
  return out;
}
