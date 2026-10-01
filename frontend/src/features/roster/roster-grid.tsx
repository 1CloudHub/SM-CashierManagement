import { useId, useMemo, useState } from 'react'
import type { IsoDate } from '@lanewise/shared'
import { cellActionLabel } from '@/components/a11y/labelling'
import { Col, Grid } from '@/components/layout/grid'
import { Stack } from '@/components/layout/stack'
import { Currency, Num } from '@/components/ui/currency'
import { StateBlock } from '@/components/ui/state-block'
import { cn } from '@/lib/utils'
import { catStyle, chipCategory } from './category'
import type {
  ColourBy,
  GridCell,
  GridRow,
  OpenShift,
  RosterDepartment,
  RosterTotals,
} from './types'
import { useRosterFormat } from './use-roster-format'
import './roster.css'

export interface RosterGridProps {
  /** Week = full chips; Fortnight / Four weeks = narrower chips (start only). */
  view: 'week' | 'fortnight' | 'fourWeeks'
  /** The consecutive days shown (see `gridDays`). */
  days: readonly IsoDate[]
  rows: readonly GridRow[]
  departments: readonly RosterDepartment[]
  openShifts?: readonly OpenShift[]
  totals: RosterTotals
  /** Offer "Add shift" on empty cells. */
  editable?: boolean
  onOpenShift?: (shiftId: string) => void
  onOpenOpenShift?: (openShiftId: string) => void
  onAddShift?: (cashierId: string, date: IsoDate) => void
  /** Emitted when the department filter or colour-by choice changes. */
  onFiltersChange?: (filters: { departmentIds: string[]; colourBy: ColourBy }) => void
}

const COLOUR_BY: readonly ColourBy[] = ['department', 'contract', 'homeStore']

/**
 * Week / Fortnight / Four-weeks grid (task 13.2 — requirement 6.3/6.4,
 * wireframe SCR-022 Week view).
 *
 * A real table (caption, day column headers, cashier row headers) of shift
 * chips. Each chip has a colour band AND a letter, start/end times and ✎ for
 * manager changes; rest-day, unavailable and open-shift cells are labelled in
 * text. Beside it: the totals panel and the department / colour-by filters.
 */
