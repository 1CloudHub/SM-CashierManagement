import {
  isApiErrorCode,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiErrorDetail,
  type HealthResponse,
  type RoleCode,
} from '@lanewise/shared'
import type { HomeSummary } from './types'

/**
 * Typed API client (task 8.2).
 *
 * Screens call typed methods (`api.getHome()`); the transport is an adapter —
 * `fetchAdapter` for the real API, or the in-memory mock (./mock) selected by
 * VITE_API_MOCK — so feature screens can be built before their endpoints
 * exist. Every request carries the active role in `X-Active-Role` and, when
 * signed in, the Cognito ID token; the server authorises each request against
 * that role (task 8.1, P12). Error responses surface as `ApiError` with the
 * shared error model, whose `message` is safe to show and whose `requestId`
 * is the support reference (SCR-090).
 */

export const ACTIVE_ROLE_HEADER = 'X-Active-Role'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ApiRequest {
  readonly method: HttpMethod
  /** Path under the API root, starting with `/`. */
  readonly path: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: unknown
  readonly signal?: AbortSignal
}

export interface ApiResponse {
  readonly status: number
  readonly body: unknown
}

/** A transport: turns a request into a status + parsed JSON body. */
export type ApiAdapter = (request: ApiRequest) => Promise<ApiResponse>

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly requestId: string | null
  readonly details: readonly ApiErrorDetail[]

  constructor(status: number, code: ApiErrorCode, message: string, requestId: string | null, details: readonly ApiErrorDetail[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.details = details
  }
}

function isErrorBody(body: unknown): body is ApiErrorBody {
  const error = (body as ApiErrorBody | null)?.error
  return typeof error === 'object' && error !== null && isApiErrorCode(error.code) && typeof error.message === 'string'
}

function toApiError(status: number, body: unknown): ApiError {
  if (isErrorBody(body)) {
    const { code, message, requestId, details } = body.error
    return new ApiError(status, code, message, requestId ?? null, details ?? [])
  }
  const code: ApiErrorCode = status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 503 ? 'service_unavailable' : 'internal_error'
  return new ApiError(status, code, 'The request failed.', null)
}

export interface ApiClientOptions {
  readonly adapter: ApiAdapter
  /** The role to send on every request (read at request time). */
  readonly getActiveRole: () => RoleCode
  /** Bearer token for the API authorizer; `null` sends none. */
  readonly getAuthToken?: () => Promise<string | null>
}

export interface RequestOptions {
  readonly body?: unknown
  readonly signal?: AbortSignal
}

export interface ApiClient {
  request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>
  getHealth(options?: RequestOptions): Promise<HealthResponse>
  getHome(options?: RequestOptions): Promise<HomeSummary>
}

export function createApiClient({ adapter, getActiveRole, getAuthToken }: ApiClientOptions): ApiClient {
  async function request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      [ACTIVE_ROLE_HEADER]: getActiveRole(),
    }
    const token = getAuthToken ? await getAuthToken() : null
    if (token) headers.Authorization = `Bearer ${token}`
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'

    const res = await adapter({ method, path, headers, body: options.body, signal: options.signal })
    if (res.status < 200 || res.status >= 300) throw toApiError(res.status, res.body)
    return res.body as T
  }

  return {
    request,
    getHealth: (options) => request<HealthResponse>('GET', '/health', options),
    getHome: (options) => request<HomeSummary>('GET', '/home', options),
  }
}

/** The real transport: `fetch` against the API base URL (runtime config). */
export function fetchAdapter(baseUrl: string, fetchImpl: typeof fetch = (...args) => fetch(...args)): ApiAdapter {
  const root = baseUrl.replace(/\/+$/, '')
  return async ({ method, path, headers, body, signal }) => {
    const res = await fetchImpl(`${root}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
    const type = res.headers.get('content-type') ?? ''
    const parsed: unknown = type.includes('json') ? await res.json().catch(() => null) : null
    return { status: res.status, body: parsed }
  }
}
