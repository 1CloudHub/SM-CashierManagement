import { useId } from 'react'
import type { IsoDate } from '@lanewise/shared'
import { cellActionLabel } from '@/components/a11y/labelling'
import { Stack } from '@/components/layout/stack'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { catStyle } from './category'
import type {
  DayTimelineRow,
  GridRow,
  OpenShift,
  RosterCashier,
  RosterDepartment,
  RosterShift,
} from './types'
import { useRosterFormat, type RosterFormat } from './use-roster-format'
import './roster.css'

/**
 * Phone roster views (task 13.3 — requirement 6.5, 24.2, design.md "Mobile
 * interaction policy"). Below 600 px the Day timeline becomes a list of
 * cashier cards and the Week grid a list of day cards. They are read-only
 * except Emergency off / reassign, which store managers keep on a phone
 * (`onEmergencyOff`); every other edit shows "Edit on a larger screen".
 */

interface ShiftLineProps {
  f: RosterFormat
  cashier: RosterCashier
  shift: RosterShift
  department: RosterDepartment | undefined
  date: IsoDate
  onEmergencyOff?: (shiftId: string) => void
  showName?: boolean
}

/** One shift as a text line: department band + letter, times, activities, ✎. */
function ShiftLine({ f, cashier, shift, department, date, onEmergencyOff, showName }: ShiftLineProps) {
  return (
    <Stack gap={2}>
      <div className="flex items-start gap-2">
        <b
          aria-hidden="true"
          className="lw-cat-band grid size-6 shrink-0 place-items-center text-caption font-weight-bold"
          style={catStyle(department?.viz ?? 5)}
        >
          {department?.letter}
        </b>
        <div className="min-w-0 text-body-sm">
          {showName && (
            <p className="font-weight-semibold text-text">
              {cashier.id} {cashier.name}
            </p>
          )}
          <p className="lw-numeric font-weight-semibold text-text">
            {f.range(shift.startMin, shift.endMin)}
            <span className="font-weight-regular text-text-muted"> · {department?.name}</span>
          </p>
          {shift.activities.length > 0 && (
            <p className="text-text-muted">{shift.activities.map(f.activityText).join(' · ')}</p>
          )}
          {shift.edited && (
            <p className="text-text">
              <span aria-hidden="true">✎ </span>
              {f.t('roster.shift.edited', { by: shift.edited.by })}
            </p>
          )}
        </div>
      </div>
      {onEmergencyOff && (
        <Button
          size="sm"
          className="self-start"
          aria-label={cellActionLabel(
            f.t('roster.mobile.emergencyOff'),
            `${cashier.id} ${cashier.name}`,
            f.day(date),
          )}
          onClick={() => onEmergencyOff(shift.id)}
        >
          {f.t('roster.mobile.emergencyOff')}
        </Button>
      )}
    </Stack>
  )
}

function ReadOnlyNote({ f }: { f: RosterFormat }) {
  return <p className="text-body-sm text-text-muted">{f.t('roster.mobile.readOnly')}</p>
}

/** Day view on a phone: one card per cashier. */
export function MobileDayList({
  date,
  rows,
  departments,
  onEmergencyOff,
}: {
  date: IsoDate
  rows: readonly DayTimelineRow[]
  departments: readonly RosterDepartment[]
  /** Store manager only; omit for a fully read-only list. */
  onEmergencyOff?: (shiftId: string) => void
}) {
  const f = useRosterFormat()
  const dept = new Map(departments.map((d) => [d.id, d]))
  return (
    <Stack gap={3}>
      <ReadOnlyNote f={f} />
      <ul aria-label={f.t('roster.mobile.dayList', { date: f.dayLong(date) })} className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map(({ cashier, shift, absence }) => (
          <li
            key={cashier.id}
            className={cn(
              'border-2 border-outline bg-surface p-3',
              shift?.edited && 'lw-edited',
            )}
          >
            <Stack gap={2}>
              <div>
                <p className="text-body font-weight-semibold text-text">
                  {cashier.id} {cashier.name}
                </p>
                <p className="text-caption text-text-muted">{f.cashierDetail(cashier)}</p>
              </div>
              {shift ? (
                <ShiftLine
                  f={f}
                  cashier={cashier}
                  shift={shift}
                  department={dept.get(shift.departmentId)}
                  date={date}
                  onEmergencyOff={onEmergencyOff}
                />
              ) : (
                <p
                  className={cn(
                    'bg-surface-2 px-2 py-1 text-body-sm text-text-muted',
                    absence === 'unavailable' && 'lw-hatch-unavailable',
                  )}
                >
                  {absence ? f.absence(absence) : f.t('roster.grid.noShift')}
                </p>
              )}
            </Stack>
          </li>
        ))}
      </ul>
    </Stack>
  )
}

