import { describe, expect, it } from 'vitest'
import type { BorrowRequestDto, MyOfferDto, RosterDetail, RoleCode, ShiftOfferDto } from '@lanewise/shared'
import { mockViewer } from './mock'
import { createOfferStore } from './mock-offers'
import { createRosterStore } from './mock-rosters'

const OPEN = 'open-qc-2026-12-19'
const ROSTER = '/stores/st-qc/rosters/ros-qc-main-2026-12-14'

function setup(start = Date.parse('2026-12-18T00:00:00Z')) {
  let t = start
  const rosters = createRosterStore()
  const offers = createOfferStore(rosters, () => new Date(t))
  const call = (role: RoleCode, method: string, path: string, body?: unknown) => {
    const [pathname = '', search = ''] = path.split('?', 2)
    return (
      offers.handle({ method, pathname, query: new URLSearchParams(search), body, role, viewer: mockViewer(role), userName: `Demo ${role}` }) ??
      rosters.handle({ method, pathname, body, role, userName: `Demo ${role}` })
    )
  }
  return { call, advance: (min: number) => (t += min * 60_000) }
}

describe('mock offers API (task 17)', () => {
  it('sends to eligible candidates, lets the cashier accept once and fills the roster shift (P17)', () => {
    const { call } = setup()
    expect(call('STM', 'GET', `/stores/st-qc/shifts/${OPEN}/offer-candidates?maxTravelMin=30`).status).toBe(200)
    expect(call('STM', 'POST', `/stores/st-qc/shifts/${OPEN}/offers`, { staffIds: ['nobody'] }).status).toBe(422)
    const sent = call('STM', 'POST', `/stores/st-qc/shifts/${OPEN}/offers`, { staffIds: ['st-qc-pt02', 'st-megamall-xs14'] })
    expect(sent.status).toBe(201)
    const list = (sent.body as { offers: ShiftOfferDto[] }).offers
    // The seeded broadcast (two live offers, one declined) plus the two just sent.
    expect(list.filter((o) => o.staffId === 'st-qc-pt02' || o.staffId === 'st-megamall-xs14').every((o) => o.status === 'sent')).toBe(true)
    // Pay is an individual cost figure (task 21): the Planner sees it; Staff can't list
    // store offers at all; other stores are a 404 for the Store Manager.
    const pln = (call('PLN', 'GET', '/stores/st-qc/offers').body as { offers: ShiftOfferDto[] }).offers
    expect(pln.every((o) => typeof o.pay === 'number' && o.pay > 0)).toBe(true)
    expect(call('STF', 'GET', '/stores/st-qc/offers').status).toBe(404)
    expect(call('STM', 'GET', `/stores/st-moa/shifts/${OPEN}/offer-candidates`).status).toBe(404)
    expect(call('PLN', 'GET', '/me/offers').status).toBe(403)

    // Juan's own offers: the seeded Megamall, North EDSA and MOA offers plus this one.
    const mine = (call('STF', 'GET', '/me/offers').body as { offers: MyOfferDto[] }).offers
    expect(mine.map((o) => o.status).sort()).toEqual(['accepted', 'expired', 'sent', 'sent'])
    const qc = mine.find((o) => o.status === 'sent' && o.storeName === 'SM Supermarket – Quezon City')!
    const accepted = call('STF', 'POST', `/me/offers/${qc.id}/accept`)
    expect(accepted.status).toBe(200)
    expect(call('STF', 'POST', `/me/offers/${qc.id}/accept`).status).toBe(409)
    const after = (call('STM', 'GET', `/stores/st-qc/offers?shiftId=${OPEN}`).body as { offers: ShiftOfferDto[] }).offers
    expect(after.map((o) => o.status).sort()).toEqual(['accepted', 'declined', 'withdrawn', 'withdrawn', 'withdrawn'])
    const detail = call('STM', 'GET', ROSTER).body as RosterDetail
    expect(detail.shifts.find((s) => s.id === OPEN)?.staffId).toBe('st-qc-pt02')
    expect(detail.overrides.at(-1)?.type).toBe('offer_fill')
  })

  it('expires offers after 30 minutes', () => {
    const { call, advance } = setup()
    call('STM', 'POST', `/stores/st-qc/shifts/${OPEN}/offers`, { staffIds: ['st-qc-pt02'] })
    advance(31)
    const mine = (call('STF', 'GET', '/me/offers').body as { offers: MyOfferDto[] }).offers
    const qc = mine.find((o) => o.storeName === 'SM Supermarket – Quezon City')
    expect(qc?.status).toBe('expired')
    expect(call('STF', 'POST', `/me/offers/${qc!.id}/accept`).status).toBe(409)
  })

  it('borrowing: the lending manager approves; a Planner overrides only with a reason; the cashier shows as borrowed', () => {
    const { call } = setup()
    const { incoming, outgoing } = call('STM', 'GET', '/stores/st-qc/borrow-requests').body as { incoming: BorrowRequestDto[]; outgoing: BorrowRequestDto[] }
    expect(incoming.map((r) => r.status)).toEqual(['pending'])
    expect(outgoing.map((r) => r.status)).toEqual(['declined'])
    const approved = call('STM', 'POST', `/stores/st-qc/borrow-requests/${incoming[0]!.id}/decision`, { decision: 'approve', staffIds: ['st-qc-ft03'] })
    expect((approved.body as { request: BorrowRequestDto }).request.status).toBe('approved')

    const created = call('STM', 'POST', '/stores/st-qc/borrow-requests', { fromStoreId: 'st-moa', shiftIds: [OPEN] })
    expect(created.status).toBe(201)
    const id = (created.body as { request: BorrowRequestDto }).request.id
    expect(call('STM', 'POST', `/stores/st-moa/borrow-requests/${id}/decision`, { decision: 'approve', staffIds: ['st-moa-ft51'] }).status).toBe(404)
    expect(call('PLN', 'POST', `/stores/st-moa/borrow-requests/${id}/decision`, { decision: 'approve', staffIds: ['st-moa-ft51'] }).status).toBe(422)
    const overridden = call('PLN', 'POST', `/stores/st-moa/borrow-requests/${id}/decision`, { decision: 'approve', staffIds: ['st-moa-ft51'], reason: 'MOA manager off' })
    expect((overridden.body as { request: BorrowRequestDto }).request).toMatchObject({ status: 'overridden', overrideReason: 'MOA manager off' })
    const detail = call('STM', 'GET', ROSTER).body as RosterDetail
    const borrowed = detail.staff.find((s) => s.id === 'st-moa-ft51')
    expect(borrowed).toMatchObject({ borrowedFrom: 'SM Hypermarket – Mall of Asia' })
    expect(borrowed?.borrowedTravelMin).toBeGreaterThan(0)
    expect(detail.overrides.at(-1)).toMatchObject({ type: 'borrow_fill', reason: 'MOA manager off' })
  })
})
