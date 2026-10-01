/**
 * Approvals API client (task 12): `/approvals`.
 *
 * Screens depend on the `ApprovalsClient` interface so they can be rendered
 * with a fake in tests; the app wires `createApprovalsClient` over the shared
 * API client (`useApi`, task 8.2), which sends the active role.
 */
import type { ApprovalDecision, ApprovalDetail, ApprovalQueueItem, ApprovalStepKind, OutsideStep } from '@lanewise/shared'
import type { ApiClient, HttpMethod } from '@/api'

export type ApprovalQueueState = 'pending' | 'all'

export interface DecisionInput {
  readonly decision: ApprovalDecision
  readonly comment?: string
  /** The submission the reviewer saw; a newer one makes the API answer 409. */
  readonly submissionNo?: number
}

export interface OutsideRecordInput {
  readonly step: OutsideStep
  readonly reference: string
  readonly note: string
  readonly submissionNo?: number
}

export interface ApprovalsClient {
  list(state?: ApprovalQueueState): Promise<readonly ApprovalQueueItem[]>
  get(scenarioId: string): Promise<ApprovalDetail>
  decide(scenarioId: string, step: ApprovalStepKind, input: DecisionInput): Promise<ApprovalDetail>
  recordOutside(scenarioId: string, input: OutsideRecordInput): Promise<ApprovalDetail>
}

export function createApprovalsClient(api: Pick<ApiClient, 'request'>): ApprovalsClient {
  const request = <T,>(method: HttpMethod, path: string, body?: unknown): Promise<T> =>
    api.request<T>(method, path, body !== undefined ? { body } : {})
  const id = encodeURIComponent
  const one = async (method: HttpMethod, path: string, body?: unknown) =>
    (await request<{ approval: ApprovalDetail }>(method, path, body)).approval
  return {
    list: async (state = 'pending') =>
      (await request<{ approvals: ApprovalQueueItem[] }>('GET', `/approvals${state === 'all' ? '?state=all' : ''}`)).approvals,
    get: (sid) => one('GET', `/approvals/${id(sid)}`),
    decide: (sid, step, input) => one('POST', `/approvals/${id(sid)}/${step}`, input),
    recordOutside: (sid, input) => one('POST', `/approvals/${id(sid)}/secured-outside`, input),
  }
}
