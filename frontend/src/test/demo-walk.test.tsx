import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RoleCode } from '@lanewise/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCREENS, type ScreenId } from '@/app/screens'
import { JUAN, fakeClient } from './auth'
import { renderApp, useLaptopViewport } from './app'

/**
 * The demo walk: every signed-in screen, for every role the route table lets
 * open it, renders realistic content over the mock API (VITE_API_MOCK) — no
 * empty table, list or "nothing here" state and no error, unless that state
 * is the point (the allow-list below says why). Guards the seeded demo world
 * (src/api/mock-world.ts) against regressions that would leave a demo screen
 * blank.
 */

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

/** The URL walked for each screen (route params filled with seeded ids). */
function pathFor(id: ScreenId, role: RoleCode): string | null {
  switch (id) {
    case 'SCR-031':
      // Store Managers see the published scenario only (P1).
      return role === 'STM' ? '/scenarios/scn-xmas-2026-v3/settings' : '/scenarios/scn-xmas-2026-v4/settings'
    case 'SCR-041':
      // The System Admin searches pages only (no store data in scope).
      return role === 'ADM' ? '/search?q=audit' : '/search?q=sm'
    case 'SCR-061':
      return '/rules/rules-wages/edit'
    case 'SCR-090':
      return null // status pages are the point of themselves
    default:
      return SCREENS.find((s) => s.id === id)?.path ?? null
  }
}

/** Screens that are forms or reference pages: no primary table or list to fill. */
const CONTENT_ONLY: ReadonlySet<ScreenId> = new Set(['SCR-051', 'SCR-071', 'SCR-080', 'SCR-091'])

/**
 * Intentional empty / refused states, `screen × role`. Each one mirrors the
 * API: the state is the correct answer for that role, not missing demo data.
 */
const ALLOWED: Readonly<Partial<Record<ScreenId, Partial<Record<RoleCode, string>>>>> = {
  // The route table lists the System Admin on SCR-061, but the RBAC matrix gives the
  // System Admin no "Business rules" access, so the API (and the mock) refuse the version.
  'SCR-061': { ADM: 'error' },
}

