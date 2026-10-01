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
import { STM_STORE_ID, WORLD_STAFF, WORLD_STORES, managerOf } from './mock-world'

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

const QC = STM_STORE_ID
const QC_ROSTER_ID = 'ros-qc-main-2026-12-14'
const PERIOD_START: IsoDate = '2026-12-14'
const PERIOD_END: IsoDate = '2026-12-20'
const WEEK = Array.from({ length: 7 }, (_, i) => `2026-12-${String(14 + i).padStart(2, '0')}`)
const CAP: Record<RosterContract, number> = { FT: 48, PT: 30, FLOAT: 40 }
const MIN_REST_H = 10
const REST_AFTER_DAYS = 6

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type Shift = Mutable<RosterShiftDto>
type Pattern = readonly (readonly [number, number] | null)[]

const rosterIdOf = (storeId: string) => (storeId === QC ? QC_ROSTER_ID : `ros-${storeId.replace(/^st-/, '')}-main-2026-12-14`)
const mainOf = (storeId: string) => `${storeId}-d1`

/** A store's active cashiers, as the roster lists them (world staff, ./mock-world). */
function storeStaff(storeId: string): RosterStaffMember[] {
  return WORLD_STAFF.filter((s) => s.storeId === storeId && s.active).map((s) => ({
    id: s.id,
    employeeNo: s.employeeNo,
    name: s.name,
    contract: s.contract,
    departmentId: s.departmentId,
    trainedDepartmentIds: [...s.trainedDepartmentIds],
    borrowedFrom: null,
  }))
}

/** Quezon City (the wireframe roster): Mon–Sun per cashier, [startHour, endHour] or null for a rest day. */
const QC_PATTERN: Record<string, Pattern> = {
  'st-qc-ft01': [[9, 18], [9, 18], [9, 18], [9, 18], [9, 18], [10, 19], null],
  'st-qc-ft03': [[10, 19], [10, 19], null, [10, 19], [10, 19], [10, 19], [10, 19]],
  'st-qc-ft07': [null, [12, 21], [12, 21], [12, 21], [12, 21], [12, 21], [12, 21]],
  'st-qc-ft09': [[8, 17], [8, 17], null, [8, 17], [8, 17], [8, 17], [9, 18]],
  'st-qc-pt02': [null, [15, 19], null, [15, 19], null, [12, 21], null],
  'st-qc-pt05': [null, [15, 19], [15, 19], null, [17, 21], [15, 19], [13, 17]],
  'st-qc-pt06': [[13, 17], null, [13, 17], null, [17, 21], [13, 17], null],
  'st-qc-fl01': [null, null, [11, 20], [11, 20], null, [11, 20], [11, 20]],
  'st-qc-ft12': [[8, 17], [8, 17], [8, 17], null, [8, 17], [9, 18], [9, 18]],
  'st-qc-pt14': [[17, 21], null, null, null, [17, 21], [13, 17], [13, 17]],
}

const DAY_INDEX = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 } as const

/** Other stores: a deterministic week from each cashier's contract, rest day and unavailable dates. */
function generatedPattern(staffId: string, i: number): Pattern {
  const w = WORLD_STAFF.find((s) => s.id === staffId)
  if (!w) return []
  const start = [8, 9, 10, 11, 12][i % 5] ?? 9
  const off = new Set(w.unavailable.map((u) => WEEK.indexOf(u.date)).filter((d) => d >= 0))
  return WEEK.map((_, d) => {
    if (off.has(d)) return null
    if (w.contract === 'FT') return d === DAY_INDEX[w.preferredRestDay ?? 'mon'] ? null : [start, start + 9]
    if (w.contract === 'FLOAT') return (d + i) % 7 < 4 ? [start + 1, start + 10] : null
    const peak = w.availability === 'weekends' ? d >= 5 : w.availability === 'evenings' || w.availability === 'student' ? d >= 5 || (d + i) % 2 === 0 : (d + i) % 2 === 0
    return peak ? (d >= 5 ? [13, 17] : [17, 21]) : null
  })
}

