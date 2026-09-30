import type { IsoDate } from '@lanewise/shared'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableWrap,
} from '@/components/ui/table'
import { Stack } from '@/components/layout/stack'
import type { HourDelta } from './model'
import type { DayTimelineRow, RosterDepartment } from './types'
import { useRosterFormat } from './use-roster-format'

/**
 * "View as table" — the equivalent of the Day timeline for anyone who prefers
 * or needs tabular data (design.md accessibility: every chart has a table
 * alternative). Two tables: shifts per cashier, and staffing versus need per
 * hour. Same data as the timeline, with row and column headers.
 */
export function DayTimelineTable({
  date,
  rows,
  departments,
  deltas,
  onOpenShift,
}: {
  date: IsoDate
  rows: readonly DayTimelineRow[]
  departments: readonly RosterDepartment[]
  deltas: readonly HourDelta[]
  onOpenShift?: (shiftId: string) => void
}) {
  const f = useRosterFormat()
  const dept = new Map(departments.map((d) => [d.id, d]))

  return (
    <Stack gap={4}>
      <TableWrap>
        <Table stickyFirstCol>
          <caption className="sr-only">
            {f.t('roster.table.shiftsCaption', { date: f.dayLong(date) })}
          </caption>
          <TableHead>
            <tr>
              <TableHeaderCell>{f.t('roster.table.cashier')}</TableHeaderCell>
              <TableHeaderCell>{f.t('roster.table.contract')}</TableHeaderCell>
              <TableHeaderCell>{f.t('roster.table.shift')}</TableHeaderCell>
              <TableHeaderCell>{f.t('roster.table.department')}</TableHeaderCell>
              <TableHeaderCell>{f.t('roster.table.activities')}</TableHeaderCell>
              <TableHeaderCell>{f.t('roster.table.status')}</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {rows.map(({ cashier, shift, absence }) => (
              <TableRow key={cashier.id}>
                <TableRowHeader>
                  {cashier.id} {cashier.name}
                </TableRowHeader>
                <TableCell>{f.cashierDetail(cashier)}</TableCell>
                <TableCell className="lw-numeric">
                  {shift ? (
                    onOpenShift ? (
                      <button
                        type="button"
                        className="min-h-tap text-left text-primary underline focus-visible:outline-focus-ring"
                        aria-label={f.shiftLabel(cashier, shift, dept.get(shift.departmentId))}
                        onClick={() => onOpenShift(shift.id)}
                      >
                        {f.range(shift.startMin, shift.endMin)}
                      </button>
                    ) : (
                      f.range(shift.startMin, shift.endMin)
                    )
                  ) : absence ? (
                    f.absence(absence)
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>{shift ? dept.get(shift.departmentId)?.name : '—'}</TableCell>
                <TableCell>
                  {shift && shift.activities.length
                    ? shift.activities.map(f.activityText).join('; ')
                    : '—'}
                </TableCell>
                <TableCell>
                  {shift?.edited ? (
                    <span>
                      <span aria-hidden="true">✎ </span>
                      {f.t('roster.shift.edited', { by: shift.edited.by })}
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrap>

      <TableWrap>
        <Table>
          <caption className="sr-only">{f.t('roster.table.hourlyCaption')}</caption>
          <TableHead>
            <tr>
              <TableHeaderCell>{f.t('roster.table.hour')}</TableHeaderCell>
              <TableHeaderCell numeric>{f.t('roster.table.rostered')}</TableHeaderCell>
              <TableHeaderCell numeric>{f.t('roster.table.required')}</TableHeaderCell>
              <TableHeaderCell numeric>{f.t('roster.table.difference')}</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {deltas.map((d) => (
              <TableRow key={d.hour}>
                <TableRowHeader>{f.hour(d.hour)}</TableRowHeader>
                <TableCell numeric>{f.num(d.rostered)}</TableCell>
                <TableCell numeric>{f.num(d.required)}</TableCell>
                <TableCell numeric>
                  {f.signed(d.delta)}{' '}
                  <span className="text-text-muted">{f.deltaWord(d.delta)}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrap>
    </Stack>
  )
}

