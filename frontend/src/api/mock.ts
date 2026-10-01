import {
  API_SERVICE_NAME,
  HTTP_STATUS_BY_ERROR_CODE,
  costFigure,
  isRoleCode,
  shapeCost,
  type ApiErrorBody,
  type ApiErrorCode,
  type CostDraft,
  type CostTarget,
  type CostViewer,
  type HealthResponse,
  type RoleCode,
} from '@lanewise/shared'
import { ACTIVE_ROLE_HEADER, type ApiAdapter, type ApiRequest, type ApiResponse } from './client'
import { createPlanningStore } from './mock-planning'
import { createOfferStore } from './mock-offers'
import { createRosterStore } from './mock-rosters'
import { createScenarioStore } from './mock-scenarios'
import { createSavedViewStore, mockContextOptions, mockSearch, type MockResult } from './mock-directory'
import { mockAutoMatch, mockNetworkMap, mockStoreCandidates, parseMockNetworkQuery, type MockNetworkResult } from './mock-network-map'
import type { HomeKpis, HomeScenarioRow, HomeSummary } from './types'

/**
 * In-memory mock of the LaneWise API (VITE_API_MOCK, task 8.2).
 *
 * Serves typed, deterministic sample data so screens can be built before
 * their endpoints exist. Like the real API it reads the active role from
 * `X-Active-Role` and shapes every response for that role: a missing or
 * unknown role is rejected, and a role never receives data it may not see
 * (Staff gets only their own shifts, no ₱). ₱ figures are built with
 * `costFigure` and every response goes through the same `shapeCost` policy
 * as the API (task 21), with each role's demo scope. Figures are the
 * wireframe sample data — simulated, not SM actuals.
 *
 * Add a route per endpoint as feature tasks need them.
 */

interface HandlerContext {
  readonly role: RoleCode
  readonly request: ApiRequest
  readonly query: URLSearchParams
  /** The `:id` segment of a `/collection/:id` route. */
  readonly id: string | null
  readonly savedViews: ReturnType<typeof createSavedViewStore>
}

type Handler = (ctx: HandlerContext) => ApiResponse

const NETWORK: CostTarget = { level: 'network' }

/** The demo scope per role, as the API applies it (Store Manager = the QC store, Staff = self). */
export function mockViewer(role: RoleCode): CostViewer {
  switch (role) {
    case 'STM':
      return { role, scope: { type: 'store', storeIds: ['store-smsm-qc'] } }
    case 'STF':
      return { role, scope: { type: 'self', staffId: 'staff-pt-02' } }
    default:
      return { role, scope: { type: 'global' } }
  }
}

const KPIS: CostDraft<HomeKpis> = {
  seasonalHires: 284,
  fullTime: 176,
  partTime: 108,
  toRecruitMin: 313,
  toRecruitMax: 327,
  firstNeeded: '2026-11-02',
  offersDue: '2026-10-05',
  seasonCost: costFigure(NETWORK, 13_600_000),
}

const RECENT_SCENARIOS: readonly HomeScenarioRow[] = [
  { id: 'scn-xmas-2026-v3', name: 'Christmas 2026 v3', status: 'published', stale: false, updatedAt: '2026-10-01T09:00:00+08:00', ownerName: 'Ana' },
  { id: 'scn-xmas-2026-v4', name: 'Christmas 2026 v4', status: 'submitted', stale: true, updatedAt: '2026-10-03T14:30:00+08:00', ownerName: 'Ana' },
]

const V4 = { scenarioId: 'scn-xmas-2026-v4', scenarioName: 'Christmas 2026 v4' } as const

/** `GET /home` for `role`, shaped by the cost policy (P11, requirement 25). */
export function mockHome(role: RoleCode): HomeSummary {
  return shapeCost<HomeSummary>(mockHomeDraft(role), mockViewer(role))
}

