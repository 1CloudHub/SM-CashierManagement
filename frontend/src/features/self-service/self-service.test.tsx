import type { MyRosterResponse, StoreStaffRequestDto } from '@lanewise/shared'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { createMockAdapter } from '@/api'
import { AnnouncerProvider } from '@/components/a11y'
import { I18nProvider } from '@/i18n'
import { renderApp, useLaptopViewport } from '@/test/app'
import { toMyRosterModel } from './adapt'
import type { SelfServiceClient } from './api'
import { StaffRequestsPanel } from './staff-requests-panel'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

/** Every other cashier on the demo Quezon City roster (P11: never on the Staff user's screen). */
const OTHER_CASHIERS = ['Isa Palma', 'Cora Fisco', 'Ralph Edu', 'Dina Rusel', 'Guy Hapin', 'Arlene Mac', 'FT-01', 'FT-03', 'FT-07', 'FT-09', 'PT-05', 'PT-06', 'FL-01']

describe('SCR-025 My roster (task 18.1)', () => {
  it('shows only the Staff user’s own shifts and rest days, offers and requests — no other names or costs (P11, axe clean)', async () => {
    const { container } = renderApp({ path: '/my-roster', role: 'STF' })
    expect(screen.getByRole('heading', { level: 1, name: 'My roster' })).toBeInTheDocument()
    expect(await screen.findByText(/Juan dela Cruz \(PT-02\) · SM Supermarket – Quezon City/)).toBeInTheDocument()
    const week = await screen.findByRole('list', { name: /Dec 14/ })
    const cards = within(week).getAllByRole('listitem')
    // PT-02 works Tue, Thu and Sat; the other rostered days are rest days.
    expect(cards).toHaveLength(7)
    expect(within(week).getAllByText('Rest day')).toHaveLength(4)
    expect(screen.getByRole('heading', { name: 'Open shift offers near you' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Requests' })).toBeInTheDocument()
    // The seeded pending time-off request (Dec 24, family) is theirs.
    expect(await screen.findByText(/Dec 24 \(family\)/)).toBeInTheDocument()
    const text = document.body.textContent ?? ''
    for (const other of OTHER_CASHIERS) expect(text).not.toContain(other)
    // The only ₱ figures are the pay and allowance of their own open-shift offers.
    const offers = screen.getByRole('region', { name: 'Open shift offers near you' })
    expect(offers.textContent).toMatch(/₱347\.50 \+ ₱80\.00 transport/)
    expect(text.replace(offers.textContent ?? '', '')).not.toMatch(/₱/)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('“Add to calendar” saves an .ics file of their own shifts', async () => {
    const user = userEvent.setup()
    const blobs: Blob[] = []
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => (blobs.push(b), 'blob:mock')), revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderApp({ path: '/my-roster', role: 'STF' })
    await user.click(await screen.findByRole('button', { name: 'Add to calendar' }))
    expect(click).toHaveBeenCalledOnce()
    const ics = await blobs[0]!.text()
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3)
    expect(ics).toContain('DTSTART:20261215T070000Z') // Tue Dec 15, 3 PM Manila
    expect(ics).toContain('LOCATION:SM Supermarket – Quezon City')
    expect((await screen.findAllByText(/Calendar file saved with 3 shifts/)).length).toBeGreaterThan(0)
    click.mockRestore()
  })

  it('raises a swap that changes nothing until the Store Manager approves it on SCR-022 (P19)', async () => {
    const user = userEvent.setup()
    const adapter = createMockAdapter()
    // Staff: request to give Sat Dec 19 12–9 and take the open shift.
    const staff = renderApp({ path: '/my-roster', role: 'STF', adapter })
    await user.click(await screen.findByRole('button', { name: 'Request a swap' }))
    const dialog = await screen.findByRole('dialog', { name: 'Request a swap' })
    const give = await within(dialog).findByRole('combobox', { name: /Give up my shift/ })
    await user.selectOptions(give, within(give).getByRole('option', { name: /Sat, Dec 19/ }))
    expect(within(dialog).getByRole('combobox', { name: /Take instead/ })).toHaveDisplayValue(/open shift Sat, Dec 19/)
    await user.type(within(dialog).getByRole('textbox', { name: /Note/ }), 'Exam')
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await screen.findAllByText('Request sent to your store manager.')).length).toBeGreaterThan(0)
    const sat = await screen.findByText(/Sat, Dec 19/, { selector: 'h3' })
    expect(within(sat.closest('li')!).getByText('Request pending')).toBeInTheDocument()
    staff.unmount()

    // Store Manager: the panel lists it; approving applies it to the roster.
    renderApp({ path: '/plan/roster', role: 'STM', adapter })
    const panel = (await screen.findByText(/Staff requests — 4 pending/)).closest('details')!
    const row = within(panel).getAllByRole('row', { name: /Swap/ }).find((r) => within(r).queryByText(/PT-02 Juan dela Cruz/))!
    expect(within(row).getByText(/PT-02 Juan dela Cruz/)).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Approve request from PT-02 Juan dela Cruz' }))
    const confirm = await screen.findByRole('dialog', { name: /Approve request from PT-02/ })
    await user.click(within(confirm).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await within(panel).findByText('Request from PT-02 Juan dela Cruz approved.')).toBeInTheDocument()
    // Both shifts changed hands, each recorded as a ShiftOverride (✎ in Changes).
    expect(await screen.findAllByText(/Swapped \(staff request\)/)).toHaveLength(2)
  })

  it('the time-off dialog sends dates and an optional reason; Staff can cancel while pending', async () => {
    const user = userEvent.setup()
    const { log } = renderApp({ path: '/my-roster', role: 'STF' })
    await user.click(await screen.findByRole('button', { name: 'Request time off' }))
    const dialog = await screen.findByRole('dialog', { name: 'Request time off' })
    const from = within(dialog).getByLabelText(/From/)
    const to = within(dialog).getByLabelText(/^To/)
    await user.clear(from)
    await user.type(from, '2026-12-16')
    await user.clear(to)
    await user.type(to, '2026-12-17')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Reason/ }), 'medical')
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(log.find((r) => r.method === 'POST' && r.path === '/me/requests')?.body).toEqual({ type: 'time_off', dateFrom: '2026-12-16', dateTo: '2026-12-17', reason: 'medical' })
    const cancel = await screen.findByRole('button', { name: /Cancel request: Wed, Dec 16 – Thu, Dec 17 \(medical\)/ })
    await user.click(cancel)
    expect((await screen.findAllByText('Request cancelled.')).length).toBeGreaterThan(0)
  })
})

