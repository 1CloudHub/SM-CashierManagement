import { describe, expect, it } from 'vitest'
import { FULL_AVAILABILITY, type RoleCode } from '@lanewise/shared'
import { ApiError, createApiClient, createMockAdapter, type ApiAdapter } from '@/api'
import { createMasterDataClient, staffQueryString } from './api'

function clients(adapter: ApiAdapter = createMockAdapter()) {
  return (role: RoleCode) => createMasterDataClient(createApiClient({ adapter, getActiveRole: () => role }))
}

const code = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof ApiError ? e.status : 'other'))

describe('mock /stores, /departments, /staff (SCR-052/053)', () => {
  it('scopes stores and staff like the API', async () => {
    const as = clients()
    expect((await as('RST').listStores()).stores.length).toBe(8)
    expect((await as('STM').listStores()).stores.map((s) => s.id)).toEqual(['st-qc'])
    expect(await code(as('FIN').listStores())).toBe(403)
    expect(new Set((await as('STM').listStaff()).staff.map((s) => s.storeId))).toEqual(new Set(['st-qc']))
    expect(await code(as('EXE').listStaff())).toBe(403)
    // Out of scope answers like missing.
    expect(await code(as('STM').updateStaff('st-moa-ft51', { active: false }))).toBe(404)
    expect(await code(as('STM').updateStaff('nope', { active: false }))).toBe(404)
  })

  it('follows the RBAC rows for edits', async () => {
    const as = clients()
    expect(await code(as('EXE').updateStore('st-qc', { name: 'X' }))).toBe(403)
    expect((await as('RST').updateDepartment('st-qc-d1', { installedLanes: 31 })).installedLanes).toBe(31)
    expect(await code(as('RST').updateDepartment('st-qc-d1', { tradingHours: { open: '22:00', close: '09:00' } }))).toBe(422)
    expect(await code(as('STM').createStaff({ storeId: 'st-qc', departmentId: 'st-qc-d1', employeeNo: 'X-1', name: 'N', type: 'part_time' }))).toBe(403)
    expect(await code(as('PLN').updateStaff('st-qc-ft03', { active: false }))).toBe(403)
    const grid = await as('PLN').setAvailability('st-qc-ft03', { ...FULL_AVAILABILITY, sun: [] })
    expect(grid.availability.sun).toEqual([])
    expect(await code(as('RST').setAvailability('st-qc-ft03', FULL_AVAILABILITY))).toBe(403)
    const added = await as('STM').addUnavailableDate('st-qc-ft03', { date: '2026-12-31' })
    const entry = added.unavailableDates.find((d) => d.date === '2026-12-31')!
    expect(await code(as('STM').addUnavailableDate('st-qc-ft03', { date: '2026-12-31' }))).toBe(409)
    expect((await as('STM').removeUnavailableDate('st-qc-ft03', entry.id)).unavailableDates).toEqual([])
  })

  it('builds the staff query string from set filters only', () => {
    expect(staffQueryString()).toBe('')
    expect(staffQueryString({ storeId: 's1', type: 'float', q: '  ana ' })).toBe('?storeId=s1&type=float&q=ana')
  })
})
