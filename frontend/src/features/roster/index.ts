/**
 * Roster visual planning (task 13.1–13.3 — requirement 6, SCR-021/022/025).
 *
 * Presentational components only: typed props in, callbacks out. No data
 * fetching, routing or global state — the SCR-022 / SCR-025 screens (and the
 * task 13.4 override flow) wire these to the API client.
 *
 *   - DayTimeline      13.1 cashier × hour timeline, delta strip, coverage,
 *                      drag + keyboard move/resize, bulk bar, table view
 *   - ShiftEditor      13.1 keyboard-accessible shift editor dialog
 *   - RosterGrid       13.2 Week / Fortnight / Four weeks chips + totals + filters
 *   - MonthCoverage    13.2 month calendar of coverage tiles
 *   - RosterZoom       13.2 Day · Week · Fortnight · Four weeks · Month + date nav
 *   - MobileDayList / MobileWeekList / MyRoster   13.3 phone views
 *   - RosterLegend     category + activity + marker legend
 */
export { DayTimeline, type DayTimelineProps } from './day-timeline'
export { DayTimelineTable } from './day-timeline-table'
export { BulkBar } from './bulk-bar'
export {
  ShiftEditor,
  type Replacement,
  type RuleCheck,
  type ShiftDraft,
  type ShiftEditorProps,
} from './shift-editor'
export { RosterGrid, type RosterGridProps } from './roster-grid'
export { MonthCoverage } from './month-coverage'
export { RosterZoom, type RosterZoomProps } from './roster-zoom'
export { MobileDayList, MobileWeekList } from './mobile-roster'
export { MyRoster, type MyRosterProps } from './my-roster'
export { RosterLegend } from './roster-legend'
export { useRosterFormat, type RosterFormat } from './use-roster-format'
export * from './model'
export * from './types'
