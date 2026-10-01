/**
 * API benchmarks: the real router + RBAC enforcer + handlers + repositories
 * against an embedded PostgreSQL seeded with the task 23 demo network
 * (plus published rosters, ./rosters.ts), called in-process as the seeded
 * demo users. Measures handler + DB (+ JSON serialisation) time; NOT API
 * Gateway, the Cognito authorizer, Lambda cold starts or network.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dateRange } from '@lanewise/domain';
import type { RoleCode } from '@lanewise/shared';
import { createApp } from '../../../api/src/app.js';
import { DEFAULT_RBAC_CONFIG } from '../../../api/src/auth/config.js';
import { DEMO_PLAN_FROM, DEMO_PLAN_TO, demoId, demoUserId } from '../../../api/src/db/demo/dataset.js';
import { seedDemoData } from '../../../api/src/db/demo/seed.js';
import { errors } from '../../../api/src/http/errors.js';
import type { Router } from '../../../api/src/http/router.js';
import type { JobQueue } from '../../../api/src/jobs/queue.js';
import { startDatabase } from './db.js';
import { dispatch, type Response } from './dispatch.js';
import { metric, type Metric, type Target } from './metrics.js';
import { ROSTER_FROM, seedRosters } from './rosters.js';
import { now, sleep, timed } from './stats.js';

const PEAK = '2026-12-19';
const NFR1: Target = { nfr: 'NFR-PERF-001', stat: 'p95', maxMs: 2000 };
const NFR2: Target = { nfr: 'NFR-PERF-002', stat: 'p95', maxMs: 500 };
const NFR3: Target = { nfr: 'NFR-PERF-003', stat: 'p95', maxMs: 1000 };
const NFR4: Target = { nfr: 'NFR-PERF-004', stat: 'p95', maxMs: 60_000 };
const NFR5: Target = { nfr: 'NFR-PERF-005', stat: 'p95', maxMs: 800 };

export interface ApiBenchOptions {
  readonly iterations: number;
  readonly warmup: number;
  readonly jobRuns: number;
  /** Pool size per "Lambda" (production API uses 2, api/src/app.ts). */
  readonly poolMax: number;
  readonly log: (s: string) => void;
}

interface Endpoint {
  readonly id: string;
  readonly name: string;
  readonly role: RoleCode;
  /** Path + query per iteration (lets a benchmark rotate inputs). */
  readonly request: (i: number) => { path: string; query?: Record<string, string> };
  /** Caps iterations/warm-up for very slow endpoints (keeps the run under ~5 min). */
  readonly maxIterations?: number;
  readonly target?: Target;
  readonly reference?: string;
}