function seedShifts(storeId: string): Shift[] {
  const out: Shift[] = []
  const staff = storeStaff(storeId)
  staff.forEach((member, i) => {
    const days = storeId === QC ? (QC_PATTERN[member.id] ?? []) : generatedPattern(member.id, i)
    // Customer-service and express cashiers work their own lanes; the rest the main lanes.
    const departmentId = member.departmentId.endsWith('-d1') || (member.contract === 'PT' && member.trainedDepartmentIds.includes(mainOf(storeId))) ? mainOf(storeId) : member.departmentId
    days.forEach((p, d) => {
      if (!p) return
      const [a, b] = p
      out.push({
        id: `${member.id}-${WEEK[d]}`,
        staffId: member.id,
        departmentId,
        date: WEEK[d] ?? PERIOD_START,
        startMin: a * 60,
        endMin: b * 60,
        activities: b - a >= 8 ? [{ kind: 'meal', startMin: (a + 4) * 60, endMin: (a + 5) * 60 }] : [],
        status: 'scheduled',
        edited: null,
      })
    })
  })
  const open = (id: string, date: IsoDate, a: number, b: number, departmentId = mainOf(storeId)): Shift => ({
    id,
    staffId: null,
    departmentId,
    date,
    startMin: a * 60,
    endMin: b * 60,
    activities: [],
    status: 'scheduled',
    edited: null,
  })
  if (storeId === QC) {
    // Two open shifts on Sat Dec 19 (the wireframe's "2 open shifts") and one express shift on Tue.
    out.push(open('open-qc-2026-12-19', '2026-12-19', 16, 22))
    out.push(open('open-qc-2026-12-19-b', '2026-12-19', 13, 17))
    out.push(open('open-qc-2026-12-15', '2026-12-15', 15, 19, `${QC}-d2`))
  } else {
    // The map's staffing gap on Sat Dec 19, 1–5 PM, as open shifts with the map's ids (./mock-network-map).
    const store = WORLD_STORES.find((x) => x.id === storeId)
    const gap = store ? Math.max(0, store.required - store.rostered) : 0
    for (let k = 1; k <= gap; k += 1) out.push(open(`open-${store?.code ?? storeId}-${k}`, '2026-12-19', 13, 17))
  }
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
    const contract = WORLD_STAFF.find((s) => s.id === staffId)?.contract ?? 'FT'
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
  /** Task 18: the roster as the self-service mock reads and changes it (approved staff requests). */
  readonly selfService: MockSelfServiceRoster
}

/** A shift's local times before a change. */
export interface MockShiftTimes {
  readonly date: IsoDate
  readonly startMin: number
  readonly endMin: number
}

export interface MockSelfServiceRoster {
  readonly storeId: string
  readonly storeName: string
  readonly period: { readonly start: IsoDate; readonly end: IsoDate }
  departmentName(departmentId: string): string
  staff(): readonly RosterStaffMember[]
  shifts(): readonly RosterShiftDto[]
  /** Every recorded change with the shift's times before it. */
  history(): readonly { readonly override: ShiftOverrideDto; readonly before: MockShiftTimes | null }[]
  /** The labor-rule check of reassigning shifts (`staffId` null = left open). */
  check(changes: readonly { readonly shiftId: string; readonly staffId: string | null }[]): OverrideCheck
  /** Applies an approved request's changes as ShiftOverrides. */
  apply(
    changes: readonly { readonly shiftId: string; readonly staffId: string | null }[],
    type: 'swap' | 'time_off',
    by: string,
    reason: string | null,
    ruleBreaches: readonly LaborBreach[],
  ): void
}

interface Book {
  readonly storeId: string
  readonly rosterId: string
  shifts: Shift[]
  readonly overrides: ShiftOverrideDto[]
  readonly befores: Map<string, MockShiftTimes>
  readonly staff: RosterStaffMember[]
}

