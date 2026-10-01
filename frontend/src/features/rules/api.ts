/**
 * Rules API client (task 10): `/rule-sets` and `/rule-versions`.
 *
 * Screens depend on the `RulesClient` interface so they can be rendered with
 * a fake in tests; the app wires `createRulesClient` over the shared API
 * client (`useApi`, task 8.2).
 */
import {
  isApiErrorCode,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiErrorDetail,
  type IsoDate,
  type RuleSetSummary,
  type RuleVersionDetail,
  type RuleVersionDiff,
  type RuleVersionImpact,
  type RuleVersionSummary,
} from '@lanewise/shared'
import { ApiError, type ApiClient, type HttpMethod } from '@/api'

export interface RuleSetRef {
  readonly id: string
  readonly type: RuleSetSummary['type']
  readonly name: string
  readonly isCostRule: boolean
}

export interface RuleVersionEdit {
  readonly effectiveFrom?: IsoDate
  readonly payload?: Readonly<Record<string, unknown>>
  readonly changeNote?: string
}

export interface PublishOutcome {
  readonly version: RuleVersionDetail
  readonly supersededVersionId: string | null
  readonly staleScenarioIds: readonly string[]
}

export interface RulesClient {
  listRuleSets(): Promise<readonly RuleSetSummary[]>
  listVersions(ruleSetId: string): Promise<{ ruleSet: RuleSetRef; versions: readonly RuleVersionSummary[] }>
  /** Starts a draft; without a payload it copies the in-force version. */
  createDraft(ruleSetId: string, input: { effectiveFrom: IsoDate; payload?: Record<string, unknown>; changeNote?: string }): Promise<RuleVersionDetail>
  getVersion(versionId: string): Promise<{ version: RuleVersionDetail; impact: RuleVersionImpact }>
  getDiff(versionId: string): Promise<RuleVersionDiff>
  saveDraft(versionId: string, edit: RuleVersionEdit): Promise<RuleVersionDetail>
  submit(versionId: string): Promise<RuleVersionDetail>
  approve(versionId: string, comment?: string): Promise<RuleVersionDetail>
  requestChanges(versionId: string, comment: string): Promise<RuleVersionDetail>
  publish(versionId: string): Promise<PublishOutcome>
  /** Finance's one-step approval + publish of a submitted cost rule; all or nothing on the server. */
  approveAndPublish(versionId: string, comment?: string): Promise<PublishOutcome>
}

/** A failed API call with the server's error code and field details. */
export class RulesApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly details: readonly ApiErrorDetail[]
  readonly requestId: string | null

  constructor(status: number, body: unknown) {
    const err = (body as Partial<ApiErrorBody> | null)?.error
    super(err?.message ?? `Request failed (${status})`)
    this.name = 'RulesApiError'
    this.status = status
    this.code = isApiErrorCode(err?.code) ? err.code : 'internal_error'
    this.details = err?.details ?? []
    this.requestId = err?.requestId ?? null
  }
}

/**
 * The rules client over the app's API client (task 8.2): requests carry the
 * active role (`X-Active-Role`) and the ID token, so the server authorises
 * each one against the active role (task 8.1).
 */
export function createRulesClient(api: Pick<ApiClient, 'request'>): RulesClient {
  async function request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    try {
      return await api.request<T>(method, path, body !== undefined ? { body } : {})
    } catch (error) {
      if (error instanceof ApiError) {
        throw new RulesApiError(error.status, {
          error: { code: error.code, message: error.message, requestId: error.requestId, details: error.details },
        })
      }
      throw error
    }
  }

  const id = encodeURIComponent
  return {
    listRuleSets: async () => (await request<{ ruleSets: RuleSetSummary[] }>('GET', '/rule-sets')).ruleSets,
    listVersions: (ruleSetId) => request('GET', `/rule-sets/${id(ruleSetId)}/versions`),
    createDraft: async (ruleSetId, input) =>
      (await request<{ version: RuleVersionDetail }>('POST', `/rule-sets/${id(ruleSetId)}/versions`, input)).version,
    getVersion: (versionId) => request('GET', `/rule-versions/${id(versionId)}`),
    getDiff: (versionId) => request('GET', `/rule-versions/${id(versionId)}/diff`),
    saveDraft: async (versionId, edit) =>
      (await request<{ version: RuleVersionDetail }>('PATCH', `/rule-versions/${id(versionId)}`, edit)).version,
    submit: async (versionId) =>
      (await request<{ version: RuleVersionDetail }>('POST', `/rule-versions/${id(versionId)}/submit`)).version,
    approve: async (versionId, comment) =>
      (await request<{ version: RuleVersionDetail }>('POST', `/rule-versions/${id(versionId)}/approve`, comment ? { comment } : {}))
        .version,
    requestChanges: async (versionId, comment) =>
      (await request<{ version: RuleVersionDetail }>('POST', `/rule-versions/${id(versionId)}/request-changes`, { comment }))
        .version,
    publish: (versionId) => request('POST', `/rule-versions/${id(versionId)}/publish`),
    approveAndPublish: (versionId, comment) =>
      request('POST', `/rule-versions/${id(versionId)}/approve-and-publish`, comment ? { comment } : {}),
  }
}
