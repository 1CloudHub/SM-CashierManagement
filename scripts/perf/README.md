# LaneWise performance benchmark (NFR-PERF-001 … 005)

A reproducible benchmark of the targets in
[`docs/04-non-functional/01-non-functional-requirements.md`](../../docs/04-non-functional/01-non-functional-requirements.md):

| NFR | Target | Measured here as |
|---|---|---|
| NFR-PERF-001 | Interactive screens (network view, department day plan, roster ≤ 4 weeks) render p95 ≤ 2.0 s, warm cache | Server share only: network-wide reads (PLN/EXE) through the in-process API |
| NFR-PERF-002 | API read p95 ≤ 500 ms within one store's scope | Store-scoped reads (STM / STF), plus single-store candidate lists |
| NFR-PERF-003 | Hiring plan and > 4-week rosters run as background jobs; progress visible within 1 s | `POST …/jobs` → 202 with the queued job (progress 0) and time to first non-zero progress seen by a 25 ms poller |
| NFR-PERF-004 | Full-network hiring plan p95 ≤ 60 s (27-store demo network) | Hiring job request → `succeeded` (demo network = 8 stores), and the domain compute for the demo network and a 27-store clone |
| NFR-PERF-005 | Global search p95 ≤ 800 ms | `GET /search` as PLN, STM and STF with rotating queries |

Also: the DOM-001 domain pipeline (forecast → Erlang C lanes → shifts → hiring plan → named rosters) for the
whole network over the demo season (2026-12-01 … 12-31), and `@lanewise/matching` candidate ranking and
network-wide auto-match — at the demo size and with the demo network cloned to 27 stores.

## Run

Prerequisites (already true in CI/dev checkouts): `api/node_modules` installed (`npm ci` in `api/`) and
`packages/{shared,domain,matching}/dist` built. Nothing else is installed.

```sh
cd scripts/perf
npm run perf                 # full run, ~4–5 min on 4 cores
npm run perf -- --quick      # smoke run (fewer iterations)
npm run perf -- --help       # options: --iterations, --warmup, --domain-runs, --job-runs, --full, --skip-api, --skip-domain …
```

Output: a markdown table on stdout (progress on stderr), and JSON with every sample, machine info
(CPU count/model, Node version, load average) and the options in `results/latest.json` plus a timestamped
`results/run-*.json` (git-ignored).

`PERF_DATABASE_URL=postgres://user:pw@host:5432/postgres npm run perf` uses an existing PostgreSQL server
(admin URL; a throwaway database is created and dropped) instead of the embedded one.

## How it works

- `run.mjs` links `scripts/perf/node_modules` → `api/node_modules` (git-ignored) and runs `bench.ts` with
  the API's own `vite-node`, so the benchmark imports `api/src/*.ts` and the built packages directly —
  no separate install, no copy of product code.
- **Domain / matching** (`lib/domain-bench.ts`, `lib/matching-bench.ts`, no DB): N timed runs after a JIT
  warm-up. Matching inputs are the demo cashiers (consented barangay home areas, a rostered peak week via
  `assignRoster`), the peak-day open shifts and a `FakeTravelTimeProvider` matrix. The 27-store variant
  clones the 8 demo stores round-robin (`lib/network.ts`).
- **API** (`lib/api-bench.ts`): an embedded PostgreSQL 17 (same setup as `api/test/support/global-setup.ts`,
  `fsync=off`), the real migrations, `seedDemoData` (task 23), plus published rosters for every department for
  2026-11-30 … 12-27 (`lib/rosters.ts`; per store, departments alternate between four weekly rosters and one
  4-week roster). Requests go through `createApp` → router → RBAC enforcer (principal resolved from the DB on
  every request) → handler → PostgreSQL, as the seeded demo users (PLN region scope over the whole network,
  STM = SM Supermarket Quezon City, STF = a QC cashier, EXE global), with a pg pool of 2 like the Lambda.
  JSON serialisation of the body is inside the timed region. Each endpoint: 1 probe + 5 warm-up + 30 timed
  requests (the auto-match read is capped at 1 + 5 because it takes seconds).
- **Jobs**: the background worker runs in a separate process (`lib/worker.ts`, the API's real
  `processPlanningJob` with its own pool) fed through a stand-in for SQS, so the CPU-bound job does not block
  the API's event loop. Each hiring-plan run clears the finished job's cache key so the next request
  recomputes (benchmark-only DB update). The first hiring run hits a cold worker process (it builds the
  demo engine context, ~1.5–2 s, as a worker Lambda cold start would) and is reported separately; the
  timed runs use the warm worker. The > 4-week roster job runs once.
- The 27-store named-roster and auto-match timings take minutes, so they only run with `--full`.

## Caveats — read before quoting numbers

- **In-process, not deployed.** API figures are handler + DB + serialisation time. They exclude API Gateway,
  the Cognito authorizer, Lambda cold starts (the first network view in a process also builds the demo
  engine context: ~2–4 s, shown as the "cold" row), network latency to/from Aurora, and browser rendering.
  NFR-PERF-001 is an end-to-end render target; a PASS here only means the server share fits.
- **Embedded PostgreSQL on the same machine** with `fsync=off` — not Aurora Serverless v2; no network hop,
  but it competes with Node for the same cores.
- **Demo size.** The seeded demo network has 8 stores / 24 departments / 344 cashiers; NFR-PERF-004 is sized
  for 27 stores. The 27-store figures are domain-only (CPU) clones, not the API job.
- **Contention.** Results vary with machine load; the load average is recorded in the JSON. Compare runs on
  the same idle machine.
