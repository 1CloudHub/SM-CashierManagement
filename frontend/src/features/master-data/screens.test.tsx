import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { ACTIVE_ROLE_HEADER, ApiError } from '@/api'
import { AnnouncerProvider } from '@/components/a11y'
import { I18nProvider } from '@/i18n'
import { renderApp, useLaptopViewport } from '@/test/app'
import type { MasterDataClient } from './api'
import { StaffScreen } from './staff-screen'
import { StoresScreen } from './stores-screen'

afterEach(() => vi.unstubAllGlobals())

/** Phone width: no `min-width` query matches. */
function usePhoneViewport() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

const table = (name: string) => within(screen.getByRole('table', { name }))

describe('SCR-052 Stores, departments and lanes', () => {
  beforeEach(() => useLaptopViewport())

  it('groups stores and departments for the Rules Steward, with Import and + Store; passes axe', async () => {
    const { container, log } = renderApp({ path: '/data/stores', role: 'RST' })
    expect(screen.getByRole('heading', { level: 1, name: 'Stores, departments and lanes' })).toBeInTheDocument()
    const qc = await screen.findByRole('rowheader', { name: /^SM Supermarket – Quezon City/ })
    const storeRow = qc.closest('tr')!
    expect(within(storeRow).getByText('SM Supermarket')).toBeInTheDocument()
    expect(within(storeRow).getByText('Luzon')).toBeInTheDocument()
    expect(within(storeRow).getByText('45')).toBeInTheDocument() // 30 + 11 + 4 installed lanes
    expect(table('Stores and departments').getAllByRole('rowheader', { name: /Main checkout lanes/ }).length).toBeGreaterThan(1)
    expect(screen.getByRole('link', { name: 'Import' })).toHaveAttribute('href', '/data/upload?dataset=master')
    expect(screen.getByRole('button', { name: '+ Store' })).toBeInTheDocument()
    expect(log.find((r) => r.path === '/stores')?.headers[ACTIVE_ROLE_HEADER]).toBe('RST')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('edits a department through the dialog and validates trading hours', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/data/stores', role: 'RST' })
    await user.click(await screen.findByRole('button', { name: 'Edit Express lanes, SM Supermarket – Quezon City' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Express lanes' })
    const lanes = within(dialog).getByLabelText(/^Installed lanes/)
    await user.clear(lanes)
    await user.type(lanes, '14')
    await user.clear(within(dialog).getByLabelText(/^Closes/))
    await user.type(within(dialog).getByLabelText(/^Closes/), '08:00')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByText('Closing time must be after opening time.')).toBeInTheDocument()
    expect(await axe(dialog)).toHaveNoViolations()
    await user.clear(within(dialog).getByLabelText(/^Closes/))
    await user.type(within(dialog).getByLabelText(/^Closes/), '23:00')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect((await screen.findAllByText('Express lanes at SM Supermarket – Quezon City saved.')).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const row = (await screen.findAllByRole('rowheader', { name: 'Express lanes, SM Supermarket – Quezon City' }))[0]!.closest('tr')!
    expect(within(row).getByText('14')).toBeInTheDocument()
  })

  it('adds a store', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/data/stores', role: 'RST' })
    await user.click(await screen.findByRole('button', { name: '+ Store' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a store' })
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getAllByText('Enter a value.')).toHaveLength(2)
    await user.type(within(dialog).getByLabelText(/^Store code/), 'smsm-bgc')
    await user.type(within(dialog).getByLabelText(/^Store name/), 'SM Supermarket – BGC')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect((await screen.findAllByText('Store SM Supermarket – BGC added.')).length).toBeGreaterThan(0)
    expect(await screen.findByRole('rowheader', { name: /^SM Supermarket – BGC/ })).toBeInTheDocument()
  })

  it('filters by search, region and format', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/data/stores', role: 'PLN' })
    await screen.findByRole('rowheader', { name: /^SM Supermarket – Quezon City/ })
    await user.selectOptions(screen.getByLabelText('Region'), 'Visayas')
    expect(screen.queryByRole('rowheader', { name: /^SM Supermarket – Quezon City/ })).toBeNull()
    expect(screen.getByRole('rowheader', { name: /^SM Supermarket – Cebu City/ })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Format'), 'The SM Store')
    expect(screen.queryByRole('rowheader', { name: /^SM Supermarket – Cebu City/ })).toBeNull()
    await user.type(within(screen.getByRole('search', { name: 'Filter stores' })).getByLabelText('Search'), 'zzz')
    expect(screen.getByRole('heading', { name: 'No matches' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('rowheader', { name: /^SM Supermarket – Quezon City/ })).toBeInTheDocument()
  })

  it('is read-only for view roles and the Store Manager sees only their store', async () => {
    const { unmount } = renderApp({ path: '/data/stores', role: 'EXE' })
    await screen.findByRole('rowheader', { name: /^SM Supermarket – Quezon City/ })
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Store' })).toBeNull()
    unmount()
    renderApp({ path: '/data/stores', role: 'STM' })
    await screen.findByRole('rowheader', { name: /^SM Supermarket – Quezon City/ })
    expect(screen.queryByRole('rowheader', { name: /^SM Hypermarket – Mall of Asia/ })).toBeNull()
  })

  it('shows "No access" to roles outside the row', () => {
    renderApp({ path: '/data/stores', role: 'FIN' })
    expect(screen.getByRole('heading', { level: 1, name: /You do not have access/ })).toBeInTheDocument()
  })
})

describe('SCR-052 on a phone', () => {
  beforeEach(() => usePhoneViewport())

  it('is read-only on a phone, even for the Rules Steward', async () => {
    renderApp({ path: '/data/stores', role: 'RST' })
    await screen.findByRole('rowheader', { name: /^SM Supermarket – Quezon City/ })
    expect(screen.getByText('Read-only on a phone. Open on a tablet or computer to edit.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Store' })).toBeNull()
  })
})

describe('SCR-053 Staff and availability', () => {
  beforeEach(() => useLaptopViewport())

  it('lists staff with the privacy note; HR opens a record, edits the grid, views it as a table and saves; passes axe', async () => {
    const user = userEvent.setup()
    const { container } = renderApp({ path: '/data/staff', role: 'HR' })
    expect(screen.getByRole('heading', { level: 1, name: 'Staff and availability' })).toBeInTheDocument()
    expect(screen.getByText('Names are personal data (RA 10173). Store managers only see their own store’s staff.')).toBeInTheDocument()
    const open = await screen.findByRole('button', { name: 'PT-02, availability for Juan dela Cruz' })
    const row = open.closest('tr')!
    expect(within(row).getByText('Part-time')).toBeInTheDocument()
    expect(within(row).getByText(/^16 of 21 time windows/)).toBeInTheDocument()
    expect(within(row).getByText('Dec 14, 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Staff' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Import from HRIS / file' })).toBeNull() // only the Rules Steward loads data
    expect(await axe(container)).toHaveNoViolations()

    await user.click(open)
    const dialog = await screen.findByRole('dialog', { name: 'PT-02 availability' })
    const cell = within(dialog).getByRole('button', { name: 'Monday, Morning: Off' })
    expect(cell).toHaveAttribute('aria-pressed', 'false')
    await user.click(cell)
    expect(within(dialog).getByRole('button', { name: 'Monday, Morning: Available' })).toHaveAttribute('aria-pressed', 'true')
    expect(await within(dialog).findByText(/Bagong Pag-asa/)).toBeInTheDocument() // home area: barangay only

    await user.click(within(dialog).getByRole('button', { name: 'View as table' }))
    const grid = within(within(dialog).getByRole('table', { name: 'Weekly availability' }))
    expect(grid.getByRole('checkbox', { name: /Monday, Morning/ })).toBeChecked()
    expect(grid.getByRole('checkbox', { name: /Tuesday, Morning/ })).not.toBeChecked()
    expect(await axe(dialog)).toHaveNoViolations()

    await user.type(within(dialog).getByLabelText('Add unavailable date'), '2026-12-24')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(await within(dialog).findByText('Dec 24, 2026')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect((await screen.findAllByText('Availability for PT-02 saved.')).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const after = screen.getByRole('button', { name: 'PT-02, availability for Juan dela Cruz' }).closest('tr')!
    expect(within(after).getByText(/^17 of 21 time windows/)).toBeInTheDocument()
    expect(within(after).getByText('Dec 14, 2026, Dec 24, 2026')).toBeInTheDocument()
  })

  it('the Store Manager sees only their store, edits a record but cannot add staff', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/data/staff', role: 'STM' })
    await screen.findByRole('button', { name: 'PT-02, availability for Juan dela Cruz' })
    expect(screen.queryByText('Liza Garcia')).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Staff' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit Ana Reyes' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit FT-03' })
    await user.selectOptions(within(dialog).getByLabelText('Preferred rest'), 'Friday')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect((await screen.findAllByText('Staff FT-03 saved.')).length).toBeGreaterThan(0)
    const row = screen.getByRole('button', { name: 'FT-03, availability for Ana Reyes' }).closest('tr')!
    expect(within(row).getByText('Fri')).toBeInTheDocument()
  })

  it('the Rules Steward views read-only, with the HRIS import link', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/data/staff', role: 'RST' })
    await user.click(await screen.findByRole('button', { name: 'PT-02, availability for Juan dela Cruz' }))
    const dialog = await screen.findByRole('dialog', { name: 'PT-02 availability' })
    expect(within(dialog).queryByRole('button', { name: /Monday, Morning/ })).toBeNull()
    expect(within(dialog).queryByLabelText('Add unavailable date')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull()
    // No home-area row in the matrix for the Rules Steward.
    expect(within(dialog).queryByRole('heading', { name: /home area/i })).toBeNull()
    await user.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect(screen.getByRole('link', { name: 'Import from HRIS / file' })).toHaveAttribute('href', '/data/upload?dataset=staff')
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
  })

  it('HR adds a staff member', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/data/staff', role: 'HR' })
    await screen.findByRole('button', { name: 'PT-02, availability for Juan dela Cruz' })
    await user.click(screen.getByRole('button', { name: '+ Staff' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add staff' })
    await user.type(within(dialog).getByLabelText(/^Staff ID/), 'FL-09')
    await user.type(within(dialog).getByLabelText(/^Name/), 'Rosa Diaz')
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Float')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect((await screen.findAllByText('Staff FL-09 added.')).length).toBeGreaterThan(0)
    expect(await screen.findByRole('button', { name: 'FL-09, availability for Rosa Diaz' })).toBeInTheDocument()
  })

  it('filters by type and by name or ID', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/data/staff', role: 'PLN' })
    await screen.findByRole('button', { name: 'PT-02, availability for Juan dela Cruz' })
    await user.selectOptions(screen.getByLabelText('Type'), 'Full-time')
    await waitFor(() => expect(screen.queryByRole('button', { name: /^PT-02/ })).toBeNull())
    expect(screen.getAllByRole('button', { name: /^FT-03/ }).length).toBeGreaterThan(1)
    await user.type(screen.getByLabelText('Search name or ID'), 'Ana')
    expect(screen.getAllByRole('button', { name: /^FT-03/ })).toHaveLength(1)
  })

  it('shows "No access" to roles outside the row', () => {
    renderApp({ path: '/data/staff', role: 'EXE' })
    expect(screen.getByRole('heading', { level: 1, name: /You do not have access/ })).toBeInTheDocument()
  })
})

describe('load states', () => {
  beforeEach(() => useLaptopViewport())

  const wrap = (node: React.ReactNode) =>
    render(
      <I18nProvider initialLocale="en">
        <AnnouncerProvider>{node}</AnnouncerProvider>
      </I18nProvider>,
    )

  function failing(status: number): MasterDataClient {
    const error = new ApiError(status, status === 403 ? 'forbidden' : 'internal_error', 'x', 'ref-123')
    const reject = () => Promise.reject(error)
    return {
      listStores: reject,
      createStore: reject,
      updateStore: reject,
      updateDepartment: reject,
      listStaff: reject,
      createStaff: reject,
      updateStaff: reject,
      setAvailability: reject,
      addUnavailableDate: reject,
      removeUnavailableDate: reject,
    }
  }

  it('maps 403 to the no-access state and other failures to an error with its reference', async () => {
    const { unmount } = wrap(<StoresScreen client={failing(403)} role="PLN" onNavigate={() => undefined} />)
    expect(await screen.findByRole('heading', { name: 'You don’t have access to this' })).toBeInTheDocument()
    unmount()
    wrap(<StaffScreen client={failing(500)} role="HR" onNavigate={() => undefined} />)
    expect(await screen.findByRole('heading', { name: 'We couldn’t load the staff list' })).toBeInTheDocument()
    expect(screen.getByText('ref-123')).toBeInTheDocument()
  })

  it('shows the empty state when there are no stores', async () => {
    const client = { ...failing(500), listStores: () => Promise.resolve({ stores: [], regions: [] }) }
    wrap(<StoresScreen client={client} role="RST" onNavigate={() => undefined} />)
    expect(await screen.findByRole('heading', { name: 'No stores yet' })).toBeInTheDocument()
  })
})
