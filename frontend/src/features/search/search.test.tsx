import { ROLE_CODES, searchableGroups, type SearchResponse } from '@lanewise/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { MOCK_SCENARIOS, MOCK_STAFF, MOCK_STORES, mockSearch, mockStoreScope } from '@/api/mock-directory'
import { renderApp, useLaptopViewport } from '@/test/app'
import { matchPages } from './search-links'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

describe('mock search mirrors the API scope rules (P1, P11)', () => {
  it('every hit is in the active role’s scope and in a group the role may search', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ROLE_CODES),
        fc.oneof(fc.constantFrom('sm', 'cebu', 'lanes', 'christmas', 'ft-03', 'Juan', 'a'), fc.string({ minLength: 1, maxLength: 4 })),
        (role, q) => {
          const res = mockSearch(role, q, '50')
          if (q.trim().length === 0) {
            expect(res.ok).toBe(false)
            return
          }
          if (!res.ok) throw new Error(res.message)
          const scope = mockStoreScope(role)
          const groups = searchableGroups(role)
          const body: SearchResponse = res.body
          for (const [key, group] of Object.entries(body.groups)) {
            if (!groups.includes(key as never)) expect(group.total, key).toBe(0)
          }
          for (const s of body.groups.stores.items) expect(scope).toContain(s.id)
          for (const d of body.groups.departments.items) expect(scope).toContain(d.storeId)
          for (const s of body.groups.staff.items) expect(scope).toContain(s.storeId)
          if (role === 'STM') for (const s of body.groups.scenarios.items) expect(s.status).toBe('published')
          if (role === 'STF') expect(JSON.stringify(body)).not.toMatch(new RegExp(MOCK_STAFF.map((s) => s.name).join('|')))
        },
      ),
    )
  })

  it('Pages only lists screens the role can open', () => {
    const title = (key: string) => key
    expect(matchPages('STF', 'screen', title).map((p) => p.id)).not.toContain('SCR-020')
    expect(matchPages('PLN', 'screen.network', title).map((p) => p.id)).toEqual(['SCR-020'])
  })
})

describe('SCR-041 Search results', () => {
  it('groups in-scope results with counts and links, with no axe violations', async () => {
    const { container } = renderApp({ path: '/search?q=cebu', role: 'PLN' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Results for “cebu”' })).toBeInTheDocument()
    const tabs = await screen.findByRole('tablist', { name: 'Result types' })
    expect(within(tabs).getByRole('tab', { name: 'Stores (1)' })).toBeInTheDocument()
    expect(within(tabs).getByRole('tab', { name: 'Departments (3)' })).toBeInTheDocument()
    expect(within(tabs).getByRole('tab', { name: 'Staff (2)' })).toBeInTheDocument()
    const stores = screen.getByRole('region', { name: 'Stores' })
    expect(within(stores).getByRole('link', { name: 'SM Supermarket – Cebu City' })).toHaveAttribute(
      'href',
      '/plan/department?store=st-cebu',
    )
    expect(within(stores).getByText('Visayas · SM Supermarket')).toBeInTheDocument()
    expect(screen.getByText('Results only include what your role can see.')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('never shows a Store Manager another store, and only Published scenarios', async () => {
    const { unmount } = renderApp({ path: '/search?q=sm', role: 'STM' })
    await screen.findByRole('tablist', { name: 'Result types' })
    expect(screen.getByRole('link', { name: 'SM Supermarket – Quezon City' })).toBeInTheDocument()
    for (const other of MOCK_STORES.filter((s) => s.id !== 'st-qc')) expect(screen.queryByText(other.name)).toBeNull()
    unmount()
    renderApp({ path: '/search?q=christmas', role: 'STM' })
    await screen.findByRole('tablist', { name: 'Result types' })
    expect(screen.getByText('Christmas 2026 v3')).toBeInTheDocument()
    for (const s of MOCK_SCENARIOS.filter((x) => x.status !== 'published')) expect(screen.queryByText(s.name)).toBeNull()
  })

  it('keeps the selected tab in the URL', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/search?q=cebu', role: 'PLN' })
    await user.click(await screen.findByRole('tab', { name: 'Staff (2)' }))
    expect(window.location.search).toBe('?q=cebu&type=staff')
    expect(screen.getByRole('tab', { name: 'Staff (2)' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the empty and the prompt states', async () => {
    const { unmount } = renderApp({ path: '/search?q=zzzz', role: 'PLN' })
    expect(await screen.findByText('Nothing matches “zzzz” in your stores. Check the spelling or search all pages.')).toBeInTheDocument()
    unmount()
    renderApp({ path: '/search', role: 'PLN' })
    expect(screen.getByRole('heading', { level: 1, name: 'Search results' })).toBeInTheDocument()
    expect(screen.getByText('Search LaneWise')).toBeInTheDocument()
  })
})

describe('global search box', () => {
  const box = () => screen.getByRole('combobox', { name: 'Search' })

  it('opens with / and shows grouped suggestions, up to 5 per group', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/', role: 'PLN' })
    await screen.findByRole('heading', { level: 1, name: /Juan/ })
    await user.keyboard('/')
    expect(box()).toHaveFocus()
    await user.type(box(), 'sm')
    const list = await screen.findByRole('listbox', { name: 'Search suggestions' })
    await waitFor(() => expect(within(list).getByRole('group', { name: 'Stores' })).toBeInTheDocument())
    expect(box()).toHaveAttribute('aria-expanded', 'true')
    expect(within(within(list).getByRole('group', { name: 'Stores' })).getAllByRole('option')).toHaveLength(5)
    expect(within(list).getByRole('option', { name: 'See all results for “sm”' })).toBeInTheDocument()
  })

  it('Enter opens SCR-041; ↓ then Enter opens the highlighted hit; Esc closes', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/', role: 'PLN' })
    await user.type(box(), 'cebu')
    const list = await screen.findByRole('listbox', { name: 'Search suggestions' })
    await within(list).findByRole('group', { name: 'Stores' })
    await user.keyboard('{ArrowDown}')
    const first = within(list).getAllByRole('option')[0]!
    expect(first).toHaveAttribute('aria-selected', 'true')
    expect(box()).toHaveAttribute('aria-activedescendant', first.id)
    await user.keyboard('{Enter}')
    expect(window.location.pathname + window.location.search).toBe('/plan/department?store=st-cebu')

    await user.clear(box())
    await user.type(box(), 'cebu')
    await user.keyboard('{Escape}')
    expect(box()).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{Enter}')
    expect(window.location.pathname + window.location.search).toBe('/search?q=cebu')
    expect(await screen.findByRole('heading', { level: 1, name: 'Results for “cebu”' })).toBeInTheDocument()
  })

  it('is not offered to Staff, whose role has no search results screen', async () => {
    renderApp({ path: '/', role: 'STF' })
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('combobox', { name: 'Search' })).toBeNull()
  })
})
