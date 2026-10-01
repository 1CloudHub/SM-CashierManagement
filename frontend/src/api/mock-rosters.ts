import {
  HTTP_STATUS_BY_ERROR_CODE,
  can,
  localToInstant,
  overrideCheckOf,
  overrideSaveDecision,
  rankReplacements,
  validateShiftOverrideRequest,
  type ApiErrorCode,
  type ApiErrorDetail,
  type IsoDate,
  type LaborBreach,
  type OverrideCheck,
  type ReplacementCandidate,
  type RoleCode,
  type RosterContract,
  type RosterDetail,
  type RosterShiftDto,
  type RosterStaffMember,
  type RosterSummary,
  type ShiftOverrideDto,
  type ShiftOverrideRequest,
} from '@lanewise/shared'
import type { ApiResponse } from './client'
import { MOCK_DEPARTMENTS, MOCK_STORES, mockStoreScope } from './mock-directory'

/**
 * In-memory published rosters for the mock API (task 13.4): `GET
 * /stores/:storeId/rosters[/:rosterId]`, replacements, the live rule check
 * and store-manager overrides, with the same role rules as the API (Weekly
 * roster to read, "Edit shifts" — Store Manager — to change; stores outside
 * the role's scope are a 404).
 *
 * The labor-rule check is a compact simulation of `@lanewise/domain`'s
 * (`evaluateRosterChange`): overlap and 7+ consecutive working days (no
 * 24-hour rest after 6) block; under 10 h rest between shifts and weekly
 * hours above the contract cap need a reason. The save decision itself is
 * the shared `overrideSaveDecision` (P14). Sample data — simulated, not SM
 * actuals.
 */

const STORE_ID = 'st-qc'
const MAIN = `${STORE_ID}-d1`
const EXPRESS = `${STORE_ID}-d2`
const ROSTER_ID = 'ros-qc-main-2026-12-14'
const PERIOD_START: IsoDate = '2026-12-14'
const PERIOD_END: IsoDate = '2026-12-20'
const WEEK = Array.from({ length: 7 }, (_, i) => `2026-12-${String(14 + i).padStart(2, '0')}`)
const CAP: Record<RosterContract, number> = { FT: 48, PT: 30, FLOAT: 40 }
const MIN_REST_H = 10
const REST_AFTER_DAYS = 6

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type Shift = Mutable<RosterShiftDto>

const STAFF: RosterStaffMember[] = [
  { id: 'st-qc-ft01', employeeNo: 'FT-01', name: 'Isa Palma', contract: 'FT', departmentId: MAIN, trainedDepartmentIds: [EXPRESS], borrowedFrom: null },
  { id: 'st-qc-ft03', employeeNo: 'FT-03', name: 'Ana Reyes', contract: 'FT', departmentId: MAIN, trainedDepartmentIds: [], borrowedFrom: null },
  { id: 'st-qc-ft07', employeeNo: 'FT-07', name: 'Ralph Edu', contract: 'FT', departmentId: MAIN, trainedDepartmentIds: [], borrowedFrom: null },
  { id: 'st-qc-ft09', employeeNo: 'FT-09', name: 'Dina Rusel', contract: 'FT', departmentId: MAIN, trainedDepartmentIds: [], borrowedFrom: null },
  { id: 'st-qc-pt02', employeeNo: 'PT-02', name: 'Juan dela Cruz', contract: 'PT', departmentId: EXPRESS, trainedDepartmentIds: [MAIN], borrowedFrom: null },
  { id: 'st-qc-pt06', employeeNo: 'PT-06', name: 'Arlene Mac', contract: 'PT', departmentId: MAIN, trainedDepartmentIds: [], borrowedFrom: null },
  { id: 'st-qc-fl01', employeeNo: 'FL-01', name: 'Cam Wills', contract: 'FLOAT', departmentId: MAIN, trainedDepartmentIds: [EXPRESS], borrowedFrom: null },
]

