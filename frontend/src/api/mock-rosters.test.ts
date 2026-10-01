import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { RosterDetail, ShiftOverrideRequest, ShiftOverrideResponse } from '@lanewise/shared'
import { createRosterStore } from './mock-rosters'

const BASE = '/stores/st-qc/rosters/ros-qc-main-2026-12-14'
const STAFF = ['st-qc-ft01', 'st-qc-ft03', 'st-qc-ft07', 'st-qc-ft09', 'st-qc-pt02', 'st-qc-pt06', 'st-qc-fl01']

function call(store: ReturnType<typeof createRosterStore>, method: string, path: string, body?: unknown, role: 'STM' | 'PLN' | 'STF' = 'STM') {
  return store.handle({ method, pathname: path, body, role, userName: 'Demo STM' })
}

describe('mock roster API (task 13.4)', () => {
  it('reads by Weekly roster, writes by Store Manager only, scoped to the store', () => {
    const store = createRosterStore()
    expect(call(store, 'GET', '/stores/st-qc/rosters', undefined, 'PLN').status).toBe(200)
    expect((call(store, 'GET', BASE, undefined, 'PLN').body as RosterDetail).canOverride).toBe(false)
    expect((call(store, 'GET', BASE).body as RosterDetail).canOverride).toBe(true)
    expect(call(store, 'GET', '/stores/st-moa/rosters').status).toBe(404)
    expect(call(store, 'GET', BASE, undefined, 'STF').status).toBe(403)
    expect(call(store, 'POST', `${BASE}/overrides`, { type: 'remove', shiftId: 'st-qc-ft03-2026-12-14' }, 'PLN').status).toBe(403)
  })

  it('blocks a 7th consecutive day and asks a reason for short rest', () => {
    const store = createRosterStore()
    const seventh = { type: 'add', staffId: 'st-qc-ft01', departmentId: 'st-qc-d1', date: '2026-12-20', startMin: 540, endMin: 1080 }
    expect((call(store, 'POST', `${BASE}/overrides/check`, seventh).body as { check: { status: string } }).check.status).toBe('blocked')
    expect(call(store, 'POST', `${BASE}/overrides`, { ...seventh, reason: 'Peak' }).status).toBe(409)
    const late = { type: 'time_change', shiftId: 'st-qc-ft03-2026-12-14', date: '2026-12-14', startMin: 960, endMin: 1500 }
    expect(call(store, 'POST', `${BASE}/overrides`, late).status).toBe(422)
    const saved = call(store, 'POST', `${BASE}/overrides`, { ...late, reason: 'Stock count' })
    expect(saved.status).toBe(201)
    const body = saved.body as ShiftOverrideResponse
    expect(body.override).toMatchObject({ reason: 'Stock count', type: 'time_change' })
    expect(body.override.ruleBreaches.map((b) => b.rule)).toContain('MIN_REST')
    expect(body.roster.shifts.find((s) => s.id === 'st-qc-ft03-2026-12-14')?.edited?.type).toBe('time_change')
  })

  it('P14: every saved change is one override with a reason for any breach; blocks are never saved', () => {
    const changeArb: fc.Arbitrary<ShiftOverrideRequest> = fc.oneof(
      fc.record({
        type: fc.constant('reassign' as const),
        shiftId: fc.constantFrom('st-qc-ft03-2026-12-15', 'st-qc-ft07-2026-12-16', 'st-qc-fl01-2026-12-19'),
        toStaffId: fc.constantFrom(...STAFF),
      }),
      fc.record({
        type: fc.constant('add' as const),
        staffId: fc.option(fc.constantFrom(...STAFF), { nil: null }),
        departmentId: fc.constant('st-qc-d1'),
        date: fc.constantFrom('2026-12-14', '2026-12-17', '2026-12-20'),
        startMin: fc.constantFrom(360, 540, 900),
        endMin: fc.constantFrom(1200, 1320),
      }),
    ).chain((c) => fc.option(fc.constant('Peak cover'), { nil: undefined }).map((reason) => (reason ? { ...c, reason } : c)))
    fc.assert(
      fc.property(fc.array(changeArb, { maxLength: 8 }), (changes) => {
        const store = createRosterStore()
        // The seeded roster already carries the store manager's change to Juan's Sat shift.
        let count = (call(store, 'GET', BASE).body as RosterDetail).overrides.length
        for (const change of changes) {
          const res = call(store, 'POST', `${BASE}/overrides`, change)
          if (res.status === 201) {
            count += 1
            const { override } = res.body as ShiftOverrideResponse
            if (override.ruleBreaches.length > 0) expect(override.reason?.trim()).toBeTruthy()
            expect(override.ruleBreaches.every((b) => b.severity === 'warning')).toBe(true)
          }
          const detail = call(store, 'GET', BASE).body as RosterDetail
          expect(detail.overrides).toHaveLength(count)
          expect(detail.laborChecks.filter((b) => b.severity === 'block')).toEqual([])
        }
      }),
    )
  })
})
