import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { ACTIVE_ROLE_HEADER, createMockAdapter, type ApiAdapter, type ApiRequest } from '@/api'
import { renderApp, useLaptopViewport } from '@/test/app'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

const rowOf = async (name: string) => (await screen.findByRole('link', { name })).closest('tr')!

/** The mock API, with `GET /scenarios` (the list) answered by `list` instead. */
function withList(list: (request: ApiRequest) => Promise<{ status: number; body: unknown }>, log: ApiRequest[] = []): ApiAdapter {
  const base = createMockAdapter({ log })
  return (request) => (request.method === 'GET' && /^\/scenarios(\?|$)/.test(request.path) ? list(request) : base(request))
}

describe('SCR-030 Scenario list', () => {
  it('lists scenarios with ★, status, stale pills and rules version, and passes axe', async () => {
    const { container, log } = renderApp({ path: '/scenarios', role: 'PLN' })
    const v3 = await rowOf('Christmas 2026 v3')
    expect(within(v3).getByRole('img', { name: 'Published scenario' })).toBeInTheDocument()
    expect(within(v3).getByText('Published')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Rules version' })).toBeInTheDocument()
    // The "+" glyph is decorative: the button is named by its text only.
    expect(screen.getByRole('button', { name: 'New scenario' })).toBeInTheDocument()
    expect(screen.getByRole('search', { name: 'Filter scenarios' })).toBeInTheDocument()
    const v4 = await rowOf('Christmas 2026 v5 (what-if)')
    expect(within(v4).getByText('Stale')).toBeInTheDocument()
    // A stale draft shows Submit disabled with the reason, plus Recalculate and Archive; no redundant Open.
    const submit = within(v4).getByRole('button', { name: 'Submit: Christmas 2026 v5 (what-if)' })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAccessibleDescription('Recalculate first: this scenario is stale.')
    expect(within(v4).getByRole('button', { name: 'Recalculate: Christmas 2026 v5 (what-if)' })).toBeInTheDocument()
    expect(within(v4).getByRole('button', { name: 'Archive: Christmas 2026 v5 (what-if)' })).toBeInTheDocument()
    expect(within(v4).queryByRole('button', { name: /^Open/ })).toBeNull()
    // Published scenarios can't be archived.
    expect(within(v3).queryByRole('button', { name: /^Archive/ })).toBeNull()
    expect(log.find((r) => r.path.startsWith('/scenarios'))?.headers[ACTIVE_ROLE_HEADER]).toBe('PLN')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('recalculates a stale draft from its row', async () => {
    const user = userEvent.setup()
    const { log } = renderApp({ path: '/scenarios', role: 'PLN' })
    const v4 = await rowOf('Christmas 2026 v5 (what-if)')
    await user.click(within(v4).getByRole('button', { name: 'Recalculate: Christmas 2026 v5 (what-if)' }))
    expect(await screen.findByText('“Christmas 2026 v5 (what-if)” recalculated')).toBeInTheDocument()
    expect(log.some((r) => r.method === 'POST' && r.path.endsWith('/run'))).toBe(true)
    await waitFor(async () => expect(within(await rowOf('Christmas 2026 v5 (what-if)')).queryByText('Stale')).toBeNull())
  })

  it('asks before archiving', async () => {
    const user = userEvent.setup()
    const { log } = renderApp({ path: '/scenarios', role: 'PLN' })
    const v4 = await rowOf('Christmas 2026 v5 (what-if)')
    await user.click(within(v4).getByRole('button', { name: 'Archive: Christmas 2026 v5 (what-if)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive “Christmas 2026 v5 (what-if)”?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(log.some((r) => r.path.endsWith('/archive'))).toBe(false)
    await user.click(within(v4).getByRole('button', { name: 'Archive: Christmas 2026 v5 (what-if)' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive scenario' }))
    expect(await screen.findByText('“Christmas 2026 v5 (what-if)” archived')).toBeInTheDocument()
    expect(log.filter((r) => r.path.endsWith('/archive'))).toHaveLength(1)
  })

  it('debounces the search box and syncs the URL once typing settles', async () => {
    const user = userEvent.setup()
    const { log } = renderApp({ path: '/scenarios', role: 'PLN' })
    await rowOf('Christmas 2026 v3')
    await user.type(screen.getByRole('searchbox', { name: 'Search scenarios' }), 'v4')
    expect(window.location.search).toBe('')
    await waitFor(() => expect(window.location.search).toBe('?q=v4'))
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Christmas 2026 v3' })).toBeNull())
    const searches = log.filter((r) => r.method === 'GET' && r.path.includes('q='))
    expect(searches.map((r) => r.path)).toEqual(['/scenarios?q=v4'])
  })

  it('filters stale only and syncs the URL', async () => {
    renderApp({ path: '/scenarios', role: 'PLN' })
    await rowOf('Christmas 2026 v3')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Stale only' }))
    expect(window.location.search).toBe('?stale=true')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Christmas 2026 v3' })).toBeNull())
    expect(screen.getByRole('link', { name: 'Christmas 2026 v5 (what-if)' })).toBeInTheDocument()
  })

  it('filters by owner and offers Clear filters when nothing matches', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/scenarios?q=zzz', role: 'PLN' })
    expect(await screen.findByText('No scenarios match these filters')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(window.location.search).toBe('')
    expect(await screen.findByRole('link', { name: 'Christmas 2026 v3' })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Owner' }), 'me')
    expect(window.location.search).toBe('?owner=me')
  })

  it('shows a first-run empty state with the create action when there are no scenarios', async () => {
    renderApp({
      path: '/scenarios',
      role: 'PLN',
      adapter: withList(() => Promise.resolve({ status: 200, body: { scenarios: [] } })),
    })
    expect(await screen.findByText('No scenarios yet')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'New scenario' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('ignores a slower, stale list response', async () => {
    const pending: Record<string, (v: { status: number; body: unknown }) => void> = {}
    const adapter = withList(
      (request) =>
        new Promise((resolve, reject) => {
          pending[request.path] = resolve
          request.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )
    const user = userEvent.setup()
    renderApp({ path: '/scenarios', role: 'PLN', adapter })
    await waitFor(() => expect(pending['/scenarios']).toBeDefined())
    await user.click(screen.getByRole('checkbox', { name: 'Stale only' }))
    await waitFor(() => expect(pending['/scenarios?stale=true']).toBeDefined())
    const item = (name: string) => ({
      id: name, name, season: 'christmas-2026', status: 'draft', isPublished: false, stale: false, staleReasons: [],
      ownerId: 'u', ownerName: 'Ana Reyes', parentScenarioId: null, planningFrom: '2026-12-01', planningTo: '2026-12-31',
      dataAsOf: null, rulesAsOf: null, lastRunAt: null, updatedAt: '2026-09-01T00:00:00Z', synthetic: true,
    })
    pending['/scenarios?stale=true']?.({ status: 200, body: { scenarios: [item('Fresh')] } })
    pending['/scenarios']?.({ status: 200, body: { scenarios: [item('Old')] } })
    expect(await screen.findByRole('link', { name: 'Fresh' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Old' })).toBeNull()
  })

  it('creates a scenario from a season list and opens its settings', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/scenarios', role: 'PLN' })
    await rowOf('Christmas 2026 v3')
    await user.click(screen.getByRole('button', { name: 'New scenario' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('combobox', { name: /^Season/ })).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/^Name/), 'Christmas 2026 v5')
    await user.click(within(dialog).getByRole('button', { name: 'Create scenario' }))
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/scenarios\/scn-new-\d+\/settings$/))
    expect(await screen.findByRole('heading', { level: 1, name: 'Christmas 2026 v5' })).toBeInTheDocument()
  })

  it('hides planner actions from other roles; Compare defaults B to the published scenario', async () => {
    renderApp({ path: '/scenarios', role: 'FIN' })
    const v4 = await rowOf('Christmas 2026 v4')
    expect(screen.queryByRole('button', { name: 'New scenario' })).toBeNull()
    expect(within(v4).queryByRole('button', { name: /Duplicate/ })).toBeNull()
    expect(within(v4).queryByRole('button', { name: /^Submit/ })).toBeNull()
    await userEvent.click(within(v4).getByRole('button', { name: 'Compare: Christmas 2026 v4' }))
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/scenarios/compare?a=scn-xmas-2026-v4&b=scn-xmas-2026-v3'))
  })

  it('links a store manager to screens they can open', async () => {
    renderApp({ path: '/scenarios', role: 'STM' })
    const v3 = await rowOf('Christmas 2026 v3')
    expect(within(v3).getByRole('link', { name: 'Christmas 2026 v3' })).toHaveAttribute('href', '/plan/hiring')
    expect(within(v3).queryByRole('button', { name: /^Compare/ })).toBeNull()
  })

  it('is read-only on a phone', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    renderApp({ path: '/scenarios', role: 'PLN' })
    expect(await screen.findByText('Read-only on a phone. Open on a tablet or computer to edit.')).toBeInTheDocument()
    await rowOf('Christmas 2026 v4')
    expect(screen.queryByRole('button', { name: 'New scenario' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Archive/ })).toBeNull()
  })
})

describe('SCR-031 Scenario settings', () => {
  it('shows a stale draft with reasons; Recalculate runs it and unblocks Submit', async () => {
    const user = userEvent.setup()
    const { container } = renderApp({ path: '/scenarios/scn-xmas-2026-v5/settings', role: 'PLN' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Christmas 2026 v5 (what-if)' })).toBeInTheDocument()
    expect(screen.getByText('A newer data snapshot has been loaded')).toBeInTheDocument()
    expect(screen.getByLabelText('Volume growth (%)')).toHaveValue(12)
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeDisabled()
    expect(screen.getByText('Recalculate first: this scenario is stale.')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
    await user.click(screen.getByRole('button', { name: 'Recalculate' }))
    expect(await screen.findByText('Run complete')).toBeInTheDocument()
    expect(screen.queryByText('A newer data snapshot has been loaded')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }))
    expect(await screen.findByText('Submitted for approval')).toBeInTheDocument()
    expect(screen.getByText('This scenario is read-only')).toBeInTheDocument()
  })

  it('has a section nav, fieldsets per section and a rules and data summary with links', async () => {
    renderApp({ path: '/scenarios/scn-xmas-2026-v5/settings', role: 'PLN' })
    await screen.findByRole('heading', { level: 1, name: 'Christmas 2026 v5 (what-if)' })
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('link', { name: 'Demand' })).toHaveAttribute('href', '#scn-demand')
    expect(within(nav).getByRole('link', { name: 'Labor rules (roster)' })).toHaveAttribute('href', '#scn-labor')
    for (const name of ['Demand', 'Service and labor standards', 'Shift rules', 'Labor rules (roster)', 'Season', 'Notes']) {
      expect(screen.getByRole('group', { name })).toBeInTheDocument()
    }
    const rules = screen.getByRole('region', { name: 'Rules and data' })
    expect(within(rules).getByRole('link', { name: 'Open rule sets' })).toHaveAttribute('href', '/rules')
    expect(within(rules).getByRole('link', { name: 'Open data sources' })).toHaveAttribute('href', '/data/sources')
    // The results carry the "as of last run" caveat while the scenario is stale.
    expect(screen.getByText(/Results as of the last run, .*They are stale/)).toBeInTheDocument()
  })

  it('edits an override: marks it edited against the rule default and saves it', async () => {
    const user = userEvent.setup()
    const { log } = renderApp({ path: '/scenarios/scn-xmas-2026-v5/settings', role: 'PLN' })
    const days = await screen.findByLabelText('FT max days / week')
    expect(days).toHaveValue(null)
    expect(days).toHaveAccessibleDescription('Default 6')
    await user.type(days, '5')
    expect(days).toHaveAccessibleDescription('Edited · default 6')
    // Unsaved edits block Submit with their own reason.
    expect(screen.getByText('Save and run first: you have unsaved changes.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Settings saved')).toBeInTheDocument()
    const patch = log.find((r) => r.method === 'PATCH')
    expect((patch?.body as { settings: { ftMaxDaysPerWeek: number | null; ftMaxHoursPerWeek: number | null } }).settings).toMatchObject({
      ftMaxDaysPerWeek: 5,
      ftMaxHoursPerWeek: null,
    })
  })

  it('validates a field when it loses focus and on save', async () => {
    const user = userEvent.setup()
    const { log } = renderApp({ path: '/scenarios/scn-xmas-2026-v5/settings', role: 'PLN' })
    const growth = await screen.findByLabelText('Volume growth (%)')
    await user.clear(growth)
    await user.type(growth, '300')
    await user.tab()
    expect(await screen.findByText('Enter a growth from -50 to 100 %.')).toBeInTheDocument()
    expect(growth).toHaveAttribute('aria-invalid', 'true')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(log.some((r) => r.method === 'PATCH')).toBe(false)
    await user.clear(growth)
    await user.type(growth, '10')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Settings saved')).toBeInTheDocument()
    const patch = log.find((r) => r.method === 'PATCH')
    expect((patch?.body as { settings: { growth: number } }).settings.growth).toBe(1.1)
  })

  it('submits the form with Enter', async () => {
    const user = userEvent.setup()
    const { log } = renderApp({ path: '/scenarios/scn-xmas-2026-v5/settings', role: 'PLN' })
    const growth = await screen.findByLabelText('Volume growth (%)')
    await user.clear(growth)
    await user.type(growth, '9{Enter}')
    expect(await screen.findByText('Settings saved')).toBeInTheDocument()
    expect(log.filter((r) => r.method === 'PATCH')).toHaveLength(1)
  })

  it('confirms before discarding edits', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/scenarios/scn-xmas-2026-v5/settings', role: 'PLN' })
    const growth = await screen.findByLabelText('Volume growth (%)')
    await user.clear(growth)
    await user.type(growth, '15')
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    const dialog = await screen.findByRole('dialog', { name: 'Discard changes?' })
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(growth).toHaveValue(15)
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
    expect(growth).toHaveValue(12)
  })

  it('warns before the browser leaves with unsaved edits', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/scenarios/scn-xmas-2026-v5/settings', role: 'PLN' })
    const growth = await screen.findByLabelText('Volume growth (%)')
    const unload = () => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    }
    expect(unload()).toBe(false)
    await user.type(growth, '1')
    expect(unload()).toBe(true)
  })

  it('is read-only when published and offers Duplicate as draft', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/scenarios/scn-xmas-2026-v3/settings', role: 'PLN' })
    expect(await screen.findByText('This scenario is read-only')).toBeInTheDocument()
    expect(screen.getByLabelText('Volume growth (%)')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    // Results with cost for the planner.
    expect(screen.getByRole('table', { name: 'Results by store' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Duplicate as draft' }))
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/scenarios\/scn-new-\d+\/settings$/))
    expect(await screen.findByRole('heading', { level: 1, name: 'Christmas 2026 v3 (copy)' })).toBeInTheDocument()
  })

  it('is read-only for a role that cannot edit', async () => {
    renderApp({ path: '/scenarios/scn-xmas-2026-v3/settings', role: 'FIN' })
    expect(await screen.findByText('Read-only for your role.')).toBeInTheDocument()
    expect(screen.getByLabelText('FT max days / week')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Duplicate as draft' })).toBeNull()
  })

  it('shows an error state for an unknown scenario', async () => {
    renderApp({ path: '/scenarios/nope/settings', role: 'PLN' })
    expect(await screen.findByText('We couldn’t load this scenario.')).toBeInTheDocument()
  })
})

describe('SCR-032 Compare', () => {
  it('shows an empty state until two scenarios are picked', async () => {
    renderApp({ path: '/scenarios/compare', role: 'EXE' })
    expect(await screen.findByText('Pick two scenarios')).toBeInTheDocument()
  })

  it('compares A and the published B: headline table, settings diff and grouped by-store, and passes axe', async () => {
    const user = userEvent.setup()
    const { container } = renderApp({ path: '/scenarios/compare?a=scn-xmas-2026-v5', role: 'PLN' })
    await waitFor(() => expect(window.location.search).toBe('?a=scn-xmas-2026-v5&b=scn-xmas-2026-v3'))
    const headline = await screen.findByRole('table', { name: 'Headline differences' })
    for (const name of ['Seasonal hires', 'Peak-season team', 'Season cost', 'First needed by']) {
      expect(within(headline).getByRole('rowheader', { name })).toBeInTheDocument()
    }
    const team = within(headline).getByRole('rowheader', { name: 'Peak-season team' }).closest('tr')!
    expect(within(team).getAllByRole('cell').map((c) => c.textContent)).toEqual(['570', '534', '-36'])
    const settings = screen.getByRole('table', { name: 'Settings that differ' })
    const growth = within(settings).getByRole('rowheader', { name: 'Volume growth (%)' }).closest('tr')!
    expect(within(growth).getByText('+12 %')).toBeInTheDocument()
    expect(within(growth).getByText('+5 %')).toBeInTheDocument()
    const byStore = screen.getByRole('table', { name: 'By store' })
    expect(within(byStore).getByRole('columnheader', { name: 'Seasonal hires' })).toHaveAttribute('scope', 'colgroup')
    expect(within(byStore).getByRole('columnheader', { name: 'Season cost' })).toHaveAttribute('scope', 'colgroup')
    expect(await axe(container)).toHaveNoViolations()
    // A can't be picked as B, and Swap exchanges them.
    expect(within(screen.getByLabelText('Scenario B')).getByRole('option', { name: /Christmas 2026 v5 \(what-if\)/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Swap' }))
    expect(window.location.search).toBe('?a=scn-xmas-2026-v3&b=scn-xmas-2026-v5')
  })

  it('asks for two different scenarios when A and B are the same', async () => {
    renderApp({ path: '/scenarios/compare?a=scn-xmas-2026-v3&b=scn-xmas-2026-v3', role: 'PLN' })
    expect(await screen.findByText('Pick two different scenarios to compare.')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Headline differences' })).toBeNull()
  })

  it('offers Retry when the comparison or the picker list fails', async () => {
    const user = userEvent.setup()
    let failList = true
    const adapter = withList((request) =>
      failList
        ? Promise.resolve({ status: 500, body: { error: { code: 'internal', message: 'boom', requestId: 'req-1' } } })
        : createMockAdapter()(request),
    )
    renderApp({ path: '/scenarios/compare?a=nope&b=scn-xmas-2026-v3', role: 'PLN', adapter })
    expect(await screen.findByText('We couldn’t load the scenarios to choose from.')).toBeInTheDocument()
    expect(await screen.findByText('We couldn’t compare these scenarios.')).toBeInTheDocument()
    failList = false
    const retries = screen.getAllByRole('button', { name: 'Try again' })
    expect(retries).toHaveLength(2)
    await user.click(retries[0]!)
    await waitFor(() => expect(screen.queryByText('We couldn’t load the scenarios to choose from.')).toBeNull())
  })
})
