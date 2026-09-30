import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n'
import { MobileDayList, MobileWeekList } from './mobile-roster'
import { MyRoster } from './my-roster'
import { ShiftEditor } from './shift-editor'
import { DEFAULT_DAY_WINDOW } from './model'
import {
  SAMPLE_DATE,
  SAMPLE_DAY_ROWS,
  SAMPLE_DEPARTMENTS,
  SAMPLE_MY_LATEST_CHANGE,
  SAMPLE_MY_WEEKS,
  SAMPLE_OPEN_SHIFTS,
  SAMPLE_WEEK_DAYS,
  hm,
  sampleGridRows,
} from './fixtures'

function wrap(ui: ReactNode, locale: 'en' | 'fil' = 'en') {
  return render(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>)
}

describe('MobileDayList (13.3)', () => {
  it('lists one card per cashier; only Emergency off / reassign is actionable', async () => {
    const user = userEvent.setup()
    const onEmergencyOff = vi.fn()
    wrap(
      <MobileDayList date={SAMPLE_DATE} rows={SAMPLE_DAY_ROWS} departments={SAMPLE_DEPARTMENTS} onEmergencyOff={onEmergencyOff} />,
    )
    const list = screen.getByRole('list', { name: 'Cashiers on Sat, Dec 19, 2026' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(SAMPLE_DAY_ROWS.length)
    expect(screen.getByText(/Edit other changes on a larger screen/)).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getAllByText(/changed by R\. Lim/)).toHaveLength(2)
    const buttons = screen.getAllByRole('button')
    expect(buttons.every((b) => /^Emergency off \/ reassign/.test(b.getAttribute('aria-label') ?? ''))).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Emergency off / reassign — PT-02 Maria Santos, Sat, Dec 19' }))
    expect(onEmergencyOff).toHaveBeenCalledWith('PT-02-2026-12-19')
  })

  it('is fully read-only without onEmergencyOff', () => {
    wrap(<MobileDayList date={SAMPLE_DATE} rows={SAMPLE_DAY_ROWS} departments={SAMPLE_DEPARTMENTS} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    const { container } = wrap(
      <MobileDayList date={SAMPLE_DATE} rows={SAMPLE_DAY_ROWS} departments={SAMPLE_DEPARTMENTS} onEmergencyOff={() => {}} />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('MobileWeekList (13.3)', () => {
  const props = {
    days: SAMPLE_WEEK_DAYS,
    rows: sampleGridRows(SAMPLE_WEEK_DAYS),
    departments: SAMPLE_DEPARTMENTS,
    openShifts: SAMPLE_OPEN_SHIFTS,
  }

  it('lists one card per day with its shifts, open shifts and absences', () => {
    wrap(<MobileWeekList {...props} />)
    const sat = screen.getByRole('region', { name: /Sat, Dec 19/ })
    expect(within(sat).getByText('PT-02 Maria Santos')).toBeInTheDocument()
    expect(within(sat).getByText(/2 open, Main checkout lanes, 1:00 PM – 5:00 PM/)).toBeInTheDocument()
    const mon = screen.getByRole('region', { name: /Mon, Dec 14/ })
    expect(within(mon).getByText(/FT-01 Isa Palma: Day off/)).toBeInTheDocument()
    expect(screen.getAllByRole('region')).toHaveLength(7)
  })

  it('has no axe violations', async () => {
    const { container } = wrap(<MobileWeekList {...props} onEmergencyOff={() => {}} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('MyRoster — staff (13.3)', () => {
  const props = {
    heading: 'Maria Santos (PT-02) · SM Supermarket – Quezon City · Main checkout lanes',
    weeks: SAMPLE_MY_WEEKS,
    departments: SAMPLE_DEPARTMENTS,
    latestChange: SAMPLE_MY_LATEST_CHANGE,
  }

  it('shows own shifts per day with meal, paid hours, payday and the ✎ change', async () => {
    const user = userEvent.setup()
    const onAddToCalendar = vi.fn()
    wrap(<MyRoster {...props} onAddToCalendar={onAddToCalendar} />)
    expect(screen.getByText(/Sat, Dec 19 changed from 1:00 PM – 5:00 PM to 12:00 PM – 9:00 PM by R\. Lim/)).toBeInTheDocument()
    const week = screen.getByRole('list', { name: 'Mon, Dec 14 – Sun, Dec 20' })
    const sat = within(week).getByRole('heading', { name: 'Sat, Dec 19' }).closest('li')!
    expect(sat).toHaveTextContent('12:00 PM – 9:00 PM')
    expect(sat).toHaveTextContent('meal 4:00 PM')
    expect(sat).toHaveTextContent('8 h paid')
    expect(sat).toHaveTextContent('Changed')
    expect(sat).toHaveTextContent('Was 1:00 PM – 5:00 PM')
    expect(within(week).getByText('Rest day')).toBeInTheDocument()
    expect(within(week).getByText('Payday')).toBeInTheDocument()
    // No other staff names appear.
    expect(screen.queryByText(/Isa Palma|Guy Hapin/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Next week' }))
    expect(screen.getByRole('list', { name: 'Mon, Dec 21 – Sun, Dec 27' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Mon, Dec 28 – Sun, Jan 3' }))
    expect(screen.getByText('No shifts this week.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add to calendar' }))
    expect(onAddToCalendar).toHaveBeenCalled()
  })

  it('renders in Filipino', () => {
    wrap(<MyRoster {...props} onAddToCalendar={() => {}} />, 'fil')
    expect(screen.getByRole('tab', { name: 'Ngayong linggo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Idagdag sa calendar' })).toBeInTheDocument()
    expect(screen.getByText('Araw ng pahinga')).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    const { container } = wrap(<MyRoster {...props} onAddToCalendar={() => {}} onOpenShift={() => {}} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('ShiftEditor (13.1)', () => {
  const row = SAMPLE_DAY_ROWS.find((r) => r.cashier.id === 'PT-02')!
  const props = {
    open: true,
    onOpenChange: () => {},
    cashier: row.cashier,
    shift: row.shift!,
    department: SAMPLE_DEPARTMENTS[0],
    window: DEFAULT_DAY_WINDOW,
    replacements: [
      { cashierId: 'FT-07', label: 'FT-07 · same store · 5 days, 40 h', eligible: true },
      { cashierId: 'PT-05', label: 'PT-05 · same store · would exceed 30 h', eligible: false },
    ],
  }

  it('edits start/end and activities by keyboard and saves the draft', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    wrap(<ShiftEditor {...props} onSave={onSave} />)
    const dialog = screen.getByRole('dialog', { name: 'PT-02 Maria Santos' })
    expect(dialog).toHaveTextContent('Sat, Dec 19, 2026 · 8 h paid · Main checkout lanes')
    await user.selectOptions(within(dialog).getByLabelText('End'), String(hm(20)))
    await user.click(within(dialog).getByRole('button', { name: 'Remove Training 1:30 PM – 2:00 PM' }))
    await user.selectOptions(within(dialog).getByLabelText('Activity'), 'huddle')
    await user.selectOptions(within(dialog).getByLabelText('Activity start'), String(hm(12)))
    await user.click(within(dialog).getByRole('button', { name: 'Add activity' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save shift' }))
    expect(onSave).toHaveBeenCalledWith({
      shiftId: 'PT-02-2026-12-19',
      startMin: hm(12),
      endMin: hm(20),
      activities: [
        { kind: 'huddle', startMin: hm(12), endMin: hm(12, 30) },
        { kind: 'meal', startMin: hm(16), endMin: hm(17) },
      ],
    })
  })

  it('blocks saving an end before the start, and a blocking rule check', async () => {
    const user = userEvent.setup()
    const { rerender } = wrap(<ShiftEditor {...props} />)
    await user.selectOptions(screen.getByLabelText('End'), String(hm(11)))
    expect(screen.getByText('End must be after start.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save shift' })).toBeDisabled()
    rerender(
      <I18nProvider initialLocale="en">
        <ShiftEditor {...props} ruleChecks={[{ id: 'rest', tone: 'danger', text: 'No 24-hour rest after 6 days' }]} />
      </I18nProvider>,
    )
    expect(screen.getByText('No 24-hour rest after 6 days')).toBeInTheDocument()
    expect(screen.getByText('Blocked:')).toBeInTheDocument()
  })

  it('emergency off offers eligible replacements first and "Find cover nearby"', async () => {
    const user = userEvent.setup()
    const onEmergencyOff = vi.fn()
    wrap(<ShiftEditor {...props} canEditTimes={false} onEmergencyOff={onEmergencyOff} />)
    expect(screen.getByRole('tab', { name: 'Edit shift' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /FT-07.*eligible/ })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'Find cover from nearby stores' }))
    await user.selectOptions(screen.getByLabelText('Reason'), 'family')
    await user.click(screen.getByRole('button', { name: 'Mark emergency off' }))
    expect(onEmergencyOff).toHaveBeenCalledWith({
      shiftId: 'PT-02-2026-12-19',
      replacementId: null,
      findNearby: true,
      reason: 'family',
    })
  })

  it('has no axe violations', async () => {
    wrap(
      <ShiftEditor
        {...props}
        ruleChecks={[
          { id: 'rest', tone: 'success', text: 'Rest ≥ 10 h' },
          { id: 'hours', tone: 'warning', text: '32 h (PT limit 30 h — reason required)' },
        ]}
      />,
    )
    expect(await axe(document.body)).toHaveNoViolations()
  })
})