export async function apiBenchmarks(opts: ApiBenchOptions): Promise<{ metrics: Metric[]; info: Record<string, unknown> }> {
  const metrics: Metric[] = [];
  const info: Record<string, unknown> = {};
  const { log } = opts;

  log('api: starting PostgreSQL + migrations');
  const started = await timed(() => startDatabase({ poolMax: opts.poolMax }));
  const db = started.value;
  info.database = db.kind;
  metrics.push(metric({ id: 'setup.db', group: 'setup', name: `Start ${db.kind} PostgreSQL + create DB + migrate` }, [started.ms]));
  // The worker is a separate Lambda in AWS: run it in its own process with its own pool.
  const here = dirname(fileURLToPath(import.meta.url));
  const child = spawn(process.execPath, [join(here, '..', 'node_modules', 'vite-node', 'vite-node.mjs'), '--config', join(here, '..', 'vite.config.mjs'), join(here, 'worker.ts'), '--', db.url], {
    cwd: join(here, '..'),
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const waiters = new Map<string, (outcome: string) => void>();
  let ready: () => void = () => undefined;
  const readyP = new Promise<void>((r) => (ready = r));
  createInterface({ input: child.stdout! }).on('line', (line) => {
    if (line === '@@ready') ready();
    const m = /^@@done (\S+) (.*)$/.exec(line);
    if (m) {
      waiters.get(m[1]!)?.(m[2]!);
      waiters.delete(m[1]!);
    }
  });
  try {
    log('api: seeding demo data');
    const seeded = await timed(() => seedDemoData(db.pool));
    metrics.push(metric({ id: 'setup.seed', group: 'setup', name: 'seedDemoData (demo network, 8 stores)' }, [seeded.ms]));
    const rosters = await timed(() => seedRosters(db.pool));
    metrics.push(
      metric(
        { id: 'setup.rosters', group: 'setup', name: 'Seed published rosters (all depts, 4 weeks)', notes: `${rosters.value.length} rosters, ${rosters.value.reduce((n, r) => n + r.shifts, 0)} shifts` },
        [rosters.ms],
      ),
    );

    // Background jobs: like SQS, the request returns 202 and the worker process runs the job.
    await readyP;
    const pending = new Set<Promise<unknown>>();
    const jobErrors: string[] = [];
    const queue: JobQueue = {
      async enqueue(message) {
        const p = new Promise<string>((resolve) => waiters.set(message.jobId, resolve)).then((outcome) => {
          if (outcome !== 'succeeded') jobErrors.push(`${message.jobId}: ${outcome}`);
          pending.delete(p);
        });
        pending.add(p);
        child.stdin!.write(`${message.jobId}\n`);
      },
    };
    const app: Router = createApp({
      db: () => db.pool,
      rbac: DEFAULT_RBAC_CONFIG,
      storage: () => {
        throw errors.serviceUnavailable();
      },
      jobs: () => queue,
      emailSender: () => null,
    });

    const { rows: users } = await db.pool.query<{ id: string; email: string }>('SELECT id, email FROM app_user');
    const email = (role: RoleCode) => users.find((u) => u.id === demoUserId(role))?.email ?? '';
    const call = (role: RoleCode, method: string, path: string, query?: Record<string, string>, body?: unknown): Promise<Response> =>
      dispatch(app, method, path, { email: email(role), role, ...(query ? { query } : {}), ...(body !== undefined ? { body } : {}) });

    const scenarioId = demoId('scenario', 'christmas-2026');
    const qc = demoId('store', 'smsm-qc');
    const qcRosters = rosters.value.filter((r) => r.storeId === qc);
    const weekly = qcRosters.find((r) => r.from === '2026-12-14' && r.to === '2026-12-20') ?? qcRosters[0]!;
    const fourWeek = qcRosters.find((r) => r.from === ROSTER_FROM && r.to > '2026-12-20') ?? qcRosters[0]!;
    const qcDept = [...qcRosters].sort((a, b) => b.shifts - a.shifts)[0]!.departmentId;
    const dates = dateRange(DEMO_PLAN_FROM, DEMO_PLAN_TO);
    const mapQ = { date: PEAK, dayPart: 'evening', mode: 'car', maxTravelMin: '60' };
    const searches = ['quezon', 'santos', 'christmas', 'main', 'sm', 'cebu', 'reyes', 'hyper'];
    info.ids = { scenarioId, qcStoreId: qc, qcDepartmentId: qcDept, weeklyRosterId: weekly.id, weeklyRosterShifts: weekly.shifts, fourWeekRosterId: fourWeek.id, fourWeekRosterShifts: fourWeek.shifts };

    // Cold first request (empty engine-context and day caches in this process).
    const cold = await timed(() => call('PLN', 'GET', `/scenarios/${scenarioId}/network`, { date: PEAK }));
    metrics.push(
      metric(
        { id: 'api.network_view.cold', group: 'api', name: 'Network view, first request in the process (PLN, 8 stores) — cold engine cache', reference: 'NFR-PERF-001 is warm-cache', notes: `HTTP ${cold.value.status}` },
        [cold.ms],
      ),
    );

    const endpoints: Endpoint[] = [
      { id: 'api.network_view.pln', name: 'Network view (PLN, whole demo network, warm)', role: 'PLN', request: () => ({ path: `/scenarios/${scenarioId}/network`, query: { date: PEAK } }), target: NFR1 },
      {
        id: 'api.network_view.pln_rotating',
        name: 'Network view (PLN), rotating all 31 season dates — day-cache misses',
        role: 'PLN',
        request: (i) => ({ path: `/scenarios/${scenarioId}/network`, query: { date: dates[i % dates.length]! } }),
        reference: 'NFR-PERF-001 2 s',
      },
      { id: 'api.network_view.stm', name: 'Network view (STM, own store)', role: 'STM', request: () => ({ path: `/scenarios/${scenarioId}/network`, query: { date: PEAK } }), target: NFR2 },
      { id: 'api.department_day.stm', name: 'Department day plan (STM, own store)', role: 'STM', request: () => ({ path: `/scenarios/${scenarioId}/departments/${qcDept}/day`, query: { date: PEAK } }), target: NFR2 },
      {
        id: 'api.department_day.stm_rotating',
        name: 'Department day plan (STM), rotating season dates',
        role: 'STM',
        request: (i) => ({ path: `/scenarios/${scenarioId}/departments/${qcDept}/day`, query: { date: dates[i % dates.length]! } }),
        target: NFR2,
      },
      { id: 'api.rosters.list.stm', name: 'Store roster list (STM)', role: 'STM', request: () => ({ path: `/stores/${qc}/rosters` }), target: NFR2 },
      { id: 'api.rosters.week.stm', name: `Store weekly roster (STM, ${weekly.shifts} shifts)`, role: 'STM', request: () => ({ path: `/stores/${qc}/rosters/${weekly.id}` }), target: NFR2 },
      { id: 'api.rosters.4week.stm', name: `Store 4-week roster (STM, ${fourWeek.shifts} shifts)`, role: 'STM', request: () => ({ path: `/stores/${qc}/rosters/${fourWeek.id}` }), target: NFR2 },
      { id: 'api.me_roster.stf', name: 'My roster, 4 weeks (STF)', role: 'STF', request: () => ({ path: '/me/roster', query: { from: ROSTER_FROM, to: '2026-12-27' } }), target: NFR2 },
      { id: 'api.network_map.pln', name: 'Network map (PLN, whole network)', role: 'PLN', request: () => ({ path: '/network-map', query: mapQ }), reference: 'NFR-PERF-002 500 ms (network-wide)' },
      { id: 'api.network_map.stm', name: 'Network map (STM, own store)', role: 'STM', request: () => ({ path: '/network-map', query: mapQ }), target: NFR2 },
      { id: 'api.candidates.pln', name: 'Network map candidates for one store (PLN)', role: 'PLN', request: () => ({ path: `/network-map/stores/${qc}/candidates`, query: mapQ }), target: NFR2 },
      { id: 'api.candidates.stm', name: 'Network map candidates for own store (STM)', role: 'STM', request: () => ({ path: `/network-map/stores/${qc}/candidates`, query: mapQ }), target: NFR2 },
      { id: 'api.auto_match.pln', name: 'Network-wide auto-match proposal (PLN)', role: 'PLN', request: () => ({ path: '/network-map/auto-match', query: mapQ }), maxIterations: 5, reference: 'NFR-PERF-002 500 ms (network-wide)' },
      { id: 'api.search.pln', name: 'Global search (PLN, rotating queries)', role: 'PLN', request: (i) => ({ path: '/search', query: { q: searches[i % searches.length]! } }), target: NFR5 },
      { id: 'api.search.stm', name: 'Global search (STM, rotating queries)', role: 'STM', request: (i) => ({ path: '/search', query: { q: searches[i % searches.length]! } }), target: NFR5 },
      { id: 'api.search.stf', name: 'Global search (STF, rotating queries)', role: 'STF', request: (i) => ({ path: '/search', query: { q: searches[i % searches.length]! } }), target: NFR5 },
    ];

    for (const ep of endpoints) {
      log(`api: ${ep.id}`);
      const first = ep.request(0);
      const probe = await call(ep.role, 'GET', first.path, first.query);
      if (probe.status !== 200) {
        metrics.push(metric({ id: ep.id, group: 'api', name: ep.name, reference: 'not measured', notes: `HTTP ${probe.status}: ${JSON.stringify(probe.body).slice(0, 160)}` }, []));
        continue;
      }
      const iterations = Math.min(opts.iterations, ep.maxIterations ?? Infinity);
      for (let i = 0; i < Math.min(opts.warmup, ep.maxIterations ? 1 : Infinity); i += 1) {
        const r = ep.request(i + 1);
        await call(ep.role, 'GET', r.path, r.query);
      }
      const samples: number[] = [];
      let bytes = 0;
      for (let i = 0; i < iterations; i += 1) {
        const r = ep.request(i);
        const t0 = now();
        const res = await call(ep.role, 'GET', r.path, r.query);
        samples.push(now() - t0);
        bytes = Math.max(bytes, res.bytes);
        if (res.status !== 200) throw new Error(`${ep.id}: HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
      }
      metrics.push(metric({ id: ep.id, group: 'api', name: ep.name, target: ep.target ?? null, reference: ep.reference, notes: `response ≈ ${Math.round(bytes / 1024)} KiB JSON` }, samples));
    }

    // --- Background jobs (NFR-PERF-003 / 004) --------------------------------
    for (const job of [
      { kind: 'hiring', path: `/scenarios/${scenarioId}/hiring-plan/jobs`, body: {} as Record<string, string>, label: 'Hiring plan job (full demo network, Dec 1–31)', runs: opts.jobRuns },
      { kind: 'roster', path: `/scenarios/${scenarioId}/rosters/jobs`, body: { from: DEMO_PLAN_FROM, to: DEMO_PLAN_TO }, label: 'Long roster job (>4 weeks: all depts, Dec 1–31)', runs: 1 },
    ] as const) {
      const accept: number[] = [];
      const firstProgress: number[] = [];
      const complete: number[] = [];
      const polls: number[] = [];
      let units = 0;
      let failure: string | null = null;
      // The first hiring run hits a cold worker process (it builds the demo engine context, like a
      // worker Lambda cold start); it is reported separately and not counted against the targets.
      const coldRun = job.kind === 'hiring';
      const cold: { firstProgress: number[]; complete: number[] } = { firstProgress: [], complete: [] };
      const totalRuns = job.runs + (coldRun ? 1 : 0);
      for (let run = 0; run < totalRuns && failure === null; run += 1) {
        const isCold = coldRun && run === 0;
        log(`api: ${job.kind} job run ${run + 1}/${totalRuns}${isCold ? ' (cold worker)' : ''}`);
        const t0 = now();
        const res = await call('PLN', 'POST', job.path, undefined, job.body);
        if (!isCold) accept.push(now() - t0);
        if (res.status !== 202) {
          failure = `POST HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`;
          break;
        }
        const jobId: string = res.body.job.id;
        let seenProgress = false;
        for (;;) {
          const p0 = now();
          const g = await call('PLN', 'GET', `${job.path}/${jobId}`);
          if (!isCold) polls.push(now() - p0);
          const j = g.body?.job ?? g.body?.view?.job;
          const status: string = j?.status ?? 'unknown';
          if (!seenProgress && (j?.unitsDone > 0 || j?.progress > 0)) {
            seenProgress = true;
            (isCold ? cold.firstProgress : firstProgress).push(now() - t0);
          }
          if (status === 'succeeded') {
            (isCold ? cold.complete : complete).push(now() - t0);
            units = j.unitsTotal;
            break;
          }
          if (status === 'failed' || g.status !== 200 || now() - t0 > 300_000) {
            failure = `job ${status} (HTTP ${g.status}) ${j?.errorMessage ?? ''} ${jobErrors.join('; ')}`;
            break;
          }
          await sleep(25);
        }
        await Promise.all([...pending]);
        // Free the job's cache key so the next run computes again (benchmark-only).
        await db.pool.query('UPDATE scenario_run SET idempotency_key = NULL WHERE id = $1', [jobId]);
      }
      const notes = failure ?? `${units} department units (progress moves per finished department), polled every 25 ms`;
      metrics.push(
        metric({ id: `jobs.${job.kind}.accept`, group: 'jobs', name: `${job.label}: request accepted (202, queued job + progress 0 returned)`, target: NFR3 }, accept),
        metric({ id: `jobs.${job.kind}.first_progress`, group: 'jobs', name: `${job.label}: first non-zero progress visible to the poller`, target: NFR3, notes }, firstProgress),
        metric(
          {
            id: `jobs.${job.kind}.complete`,
            group: 'jobs',
            name: `${job.label}: request → succeeded`,
            ...(job.kind === 'hiring' ? { target: NFR4, notes: 'demo network is 8 stores / 24 depts; the NFR sizes 27 stores' } : { reference: 'background; no limit' }),
          },
          complete,
        ),
        ...(coldRun
          ? [
              metric({ id: `jobs.${job.kind}.cold.first_progress`, group: 'jobs' as const, name: `${job.label}: first progress, cold worker process (engine context build)`, reference: 'NFR-PERF-003 1 s' }, cold.firstProgress),
              metric({ id: `jobs.${job.kind}.cold.complete`, group: 'jobs' as const, name: `${job.label}: request → succeeded, cold worker process`, reference: 'NFR-PERF-004 60 s' }, cold.complete),
            ]
          : []),
        metric({ id: `jobs.${job.kind}.poll`, group: 'jobs', name: `${job.label}: status poll GET while the worker runs`, reference: 'NFR-PERF-002 500 ms' }, polls),
      );
    }

    // Reads that depend on a finished hiring job.
    for (const ep of [
      { id: 'api.hiring_plan.pln', name: 'Hiring plan view (PLN, network)', role: 'PLN' as RoleCode, path: `/scenarios/${scenarioId}/hiring-plan`, target: NFR1 },
      { id: 'api.hiring_plan.stm', name: 'Hiring plan view (STM, own store)', role: 'STM' as RoleCode, path: `/scenarios/${scenarioId}/hiring-plan`, target: NFR2 },
      { id: 'api.summary.exe', name: 'Leadership summary (EXE)', role: 'EXE' as RoleCode, path: `/scenarios/${scenarioId}/summary`, target: NFR1 },
    ]) {
      log(`api: ${ep.id}`);
      const probe = await call(ep.role, 'GET', ep.path);
      if (probe.status !== 200) {
        metrics.push(metric({ id: ep.id, group: 'api', name: ep.name, reference: 'not measured', notes: `HTTP ${probe.status}` }, []));
        continue;
      }
      for (let i = 0; i < opts.warmup; i += 1) await call(ep.role, 'GET', ep.path);
      const samples: number[] = [];
      for (let i = 0; i < opts.iterations; i += 1) {
        const t0 = now();
        await call(ep.role, 'GET', ep.path);
        samples.push(now() - t0);
      }
      metrics.push(metric({ id: ep.id, group: 'api', name: ep.name, target: ep.target, notes: `response ≈ ${Math.round(probe.bytes / 1024)} KiB JSON` }, samples));
    }
    if (jobErrors.length) info.jobErrors = jobErrors;
  } finally {
    child.stdin!.end();
    await new Promise((r) => child.once('exit', r));
    await db.dispose();
  }
  return { metrics, info };
}
