import { describe, expect, it } from 'vitest'
import { FULL_AVAILABILITY, type StoreWithDepartments } from '@lanewise/shared'
import { filterStores, sameAvailability, summarizeAvailability, toggleWindow } from './logic'

const store = (id: string, name: string, departments: string[]): StoreWithDepartments => ({
  id,
  code: id,
  name,
  format: 'savemore',
  regionId: 'r1',
  regionName: 'Luzon',
  active: true,
  synthetic: true,
  departments: departments.map((d, i) => ({
    id: `${id}-${i}`,
    storeId: id,
    name: d,
    installedLanes: 4,
    defaultHandleTimeMin: 2,
    tradingHours: { open: '09:00', close: '21:00' },
    active: true,
    synthetic: true,
  })),
})

describe('master data logic', () => {
  it('filters stores by store name or by department, keeping only matching departments', () => {
    const stores = [store('a', 'SaveMore Las Piñas', ['Main', 'Express']), store('b', 'SaveMore Iloilo', ['Main'])]
    expect(filterStores(stores, { q: 'iloilo', regionId: '', format: '' }).map((s) => s.id)).toEqual(['b'])
    const byDept = filterStores(stores, { q: 'express', regionId: '', format: '' })
    expect(byDept.map((s) => [s.id, s.departments.map((d) => d.name)])).toEqual([['a', ['Express']]])
    expect(filterStores(stores, { q: '', regionId: 'r2', format: '' })).toEqual([])
  })

  it('summarises and toggles the weekly grid', () => {
    expect(summarizeAvailability(FULL_AVAILABILITY)).toEqual({ kind: 'any' })
    const less = toggleWindow(FULL_AVAILABILITY, 'mon', 'morning')
    expect(less.mon).toEqual(['afternoon', 'evening'])
    expect(summarizeAvailability(less)).toMatchObject({ kind: 'partial', windows: 20, total: 21 })
    expect(toggleWindow(less, 'mon', 'morning').mon).toEqual(['morning', 'afternoon', 'evening'])
    expect(sameAvailability(less, FULL_AVAILABILITY)).toBe(false)
  })
})
