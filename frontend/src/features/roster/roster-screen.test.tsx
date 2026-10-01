import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { ACTIVE_ROLE_HEADER } from '@/api'
import { renderApp, useLaptopViewport } from '@/test/app'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

const table = () => screen.findByRole('table', { name: /roster, mon, dec 14 to sun, dec 20/i })

describe('SCR-022 published roster and store-manager overrides (task 13.4)', () => {
  it('shows the published week with labor checks and passes axe', async () => {
    const { container, log } = renderApp({ path: '/plan/roster', role: 'STM' })
    const grid = await table()
    expect(within(grid).getByRole('rowheader', { name: /FT-01 Isa Palma/ })).toBeInTheDocument()
    expect(within(grid).getByRole('rowheader', { name: 'Open shifts' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Labor-rule checks' })).toBeInTheDocument()
    // The seeded store-manager change to Juan's Saturday shift is listed.
    expect(screen.getByText(/Time changed · Maricel Bautista/)).toBeInTheDocument()
    expect(log.find((r) => r.path.includes('/rosters'))?.headers[ACTIVE_ROLE_HEADER]).toBe('STM')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('reads only for a planner', async () => {
    renderApp({ path: '/plan/roster', role: 'PLN' })
    await table()
    expect(screen.getByText(/View only/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^FT-03 Cora Fisco, Mon, Dec 14/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a change that passes the rules saves, is marked ✎ and listed', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/plan/roster', role: 'STM' })
    await table()
    await user.click(screen.getByRole('button', { name: /^FT-03 Cora Fisco, Mon, Dec 14/ }))
    const dialog = await screen.findByRole('dialog')
    // Monday 12 PM – 9 PM keeps the meal inside, 13 h rest before Tuesday and the same weekly hours.
    await user.selectOptions(within(dialog).getByLabelText('Start'), String(12 * 60))
    await user.selectOptions(within(dialog).getByLabelText('End'), String(21 * 60))
    expect(await within(dialog).findByText('Passes every labor rule')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save shift' }))
    expect((await screen.findAllByText('Change saved. The affected cashiers were notified.')).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText(/Time changed · Demo STM/)).toBeInTheDocument()
  })

  it('requires a reason before saving a rule warning', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/plan/roster', role: 'STM' })
    await table()
    // Ralph works Tue–Sun 12–9 PM (48 h paid): starting earlier on Tuesday pushes him over the weekly cap.
    await user.click(screen.getByRole('button', { name: /^FT-07 Ralph Edu, Tue, Dec 15/ }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Start'), String(8 * 60))
    expect(await within(dialog).findByText(/over the weekly paid-hours cap/)).toBeInTheDocument()
    const save = within(dialog).getByRole('button', { name: 'Save shift' })
    expect(save).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/Reason for overriding the labor rule/), 'Inventory count')
    expect(save).toBeEnabled()
    await user.click(save)
    expect(await screen.findByText('Reason: Inventory count')).toBeInTheDocument()
  })

  it('emergency off picks a ranked replacement; blocked candidates are not selectable', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/plan/roster', role: 'STM' })
    await table()
    await user.click(screen.getByRole('button', { name: /^FT-09 Dina Rusel, Mon, Dec 14/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('tab', { name: 'Emergency off / reassign' }))
    // Ralph works Tue–Sun: Monday would be his 7th day in a row without a 24-hour rest — blocked.
    expect(within(dialog).getByRole('radio', { name: /FT-07 Ralph Edu/ })).toBeDisabled()
    const radios = within(dialog).getAllByRole('radio')
    expect(radios[0]).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Mark emergency off' }))
    expect(await screen.findByText(/Emergency off · Demo STM/)).toBeInTheDocument()
  })
})
