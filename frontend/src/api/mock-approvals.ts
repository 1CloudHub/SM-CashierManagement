import {
  APPROVAL_STEP_KINDS,
  APPROVER_ROLE_BY_STEP,
  HTTP_STATUS_BY_ERROR_CODE,
  applyApprovalCommand,
  approvalActionsFor,
  awaitsRole,
  can,
  compareScenarioResults,
  isPlanReady,
  type ApiErrorCode,
  type ApiErrorDetail,
  type ApprovalCommand,
  type ApprovalDecision,
  type ApprovalDetail,
  type ApprovalPerson,
  type ApprovalQueueItem,
  type ApprovalRefusal,
  type ApprovalState,
  type ApprovalStepKind,
  type ApprovalStepView,
  type CostViewer,
  type RoleCode,
  type ScenarioDetail,
  type ScenarioListItem,
  type ScenarioStatus,
} from '@lanewise/shared'
import type { ApiResponse } from './client'

/**
 * In-memory `/approvals` for the mock API (task 12). The book shares the
 * scenario rows of `./mock-scenarios`, so a submit there opens a tracker
 * here and a decision here moves the scenario (Draft on request-changes /
 * reject, Published on plan approval). Every action is checked with the
 * shared workflow model (`applyApprovalCommand`), like the API.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type Step = Mutable<ApprovalStepView>

interface Submission {
  readonly submissionNo: number
  readonly submittedBy: ApprovalPerson
  readonly submittedAt: string
  readonly steps: Step[]
}

/** What the book needs from the scenario store. */
export interface ApprovalScenarioRow {
  readonly id: string
  name: string
  season: string
  status: ScenarioStatus
  isPublished: boolean
  stale: boolean
  synthetic: boolean
  updatedAt: string
}

export interface ApprovalBookDeps<R extends ApprovalScenarioRow> {
  readonly rows: () => R[]
  readonly detail: (row: R, role: RoleCode, viewer: CostViewer) => ScenarioDetail
  readonly listItem: (detail: ScenarioDetail) => ScenarioListItem
  readonly now: () => string
}

export const MOCK_PEOPLE: Readonly<Record<'PLN' | 'HR' | 'FIN' | 'EXE', ApprovalPerson>> = {
  PLN: { id: 'u-pln-ana', name: 'Ana Reyes' },
  HR: { id: 'u-hr-ltan', name: 'L. Tan' },
  FIN: { id: 'u-fin-rsantos', name: 'R. Santos' },
  EXE: { id: 'u-exe-mcruz', name: 'M. Cruz' },
}

function person(role: RoleCode): ApprovalPerson {
  return role in MOCK_PEOPLE ? MOCK_PEOPLE[role as keyof typeof MOCK_PEOPLE] : { id: `u-${role.toLowerCase()}`, name: role }
}

function pendingSteps(submissionNo: number): Step[] {
  return APPROVAL_STEP_KINDS.map((step) => ({
    step,
    submissionNo,
    status: 'pending',
    approverRole: APPROVER_ROLE_BY_STEP[step],
    decidedBy: null,
    decidedAsRole: null,
    decidedAt: null,
    comment: null,
    outside: null,
  }))
}

function decided(step: Step, role: RoleCode, at: string, comment: string): Step {
  return { ...step, status: 'approved', decidedBy: person(role), decidedAsRole: role, decidedAt: at, comment }
}

/** Seeded trackers for the scenarios in ./mock-scenarios. */
function seed(): Map<string, Submission[]> {
  const v3 = pendingSteps(1)
  const ber = pendingSteps(1)
  return new Map([
    [
      'scn-xmas-2026-v3',
      [
        {
          submissionNo: 1,
          submittedBy: MOCK_PEOPLE.PLN,
          submittedAt: '2026-09-16T11:00:00+08:00',
          steps: [
            decided(v3[0]!, 'HR', '2026-09-17T10:00:00+08:00', '284 seasonal hires agreed.'),
            decided(v3[1]!, 'FIN', '2026-09-17T15:00:00+08:00', 'Within the Christmas labor budget.'),
            decided(v3[2]!, 'EXE', '2026-09-18T09:00:00+08:00', 'Approved for publication.'),
          ],
        },
      ],
    ],
    [
      'scn-ber-2026-v1',
      [
        {
          submissionNo: 1,
          submittedBy: MOCK_PEOPLE.PLN,
          submittedAt: '2026-09-29T11:30:00+08:00',
          steps: [decided(ber[0]!, 'HR', '2026-09-30T10:00:00+08:00', 'Seasonal hires OK.'), ber[1]!, ber[2]!],
        },
      ],
    ],
  ])
}

