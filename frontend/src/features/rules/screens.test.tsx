import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import type {
  RoleCode,
  RuleSetSummary,
  RuleVersionDetail,
  RuleVersionDiff,
  RuleVersionStatus,
} from '@lanewise/shared'
import { I18nProvider } from '@/i18n'
import { RulesApiError, type RulesClient } from './api'
import { RuleSetsScreen, RuleVersionEditorScreen } from './index'

const WAGES = { hourlyRateByRegion: { NCR: 86.875 }, defaultHourlyRate: 80, employerLoading: 0.14 }

function summary(overrides: Partial<RuleSetSummary> = {}): RuleSetSummary {
  return {
    id: 'set-wages',
    type: 'wages',
    name: 'Wage rates',
    isCostRule: true,
    currentVersion: {
      id: 'v1',
      ruleSetId: 'set-wages',
      version: 1,
      effectiveFrom: '2026-01-01',
      status: 'published',
      isCostRule: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    openVersion: null,
    scenarioCount: 5,
    ...overrides,
  }
}

function detail(status: RuleVersionStatus, overrides: Partial<RuleVersionDetail> = {}): RuleVersionDetail {
  return {
    id: 'v2',
    ruleSetId: 'set-wages',
    version: 2,
    effectiveFrom: '2026-10-01',
    status,
    isCostRule: true,
    updatedAt: '2026-09-30T00:00:00.000Z',
    ruleSetType: 'wages',
    ruleSetName: 'Wage rates',
    payload: WAGES,
    changeNote: 'Wage order NCR-26',
    createdBy: 'u-rst',
    createdByName: 'R. Santos',
    submittedAt: null,
    financeApprovedBy: null,
    financeApprovedByName: null,
    financeApprovedAt: null,
    reviewComment: null,
    publishedBy: null,
    publishedByName: null,
    publishedAt: null,
    synthetic: false,
    ...overrides,
  }
}

const DIFF: RuleVersionDiff = {
  fromVersionId: 'v1',
  toVersionId: 'v2',
  changes: [{ path: ['hourlyRateByRegion', 'NCR'], kind: 'changed', before: 80, after: 86.875 }],
}

function fakeClient(version: RuleVersionDetail = detail('draft'), overrides: Partial<RulesClient> = {}): RulesClient {
  let current = version
  const update = (patch: Partial<RuleVersionDetail>) => {
    current = { ...current, ...patch }
    return current
  }
  return {
    listRuleSets: vi.fn(async () => [summary()]),
    listVersions: vi.fn(async () => ({ ruleSet: { id: 'set-wages', type: 'wages' as const, name: 'Wage rates', isCostRule: true }, versions: [] })),
    createDraft: vi.fn(async () => detail('draft')),
    getVersion: vi.fn(async () => ({ version: current, impact: { scenarioIds: ['s1', 's2'] } })),
    getDiff: vi.fn(async () => DIFF),
    saveDraft: vi.fn(async (_id, edit) => update({ ...edit } as Partial<RuleVersionDetail>)),
    submit: vi.fn(async () => update({ status: 'submitted' })),
    approve: vi.fn(async () => update({ status: 'approved', financeApprovedAt: '2026-10-01T00:00:00Z' })),
    requestChanges: vi.fn(async (_id, comment) => update({ status: 'changes_requested', reviewComment: comment })),
    publish: vi.fn(async () => ({ version: update({ status: 'published' }), supersededVersionId: 'v1', staleScenarioIds: ['s1', 's2'] })),
    ...overrides,
  }
}

const renderUi = (ui: React.ReactNode) => render(<I18nProvider initialLocale="en">{ui}</I18nProvider>)

function editor(role: RoleCode, client: RulesClient) {
  return renderUi(<RuleVersionEditorScreen client={client} role={role} versionId="v2" onBack={() => undefined} />)
}

describe('SCR-060 Rule sets', () => {
  it('lists rule sets with version, cost flag and usage, and passes axe', async () => {
    const onOpen = vi.fn()
    const { container } = renderUi(<RuleSetsScreen client={fakeClient()} role="PLN" onOpenVersion={onOpen} />)
    const row = (await screen.findByRole('rowheader', { name: 'Wage rates' })).closest('tr')!
    expect(within(row).getByText('Version 1')).toBeInTheDocument()
    expect(within(row).getByText('Yes')).toBeInTheDocument()
    expect(within(row).getByText('5')).toBeInTheDocument()
    // A planner views but cannot start drafts.
    expect(within(row).queryByRole('button', { name: /New draft/ })).toBeNull()
    await userEvent.click(within(row).getByRole('button', { name: /View/ }))
    expect(onOpen).toHaveBeenCalledWith('v1')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('lets the Rules Steward start a draft with an effective date', async () => {
    const user = userEvent.setup()
    const client = fakeClient()
    const onOpen = vi.fn()
    renderUi(<RuleSetsScreen client={client} role="RST" onOpenVersion={onOpen} today="2026-10-01" />)
    await user.click(await screen.findByRole('button', { name: 'New draft: Wage rates' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/Effective from/)).toHaveValue('2026-10-01')
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }))
    await waitFor(() => expect(client.createDraft).toHaveBeenCalledWith('set-wages', { effectiveFrom: '2026-10-01' }))
    expect(onOpen).toHaveBeenCalledWith('v2')
  })

  it('tells Finance which cost rules wait for approval', async () => {
    const client = fakeClient(undefined, {
      listRuleSets: vi.fn(async () => [
        summary({ openVersion: { id: 'v2', ruleSetId: 'set-wages', version: 2, effectiveFrom: '2026-10-01', status: 'submitted', isCostRule: true, updatedAt: '' } }),
      ]),
    })
    renderUi(<RuleSetsScreen client={client} role="FIN" onOpenVersion={() => undefined} />)
    expect(await screen.findByText('1 cost rule is waiting for your approval before it can be published.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review Wage rates version 2' })).toBeInTheDocument()
    expect(screen.getByText('Awaiting Finance')).toBeInTheDocument()
  })

  it('shows no-access for roles outside the rules matrix and an error state with retry', async () => {
    const { unmount } = renderUi(<RuleSetsScreen client={fakeClient()} role="STF" onOpenVersion={() => undefined} />)
    expect(screen.getByText('Your role doesn’t include business rules.')).toBeInTheDocument()
    unmount()
    const listRuleSets = vi.fn().mockRejectedValueOnce(new RulesApiError(500, null)).mockResolvedValueOnce([summary()])
    renderUi(<RuleSetsScreen client={fakeClient(undefined, { listRuleSets })} role="RST" onOpenVersion={() => undefined} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('rowheader', { name: 'Wage rates' })).toBeInTheDocument()
  })
})

