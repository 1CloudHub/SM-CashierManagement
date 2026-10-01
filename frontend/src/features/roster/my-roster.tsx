import { CalendarPlus } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Stack } from '@/components/layout/stack'
import { cn } from '@/lib/utils'
import { addDays, paidMinutes } from './model'
import type { MyRosterDay, MyRosterWeek, RosterDepartment } from './types'
import { useRosterFormat } from './use-roster-format'
import './roster.css'

export interface MyRosterProps {
  /** e.g. "Maria Santos (PT-02) · SM Supermarket – Quezon City · Main checkout lanes". */
  heading: string
  weeks: readonly MyRosterWeek[]
  departments: readonly RosterDepartment[]
  /** The latest manager change to call out at the top (✎); needs `previous` + `shift.edited`. */
  latestChange?: MyRosterDay
  onAddToCalendar?: () => void
  onOpenShift?: (shiftId: string) => void
}

/**
 * Staff "My roster" (task 13.3 — SCR-025, requirement 15.1, phone-first).
 *
 * A cashier's own shifts as a card list per week — no other names or costs.
 * Each day card shows the shift (or rest day / unavailable), meal time, paid
 * hours, a payday marker and "Changed" with the previous times when a
 * manager moved it. Weeks switch with tabs; "Add to calendar" is the one
 * action (offers and requests are separate components).
 */
export function MyRoster({
  heading,
  weeks,
  departments,
  latestChange,
  onAddToCalendar,
  onOpenShift,
}: MyRosterProps) {
  const f = useRosterFormat()
  const dept = new Map(departments.map((d) => [d.id, d]))

  const weekLabel = (w: MyRosterWeek, i: number) =>
    i === 0
      ? f.t('roster.my.thisWeek')
      : i === 1
        ? f.t('roster.my.nextWeek')
        : f.t('roster.timeRange', { start: f.day(w.start), end: f.day(addDays(w.start, 6)) })

  return (
    <Stack gap={4}>
      <p className="text-body-sm text-text-muted">{heading}</p>

      {latestChange?.shift?.edited && latestChange.previous && (
        <Alert tone="info" live={false} title={<span><span aria-hidden="true">✎ </span>{f.t('roster.my.changedTitle')}</span>}>
          {f.t('roster.my.changeNotice', {
            date: f.day(latestChange.date),
            from: f.range(latestChange.previous.startMin, latestChange.previous.endMin),
            to: f.range(latestChange.shift.startMin, latestChange.shift.endMin),
            by: latestChange.shift.edited.by,
            at: f.dateTime(latestChange.shift.edited.at),
          })}
        </Alert>
      )}

      <Tabs defaultValue={weeks[0]?.id}>
        <TabsList aria-label={f.t('roster.my.weeks')}>
          {weeks.map((w, i) => (
            <TabsTrigger key={w.id} value={w.id}>
              {weekLabel(w, i)}
            </TabsTrigger>
          ))}
        </TabsList>
        {weeks.map((w) => (
          <TabsContent key={w.id} value={w.id}>
            {w.days.length === 0 ? (
              <p className="text-body-sm text-text-muted">{f.t('roster.my.empty')}</p>
            ) : (
              <ul
                aria-label={f.t('roster.timeRange', { start: f.day(w.start), end: f.day(addDays(w.start, 6)) })}
                className="m-0 flex list-none flex-col gap-2 p-0"
              >
                {w.days.map((day) => {
                  const s = day.shift
                  const d = s ? dept.get(s.departmentId) : undefined
                  const meal = s?.activities.find((a) => a.kind === 'meal')
                  return (
                    <li
                      key={day.date}
                      className={cn(
                        'border border-outline bg-surface p-3',
                        s?.edited && 'lw-edited',
                        day.absence === 'unavailable' && 'lw-hatch-unavailable',
                      )}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="text-body font-weight-semibold text-text">
                          {f.day(day.date)}
                        </h3>
                        <span className="flex flex-wrap gap-1">
                          {day.payday && <Pill>{f.t('roster.my.payday')}</Pill>}
                          {s?.edited && (
                            <Pill tone="warning" fill="soft">
                              <span aria-hidden="true">✎</span> {f.t('roster.my.changed')}
                            </Pill>
                          )}
                        </span>
                      </div>
                      {s ? (
                        <Stack gap={1} className="mt-1 text-body-sm">
                          {onOpenShift ? (
                            <button
                              type="button"
                              className="lw-numeric min-h-tap self-start text-left text-body font-weight-semibold text-primary underline focus-visible:outline-focus-ring"
                              onClick={() => onOpenShift(s.id)}
                            >
                              {f.range(s.startMin, s.endMin)}
                            </button>
                          ) : (
                            <p className="lw-numeric text-body font-weight-semibold text-text">
                              {f.range(s.startMin, s.endMin)}
                            </p>
                          )}
                          <p className="text-text-muted">
                            {[
                              d?.name,
                              meal ? f.t('roster.my.meal', { time: f.time(meal.startMin) }) : undefined,
                              f.t('roster.my.hours', { hours: f.hours(paidMinutes(s)) }),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                          {day.previous && (
                            <p className="text-text">
                              {f.t('roster.my.changedFrom', {
                                from: f.range(day.previous.startMin, day.previous.endMin),
                              })}
                              {s.edited && ` — ${f.t('roster.shift.edited', { by: s.edited.by })}`}
                            </p>
                          )}
                        </Stack>
                      ) : (
                        <p className="mt-1 text-body-sm text-text-muted">
                          {day.absence === 'dayOff'
                            ? f.t('roster.my.restDay')
                            : day.absence
                              ? f.absence(day.absence)
                              : f.t('roster.grid.noShift')}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {onAddToCalendar && (
        <Button className="self-start" onClick={onAddToCalendar}>
          <CalendarPlus aria-hidden="true" className="size-4" />
          {f.t('roster.my.addToCalendar')}
        </Button>
      )}
    </Stack>
  )
}
