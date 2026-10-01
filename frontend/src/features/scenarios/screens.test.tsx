import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { ACTIVE_ROLE_HEADER } from '@/api'
import { renderApp, useLaptopViewport } from '@/test/app'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

const rowOf = async (name: string) => (await screen.findByRole('link', { name })).closest('tr')!

describe('SCR-030 Scenario list', () => {
  it('lists scenarios with ★, status and stale pills, and passes axe', async () => {
    const { container, log } = renderApp({ path: '/scenarios', role: 'PLN' })
    const v3 = await rowOf('Christmas 2026 v3')
    expect(within(v3).getByRole('img', { name: 'Published scenario' })).toBeInTheDocument()
    expect(within(v3).getByText('Published')).toBeInTheDocument()
    const v4 = await rowOf('Christmas 2026 v4')
    expect(within(v4).getByText('Stale')).toBeInTheDocument()
    // A stale draft can't be submitted, but can be archived.
    expect(within(v4).queryByRole('button', { name: /^Submit/ })).toBeNull()
    expect(within(v4).getByRole('button', { name: 'Archive: Christmas 2026 v4' })).toBeInTheDocument()
    expect(log.find((r) => r.path.startsWith('/scenarios'))?.headers[ACTIVE_ROLE_HEADER]).toBe('PLN')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('filters stale only and syncs the URL', async () => {
    renderApp({ path: '/scenarios', role: 'PLN' })
    await rowOf('Christmas 2026 v3')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Stale only' }))
    expect(window.location.search).toBe('?stale=true')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Christmas 2026 v3' })).toBeNull())
    expect(screen.getByRole('link', { name: 'Christmas 2026 v4' })).toBeInTheDocument()
  })

  it('creates a scenario and opens its settings', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/scenarios', role: 'PLN' })
    await rowOf('Christmas 2026 v3')
    await user.click(screen.getByRole('button', { name: /New scenario/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Name/), 'Christmas 2026 v5')
    await user.click(within(dialog).getByRole('button', { name: 'Create scenario' }))
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/scenarios\/scn-new-\d+\/settings$/))
    expect(await screen.findByRole('heading', { level: 1, name: 'Christmas 2026 v5' })).toBeInTheDocument()
  })

  it('hides planner actions from other roles', async () => {
    renderApp({ path: '/scenarios', role: 'FIN' })
    const v4 = await rowOf('Christmas 2026 v4')
    expect(screen.queryByRole('button', { name: /New scenario/ })).toBeNull()
    expect(within(v4).queryByRole('button', { name: /Duplicate/ })).toBeNull()
    await userEvent.click(within(v4).getByRole('button', { name: 'Compare: Christmas 2026 v4' }))
    expect(window.location.pathname + window.location.search).toBe('/scenarios/compare?a=scn-xmas-2026-v4')
  })
})

describe('SCR-031 Scenario settings', () => {
  it('shows a stale draft with reasons; Recalculate runs it and unblocks Submit', async () => {
    const user = userEvent.setup()
    const { container } = renderApp({ path: '/scenarios/scn-xmas-2026-v4/settings', role: 'PLN' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Christmas 2026 v4' })).toBeInTheDocument()
    expect(screen.getByText('A newer data snapshot has been loaded')).toBeInTheDocument()
    expect(screen.getByLabelText('Volume growth (%)')).toHaveValue(8)
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

  it('validates settings on the client before saving', async () => {
    const user = userEvent.setup()
    const { log } = renderApp({ path: '/scenarios/scn-xmas-2026-v4/settings', role: 'PLN' })
    const growth = await screen.findByLabelText('Volume growth (%)')
    await user.clear(growth)
    await user.type(growth, '300')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter a growth from -50 to 100 %.')).toBeInTheDocument()
    expect(growth).toHaveAttribute('aria-invalid', 'true')
    expect(log.some((r) => r.method === 'PATCH')).toBe(false)
    await user.clear(growth)
    await user.type(growth, '10')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Settings saved')).toBeInTheDocument()
    const patch = log.find((r) => r.method === 'PATCH')
    expect((patch?.body as { settings: { growth: number } }).settings.growth).toBe(1.1)
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

  it('compares A and B: KPI deltas, settings diff and by-store, and passes axe', async () => {
    const user = userEvent.setup()
    const { container } = renderApp({ path: '/scenarios/compare?a=scn-xmas-2026-v3', role: 'PLN' })
    const b = await screen.findByLabelText('Scenario B')
    await waitFor(() => expect(within(b).getByRole('option', { name: 'Christmas 2026 v4' })).toBeInTheDocument())
    await user.selectOptions(b, 'scn-xmas-2026-v4')
    expect(window.location.search).toBe('?a=scn-xmas-2026-v3&b=scn-xmas-2026-v4')
    const settings = await screen.findByRole('table', { name: 'Settings that differ' })
    const growth = within(settings).getByRole('rowheader', { name: 'Volume growth (%)' }).closest('tr')!
    expect(within(growth).getByText('+5 %')).toBeInTheDocument()
    expect(within(growth).getByText('+8 %')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'By store' })).toBeInTheDocument()
    // Headcount A 132 → B 136 (+4) with the sign.
    expect(screen.getByText('132 → 136 (+4)')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})
