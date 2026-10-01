import {
  HTTP_STATUS_BY_ERROR_CODE,
  can,
  instantToLocal,
  overrideSaveDecision,
  validateCreateStaffRequest,
  validateStaffRequestDecision,
  type ApiErrorCode,
  type ApiErrorDetail,
  type IsoDate,
  type MyDayAbsence,
  type MyRosterDayDto,
  type MyRosterResponse,
  type MyShiftDto,
  type MyStaffRequestDto,
  type RequestShiftDto,
  type RoleCode,
  type RosterShiftDto,
  type StaffRequestStatus,
  type StaffRequestType,
  type StoreStaffRequestDto,
  type SwapTargetDto,
  type TimeOffReason,
} from '@lanewise/shared'
import type { ApiResponse } from './client'
import { mockStoreScope } from './mock-directory'
import type { MockRosterStore } from './mock-rosters'

/**
 * In-memory staff self-service for the mock API (task 18): `GET /me/roster`
 * for the demo Staff persona (PT-02 at SM Supermarket – Quezon City), their
 * time-off and swap requests, and the Store Manager's Staff requests panel
 * on SCR-022 — with the API's rules: Staff see and act on their own records
 * only (P11); a request changes nothing until the Store Manager approves it
 * (P19); approval applies time off (shifts left open) or a swap through the
 * shared mock roster, under the same reason / hard-block labor rules.
 * Sample data — simulated, not SM actuals.
 */

const SELF = 'st-qc-pt02'
const addDaysIso = (date: IsoDate, days: number): IsoDate => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
/** Mock "now": the demo roster week (Dec 14–20, 2026) is in the future. */
const MOCK_TODAY: IsoDate = '2026-12-10'

interface Request {
  id: string
  staffId: string
  type: StaffRequestType
  status: StaffRequestStatus
  createdAt: string
  dateFrom: IsoDate | null
  dateTo: IsoDate | null
  reason: TimeOffReason | null
  note: string | null
  offeredShiftId: string | null
  targetShiftId: string | null
  targetStaffId: string | null
  decidedAt: string | null
  decidedBy: string | null
  decisionNote: string | null
}

let seq = 0
function fail(code: ApiErrorCode, message: string, details?: ApiErrorDetail[]): ApiResponse {
  seq += 1
  return { status: HTTP_STATUS_BY_ERROR_CODE[code], body: { error: { code, message, requestId: `mock-self-${seq}`, ...(details ? { details } : {}) } } }
}
const notFound = () => fail('not_found', 'We couldn’t find that, or you don’t have access to it.')
const forbidden = () => fail('forbidden', 'You do not have access to this resource.')
const invalid = (issues: readonly { path: string; message: string }[]) =>
  fail('validation_failed', 'Some fields are missing or invalid.', issues.map((i) => ({ path: i.path ? `body.${i.path}` : 'body', message: i.message })))

export interface MockSelfServiceStore {
  handle(input: { method: string; pathname: string; query: URLSearchParams; body: unknown; role: RoleCode; userName: string }): ApiResponse | null
}

