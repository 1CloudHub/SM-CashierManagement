import { describe, expect, it } from 'vitest'
import type { NetworkStoreRow } from '@lanewise/shared'
import { departmentPath, networkQueryOf, pressureBand, rosterPath, sortStores, summaryPath } from './logic'

describe('planning logic', () => {
  it('maps the context bar view state to the network query (P8)', () => {
    expect(networkQueryOf({ scenario: 's', region: 'r', format: 'f', date: '2026-12-19', store: 'x', sort: 'pressure' })).toEqual({
      date: '2026-12-19',
      region: 'r',
      format: 'f',
    })
    expect(networkQueryOf({})).toEqual({})
  })

  it('bands pressure; over capacity always wins', () => {
    expect(pressureBand(40, false)).toBe('low')
    expect(pressureBand(60, false)).toBe('medium')
    expect(pressureBand(95, false)).toBe('high')
    expect(pressureBand(101, false)).toBe('over')
    expect(pressureBand(50, true)).toBe('over')
  })

  it('links keep the scenario and date', () => {
    expect(departmentPath({ scenario: 'scn' }, 'st', 'd', '2026-12-19')).toBe('/plan/department?scenario=scn&store=st&dept=d&date=2026-12-19')
    expect(rosterPath({ scenario: 'scn', store: 'st', dept: 'd', date: '2026-12-19' })).toBe('/plan/roster?scenario=scn&store=st&dept=d')
    expect(rosterPath({})).toBe('/plan/roster')
    expect(summaryPath('scn')).toBe('/plan/summary?scenario=scn')
    expect(summaryPath(null)).toBe('/plan/summary')
  })

  it('sorts stores and their departments by pressure or cashiers', () => {
    const dept = (id: string, cashiers: number, pct: number) =>
      ({ departmentId: id, cashiers, hours: [{ hour: 9, lanesNeeded: 1, lanesOpen: 1, pressurePct: pct, overCapacity: false }] }) as unknown as NetworkStoreRow['departments'][number]
    const store = (id: string, cashiers: number, depts: NetworkStoreRow['departments']) => ({ storeId: id, cashiers, departments: depts }) as unknown as NetworkStoreRow
    const stores = [store('a', 10, [dept('a1', 4, 50), dept('a2', 6, 120)]), store('b', 30, [dept('b1', 30, 80)])]
    expect(sortStores(stores, 'store').map((s) => s.storeId)).toEqual(['a', 'b'])
    expect(sortStores(stores, 'pressure').map((s) => s.storeId)).toEqual(['a', 'b'])
    expect(sortStores(stores, 'pressure')[0]?.departments.map((d) => d.departmentId)).toEqual(['a2', 'a1'])
    expect(sortStores(stores, 'cashiers').map((s) => s.storeId)).toEqual(['b', 'a'])
  })
})
