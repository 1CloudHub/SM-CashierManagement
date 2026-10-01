/**
 * LaneWise NFR performance benchmark (NFR-PERF-001…005). Run via `npm run perf`
 * in scripts/perf (see README.md). Prints a markdown table and writes
 * results/latest.json (and a timestamped copy).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiBenchmarks } from './lib/api-bench.js';
import { domainBenchmarks } from './lib/domain-bench.js';
import { matchingBenchmarks } from './lib/matching-bench.js';
import { machineInfo, markdownTable, type Metric } from './lib/metrics.js';
import { now } from './lib/stats.js';

const args = process.argv.slice(2).filter((a) => a !== '--');
const flag = (name: string) => args.includes(`--${name}`);
const num = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? Number(args[i + 1]) : Number.NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
if (flag('help')) {
  console.log(`Usage: npm run perf -- [options]
  --iterations N    timed API requests per endpoint (default 30; --quick 10)
  --warmup N        untimed warm-up requests per endpoint (default 5; --quick 2)
  --domain-runs N   domain/matching runs (default 10; --quick 3)
  --roster-runs N   named-roster domain runs (default 1)
  --job-runs N      hiring-plan job runs (default 3; --quick 1); long-roster job runs once
  --pool-max N      pg pool size per simulated Lambda (default 2, as in production)
  --full            also time named rosters and auto-match on the 27-store network (+2–3 min)
  --skip-domain     skip domain + matching micro-benchmarks
  --skip-api        skip the PostgreSQL-backed API benchmarks
  --quick           fewer iterations (smoke run)
  PERF_DATABASE_URL=postgres://…/postgres  use an existing server instead of embedded PostgreSQL`);
  process.exit(0);
}
const quick = flag('quick');
const opts = {
  iterations: num('iterations', quick ? 10 : 30),
  warmup: num('warmup', quick ? 2 : 5),
  domainRuns: num('domain-runs', quick ? 3 : 10),
  rosterRuns: num('roster-runs', 1),
  jobRuns: num('job-runs', quick ? 1 : 3),
  poolMax: num('pool-max', 2),
};
const log = (s: string) => console.error(`[${((now() - t0) / 1000).toFixed(1)}s] ${s}`);
const t0 = now();

const metrics: Metric[] = [];
let apiInfo: Record<string, unknown> = {};
const machineBefore = machineInfo();
if (!flag('skip-domain')) {
  metrics.push(...(await domainBenchmarks({ runs: opts.domainRuns, rosterRuns: opts.rosterRuns, scaledRoster: flag('full'), log })));
  metrics.push(...(await matchingBenchmarks({ runs: opts.domainRuns, scaledAutoMatch: flag('full'), log })));
}
if (!flag('skip-api')) {
  const r = await apiBenchmarks({ iterations: opts.iterations, warmup: opts.warmup, jobRuns: opts.jobRuns, poolMax: opts.poolMax, log });
  metrics.push(...r.metrics);
  apiInfo = r.info;
}
const totalS = Math.round((now() - t0) / 100) / 10;
const machine = { ...machineBefore, loadAvg1mAtEnd: machineInfo().loadAvg1m };

const order = ['domain', 'matching', 'api', 'jobs', 'setup'];
const sorted = [...metrics].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
const failed = sorted.filter((m) => m.result === 'FAIL');
const header = [
  `## LaneWise performance benchmark — ${new Date().toISOString()}`,
  '',
  `Machine: ${machine.cpuCount} × ${machine.cpuModel}, ${machine.totalMemGiB} GiB, ${machine.os}, Node ${machine.node}; load avg (1 min) ${machine.loadAvg1m} → ${machine.loadAvg1mAtEnd}.`,
  `Options: ${JSON.stringify(opts)}; database: ${String(apiInfo.database ?? 'n/a')}; total ${totalS} s.`,
  'API figures are in-process (router + RBAC enforcer + handlers + PostgreSQL + JSON serialisation); they exclude API Gateway, the Cognito authorizer, Lambda cold starts, network and browser rendering.',
  '',
];
console.log([...header, markdownTable(sorted), '', `${failed.length} target miss(es)${failed.length ? ': ' + failed.map((m) => m.id).join(', ') : ''}.`].join('\n'));

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'results');
mkdirSync(outDir, { recursive: true });
const json = JSON.stringify({ generatedAt: new Date().toISOString(), machine, options: opts, totalSeconds: totalS, api: apiInfo, metrics: sorted }, null, 2);
writeFileSync(join(outDir, 'latest.json'), json);
writeFileSync(join(outDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), json);
log(`wrote ${join(outDir, 'latest.json')}`);
