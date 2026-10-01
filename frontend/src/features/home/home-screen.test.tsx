import { ROLE_CODES, type RoleCode } from '@lanewise/shared'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { createMockAdapter, mockHome, type ApiAdapter } from '@/api'
import { renderApp, useLaptopViewport } from '@/test/app'
import { greetingKey, manilaHour } from './greeting'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

const HEADLINE: Record<RoleCode, RegExp> = {
  ADM: /Pending invitations/,
  EXE: /Waiting for your approval/,
  PLN: /Needs attention/,
  STM: /This week — SM Supermarket/,
  HR: /Headcount approval/,
  FIN: /Budget approval/,
  RST: /Data freshness/,
  STF: /Your next shifts/,
}

describe('SCR-010 Home', () => {
  it.each(ROLE_CODES)('shows the %s variant from mock data, with no axe violations', async (role) => {
    const { container } = renderApp({ path: '/', role })
    expect(await screen.findByRole('heading', { name: HEADLINE[role] })).toBeInTheDocument()
    for (const other of ROLE_CODES.filter((r) => r !== role)) {
      expect(screen.queryByRole('heading', { name: HEADLINE[other] })).toBeNull()
    }
    expect(await axe(container)).toHaveNoViolations()
  })

  it('never shows ₱ figures to Staff, Admin, the Rules Steward or (network cost) a Store Manager', async () => {
    for (const role of ['STF', 'ADM', 'RST', 'STM'] as const) {
      const { container, unmount } = renderApp({ path: '/', role })
      await screen.findByRole('heading', { name: HEADLINE[role] })
      expect(container).not.toHaveTextContent('₱')
      unmount()
    }
  })

  it('shows season KPIs and recent scenarios to the Planner', async () => {
    renderApp({ path: '/', role: 'PLN' })
    expect(await screen.findByText('Seasonal hires')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Recent scenarios' })).toBeInTheDocument()
    expect(screen.getByText(/₱/)).toBeInTheDocument()
  })

  it('shows the sample-data banner while the mock API is in use', async () => {
    renderApp({ path: '/', role: 'PLN' })
    expect(await screen.findByText(/Sample data — figures are simulated/)).toBeInTheDocument()
  })

  it('offers a retry when the home request fails', async () => {
    const mock = createMockAdapter()
    let calls = 0
    const flaky: ApiAdapter = async (req) => {
      calls += 1
      return calls === 1 ? { status: 500, body: null } : mock(req)
    }
    const user = userEvent.setup()
    renderApp({ path: '/', role: 'EXE', adapter: flaky })
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: HEADLINE.EXE })).toBeInTheDocument()
  })

  it('shows a per-role subtitle under the greeting', async () => {
    renderApp({ path: '/', role: 'STM' })
    const h1 = await screen.findByRole('heading', { level: 1 })
    expect(h1.nextElementSibling).toHaveTextContent('This week’s roster, open shifts and labor-rule checks for your store.')
  })

  it('hides the ★ published marker from assistive tech', async () => {
    renderApp({ path: '/', role: 'PLN' })
    const table = await screen.findByRole('table', { name: 'Recent scenarios' })
    const star = Array.from(table.querySelectorAll('a span')).find((el) => el.textContent?.includes('★'))
    expect(star).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('link', { name: /★/ })).toBeNull()
  })

  it('shows empty states when lists come back empty', async () => {
    const mock = createMockAdapter()
    const empty: ApiAdapter = async (req) => {
      if (req.path !== '/home') return mock(req)
      return { status: 200, body: { ...mockHome('PLN'), attention: [], deadlines: [], recentScenarios: [] } }
    }
    const { container } = renderApp({ path: '/', role: 'PLN', adapter: empty })
    expect(await screen.findByText('Nothing needs your attention')).toBeInTheDocument()
    expect(screen.getByText('No upcoming deadlines')).toBeInTheDocument()
    expect(screen.getByText('No scenarios yet')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('shows a whole-page empty state when a Staff member has no shifts data', async () => {
    const mock = createMockAdapter()
    const empty: ApiAdapter = async (req) => {
      if (req.path !== '/home') return mock(req)
      return { status: 200, body: { ...mockHome('STF'), nextShifts: undefined } }
    }
    renderApp({ path: '/', role: 'STF', adapter: empty })
    expect(await screen.findByRole('heading', { level: 2, name: 'Nothing needs your attention' })).toBeInTheDocument()
  })
})

describe('greeting (Asia/Manila time)', () => {
  it('uses the Manila hour, not the browser time zone', () => {
    // 2026-10-01T23:30Z is 07:30 the next morning in Manila (UTC+8).
    const t = Date.parse('2026-10-01T23:30:00Z')
    expect(manilaHour(t)).toBe(7)
    expect(greetingKey(t)).toBe('home.greeting.morning')
    expect(greetingKey(Date.parse('2026-10-01T05:00:00Z'))).toBe('home.greeting.afternoon') // 13:00
    expect(greetingKey(Date.parse('2026-10-01T10:00:00Z'))).toBe('home.greeting.evening') // 18:00
    expect(manilaHour(Date.parse('2026-10-01T16:00:00Z'))).toBe(0) // midnight is 0 with h23
  })
})
