/**
 * Staff self-service API client (task 18 — requirement 15): the Staff user's
 * own roster (`/me/roster`), their time-off and swap requests (`/me/requests`)
 * and the store manager's Staff requests panel on SCR-022
 * (`/stores/:storeId/staff-requests`).
 *
 * Screens depend on the `SelfServiceClient` interface so tests can pass a
 * fake; the app wires `createSelfServiceClient` over the shared API client
 * (`useApi`), which sends the active role.
 */
import type {
  CreateStaffRequest,
  MyRosterResponse,
  MyStaffRequestDto,
  MyStaffRequestResponse,
  MyStaffRequestsResponse,
  StaffRequestDecision,
  StoreStaffRequestDto,
  StoreStaffRequestResponse,
  StoreStaffRequestsResponse,
  SwapOptionsResponse,
} from '@lanewise/shared'
import type { ApiClient, HttpMethod } from '@/api'

export interface SelfServiceClient {
  roster(window?: { from?: string; to?: string }): Promise<MyRosterResponse>
  requests(): Promise<readonly MyStaffRequestDto[]>
  swapOptions(): Promise<SwapOptionsResponse>
  raise(request: CreateStaffRequest): Promise<MyStaffRequestDto>
  cancel(requestId: string): Promise<MyStaffRequestDto>
  storeRequests(storeId: string): Promise<readonly StoreStaffRequestDto[]>
  decide(storeId: string, requestId: string, decision: StaffRequestDecision): Promise<StoreStaffRequestDto>
}

export function createSelfServiceClient(api: Pick<ApiClient, 'request'>): SelfServiceClient {
  const request = <T,>(method: HttpMethod, path: string, body?: unknown): Promise<T> =>
    api.request<T>(method, path, body !== undefined ? { body } : {})
  const id = encodeURIComponent
  return {
    roster: (window = {}) => {
      const p = new URLSearchParams()
      if (window.from) p.set('from', window.from)
      if (window.to) p.set('to', window.to)
      const qs = p.toString()
      return request<MyRosterResponse>('GET', `/me/roster${qs ? `?${qs}` : ''}`)
    },
    requests: async () => (await request<MyStaffRequestsResponse>('GET', '/me/requests')).requests,
    swapOptions: () => request<SwapOptionsResponse>('GET', '/me/requests/swap-options'),
    raise: async (body) => (await request<MyStaffRequestResponse>('POST', '/me/requests', body)).request,
    cancel: async (requestId) => (await request<MyStaffRequestResponse>('POST', `/me/requests/${id(requestId)}/cancel`)).request,
    storeRequests: async (storeId) => (await request<StoreStaffRequestsResponse>('GET', `/stores/${id(storeId)}/staff-requests`)).requests,
    decide: async (storeId, requestId, decision) =>
      (await request<StoreStaffRequestResponse>('POST', `/stores/${id(storeId)}/staff-requests/${id(requestId)}/decision`, decision)).request,
  }
}
