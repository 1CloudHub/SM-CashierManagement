---
id: VER-001
title: End-to-end verification (task 25)
version: 0.1.0
status: Draft
owner: TBD
last_updated: 2026-10-01
related: [NFR-001, DOM-001, TS-002, SEC-002, DEP-002]
---

# End-to-end verification (task 25)

> **Purpose:** Records how LaneWise was verified against journeys J1–J11, correctness properties P1–P19, the DOM-001 parity suite and the NFR performance targets, with the results, the bugs fixed along the way and the gaps left as follow-ups.

Verified on branch `feat/task-25-e2e-verification`. That branch is `main` (through #47, task 18) plus the open branches `fix/ui-data-rules-review` (#44) and `feat/admin-screens` (#45). Run date: 2026-10-01.

## How to reproduce

| What | Command | Notes |
|---|---|---|
| Unit + property suites | `npm test` in `packages/shared`, `packages/domain`, `packages/matching`, `api`, `frontend`, `infra` | Build `packages/shared`, `domain`, `matching` first. The API suites start an embedded PostgreSQL 17. |
| API journeys | `cd api && npx vitest run test/journeys` | Seeds the task 23 demo network once per file. Runs the real router and RBAC enforcer. Cognito is a fake directory. |
| SPA journeys (Playwright) | `cd frontend && npm run test:e2e` | Starts `vite` with `VITE_API_MOCK=true` and the demo role switcher, then runs headless Chromium. Projects: `laptop` (1440×900) and `phone` (Pixel 7). On a fresh machine run `npx playwright install --with-deps chromium` once. |
| Parity suite | `cd packages/domain && npx vitest run test/parity.test.ts test/erlang.test.ts` | DOM-001 fixtures A–C. |
| Performance | `cd scripts/perf && npm run perf` (`--quick`, `--full`) | Writes a markdown table and `scripts/perf/results/latest.json`. See `scripts/perf/README.md`. |

**Mock-mode note.** The SPA journeys run against the in-page mock API, so they verify the UI flows, role and scope visibility, and accessibility. The API journeys verify the same journeys against the real routes and database. The two layers complement each other; neither replaces a walkthrough of the deployed app with real sign-in, which needs credentials and was out of scope here (see Deployed smoke).

## Results summary

| Area | Result |
|---|---|
| Unit + property tests | **1,638 passed, 0 failed.** shared 187, domain 82, matching 46, api 436 (including 52 journey tests), frontend 794, infra 93. Lint, build and `cdk synth` are also clean. |
| SPA journeys J1–J11 + access matrix | **49 passed, 8 `fixme`, 0 failed.** 3.2 min with 2 workers. axe WCAG 2.2 A/AA is clean on every step. |
| API journeys J1–J11 | **52 passed** in 6 files, about 30 s. |
| Properties P1–P19 | Every property has at least one fast-check suite, and all pass (see Traceability). |
| DOM-001 parity | **28 / 28 within tolerance.** |
| NFR performance | **All enforced targets pass except one.** NFR-PERF-003 for the >4-week roster job: first progress arrives at 3.4 s against a 1 s target. |
| Deployed smoke | API `/health` returns 200 and protected routes return 401 without a token. The SPA host was **not reachable** from the verification environment (egress policy), so it was not checked. |

## Journeys by role

The SPA specs are in `frontend/e2e/journeys/`. The API tests are in `api/test/journeys/`. ✅ means passed; ⏸ means `test.fixme` (the step isn't supported yet; see Gaps).

| Journey | Roles exercised | SPA (Playwright) | API (real routes) | Properties asserted |
|---|---|---|---|---|
| J1 Headcount, budget and plan approval | PLN, HR, FIN, EXE; STF, STM, RST, ADM denied | ✅ 4/4 | ✅ 7/7 | P3, P4, P5, P7, P10, P12 |
| J2 Planner refreshes a plan | PLN, HR, FIN, STM; STF denied | ✅ 3/3 | ✅ (in j02-j06) | P4, P5, P8 |
| J3 Lane-capacity pressure | PLN, STM, FIN, RST; STF, ADM denied | ✅ 4/4 | ✅ (in j03-j05) | P1, P2, cost visibility (Req 25) |
| J4 Emergency off | STM (laptop and phone); STF denied | ✅ 4/5, ⏸ 1 | ✅ (in j04-j10) | P1, P7, P14 |
| J5 HR recruiting timeline | HR, STM; STF denied | ✅ 2/4, ⏸ 2 | ✅ (in j03-j05) | P1, P7 (export audit) |
| J6 Wage order publication | RST, FIN, PLN, EXE, HR; STM, STF, ADM denied | ✅ 1/3, ⏸ 2 | ✅ (in j02-j06) | P5, P6, P7 |
| J7 First sign-in with a passkey | anonymous | ✅ 3/4, ⏸ 1 | covered by `pre-sign-up.test.ts` | P13 |
| J8 Staff checks their roster | STM → STF (laptop and phone) | ✅ 3/3 | ✅ (in j08-j11) | P11 |
| J9 Admin assigns a role | ADM; PLN, RST denied | ✅ 2/3, ⏸ 1 | ✅ 7/7 | P7, P12, P13 |
| J10 Cover an open shift | STM, STF, PLN | ✅ 4/4 | ✅ (in j04-j10) | P1, P11, P15, P16, P17 |
| J11 Time-off / swap request | STF → STM → STF | ✅ 1/2, ⏸ 1 | ✅ (in j08-j11) | P7, P19 |
| Access matrix (all 8 roles × 21 screens + nav) | ADM EXE PLN STM HR FIN RST STF | ✅ 17/17 | `auth/properties.test.ts` | P12 (Req 2.3, 2.4) |

`e2e/access.spec.ts` checks each role against the design's RBAC matrix. The matrix is written out in the test, not imported from the route table. For each role, every screen it may open renders, and every other screen renders "No access" without revealing the object.

## Property traceability (P1–P19)

Every property has at least one property-based (fast-check) test. The table lists them, plus the example and journey tests that also assert the property.

| Property | Property-based suites | Also asserted by |
|---|---|---|
| P1 Scope isolation | `packages/shared/test/roles-and-scope.test.ts`, `admin.test.ts`; `api/test/auth/properties.test.ts`, `routes/network-map.test.ts`, `routes/admin.test.ts`, `search/search.test.ts`; `frontend/src/features/search/search.test.tsx` | API j03-j05, j04-j10; e2e J3, J4, J5, J10 |
| P2 Prototype parity | `packages/shared/test/planning-views.test.ts`; `api/test/routes/planning.test.ts` | `packages/domain/test/parity.test.ts` (golden, DOM-001) |
| P3 Single published plan | `api/test/routes/scenarios.test.ts` | `api/test/db/schema-invariants.test.ts`; API j01; e2e J1 |
| P4 Read-only published | `packages/shared/test/scenario-and-approval.test.ts`; `api/test/routes/scenarios.test.ts` | API j01, j02-j06; e2e J1, J2 |
| P5 Stale correctness | `packages/shared/test/scenario-planning.test.ts`; `api/test/ingestion/staleness.test.ts`, `routes/ingestion.test.ts` | API j02-j06; e2e J1, J2 |
| P6 Rule versioning | `packages/domain/test/cost.test.ts`; `api/test/db/rule-versions.test.ts`, `routes/scenarios.test.ts`, `routes/rules.test.ts` | parity suite; API j02-j06 |
| P7 Audit completeness | `api/test/db/p7-audit-completeness.test.ts`, `routes/approvals.test.ts`, `routes/admin.test.ts`, `routes/planning.test.ts`, `search/saved-views.test.ts` | every API journey (`audited()` checks exactly one event); e2e J9 |
| P8 Filter round-trip | `packages/shared/test/view-state.test.ts`; `frontend/src/features/context/context-view.test.ts` | e2e J2 (reload reproduces filters) |
| P9 Provenance | `packages/shared/test/ingestion-and-export.test.ts`; `api/test/routes/ingestion.test.ts`, `routes/planning.test.ts` | "Sample data" banner on every e2e screen |
| P10 Approval sequencing | `packages/shared/test/approvals.test.ts`, `scenario-and-approval.test.ts`; `api/test/routes/approvals.test.ts` | API j01; e2e J1 |
| P11 Staff self-scope | `packages/shared/test/roles-and-scope.test.ts`, `cost.test.ts`, `search.test.ts`, `staff-self-service.test.ts`; `api/test/auth/cost-visibility.test.ts`, `routes/staff-self-service.test.ts`, `routes/offers.test.ts`; `frontend/src/api/client.test.ts` | API j08-j11; e2e J8 |
| P12 Active-role enforcement | `api/test/auth/properties.test.ts`, `routes/rules.test.ts`, `routes/scenarios.test.ts`; `packages/shared/test/approvals.test.ts`; `frontend/src/api/client.test.ts` | API j01, j09; e2e access matrix |
| P13 Domain restriction | `packages/shared/test/auth.test.ts`, `admin.test.ts`; `api/test/pre-sign-up.test.ts`, `routes/admin.test.ts` | API j09; e2e J7 |
| P14 Override traceability | `packages/shared/test/roster.test.ts`; `api/test/rosters/overrides.test.ts`, `routes/rosters.test.ts`; `frontend/src/api/mock-rosters.test.ts` | API j04-j10; e2e J4 |
| P15 Location privacy | `packages/shared/test/location-privacy.test.ts`; `packages/matching/test/*.test.ts`; `api/test/db/p15-location-privacy.test.ts`, `routes/network-map.test.ts`; `frontend/src/features/location-privacy/location-privacy.test.tsx` | e2e J10 |
| P16 Offer eligibility | `packages/matching/test/matching.test.ts`, `auto-match.test.ts`; `api/test/routes/offers.test.ts` | API j04-j10; e2e J10 |
| P17 Single acceptance | `packages/shared/test/offers.test.ts`; `api/test/routes/offers.test.ts` | API j04-j10; e2e J10 |
| P18 Demo data isolation | `api/test/db/p18-demo-isolation.test.ts`, `routes/ingestion.test.ts`; `packages/shared/test/provenance-and-api.test.ts` | `api/test/db/demo-seed.test.ts` |
| P19 Requests don't change the roster | `api/test/routes/staff-self-service.test.ts` | `packages/shared/test/staff-self-service.test.ts`; API j08-j11; e2e J11 |

## DOM-001 parity suite

Source: `packages/domain/test/parity.test.ts` and `erlang.test.ts`. Tolerance is from DOM-001 "Parity tolerance": integers exact, λ to 4 dp, cost ±0.5 %, and roster parity on the shift set and hours.

| Fixture | Checks | Result |
|---|---|---|
| A — Erlang C worked example | c = 11–15: utilisation and P(wait) to 2 dp, wait ±10 %, % served; 13 cashiers for 90 % within 60 s | ✅ 7/7 exact |
| B — Demo dataset shape | 47,548 hourly rows; 8 stores / 4 formats / 24 departments; 16 columns; understaffing pattern 19 % → 59 %; deterministic seed | ✅ 4/4 |
| C — Scenario outputs | QC main Dec 19: 3,863 transactions, 19 cashiers at peak; Network Dec 19: 254 on lanes, 555 cashiers (314 FT · 188 PT · 53 float), 3,688 paid hours, cost ≈ ₱322,000 (±0.5 %); Pampanga 46; Christmas Eve over-capacity; part-time saving | ✅ 8/8 (integers exact, cost within ±0.5 %) |
| Invariants (24 departments × 9 dates) | single-department view = all-stores view (P2); no hour short, meals in window; rule versioning (P6); golden master | ✅ 4/4 |

Caveat (carried over from the suite header): the original prototype v3 snapshot is not in the repository. The fixtures pin the rebuild to v3's published figures, using a reconstructed snapshot calibrated from DOM-001.

## NFR performance (demo network)

Run with `scripts/perf` on a 4 × Xeon 2.8 GHz machine (Node 22, embedded PostgreSQL 17, pg pool 2). API figures are **in-process**: router + RBAC enforcer + handler + PostgreSQL + JSON. They exclude API Gateway, the Cognito authorizer, Lambda cold starts, network latency and browser rendering. The seeded demo network is 8 stores / 24 departments / 344 cashiers. NFR-PERF-004 names 27 stores, so the domain run is also measured on a 27-store clone.

| Target | Measured (p95) | Result |
|---|---|---|
| NFR-PERF-001 network view (warm) ≤ 2 s | 14.1 ms (cold first request 1.0 s) | ✅ server share |
| NFR-PERF-001 hiring plan view / leadership summary ≤ 2 s | 18.7 ms / 23.9 ms | ✅ |
| NFR-PERF-002 store-scoped reads ≤ 500 ms | network view (STM) 13.1 ms; department day plan 11.0 ms; weekly roster 33.9 ms; 4-week roster 24.7 ms; My roster 8.1 ms; network map (STM) 20.4 ms; candidates for one store 127–158 ms; hiring plan (STM) 14.7 ms | ✅ |
| NFR-PERF-003 hiring-plan job: accepted, progress visible ≤ 1 s | accepted 10.2 ms; first progress 46 ms (warm worker), 1.35 s (cold worker) | ✅ warm |
| NFR-PERF-003 >4-week roster job: progress ≤ 1 s | accepted 12.6 ms (queued, 0 %); **first non-zero progress 3.4 s** | ❌ |
| NFR-PERF-004 full-network hiring plan ≤ 60 s | job end to end 212 ms (8 stores); domain compute 107 ms (8 stores), 348 ms (27-store clone) | ✅ |
| NFR-PERF-005 global search ≤ 800 ms | PLN 5.7 ms, STM 4.4 ms, STF 0.9 ms | ✅ |

Informational, no NFR attached:

| Measurement | Result |
|---|---|
| Network-wide auto-match (8 stores) | 2.7 s p95 through the API |
| Auto-match on the 27-store clone | about 56 s |
| Named roster assignment for one network-month | 12.7 s |
| Demo context build (once per process) | 1.9 s |

## Deployed smoke (read-only, no sign-in)

| Check | Result |
|---|---|
| `GET https://7c3ae2uwyj.execute-api.us-east-1.amazonaws.com/prod/health` | ✅ 200 `{"status":"ok","service":"lanewise-api","env":"prod"}`, 1.55 s from the test environment |
| No token on `GET /me`, `/stores`, `/scenarios`, `/me/roster`, `/admin/users`, `/audit-events`, `/network-map`, `POST /scenarios` | ✅ 401 `{"message":"Unauthorized"}` on every route (API Gateway Cognito authorizer) |
| `GET https://lanewise.prototypes.1cloudhub.com/`, its assets, `/runtime-config.json`, SPA deep-link fallback | ⚠️ Not verified. The verification environment's egress policy refuses this host (proxy 403), so the request never reached CloudFront. Re-run `curl -I` on `/`, an asset, `/runtime-config.json` and a deep link from a network that allows the host. |

No sign-in was attempted, no account was created, and no credentials were used.

## Bugs fixed during verification

| Area | Fix |
|---|---|
| shared | `CreateStaffRequest` was exported by both master data and self-service, so the shared package failed to build once both branches merged. The master-data type is now `CreateStaffRecordRequest`. |
| api (demo) | None of the seeded rule-version payloads passed the rule API's validation, so "New draft" from a seeded version answered 422 and blocked J6. |
| api (auth) | The demo role switcher defaults named a store code and cashier the seed doesn't create (`smsm-qc`, `PT-02`). As a result, Store Manager had an empty scope and Staff had no cashier, including on the deployed demo. |
| frontend (a11y) | Overflowing table wrappers were not keyboard-focusable (axe `scrollable-region-focusable`). |
| frontend (a11y) | The stacked over-capacity links were under the 24 px target size (axe `target-size`). |
| frontend (P1/P12) | After a demo role switch, an open screen kept the previous role's rows. The API client is now re-created on a switch, so loaders refetch. |
| frontend (mock) | The context bar's scenario picker served a fixed list that disagreed with the scenario store, so a duplicated draft fell back to the published plan (J2). |
| frontend | Home's over-capacity alert opened the network view on the default date instead of the alert's date (J3). |
| frontend (style) | Removed the remaining `border-2` / `border-b-2` / `border-t-2` (1px borders only). The Store Manager scope line now reads "1 store". |
| tests | De-flaked the P12 property for routes with a child path id. Repaired two unit tests broken by merging the stacked branches. Vite no longer watches Playwright output (it was full-reloading pages mid-journey). |

## Known gaps and follow-ups

1. **NFR-PERF-003, long roster job.** Progress moves only per finished department, so the first tick comes after about 3.4 s. Fix: report progress within a unit (per week or day), or make `assignRoster` incremental (see 2).
2. **`assignRoster` cost** (`packages/domain/src/roster.ts`). It re-checks the labor rules over each person's whole period for every candidate shift, costing about 13 s per network-month; this will grow at 27 stores. Fix: an incremental check on neighbouring days and the same week.
3. **Auto-match does not scale** (`packages/matching/src/auto-match.ts`). It augments one unit at a time with a Bellman-Ford pass per unit: 2.7 s at 8 stores, about 56 s at 27 stores. The latter would exceed API Gateway's 29 s limit on the synchronous `GET /network-map/auto-match`. Fix: Dijkstra with potentials, decompose by date/window/department, or move it to a background job.
4. **Cold-start demo context build** (about 1.4–1.9 s). This would break NFR-PERF-003 on a cold worker Lambda. Fix: precompute, or cache models with the snapshot.
5. **No rules mock.** In mock mode SCR-060/061 show "We couldn't load the rule sets", so the J6 SPA flow is `fixme`. The J6 API journey passes. Needs a `mock-rules.ts`.
6. **Week grid shows one shift per cashier per day** (`adapt.gridRows`). A replacement who already works that day gets the shift saved but not shown (J4 `fixme`).
7. **Hiring plan Region/Format filters** change only the URL; the hiring-plan request sends no filter (J5 `fixme`).
8. **HR import of new hires** (J5) needs `data_ingestion` manage, which only RST holds. The spec journey and the RBAC matrix disagree and need a decision.
9. **SCR-061 roles.** The route table and wireframe give the rule editor to ADM, but the RBAC matrix and the server don't (the API refuses). EXE, PLN and HR see "View" on SCR-060 but get No access on the editor. Needs a spec/wireframe decision.
10. **Mock data consistency** (mock mode only):
    - the roster mock and the map mock scope the Store Manager to different stores;
    - mock offer eligibility ignores the roster (P16 holds in the API, not in the mock);
    - Home's Dec 24 over-capacity count (3) differs from the network view (2);
    - HR's "due within 7 days" notification has no matching milestone;
    - `MOCK_SCENARIOS` in search still uses the static list.
11. **Not automatable without real Cognito:**
    - the passkey ceremony (J7);
    - "next sign-in shows the role" (J9).

    Neither the mock nor the API raises a notification on a role change (J9).
12. **24-hour-rest block on a swap** isn't reachable with the single demo Staff persona in the SPA (J11 `fixme`). It is covered in the API journey.
13. **Demo cashiers can't get accounts via the Admin API.** Their `@demo.local` emails are refused by P13. There is also no API to publish a weekly roster. The API journeys set both up with SQL.
14. **Deployed SPA smoke** to be re-run from an allowed network (see above).
15. **CI wiring for e2e.** Not added to `buildspec-pr.yml`. The suite takes 3.2 min with 2 workers on 4 vCPU. The PR project is SMALL compute (2 vCPU), and installing Chromium with system deps (`npx playwright install --with-deps chromium`) adds 1–2 min, so the job would exceed the ~5 min budget. Recommended: a separate parallel CodeBuild action on MEDIUM compute running `cd frontend && npx playwright install --with-deps chromium && CI=true npm run test:e2e`, publishing `frontend/e2e-results/junit.xml`.
16. **Manual accessibility testing** (screen reader, keyboard on the roster grids and the heatmap alternative) is still required for full WCAG 2.2 AA conformance (NFR-A11Y-001). axe covers automated rules only.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-10-01 | Claude | Initial verification report for task 25 |