let seq = 0
function fail(code: ApiErrorCode, message: string, details?: ApiErrorDetail[]): ApiResponse {
  seq += 1
  return {
    status: HTTP_STATUS_BY_ERROR_CODE[code],
    body: { error: { code, message, requestId: `mock-apr-${seq}`, ...(details ? { details } : {}) } },
  }
}

const REFUSAL_MESSAGES: Record<ApprovalRefusal | 'submission_changed', string> = {
  not_permitted: 'Your active role cannot take this approval action.',
  not_submitted: 'This scenario is not awaiting approval.',
  paused: 'This scenario became stale, so approvals are paused.',
  step_decided: 'This step has already been decided for this submission.',
  not_ready: 'The plan can be decided only after headcount and budget are both secured.',
  comment_required: 'A comment is required to request changes or reject.',
  reference_required: 'A reference and a note are required.',
  invalid_decision: 'That decision is not available for this step.',
  not_draft: 'Only a draft can be submitted.',
  submission_changed: 'This scenario was resubmitted since you opened it.',
}

function refusal(reason: ApprovalRefusal | 'submission_changed'): ApiResponse {
  if (reason === 'not_permitted') return fail('forbidden', REFUSAL_MESSAGES[reason])
  if (reason === 'comment_required' || reason === 'reference_required' || reason === 'invalid_decision') {
    return fail('validation_failed', REFUSAL_MESSAGES[reason], [
      { path: reason === 'comment_required' ? 'body.comment' : reason === 'reference_required' ? 'body.reference' : 'body.decision', message: REFUSAL_MESSAGES[reason] },
    ])
  }
  return fail('conflict', REFUSAL_MESSAGES[reason], [{ path: 'blocker', message: reason }])
}

export interface MockApprovalBook {
  /** Opens a fresh submission (all steps pending) when a scenario is submitted (Req 9.1, 9.6). */
  submit(scenarioId: string, role: RoleCode): void
  handle(input: { method: string; pathname: string; query: URLSearchParams; body: unknown; role: RoleCode; viewer: CostViewer }): ApiResponse
}