/** Mon–Sun pattern per cashier: [startHour, endHour] or null for a rest day. */
const PATTERN: Record<string, readonly (readonly [number, number] | null)[]> = {
  'st-qc-ft01': [[9, 18], [9, 18], [9, 18], [9, 18], [9, 18], [10, 19], null],
  'st-qc-ft03': [[10, 19], [10, 19], null, [10, 19], [10, 19], [10, 19], [10, 19]],
  'st-qc-ft07': [null, [12, 21], [12, 21], [12, 21], [12, 21], [12, 21], [12, 21]],
  'st-qc-ft09': [[8, 17], [8, 17], null, [8, 17], [8, 17], [8, 17], [9, 18]],
  'st-qc-pt02': [null, [15, 19], null, [15, 19], null, [12, 21], null],
  'st-qc-pt06': [[13, 17], null, [13, 17], null, [17, 21], [13, 17], null],
  'st-qc-fl01': [null, null, [11, 20], [11, 20], null, [11, 20], [11, 20]],
}

function seedShifts(): Shift[] {
  const out: Shift[] = []
  for (const [staffId, days] of Object.entries(PATTERN)) {
    days.forEach((p, i) => {
      if (!p) return
      const [a, b] = p
      out.push({
        id: `${staffId}-${WEEK[i]}`,
        staffId,
        departmentId: MAIN,
        date: WEEK[i] ?? PERIOD_START,
        startMin: a * 60,
        endMin: b * 60,
        activities: b - a >= 8 ? [{ kind: 'meal', startMin: (a + 4) * 60, endMin: (a + 5) * 60 }] : [],
        status: 'scheduled',
        edited: null,
      })
    })
  }
  out.push({ id: 'open-qc-2026-12-19', staffId: null, departmentId: MAIN, date: '2026-12-19', startMin: 16 * 60, endMin: 22 * 60, activities: [], status: 'scheduled', edited: null })
  return out
}

let seq = 0
function fail(code: ApiErrorCode, message: string, details?: ApiErrorDetail[]): ApiResponse {
  seq += 1
  return {
    status: HTTP_STATUS_BY_ERROR_CODE[code],
    body: { error: { code, message, requestId: `mock-ros-${seq}`, ...(details ? { details } : {}) } },
  }
}

// ---------------------------------------------------------------------------
// Simulated labor rules
// ---------------------------------------------------------------------------

const hourOf = (s: Pick<Shift, 'date' | 'startMin' | 'endMin'>, end = false) =>
  Date.parse(localToInstant(s.date, end ? s.endMin : s.startMin)) / 3_600_000
const dayNo = (date: IsoDate) => Date.parse(`${date}T00:00:00Z`) / 86_400_000
const mondayOf = (date: IsoDate) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
const paidHours = (s: Shift) =>
  (s.endMin - s.startMin - s.activities.filter((a) => a.kind === 'meal').reduce((m, a) => m + a.endMin - a.startMin, 0)) / 60

