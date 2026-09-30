import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { useState, type ReactNode } from 'react'
import type { IsoDate } from '@lanewise/shared'
import { I18nProvider } from '@/i18n'
import { RosterGrid } from './roster-grid'
import { MonthCoverage } from './month-coverage'
import { RosterZoom } from './roster-zoom'
import { gridDays } from './model'
import {
  SAMPLE_DATE,
  SAMPLE_DEPARTMENTS,
  SAMPLE_MONTH,
  SAMPLE_OPEN_SHIFTS,
  SAMPLE_TOTALS,
  SAMPLE_WEEK_DAYS,
  sampleGridRows,
} from './fixtures'
import type { RosterView } from './types'

function wrap(ui: ReactNode) {
  return render(<I18nProvider initialLocale="en">{ui}</I18nProvider>)
}

const gridProps = {
  view: 'week' as const,
  days: SAMPLE_WEEK_DAYS,
  rows: sampleGridRows(SAMPLE_WEEK_DAYS),
  departments: SAMPLE_DEPARTMENTS,
  openShifts: SAMPLE_OPEN_SHIFTS,
  totals: SAMPLE_TOTALS,
}

describe('RosterGrid — Week / Fortnight / Four weeks (13.2)', () => {
  it('is a table with day column headers and cashier row headers', () => {
    wrap(<RosterGrid {...gridProps} />)
    const table = screen.getByRole('table', { name: /roster, mon, dec 14 to sun, dec 20/i })
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers.slice(1)).toEqual([
      'Mon, Dec 14', 'Tue, Dec 15', 'Wed, Dec 16', 'Thu, Dec 17', 'Fri, Dec 18', 'Sat, Dec 19', 'Sun, Dec 20',
    ])
    expect(within(table).getByRole('rowheader', { name: 'PT-02 Maria Santos' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'Open shifts' })).toBeInTheDocument()
  })

  it('chips pair the colour band with a letter and name; rest, unavailable and ✎ are text', async () => {
    const user = userEvent.setup()
    const onOpenShift = vi.fn()
    wrap(<RosterGrid {...gridProps} onOpenShift={onOpenShift} />)
    const chip = screen.getByRole('button', { name: /^PT-02 Maria Santos, Sat, Dec 19, 12:00 PM – 9:00 PM, Main checkout lanes/ })
    expect(chip).toHaveTextContent('M')
    expect(chip).toHaveTextContent('✎')
    expect(chip).toHaveAccessibleName(expect.stringContaining('changed by R. Lim'))
    expect(screen.getByRole('button', { name: /^PT-05 Guy Hapin, Tue, Dec 15.*Express lanes/ })).toHaveTextContent('E')
    expect(screen.getAllByText('Day off').length).toBeGreaterThan(0)
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    await user.click(chip)
    expect(onOpenShift).toHaveBeenCalledWith('PT-02-2026-12-19')
    expect(screen.getByRole('button', { name: '2 open, Main checkout lanes, 1:00 PM – 5:00 PM, Sat, Dec 19' })).toBeInTheDocument()
  })

  it('shows the totals panel with ₱ cost', () => {
    wrap(<RosterGrid {...gridProps} />)
    const totals = screen.getByRole('complementary', { name: 'Totals' })
    expect(within(totals).getByText('₱98,600')).toBeInTheDocument()
    expect(within(totals).getByText('1,184')).toBeInTheDocument()
    expect(within(totals).getByText('Borrowed from other stores')).toBeInTheDocument()
  })

  it('department filters hide rows and chips; colour-by swaps the letter', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    wrap(<RosterGrid {...gridProps} onFiltersChange={onFiltersChange} />)
    const filters = screen.getByRole('complementary', { name: 'Filters' })
    await user.click(within(filters).getByRole('checkbox', { name: /Express/ }))
    expect(screen.queryByRole('rowheader', { name: 'PT-05 Guy Hapin' })).not.toBeInTheDocument()
    expect(onFiltersChange).toHaveBeenLastCalledWith({ departmentIds: ['main', 'cs'], colourBy: 'department' })

    await user.click(within(filters).getByRole('radio', { name: /Home store/ }))
    const jo = screen.getByRole('button', { name: /^XS-14 Jo Tan, Sat, Dec 19/ })
    expect(jo).toHaveTextContent('B')
    expect(jo).toHaveAccessibleName(expect.stringContaining('Borrowed from another store'))

    await user.click(within(filters).getByRole('radio', { name: /Contract/ }))
    expect(screen.getByRole('button', { name: /^PT-02 Maria Santos, Tue, Dec 15/ })).toHaveTextContent('P')

    for (const name of [/Main lanes/, /Customer service/]) {
      await user.click(within(filters).getByRole('checkbox', { name }))
    }
    expect(screen.getByText('No cashiers match these filters')).toBeInTheDocument()
  })

  it('offers labelled "Add shift" on empty cells when editable', async () => {
    const user = userEvent.setup()
    const onAddShift = vi.fn()
    wrap(<RosterGrid {...gridProps} editable onAddShift={onAddShift} />)
    await user.click(screen.getByRole('button', { name: 'Add shift — PT-02 Maria Santos, Wed, Dec 16' }))
    expect(onAddShift).toHaveBeenCalledWith('PT-02', '2026-12-16')
  })

  it('Fortnight and Four weeks use compact chips (start time only)', () => {
    const days = gridDays(SAMPLE_DATE, 'fourWeeks')
    wrap(<RosterGrid {...gridProps} view="fourWeeks" days={days} rows={sampleGridRows(days)} />)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader')).toHaveLength(29)
    const chip = screen.getByRole('button', { name: /^PT-02 Maria Santos, Sat, Dec 19/ })
    expect(chip).toHaveTextContent('12:00 PM')
    expect(chip).not.toHaveTextContent('9:00 PM')
  })

  it('has no axe violations', async () => {
    const { container } = wrap(<RosterGrid {...gridProps} editable onAddShift={() => {}} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('MonthCoverage (13.2)', () => {
  it('is a calendar table; open days say so in text and open the Day view', async () => {
    const user = userEvent.setup()
    const onOpenDay = vi.fn()
    wrap(<MonthCoverage month={SAMPLE_DATE} days={SAMPLE_MONTH} onOpenDay={onOpenDay} />)
    const table = screen.getByRole('table', { name: 'Coverage for December 2026' })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(7)
    const sat = screen.getByRole('button', { name: 'Sat, Dec 19: 112 shifts, 2 open. Open the day view' })
    expect(sat).toHaveTextContent('2 open')
    expect(screen.getByRole('button', { name: 'Mon, Dec 14: 98 shifts, Filled. Open the day view' })).toBeInTheDocument()
    await user.click(sat)
    expect(onOpenDay).toHaveBeenCalledWith('2026-12-19')
  })

  it('has no axe violations', async () => {
    const { container } = wrap(<MonthCoverage month={SAMPLE_DATE} days={SAMPLE_MONTH} onOpenDay={() => {}} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

function ZoomHarness({ onView }: { onView?: (v: RosterView) => void }) {
  const [view, setView] = useState<RosterView>('day')
  const [anchor, setAnchor] = useState<IsoDate>(SAMPLE_DATE)
  return (
    <RosterZoom
      view={view}
      onViewChange={(v) => {
        onView?.(v)
        setView(v)
      }}
      anchor={anchor}
      onAnchorChange={setAnchor}
      renderView={(v) => <p>panel:{v}</p>}
    />
  )
}

describe('RosterZoom (13.2)', () => {
  it('switches Day · Week · Fortnight · Four weeks · Month with tabs semantics', async () => {
    const user = userEvent.setup()
    const onView = vi.fn()
    wrap(<ZoomHarness onView={onView} />)
    const tabs = within(screen.getByRole('tablist', { name: 'Zoom' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Day', 'Week', 'Fortnight', 'Four weeks', 'Month'])
    expect(screen.getByRole('tabpanel')).toHaveTextContent('panel:day')
    act(() => tabs[0].focus())
    await user.keyboard('{ArrowRight}')
    expect(onView).toHaveBeenLastCalledWith('week')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('panel:week')
    await user.click(screen.getByRole('tab', { name: 'Month' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('panel:month')
  })

  it('the date navigator steps one unit of the zoom', async () => {
    const user = userEvent.setup()
    wrap(<ZoomHarness />)
    const nav = screen.getByRole('group', { name: 'Date' })
    expect(nav).toHaveTextContent('Sat, Dec 19, 2026')
    await user.click(within(nav).getByRole('button', { name: 'Next day' }))
    expect(nav).toHaveTextContent('Sun, Dec 20, 2026')
    await user.click(screen.getByRole('tab', { name: 'Week' }))
    expect(nav).toHaveTextContent('Mon, Dec 14 – Sun, Dec 20')
    await user.click(within(nav).getByRole('button', { name: 'Previous week' }))
    expect(nav).toHaveTextContent('Mon, Dec 7 – Sun, Dec 13')
    await user.click(screen.getByRole('tab', { name: 'Month' }))
    expect(nav).toHaveTextContent('December 2026')
  })

  it('has no axe violations', async () => {
    const { container } = wrap(<ZoomHarness />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
