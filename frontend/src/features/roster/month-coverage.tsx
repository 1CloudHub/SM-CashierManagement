import type { IsoDate } from '@lanewise/shared'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { addDays, monthWeeks, parseIsoDate, startOfWeek } from './model'
import type { MonthDayCoverage } from './types'
import { useRosterFormat } from './use-roster-format'

/**
 * Month coverage (task 13.2 — requirement 6.1, wireframe SCR-022 Month view).
 *
 * A calendar table (weekday column headers, one row per week) of day tiles:
 * shift count and either the open-shift count (⚠ + text, danger) or "filled"
 * (✓ + text). Each tile is a button that opens that day's timeline.
 */
export function MonthCoverage({
  month,
  days,
  onOpenDay,
}: {
  /** Any date inside the month to show. */
  month: IsoDate
  days: readonly MonthDayCoverage[]
  onOpenDay?: (date: IsoDate) => void
}) {
  const f = useRosterFormat()
  const byDate = new Map(days.map((d) => [d.date, d]))
  const weeks = monthWeeks(month)
  const monday = startOfWeek(month)
  const weekdays = Array.from({ length: 7 }, (_, i) => addDays(monday, i))

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-separate border-spacing-1 text-caption">
        <caption className="sr-only">
          {f.t('roster.month.caption', { month: f.monthYear(month) })}
        </caption>
        <thead>
          <tr>
            {weekdays.map((d) => (
              <th key={d} scope="col" className="text-left text-label uppercase text-text-muted">
                <span aria-hidden="true">{f.weekday(d, 'short')}</span>
                <span className="sr-only">{f.weekday(d, 'long')}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((date, di) => {
                if (!date) return <td key={di} />
                const cov = byDate.get(date)
                const open = cov?.openShifts ?? 0
                const status = !cov
                  ? f.t('roster.month.noRoster')
                  : open > 0
                    ? f.t('roster.month.open', { count: f.num(open) })
                    : f.t('roster.month.filled')
                const label = f.t('roster.month.dayLabel', {
                  date: f.day(date),
                  shifts: f.t('roster.month.shifts', { count: f.num(cov?.shifts ?? 0) }),
                  status,
                })
                const body = (
                  <>
                    <b className="lw-numeric text-body-sm font-weight-bold">
                      {f.num(parseIsoDate(date).getDate())}
                    </b>
                    {cov && (
                      <>
                        <span className="lw-numeric">
                          {f.t('roster.month.shifts', { count: f.num(cov.shifts) })}
                        </span>
                        <span
                          className={cn(
                            'flex items-center gap-1',
                            open > 0 ? 'font-weight-semibold text-on-danger-soft' : 'text-text-muted',
                          )}
                        >
                          {open > 0 ? (
                            <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
                          ) : (
                            <CheckCircle2 aria-hidden="true" className="size-3.5 shrink-0" />
                          )}
                          {status}
                        </span>
                      </>
                    )}
                  </>
                )
                const tile = cn(
                  'flex min-h-16 w-full flex-col items-start gap-0.5 border-2 bg-surface p-1.5 text-left text-text',
                  open > 0 ? 'border-danger' : 'border-outline-subtle',
                )
                return (
                  <td key={date} className="p-0 align-top">
                    {onOpenDay ? (
                      <button
                        type="button"
                        aria-label={label}
                        className={cn(tile, 'motion-interactive hover:border-primary focus-visible:outline-focus-ring')}
                        onClick={() => onOpenDay(date)}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className={tile}>{body}</div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