export function createSelfServiceStore(rosters: MockRosterStore, now: () => Date = () => new Date()): MockSelfServiceStore {
  const roster = rosters.selfService
  const requests: Request[] = [
    {
      id: 'req-seed-1',
      staffId: SELF,
      type: 'time_off',
      status: 'pending',
      createdAt: '2026-12-09T02:00:00.000Z',
      dateFrom: '2026-12-24',
      dateTo: '2026-12-24',
      reason: 'family',
      note: null,
      offeredShiftId: null,
      targetShiftId: null,
      targetStaffId: null,
      decidedAt: null,
      decidedBy: null,
      decisionNote: null,
    },
    {
      id: 'req-seed-2',
      staffId: 'st-qc-pt06',
      type: 'time_off',
      status: 'pending',
      createdAt: '2026-12-09T03:00:00.000Z',
      dateFrom: '2026-12-16',
      dateTo: '2026-12-16',
      reason: 'medical',
      note: 'Clinic appointment',
      offeredShiftId: null,
      targetShiftId: null,
      targetStaffId: null,
      decidedAt: null,
      decidedBy: null,
      decisionNote: null,
    },
  ]

  const shiftById = (id: string | null) => (id ? roster.shifts().find((s) => s.id === id) : undefined)
  const scheduled = (s: RosterShiftDto | undefined): s is RosterShiftDto => !!s && s.status === 'scheduled'
  const shiftDto = (s: RosterShiftDto): RequestShiftDto => ({
    shiftId: s.id,
    storeId: roster.storeId,
    departmentName: roster.departmentName(s.departmentId),
    date: s.date,
    startMin: s.startMin,
    endMin: s.endMin,
  })
  const staffName = (id: string) => {
    const s = roster.staff().find((x) => x.id === id)
    return s ? `${s.employeeNo} ${s.name}` : id
  }
  const inRange = (r: Request) => roster.shifts().filter((s) => s.staffId === r.staffId && s.status === 'scheduled' && r.dateFrom && r.dateTo && r.dateFrom <= s.date && s.date <= r.dateTo)
  const swapChanges = (r: Request) => [
    { shiftId: r.offeredShiftId ?? '', staffId: r.targetStaffId },
    { shiftId: r.targetShiftId ?? '', staffId: r.staffId },
  ]
  const stale = (r: Request) => {
    const o = shiftById(r.offeredShiftId)
    const t = shiftById(r.targetShiftId)
    return !scheduled(o) || !scheduled(t) || o.staffId !== r.staffId || t.staffId !== r.targetStaffId
  }

  const mine = (r: Request): MyStaffRequestDto => {
    const o = shiftById(r.offeredShiftId)
    const t = shiftById(r.targetShiftId)
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      createdAt: r.createdAt,
      storeName: roster.storeName,
      dateFrom: r.dateFrom,
      dateTo: r.dateTo,
      reason: r.reason,
      note: r.note,
      offered: o ? shiftDto(o) : null,
      target: t ? { ...shiftDto(t), kind: r.targetStaffId === null ? 'open' : 'colleague' } : null,
      decidedAt: r.decidedAt,
      decisionNote: r.decisionNote,
    }
  }

  const forStore = (r: Request): StoreStaffRequestDto => {
    const base = mine(r)
    const s = roster.staff().find((x) => x.id === r.staffId)
    const pending = r.status === 'pending'
    const isStale = pending && r.type === 'swap' && stale(r)
    return {
      ...base,
      staff: { id: r.staffId, employeeNo: s?.employeeNo ?? '', name: s?.name ?? '' },
      target: base.target ? { ...base.target, staffName: r.targetStaffId ? staffName(r.targetStaffId) : null } : null,
      decidedBy: r.decidedBy,
      check: pending && r.type === 'swap' && !isStale ? roster.check(swapChanges(r)) : null,
      shiftsLeftOpen: pending && r.type === 'time_off' ? inRange(r).length : null,
      stale: isStale,
    }
  }

  function myRoster(from: IsoDate, to: IsoDate): MyRosterResponse {
    const me = roster.staff().find((s) => s.id === SELF)
    const shifts = roster.shifts()
    const history = roster.history()
    const pending = requests.filter((r) => r.staffId === SELF && r.status === 'pending')
    const days: MyRosterDayDto[] = []
    for (let d = from; d <= to; d = addDaysIso(d, 1)) {
      const own = shifts.filter((s) => s.staffId === SELF && s.status === 'scheduled' && s.date === d)
      const dto = own.map((s): MyShiftDto => {
        const last = [...history].reverse().find((h) => h.override.shiftId === s.id)
        const moved = last?.before && (last.before.startMin !== s.startMin || last.before.endMin !== s.endMin || last.before.date !== s.date)
        return {
          id: s.id,
          storeId: roster.storeId,
          storeName: roster.storeName,
          departmentId: s.departmentId,
          departmentName: roster.departmentName(s.departmentId),
          date: s.date,
          startMin: s.startMin,
          endMin: s.endMin,
          activities: s.activities,
          changed: last ? { type: last.override.type, by: last.override.by, at: last.override.at, previous: moved && last.before ? last.before : null } : null,
          pendingRequestId: pending.find((p) => p.offeredShiftId === s.id || (p.dateFrom && p.dateTo && p.dateFrom <= d && d <= p.dateTo))?.id ?? null,
        }
      })
      const removed = history
        .filter((h) => h.override.fromStaffId === SELF && h.override.toStaffId !== SELF && h.before?.date === d)
        .filter((h) => shifts.find((s) => s.id === h.override.shiftId)?.staffId !== SELF)
        .map((h) => ({ shiftId: h.override.shiftId, type: h.override.type, by: h.override.by, at: h.override.at, date: d, startMin: h.before?.startMin ?? 0, endMin: h.before?.endMin ?? 0 }))
      const unavailable = requests.some((r) => r.staffId === SELF && r.type === 'time_off' && r.status === 'approved' && r.dateFrom && r.dateTo && r.dateFrom <= d && d <= r.dateTo)
      const rostered = d >= roster.period.start && d <= roster.period.end
      const absence: MyDayAbsence | null = dto.length > 0 ? null : unavailable ? 'unavailable' : rostered ? 'rest' : null
      days.push({ date: d, shifts: dto, absence, removed })
    }
    return {
      staff: { id: SELF, employeeNo: me?.employeeNo ?? 'PT-02', name: me?.name ?? '', storeName: roster.storeName, departmentName: roster.departmentName(me?.departmentId ?? ''), contract: me?.contract ?? 'PT' },
      from,
      to,
      days,
      travelLimit: { maxTravelMin: 30, crossStoreOffers: true },
      synthetic: true,
    }
  }

  return {
    handle({ method, pathname, query, body, role, userName }) {
      const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)

      // --- Staff: own roster and requests -------------------------------------
      if (parts[0] === 'me' && (parts[1] === 'roster' || parts[1] === 'requests')) {
        if (role !== 'STF') return forbidden()
        if (parts[1] === 'roster' && method === 'GET') {
          const from = query.get('from') ?? roster.period.start
          return { status: 200, body: myRoster(from, query.get('to') ?? addDaysIso(from, 20)) }
        }
        if (parts.length === 2 && method === 'GET') {
          const list = requests
            .filter((r) => r.staffId === SELF)
            .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.createdAt.localeCompare(a.createdAt))
          return { status: 200, body: { requests: list.map(mine) } }
        }
        if (parts[2] === 'swap-options' && method === 'GET') {
          const shifts = roster.shifts().filter((s) => s.status === 'scheduled')
          const offered = new Set(requests.filter((r) => r.status === 'pending').map((r) => r.offeredShiftId))
          const me = roster.staff().find((s) => s.id === SELF)
          const depts = me ? [me.departmentId, ...me.trainedDepartmentIds] : []
          return {
            status: 200,
            body: {
              mine: shifts.filter((s) => s.staffId === SELF && !offered.has(s.id)).map(shiftDto),
              open: shifts.filter((s) => s.staffId === null && depts.includes(s.departmentId)).map((s): SwapTargetDto => ({ ...shiftDto(s), kind: 'open' })),
            },
          }
        }
        if (parts.length === 2 && method === 'POST') {
          if (!can(role, 'staff_requests_raise', 'edit')) return forbidden()
          const today = instantToLocal(now()).date
          const parsed = validateCreateStaffRequest(body ?? {}, today < MOCK_TODAY ? today : MOCK_TODAY)
          if (!parsed.ok) return invalid(parsed.issues)
          const v = parsed.value
          seq += 1
          const r: Request = {
            id: `req-${seq}`,
            staffId: SELF,
            type: v.type,
            status: 'pending',
            createdAt: now().toISOString(),
            dateFrom: v.type === 'time_off' ? v.dateFrom : null,
            dateTo: v.type === 'time_off' ? v.dateTo : null,
            reason: v.type === 'time_off' ? (v.reason ?? null) : null,
            note: v.note?.trim() || null,
            offeredShiftId: v.type === 'swap' ? v.offeredShiftId : null,
            targetShiftId: v.type === 'swap' ? v.targetShiftId : null,
            targetStaffId: null,
            decidedAt: null,
            decidedBy: null,
            decisionNote: null,
          }
          if (v.type === 'time_off') {
            const overlap = requests.some((q) => q.staffId === SELF && q.type === 'time_off' && q.status === 'pending' && q.dateFrom! <= v.dateTo && q.dateTo! >= v.dateFrom)
            if (overlap) return fail('conflict', 'You already asked for time off on some of these days.')
          } else {
            const o = shiftById(v.offeredShiftId)
            const t = shiftById(v.targetShiftId)
            if (!scheduled(o) || o.staffId !== SELF) return invalid([{ path: 'offeredShiftId', message: 'Pick one of your upcoming shifts.' }])
            if (!scheduled(t) || t.staffId === SELF) return invalid([{ path: 'targetShiftId', message: 'Pick an upcoming open shift at the same store.' }])
            if (requests.some((q) => q.status === 'pending' && q.offeredShiftId === o.id)) return fail('conflict', 'That shift is already offered in a pending swap.')
            r.targetStaffId = t.staffId
          }
          requests.push(r)
          return { status: 201, body: { request: mine(r) } }
        }
        if (parts.length === 4 && parts[3] === 'cancel' && method === 'POST') {
          const r = requests.find((x) => x.id === parts[2] && x.staffId === SELF)
          if (!r) return notFound()
          if (r.status !== 'pending') return fail('conflict', `This request is already ${r.status}.`)
          r.status = 'cancelled'
          return { status: 200, body: { request: mine(r) } }
        }
        return notFound()
      }

      // --- Store: the Staff requests panel -------------------------------------
      if (parts[0] === 'stores' && parts[2] === 'staff-requests') {
        const storeId = parts[1] ?? ''
        if (!can(role, 'weekly_roster', 'view')) return forbidden()
        if (!mockStoreScope(role).includes(storeId)) return notFound()
        const mineHere = storeId === roster.storeId ? requests : []
        if (parts.length === 3 && method === 'GET') {
          const list = [...mineHere].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || a.createdAt.localeCompare(b.createdAt))
          return { status: 200, body: { requests: list.map(forStore) } }
        }
        if (parts.length === 5 && parts[4] === 'decision' && method === 'POST') {
          if (!can(role, 'staff_requests_approve', 'manage')) return forbidden()
          const r = mineHere.find((x) => x.id === parts[3])
          if (!r) return notFound()
          if (r.status !== 'pending') return fail('conflict', `This request is already ${r.status}.`)
          const parsed = validateStaffRequestDecision(body ?? {})
          if (!parsed.ok) return invalid(parsed.issues)
          const d = parsed.value
          const at = now().toISOString()
          if (d.decision === 'approve') {
            if (r.type === 'time_off') {
              roster.apply(inRange(r).map((s) => ({ shiftId: s.id, staffId: null })), 'time_off', userName, null, [])
            } else {
              if (stale(r)) return fail('conflict', 'The roster changed since this swap was requested, so it can no longer be applied. Decline it instead.')
              const check = roster.check(swapChanges(r))
              const decision = overrideSaveDecision(check, d.reason)
              if (!decision.ok) {
                return decision.code === 'blocked'
                  ? fail('conflict', 'This swap can’t be approved: it breaks a labor rule that cannot be overridden.')
                  : fail('validation_failed', 'This swap breaks a labor rule. Give a reason to approve it anyway.', [
                      { path: 'body.reason', message: 'A reason is required to override a labor rule.' },
                    ])
              }
              roster.apply(swapChanges(r), 'swap', userName, decision.reason, decision.ruleBreaches)
            }
          }
          r.status = d.decision === 'approve' ? 'approved' : 'declined'
          r.decidedAt = at
          r.decidedBy = userName
          r.decisionNote = d.note?.trim() || null
          return { status: 200, body: { request: forStore(r) } }
        }
        return notFound()
      }
      return null
    },
  }
}
