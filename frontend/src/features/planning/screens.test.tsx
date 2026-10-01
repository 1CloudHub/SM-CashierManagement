import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HiringPlanView, PlanningJob } from '@lanewise/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { ActiveRoleProvider } from '@/app/active-role'
import { storeRole } from '@/app/active-role-storage'
import { RouterProvider } from '@/app/router'
import { AnnouncerProvider } from '@/components/a11y'
import { I18nProvider } from '@/i18n'
import { renderApp, useLaptopViewport } from '@/test/app'
import type { PlanningClient } from './api'
import { HiringScreen } from './hiring-screen'
import { SummaryScreen } from './summary-screen'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

describe('SCR-020 network view (Req 5.1, 5.3, 5.4)', () => {
  it('shows every in-scope store and department with KPIs, over-capacity and a valued heatmap', async () => {
    const { container } = renderApp({ path: '/plan/network?date=2026-12-19', role: 'PLN' })
    expect(await screen.findByText('Peak cashiers on lanes')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'All stores and departments' })).toBeInTheDocument()
    expect(screen.getByText('6 stores · 18 departments')).toBeInTheDocument()
    // Cebu main lanes are over capacity on Dec 19 (wireframe example).
    expect(screen.getByText('Over installed lanes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^SM Supermarket – Cebu City · Main checkout lanes: needs \d+, has 20/ })).toBeInTheDocument()
    const heatmap = screen.getByRole('table', { name: 'Lane-capacity pressure by department and hour' })
    // Every heatmap cell prints its value and has a text band, never colour alone.
    const cebu = within(heatmap).getByRole('row', { name: /SM Supermarket – Cebu City · Main checkout lanes/ })
    expect(within(cebu).getAllByText(/over capacity/).length).toBeGreaterThan(0)
    const link = within(cebu).getByRole('link')
    expect(link.getAttribute('href')).toBe('/plan/department?store=st-cebu&dept=st-cebu-d1&date=2026-12-19')
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('offers each chart as a table', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/plan/network', role: 'HR' })
    await screen.findByText('Peak cashiers on lanes')
    const toggle = screen.getByRole('button', { name: 'View as table' })
    await user.click(toggle)
    expect(screen.getByRole('table', { name: 'Cashiers needed on lanes by hour' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View as chart' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a Store Manager sees only their store, no network ₱ and no export (P1, Req 25.1)', async () => {
    renderApp({ path: '/plan/network', role: 'STM' })
    expect(await screen.findByText('1 stores · 3 departments')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Staffing plan by store and department' })
    expect(within(table).queryByText(/Cebu/)).toBeNull()
    expect(within(table).getAllByText(/₱/).length).toBeGreaterThan(0) // own store cost
    expect(screen.getAllByText('Hidden for your role').length).toBeGreaterThan(0) // network KPI
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull()
  })

  it('sorts by capacity pressure through the URL (P8)', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/plan/network', role: 'PLN' })
    await screen.findByText('Peak cashiers on lanes')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'pressure')
    expect(window.location.search).toContain('sort=pressure')
  })
})

describe('SCR-021 department day plan (Req 5.2)', () => {
  it('shows the hourly plan and the shift builder', async () => {
    const { container } = renderApp({ path: '/plan/department?store=st-cebu&dept=st-cebu-d1&date=2026-12-19', role: 'PLN' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Main checkout lanes — SM Supermarket – Cebu City' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Shift builder — suggested shifts' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open weekly roster' })).toHaveAttribute('href', '/plan/roster?store=st-cebu&dept=st-cebu-d1')
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  }, 20_000) // renders the full day plan and an axe pass: ~6 s on CI-sized runners

  it('asks for a department when none is chosen', async () => {
    renderApp({ path: '/plan/department', role: 'STM' })
    expect(await screen.findByText('Pick a store and department')).toBeInTheDocument()
  })

  it('builds the season roster as a background job for planners', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/plan/department?store=st-qc&dept=st-qc-d1&date=2026-12-19', role: 'PLN' })
    const run = await screen.findByRole('button', { name: 'Build season roster' })
    await user.click(run)
    expect(await screen.findByRole('progressbar', { name: 'Calculation progress' })).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Season roster (background)' }, { timeout: 8000 })).toBeInTheDocument()
  }, 15_000)
})

function job(status: PlanningJob['status'], unitsDone: number): PlanningJob {
  return {
    id: 'job-1',
    type: 'hiring_plan',
    scenarioId: 'scn-1',
    status,
    progress: unitsDone / 24,
    unitsDone,
    unitsTotal: 24,
    createdAt: '2026-10-01T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
    from: '2026-12-01',
    to: '2026-12-31',
  }
}

const provenance = {
  scenarioId: 'scn-1',
  scenarioName: 'Christmas 2026 v4',
  scenarioStatus: 'draft',
  runId: null,
  runAt: null,
  snapshotIds: {},
  ruleVersionIds: [],
  synthetic: true,
  stale: false,
}

function renderScreen(ui: React.ReactNode, role: 'PLN' | 'EXE' = 'PLN') {
  storeRole(role)
  return render(
    <I18nProvider initialLocale="en">
      <AnnouncerProvider>
        <RouterProvider>
          <ActiveRoleProvider demo>{ui}</ActiveRoleProvider>
        </RouterProvider>
      </AnnouncerProvider>
    </I18nProvider>,
  )
}

describe('SCR-023 hiring plan as a background job (Req 10.1, 10.2)', () => {
  it('runs the plan, shows department progress, then the plan when the job finishes', async () => {
    const user = userEvent.setup()
    const done: HiringPlanView = {
      provenance: { ...provenance, runId: 'job-1', runAt: '2026-10-01T00:00:00Z' },
      job: job('succeeded', 24),
      from: '2026-12-01',
      to: '2026-12-31',
      plan: {
        kpis: { seasonalHires: 284, hiresByType: { FT: 176, PT: 108, FLOAT: 0 }, baselineTeam: 463, peakTeam: 747, firstNeededBy: '2026-11-02', recruitFrom: '2026-09-21', seasonPaidHours: 147000 },
        timeline: [{ date: '2026-10-05', name: 'Offers accepted', contractType: 'FT', count: 176, waveId: 'w1', status: 'due_soon' }],
        stores: [],
      },
    }
    let calls = 0
    const client = {
      hiringPlan: vi.fn(async () => (calls++ === 0 ? { provenance, job: null, from: '2026-12-01', to: '2026-12-31', plan: null } : done)),
      runHiringPlan: vi.fn(async () => ({ job: job('running', 14), cached: false })),
      hiringJob: vi.fn(async () => job('succeeded', 24)),
      scenarios: vi.fn(),
    } as unknown as PlanningClient
    const { container } = renderScreen(<HiringScreen client={client} role="PLN" state={{ scenario: 'scn-1' }} />)
    expect(await screen.findByText('No hiring plan for this scenario yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Run hiring plan' }))
    const bar = await screen.findByRole('progressbar', { name: 'Calculation progress' })
    expect(bar).toHaveAttribute('aria-valuetext', '14 of 24 departments')
    expect(screen.getByText(/You can leave this page/)).toBeInTheDocument()
    expect(await screen.findByText('Seasonal hires needed', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByText('284')).toBeInTheDocument()
    expect(screen.getByText('Due within 7 days')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('viewers who cannot run the plan are told a planner must run it', async () => {
    renderApp({ path: '/plan/hiring?scenario=scn-xmas-2026-v4', role: 'HR' })
    expect(await screen.findByText('A planner needs to run the hiring plan for this scenario.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run hiring plan' })).toBeNull()
  })

  it('shows the published plan with its timeline and export', async () => {
    renderApp({ path: '/plan/hiring', role: 'FIN' })
    expect(await screen.findByText('Seasonal hires needed')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'When to act' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
  })
})

describe('SCR-024 leadership summary (Req 10.3, 18.3)', () => {
  it('shows the one-page summary with the sample-data badge and prints on request', async () => {
    const user = userEvent.setup()
    const { container } = renderApp({ path: '/plan/summary', role: 'EXE' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Christmas 2026 v3: cashier hiring plan' })).toBeInTheDocument()
    expect(screen.getByText('Illustrative: sample data')).toBeInTheDocument()
    expect(screen.getByText('Bottom line')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Where: hires by store' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download print page' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()

    const onPrint = vi.fn()
    const client = { summary: vi.fn(async () => ({ provenance, generatedAt: '', season: 's', from: '2026-12-01', to: '2026-12-31', storeCount: 0, departmentCount: 0, sampleData: true, hiring: null, peak: null, offersDue: null })) } as unknown as PlanningClient
    renderScreen(<SummaryScreen client={client} role="EXE" state={{ scenario: 'scn-1' }} onPrint={onPrint} />, 'EXE')
    expect(await screen.findByText('No hiring plan has been calculated for this scenario')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Print / PDF' }).at(-1) as HTMLElement)
    expect(onPrint).toHaveBeenCalledTimes(1)
  })

  it('is not available to Store Managers (matrix)', () => {
    renderApp({ path: '/plan/summary', role: 'STM' })
    expect(screen.getByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument()
  })
})

describe('export', () => {
  it('downloads the CSV the API built', async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.fn(() => 'blob:x')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderApp({ path: '/plan/network', role: 'FIN' })
    await screen.findByText('Peak cashiers on lanes')
    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0]
    expect(await blob.text()).toMatch(/^SAMPLE DATA/)
    click.mockRestore()
  })
})