function mockHomeDraft(role: RoleCode): CostDraft<HomeSummary> {
  const firstName = 'Juan'
  switch (role) {
    case 'PLN':
      return {
        role,
        firstName,
        attention: [
          { kind: 'staleScenarios', count: 2 },
          { kind: 'overCapacity', count: 3, date: '2026-12-24' },
          { kind: 'runComplete', ...V4 },
        ],
        deadlines: [
          { date: '2026-10-05', kind: 'sendOffers' },
          { date: '2026-10-12', kind: 'trainingStarts' },
          { date: '2026-11-02', kind: 'firstWave', count: 56 },
        ],
        kpis: KPIS,
        recentScenarios: RECENT_SCENARIOS,
      }
    case 'EXE':
      return {
        role,
        firstName,
        pendingApproval: { ...V4, step: 'plan' },
        publishedPlan: { id: 'scn-xmas-2026-v3', name: 'Christmas 2026 v3' },
        kpis: KPIS,
        recentScenarios: RECENT_SCENARIOS,
      }
    case 'STM':
      return {
        role,
        firstName,
        storeWeek: {
          storeName: 'SM Supermarket – Quezon City',
          departmentName: 'Main checkout lanes',
          unfilledShifts: 2,
          unfilledDate: '2026-12-19',
          failingRuleChecks: 1,
        },
      }
    case 'HR':
      return {
        role,
        firstName,
        pendingApproval: { ...V4, step: 'headcount', headcount: 251 },
        recruiting: { offersDue: '2026-10-05', toRecruitMin: 313, toRecruitMax: 327 },
        kpis: KPIS,
      }
    case 'FIN':
      return {
        role,
        firstName,
        pendingApproval: { ...V4, step: 'budget', seasonCost: costFigure(NETWORK, 13_100_000) },
        costWatch: {
          publishedCost: costFigure(NETWORK, 13_600_000),
          draftCost: costFigure(NETWORK, 13_100_000),
          draftScenarioName: V4.scenarioName,
        },
        kpis: KPIS,
      }
    case 'RST':
      return {
        role,
        firstName,
        dataFreshness: [
          { dataset: 'pos', loadedAt: '2026-09-28T06:00:00+08:00' },
          { dataset: 'staff', loadedAt: null },
        ],
        draftRules: [{ ruleSetId: 'rules-wages', name: 'Wage rates', version: '2026.2' }],
      }
    case 'STF':
      return {
        role,
        firstName,
        nextShifts: {
          storeName: 'SM Supermarket – Quezon City',
          departmentName: 'Main checkout lanes',
          shifts: [
            { start: '2026-12-15T15:00:00+08:00', end: '2026-12-15T19:00:00+08:00', changed: false },
            {
              start: '2026-12-19T12:00:00+08:00',
              end: '2026-12-19T21:00:00+08:00',
              mealStart: '2026-12-19T16:00:00+08:00',
              changed: true,
            },
          ],
        },
      }
    case 'ADM':
      return { role, firstName, pendingInvitations: 3 }
  }
}

const ROUTES: Record<string, Handler> = {
  'GET /health': () =>
    ok({ status: 'ok', service: API_SERVICE_NAME, env: 'mock', time: new Date().toISOString() } satisfies HealthResponse),
  'GET /home': ({ role }) => ok(mockHomeDraft(role)),
  'GET /search': ({ role, query }) => result(mockSearch(role, query.get('q'), query.get('limit'))),
  'GET /context-options': ({ role }) => ok(mockContextOptions(role)),
  'GET /saved-views': ({ query, savedViews }) => result(savedViews.list(query.get('screen'))),
  'POST /saved-views': ({ request, savedViews }) => result(savedViews.create(request.body), 201),
  'PATCH /saved-views/:id': ({ request, id, savedViews }) => result(savedViews.update(id ?? '', request.body)),
  'DELETE /saved-views/:id': ({ id, savedViews }) => result(savedViews.remove(id ?? '')),
  // Network map (task 16.1, 16.4).
  'GET /network-map': ({ role, query }) => network(query, (q) => mockNetworkMap(role, q)),
  'GET /network-map/stores/:id/candidates': ({ role, query, id }) => network(query, (q) => mockStoreCandidates(role, id ?? '', q)),
  'GET /network-map/auto-match': ({ role, query }) => network(query, (q) => mockAutoMatch(role, q)),
}

const NETWORK_ERROR_CODE = { 403: 'forbidden', 404: 'not_found', 422: 'validation_failed' } as const

function network<T>(query: URLSearchParams, run: (q: NonNullable<ReturnType<typeof parseMockNetworkQuery>>) => MockNetworkResult<T>): ApiResponse {
  const q = parseMockNetworkQuery(query)
  if (!q) return fail('validation_failed', 'Check the map filters.')
  const r = run(q)
  return r.ok ? ok(r.body) : fail(NETWORK_ERROR_CODE[r.status], r.message)
}

function ok(body: unknown, status = 200): ApiResponse {
  return { status, body }
}