/** Week view on a phone: one card per day listing its shifts. */
export function MobileWeekList({
  days,
  rows,
  departments,
  openShifts = [],
  onEmergencyOff,
}: {
  days: readonly IsoDate[]
  rows: readonly GridRow[]
  departments: readonly RosterDepartment[]
  openShifts?: readonly OpenShift[]
  onEmergencyOff?: (shiftId: string) => void
}) {
  const f = useRosterFormat()
  const uid = useId()
  const dept = new Map(departments.map((d) => [d.id, d]))
  return (
    <Stack gap={3}>
      <ReadOnlyNote f={f} />
      {days.map((date) => {
        const shifts = rows.flatMap((r) => {
          const c = r.cells[date]
          return c?.kind === 'shift' ? [{ cashier: r.cashier, shift: c.shift }] : []
        })
        const off = rows.flatMap((r) => {
          const c = r.cells[date]
          return c?.kind === 'absence' ? [{ cashier: r.cashier, absence: c.absence }] : []
        })
        const open = openShifts.filter((o) => o.date === date)
        const headingId = `${uid}-${date}`
        return (
          <section
            key={date}
            aria-labelledby={headingId}
            className="border-2 border-outline bg-surface p-3"
          >
            <Stack gap={2}>
              <h3 id={headingId} className="text-h3 text-text">
                {f.day(date)}
                <span className="ml-2 text-body-sm font-weight-regular text-text-muted">
                  {shifts.length === 1
                    ? f.t('roster.mobile.shiftsOne')
                    : f.t('roster.mobile.shiftsOther', { count: f.num(shifts.length) })}
                </span>
              </h3>
              {open.map((o) => (
                <p key={o.id} className="border-2 border-dashed border-danger px-2 py-1 text-body-sm font-weight-semibold text-on-danger-soft">
                  <span aria-hidden="true">! </span>
                  {f.t('roster.grid.openShiftLabel', {
                    count: f.num(o.count),
                    department: dept.get(o.departmentId)?.name ?? '',
                    time: f.range(o.startMin, o.endMin),
                    date: f.day(o.date),
                  })}
                </p>
              ))}
              {shifts.length === 0 ? (
                <p className="text-body-sm text-text-muted">{f.t('roster.mobile.noShifts')}</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {shifts.map(({ cashier, shift }) => (
                    <li key={shift.id} className={cn(shift.edited && 'lw-edited')}>
                      <ShiftLine
                        f={f}
                        cashier={cashier}
                        shift={shift}
                        department={dept.get(shift.departmentId)}
                        date={date}
                        onEmergencyOff={onEmergencyOff}
                        showName
                      />
                    </li>
                  ))}
                </ul>
              )}
              {off.length > 0 && (
                <p className="text-body-sm text-text-muted">
                  {off
                    .map(({ cashier, absence }) => `${cashier.id} ${cashier.name}: ${f.absence(absence)}`)
                    .join(' · ')}
                </p>
              )}
            </Stack>
          </section>
        )
      })}
    </Stack>
  )
}
