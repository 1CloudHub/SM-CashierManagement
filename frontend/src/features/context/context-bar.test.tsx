import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { createMockAdapter } from '@/api'
import { renderApp, useLaptopViewport } from '@/test/app'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

const bar = () => screen.getByRole('group', { name: 'Plan context and filters' })
const url = () => window.location.pathname + window.location.search

describe('context bar (requirement 21.2–21.4, P8)', () => {
  it('shows only the screen’s filters and reproduces a shared URL', async () => {
    const { container } = renderApp({ path: '/plan/network?region=reg-visayas&format=sm_supermarket&date=2026-12-19', role: 'PLN' })
    const region = await within(bar()).findByRole('combobox', { name: 'Region' })
    expect(region).toHaveValue('reg-visayas')
    expect(within(bar()).getByRole('combobox', { name: 'Format' })).toHaveValue('sm_supermarket')
    expect(within(bar()).getByLabelText('Date')).toHaveValue('2026-12-19')
    expect(within(bar()).getByRole('combobox', { name: 'Scenario' })).toHaveValue('')
    expect(within(bar()).queryByRole('combobox', { name: 'Store' })).toBeNull()
    expect(url()).toBe('/plan/network?region=reg-visayas&format=sm_supermarket&date=2026-12-19')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('writes every change to the URL, and a store change clears its department', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/plan/department?store=st-qc&dept=st-qc-d2', role: 'PLN' })
    const store = await within(bar()).findByRole('combobox', { name: 'Store' })
    const dept = within(bar()).getByRole('combobox', { name: 'Department' })
    expect(dept).toHaveValue('st-qc-d2')
    await user.selectOptions(store, 'st-cebu')
    expect(url()).toBe('/plan/department?store=st-cebu')
    // Departments narrow to the chosen store.
    const names = within(dept).getAllByRole('option').map((o) => o.getAttribute('value'))
    expect(names).toEqual(['', 'st-cebu-d1', 'st-cebu-d2', 'st-cebu-d3'])
    await user.selectOptions(dept, 'st-cebu-d1')
    expect(url()).toBe('/plan/department?store=st-cebu&dept=st-cebu-d1')
    await user.click(within(bar()).getByRole('button', { name: 'Clear filters' }))
    expect(url()).toBe('/plan/department')
  })

  it('drops what is outside the loader’s scope: a Store Manager opening another store’s link', async () => {
    renderApp({ path: '/plan/department?store=st-cebu&dept=st-cebu-d1&scenario=scn-xmas-2026-v4', role: 'STM' })
    const store = await within(bar()).findByRole('combobox', { name: 'Store' })
    await waitFor(() => expect(url()).toBe('/plan/department'))
    expect(store).toHaveValue('')
    expect(within(store).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All stores in scope',
      'SM Supermarket – Quezon City',
    ])
    // Store Managers see Published scenarios only.
    const scenarios = within(within(bar()).getByRole('combobox', { name: 'Scenario' })).getAllByRole('option')
    expect(scenarios.map((o) => o.textContent)).toEqual(['Current published plan', 'Christmas 2026 v3 · Published'])
  })
})

describe('saved views (requirement 21.5)', () => {
  it('saves the current filters, applies the default on a fresh visit, renames and deletes', async () => {
    const user = userEvent.setup()
    const adapter = createMockAdapter()
    const first = renderApp({ path: '/plan/network?region=reg-luzon&format=sm_hypermarket', role: 'PLN', adapter })
    await within(bar()).findByRole('combobox', { name: 'Region' })
    await user.click(within(bar()).getByRole('button', { name: 'Saved views' }))
    const dialog = await screen.findByRole('dialog', { name: 'Saved views' })
    expect(within(dialog).getByText('No saved views for this screen yet.')).toBeInTheDocument()

    // A name is required.
    await user.click(within(dialog).getByRole('button', { name: 'Save view' }))
    expect(within(dialog).getByText('Give the view a name.')).toBeInTheDocument()

    await user.type(within(dialog).getByRole('textbox', { name: /Save current filters as/ }), 'Luzon hypermarkets')
    await user.click(within(dialog).getByRole('checkbox', { name: 'Make default for this screen' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save view' }))
    const link = await within(dialog).findByRole('link', { name: 'Luzon hypermarkets' })
    expect(link).toHaveAttribute('href', '/plan/network?region=reg-luzon&format=sm_hypermarket')
    expect(within(dialog).getByText('Default')).toBeInTheDocument()
    expect(await axe(dialog)).toHaveNoViolations()

    // A duplicate name is refused.
    await user.type(within(dialog).getByRole('textbox', { name: /Save current filters as/ }), 'Luzon hypermarkets')
    await user.click(within(dialog).getByRole('button', { name: 'Save view' }))
    expect(await within(dialog).findByText('You already have a view with that name here. Choose another name.')).toBeInTheDocument()
    first.unmount()

    // A fresh visit with no filters opens the default view.
    renderApp({ path: '/plan/network', role: 'PLN', adapter })
    await within(bar()).findByRole('combobox', { name: 'Region' })
    await waitFor(() => expect(url()).toBe('/plan/network?region=reg-luzon&format=sm_hypermarket'))
    await waitFor(() => expect(within(bar()).getByRole('combobox', { name: 'Region' })).toHaveValue('reg-luzon'))

    await user.click(within(bar()).getByRole('button', { name: 'Saved views' }))
    const again = await screen.findByRole('dialog', { name: 'Saved views' })
    await user.click(await within(again).findByRole('button', { name: 'Rename “Luzon hypermarkets”' }))
    const rename = within(again).getByRole('textbox', { name: 'New name for “Luzon hypermarkets”' })
    await user.clear(rename)
    await user.type(rename, 'Luzon big stores')
    await user.click(within(again).getByRole('button', { name: 'Save name' }))
    expect(await within(again).findByRole('link', { name: 'Luzon big stores' })).toBeInTheDocument()

    await user.click(within(again).getByRole('button', { name: 'Remove default: “Luzon big stores”' }))
    await waitFor(() => expect(within(again).queryByText('Default')).toBeNull())
    await user.click(within(again).getByRole('button', { name: 'Delete “Luzon big stores”' }))
    expect(await within(again).findByText('No saved views for this screen yet.')).toBeInTheDocument()
  })

  it('opening a saved view applies its filters', async () => {
    const user = userEvent.setup()
    const adapter = createMockAdapter()
    renderApp({ path: '/plan/hiring?region=reg-mindanao&season=nov16-dec31', role: 'PLN', adapter })
    await within(bar()).findByRole('combobox', { name: 'Season' })
    await user.click(within(bar()).getByRole('button', { name: 'Saved views' }))
    const dialog = await screen.findByRole('dialog', { name: 'Saved views' })
    await user.type(within(dialog).getByRole('textbox', { name: /Save current filters as/ }), 'Mindanao late season')
    await user.click(within(dialog).getByRole('button', { name: 'Save view' }))
    await within(dialog).findByRole('link', { name: 'Mindanao late season' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.click(within(bar()).getByRole('button', { name: 'Clear filters' }))
    expect(url()).toBe('/plan/hiring')
    await user.click(within(bar()).getByRole('button', { name: 'Saved views' }))
    await user.click(await within(await screen.findByRole('dialog', { name: 'Saved views' })).findByRole('link', { name: 'Mindanao late season' }))
    expect(url()).toBe('/plan/hiring?region=reg-mindanao&season=nov16-dec31')
    await waitFor(() => expect(within(bar()).getByRole('combobox', { name: 'Season' })).toHaveValue('nov16-dec31'))
  })
})
