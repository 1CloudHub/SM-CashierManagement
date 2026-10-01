/**
 * Planning API client (task 14): network view, department day plan, hiring
 * plan and long-roster jobs, leadership summary — all under
 * `/scenarios/:scenarioId/…`.
 *
 * Screens depend on the `PlanningClient` interface so tests can render them
 * with a fake; the app wires `createPlanningClient` over the shared API
 * client (`useApi`, task 8.2), which sends the active role.
 */
import type {
  DepartmentDayView,
  FileDownload,
  HiringPlanView,
  LeadershipSummary,
  LongRosterView,
  NetworkView,
  PlanningJob,
  ScenarioListItem,
} from '@lanewise/shared'
import type { ApiClient, HttpMethod } from '@/api'

export interface NetworkQuery {
  readonly date?: string
  readonly region?: string
  readonly format?: string
  readonly store?: string
  readonly dept?: string
}

export interface JobRequestResult {
  readonly job: PlanningJob
  /** An identical job (same scenario version) already existed. */
  readonly cached: boolean
}

export interface PlanningClient {
  /** Scenarios the role may open (Store Managers: published only). */
  scenarios(): Promise<readonly ScenarioListItem[]>
  network(scenarioId: string, query?: NetworkQuery): Promise<NetworkView>
  exportNetwork(scenarioId: string, query?: NetworkQuery): Promise<FileDownload>
  departmentDay(scenarioId: string, departmentId: string, date?: string): Promise<DepartmentDayView>
  exportDepartmentDay(scenarioId: string, departmentId: string, date?: string): Promise<FileDownload>
  hiringPlan(scenarioId: string): Promise<HiringPlanView>
  runHiringPlan(scenarioId: string): Promise<JobRequestResult>
  hiringJob(scenarioId: string, jobId: string): Promise<PlanningJob>
  exportHiringPlan(scenarioId: string): Promise<FileDownload>
  runLongRoster(scenarioId: string, input: { from: string; to: string; departmentId?: string }): Promise<JobRequestResult>
  longRoster(scenarioId: string, jobId: string): Promise<LongRosterView>
  summary(scenarioId: string): Promise<LeadershipSummary>
  exportSummary(scenarioId: string, format: 'csv' | 'html'): Promise<FileDownload>
}

/** `?a=1&b=2` from the defined, non-empty values (empty string when none). */
export function queryString(values: Readonly<Record<string, string | undefined>>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(values)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function createPlanningClient(api: Pick<ApiClient, 'request'>): PlanningClient {
  const request = <T,>(method: HttpMethod, path: string, body?: unknown): Promise<T> =>
    api.request<T>(method, path, body !== undefined ? { body } : {})
  const id = encodeURIComponent
  const base = (sid: string) => `/scenarios/${id(sid)}`
  const network = (q: NetworkQuery = {}) => queryString({ date: q.date, region: q.region, format: q.format, store: q.store, dept: q.dept })
  return {
    scenarios: async () => (await request<{ scenarios: ScenarioListItem[] }>('GET', '/scenarios')).scenarios,
    network: async (sid, q) => (await request<{ view: NetworkView }>('GET', `${base(sid)}/network${network(q)}`)).view,
    exportNetwork: (sid, q) => request('GET', `${base(sid)}/network/export${network(q)}`),
    departmentDay: async (sid, did, date) =>
      (await request<{ view: DepartmentDayView }>('GET', `${base(sid)}/departments/${id(did)}/day${queryString({ date })}`)).view,
    exportDepartmentDay: (sid, did, date) => request('GET', `${base(sid)}/departments/${id(did)}/day/export${queryString({ date })}`),
    hiringPlan: async (sid) => (await request<{ view: HiringPlanView }>('GET', `${base(sid)}/hiring-plan`)).view,
    runHiringPlan: (sid) => request('POST', `${base(sid)}/hiring-plan/jobs`, {}),
    hiringJob: async (sid, jid) => (await request<{ job: PlanningJob }>('GET', `${base(sid)}/hiring-plan/jobs/${id(jid)}`)).job,
    exportHiringPlan: (sid) => request('GET', `${base(sid)}/hiring-plan/export`),
    runLongRoster: (sid, input) => request('POST', `${base(sid)}/rosters/jobs`, input),
    longRoster: async (sid, jid) => (await request<{ view: LongRosterView }>('GET', `${base(sid)}/rosters/jobs/${id(jid)}`)).view,
    summary: async (sid) => (await request<{ summary: LeadershipSummary }>('GET', `${base(sid)}/summary`)).summary,
    exportSummary: (sid, format) => request('GET', `${base(sid)}/summary/export${queryString({ format })}`),
  }
}
