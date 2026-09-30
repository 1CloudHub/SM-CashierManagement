import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import fc from 'fast-check'
import { useState, type ReactNode } from 'react'
import { I18nProvider } from '@/i18n'
import { DayTimeline, type DayTimelineProps } from './day-timeline'
import { RosterLegend } from './roster-legend'
import {
  SAMPLE_DATE,
  SAMPLE_DAY_ROWS,
  SAMPLE_DEPARTMENTS,
  SAMPLE_REQUIREMENTS,
  hm,
} from './fixtures'
import type { DayTimelineRow, RosterShift } from './types'

function wrap(ui: ReactNode) {
  return render(<I18nProvider initialLocale="en">{ui}</I18nProvider>)
}

const base: DayTimelineProps = {
  date: SAMPLE_DATE,
  rows: SAMPLE_DAY_ROWS,
  departments: SAMPLE_DEPARTMENTS,
  requirements: SAMPLE_REQUIREMENTS,
}

/** Keeps rows in state so keyboard edits re-render like a real parent. */
function Stateful(props: Partial<DayTimelineProps>) {
  const [rows, setRows] = useState<readonly DayTimelineRow[]>(SAMPLE_DAY_ROWS)
  return (
    <DayTimeline
      {...base}
      editable
      {...props}
      rows={rows}
      onShiftChange={(c) => {
        props.onShiftChange?.(c)
        setRows((prev) =>
          prev.map((r) =>
            r.shift?.id === c.shiftId ? { ...r, shift: { ...r.shift, startMin: c.startMin, endMin: c.endMin } } : r,
          ),
        )
      }}
    />
  )
}

const bar = (name: RegExp) => screen.getByRole('button', { name })

