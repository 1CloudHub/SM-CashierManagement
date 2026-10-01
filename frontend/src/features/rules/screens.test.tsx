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
    submittedBy: null,
    submittedByName: null,
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
    approveAndPublish: vi.fn(async () => ({
      version: update({ status: 'published', financeApprovedAt: '2026-10-01T00:00:00Z' }),
      supersededVersionId: 'v1',
      staleScenarioIds: ['s1', 's2'],
    })),
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
    expect(onOpen).toHaveBeenCalledWith('v1', 'set-wages')
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
    expect(onOpen).toHaveBeenCalledWith('v2', 'set-wages')
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
    // Read-only values are text, not inputs, and carry no required marks.
    expect(screen.getByText('Default base rate (₱/h)').tagName).toBe('DT')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText('(required)')).toBeNull()
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
    expect(within(dialog).getByText(/Planners, Finance, HR and the owners of those scenarios will be notified/)).toBeInTheDocument()
    expect(within(dialog).getByText(/can’t be undone/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Approve and publish' }))
    // One atomic server operation, never approve then publish.
    await waitFor(() => expect(client.approveAndPublish).toHaveBeenCalledWith('v2'))
    expect(client.approve).not.toHaveBeenCalled()
    expect(client.publish).not.toHaveBeenCalled()
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

describe('SCR-061 approved cost rule (RBAC matrix)', () => {
  it('only Finance can publish it; the Rules Steward sees it read-only', async () => {
    const { unmount } = editor('RST', fakeClient(detail('approved', { financeApprovedAt: '2026-10-01T00:00:00Z' })))
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    unmount()
    editor('FIN', fakeClient(detail('approved', { financeApprovedAt: '2026-10-01T00:00:00Z' })))
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeInTheDocument()
  })
})

describe('SCR-061 review fixes', () => {
  it('shows region rates as a table with the previous value', async () => {
    editor('RST', fakeClient())
    const table = await screen.findByRole('table', { name: 'Base rate by region (₱/h)' })
    expect(within(table).getByRole('columnheader', { name: 'Region' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Was' })).toBeInTheDocument()
    const row = within(table).getByRole('rowheader', { name: 'NCR' }).closest('tr')!
    expect(within(row).getByRole('textbox', { name: 'Base rate by region (₱/h) › NCR' })).toHaveValue('86.875')
    expect(within(row).getByText('80')).toBeInTheDocument()
  })

  it('reports an atomic approve-and-publish failure as nothing changed', async () => {
    const user = userEvent.setup()
    const approveAndPublish = vi.fn(async () => {
      throw new RulesApiError(409, { error: { code: 'conflict', message: 'x', requestId: 'r' } })
    })
    editor('FIN', fakeClient(detail('submitted'), { approveAndPublish }))
    await user.click(await screen.findByRole('button', { name: 'Approve and publish' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve and publish' }))
    expect(await screen.findByText(/Nothing was approved or published/)).toBeInTheDocument()
  })

  it('maps a 403 on load to the no-access state', async () => {
    const getVersion = vi.fn(async () => {
      throw new RulesApiError(403, { error: { code: 'forbidden', message: 'x', requestId: 'r' } })
    })
    editor('PLN', fakeClient(undefined, { getVersion }))
    expect(await screen.findByText('Your role doesn’t include business rules.')).toBeInTheDocument()
  })

  it('invalid advanced JSON disables Save and Submit and is announced', async () => {
    const user = userEvent.setup()
    editor('RST', fakeClient())
    await user.click(await screen.findByRole('button', { name: /Edit as JSON/ }))
    const area = screen.getByLabelText('Rule values as JSON')
    await user.type(area, '{{')
    expect(await screen.findByRole('alert')).toHaveTextContent('The JSON isn’t valid')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Submit to Finance' })).toBeDisabled()
  })

  it('names who submitted and approved, with dates', async () => {
    editor(
      'PLN',
      fakeClient(
        detail('approved', {
          submittedAt: '2026-10-03T02:00:00Z',
          submittedByName: 'R. Santos',
          financeApprovedAt: '2026-10-04T02:00:00Z',
          financeApprovedByName: 'F. Reyes',
        }),
      ),
    )
    expect(await screen.findByText(/Done · R\. Santos · Oct 3, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Done · F\. Reyes · Oct 4, 2026/)).toBeInTheDocument()
  })

  it('asks before discarding edits, and clears a success notice on the next edit', async () => {
    const user = userEvent.setup()
    const client = fakeClient()
    editor('RST', client)
    const input = await screen.findByLabelText('Employer on-cost loading')
    await user.clear(input)
    await user.type(input, '0.2')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Employer on-cost loading'), '5')
    expect(screen.queryByText('Draft saved.')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    const dialog = await screen.findByRole('dialog', { name: 'Discard your changes?' })
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Employer on-cost loading')).toHaveValue('0.25')
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.getByLabelText('Employer on-cost loading')).toHaveValue('0.2'))
  })

  it('lists errors without a field of their own in a danger alert with readable labels', async () => {
    const user = userEvent.setup()
    const saveDraft = vi.fn(async () => {
      throw new RulesApiError(422, {
        error: {
          code: 'validation_failed',
          message: 'x',
          requestId: 'r',
          details: [{ path: 'body.payload.dayTypeMultiplier.special', message: 'Required.' }],
        },
      })
    })
    editor('RST', fakeClient(undefined, { saveDraft }))
    const input = await screen.findByLabelText('Employer on-cost loading')
    await user.type(input, '1')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Fix these values')).toBeInTheDocument()
    expect(screen.getByText('Day-type multiplier › Special day: Required.')).toBeInTheDocument()
  })

  it('Finance cannot publish a version without a change note', async () => {
    editor('FIN', fakeClient(detail('submitted', { changeNote: '' })))
    expect(await screen.findByRole('button', { name: 'Approve and publish' })).toBeDisabled()
    expect(screen.getByText(/has no change note, so it can’t be published/)).toBeInTheDocument()
  })

  it('formats diff values (numbers and yes/no)', async () => {
    const getDiff = vi.fn(async () => ({
      fromVersionId: 'v1',
      toVersionId: 'v2',
      changes: [
        { path: ['defaultHourlyRate'], kind: 'changed' as const, before: 1234.5, after: 1300 },
        { path: ['employerLoading'], kind: 'changed' as const, before: true, after: false },
      ],
    }))
    editor('PLN', fakeClient(undefined, { getDiff }))
    const table = await screen.findByRole('table', { name: 'Changed rule values' })
    expect(within(table).getByText('1,234.5')).toBeInTheDocument()
    expect(within(table).getByText('1,300')).toBeInTheDocument()
    expect(within(table).getByText('Yes')).toBeInTheDocument()
    expect(within(table).getByText('No')).toBeInTheDocument()
  })

  it('is read-only on a phone', async () => {
    const original = window.matchMedia
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    try {
      editor('RST', fakeClient())
      expect(await screen.findByText('Read-only on a phone. Open on a tablet or computer to edit.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Submit to Finance' })).toBeNull()
      expect(screen.queryByRole('textbox')).toBeNull()
    } finally {
      window.matchMedia = original
    }
  })
})

describe('SCR-060 review fixes', () => {
  it('defaults the effective date to the local date, not UTC', async () => {
    const { localTodayIso } = await import('./logic')
    expect(localTodayIso(new Date(2026, 9, 1, 0, 30))).toBe('2026-10-01')
  })

  it('maps a 403 to the no-access state', async () => {
    const listRuleSets = vi.fn(async () => {
      throw new RulesApiError(403, { error: { code: 'forbidden', message: 'x', requestId: 'r' } })
    })
    renderUi(<RuleSetsScreen client={fakeClient(undefined, { listRuleSets })} role="PLN" onOpenVersion={() => undefined} />)
    expect(await screen.findByText('Your role doesn’t include business rules.')).toBeInTheDocument()
  })

  it('new draft dialog clears its error on edit and cannot close while creating', async () => {
    const user = userEvent.setup()
    let resolve: (v: RuleVersionDetail) => void = () => undefined
    const createDraft = vi
      .fn()
      .mockRejectedValueOnce(new RulesApiError(409, { error: { code: 'conflict', message: 'x', requestId: 'r' } }))
      .mockImplementationOnce(() => new Promise<RuleVersionDetail>((r) => (resolve = r)))
    const onOpen = vi.fn()
    renderUi(<RuleSetsScreen client={fakeClient(undefined, { createDraft })} role="RST" onOpenVersion={onOpen} today="2026-10-01" />)
    await user.click(await screen.findByRole('button', { name: 'New draft: Wage rates' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Create draft' }))
    expect(await within(dialog).findByText('Someone changed this version. Reload it and try again.')).toBeInTheDocument()
    const date = within(dialog).getByLabelText(/Effective from/)
    await user.clear(date)
    await user.type(date, '2026-11-01')
    expect(within(dialog).queryByText('Someone changed this version. Reload it and try again.')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: /Create draft/ }))
    expect(within(dialog).getByRole('button', { name: /Create draft/ })).toHaveAttribute('aria-busy', 'true')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    resolve(detail('draft'))
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('v2', 'set-wages'))
  })
})
