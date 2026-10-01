/**
 * Roster API client (task 13.4): `/stores/:storeId/rosters` — published
 * rosters, ranked replacements, the live rule check and store-manager
 * overrides.
 *
 * Screens depend on the `RosterClient` interface so they can be rendered with
 * a fake in tests; the app wires `createRosterClient` over the shared API
 * client (`useApi`, task 8.2), which sends the active role.
 */
import type {
  OverrideCheck,
  OverrideCheckResponse,
  ReplacementCandidate,
  ReplacementListResponse,
  RosterDetail,
  RosterListResponse,
  RosterSummary,
  ShiftOverrideRequest,
  ShiftOverrideResponse,
} from '@lanewise/shared'
import type { ApiClient, HttpMethod } from '@/api'

export interface RosterClient {
  list(storeId: string): Promise<readonly RosterSummary[]>
  get(storeId: string, rosterId: string): Promise<RosterDetail>
  replacements(storeId: string, rosterId: string, shiftId: string): Promise<readonly ReplacementCandidate[]>
  check(storeId: string, rosterId: string, change: ShiftOverrideRequest): Promise<OverrideCheck>
  override(storeId: string, rosterId: string, change: ShiftOverrideRequest): Promise<ShiftOverrideResponse>
}

export function createRosterClient(api: Pick<ApiClient, 'request'>): RosterClient {
  const request = <T,>(method: HttpMethod, path: string, body?: unknown): Promise<T> =>
    api.request<T>(method, path, body !== undefined ? { body } : {})
  const id = encodeURIComponent
  const base = (storeId: string, rosterId: string) => `/stores/${id(storeId)}/rosters/${id(rosterId)}`
  return {
    list: async (storeId) => (await request<RosterListResponse>('GET', `/stores/${id(storeId)}/rosters`)).rosters,
    get: (storeId, rosterId) => request<RosterDetail>('GET', base(storeId, rosterId)),
    replacements: async (storeId, rosterId, shiftId) =>
      (await request<ReplacementListResponse>('GET', `${base(storeId, rosterId)}/shifts/${id(shiftId)}/replacements`)).candidates,
    check: async (storeId, rosterId, change) =>
      (await request<OverrideCheckResponse>('POST', `${base(storeId, rosterId)}/overrides/check`, change)).check,
    override: (storeId, rosterId, change) => request<ShiftOverrideResponse>('POST', `${base(storeId, rosterId)}/overrides`, change),
  }
}