describe('SCR-022 Staff requests panel (task 18.2)', () => {
  const base: Omit<StoreStaffRequestDto, 'id' | 'check' | 'stale'> = {
    type: 'swap',
    status: 'pending',
    createdAt: '2026-12-10T00:00:00Z',
    dateFrom: null,
    dateTo: null,
    reason: null,
    note: null,
    offered: { shiftId: 'a', storeId: 'st', departmentName: 'Main', date: '2026-12-19', startMin: 720, endMin: 1260 },
    target: { shiftId: 'b', storeId: 'st', departmentName: 'Main', date: '2026-12-20', startMin: 360, endMin: 720, kind: 'open', staffName: null },
    decidedAt: null,
    decisionNote: null,
    staff: { id: 's1', employeeNo: 'PT-05', name: 'Guy Hapin' },
    decidedBy: null,
    shiftsLeftOpen: null,
  }
  const breach = { rule: 'MIN_REST' as const, severity: 'warning' as const, staffId: 's1', date: '2026-12-20', message: 'Less than 10 h rest before Sun Dec 20.' }
  const fake = (requests: StoreStaffRequestDto[]) => {
    const decide = vi.fn(async (_s: string, id: string, d: { decision: string; reason?: string }) => {
      void d
      return requests.find((r) => r.id === id)!
    })
    const client = { storeRequests: vi.fn(async () => requests), decide } as unknown as SelfServiceClient
    return { client, decide }
  }
  const wrap = (ui: React.ReactNode, locale: 'en' | 'fil' = 'en') =>
    render(
      <I18nProvider initialLocale={locale}>
        <AnnouncerProvider>
          {ui}
        </AnnouncerProvider>
      </I18nProvider>,
    )

  it('asks for a reason before approving a swap that breaks a labor rule, and blocks a missed 24-hour rest', async () => {
    const user = userEvent.setup()
    const { client, decide } = fake([
      { ...base, id: 'warn', check: { status: 'needsReason', breaches: [breach], blocking: [] }, stale: false },
      { ...base, id: 'block', staff: { id: 's2', employeeNo: 'FT-09', name: 'Dina Rusel' }, check: { status: 'blocked', breaches: [{ ...breach, rule: 'MANDATORY_REST', severity: 'block', message: 'No 24-hour rest after 6 days.' }], blocking: [] }, stale: false },
    ])
    const { container } = wrap(<StaffRequestsPanel client={client} storeId="st" canDecide />)
    expect(await screen.findByText('Staff requests — 2 pending')).toBeInTheDocument()
    expect(screen.getByText('Breaks a labor rule: approving needs a reason.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve request from FT-09 Dina Rusel' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Approve request from PT-05 Guy Hapin' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(await within(dialog).findByText('Give a reason to override the labor rule.')).toBeInTheDocument()
    expect(decide).not.toHaveBeenCalled()
    await user.type(within(dialog).getByRole('textbox', { name: /Reason for overriding/ }), 'Agreed with cashier')
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(decide).toHaveBeenCalledWith('st', 'warn', { decision: 'approve', reason: 'Agreed with cashier' }))
    expect(await axe(container)).toHaveNoViolations()
  })

  it('is read-only without the approve permission, and renders in Filipino', async () => {
    const { client } = fake([{ ...base, id: 'x', check: { status: 'ok', breaches: [], blocking: [] }, stale: false }])
    wrap(<StaffRequestsPanel client={client} storeId="st" canDecide={false} />, 'fil')
    expect(await screen.findByText('Mga hiling ng staff — 1 nakabinbin')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Aprubahan/ })).toBeNull()
    expect(screen.getByText(/Ibigay ang Sab, Dis 19/)).toBeInTheDocument()
  })
})