describe('SCR-061 Rule version editor', () => {
  it('shows the Finance steps, stale impact and the diff (read-only for a planner), and passes axe', async () => {
    const { container } = editor('PLN', fakeClient(detail('submitted')))
    expect(await screen.findByRole('heading', { level: 1, name: 'Wage rates · Version 2' })).toBeInTheDocument()
    expect(screen.getByText('Cost rule')).toBeInTheDocument()
    expect(screen.getByText(/2 scenarios use an earlier version/)).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Base rate by region (₱/h) › NCR' })).toBeInTheDocument()
    expect(screen.getByLabelText('Default base rate (₱/h)')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('validates values against the engine schema before saving', async () => {
    const user = userEvent.setup()
    const client = fakeClient()
    editor('RST', client)
    const input = await screen.findByLabelText('Employer on-cost loading')
    await user.clear(input)
    await user.type(input, '3')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Must be at most 1.')).toBeInTheDocument()
    expect(client.saveDraft).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, '0.2')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() =>
      expect(client.saveDraft).toHaveBeenCalledWith('v2', expect.objectContaining({ payload: { ...WAGES, employerLoading: 0.2 } })),
    )
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument()
  })

  it('submits a cost rule to Finance after confirmation; it cannot be published directly', async () => {
    const user = userEvent.setup()
    const client = fakeClient()
    editor('RST', client)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Submit to Finance' }))
    const dialog = await screen.findByRole('dialog', { name: 'Submit Wage rates version 2 to Finance?' })
    await user.click(within(dialog).getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(client.submit).toHaveBeenCalledWith('v2'))
    expect(await screen.findByText('Submitted to Finance. Finance has been notified.')).toBeInTheDocument()
  })

  it('Finance must comment to request changes', async () => {
    const user = userEvent.setup()
    const client = fakeClient(detail('submitted'))
    editor('FIN', client)
    await user.click(await screen.findByRole('button', { name: 'Request changes' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Request changes' }))
    expect(await within(dialog).findByText('Add a comment so the Rules Steward knows what to change.')).toBeInTheDocument()
    expect(client.requestChanges).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText(/What needs to change/), 'Cite the wage order')
    await user.click(within(dialog).getByRole('button', { name: 'Request changes' }))
    await waitFor(() => expect(client.requestChanges).toHaveBeenCalledWith('v2', 'Cite the wage order'))
    expect(await screen.findByText('Cite the wage order')).toBeInTheDocument()
  })

  it('Finance approves and publishes in one confirmed step, naming the stale scenarios', async () => {
    const user = userEvent.setup()
    const client = fakeClient(detail('submitted'))
    editor('FIN', client)
    await user.click(await screen.findByRole('button', { name: 'Approve and publish' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Effective Oct 1, 2026; 2 scenarios will be marked stale/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Approve and publish' }))
    await waitFor(() => expect(client.publish).toHaveBeenCalledWith('v2'))
    expect(client.approve).toHaveBeenCalledWith('v2')
    expect(await screen.findByText('Published. 2 scenarios were marked stale.')).toBeInTheDocument()
  })

  it('the Rules Steward publishes a non-cost rule directly', async () => {
    const user = userEvent.setup()
    const client = fakeClient(
      detail('draft', {
        isCostRule: false,
        ruleSetType: 'lead_times',
        ruleSetName: 'Planning lead times',
        payload: {
          leadTimeDays: { FT: 42, PT: 28, FLOAT: 21 },
          contractWeeklyHours: { FT: 48, PT: 24, FLOAT: 32 },
          recruitingBuffer: 0.1,
          milestones: [{ name: 'Start on the floor', daysBeforeNeedBy: { FT: 0, PT: 0, FLOAT: 0 } }],
        },
      }),
    )
    editor('RST', client)
    expect(await screen.findByText('Non-cost rules skip Finance approval and publish directly.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit to Finance' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(client.publish).toHaveBeenCalledWith('v2'))
  })

  it('maps server validation details onto fields', async () => {
    const user = userEvent.setup()
    const client = fakeClient(undefined, {
      saveDraft: vi.fn(async () => {
        throw new RulesApiError(422, {
          error: {
            code: 'validation_failed',
            message: 'Some rule values are missing or invalid.',
            requestId: 'r',
            details: [{ path: 'body.payload.defaultHourlyRate', message: 'Must be more than 0.' }],
          },
        })
      }),
    })
    editor('RST', client)
    const input = await screen.findByLabelText('Default base rate (₱/h)')
    await user.clear(input)
    await user.type(input, '81')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Must be more than 0.')).toBeInTheDocument()
  })
})

describe('SCR-061 load failure', () => {
  it('shows an error with retry and recovers', async () => {
    const getVersion = vi
      .fn()
      .mockRejectedValueOnce(new RulesApiError(503, { error: { code: 'service_unavailable', message: 'x', requestId: 'req-9' } }))
      .mockResolvedValue({ version: detail('draft'), impact: { scenarioIds: [] } })
    editor('RST', fakeClient(undefined, { getVersion }))
    expect(await screen.findByText('We couldn’t load this rule version.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Wage rates · Version 2' })).toBeInTheDocument()
    expect(screen.getByText('No scenarios use an earlier version, so none will be marked stale.')).toBeInTheDocument()
  })
})