function laborCheck(shifts: readonly Shift[], staffIds: readonly string[]): LaborBreach[] {
  const out: LaborBreach[] = []
  for (const staffId of staffIds) {
    const mine = shifts.filter((s) => s.staffId === staffId && s.status === 'scheduled').sort((a, b) => hourOf(a) - hourOf(b))
    for (let i = 1; i < mine.length; i += 1) {
      const prev = mine[i - 1] as Shift
      const cur = mine[i] as Shift
      const gap = hourOf(cur) - hourOf(prev, true)
      if (gap < 0) out.push({ rule: 'OVERLAP', severity: 'block', staffId, date: cur.date, message: 'Overlapping shifts.' })
      else if (gap < MIN_REST_H) out.push({ rule: 'MIN_REST', severity: 'warning', staffId, date: cur.date, message: `Only ${gap} h rest.` })
    }
    const days = [...new Set(mine.map((s) => dayNo(s.date)))].sort((a, b) => a - b)
    let run = 0
    days.forEach((d, i) => {
      run = i > 0 && days[i - 1] === d - 1 ? run + 1 : 1
      if (run > REST_AFTER_DAYS) {
        const date = new Date(d * 86_400_000).toISOString().slice(0, 10)
        out.push({ rule: 'MANDATORY_REST', severity: 'block', staffId, date, message: `Day ${run} in a row.` })
      }
    })
    const contract = STAFF.find((s) => s.id === staffId)?.contract ?? 'FT'
    const weeks = new Map<IsoDate, number>()
    for (const s of mine) weeks.set(mondayOf(s.date), (weeks.get(mondayOf(s.date)) ?? 0) + paidHours(s))
    for (const [week, hours] of weeks) {
      if (hours > CAP[contract]) out.push({ rule: 'WEEKLY_HOURS', severity: 'warning', staffId, date: week, message: `${hours} paid hours.` })
    }
  }
  return out
}

const key = (b: LaborBreach) => `${b.rule}|${b.staffId}|${b.date}`

