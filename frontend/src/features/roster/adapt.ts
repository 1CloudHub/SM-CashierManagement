/**
 * Maps the roster API's DTOs (`RosterDetail`, task 13.4) onto the
 * presentational view-models the roster components render (task 13.1–13.3).
 *
 * Cashiers are keyed by their staff code (`employeeNo`, e.g. "FT-03"), which
 * is what the grid shows; `staffIdOf` maps a code back to the staff id the
 * API expects. Only scheduled shifts are drawn; open (unassigned) shifts go
 * to the "Open shifts" row.
 */
import type { IsoDate, LaborBreach, OverrideCheck, RosterContract, RosterDetail } from '@lanewise/shared'
import { paidMinutes } from './model'
import type {
  ContractType,
  DayTimelineRow,
  GridCell,
  GridRow,
  MonthDayCoverage,
  OpenShift,
  RosterCashier,
  RosterDepartment,
  RosterShift,
  RosterTotals,
  VizIndex,
} from './types'

const CONTRACT: Record<RosterContract, ContractType> = { FT: 'fullTime', PT: 'partTime', FLOAT: 'float' }

export interface RosterModel {
  readonly departments: readonly RosterDepartment[]
  readonly cashiers: readonly RosterCashier[]
  /** Scheduled, assigned shifts (cashierId = staff code). */
  readonly shifts: readonly RosterShift[]
  readonly openShifts: readonly OpenShift[]
  /** Staff id for a staff code, and back. */
  readonly staffIdOf: (code: string) => string | undefined
  readonly codeOf: (staffId: string) => string | undefined
}

export function toRosterModel(detail: RosterDetail): RosterModel {
  const departments: RosterDepartment[] = detail.departments.map((d, i) => ({
    id: d.id,
    name: d.name,
    shortName: d.name,
    letter: (d.name.trim()[0] ?? '?').toUpperCase(),
    viz: ((i % 6) + 1) as VizIndex,
  }))
  const codeById = new Map(detail.staff.map((s) => [s.id, s.employeeNo]))
  const idByCode = new Map(detail.staff.map((s) => [s.employeeNo, s.id]))
  const cashiers: RosterCashier[] = detail.staff.map((s) => ({
    id: s.employeeNo,
    name: s.name,
    contract: s.borrowedFrom ? 'borrowed' : CONTRACT[s.contract],
    skills: [...new Set([s.departmentId, ...s.trainedDepartmentIds])],
    ...(s.borrowedFrom ? { homeStore: { name: s.borrowedFrom, travelMin: s.borrowedTravelMin ?? 0 } } : {}),
  }))
  const scheduled = detail.shifts.filter((s) => s.status === 'scheduled')
  const shifts: RosterShift[] = scheduled.flatMap((s) => {
    const code = s.staffId ? codeById.get(s.staffId) : undefined
    if (!code) return []
    return [
      {
        id: s.id,
        cashierId: code,
        date: s.date,
        departmentId: s.departmentId,
        startMin: s.startMin,
        endMin: s.endMin,
        activities: s.activities,
        ...(s.edited ? { edited: { by: s.edited.by, at: s.edited.at } } : {}),
      },
    ]
  })
  const openShifts: OpenShift[] = scheduled
    .filter((s) => s.staffId === null)
    .map((s) => ({ id: s.id, date: s.date, departmentId: s.departmentId, startMin: s.startMin, endMin: s.endMin, count: 1 }))
  return {
    departments,
    cashiers,
    shifts,
    openShifts,
    staffIdOf: (code) => idByCode.get(code),
    codeOf: (staffId) => codeById.get(staffId),
  }
}

/** Day timeline rows: one per cashier, their shift that day, else a day off. */
export function dayRows(model: RosterModel, date: IsoDate): DayTimelineRow[] {
  return model.cashiers.map((cashier) => {
    const shift = model.shifts.find((s) => s.cashierId === cashier.id && s.date === date)
    return shift ? { cashier, shift } : { cashier, absence: 'dayOff' }
  })
}

/** Grid rows for a run of days; days outside the roster period render empty. */
export function gridRows(model: RosterModel, days: readonly IsoDate[], period: { from: IsoDate; to: IsoDate }): GridRow[] {
  return model.cashiers.map((cashier) => {
    const cells: Record<IsoDate, GridCell> = {}
    for (const date of days) {
      const shift = model.shifts.find((s) => s.cashierId === cashier.id && s.date === date)
      if (shift) cells[date] = { kind: 'shift', shift }
      else if (date >= period.from && date <= period.to) cells[date] = { kind: 'absence', absence: 'dayOff' }
    }
    return { cashier, cells }
  })
}

/** Totals for the days shown. Cost is left out: the roster API returns no ₱ figures. */
export function rosterTotals(model: RosterModel, days: readonly IsoDate[]): RosterTotals {
  const inView = new Set(days)
  const shifts = model.shifts.filter((s) => inView.has(s.date))
  const borrowed = new Set(
    shifts.filter((s) => model.cashiers.find((c) => c.id === s.cashierId)?.contract === 'borrowed').map((s) => s.cashierId),
  )
  return {
    shifts: shifts.length,
    paidHours: Math.round((shifts.reduce((m, s) => m + paidMinutes(s), 0) / 60) * 10) / 10,
    openShifts: model.openShifts.filter((o) => inView.has(o.date)).length,
    borrowed: borrowed.size,
  }
}

export function monthCoverage(model: RosterModel, dates: readonly IsoDate[]): MonthDayCoverage[] {
  return dates.map((date) => ({
    date,
    shifts: model.shifts.filter((s) => s.date === date).length,
    openShifts: model.openShifts.filter((o) => o.date === date).length,
  }))
}

/** The breaches to show for a check: new warnings and every block left on the affected cashiers. */
export function checkBreaches(check: OverrideCheck): LaborBreach[] {
  const seen = new Set<string>()
  return [...check.blocking, ...check.breaches].filter((b) => {
    const key = `${b.rule}|${b.staffId}|${b.date}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
