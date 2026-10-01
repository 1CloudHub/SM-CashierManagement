import { ROLE_CODES } from '@lanewise/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { ACTIVE_ROLE_HEADER } from '@/api'
import { renderApp, useLaptopViewport } from '@/test/app'
import { canAccess } from './access'
import { activeRoleStorageKey, readStoredRole } from './active-role-storage'
import { SCREENS } from './screens'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

const mainNav = () => screen.getByRole('navigation', { name: 'Main' })

describe('routing', () => {
  it('renders Home at / inside the shell, with no axe violations', async () => {
    const { container } = renderApp({ path: '/', role: 'PLN' })
    expect(await screen.findByRole('heading', { level: 1, name: /Juan/ })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(within(mainNav()).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(document.title).toBe('Home — LaneWise')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('renders a placeholder with title, breadcrumb and its spec task', async () => {
    // SCR-040 Notifications is still a placeholder (task 19); SCR-025 shows offers since task 17.
    const { container } = renderApp({ path: '/notifications', role: 'STF' })
    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Coming in task 19' })).toBeInTheDocument()
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }))
    expect(crumbs.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(crumbs.getByText('Notifications')).toHaveAttribute('aria-current', 'page')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('renders SCR-025 My roster with the Staff user’s shift offers (task 17)', async () => {
    const { container } = renderApp({ path: '/my-roster', role: 'STF' })
    expect(screen.getByRole('heading', { level: 1, name: 'My roster' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Open shift offers near you' })).toBeInTheDocument()
    expect(within(mainNav()).getByRole('link', { name: 'My roster' })).toHaveAttribute('aria-current', 'page')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('every screen route renders a titled page for a permitted role', () => {
    for (const s of SCREENS) {
      if (s.id === 'SCR-010' || s.id === 'SCR-080') continue // Home loads async; Profile needs auth (covered in root.test)
      const r = ROLE_CODES.find((code) => canAccess(code, s))!
      const { unmount } = renderApp({ path: s.path.replace(/:\w+/g, '403'), role: r })
      expect(screen.getAllByRole('heading', { level: 1 }).length, s.id).toBeGreaterThan(0)
      expect(screen.queryByRole('heading', { level: 1, name: 'No access' }), s.id).toBeNull()
      unmount()
    }
  })

  it('shows Page not found for unknown paths, inside the shell', () => {
    renderApp({ path: '/nope', role: 'PLN' })
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    expect(mainNav()).toBeInTheDocument()
  })

  it('navigates client-side when a nav link is clicked', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/', role: 'RST' })
    await user.click(within(mainNav()).getByRole('link', { name: 'Rule sets' }))
    expect(window.location.pathname).toBe('/rules')
    expect(screen.getByRole('heading', { level: 1, name: 'Business rule sets' })).toBeInTheDocument()
  })

  it('keeps the component gallery at /gallery', () => {
    renderApp({ path: '/gallery', role: 'STF' })
    expect(screen.getAllByRole('heading', { level: 1 })[0]).toHaveTextContent('Component gallery')
  })
})

describe('nav filtering in the shell (requirement 2.3)', () => {
  it('every rendered nav link is permitted for the active role, for all 8 roles', () => {
    for (const r of ROLE_CODES) {
      const { unmount } = renderApp({ path: '/help', role: r })
      const links = within(mainNav()).getAllByRole('link')
      expect(links.length).toBeGreaterThan(0)
      for (const link of links) {
        const screenDef = SCREENS.find((s) => s.path === link.getAttribute('href'))!
        expect(canAccess(r, screenDef), `${r} → ${link.getAttribute('href')}`).toBe(true)
      }
      unmount()
    }
  })

  it('hides the search box from Staff (no access to search results)', () => {
    const { unmount } = renderApp({ path: '/help', role: 'STF' })
    expect(screen.queryByRole('search')).toBeNull()
    unmount()
    renderApp({ path: '/help', role: 'PLN' })
    expect(screen.getByRole('search')).toBeInTheDocument()
  })
})

describe('no access (requirement 2.4)', () => {
  it('an out-of-scope deep link shows No access, reveals nothing and fetches nothing', async () => {
    const { container, log } = renderApp({ path: '/scenarios/scn-secret-42/settings', role: 'STF' })
    expect(screen.getByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/')
    expect(container).not.toHaveTextContent('scn-secret-42')
    expect(container).not.toHaveTextContent('Scenario settings')
    expect(document.title).toBe('No access — LaneWise')
    expect(log).toHaveLength(0)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('admin screens are No access for every non-admin role', () => {
    for (const r of ROLE_CODES.filter((c) => c !== 'ADM')) {
      const { unmount } = renderApp({ path: '/admin/users', role: r })
      expect(screen.getByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument()
      expect(within(mainNav()).queryByRole('link', { name: 'Users' })).toBeNull()
      unmount()
    }
  })
})

describe('"Viewing as" role switcher (requirement 3)', () => {
  const switcher = () => screen.getByRole('combobox', { name: 'Viewing as' })

  it('lists all 8 roles', () => {
    renderApp({ path: '/help', role: 'PLN' })
    expect(within(switcher()).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual([...ROLE_CODES])
  })

  it('keeps the current page when the new role may open it', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/plan/network', role: 'PLN' })
    await user.selectOptions(switcher(), 'FIN')
    expect(window.location.pathname).toBe('/plan/network')
    expect(screen.getByRole('heading', { level: 1, name: 'All stores and departments' })).toBeInTheDocument()
    expect(within(mainNav()).queryByRole('link', { name: 'Network map' })).toBeNull()
  })

  it('goes Home when the new role may not open the current page, and later requests carry the new role', async () => {
    const user = userEvent.setup()
    const { log } = renderApp({ path: '/plan/network', role: 'PLN' })
    await user.selectOptions(switcher(), 'STF')
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(await screen.findByRole('heading', { name: /Your next shifts/ })).toBeInTheDocument()
    expect(log.at(-1)?.headers[ACTIVE_ROLE_HEADER]).toBe('STF')
    expect(within(mainNav()).getByRole('link', { name: 'My roster' })).toBeInTheDocument()
  })

  it('persists the choice per user in localStorage', async () => {
    const user = userEvent.setup()
    const { unmount } = renderApp({ path: '/help', role: 'PLN', userId: 'u-ana' })
    await user.selectOptions(switcher(), 'HR')
    expect(window.localStorage.getItem(activeRoleStorageKey('u-ana'))).toBe('HR')
    expect(readStoredRole('u-other')).toBeNull()
    unmount()
    renderApp({ path: '/help', userId: 'u-ana' })
    expect(switcher()).toHaveValue('HR')
  })

  it('starts from the first-sign-in role when nothing is stored', () => {
    window.localStorage.setItem('lw.onboarding', JSON.stringify({ startRole: 'EXE' }))
    renderApp({ path: '/help' })
    expect(switcher()).toHaveValue('EXE')
  })

  it('is hidden when demo mode is off; the role comes from assignments', () => {
    renderApp({ path: '/admin/audit', demo: false, assignedRoles: ['RST'] })
    expect(screen.queryByRole('combobox', { name: 'Viewing as' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Audit log' })).toBeInTheDocument()
  })
})

describe('route focus (UX-004)', () => {
  it('moves focus to the main landmark after client-side navigation', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/help', role: 'PLN' })
    await user.click(within(mainNav()).getByRole('link', { name: 'All scenarios' }))
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('main')))
  })
})
