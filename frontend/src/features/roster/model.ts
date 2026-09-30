/**
 * Pure roster arithmetic (task 13): snapping, move/resize, on-lane coverage,
 * staffing-versus-need deltas and the calendar ranges each zoom level shows.
 *
 * Kept free of React and i18n so it is unit/property tested directly and the
 * components stay thin. Times are minutes since local midnight; dates are
 * IsoDate strings handled as local calendar dates (never via UTC parsing, which
 * would shift the day in the Philippines' +08:00 offset).
 */
import type { IsoDate } from '@lanewise/shared'
import type {
  DayWindow,
  HourRequirement,
  RosterShift,
  RosterView,
} from './types'

export const MINUTES_PER_HOUR = 60
/** Default snap for drag and keyboard edits (design.md: 15-min snap). */
export const DEFAULT_SNAP_MIN = 15

/** Default visible hours on the Day timeline: 7 AM – 11 PM. */
export const DEFAULT_DAY_WINDOW: DayWindow = { startHour: 7, endHour: 23 }

/** Round `minutes` to the nearest multiple of `step`. */
export function snapMinutes(minutes: number, step: number = DEFAULT_SNAP_MIN): number {
  return Math.round(minutes / step) * step
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Hours shown on the timeline, e.g. [7, 8, …, 22] for 7a–11p. */
export function windowHours(window: DayWindow): number[] {
  const out: number[] = []
  for (let h = window.startHour; h < window.endHour; h++) out.push(h)
  return out
}

/**
 * Move a shift by `deltaMin`, snapped, keeping its length and keeping it inside
 * the visible window. Returns the new start/end.
 */
export function moveShift(
  shift: Pick<RosterShift, 'startMin' | 'endMin'>,
  deltaMin: number,
  window: DayWindow,
  step: number = DEFAULT_SNAP_MIN,
): { startMin: number; endMin: number } {
  const length = shift.endMin - shift.startMin
  const lo = window.startHour * MINUTES_PER_HOUR
  const hi = window.endHour * MINUTES_PER_HOUR - length
  const startMin = clamp(snapMinutes(shift.startMin + deltaMin, step), lo, hi)
  return { startMin, endMin: startMin + length }
}

/**
 * Resize one edge of a shift by `deltaMin`, snapped, never shorter than one
 * snap step and never outside the window.
 */
export function resizeShift(
  shift: Pick<RosterShift, 'startMin' | 'endMin'>,
  edge: 'start' | 'end',
  deltaMin: number,
  window: DayWindow,
  step: number = DEFAULT_SNAP_MIN,
): { startMin: number; endMin: number } {
  const lo = window.startHour * MINUTES_PER_HOUR
  const hi = window.endHour * MINUTES_PER_HOUR
  if (edge === 'end') {
    const endMin = clamp(
      snapMinutes(shift.endMin + deltaMin, step),
      shift.startMin + step,
      hi,
    )
    return { startMin: shift.startMin, endMin }
  }
  const startMin = clamp(
    snapMinutes(shift.startMin + deltaMin, step),
    lo,
    shift.endMin - step,
  )
  return { startMin, endMin: shift.endMin }
}

/**
 * Is the cashier on a lane at `minute`? True inside the shift and outside every
 * activity (a meal, training or huddle takes them off the lane).
 */
export function isOnLaneAt(
  shift: Pick<RosterShift, 'startMin' | 'endMin' | 'activities'>,
  minute: number,
): boolean {
  if (minute < shift.startMin || minute >= shift.endMin) return false
  return !shift.activities.some((a) => minute >= a.startMin && minute < a.endMin)
}

/**
 * Cashiers rostered on lanes for the hour starting at `hour`. A cashier counts
 * when they are on a lane at the middle of the hour (hh:30) — the same sample
 * point the Erlang C requirement is quoted for, so a 30-min huddle at hh:00 or
 * a shift ending at hh:30 does not count as a full cashier for that hour.
 */
export function rosteredAtHour(
  shifts: readonly Pick<RosterShift, 'startMin' | 'endMin' | 'activities'>[],
  hour: number,
): number {
  const mid = hour * MINUTES_PER_HOUR + MINUTES_PER_HOUR / 2
  return shifts.filter((s) => isOnLaneAt(s, mid)).length
}

export interface HourDelta {
  readonly hour: number
  readonly rostered: number
  readonly required: number
  /** rostered − required: negative = short, positive = surplus. */
  readonly delta: number
}

/**
 * Staffing versus need for every hour in the window (requirement 6.2). Hours
 * without a requirement count as needing 0.
 */
export function hourlyDeltas(
  shifts: readonly Pick<RosterShift, 'startMin' | 'endMin' | 'activities'>[],
  requirements: readonly HourRequirement[],
  window: DayWindow,
): HourDelta[] {
  const need = new Map(requirements.map((r) => [r.hour, r.required]))
  return windowHours(window).map((hour) => {
    const rostered = rosteredAtHour(shifts, hour)
    const required = need.get(hour) ?? 0
    return { hour, rostered, required, delta: rostered - required }
  })
}

/** Paid minutes: shift length minus meal breaks (training/huddle are paid). */
export function paidMinutes(
  shift: Pick<RosterShift, 'startMin' | 'endMin' | 'activities'>,
): number {
  const meals = shift.activities
    .filter((a) => a.kind === 'meal')
    .reduce((sum, a) => sum + (a.endMin - a.startMin), 0)
  return shift.endMin - shift.startMin - meals
}

// ── Calendar helpers ──────────────────────────────────────────────────────

/** Parse an IsoDate as a local calendar date (no UTC shift). */
export function parseIsoDate(date: IsoDate): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toIsoDate(date: Date): IsoDate {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(date)
  d.setDate(d.getDate() + days)
  return toIsoDate(d)
}

/** The Monday on or before `date` (rosters run Monday–Sunday). */
export function startOfWeek(date: IsoDate): IsoDate {
  const d = parseIsoDate(date)
  const offset = (d.getDay() + 6) % 7 // Mon=0 … Sun=6
  return addDays(date, -offset)
}

/** A Date at `minutes` past midnight, for locale time formatting. */
export function minutesToDate(minutes: number): Date {
  return new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)
}

