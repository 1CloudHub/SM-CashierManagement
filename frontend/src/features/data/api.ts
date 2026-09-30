/**
 * Data ingestion API client (task 9 — requirement 17/18, SCR-050/051).
 *
 * A thin, typed wrapper over the ingestion routes. Screens depend on the
 * `DataApi` interface, never on `fetch` directly, so they can be tested with a
 * fake. `createDataApi` takes an injectable `fetch`, the API base URL (the
 * runtime-config `apiUrl`) and a Cognito ID-token getter (the auth client's
 * `idToken()`).
 *
 * Every failure rejects with an `ApiRequestError` carrying the API's stable
 * error `code`, the HTTP `status` and the `requestId` (the reference ID shown
 * to users) — raw bodies and stack traces never reach the UI.
 */
import {
  HTTP_STATUS_BY_ERROR_CODE,
  isApiErrorCode,
  type ApiErrorCode,
  type CreateIngestionRequest,
  type DatasetListResponse,
  type DatasetSnapshot,
  type DatasetType,
  type FileDownload,
  type IngestionDetail,
  type IngestionRunDto,
  type LoadIngestionRequest,
  type LoadIngestionResponse,
  type ProvenanceInfo,
  type UpdateSnapshotRequest,
  type UploadUrlRequest,
  type UploadUrlResponse,
  type WithProvenance,
} from '@lanewise/shared'

/** API error codes plus the client-side `network_error` (fetch rejected). */
export type ApiRequestErrorCode = ApiErrorCode | 'network_error'

export class ApiRequestError extends Error {
  readonly code: ApiRequestErrorCode
  readonly status: number
  readonly requestId: string | null
  constructor(
    code: ApiRequestErrorCode,
    status: number,
    message: string,
    requestId: string | null = null,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ApiRequestError'
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

export function isApiRequestError(value: unknown): value is ApiRequestError {
  return value instanceof ApiRequestError
}

/** The subset of `fetch` the client uses (so tests can pass a fake). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface DataApiOptions {
  /** API base URL, e.g. the runtime-config `apiUrl`. */
  readonly baseUrl: string
  /** Resolves the current Cognito ID token, or `null` when signed out. */
  readonly getToken: () => Promise<string | null>
  readonly fetch?: FetchLike
}

export interface ListIngestionsQuery {
  readonly datasetType?: DatasetType
  readonly limit?: number
}

export interface ListSnapshotsQuery {
  readonly datasetType?: DatasetType
  readonly current?: boolean
}

export interface DataApi {
  listDatasets(): Promise<WithProvenance<DatasetListResponse>>
  getProvenance(): Promise<ProvenanceInfo>
  listIngestions(query?: ListIngestionsQuery): Promise<WithProvenance<{ runs: IngestionRunDto[] }>>
  exportHistory(): Promise<FileDownload>
  requestUploadUrl(body: UploadUrlRequest): Promise<UploadUrlResponse>
  /** PUTs the raw file to the presigned URL with exactly the signed headers. */
  uploadFile(target: UploadUrlResponse, file: Blob): Promise<void>
  createIngestion(body: CreateIngestionRequest): Promise<WithProvenance<IngestionDetail>>
  getIngestion(id: string): Promise<WithProvenance<IngestionDetail>>
  getReport(id: string): Promise<FileDownload>
  loadIngestion(id: string, body: LoadIngestionRequest): Promise<LoadIngestionResponse>
  cancelIngestion(id: string): Promise<{ run: IngestionRunDto }>
  listSnapshots(query?: ListSnapshotsQuery): Promise<WithProvenance<{ snapshots: DatasetSnapshot[] }>>
  updateSnapshot(id: string, body: UpdateSnapshotRequest): Promise<DatasetSnapshot>
}

/** Maps an HTTP status to the closest API error code (non-JSON error bodies). */
export function codeForStatus(status: number): ApiErrorCode {
  for (const [code, s] of Object.entries(HTTP_STATUS_BY_ERROR_CODE)) {
    if (s === status) return code as ApiErrorCode
  }
  return status >= 500 ? 'internal_error' : 'bad_request'
}

/** Builds an `ApiRequestError` from a non-OK response (ApiErrorBody when present). */
export async function errorFromResponse(res: Response): Promise<ApiRequestError> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // Not JSON (e.g. a gateway error page); fall back to the status.
  }
  const err = (body as { error?: Record<string, unknown> } | null)?.error
  if (err && isApiErrorCode(err.code)) {
    return new ApiRequestError(
      err.code,
      res.status,
      typeof err.message === 'string' ? err.message : err.code,
      typeof err.requestId === 'string' ? err.requestId : null,
    )
  }
  const code = codeForStatus(res.status)
  return new ApiRequestError(code, res.status, code, res.headers.get('x-request-id'))
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) search.set(k, String(v))
  const s = search.toString()
  return s ? `?${s}` : ''
}

export function createDataApi(options: DataApiOptions): DataApi {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const base = options.baseUrl.replace(/\/+$/, '')

  async function send(input: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(input, init)
    } catch (cause) {
      throw new ApiRequestError('network_error', 0, 'network_error', null, { cause })
    }
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await options.getToken()
    if (!token) throw new ApiRequestError('unauthenticated', 401, 'unauthenticated')
    const headers: Record<string, string> = { Authorization: token, Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await send(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw await errorFromResponse(res)
    return (await res.json()) as T
  }

  const id = (value: string) => encodeURIComponent(value)

  return {
    listDatasets: () => request('GET', '/datasets'),
    getProvenance: () => request('GET', '/datasets/provenance'),
    listIngestions: (q = {}) =>
      request('GET', `/ingestions${query({ datasetType: q.datasetType, limit: q.limit })}`),
    exportHistory: () => request('GET', '/ingestions/export'),
    requestUploadUrl: (body) => request('POST', '/ingestions/uploads', body),
    async uploadFile(target, file) {
      // No Authorization header: the presigned URL carries its own signature.
      const res = await send(target.uploadUrl, {
        method: 'PUT',
        headers: { ...target.headers },
        body: file,
      })
      if (!res.ok) {
        const code = codeForStatus(res.status)
        throw new ApiRequestError(code, res.status, code)
      }
    },
    createIngestion: (body) => request('POST', '/ingestions', body),
    getIngestion: (runId) => request('GET', `/ingestions/${id(runId)}`),
    getReport: (runId) => request('GET', `/ingestions/${id(runId)}/report`),
    loadIngestion: (runId, body) => request('POST', `/ingestions/${id(runId)}/load`, body),
    cancelIngestion: (runId) => request('POST', `/ingestions/${id(runId)}/cancel`),
    listSnapshots: (q = {}) =>
      request('GET', `/snapshots${query({ datasetType: q.datasetType, current: q.current })}`),
    updateSnapshot: (snapshotId, body) => request('PATCH', `/snapshots/${id(snapshotId)}`, body),
  }
}

/**
 * Saves a generated file (CSV report / history export) in the browser via a
 * Blob + object URL. The URL is revoked after the click so nothing leaks.
 */
export function downloadFile(file: FileDownload, doc: Document = document): void {
  const blob = new Blob([file.content], { type: file.contentType || 'text/csv' })
  const url = URL.createObjectURL(blob)
  try {
    const a = doc.createElement('a')
    a.href = url
    a.download = file.fileName
    a.rel = 'noopener'
    a.style.display = 'none'
    doc.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // Revoke on the next task so every browser has started the download.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
