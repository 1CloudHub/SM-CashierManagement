import type { MyStaffRequestDto, RequestShiftDto, StaffRequestStatus } from '@lanewise/shared'
import type { StatusTone } from '@/components/ui'
import type { RosterFormat } from '@/features/roster/use-roster-format'

/**
 * Shared wording for staff requests (task 18): the status tone and one-line
 * descriptions used on SCR-025 and the SCR-022 Staff requests panel.
 */

export const REQUEST_TONE: Readonly<Record<StaffRequestStatus, StatusTone>> = {
  pending: 'warning',
  approved: 'success',
  declined: 'neutral',
  cancelled: 'neutral',
}

/** "Sat Dec 19 · 12:00 PM – 9:00 PM" for a request's shift. */
export function shiftLabel(f: RosterFormat, s: RequestShiftDto): string {
  return f.t('selfService.shift', { day: f.day(s.date), time: f.range(s.startMin, s.endMin) })
}

/** One line describing a request, without any colleague's name (P11). */
export function requestDetail(f: RosterFormat, r: Pick<MyStaffRequestDto, 'type' | 'dateFrom' | 'dateTo' | 'reason' | 'offered' | 'target'>): string {
  if (r.type === 'time_off') {
    const days =
      r.dateFrom && r.dateTo && r.dateFrom !== r.dateTo
        ? f.t('roster.timeRange', { start: f.day(r.dateFrom), end: f.day(r.dateTo) })
        : r.dateFrom
          ? f.day(r.dateFrom)
          : ''
    return r.reason ? f.t('selfService.timeOffDetail', { days, reason: f.t(`selfService.reason.${r.reason}`) }) : days
  }
  const give = r.offered ? shiftLabel(f, r.offered) : '—'
  const take = r.target
    ? f.t(r.target.kind === 'open' ? 'selfService.takeOpen' : 'selfService.takeColleague', { shift: shiftLabel(f, r.target) })
    : '—'
  return f.t('selfService.swapDetail', { give, take })
}

/** Saves `text` as a file through a temporary object URL (no server round trip). */
export function downloadText(filename: string, text: string, type: string): boolean {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return true
}
