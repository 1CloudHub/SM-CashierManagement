/**
 * LaneWise API client (task 8.2): typed methods over a swappable transport —
 * the real API (`fetchAdapter`) or the in-memory mock (`createMockAdapter`,
 * VITE_API_MOCK). See ./client.
 */
export {
  ACTIVE_ROLE_HEADER,
  ApiError,
  createApiClient,
  fetchAdapter,
  type ApiAdapter,
  type ApiClient,
  type ApiClientOptions,
  type ApiRequest,
  type ApiResponse,
  type HttpMethod,
  type RequestOptions,
} from './client'
export { ApiProvider, useApi } from './context'
export { createMockAdapter, mockHome, type MockAdapterOptions } from './mock'
export type * from './types'
