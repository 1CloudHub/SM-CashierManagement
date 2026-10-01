/**
 * Scenarios API client (task 11): `/scenarios`.
 *
 * Screens depend on the `ScenariosClient` interface so they can be rendered
 * with a fake in tests; the app wires `createScenariosClient` over the shared
 * API client (`useApi`, task 8.2), which sends the active role.
 */
import type {
  ScenarioComparison,
  ScenarioDetail,
  ScenarioListItem,
  ScenarioSettingsValues,
  ScenarioStatus,
} from '@lanewise/shared'
import { ApiError, type ApiClient, type HttpMethod } from '@/api'

export interface ScenarioListQuery {
  readonly status?: ScenarioStatus | ''
  readonly season?: string
  readonly stale?: boolean
  readonly q?: string
  /** `me` — only scenarios the caller owns. */
  readonly owner?: 'me' | ''
}

export interface ScenariosClient {
  list(query?: ScenarioListQuery, init?: { signal?: AbortSignal }): Promise<readonly ScenarioListItem[]>
  create(input: { name: string; season: string; settings?: ScenarioSettingsValues }): Promise<ScenarioDetail>
  get(id: string): Promise<ScenarioDetail>
  update(id: string, input: { name?: string; settings?: ScenarioSettingsValues }): Promise<ScenarioDetail>
  duplicate(id: string, name?: string): Promise<ScenarioDetail>
  refresh(id: string): Promise<ScenarioDetail>
  run(id: string): Promise<ScenarioDetail>
  submit(id: string): Promise<ScenarioDetail>
  archive(id: string): Promise<ScenarioDetail>
  compare(a: string, b: string): Promise<ScenarioComparison>
}

/** Query string for `GET /scenarios` (empty filters are left out). */
export function listQueryString(query: ScenarioListQuery = {}): string {
  const p = new URLSearchParams()
  if (query.status) p.set('status', query.status)
  if (query.season) p.set('season', query.season)
  if (query.stale) p.set('stale', 'true')
  if (query.q?.trim()) p.set('q', query.q.trim())
  if (query.owner) p.set('owner', query.owner)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function createScenariosClient(api: Pick<ApiClient, 'request'>): ScenariosClient {
  const request = <T,>(method: HttpMethod, path: string, body?: unknown): Promise<T> =>
    api.request<T>(method, path, body !== undefined ? { body } : {})
  const id = encodeURIComponent
  const one = async (method: HttpMethod, path: string, body?: unknown) =>
    (await request<{ scenario: ScenarioDetail }>(method, path, body)).scenario
  return {
    list: async (query, init) =>
      (await api.request<{ scenarios: ScenarioListItem[] }>('GET', `/scenarios${listQueryString(query)}`, init?.signal ? { signal: init.signal } : {}))
        .scenarios,
    create: (input) => one('POST', '/scenarios', input),
    get: (sid) => one('GET', `/scenarios/${id(sid)}`),
    update: (sid, input) => one('PATCH', `/scenarios/${id(sid)}`, input),
    duplicate: (sid, name) => one('POST', `/scenarios/${id(sid)}/duplicate`, name ? { name } : {}),
    refresh: (sid) => one('POST', `/scenarios/${id(sid)}/refresh`, {}),
    run: (sid) => one('POST', `/scenarios/${id(sid)}/run`, {}),
    submit: (sid) => one('POST', `/scenarios/${id(sid)}/submit`, {}),
    archive: (sid) => one('POST', `/scenarios/${id(sid)}/archive`, {}),
    compare: (a, b) => request('GET', `/scenarios/compare?a=${id(a)}&b=${id(b)}`),
  }
}

/** The API error code of a failed call (`conflict`, `validation_failed`, …), if any. */
export function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : ((error as { code?: string } | null)?.code ?? null)
}

export function errorReference(error: unknown): string | undefined {
  return error instanceof ApiError ? (error.requestId ?? undefined) : undefined
}
