import {
  HTTP_STATUS_BY_ERROR_CODE,
  OFFER_EXPIRY_MINUTES,
  applyAcceptance,
  can,
  costFigure,
  declineOffer,
  expireOffers,
  shapeCost,
  transportAllowanceFor,
  type ApiErrorCode,
  type ApiErrorDetail,
  type BorrowRequestDto,
  type CostDraft,
  type CostViewer,
  type IsoDate,
  type LendCandidate,
  type MyOfferDto,
  type OfferCandidate,
  type RoleCode,
  type ShiftOfferDto,
  type ShiftOfferStatus,
} from '@lanewise/shared'
import type { ApiResponse } from './client'
import { MOCK_STAFF, MOCK_STORES, mockStoreScope } from './mock-directory'
import { MOCK_MAP_STORES, MOCK_STM_STORE_ID, mockMapCandidate } from './mock-network-map'
import type { MockOpenShift, MockRosterStore } from './mock-rosters'

/**
 * In-memory shift offers and borrow requests for the mock API (task 17),
 * with the API's role rules: "Send open-shift offers / request staff" (Planner,
 * Store Manager own store) to offer and borrow, "Approve lending own staff"
 * to decide, "Accept / decline shift offers" (Staff, own offers only) to
 * respond; stores outside the role's scope are a 404.
 *
 * The offer lifecycle is the shared state machine (`applyAcceptance`,
 * `declineOffer`, `expireOffers` — P17): the first acceptance wins and the
 * other offers for the shift are withdrawn at that moment; offers expire 30
 * minutes after they are sent. An accepted offer or an approved borrow fills
 * the open shift on the mock roster (`offer_fill` / `borrow_fill`).
 *
 * The demo Staff persona (PT-02, Quezon City) is one of the candidates, so a
 * Store Manager can send an offer and the Staff role can accept it. Sample
 * data — simulated, not SM actuals.
 */

const STAFF_SELF = 'staff-pt-02'
const PAY_PER_HOUR = 86.875

interface Candidate {
  readonly staffId: string
  readonly displayId: string
  readonly name: string
  readonly homeStoreId: string
  readonly homeArea: { readonly barangay: string; readonly city: string }
  readonly travelMin: number
  readonly weekHours: number
  readonly limit: number
}

const storeName = (id: string) => MOCK_STORES.find((s) => s.id === id)?.name ?? MOCK_MAP_STORES.find((s) => s.id === id)?.name ?? id

const CANDIDATES: readonly Candidate[] = [
  { staffId: STAFF_SELF, displayId: 'PT-02', name: 'Juan dela Cruz', homeStoreId: 'st-qc', homeArea: { barangay: 'Bagong Pag-asa', city: 'Quezon City' }, travelMin: 9, weekHours: 12, limit: 30 },
  { staffId: 'cand-xs14', displayId: 'XS-14', name: 'Jo Santos', homeStoreId: 'st-moa', homeArea: { barangay: 'Wack-Wack Greenhills', city: 'Mandaluyong' }, travelMin: 22, weekHours: 32, limit: 48 },
  { staffId: 'cand-pt41', displayId: 'PT-41', name: 'Rosa Lim', homeStoreId: 'st-lp', homeArea: { barangay: 'Kapitolyo', city: 'Pasig' }, travelMin: 28, weekHours: 16, limit: 30 },
]

interface Offer {
  id: string
  shiftId: string
  storeId: string
  rosterId: string
  departmentName: string
  date: IsoDate
  startMin: number
  endMin: number
  staffId: string
  status: ShiftOfferStatus
  sentBy: string
  sentAt: string
  expiresAt: string
  respondedAt: string | null
  travelMin: number
  allowance: number
  pay: number
}

let seq = 0
function fail(code: ApiErrorCode, message: string, details?: ApiErrorDetail[]): ApiResponse {
  seq += 1
  return { status: HTTP_STATUS_BY_ERROR_CODE[code], body: { error: { code, message, requestId: `mock-off-${seq}`, ...(details ? { details } : {}) } } }
}
const notFound = () => fail('not_found', 'We couldn’t find that, or you don’t have access to it.')
const forbidden = () => fail('forbidden', 'You do not have access to this resource.')