/** Number of days a grid zoom shows. */
export const GRID_VIEW_DAYS: Record<'week' | 'fortnight' | 'fourWeeks', number> = {
  week: 7,
  fortnight: 14,
  fourWeeks: 28,
}

/** The consecutive days a grid zoom shows, starting on the anchor's Monday. */
export function gridDays(
  anchor: IsoDate,
  view: 'week' | 'fortnight' | 'fourWeeks',
): IsoDate[] {
  const first = startOfWeek(anchor)
  return Array.from({ length: GRID_VIEW_DAYS[view] }, (_, i) => addDays(first, i))
}

/**
 * The month calendar as weeks of seven cells (Mon–Sun); cells outside the
 * month are `null`.
 */
export function monthWeeks(anchor: IsoDate): (IsoDate | null)[][] {
  const a = parseIsoDate(anchor)
  const first = new Date(a.getFullYear(), a.getMonth(), 1)
  const daysInMonth = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7
  const cells: (IsoDate | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(toIsoDate(new Date(a.getFullYear(), a.getMonth(), d)))
  }
  while (cells.length % 7) cells.push(null)
  const weeks: (IsoDate | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** Step the date navigator one unit of the current zoom. */
export function stepAnchor(anchor: IsoDate, view: RosterView, direction: -1 | 1): IsoDate {
  switch (view) {
    case 'day':
      return addDays(anchor, direction)
    case 'week':
    case 'fortnight':
    case 'fourWeeks':
      return addDays(anchor, direction * GRID_VIEW_DAYS[view])
    case 'month': {
      const d = parseIsoDate(anchor)
      const target = new Date(d.getFullYear(), d.getMonth() + direction, 1)
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
      target.setDate(Math.min(d.getDate(), last))
      return toIsoDate(target)
    }
  }
}
