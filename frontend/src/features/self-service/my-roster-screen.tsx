import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildShiftCalendar, type IsoDate, type MyRosterResponse } from '@lanewise/shared'
import { useAnnouncer } from '@/components/a11y'
import { Section, Stack } from '@/components/layout'
import { Alert, Skeleton, StateBlock } from '@/components/ui'
import { MyOffers, type OffersClient } from '@/features/offers'
import { MyRoster } from '@/features/roster/my-roster'
import { useRosterFormat } from '@/features/roster/use-roster-format'
import { toMyRosterModel } from './adapt'
import type { SelfServiceClient } from './api'
import { MyRequests } from './my-requests'
import { downloadText } from './text'

export interface MyRosterScreenProps {
  client: SelfServiceClient
  offers: OffersClient
  /** The cashier's local date (Asia/Manila); time off can't start before it. */
  today: IsoDate
  /** Clock for the calendar's DTSTAMP (tests pass a fixed one). */
  now?: () => Date
}

/**
 * SCR-025 `/my-roster` for Staff (task 18 — requirement 15; wireframe
 * scr-025-my-roster.html; phone-first). Only the cashier's own shifts,
 * changes (with the previous times) and rest days — no other names or costs
 * (P11); open-shift offers within their travel limit (task 17); time-off and
 * swap requests (P19); and "Add to calendar", an .ics file built in the
 * browser from the shifts on screen.
 */
export function MyRosterScreen({ client, offers, today, now = () => new Date() }: MyRosterScreenProps) {
  const f = useRosterFormat()
  const { t } = f
  const { announce } = useAnnouncer()
  const [data, setData] = useState<MyRosterResponse | null>(null)
  const [error, setError] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(() => {
    client.roster().then(
      (r) => {
        setData(r)
        setError(false)
      },
      () => setError(true),
    )
  }, [client])
  useEffect(reload, [reload])

  const model = useMemo(() => (data ? toMyRosterModel(data) : null), [data])

  const addToCalendar = () => {
    if (!data || !model) return
    const ics = buildShiftCalendar(model.calendar, { name: t('selfService.calendarName'), now: now() })
    const saved = downloadText(`lanewise-shifts-${data.from}.ics`, ics, 'text/calendar;charset=utf-8')
    const text = saved ? t('selfService.calendarSaved', { count: model.calendar.length }) : t('selfService.calendarFailed')
    setNotice(text)
    announce(text)
  }

  return (
    <Stack gap={4}>
      {error ? (
        <StateBlock variant="error" title={t('selfService.rosterFailed')} />
      ) : !data || !model ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <Section title={t('selfService.shifts.title')} titleAs="h2" bare>
          <MyRoster
            heading={t('selfService.heading', {
              name: data.staff.name,
              id: data.staff.employeeNo,
              store: data.staff.storeName,
              department: data.staff.departmentName,
            })}
            weeks={model.weeks}
            departments={model.departments}
            latestChange={model.latestChange}
            {...(model.calendar.length > 0 ? { onAddToCalendar: addToCalendar } : {})}
          />
          </Section>
          {notice && <Alert tone="success" title={notice} live={false} />}
          {model.removed.length > 0 && (
            <Section title={t('selfService.removed.title')} titleAs="h2">
              <ul className="m-0 list-none p-0 text-body-sm">
                {model.removed.map((r) => (
                  <li key={r.shiftId} className="border-b border-outline-subtle py-1 text-text">
                    <span aria-hidden="true">✎ </span>
                    {t('selfService.removed.item', {
                      day: f.day(r.date),
                      time: f.range(r.startMin, r.endMin),
                      change: t(`roster.override.${r.type}`),
                      by: r.by,
                    })}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
      <MyOffers client={offers} />
      <MyRequests client={client} today={today} onChanged={reload} />
      <p className="text-caption text-text-muted">{t('selfService.privacy')}</p>
    </Stack>
  )
}