const MOCK_ERROR_CODE = { 404: 'not_found', 409: 'conflict', 422: 'validation_failed' } as const

function result<T>(r: MockResult<T>, status = 200): ApiResponse {
  return r.ok ? ok(r.body, status) : fail(MOCK_ERROR_CODE[r.status], r.message)
}

/** The route key and `:id` for a path: `/saved-views/view-1` → `/saved-views/:id`. */
function routeOf(method: string, pathname: string): { key: string; id: string | null } {
  const exact = `${method} ${pathname}`
  if (ROUTES[exact]) return { key: exact, id: null }
  const candidates = /^\/network-map\/stores\/([^/]+)\/candidates$/.exec(pathname)
  if (candidates) return { key: `${method} /network-map/stores/:id/candidates`, id: decodeURIComponent(candidates[1] ?? '') }
  const m = /^(\/[a-z-]+)\/([^/]+)$/.exec(pathname)
  if (!m) return { key: exact, id: null }
  return { key: `${method} ${m[1]}/:id`, id: decodeURIComponent(m[2] ?? '') }
}

let requestSeq = 0
function fail(code: ApiErrorCode, message: string): ApiResponse {
  requestSeq += 1
  const body: ApiErrorBody = { error: { code, message, requestId: `mock-${requestSeq.toString(16).padStart(6, '0')}` } }
  return { status: HTTP_STATUS_BY_ERROR_CODE[code], body }
}

function header(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : headers[key]
}

export interface MockAdapterOptions {
  /** Simulated latency in ms (0 in tests). */
  readonly latencyMs?: number
  /** Every request the mock received, for assertions. */
  readonly log?: ApiRequest[]
}

export function createMockAdapter({ latencyMs = 0, log }: MockAdapterOptions = {}): ApiAdapter {
  const savedViews = createSavedViewStore()
  const scenarios = createScenarioStore()
  const planning = createPlanningStore()
  const rosters = createRosterStore()
  const offerStore = createOfferStore(rosters)
  return async (request) => {
    log?.push(request)
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs))
    if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const role = header(request.headers, ACTIVE_ROLE_HEADER)
    if (!isRoleCode(role)) return fail('bad_request', 'The active role is missing or not recognised.')

    const [pathname = '', search = ''] = request.path.split('?', 2)
    // Task 14 planning endpoints under /scenarios/:id/… (already shaped, see ./mock-planning).
    const planned = planning.handle({
      method: request.method,
      pathname,
      query: new URLSearchParams(search),
      body: request.body,
      role,
      viewer: mockViewer(role),
    })
    if (planned) return planned
    if (pathname === '/scenarios' || pathname.startsWith('/scenarios/')) {
      // Already shaped for the role (cost + published-only), see ./mock-scenarios.
      return scenarios.handle({
        method: request.method,
        pathname,
        query: new URLSearchParams(search),
        body: request.body,
        role,
        viewer: mockViewer(role),
      })
    }
    // Task 17 offers (/stores/:id/shifts/:id/offers…, /stores/:id/offers, /me/offers…) and borrow requests, see ./mock-offers.
    const offered = offerStore.handle({
      method: request.method,
      pathname,
      query: new URLSearchParams(search),
      body: request.body,
      role,
      viewer: mockViewer(role),
      userName: `Demo ${role}`,
    })
    if (offered) return offered
    if (/^\/stores\/[^/]+\/rosters(\/|$)/.test(pathname)) {
      // Published rosters carry no ₱ figures (task 13.4), see ./mock-rosters.
      return rosters.handle({ method: request.method, pathname, body: request.body, role, userName: `Demo ${role}` })
    }
    if (pathname === '/approvals' || pathname.startsWith('/approvals/')) {
      // Shares the scenario rows; results are shaped for the role like /scenarios.
      return scenarios.approvals.handle({
        method: request.method,
        pathname,
        query: new URLSearchParams(search),
        body: request.body,
        role,
        viewer: mockViewer(role),
      })
    }
    const { key, id } = routeOf(request.method, pathname)
    const handler = ROUTES[key]
    if (!handler) return fail('not_found', 'We couldn’t find that.')
    const res = handler({ role, request, query: new URLSearchParams(search), id, savedViews })
    // Like the API: strip any ₱ figure the role may not see, on every route.
    return { ...res, body: shapeCost<unknown>(res.body, mockViewer(role)) }
  }
}