function evaluate(before: readonly Shift[], after: readonly Shift[], staffIds: readonly string[]): OverrideCheck {
  const had = new Set(laborCheck(before, staffIds).map(key))
  const now = laborCheck(after, staffIds)
  return overrideCheckOf(
    now.filter((b) => !had.has(key(b))),
    now.filter((b) => b.severity === 'block'),
  )
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** An open shift of the mock roster, as offers and borrow requests address it (task 17). */
export interface MockOpenShift {
  readonly id: string
  readonly storeId: string
  readonly rosterId: string
  readonly departmentName: string
  readonly date: IsoDate
  readonly startMin: number
  readonly endMin: number
}

export interface MockRosterStore {
  handle(input: { method: string; pathname: string; body: unknown; role: RoleCode; userName: string }): ApiResponse
  /** The open (unassigned, scheduled) shift `shiftId`, or null. */
  openShift(shiftId: string): MockOpenShift | null
  /** Fills an open shift (accepted offer / borrow, P14): records the change, adding a borrowed cashier to the roster. */
  fill(shiftId: string, cashier: RosterStaffMember, type: 'offer_fill' | 'borrow_fill', by: string, reason?: string | null): boolean
}

export function createRosterStore(now: () => string = () => new Date().toISOString()): MockRosterStore {
  let shifts = seedShifts()
  const overrides: ShiftOverrideDto[] = []
  const staff: RosterStaffMember[] = [...STAFF]

  const summary = (): RosterSummary => ({
    id: ROSTER_ID,
    storeId: STORE_ID,
    storeName: MOCK_STORES.find((s) => s.id === STORE_ID)?.name ?? '',
    departmentId: MAIN,
    departmentName: MOCK_DEPARTMENTS.find((d) => d.id === MAIN)?.name ?? '',
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    status: 'published',
    publishedAt: '2026-12-10T09:00:00.000Z',
    overrideCount: overrides.length,
    synthetic: true,
  })

  const detail = (role: RoleCode): RosterDetail => ({
    roster: summary(),
    departments: MOCK_DEPARTMENTS.filter((d) => d.storeId === STORE_ID).map(({ id, name }) => ({ id, name })),
    staff: [...staff],
    shifts: shifts.map((s) => ({ ...s })),
    overrides: [...overrides],
    laborChecks: laborCheck(shifts, STAFF.map((s) => s.id)),
    canOverride: can(role, 'shift_edit', 'manage'),
  })

  /** The shift set after a change, or an error response. */
  function apply(change: ShiftOverrideRequest): { after: Shift[]; target: Shift | null; next: Shift | null; from: string | null; to: string | null } | ApiResponse {
    const bad = (path: string, message: string) => fail('validation_failed', 'This change cannot be made.', [{ path: `body.${path}`, message }])
    const staffOk = (id: string | null, departmentId: string) =>
      id === null || STAFF.some((s) => s.id === id && (s.departmentId === departmentId || s.trainedDepartmentIds.includes(departmentId)))
    if (change.type === 'add') {
      if (!MOCK_DEPARTMENTS.some((d) => d.id === change.departmentId && d.storeId === STORE_ID)) return bad('departmentId', 'Pick a department of this store.')
      if (!staffOk(change.staffId, change.departmentId)) return bad('staffId', 'Pick an active cashier of this store.')
      if (change.date < PERIOD_START || change.date > PERIOD_END) return bad('date', 'Keep the shift inside the roster period.')
      seq += 1
      const next: Shift = {
        id: `added-${seq}`,
        staffId: change.staffId,
        departmentId: change.departmentId,
        date: change.date,
        startMin: change.startMin,
        endMin: change.endMin,
        activities: [],
        status: 'scheduled',
        edited: null,
      }
      return { after: [...shifts, next], target: null, next, from: null, to: change.staffId }
    }
    const target = shifts.find((s) => s.id === change.shiftId)
    if (!target) return bad('shiftId', 'Pick a shift on this roster.')
    if (target.status !== 'scheduled') return fail('conflict', 'This shift was removed.')
    let next: Shift
    let to: string | null = target.staffId
    switch (change.type) {
      case 'emergency_off':
      case 'reassign': {
        const toId = change.type === 'reassign' ? change.toStaffId : change.replacementStaffId
        if (target.staffId === null) return bad('shiftId', 'This shift is open.')
        if (toId === target.staffId) return bad(change.type === 'reassign' ? 'toStaffId' : 'replacementStaffId', 'Pick someone else.')
        if (!staffOk(toId, target.departmentId)) return bad(change.type === 'reassign' ? 'toStaffId' : 'replacementStaffId', 'Pick an active cashier of this store.')
        to = toId
        next = { ...target, staffId: toId }
        break
      }
      case 'time_change':
        if (change.date < PERIOD_START || change.date > PERIOD_END) return bad('date', 'Keep the shift inside the roster period.')
        next = {
          ...target,
          date: change.date,
          startMin: change.startMin,
          endMin: change.endMin,
          activities: [...(change.activities ?? target.activities.filter((a) => a.startMin >= change.startMin && a.endMin <= change.endMin))],
        }
        break
      case 'remove':
        next = { ...target, status: 'cancelled' }
        to = null
        break
    }
    return { after: shifts.map((s) => (s.id === target.id ? next : s)), target, next, from: target.staffId, to }
  }

  return {
    openShift(shiftId) {
      const s = shifts.find((x) => x.id === shiftId && x.staffId === null && x.status === 'scheduled')
      return s
        ? {
            id: s.id,
            storeId: STORE_ID,
            rosterId: ROSTER_ID,
            departmentName: MOCK_DEPARTMENTS.find((d) => d.id === s.departmentId)?.name ?? '',
            date: s.date,
            startMin: s.startMin,
            endMin: s.endMin,
          }
        : null
    },
    fill(shiftId, cashier, type, by, reason = null) {
      const target = shifts.find((x) => x.id === shiftId && x.staffId === null && x.status === 'scheduled')
      if (!target) return false
      if (!staff.some((s) => s.id === cashier.id)) staff.push(cashier)
      const at = now()
      shifts = shifts.map((x) => (x.id === shiftId ? { ...x, staffId: cashier.id, edited: { type, by, at } } : x))
      seq += 1
      overrides.push({ id: `ovr-${seq}`, shiftId, type, fromStaffId: null, toStaffId: cashier.id, reason, offReason: null, ruleBreaches: [], by, at })
      return true
    },
    handle({ method, pathname, body, role, userName }) {
      // ['stores', storeId, 'rosters', rosterId?, ...rest]
      const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const [, storeId, , rosterId, ...rest] = parts
      if (!can(role, 'weekly_roster', 'view') && !can(role, 'shift_edit', 'manage')) {
        return fail('forbidden', 'You do not have access to this resource.')
      }
      if (!storeId || !mockStoreScope(role).includes(storeId)) return fail('not_found', 'We couldn’t find that, or you don’t have access to it.')
      if (rosterId === undefined) {
        if (method !== 'GET') return fail('method_not_allowed', 'Method not allowed for this resource.')
        return { status: 200, body: { rosters: storeId === STORE_ID ? [summary()] : [] } }
      }
      if (storeId !== STORE_ID || rosterId !== ROSTER_ID) return fail('not_found', 'We couldn’t find that, or you don’t have access to it.')
      if (rest.length === 0 && method === 'GET') return { status: 200, body: detail(role) }

      if (!can(role, 'shift_edit', 'manage')) return fail('forbidden', 'You do not have access to this resource.')

      if (method === 'GET' && rest[0] === 'shifts' && rest[2] === 'replacements') {
        const shift = shifts.find((s) => s.id === rest[1])
        if (!shift) return fail('not_found', 'We couldn’t find that.')
        const candidates: ReplacementCandidate[] = STAFF.filter(
          (s) => s.id !== shift.staffId && (s.departmentId === shift.departmentId || s.trainedDepartmentIds.includes(shift.departmentId)),
        ).map((s) => {
          const after = shifts.map((x) => (x.id === shift.id ? { ...x, staffId: s.id } : x))
          const week = mondayOf(shift.date)
          return {
            staffId: s.id,
            employeeNo: s.employeeNo,
            name: s.name,
            contract: s.contract,
            sameDepartment: s.departmentId === shift.departmentId,
            weekHours: shifts.filter((x) => x.staffId === s.id && x.status === 'scheduled' && mondayOf(x.date) === week).reduce((h, x) => h + paidHours(x), 0),
            check: evaluate(shifts, after, [s.id]),
          }
        })
        return { status: 200, body: { shiftId: shift.id, candidates: rankReplacements(candidates) } }
      }

      if (method !== 'POST' || rest[0] !== 'overrides' || rest.length > 2 || (rest.length === 2 && rest[1] !== 'check')) {
        return fail('not_found', 'We couldn’t find that.')
      }
      const parsed = validateShiftOverrideRequest(body ?? {})
      if (!parsed.ok) {
        return fail('validation_failed', 'Some fields are missing or invalid.', parsed.issues.map((i) => ({ path: `body.${i.path}`, message: i.message })))
      }
      const change = parsed.request
      const applied = apply(change)
      if ('status' in applied) return applied
      const affected = [...new Set([applied.from, applied.to].filter((x): x is string => x !== null))]
      const check = evaluate(shifts, applied.after, affected)
      if (rest[1] === 'check') return { status: 200, body: { check } }

      const decision = overrideSaveDecision(check, change.reason)
      if (!decision.ok) {
        return decision.code === 'blocked'
          ? fail('conflict', 'This change can’t be saved: it breaks a labor rule that cannot be overridden.')
          : fail('validation_failed', 'This change breaks a labor rule. Give a reason to override it.', [
              { path: 'body.reason', message: 'A reason is required to override a labor rule.' },
            ])
      }
      const at = now()
      const next = applied.next as Shift
      next.edited = { type: change.type, by: userName, at }
      shifts = applied.target ? applied.after : [...shifts, next]
      seq += 1
      const override: ShiftOverrideDto = {
        id: `ovr-${seq}`,
        shiftId: next.id,
        type: change.type,
        fromStaffId: applied.from,
        toStaffId: applied.to,
        reason: decision.reason,
        offReason: change.type === 'emergency_off' ? change.offReason : null,
        ruleBreaches: decision.ruleBreaches,
        by: userName,
        at,
      }
      overrides.push(override)
      return { status: 201, body: { override, check, roster: detail(role) } }
    },
  }
}
