import { useMemo } from 'react'
import type { IsoDate } from '@lanewise/shared'
import { useI18n } from '@/i18n'
import { minutesToDate, parseIsoDate } from './model'
import type {
  Absence,
  ActivityKind,
  ContractType,
  RosterCashier,
  RosterDepartment,
  RosterShift,
  ShiftActivity,
} from './types'

/**
 * Locale-aware formatting shared by every roster view (req. 23): times, date
 * labels, cashier/contract lines and the full accessible name of a shift. All
 * copy comes from the roster bundle (i18n/roster-messages.ts).
 */
export function useRosterFormat() {
  const { t, formatTime, formatDate, formatDateTime, formatNumber } = useI18n()

  return useMemo(() => {
    const time = (min: number) => formatTime(minutesToDate(min))
    const range = (startMin: number, endMin: number) =>
      t('roster.timeRange', { start: time(startMin), end: time(endMin) })
    const hour = (h: number) => formatTime(minutesToDate(h * 60), { hour: 'numeric' })
    const day = (date: IsoDate) =>
      formatDate(parseIsoDate(date), { weekday: 'short', month: 'short', day: 'numeric' })
    const dayShort = (date: IsoDate) =>
      formatDate(parseIsoDate(date), { weekday: 'short', day: 'numeric' })
    const dayLong = (date: IsoDate) =>
      formatDate(parseIsoDate(date), {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    const weekday = (date: IsoDate, style: 'short' | 'long') =>
      formatDate(parseIsoDate(date), { weekday: style })
    const monthYear = (date: IsoDate) =>
      formatDate(parseIsoDate(date), { month: 'long', year: 'numeric' })
    const hours = (minutes: number) =>
      formatNumber(minutes / 60, { maximumFractionDigits: 2 })
    const signed = (n: number) => formatNumber(n, { signDisplay: 'exceptZero' })

    /** "short" / "surplus" / "meets need" — the word paired with a delta's sign. */
    const deltaWord = (delta: number) =>
      t(delta < 0 ? 'roster.delta.shortWord' : delta > 0 ? 'roster.delta.surplusWord' : 'roster.delta.metWord')

    const contract = (c: ContractType) => t(`roster.contract.${c}`)
    const absence = (a: Absence) => t(`roster.absence.${a}`)
    const activity = (k: ActivityKind) => t(`roster.activity.${k}`)
    const activityLetter = (k: ActivityKind) => t(`roster.activity.letter.${k}`)

    /** "Part-time · students" / "Borrowed · SM Megamall (22 min)". */
    const cashierDetail = (c: RosterCashier) => {
      if (c.homeStore) {
        return t('roster.borrowedFrom', {
          store: c.homeStore.name,
          minutes: formatNumber(c.homeStore.travelMin),
        })
      }
      return c.note
        ? t('roster.contract.withNote', { contract: contract(c.contract), note: c.note })
        : contract(c.contract)
    }

    const activityText = (a: ShiftActivity) =>
      t('roster.shift.activityItem', { activity: activity(a.kind), time: range(a.startMin, a.endMin) })

    /**
     * The accessible name of a shift bar/chip: who, when, where, what's inside
     * and whether a manager changed it (design.md ARIA standard).
     */
    const shiftLabel = (
      cashier: RosterCashier,
      shift: RosterShift,
      department: RosterDepartment | undefined,
      opts: { date?: boolean; selected?: boolean } = {},
    ) => {
      const parts = [
        `${cashier.id} ${cashier.name}`,
        opts.date ? day(shift.date) : undefined,
        range(shift.startMin, shift.endMin),
        department?.name,
        cashier.contract === 'float' ? contract('float') : undefined,
        ...shift.activities.map(activityText),
        shift.edited ? t('roster.shift.edited', { by: shift.edited.by }) : undefined,
        opts.selected ? t('roster.shift.selected') : undefined,
      ]
      return parts.filter(Boolean).join(', ')
    }

    return {
      t,
      time,
      range,
      hour,
      day,
      dayShort,
      dayLong,
      monthYear,
      weekday,
      hours,
      signed,
      deltaWord,
      contract,
      absence,
      activity,
      activityLetter,
      cashierDetail,
      activityText,
      shiftLabel,
      num: (n: number) => formatNumber(n),
      dateTime: (iso: string) =>
        formatDateTime(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    }
  }, [t, formatTime, formatDate, formatDateTime, formatNumber])
}

export type RosterFormat = ReturnType<typeof useRosterFormat>
