import {
  assertNoFineLocation,
  type BarangayRef,
  type BarangaySearchResponse,
  type ConsentLocale,
  type ConsentPurpose,
  type ConsentStatus,
  type MyConsentsResponse,
  type MyHomeAreaResponse,
  type SetHomeAreaRequest,
  type StaffHomeAreaResponse,
} from '@lanewise/shared'
import type { ApiClient, HttpMethod } from '@/api'

/**
 * Port to the location-privacy API (task 15; requirement 12, P15). Screens
 * depend on this interface, so tests and the component gallery can pass a
 * fake; `createApiLocationPrivacyClient` is the real implementation.
 */
export interface LocationPrivacyClient {
  getMyConsents(locale: ConsentLocale): Promise<MyConsentsResponse>
  grantConsent(purpose: ConsentPurpose, version: number, locale: ConsentLocale): Promise<ConsentStatus>
  withdrawConsent(purpose: ConsentPurpose): Promise<ConsentStatus>
  getMyHomeArea(): Promise<MyHomeAreaResponse>
  setMyHomeArea(input: SetHomeAreaRequest): Promise<MyHomeAreaResponse>
  clearMyHomeArea(): Promise<MyHomeAreaResponse>
  searchBarangays(query: string): Promise<BarangayRef[]>
  getStaffHomeArea(staffId: string): Promise<StaffHomeAreaResponse>
}

/**
 * The real client, over the app's API client (task 8.2): every request
 * carries the active role (`X-Active-Role`) and the ID token, and failures
 * surface as `ApiError` with the server's error code.
 */
export function createApiLocationPrivacyClient(api: ApiClient): LocationPrivacyClient {
  async function request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const json = await api.request<unknown>(method, path, body === undefined ? {} : { body })
    // Defence in depth for P15: refuse to render anything finer than barangay.
    return assertNoFineLocation(json) as T
  }

  return {
    getMyConsents: (locale) => request('GET', `/me/consents?locale=${encodeURIComponent(locale)}`),
    grantConsent: (purpose, version, locale) => request('POST', '/me/consents', { purpose, version, locale }),
    withdrawConsent: (purpose) => request('DELETE', `/me/consents/${encodeURIComponent(purpose)}`),
    getMyHomeArea: () => request('GET', '/me/home-area'),
    setMyHomeArea: (input) =>
      request('PUT', '/me/home-area', {
        barangayCode: input.barangayCode,
        maxTravelMin: input.maxTravelMin,
        crossStoreOffers: input.crossStoreOffers,
      }),
    clearMyHomeArea: () => request('DELETE', '/me/home-area'),
    searchBarangays: async (query) =>
      (await request<BarangaySearchResponse>('GET', `/me/home-area/barangays?q=${encodeURIComponent(query)}`)).barangays.slice(),
    getStaffHomeArea: (staffId) => request('GET', `/staff/${encodeURIComponent(staffId)}/home-area`),
  }
}