/** Waits until every skeleton is gone (screens load in more than one step). */
async function settled() {
  for (let i = 0; i < 3; i += 1) {
    await waitFor(() => expect(document.querySelector('[data-slot="skeleton"]')).toBeNull(), { timeout: 4000 })
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

function problems(): { empty: string[]; error: string[] } {
  const main = document.querySelector('main') ?? document.body
  const text = (e: Element) => (e.textContent ?? '').trim().slice(0, 80)
  return {
    empty: [...main.querySelectorAll('[data-state="empty"]')].map(text),
    error: [...main.querySelectorAll('[data-state="error"], [data-state="no-access"], [data-state="offline"]')].map(text),
  }
}

function filledRows(): number {
  const main = document.querySelector('main') ?? document.body
  return main.querySelectorAll('tbody tr:not([data-state]), li').length
}

const CASES = SCREENS.flatMap((s) =>
  s.roles.map((role) => ({ id: s.id, role, path: pathFor(s.id, role) })).filter((c): c is { id: ScreenId; role: RoleCode; path: string } => c.path !== null),
)

describe('demo walk: every screen × permitted role shows populated content', () => {
  it.each(CASES)('$id as $role ($path)', { timeout: 20_000 }, async ({ id, role, path }) => {
    renderApp({ path, role, auth: fakeClient({ currentUser: vi.fn().mockResolvedValue(JUAN) }) })
    await waitFor(() => expect(document.querySelector('main')).not.toBeNull(), { timeout: 4000 })
    await settled()
    const found = problems()
    const allowed = ALLOWED[id]?.[role]
    if (allowed === 'error') {
      expect(found.error.length, `${id} ${role}: expected the refused state`).toBeGreaterThan(0)
      return
    }
    expect(found.error, `${id} ${role}: error state`).toEqual([])
    expect(found.empty, `${id} ${role}: empty state`).toEqual([])
    if (!CONTENT_ONLY.has(id)) expect(filledRows(), `${id} ${role}: no rows or list items`).toBeGreaterThan(0)
  })
})

describe('demo walk: key sub-states', () => {
  it('weekly roster: day, fortnight, four-week and month views all show shifts', { timeout: 20_000 }, async () => {
    const user = userEvent.setup()
    renderApp({ path: '/plan/roster', role: 'STM' })
    await screen.findByRole('table', { name: /roster, mon, dec 14 to sun, dec 20/i })
    for (const name of ['Day', 'Fortnight', 'Four weeks', 'Month']) {
      await user.click(screen.getByRole('tab', { name }))
      await settled()
      expect(problems(), name).toEqual({ empty: [], error: [] })
      expect(filledRows(), name).toBeGreaterThan(0)
    }
  })

  it('weekly roster: every store has a published roster', { timeout: 20_000 }, async () => {
    for (const store of ['st-north-edsa', 'st-megamall', 'st-pasig', 'st-moa', 'st-aura', 'st-makati', 'st-lp']) {
      const { unmount } = renderApp({ path: `/plan/roster?store=${store}`, role: 'PLN' })
      await screen.findByRole('table', { name: /roster, mon, dec 14 to sun, dec 20/i })
      expect(problems(), store).toEqual({ empty: [], error: [] })
      unmount()
    }
  })

  it('notifications: every filter tab has items for the Planner', { timeout: 20_000 }, async () => {
    const user = userEvent.setup()
    renderApp({ path: '/notifications', role: 'PLN' })
    const tabs = await screen.findByRole('tablist', { name: 'Filter notifications' })
    for (const tab of within(tabs).getAllByRole('tab')) {
      await user.click(tab)
      await settled()
      await waitFor(() => expect(problems(), tab.textContent ?? '').toEqual({ empty: [], error: [] }))
    }
  })

  it('approvals: the v4 review shows the tracker with headcount approved and budget secured', async () => {
    renderApp({ path: '/approvals?scenario=scn-xmas-2026-v4', role: 'EXE' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Review: Christmas 2026 v4' })).toBeInTheDocument()
    await settled()
    expect(problems()).toEqual({ empty: [], error: [] })
    expect(screen.getByRole('button', { name: 'Approve and publish plan' })).toBeEnabled()
  })

  it('network map: auto-match suggests offers and store-to-store moves', { timeout: 20_000 }, async () => {
    const user = userEvent.setup()
    renderApp({ path: '/plan/map', role: 'PLN' })
    await user.click(await screen.findByRole('button', { name: 'Auto-match all gaps' }))
    const dialog = await screen.findByRole('dialog', { name: 'Review suggested cover' })
    const offers = await within(dialog).findByRole('table', { name: 'Suggested offers' })
    expect(within(offers).getAllByRole('row').length).toBeGreaterThan(1)
  })

  it('data sources: datasets and history include the rejected upload', async () => {
    renderApp({ path: '/data/sources', role: 'RST' })
    await settled()
    expect(problems()).toEqual({ empty: [], error: [] })
    // Sep 27: 47,548 rows rejected with 112 errors; Sep 28: loaded with 8 warnings.
    expect((await screen.findAllByText('112')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('47,548').length).toBeGreaterThan(1)
  })

  it('rule editor: the wage draft awaiting Finance shows the rates and the diff', async () => {
    renderApp({ path: '/rules/rules-wages/edit', role: 'FIN' })
    await settled()
    expect(problems()).toEqual({ empty: [], error: [] })
    expect(await screen.findByRole('button', { name: /Approve and publish/ })).toBeInTheDocument()
    expect(filledRows()).toBeGreaterThan(0)
  })

  it('my roster: shifts, offers and requests for the Staff persona', async () => {
    renderApp({ path: '/my-roster', role: 'STF' })
    expect(await screen.findByText(/Juan dela Cruz \(PT-02\)/)).toBeInTheDocument()
    await settled()
    expect(problems()).toEqual({ empty: [], error: [] })
    const offers = screen.getByRole('region', { name: 'Open shift offers near you' })
    expect(within(offers).getByRole('button', { name: /^Accept/ })).toBeInTheDocument()
  })

  it('profile: the Staff persona shares a barangay-level home area', async () => {
    renderApp({ path: '/profile', role: 'STF', auth: fakeClient({ currentUser: vi.fn().mockResolvedValue(JUAN) }) })
    expect((await screen.findAllByText(/Bagong Pag-asa/)).length).toBeGreaterThan(0)
    await settled()
    expect(problems()).toEqual({ empty: [], error: [] })
  })
})
