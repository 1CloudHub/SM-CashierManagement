import { describe, expect, it } from 'vitest'
import type { RoleCode } from '@lanewise/shared'
import { ApiError, createApiClient, createMockAdapter, type ApiAdapter } from '@/api'
import { createScenariosClient } from '@/features/scenarios/api'
import { createApprovalsClient } from './api'

function clients(adapter: ApiAdapter = createMockAdapter()) {
  return (role: RoleCode) => {
    const api = createApiClient({ adapter, getActiveRole: () => role })
    return { approvals: createApprovalsClient(api), scenarios: createScenariosClient(api) }
  }
}

const BER = 'scn-ber-2026-v1'

describe('mock /approvals (task 12)', () => {
  it('lists the submitted scenario with its steps and who it awaits', async () => {
    const as = clients()
    const hr = await as('HR').approvals.list()
    expect(hr.map((x) => x.scenarioId).sort()).toEqual([BER, 'scn-xmas-2026-v4'])
    const ber = hr.find((x) => x.scenarioId === BER)
    expect(ber).toMatchObject({ planReady: false, awaitingYou: true })
    expect(ber!.steps.map((s) => s.status)).toEqual(['pending', 'pending', 'pending'])
    expect((await as('FIN').approvals.list()).find((x) => x.scenarioId === BER)?.awaitingYou).toBe(true)
    // v4: headcount approved, budget secured outside the system → the plan awaits the Executive.
    const v4 = (await as('EXE').approvals.list()).find((x) => x.scenarioId === 'scn-xmas-2026-v4')
    expect(v4).toMatchObject({ planReady: true, awaitingYou: true })
    expect(v4!.steps.map((s) => s.status)).toEqual(['approved', 'secured_outside', 'pending'])
    expect((await as('EXE').approvals.list('all')).map((x) => x.scenarioId)).toContain('scn-xmas-2026-v3')
    await expect(as('PLN').approvals.list()).rejects.toBeInstanceOf(ApiError)
  })

  it('follows the workflow: plan blocked until secured, then publishes (P10)', async () => {
    const as = clients()
    const early = await as('EXE').approvals.decide(BER, 'plan', { decision: 'approve' }).catch((e: unknown) => e)
    expect(early).toBeInstanceOf(ApiError)
    expect((early as ApiError).code).toBe('conflict')
    const noComment = await as('FIN').approvals.decide(BER, 'budget', { decision: 'request_changes' }).catch((e: unknown) => e)
    expect((noComment as ApiError).code).toBe('validation_failed')
    await as('HR').approvals.decide(BER, 'headcount', { decision: 'approve' })
    const secured = await as('EXE').approvals.recordOutside(BER, { step: 'budget', reference: 'email 2 Oct', note: 'CFO OK' })
    expect(secured.planReady).toBe(true)
    expect(secured.steps[1]).toMatchObject({ status: 'secured_outside', outside: { reference: 'email 2 Oct', note: 'CFO OK' } })
    const done = await as('EXE').approvals.decide(BER, 'plan', { decision: 'approve', submissionNo: 1 })
    expect(done.scenario.status).toBe('published')
    expect((await as('PLN').scenarios.get(BER)).isPublished).toBe(true)
  })

  it('returns to Draft on request-changes and resets steps on resubmission (Req 9.6)', async () => {
    const as = clients()
    const back = await as('FIN').approvals.decide(BER, 'budget', { decision: 'request_changes', comment: 'Trim PT' })
    expect(back.scenario.status).toBe('draft')
    await as('PLN').scenarios.submit(BER)
    const again = await as('HR').approvals.get(BER)
    expect(again.submissionNo).toBe(2)
    expect(again.steps.map((s) => s.status)).toEqual(['pending', 'pending', 'pending'])
    expect(again.history[0]?.steps.map((s) => s.status)).toEqual(['pending', 'changes_requested', 'pending'])
    expect(again.actions.decide.headcount).toEqual(['approve', 'request_changes'])
  })
})
