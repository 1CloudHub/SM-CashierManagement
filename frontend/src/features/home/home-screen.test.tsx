import { ROLE_CODES, type RoleCode } from '@lanewise/shared'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { createMockAdapter, type ApiAdapter } from '@/api'
import { renderApp, useLaptopViewport } from '@/test/app'

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

  it('never shows ₱ figures to Staff, Admin or the Rules Steward', async () => {
    for (const role of ['STF', 'ADM', 'RST'] as const) {
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
})