export function createApprovalBook<R extends ApprovalScenarioRow>(deps: ApprovalBookDeps<R>): MockApprovalBook {
  const book = seed()

  const current = (id: string): Submission | null => book.get(id)?.at(-1) ?? null

  function stateOf(row: R): ApprovalState {
    const sub = current(row.id)
    return {
      scenarioStatus: row.status,
      stale: row.stale,
      submissionNo: sub?.submissionNo ?? 0,
      steps: (book.get(row.id) ?? []).flatMap((s) => s.steps.map((x) => ({ step: x.step, submissionNo: x.submissionNo, status: x.status }))),
    }
  }

  function queueItem(row: R, role: RoleCode): ApprovalQueueItem {
    const sub = current(row.id)
    const state = stateOf(row)
    return {
      scenarioId: row.id,
      name: row.name,
      season: row.season,
      status: row.status,
      stale: row.stale,
      submissionNo: state.submissionNo,
      submittedBy: sub?.submittedBy ?? null,
      submittedAt: sub?.submittedAt ?? null,
      steps: state.steps.filter((s) => s.submissionNo === state.submissionNo),
      planReady: isPlanReady(state),
      awaitingYou: awaitsRole(role, state),
      synthetic: row.synthetic,
    }
  }

  function detail(row: R, role: RoleCode, viewer: CostViewer): ApprovalDetail {
    const d = deps.detail(row, role, viewer)
    const subs = book.get(row.id) ?? []
    const sub = subs.at(-1) ?? null
    const state = stateOf(row)
    const peer = deps.rows().find((r) => r.id !== row.id && r.status === 'published' && r.season === row.season && r.synthetic === row.synthetic)
    const results = d.latestRun?.status === 'succeeded' ? d.latestRun.results : null
    const peerResults = peer ? (deps.detail(peer, role, viewer).latestRun?.results ?? null) : null
    return {
      scenario: { ...deps.listItem(d), notes: d.settings.notes },
      submissionNo: state.submissionNo,
      submittedBy: sub?.submittedBy ?? null,
      submittedAt: sub?.submittedAt ?? null,
      steps: sub ? sub.steps.map((s) => ({ ...s })) : [],
      history: subs
        .slice(0, -1)
        .reverse()
        .map((s) => ({ submissionNo: s.submissionNo, steps: s.steps.map((x) => ({ ...x })) })),
      planReady: isPlanReady(state),
      checks: { runComplete: d.latestRun?.status === 'succeeded', notStale: !row.stale },
      actions: approvalActionsFor(role, state),
      results,
      published: peer ? { id: peer.id, name: peer.name } : null,
      changes: peer && results ? compareScenarioResults(peerResults, results) : null,
    }
  }

  function apply(row: R, role: RoleCode, command: ApprovalCommand, extra: { reference?: string; note?: string; comment?: string }): ApiResponse | null {
    const outcome = applyApprovalCommand(stateOf(row), command)
    if (!outcome.ok) return refusal(outcome.reason)
    const sub = current(row.id)!
    const at = deps.now()
    const step = sub.steps.find((s) => s.step === (command as { step: ApprovalStepKind }).step)!
    const next = outcome.state.steps.find((s) => s.submissionNo === sub.submissionNo && s.step === step.step)!
    Object.assign(step, {
      status: next.status,
      decidedBy: person(role),
      decidedAsRole: role,
      decidedAt: at,
      comment: extra.comment?.trim() || null,
      outside: next.status === 'secured_outside' ? { reference: extra.reference!.trim(), note: extra.note?.trim() || null } : null,
    })
    if (outcome.published) {
      for (const r of deps.rows()) {
        if (r.id !== row.id && r.status === 'published' && r.season === row.season && r.synthetic === row.synthetic) {
          r.status = 'superseded'
          r.isPublished = false
          r.updatedAt = at
        }
      }
      row.isPublished = true
    }
    row.status = outcome.state.scenarioStatus
    row.updatedAt = at
    return null
  }

  return {
    submit(scenarioId, role) {
      const subs = book.get(scenarioId) ?? []
      const submissionNo = (subs.at(-1)?.submissionNo ?? 0) + 1
      subs.push({ submissionNo, submittedBy: person(role), submittedAt: deps.now(), steps: pendingSteps(submissionNo) })
      book.set(scenarioId, subs)
    },

    handle({ method, pathname, query, body, role, viewer }) {
      if (!can(role, 'approval_plan', 'view')) return fail('forbidden', 'You don’t have access to approvals.')
      const parts = pathname.split('/').filter(Boolean) // ['approvals', id?, action?]
      const id = parts[1] ? decodeURIComponent(parts[1]) : null
      const action = parts[2] ?? null
      const b = (body ?? {}) as Record<string, unknown>

      if (!id) {
        if (method !== 'GET') return fail('not_found', 'We couldn’t find that.')
        const all = query.get('state') === 'all'
        const rows = deps
          .rows()
          .filter((r) => book.has(r.id) && (all || r.status === 'submitted'))
          .sort((x, y) => Number(y.status === 'submitted') - Number(x.status === 'submitted'))
        return { status: 200, body: { approvals: rows.map((r) => queueItem(r, role)) } }
      }

      const row = deps.rows().find((r) => r.id === id)
      if (!row) return fail('not_found', 'We couldn’t find that scenario.')
      const reply = () => ({ status: 200, body: { approval: detail(row, role, viewer) } })
      if (method === 'GET' && !action) return reply()
      if (method !== 'POST' || !action) return fail('not_found', 'We couldn’t find that.')

      if (typeof b.submissionNo === 'number' && b.submissionNo !== current(row.id)?.submissionNo) return refusal('submission_changed')
      const comment = typeof b.comment === 'string' ? b.comment : undefined
      if (action === 'secured-outside') {
        const step = b.step as ApprovalStepKind
        if (!(APPROVAL_STEP_KINDS as readonly string[]).includes(String(step))) return refusal('invalid_decision')
        const reference = typeof b.reference === 'string' ? b.reference : ''
        const note = typeof b.note === 'string' ? b.note : ''
        return apply(row, role, { kind: 'record_outside', role, step, reference, note }, { reference, note }) ?? reply()
      }
      if (!(APPROVAL_STEP_KINDS as readonly string[]).includes(action)) return fail('not_found', 'We couldn’t find that.')
      const decision = b.decision as ApprovalDecision
      return (
        apply(row, role, { kind: 'decide', role, step: action as ApprovalStepKind, decision, ...(comment !== undefined ? { comment } : {}) }, { ...(comment !== undefined ? { comment } : {}) }) ??
        reply()
      )
    },
  }
}
