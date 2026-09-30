/**
 * Roster view-models (task 13 — requirement 6, design.md "Visual planning
 * components").
 *
 * These are the presentational shapes the Day timeline, Week grid, Month
 * coverage and mobile roster views render. They are deliberately flat and
 * serialisable so the API client (built separately) can map its DTOs onto
 * them without the components knowing about fetching. Where a matching
 * @lanewise/shared entity exists (Department, IsoDate, IsoDateTime) the
 * view-models reuse its fields so the mapping is a pick, not a translation.
 *
 * Time of day is expressed in minutes since local midnight (0–1440) in the
 * store's time zone, so arithmetic (snap, move, resize, coverage) stays exact
 * and independent of Date/time-zone handling. Calendar days are IsoDate
 * strings (`2026-12-19`).
 */
import type { Department, IsoDate, IsoDateTime } from '@lanewise/shared'

/** Index into the data-viz palette (--lw-viz-1…6). Never a status colour. */
export type VizIndex = 1 | 2 | 3 | 4 | 5 | 6

/**
 * A department as the roster draws it: the shared Department's id + name, plus
 * the single letter and palette slot that pair with its colour (never colour
 * alone — requirement 6.4).
 */
export interface RosterDepartment extends Pick<Department, 'id' | 'name'> {
  /** Short label shown in chips and the legend, e.g. "Main lanes". */
  readonly shortName: string
  /** One-letter code painted in the chip band, e.g. "M". */
  readonly letter: string
  readonly viz: VizIndex
}

/** Contract types a cashier can hold on a roster. */
export type ContractType = 'fullTime' | 'partTime' | 'float' | 'borrowed'

export const CONTRACT_TYPES: readonly ContractType[] = [
  'fullTime',
  'partTime',
  'float',
  'borrowed',
] as const

/** A cashier row on the roster. */
export interface RosterCashier {
  /** Staff code shown in the grid, e.g. "PT-02". */
  readonly id: string
  readonly name: string
  readonly contract: ContractType
  /** Free-text detail after the contract, e.g. "rest Mon", "students". */
  readonly note?: string
  /** Department ids this cashier is trained for (rendered as skill tags). */
  readonly skills: readonly string[]
  /** Set for borrowed cashiers: their home store and travel time. */
  readonly homeStore?: { readonly name: string; readonly travelMin: number }
}

/** Activity segments inside a shift (requirement 6.2). */
export type ActivityKind = 'meal' | 'training' | 'huddle'

export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'meal',
  'training',
  'huddle',
] as const

export interface ShiftActivity {
  readonly kind: ActivityKind
  /** Minutes since midnight. */
  readonly startMin: number
  readonly endMin: number
}

/** A manager override marker (✎, requirement 7.2). */
export interface ShiftEdit {
  /** Who made the change, already formatted, e.g. "R. Lim". */
  readonly by: string
  readonly at: IsoDateTime
}

export interface RosterShift {
  readonly id: string
  readonly cashierId: string
  readonly date: IsoDate
  readonly departmentId: string
  /** Minutes since midnight; `endMin` > `startMin`. */
  readonly startMin: number
  readonly endMin: number
  readonly activities: readonly ShiftActivity[]
  /** Present when a store manager changed this shift on a published roster. */
  readonly edited?: ShiftEdit
}

/** Why a cashier has no shift on a given day. */
export type Absence = 'dayOff' | 'unavailable'

/** One row of the Day timeline. */
export interface DayTimelineRow {
  readonly cashier: RosterCashier
  readonly shift?: RosterShift
  readonly absence?: Absence
}

/** Required cashiers on lanes for one hour (Erlang C output). */
export interface HourRequirement {
  /** Hour of day, 0–23 (the column starting at hour:00). */
  readonly hour: number
  readonly required: number
}

/** Visible hours on the timeline: [startHour, endHour). */
export interface DayWindow {
  readonly startHour: number
  readonly endHour: number
}

/** A change proposed by dragging or keyboard on the timeline. */
export interface ShiftTimeChange {
  readonly shiftId: string
  readonly startMin: number
  readonly endMin: number
}

export type BulkAction = 'edit' | 'reassign' | 'timeOff' | 'copyTo'

export const BULK_ACTIONS: readonly BulkAction[] = [
  'edit',
  'reassign',
  'timeOff',
  'copyTo',
] as const

// ── Week / Fortnight / Four weeks grid ────────────────────────────────────

/** What a grid cell shows for one cashier on one day. */
export type GridCell =
  | { readonly kind: 'shift'; readonly shift: RosterShift }
  | { readonly kind: 'absence'; readonly absence: Absence }
  | { readonly kind: 'empty' }

export interface GridRow {
  readonly cashier: RosterCashier
  /** Keyed by IsoDate; missing days render as empty. */
  readonly cells: Readonly<Record<IsoDate, GridCell>>
}

/** Unfilled demand on a day, shown in the "Open shifts" row. */
export interface OpenShift {
  readonly id: string
  readonly date: IsoDate
  readonly departmentId: string
  readonly startMin: number
  readonly endMin: number
  readonly count: number
}

export interface RosterTotals {
  readonly shifts: number
  /** Total labour cost in pesos. */
  readonly cost: number
  readonly paidHours: number
  readonly openShifts: number
  readonly borrowed: number
}

/** What the chip colour band encodes (requirement 6.3 colour filter). */
export type ColourBy = 'department' | 'contract' | 'homeStore'

// ── Month coverage ────────────────────────────────────────────────────────

export interface MonthDayCoverage {
  readonly date: IsoDate
  readonly shifts: number
  readonly openShifts: number
}

// ── Zoom ──────────────────────────────────────────────────────────────────

export type RosterView = 'day' | 'week' | 'fortnight' | 'fourWeeks' | 'month'

export const ROSTER_VIEWS: readonly RosterView[] = [
  'day',
  'week',
  'fortnight',
  'fourWeeks',
  'month',
] as const

// ── Staff "My roster" (SCR-025) ───────────────────────────────────────────

export interface MyRosterDay {
  readonly date: IsoDate
  /** A shift, an absence, or nothing (the day is simply not listed). */
  readonly shift?: RosterShift
  readonly absence?: Absence
  /** Payday marker (pill). */
  readonly payday?: boolean
  /** Previous times when a manager changed this shift. */
  readonly previous?: { readonly startMin: number; readonly endMin: number }
}

export interface MyRosterWeek {
  readonly id: string
  /** First day (Monday) of the week. */
  readonly start: IsoDate
  readonly days: readonly MyRosterDay[]
}

// ── Shift editor ──────────────────────────────────────────────────────────

/** Reasons offered for an emergency off (requirement 7.3). */
export const EMERGENCY_REASONS = ['sickCall', 'family', 'other'] as const
export type EmergencyReason = (typeof EMERGENCY_REASONS)[number]