export function createRosterStore(now: () => string = () => new Date().toISOString()): MockRosterStore {
  const books = new Map<string, Book>(
    WORLD_STORES.map((store) => [
      store.id,
      { storeId: store.id, rosterId: rosterIdOf(store.id), shifts: seedShifts(store.id), overrides: [], befores: new Map(), staff: storeStaff(store.id) },
    ]),
  )
  const qc = books.get(QC) as Book
  // Juan's Sat Dec 19 shift was moved by his store manager (wireframe SCR-025 "Changed").
  {
    const target = qc.shifts.find((x) => x.id === 'st-qc-pt02-2026-12-19')
    if (target) {
      const at = '2026-12-18T10:02:00.000Z'
      const by = managerOf(QC)?.name ?? 'Store manager'
      target.edited = { type: 'time_change', by, at }
      target.activities = [{ kind: 'meal', startMin: 16 * 60, endMin: 17 * 60 }]
      qc.overrides.push({ id: 'ovr-seed-1', shiftId: target.id, type: 'time_change', fromStaffId: target.staffId, toStaffId: target.staffId, reason: null, offReason: null, ruleBreaches: [], by, at })
      qc.befores.set('ovr-seed-1', { date: target.date, startMin: 13 * 60, endMin: 17 * 60 })
    }
  }
  const bookOfShift = (shiftId: string) => [...books.values()].find((b) => b.shifts.some((x) => x.id === shiftId))
  const timesOf = (x: Shift): MockShiftTimes => ({ date: x.date, startMin: x.startMin, endMin: x.endMin })
  const reassigned = (book: Book, changes: readonly { shiftId: string; staffId: string | null }[]) =>
    book.shifts.map((x) => {
      const c = changes.find((y) => y.shiftId === x.id)
      return c ? { ...x, staffId: c.staffId } : x
    })

  const summary = (book: Book): RosterSummary => ({
    id: book.rosterId,
    storeId: book.storeId,
    storeName: MOCK_STORES.find((s) => s.id === book.storeId)?.name ?? '',
    departmentId: mainOf(book.storeId),
    departmentName: MOCK_DEPARTMENTS.find((d) => d.id === mainOf(book.storeId))?.name ?? '',
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    status: 'published',
    publishedAt: '2026-12-10T09:00:00.000Z',
    overrideCount: book.overrides.length,
    synthetic: true,
  })

  const detail = (book: Book, role: RoleCode): RosterDetail => ({
    roster: summary(book),
    departments: MOCK_DEPARTMENTS.filter((d) => d.storeId === book.storeId).map(({ id, name }) => ({ id, name })),
    staff: [...book.staff],
    shifts: book.shifts.map((s) => ({ ...s })),
    overrides: [...book.overrides],
    laborChecks: laborCheck(book.shifts, storeStaff(book.storeId).map((s) => s.id)),
    canOverride: can(role, 'shift_edit', 'manage'),
  })

  /** The shift set after a change, or an error response. */
  function apply(book: Book, change: ShiftOverrideRequest): { after: Shift[]; target: Shift | null; next: Shift | null; from: string | null; to: string | null } | ApiResponse {
    const shifts = book.shifts
    const own = storeStaff(book.storeId)
    const bad = (path: string, message: string) => fail('validation_failed', 'This change cannot be made.', [{ path: `body.${path}`, message }])
    const staffOk = (id: string | null, departmentId: string) =>
      id === null || own.some((s) => s.id === id && (s.departmentId === departmentId || s.trainedDepartmentIds.includes(departmentId)))
    if (change.type === 'add') {
      if (!MOCK_DEPARTMENTS.some((d) => d.id === change.departmentId && d.storeId === book.storeId)) return bad('departmentId', 'Pick a department of this store.')
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
      const book = bookOfShift(shiftId)
      const s = book?.shifts.find((x) => x.id === shiftId && x.staffId === null && x.status === 'scheduled')
      return book && s
        ? {
            id: s.id,
            storeId: book.storeId,
            rosterId: book.rosterId,
            departmentName: MOCK_DEPARTMENTS.find((d) => d.id === s.departmentId)?.name ?? '',
            date: s.date,
            startMin: s.startMin,
            endMin: s.endMin,
          }
        : null
    },
    fill(shiftId, cashier, type, by, reason = null) {
      const book = bookOfShift(shiftId)
      const target = book?.shifts.find((x) => x.id === shiftId && x.staffId === null && x.status === 'scheduled')
      if (!book || !target) return false
      if (!book.staff.some((s) => s.id === cashier.id)) book.staff.push(cashier)
      const at = now()
      book.shifts = book.shifts.map((x) => (x.id === shiftId ? { ...x, staffId: cashier.id, edited: { type, by, at } } : x))
      seq += 1
      book.overrides.push({ id: `ovr-${seq}`, shiftId, type, fromStaffId: null, toStaffId: cashier.id, reason, offReason: null, ruleBreaches: [], by, at })
      book.befores.set(`ovr-${seq}`, timesOf(target))
      return true
    },
    selfService: {
      storeId: QC,
      storeName: MOCK_STORES.find((s) => s.id === QC)?.name ?? '',
      period: { start: PERIOD_START, end: PERIOD_END },
      departmentName: (id) => MOCK_DEPARTMENTS.find((d) => d.id === id)?.name ?? '',
      staff: () => [...qc.staff],
      shifts: () => qc.shifts.map((x) => ({ ...x })),
      history: () => qc.overrides.map((o) => ({ override: o, before: qc.befores.get(o.id) ?? null })),
      check(changes) {
        const affected = [
          ...new Set(
            changes.flatMap((c) => [qc.shifts.find((x) => x.id === c.shiftId)?.staffId ?? null, c.staffId]).filter((x): x is string => x !== null),
          ),
        ]
        return evaluate(qc.shifts, reassigned(qc, changes), affected)
      },
      apply(changes, type, by, reason, ruleBreaches) {
        const at = now()
        for (const c of changes) {
          const target = qc.shifts.find((x) => x.id === c.shiftId)
          if (!target) continue
          seq += 1
          qc.overrides.push({ id: `ovr-${seq}`, shiftId: c.shiftId, type, fromStaffId: target.staffId, toStaffId: c.staffId, reason, offReason: null, ruleBreaches, by, at })
          qc.befores.set(`ovr-${seq}`, timesOf(target))
        }
        qc.shifts = reassigned(qc, changes).map((x) => (changes.some((c) => c.shiftId === x.id) ? { ...x, edited: { type, by, at } } : x))
      },
    },
    handle({ method, pathname, body, role, userName }) {
      // ['stores', storeId, 'rosters', rosterId?, ...rest]
      const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const [, storeId, , rosterId, ...rest] = parts
      if (!can(role, 'weekly_roster', 'view') && !can(role, 'shift_edit', 'manage')) {
        return fail('forbidden', 'You do not have access to this resource.')
      }
      if (!storeId || !mockStoreScope(role).includes(storeId)) return fail('not_found', 'We couldn’t find that, or you don’t have access to it.')
      const book = books.get(storeId)
      if (rosterId === undefined) {
        if (method !== 'GET') return fail('method_not_allowed', 'Method not allowed for this resource.')
        return { status: 200, body: { rosters: book ? [summary(book)] : [] } }
      }
      if (!book || rosterId !== book.rosterId) return fail('not_found', 'We couldn’t find that, or you don’t have access to it.')
      const shifts = book.shifts
      if (rest.length === 0 && method === 'GET') return { status: 200, body: detail(book, role) }

      if (!can(role, 'shift_edit', 'manage')) return fail('forbidden', 'You do not have access to this resource.')

      if (method === 'GET' && rest[0] === 'shifts' && rest[2] === 'replacements') {
        const shift = shifts.find((s) => s.id === rest[1])
        if (!shift) return fail('not_found', 'We couldn’t find that.')
        const candidates: ReplacementCandidate[] = storeStaff(book.storeId).filter(
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
      const applied = apply(book, change)
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
      book.shifts = applied.target ? applied.after : [...shifts, next]
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
      book.overrides.push(override)
      if (applied.target) book.befores.set(override.id, timesOf(applied.target))
      return { status: 201, body: { override, check, roster: detail(book, role) } }
    },
  }
}
