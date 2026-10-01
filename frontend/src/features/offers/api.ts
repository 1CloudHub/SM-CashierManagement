/**
 * Shift offers and borrowing API client (task 17 — requirements 13, 14,
 * 15.2): offer candidates and broadcasts for an open shift, offer status,
 * the Staff user's own offers (accept / decline) and store-to-store borrow
 * requests.
 *
 * Screens depend on the `OffersClient` interface so tests can pass a fake;
 * the app wires `createOffersClient` over the shared API client (`useApi`),
 * which sends the active role.
 */
import type {
  BorrowDecisionRequest,
  BorrowRequestDto,
  BorrowRequestResponse,
  BorrowRequestsResponse,
  CreateBorrowRequest,
  LendCandidate,
  LendCandidatesResponse,
  MapTravelMode,
  MyOfferDto,
  MyOfferResponse,
  MyOffersResponse,
  OfferCandidatesResponse,
  SendOffersRequest,
  ShiftOfferDto,
  ShiftOffersResponse,
} from '@lanewise/shared'
import type { ApiClient, HttpMethod } from '@/api'

export interface OffersClient {
  candidates(storeId: string, shiftId: string, travel?: { mode: MapTravelMode; maxTravelMin: number }): Promise<OfferCandidatesResponse>
  send(storeId: string, shiftId: string, request: SendOffersRequest): Promise<readonly ShiftOfferDto[]>
  storeOffers(storeId: string, filter?: { rosterId?: string; shiftId?: string }): Promise<readonly ShiftOfferDto[]>
  myOffers(): Promise<readonly MyOfferDto[]>
  accept(offerId: string): Promise<MyOfferDto>
  decline(offerId: string): Promise<MyOfferDto>
  borrowRequests(storeId: string): Promise<BorrowRequestsResponse>
  requestBorrow(storeId: string, request: CreateBorrowRequest): Promise<BorrowRequestDto>
  lendCandidates(lendingStoreId: string, requestId: string): Promise<readonly LendCandidate[]>
  decide(lendingStoreId: string, requestId: string, decision: BorrowDecisionRequest): Promise<BorrowRequestDto>
}

export function createOffersClient(api: Pick<ApiClient, 'request'>): OffersClient {
  const request = <T,>(method: HttpMethod, path: string, body?: unknown): Promise<T> =>
    api.request<T>(method, path, body !== undefined ? { body } : {})
  const id = encodeURIComponent
  const qs = (params: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined) p.set(k, String(v))
    const s = p.toString()
    return s ? `?${s}` : ''
  }
  return {
    candidates: (storeId, shiftId, travel) =>
      request<OfferCandidatesResponse>('GET', `/stores/${id(storeId)}/shifts/${id(shiftId)}/offer-candidates${qs({ ...travel })}`),
    send: async (storeId, shiftId, body) => (await request<ShiftOffersResponse>('POST', `/stores/${id(storeId)}/shifts/${id(shiftId)}/offers`, body)).offers,
    storeOffers: async (storeId, filter = {}) => (await request<ShiftOffersResponse>('GET', `/stores/${id(storeId)}/offers${qs(filter)}`)).offers,
    myOffers: async () => (await request<MyOffersResponse>('GET', '/me/offers')).offers,
    accept: async (offerId) => (await request<MyOfferResponse>('POST', `/me/offers/${id(offerId)}/accept`)).offer,
    decline: async (offerId) => (await request<MyOfferResponse>('POST', `/me/offers/${id(offerId)}/decline`)).offer,
    borrowRequests: (storeId) => request<BorrowRequestsResponse>('GET', `/stores/${id(storeId)}/borrow-requests`),
    requestBorrow: async (storeId, body) => (await request<BorrowRequestResponse>('POST', `/stores/${id(storeId)}/borrow-requests`, body)).request,
    lendCandidates: async (storeId, requestId) =>
      (await request<LendCandidatesResponse>('GET', `/stores/${id(storeId)}/borrow-requests/${id(requestId)}/candidates`)).candidates,
    decide: async (storeId, requestId, decision) =>
      (await request<BorrowRequestResponse>('POST', `/stores/${id(storeId)}/borrow-requests/${id(requestId)}/decision`, decision)).request,
  }
}