/** A map shift id (`open-<store code>-<n>`, see ./mock-network-map) as an open shift on Dec 19, 1–5 PM. */
function mapShift(shiftId: string, date: IsoDate): MockOpenShift | null {
  const m = /^open-(.+)-\d+$/.exec(shiftId)
  const store = m ? [...MOCK_STORES, ...MOCK_MAP_STORES].find((s) => s.code.toLowerCase() === m[1]) : undefined
  return store ? { id: shiftId, storeId: store.id, rosterId: `ros-${store.id}`, departmentName: 'Main checkout lanes', date, startMin: 13 * 60, endMin: 17 * 60 } : null
}

export interface MockOfferStore {
  handle(input: { method: string; pathname: string; query: URLSearchParams; body: unknown; role: RoleCode; viewer: CostViewer; userName: string }): ApiResponse | null
}

export function createOfferStore(rosters: MockRosterStore, now: () => Date = () => new Date()): MockOfferStore {
  let offers: Offer[] = []
  const known = new Map<string, MockOpenShift>()
  const borrows: BorrowRequestDto[] = [
    {
      id: 'bor-moa-1',
      fromStoreId: 'st-qc',
      fromStoreName: storeName('st-qc'),
      toStoreId: 'st-moa',
      toStoreName: storeName('st-moa'),
      departmentName: 'Main checkout lanes',
      date: '2026-12-19',
      windowStart: '2026-12-19T05:00:00.000Z',
      windowEnd: '2026-12-19T09:00:00.000Z',
      count: 1,
      shiftIds: ['open-smhm-moa-1'],
      travelMin: 25,
      status: 'pending',
      note: 'Payday rush at MOA',
      requestedBy: 'Demo STM (MOA)',
      requestedAt: '2026-12-18T08:00:00.000Z',
      decidedBy: null,
      decidedAt: null,
      overrideReason: null,
      declineReason: null,
      cashiers: [],
    },
  ]

  const shiftOf = (shiftId: string): MockOpenShift | null => rosters.openShift(shiftId) ?? known.get(shiftId) ?? mapShift(shiftId, '2026-12-19')
  const expire = () => {
    offers = expireOffers(offers, now()).offers
  }
  // The roster's stores (./mock-directory) and the map's (./mock-network-map); a Store Manager has one of each.
  const inScope = (role: RoleCode, storeId: string) =>
    mockStoreScope(role).includes(storeId) ||
    (MOCK_MAP_STORES.some((s) => s.id === storeId) && role !== 'STF' && (role !== 'STM' || storeId === MOCK_STM_STORE_ID))
  /** A candidate by id: the roster demo candidates or an eligible map candidate (auto-match, store panel). */
  const candidateOf = (staffId: string): Candidate | undefined => CANDIDATES.find((c) => c.staffId === staffId) ?? mockMapCandidate(staffId) ?? undefined

  const toDto = (o: Offer): CostDraft<ShiftOfferDto> => {
    const c = candidateOf(o.staffId)
    const regionId = MOCK_STORES.find((s) => s.id === o.storeId)?.regionId ?? ''
    return {
      id: o.id,
      shiftId: o.shiftId,
      rosterId: o.rosterId,
      storeId: o.storeId,
      departmentName: o.departmentName,
      date: o.date,
      startMin: o.startMin,
      endMin: o.endMin,
      staffId: o.staffId,
      displayId: c?.displayId ?? o.staffId,
      name: o.status === 'accepted' || c?.homeStoreId === o.storeId ? (c?.name ?? null) : null,
      homeStoreName: storeName(c?.homeStoreId ?? ''),
      status: o.status,
      sentBy: o.sentBy,
      sentAt: o.sentAt,
      expiresAt: o.expiresAt,
      respondedAt: o.respondedAt,
      travelMin: o.travelMin,
      allowance: o.allowance,
      pay: costFigure({ level: 'individual', store: { id: o.storeId, regionId } }, o.pay),
    }
  }
  const toMine = (o: Offer): MyOfferDto => ({
    id: o.id,
    storeName: storeName(o.storeId),
    departmentName: o.departmentName,
    date: o.date,
    startMin: o.startMin,
    endMin: o.endMin,
    status: o.status,
    sentAt: o.sentAt,
    expiresAt: o.expiresAt,
    respondedAt: o.respondedAt,
    travelMin: o.travelMin,
    allowance: o.allowance,
    pay: o.pay,
  })

  /** Lending-store cashiers for a request: the store's two demo cashiers. */
  const lenders = (r: BorrowRequestDto): LendCandidate[] =>
    MOCK_STAFF.filter((s) => s.storeId === r.fromStoreId).map((s, i) => ({
      staffId: s.id,
      employeeNo: s.employeeNo,
      name: s.name,
      weekHours: 24 + 8 * i,
      eligibleShiftIds: [...r.shiftIds],
    }))

  return {
    handle({ method, pathname, query, body, role, viewer, userName }) {
      const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const shaped = (status: number, payload: unknown): ApiResponse => ({ status, body: shapeCost<unknown>(payload, viewer) })

      // --- Staff: own offers ------------------------------------------------
      if (parts[0] === 'me' && parts[1] === 'offers') {
        if (!can(role, 'shift_offers_respond', 'view') || viewer.scope?.type !== 'self') return forbidden()
        expire()
        if (parts.length === 2 && method === 'GET') {
          const mine = offers.filter((o) => o.staffId === STAFF_SELF).sort((a, b) => Number(b.status === 'sent') - Number(a.status === 'sent') || b.sentAt.localeCompare(a.sentAt))
          return { status: 200, body: { offers: mine.map(toMine) } }
        }
        const offerId = parts[2] ?? ''
        const action = parts[3]
        if (method !== 'POST' || (action !== 'accept' && action !== 'decline')) return notFound()
        const own = offers.find((o) => o.id === offerId && o.staffId === STAFF_SELF)
        if (!own) return notFound()
        if (action === 'decline') {
          const r = declineOffer(offers, offerId, now())
          if (!r.ok) return fail('conflict', r.code === 'expired' ? 'This offer has expired.' : 'You have already answered this offer.')
          offers = r.offers
          return { status: 200, body: { offer: toMine(r.declined) } }
        }
        const r = applyAcceptance(offers, offerId, now())
        if (!r.ok) {
          return fail('conflict', r.code === 'expired' ? 'This offer has expired.' : r.code === 'filled' || own.status === 'withdrawn' ? 'This shift has just been filled.' : 'You have already answered this offer.')
        }
        offers = r.offers
        const c = CANDIDATES.find((x) => x.staffId === STAFF_SELF) as Candidate
        rosters.fill(
          own.shiftId,
          { id: c.staffId, employeeNo: c.displayId, name: c.name, contract: 'PT', departmentId: '', trainedDepartmentIds: [], borrowedFrom: c.homeStoreId === own.storeId ? null : storeName(c.homeStoreId), borrowedTravelMin: c.travelMin },
          'offer_fill',
          own.sentBy,
        )
        return { status: 200, body: { offer: toMine(r.accepted) } }
      }

      if (parts[0] !== 'stores' || !parts[1]) return null
      const storeId = parts[1]
      const rest = parts.slice(2)
      const isOffers = rest[0] === 'offers' || (rest[0] === 'shifts' && (rest[2] === 'offers' || rest[2] === 'offer-candidates'))
      const isBorrow = rest[0] === 'borrow-requests'
      if (!isOffers && !isBorrow) return null
      if (!inScope(role, storeId)) return notFound()
      expire()

      // --- Offers -------------------------------------------------------------
      if (rest[0] === 'offers') {
        if (method !== 'GET') return notFound()
        if (!can(role, 'weekly_roster', 'view')) return forbidden()
        const shiftId = query.get('shiftId')
        const list = offers.filter((o) => o.storeId === storeId && (!shiftId || o.shiftId === shiftId)).sort((a, b) => b.sentAt.localeCompare(a.sentAt))
        return shaped(200, { offers: list.map(toDto) })
      }
      if (rest[0] === 'shifts') {
        if (!can(role, 'shift_offers_send', 'edit')) return forbidden()
        const shift = shiftOf(rest[1] ?? '')
        if (!shift || shift.storeId !== storeId) return notFound()
        const maxTravelMin = Number(query.get('maxTravelMin') ?? (body as { maxTravelMin?: number } | null)?.maxTravelMin ?? 30)
        const live = new Set(offers.filter((o) => o.shiftId === shift.id && o.status === 'sent').map((o) => o.staffId))
        const eligible = CANDIDATES.filter((c) => c.travelMin <= maxTravelMin)
        const sendable = (id: string) => eligible.find((c) => c.staffId === id) ?? mockMapCandidate(id) ?? undefined
        const candidate = (c: Candidate): OfferCandidate => ({
          staffId: c.staffId,
          displayId: c.displayId,
          homeStoreId: c.homeStoreId,
          homeStoreName: storeName(c.homeStoreId),
          homeArea: c.homeArea,
          travelMin: c.travelMin,
          allowance: transportAllowanceFor(c.travelMin),
          weeklyHours: { withShift: c.weekHours + (shift.endMin - shift.startMin) / 60, limit: c.limit },
          offered: live.has(c.staffId),
        })
        if (rest[2] === 'offer-candidates' && method === 'GET') {
          return {
            status: 200,
            body: { shiftId: shift.id, storeId, date: shift.date, startMin: shift.startMin, endMin: shift.endMin, mode: query.get('mode') ?? 'public_transport', maxTravelMin, candidates: eligible.map(candidate), excludedWithoutConsent: 4 },
          }
        }
        if (rest[2] !== 'offers' || method !== 'POST') return notFound()
        const staffIds = Array.isArray((body as { staffIds?: unknown })?.staffIds) ? ((body as { staffIds: unknown[] }).staffIds.filter((x) => typeof x === 'string') as string[]) : []
        if (staffIds.length === 0) return fail('validation_failed', 'Pick at least one cashier.', [{ path: 'body.staffIds', message: 'Pick at least one cashier.' }])
        const issues = staffIds.flatMap((id, i) =>
          live.has(id)
            ? [{ path: `body.staffIds.${i}`, message: 'This cashier already has a live offer for this shift.' }]
            : sendable(id)
              ? []
              : [{ path: `body.staffIds.${i}`, message: 'Not eligible for this shift.' }],
        )
        if (issues.length > 0) return fail('validation_failed', 'Offers go only to eligible cashiers.', issues)
        known.set(shift.id, shift)
        const sentAt = now()
        for (const id of staffIds) {
          const c = sendable(id) as Candidate
          seq += 1
          offers.push({
            id: `off-${seq}`,
            shiftId: shift.id,
            storeId,
            rosterId: shift.rosterId,
            departmentName: shift.departmentName,
            date: shift.date,
            startMin: shift.startMin,
            endMin: shift.endMin,
            staffId: id,
            status: 'sent',
            sentBy: userName,
            sentAt: sentAt.toISOString(),
            expiresAt: new Date(sentAt.getTime() + OFFER_EXPIRY_MINUTES * 60_000).toISOString(),
            respondedAt: null,
            travelMin: c.travelMin,
            allowance: transportAllowanceFor(c.travelMin),
            pay: Math.round(((shift.endMin - shift.startMin) / 60) * PAY_PER_HOUR * 100) / 100,
          })
        }
        return shaped(201, { offers: offers.filter((o) => o.shiftId === shift.id).map(toDto) })
      }

      // --- Borrowing ----------------------------------------------------------
      const requestId = rest[1]
      if (requestId === undefined) {
        if (method === 'GET') {
          if (!can(role, 'weekly_roster', 'view')) return forbidden()
          return { status: 200, body: { outgoing: borrows.filter((b) => b.toStoreId === storeId), incoming: borrows.filter((b) => b.fromStoreId === storeId) } }
        }
        if (method !== 'POST') return notFound()
        if (!can(role, 'shift_offers_send', 'edit')) return forbidden()
        const b = (body ?? {}) as { fromStoreId?: unknown; shiftIds?: unknown; note?: unknown }
        const shiftIds = Array.isArray(b.shiftIds) ? (b.shiftIds.filter((x) => typeof x === 'string') as string[]) : []
        const shifts = shiftIds.map(shiftOf)
        if (typeof b.fromStoreId !== 'string' || b.fromStoreId === storeId || ![...MOCK_STORES, ...MOCK_MAP_STORES].some((s) => s.id === b.fromStoreId)) {
          return fail('validation_failed', 'This borrow request cannot be made.', [{ path: 'body.fromStoreId', message: 'Pick another store to borrow from.' }])
        }
        if (shifts.length === 0 || shifts.some((s) => !s || s.storeId !== storeId)) {
          return fail('validation_failed', 'This borrow request cannot be made.', [{ path: 'body.shiftIds', message: 'Pick an open shift of this store.' }])
        }
        if (borrows.some((r) => r.status === 'pending' && r.shiftIds.some((id) => shiftIds.includes(id)))) return fail('conflict', 'One of these shifts already has a pending borrow request.')
        for (const s of shifts) if (s) known.set(s.id, s)
        const first = shifts[0] as MockOpenShift
        seq += 1
        const created: BorrowRequestDto = {
          id: `bor-${seq}`,
          fromStoreId: b.fromStoreId,
          fromStoreName: storeName(b.fromStoreId),
          toStoreId: storeId,
          toStoreName: storeName(storeId),
          departmentName: first.departmentName,
          date: first.date,
          windowStart: new Date(Date.parse(`${first.date}T00:00:00+08:00`) + first.startMin * 60_000).toISOString(),
          windowEnd: new Date(Date.parse(`${first.date}T00:00:00+08:00`) + first.endMin * 60_000).toISOString(),
          count: shiftIds.length,
          shiftIds,
          travelMin: 18,
          status: 'pending',
          note: typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null,
          requestedBy: userName,
          requestedAt: now().toISOString(),
          decidedBy: null,
          decidedAt: null,
          overrideReason: null,
          declineReason: null,
          cashiers: [],
        }
        borrows.unshift(created)
        return { status: 201, body: { request: created } }
      }
      const req = borrows.find((r) => r.id === requestId && r.fromStoreId === storeId)
      if (!req) return notFound()
      if (!can(role, 'staff_lending', 'edit')) return forbidden()
      if (rest[2] === 'candidates' && method === 'GET') return { status: 200, body: { requestId: req.id, candidates: req.status === 'pending' ? lenders(req) : [] } }
      if (rest[2] !== 'decision' || method !== 'POST') return notFound()
      if (req.status !== 'pending') return fail('conflict', `This request is already ${req.status}.`)
      const d = (body ?? {}) as { decision?: unknown; staffIds?: unknown; reason?: unknown }
      const reason = typeof d.reason === 'string' && d.reason.trim() ? d.reason.trim() : null
      const at = now().toISOString()
      const index = borrows.indexOf(req)
      if (d.decision === 'decline') {
        borrows[index] = { ...req, status: 'declined', decidedBy: userName, decidedAt: at, declineReason: reason }
        return { status: 200, body: { request: borrows[index] } }
      }
      if (d.decision !== 'approve') return fail('validation_failed', 'Some fields are missing or invalid.', [{ path: 'body.decision', message: 'Approve or decline.' }])
      const status = role === 'STM' ? 'approved' : 'overridden'
      if (status === 'overridden' && !reason) {
        return fail('validation_failed', 'Give a reason to approve instead of the lending store manager.', [{ path: 'body.reason', message: 'A reason is required to override the lending store manager.' }])
      }
      const picks = Array.isArray(d.staffIds) ? (d.staffIds.filter((x) => typeof x === 'string') as string[]) : []
      const pool = lenders(req)
      if (picks.length === 0 || picks.length > req.count || picks.some((id) => !pool.some((c) => c.staffId === id))) {
        return fail('validation_failed', 'Pick who goes.', [{ path: 'body.staffIds', message: `Pick 1 to ${req.count} cashiers.` }])
      }
      const cashiers = picks.map((staffId, i) => {
        const c = pool.find((x) => x.staffId === staffId) as LendCandidate
        const shiftId = req.shiftIds[i] ?? ''
        rosters.fill(
          shiftId,
          { id: c.staffId, employeeNo: c.employeeNo, name: c.name, contract: 'FT', departmentId: '', trainedDepartmentIds: [], borrowedFrom: req.fromStoreName, borrowedTravelMin: req.travelMin },
          'borrow_fill',
          userName,
          status === 'overridden' ? reason : null,
        )
        return { staffId: c.staffId, employeeNo: c.employeeNo, name: c.name, shiftId }
      })
      offers = offers.map((o) => (cashiers.some((c) => c.shiftId === o.shiftId) && o.status === 'sent' ? { ...o, status: 'withdrawn', respondedAt: at } : o))
      borrows[index] = { ...req, status, decidedBy: userName, decidedAt: at, overrideReason: status === 'overridden' ? reason : null, cashiers }
      return { status: 200, body: { request: borrows[index] } }
    },
  }
}
