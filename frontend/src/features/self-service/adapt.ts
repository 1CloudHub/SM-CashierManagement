/**
 * `GET /me/roster` → the task 13.3 `MyRoster` card list (SCR-025): weeks of
 * day cards with the shift, ✎ change and previous times, rest and
 * unavailable days, plus the calendar events for "Add to calendar".
 */
import type { CalendarShift, IsoDate, MyRemovedShift, MyRosterResponse } from '@lanewise/shared'
import { addDays } from '@/features/roster/model'
import type { MyRosterDay, MyRosterWeek, RosterDepartment, VizIndex } from '@/features/roster/types'

export interface MyRosterModel {
  readonly weeks: readonly MyRosterWeek[]
  readonly departments: readonly RosterDepartment[]
  /** The most recent change that moved a shift's times (the ✎ notice at the top). */
  readonly latestChange: MyRosterDay | undefined
  /** Shifts taken off the cashier (removed, reassigned, emergency off, approved time off). */
  readonly removed: readonly (MyRemovedShift & { readonly date: IsoDate })[]
  readonly calendar: readonly CalendarShift[]
}

/** Monday of the week containing `date`. */
export function mondayOf(date: IsoDate): IsoDate {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  return addDays(date, -weekday)
}

export function toMyRosterModel(res: MyRosterResponse): MyRosterModel {
  const departments = new Map<string, RosterDepartment>()
  const weeks = new Map<IsoDate, MyRosterDay[]>()
  const calendar: CalendarShift[] = []
  let latestChange: MyRosterDay | undefined
  let latestAt = ''

  for (const d of res.days) {
    const week = mondayOf(d.date)
    if (!weeks.has(week)) weeks.set(week, [])
    const list = weeks.get(week)!
    if (d.shifts.length === 0) {
      if (d.absence) list.push({ date: d.date, absence: d.absence === 'rest' ? 'dayOff' : 'unavailable' })
      continue
    }
    for (const s of d.shifts) {
      if (!departments.has(s.departmentId)) {
        departments.set(s.departmentId, {
          id: s.departmentId,
          name: s.departmentName,
          shortName: s.departmentName,
          letter: s.departmentName.slice(0, 1).toUpperCase(),
          viz: ((departments.size % 6) + 1) as VizIndex,
        })
      }
      const day: MyRosterDay = {
        date: d.date,
        shift: {
          id: s.id,
          cashierId: res.staff.employeeNo,
          date: s.date,
          departmentId: s.departmentId,
          startMin: s.startMin,
          endMin: s.endMin,
          activities: s.activities,
          ...(s.changed ? { edited: { by: s.changed.by, at: s.changed.at } } : {}),
        },
        ...(s.changed?.previous ? { previous: { startMin: s.changed.previous.startMin, endMin: s.changed.previous.endMin } } : {}),
        ...(s.pendingRequestId ? { pending: true } : {}),
      }
      list.push(day)
      if (s.changed?.previous && s.changed.at > latestAt) {
        latestAt = s.changed.at
        latestChange = day
      }
      calendar.push({
        id: s.id,
        date: s.date,
        startMin: s.startMin,
        endMin: s.endMin,
        title: s.departmentName,
        location: s.storeName,
      })
    }
  }

  return {
    weeks: [...weeks.entries()].map(([start, days]) => ({ id: start, start, days })),
    departments: [...departments.values()],
    latestChange,
    removed: res.days.flatMap((d) => d.removed.map((r) => ({ ...r, date: r.date }))),
    calendar,
  }
}
