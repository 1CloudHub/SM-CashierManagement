import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { ACTIVE_ROLE_HEADER, createMockAdapter } from '@/api'
import { renderApp, useLaptopViewport } from '@/test/app'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

const grid = () => screen.findByRole('table', { name: /roster, mon, dec 14 to sun, dec 20/i })

describe('task 17 shift offers and borrowing in the SPA', () => {
  it('SCR-022: offers an open shift to eligible staff and shows the offer status (axe clean)', async () => {
    const user = userEvent.setup()
    const { container, log } = renderApp({ path: '/plan/roster', role: 'STM' })
    await grid()
    const banner = await screen.findByRole('region', { name: 'Open shifts' })
    expect(within(banner).getByText('3 open shifts')).toBeInTheDocument()
    expect(within(banner).getByRole('link', { name: 'Find cover nearby (network map)' })).toHaveAttribute('href', '/plan/map')
    // The Sat evening shift already has a live broadcast from the seeded demo data.
    expect(await within(banner).findByText(/FT-21 · waiting/)).toBeInTheDocument()
    await user.click(within(banner).getByRole('button', { name: /^Offer Sat, Dec 19, 4.* to eligible staff/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Offer to eligible staff' })
    const table = await within(dialog).findByRole('table', { name: 'Eligible cashiers for this shift' })
    expect(within(table).getByText('XS-14 · SM Supermarket – Megamall')).toBeInTheDocument()
    // Pseudonymised: no other-store cashier names before acceptance (requirement 12.5).
    expect(within(dialog).queryByText(/Jo Tan/)).toBeNull()
    const send = within(dialog).getByRole('button', { name: 'Send offers to 0' })
    expect(send).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Offer to PT-02' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'Offer to XS-14' }))
    await user.click(within(dialog).getByRole('button', { name: 'Send offers to 2' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const status = await within(banner).findByRole('list', { name: /Offers for Sat, Dec 19, 4/ })
    expect(within(status).getByText(/PT-02 Juan dela Cruz · waiting, 30 min left/)).toBeInTheDocument()
    expect(within(status).getByText(/XS-14 · waiting/)).toBeInTheDocument()
    const sent = log.find((r) => r.method === 'POST' && r.path.endsWith('/offers'))
    expect(sent?.headers[ACTIVE_ROLE_HEADER]).toBe('STM')
    expect(sent?.body).toMatchObject({ staffIds: ['st-qc-pt02', 'st-megamall-xs14'] })
    expect(await axe(container)).toHaveNoViolations()
  })

  it('SCR-025: the Staff user accepts their offer; the shift then shows on the roster as filled', async () => {
    const user = userEvent.setup()
    const adapter = createMockAdapter()
    // A Store Manager sends the offer…
    const stm = renderApp({ path: '/plan/roster', role: 'STM', adapter })
    await grid()
    await user.click(await screen.findByRole('button', { name: /^Offer Sat, Dec 19, 4.* to eligible staff/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Offer to PT-02' }))
    await user.click(within(dialog).getByRole('button', { name: 'Send offers to 1' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    stm.unmount()

    // …the cashier accepts it on My roster.
    const staff = renderApp({ path: '/my-roster', role: 'STF', adapter })
    const section = await screen.findByRole('region', { name: 'Open shift offers near you' })
    expect(await within(section).findByText(/SM Supermarket – Quezon City/)).toBeInTheDocument()
    expect(within(section).getByText(/expires in 30 min/)).toBeInTheDocument()
    expect(await axe(staff.container)).toHaveNoViolations()
    await user.click(within(section).getByRole('button', { name: /Accept the shift at SM Supermarket – Quezon City/ }))
    expect(await within(section).findByText('You got the shift. It’s now on your roster.')).toBeInTheDocument()
    expect(within(section).getByText('Earlier offers')).toBeInTheDocument()
    staff.unmount()

    // The open shift is gone from the Store Manager's roster banner, and the change is listed.
    renderApp({ path: '/plan/roster', role: 'STM', adapter })
    await grid()
    expect(await screen.findByText(/Filled by an accepted offer · Demo STM/)).toBeInTheDocument()
    const banner = await screen.findByRole('region', { name: 'Open shifts' })
    expect(within(banner).getByText('2 open shifts')).toBeInTheDocument()
    expect(within(banner).queryByRole('button', { name: /^Offer Sat, Dec 19, 4/ })).toBeNull()
  })

  it('SCR-022: the lending manager reviews a borrow request; a Planner needs a reason to override', async () => {
    const user = userEvent.setup()
    const adapter = createMockAdapter()
    const pln = renderApp({ path: '/plan/roster', role: 'PLN', adapter })
    await grid()
    const panel = await screen.findByRole('region', { name: 'Borrow requests' })
    await user.click(within(panel).getByRole('button', { name: 'Review the request from SM Supermarket – Megamall' }))
    const dialog = await screen.findByRole('dialog', { name: /Lend cashiers to/ })
    await user.click(await within(dialog).findByRole('checkbox', { name: /FT-03 Cora Fisco/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Approve 1' }))
    expect(await within(dialog).findByText('Give a reason to approve instead of the lending store manager.')).toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox', { name: /Reason for approving instead/ }), 'Manager on leave')
    await user.click(within(dialog).getByRole('button', { name: 'Approve 1' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await within(panel).findByText('Approved by planner override')).toBeInTheDocument()
    expect(within(panel).getByText(/Override by Demo PLN: Manager on leave/)).toBeInTheDocument()
    pln.unmount()
  })
})
