import { createMockAdapter, fetchAdapter, type ApiAdapter } from '@/api'
import { API_MOCK } from './config'

const MOCK_LATENCY_MS = 150

/** Picks the API transport: the in-memory mock (VITE_API_MOCK) or the real API. */
export function defaultAdapter(apiBaseUrl: string | null | undefined): ApiAdapter {
  if (API_MOCK) return createMockAdapter({ latencyMs: MOCK_LATENCY_MS })
  // No configured URL: same-origin (fails visibly rather than serving mock data).
  return fetchAdapter(apiBaseUrl ?? '')
}