describe('toMyRosterModel', () => {
  it('groups days by week, maps rest/unavailable, carries the previous times and builds calendar events', () => {
    const res: MyRosterResponse = {
      staff: { id: 'me', employeeNo: 'PT-02', name: 'Me', storeName: 'SM QC', departmentName: 'Main', contract: 'PT' },
      from: '2026-12-14',
      to: '2026-12-21',
      travelLimit: null,
      synthetic: true,
      days: [
        { date: '2026-12-14', shifts: [], absence: 'rest', removed: [] },
        { date: '2026-12-15', shifts: [], absence: 'unavailable', removed: [{ shiftId: 'gone', type: 'time_off', by: 'R. Lim', at: '2026-12-10T00:00:00Z', date: '2026-12-15', startMin: 900, endMin: 1140 }] },
        { date: '2026-12-16', shifts: [], absence: null, removed: [] },
        {
          date: '2026-12-19',
          shifts: [
            {
              id: 's19',
              storeId: 'st',
              storeName: 'SM QC',
              departmentId: 'd1',
              departmentName: 'Main',
              date: '2026-12-19',
              startMin: 720,
              endMin: 1260,
              activities: [],
              changed: { type: 'time_change', by: 'R. Lim', at: '2026-12-18T10:02:00Z', previous: { date: '2026-12-19', startMin: 780, endMin: 1020 } },
              pendingRequestId: 'r1',
            },
          ],
          absence: null,
          removed: [],
        },
        { date: '2026-12-21', shifts: [], absence: 'rest', removed: [] },
      ],
    }
    const m = toMyRosterModel(res)
    expect(m.weeks.map((w) => w.start)).toEqual(['2026-12-14', '2026-12-21'])
    expect(m.weeks[0]?.days.map((d) => d.absence ?? d.shift?.id)).toEqual(['dayOff', 'unavailable', 's19'])
    expect(m.weeks[0]?.days[2]).toMatchObject({ previous: { startMin: 780, endMin: 1020 }, pending: true, shift: { edited: { by: 'R. Lim' } } })
    expect(m.latestChange?.shift?.id).toBe('s19')
    expect(m.removed).toEqual([expect.objectContaining({ shiftId: 'gone', date: '2026-12-15' })])
    expect(m.calendar).toEqual([{ id: 's19', date: '2026-12-19', startMin: 720, endMin: 1260, title: 'Main', location: 'SM QC' }])
  })
})