export function RosterGrid({
  view,
  days,
  rows,
  departments,
  openShifts = [],
  totals,
  editable = false,
  onOpenShift,
  onOpenOpenShift,
  onAddShift,
  onFiltersChange,
}: RosterGridProps) {
  const f = useRosterFormat()
  const uid = useId()
  const [deptIds, setDeptIds] = useState<string[]>(() => departments.map((d) => d.id))
  const [colourBy, setColourBy] = useState<ColourBy>('department')
  const dept = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments])
  const compact = view !== 'week'

  const update = (next: { departmentIds?: string[]; colourBy?: ColourBy }) => {
    const departmentIds = next.departmentIds ?? deptIds
    const cb = next.colourBy ?? colourBy
    setDeptIds(departmentIds)
    setColourBy(cb)
    onFiltersChange?.({ departmentIds, colourBy: cb })
  }

  const visibleRows = rows.filter((r) => r.cashier.skills.some((s) => deptIds.includes(s)))
  const visibleOpen = openShifts.filter((o) => deptIds.includes(o.departmentId))

  const cellBase = cn(
    'flex w-full min-h-tap overflow-hidden border text-left text-caption',
    compact ? 'min-w-12' : 'min-w-24',
  )

  const renderCell = (row: GridRow, date: IsoDate) => {
    const cell: GridCell = row.cells[date] ?? { kind: 'empty' }
    const who = `${row.cashier.id} ${row.cashier.name}`
    if (cell.kind === 'shift' && deptIds.includes(cell.shift.departmentId)) {
      const s = cell.shift
      const d = dept.get(s.departmentId)
      const cat = chipCategory(colourBy, row.cashier, d, f.t)
      return (
        <button
          type="button"
          className={cn(
            cellBase,
            'border-outline-subtle bg-surface text-text motion-interactive hover:border-primary focus-visible:outline-focus-ring',
            s.edited && 'lw-edited',
          )}
          aria-label={[
            f.shiftLabel(row.cashier, s, d, { date: true }),
            colourBy !== 'department' ? cat.name : undefined,
          ]
            .filter(Boolean)
            .join(', ')}
          onClick={() => onOpenShift?.(s.id)}
        >
          <b
            aria-hidden="true"
            className="lw-cat-band grid w-5 shrink-0 place-items-center font-weight-bold"
            style={catStyle(cat.viz)}
          >
            {cat.letter}
          </b>
          <span aria-hidden="true" className="lw-numeric px-1 py-0.5 leading-tight">
            {f.time(s.startMin)}
            {!compact && (
              <>
                <br />
                {f.time(s.endMin)}
              </>
            )}
            {s.edited && ' ✎'}
          </span>
        </button>
      )
    }
    if (cell.kind === 'absence') {
      return (
        <div
          className={cn(
            cellBase,
            'items-center border-transparent bg-surface-2 px-1 text-text-muted',
            cell.absence === 'unavailable' && 'lw-hatch-unavailable',
          )}
        >
          {f.absence(cell.absence)}
        </div>
      )
    }
    if (editable && onAddShift) {
      return (
        <button
          type="button"
          className={cn(
            cellBase,
            'items-center justify-center border-transparent bg-surface-2 text-text-muted hover:border-primary focus-visible:outline-focus-ring',
          )}
          aria-label={cellActionLabel(f.t('roster.grid.addShift'), who, f.day(date))}
          onClick={() => onAddShift(row.cashier.id, date)}
        >
          <span aria-hidden="true">+</span>
        </button>
      )
    }
    return (
      <div className={cn(cellBase, 'border-transparent bg-surface-2')}>
        <span className="sr-only">{f.t('roster.grid.noShift')}</span>
      </div>
    )
  }

  const first = days[0]
  const last = days[days.length - 1]

  return (
    <Grid>
      <Col as="aside" span={4} spanTablet={4} spanLaptop={2} aria-labelledby={`${uid}-totals`}>
        <Stack gap={2} className="border border-outline bg-surface p-4">
          <h3 id={`${uid}-totals`} className="text-h3 text-text">
            {f.t('roster.totals.title')}
          </h3>
          <dl className="m-0 flex flex-col">
            {(
              [
                ['shifts', <Num key="v" value={totals.shifts} />],
                ...(totals.cost === undefined
                  ? []
                  : ([['cost', <Currency key="v" value={totals.cost} options={{ maximumFractionDigits: 0 }} />]] as const)),
                ['paidHours', <Num key="v" value={totals.paidHours} />],
                ['openShifts', <Num key="v" value={totals.openShifts} />],
                ['borrowed', <Num key="v" value={totals.borrowed} />],
              ] as const
            ).map(([key, value], i) => (
              <div
                key={key}
                className={cn('flex flex-col-reverse py-2', i > 0 && 'border-t border-outline-subtle')}
              >
                <dt className="text-body-sm text-text-muted">{f.t(`roster.totals.${key}`)}</dt>
                <dd
                  className={cn(
                    'm-0 text-h2 text-text',
                    key === 'openShifts' && totals.openShifts > 0 && 'text-on-danger-soft',
                  )}
                >
                  {value}
                  {key === 'openShifts' && totals.openShifts > 0 && (
                    <span className="sr-only"> {f.t('roster.grid.needsCover')}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Stack>
      </Col>

      <Col span={4} spanTablet={8} spanLaptop={8} className="min-w-0">
        {visibleRows.length === 0 ? (
          <StateBlock
            variant="empty"
            title={f.t('roster.grid.empty.title')}
            description={f.t('roster.grid.empty.description')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-1 text-body-sm">
              <caption className="sr-only">
                {f.t('roster.grid.caption', { start: f.day(first), end: f.day(last) })}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="sr-only">
                    {f.t('roster.grid.cashier')}
                  </th>
                  {days.map((d) => (
                    <th
                      key={d}
                      scope="col"
                      className="px-1 text-left text-label uppercase text-text-muted"
                    >
                      {compact ? f.dayShort(d) : f.day(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.cashier.id}>
                    <th
                      scope="row"
                      className="min-w-32 pr-2 text-left text-caption font-weight-semibold text-text"
                    >
                      {row.cashier.id} {row.cashier.name}
                    </th>
                    {days.map((d) => (
                      <td key={d} className="p-0">
                        {renderCell(row, d)}
                      </td>
                    ))}
                  </tr>
                ))}
                {visibleOpen.length > 0 && (
                  <tr>
                    <th
                      scope="row"
                      className="pr-2 text-left text-caption font-weight-semibold text-text"
                    >
                      {f.t('roster.grid.openShifts')}
                    </th>
                    {days.map((d) => {
                      const open = visibleOpen.filter((o) => o.date === d)
                      return (
                        <td key={d} className="p-0 align-top">
                          <Stack gap={1}>
                            {open.map((o) => (
                              <button
                                key={o.id}
                                type="button"
                                className={cn(
                                  cellBase,
                                  'border-dashed border-danger bg-surface text-text focus-visible:outline-focus-ring',
                                )}
                                aria-label={f.t('roster.grid.openShiftLabel', {
                                  count: f.num(o.count),
                                  department: dept.get(o.departmentId)?.name ?? '',
                                  time: f.range(o.startMin, o.endMin),
                                  date: f.day(o.date),
                                })}
                                onClick={() => onOpenOpenShift?.(o.id)}
                              >
                                <b
                                  aria-hidden="true"
                                  className="grid w-5 shrink-0 place-items-center bg-danger font-weight-bold text-on-danger"
                                >
                                  !
                                </b>
                                <span aria-hidden="true" className="lw-numeric px-1 py-0.5 leading-tight">
                                  {f.time(o.startMin)}
                                  {!compact && (
                                    <>
                                      <br />
                                      {f.time(o.endMin)}
                                    </>
                                  )}{' '}
                                  ×{f.num(o.count)}
                                </span>
                              </button>
                            ))}
                            {open.length === 0 && (
                              <div className={cn(cellBase, 'border-transparent bg-surface-2')}>
                                <span className="sr-only">{f.t('roster.grid.noOpenShifts')}</span>
                              </div>
                            )}
                          </Stack>
                        </td>
                      )
                    })}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Col>

      <Col as="aside" span={4} spanTablet={4} spanLaptop={2} aria-labelledby={`${uid}-filters`}>
        <Stack gap={3} className="border border-outline bg-surface p-4">
          <h3 id={`${uid}-filters`} className="text-h3 text-text">
            {f.t('roster.filters.title')}
          </h3>
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1 text-label uppercase text-text-muted">
              {f.t('roster.filters.departments')}
            </legend>
            {departments.map((d) => (
              <label key={d.id} className="flex min-h-tap items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  checked={deptIds.includes(d.id)}
                  onChange={(e) =>
                    update({
                      departmentIds: e.target.checked
                        ? [...deptIds, d.id]
                        : deptIds.filter((x) => x !== d.id),
                    })
                  }
                />
                <span
                  aria-hidden="true"
                  className="lw-cat-band grid size-5 place-items-center text-caption font-weight-bold"
                  style={catStyle(d.viz)}
                >
                  {d.letter}
                </span>
                {d.shortName}
              </label>
            ))}
          </fieldset>
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1 text-label uppercase text-text-muted">
              {f.t('roster.filters.colourBy')}
            </legend>
            {COLOUR_BY.map((c) => (
              <label key={c} className="flex min-h-tap items-center gap-2 text-body-sm">
                <input
                  type="radio"
                  name={`${uid}-colour-by`}
                  checked={colourBy === c}
                  onChange={() => update({ colourBy: c })}
                />
                {f.t(`roster.filters.colourBy.${c}`)}
              </label>
            ))}
          </fieldset>
        </Stack>
      </Col>
    </Grid>
  )
}