describe('DayTimeline (13.1)', () => {
  it('renders a row per cashier with named shift bars, activities, ✎ and absence bands', () => {
    wrap(<DayTimeline {...base} />)
    const region = screen.getByRole('region', { name: /day timeline: cashiers by hour/i })
    expect(region).toBeInTheDocument()
    const maria = bar(/^PT-02 Maria Santos/)
    expect(maria).toHaveAccessibleName(
      'PT-02 Maria Santos, 12:00 PM – 9:00 PM, Main checkout lanes, Training 1:30 PM – 2:00 PM, Meal 4:00 PM – 5:00 PM, changed by R. Lim',
    )
    expect(maria).toHaveTextContent('✎')
    expect(bar(/^FL-01 Cam Wills.*Float/)).toBeInTheDocument()
    expect(within(region).getByText('Day off')).toBeInTheDocument()
    expect(within(region).getByText('Unavailable')).toBeInTheDocument()
    expect(within(region).getByText(/Borrowed · SM Megamall \(22 min\)/)).toBeInTheDocument()
  })

  it('shows the staffing-vs-need strip and the required-on-lanes row as text', () => {
    wrap(<DayTimeline {...base} />)
    const strip = screen.getByRole('list', { name: 'Staffing vs need' })
    const items = within(strip).getAllByRole('listitem')
    expect(items.map((li) => Number(li.dataset.delta))).toEqual([0, -1, 0, 1, 0, 0, -2, -2, -1, 0, 1, 0, 0, 0, 0, 0])
    expect(items[6]).toHaveTextContent('1 PM: -2 short (4 rostered, 6 required)')
    const cov = screen.getByRole('list', { name: 'Required on lanes' })
    expect(within(cov).getAllByRole('listitem')[7]).toHaveTextContent('2 PM: 7 required on lanes')
  })

  it('has no axe violations (read-only and editable, with legend)', async () => {
    const { container, unmount } = wrap(
      <>
        <RosterLegend departments={SAMPLE_DEPARTMENTS} />
        <DayTimeline {...base} />
      </>,
    )
    expect(await axe(container)).toHaveNoViolations()
    unmount()
    const editable = wrap(<Stateful selectedShiftIds={['FT-01-2026-12-19']} />)
    expect(await axe(editable.container)).toHaveNoViolations()
  })

  it('is one Tab stop; arrows move focus between shifts; Enter opens the editor', async () => {
    const user = userEvent.setup()
    const onOpenShift = vi.fn()
    wrap(<DayTimeline {...base} onOpenShift={onOpenShift} />)
    const bars = screen.getAllByRole('button').filter((b) => b.hasAttribute('data-shift-id'))
    expect(bars.filter((b) => b.tabIndex === 0)).toHaveLength(1)
    await user.tab() // "View as table"
    await user.tab()
    expect(bar(/^FT-01/)).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(bar(/^FT-03/)).toHaveFocus()
    await user.keyboard('{ArrowDown}') // skips the FT-07 day-off row
    expect(bar(/^PT-02/)).toHaveFocus()
    await user.keyboard('{End}')
    expect(bar(/^FL-01/)).toHaveFocus()
    await user.keyboard('{Home}{Enter}')
    expect(onOpenShift).toHaveBeenCalledWith('FT-01-2026-12-19')
  })

  it('moves by the 15-min snap, by an hour with Page keys, and resizes with Shift', async () => {
    const user = userEvent.setup()
    const onShiftChange = vi.fn()
    wrap(<Stateful onShiftChange={onShiftChange} />)
    act(() => bar(/^FT-01/).focus())
    await user.keyboard('{ArrowRight}')
    expect(onShiftChange).toHaveBeenLastCalledWith({ shiftId: 'FT-01-2026-12-19', startMin: hm(9, 15), endMin: hm(18, 15) })
    await user.keyboard('{PageUp}')
    expect(onShiftChange).toHaveBeenLastCalledWith({ shiftId: 'FT-01-2026-12-19', startMin: hm(8, 15), endMin: hm(17, 15) })
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    expect(onShiftChange).toHaveBeenLastCalledWith({ shiftId: 'FT-01-2026-12-19', startMin: hm(8, 15), endMin: hm(17) })
    await user.keyboard('{Shift>}{PageDown}{/Shift}')
    expect(onShiftChange).toHaveBeenLastCalledWith({ shiftId: 'FT-01-2026-12-19', startMin: hm(8, 15), endMin: hm(18) })
    // The bar's name and the live region follow the change.
    expect(bar(/^FT-01/)).toHaveAccessibleName(expect.stringContaining('8:15 AM – 6:00 PM'))
    expect(screen.getByText('FT-01 Isa Palma now works 8:15 AM – 6:00 PM')).toBeInTheDocument()
  })

  it('does not edit when read-only', async () => {
    const user = userEvent.setup()
    const onShiftChange = vi.fn()
    wrap(<DayTimeline {...base} onShiftChange={onShiftChange} />)
    act(() => bar(/^FT-01/).focus())
    await user.keyboard('{ArrowRight}{PageDown} ')
    expect(onShiftChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('Space and row checkboxes select shifts for the bulk bar', async () => {
    const user = userEvent.setup()
    const onBulkAction = vi.fn()
    wrap(<Stateful onBulkAction={onBulkAction} />)
    act(() => bar(/^FT-01/).focus())
    await user.keyboard(' ')
    const group = screen.getByRole('group', { name: 'Bulk actions' })
    expect(group).toHaveTextContent('1 shift selected')
    expect(bar(/^FT-01/)).toHaveAccessibleName(expect.stringMatching(/, selected$/))
    await user.click(screen.getByRole('checkbox', { name: 'Select the shift for PT-02 Maria Santos' }))
    expect(group).toHaveTextContent('2 shifts selected')
    await user.click(within(group).getByRole('button', { name: 'Reassign' }))
    expect(onBulkAction).toHaveBeenCalledWith('reassign', ['FT-01-2026-12-19', 'PT-02-2026-12-19'])
    await user.click(screen.getByRole('checkbox', { name: 'Select all shifts' }))
    expect(group).toHaveTextContent('7 shifts selected')
    await user.click(within(group).getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('group', { name: 'Bulk actions' })).not.toBeInTheDocument()
  })

  it('drags a bar to move it (snapped) without opening the editor', () => {
    const onShiftChange = vi.fn()
    const onOpenShift = vi.fn()
    wrap(<DayTimeline {...base} editable onShiftChange={onShiftChange} onOpenShift={onOpenShift} />)
    const b = bar(/^FT-01/)
    const track = b.closest('[data-track]') as HTMLElement
    // 16 visible hours over 960px → 1px = 1 minute.
    track.getBoundingClientRect = () => ({ width: 960 }) as DOMRect
    fireEvent.pointerDown(b, { button: 0, clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(b, { clientX: 137, pointerId: 1 })
    fireEvent.pointerUp(b, { clientX: 137, pointerId: 1 })
    fireEvent.click(b)
    expect(onShiftChange).toHaveBeenCalledWith({ shiftId: 'FT-01-2026-12-19', startMin: hm(9, 30), endMin: hm(18, 30) })
    expect(onOpenShift).not.toHaveBeenCalled()
  })

  it('drags an edge to resize', () => {
    const onShiftChange = vi.fn()
    const { container } = wrap(<DayTimeline {...base} editable onShiftChange={onShiftChange} />)
    const handle = container.querySelector('[data-resize="end"]') as HTMLElement
    const track = handle.closest('[data-track]') as HTMLElement
    track.getBoundingClientRect = () => ({ width: 960 }) as DOMRect
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 440, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 440, pointerId: 1 })
    expect(onShiftChange).toHaveBeenCalledWith({ shiftId: 'FT-01-2026-12-19', startMin: hm(9), endMin: hm(17) })
  })

  it('"View as table" shows the same data in tables with headers', async () => {
    const user = userEvent.setup()
    const { container } = wrap(<DayTimeline {...base} />)
    const toggle = screen.getByRole('button', { name: 'View as table' })
    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'View as timeline' })).toHaveAttribute('aria-pressed', 'true')
    const shifts = screen.getByRole('table', { name: /shifts on sat, dec 19, 2026/i })
    expect(within(shifts).getByRole('rowheader', { name: 'PT-02 Maria Santos' })).toBeInTheDocument()
    expect(within(shifts).getAllByText('changed by R. Lim')).toHaveLength(2)
    const hourly = screen.getByRole('table', { name: 'Staffing vs need by hour' })
    const row = within(hourly).getByRole('rowheader', { name: '1 PM' }).closest('tr')!
    expect(row).toHaveTextContent('46-2 short')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('property: each rendered delta chip equals rostered minus required', () => {
    const shiftArb = fc
      .record({ start: fc.integer({ min: 28, max: 88 }), len: fc.integer({ min: 1, max: 40 }), meal: fc.boolean() })
      .map(({ start, len, meal }) => {
        const startMin = start * 15
        const endMin = Math.min(92, start + len) * 15
        const activities =
          meal && endMin - startMin >= 120
            ? [{ kind: 'meal' as const, startMin: startMin + 60, endMin: startMin + 120 }]
            : []
        return { startMin, endMin, activities }
      })
      .filter((s) => s.endMin > s.startMin)

    fc.assert(
      fc.property(
        fc.array(shiftArb, { maxLength: 12 }),
        fc.array(fc.integer({ min: 0, max: 12 }), { minLength: 16, maxLength: 16 }),
        (specs, required) => {
          const rows: DayTimelineRow[] = specs.map((s, i) => {
            const shift: RosterShift = { id: `s${i}`, cashierId: `C${i}`, date: SAMPLE_DATE, departmentId: 'main', ...s }
            return { cashier: { id: `C${i}`, name: `Cashier ${i}`, contract: 'fullTime', skills: ['main'] }, shift }
          })
          const requirements = required.map((r, i) => ({ hour: 7 + i, required: r }))
          const { unmount } = wrap(<DayTimeline {...base} rows={rows} requirements={requirements} />)
          const chips = within(screen.getByRole('list', { name: 'Staffing vs need' })).getAllByRole('listitem')
          chips.forEach((li, i) => {
            const mid = (7 + i) * 60 + 30
            const rostered = specs.filter(
              (s) => s.startMin <= mid && mid < s.endMin && !s.activities.some((a) => a.startMin <= mid && mid < a.endMin),
            ).length
            const delta = rostered - required[i]
            expect(Number(li.dataset.delta)).toBe(delta)
            const visible = li.querySelector('[aria-hidden="true"]')!.textContent
            expect(visible).toBe(delta > 0 ? `+${delta}` : String(delta))
          })
          unmount()
        },
      ),
      { numRuns: 40 },
    )
  })
})
