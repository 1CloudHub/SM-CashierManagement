/**
 * Network map API port (task 16.1, 16.4 — SCR-026; requirement 11, 12).
 *
 * Screens depend on `NetworkMapApi`, never on `fetch`, so tests and the mock
 * adapter can stand in. `networkMapApiFromClient` builds it on the shared API
 * client (Cognito token + `X-Active-Role`, task 8.1/8.2). Every response is
 * re-checked with the P15 guard before it reaches a component: nothing finer
 * than a barangay (store sites aside) is ever rendered.
 *
 * Store gaps/surplus come from the API's `NetworkGapsSource` — published-roster
 * open shifts today, the network view (task 14) later; this port does not
 * change when task 14 lands.
 */
import {
  assertNetworkMapPrivacy,
  type AutoMatchResponse,
  type NetworkMapQuery,
  type NetworkMapResponse,
  type StoreCandidatesResponse,
} from '@lanewise/shared'
import type { ApiClient } from '@/api'

export interface NetworkMapApi {
  getMap(query: NetworkMapQuery, signal?: AbortSignal): Promise<NetworkMapResponse>
  getCandidates(storeId: string, query: NetworkMapQuery, signal?: AbortSignal): Promise<StoreCandidatesResponse>
  /** A proposal for review only: the API creates and sends nothing. */
  getAutoMatch(query: NetworkMapQuery, signal?: AbortSignal): Promise<AutoMatchResponse>
}

/** `?date=…&dayPart=…` for a query (formats comma-separated; omitted when empty). */
export function networkMapSearch(query: NetworkMapQuery): string {
  const p = new URLSearchParams({
    date: query.date,
    dayPart: query.dayPart,
    mode: query.mode,
    maxTravelMin: String(query.maxTravelMin),
  })
  if (query.department) p.set('department', query.department)
  if (query.formats && query.formats.length > 0) p.set('formats', query.formats.join(','))
  return p.toString()
}

export function networkMapApiFromClient(client: ApiClient): NetworkMapApi {
  return {
    getMap: async (query, signal) =>
      assertNetworkMapPrivacy(await client.request<NetworkMapResponse>('GET', `/network-map?${networkMapSearch(query)}`, { signal })),
    getCandidates: async (storeId, query, signal) =>
      assertNetworkMapPrivacy(
        await client.request<StoreCandidatesResponse>(
          'GET',
          `/network-map/stores/${encodeURIComponent(storeId)}/candidates?${networkMapSearch(query)}`,
          { signal },
        ),
      ),
    getAutoMatch: async (query, signal) =>
      assertNetworkMapPrivacy(await client.request<AutoMatchResponse>('GET', `/network-map/auto-match?${networkMapSearch(query)}`, { signal })),
  }
}
