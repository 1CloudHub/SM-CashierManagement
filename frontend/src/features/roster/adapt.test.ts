import { describe, expect, it } from 'vitest'
import type { RosterDetail } from '@lanewise/shared'
import { checkBreaches, dayRows, gridRows, rosterTotals, toRosterModel } from './adapt'

const detail: RosterDetail = {
  roster: {
    id: 'r', storeId: 's', storeName: 'S', departmentId: 'd1', departmentName: 'Main checkout lanes',
    periodStart: '2026-12-14', periodEnd: '2026-12-20', status: 'published', publishedAt: null, overrideCount: 1, synthetic: true,
  },
  departments: [{ id: 'd1', name: 'Main checkout lanes' }, { id: 'd2', name: 'express lanes' }],
  staff: [
    { id: 'a', employeeNo: 'FT-01', name: 'Isa', contract: 'FT', departmentId: 'd1', trainedDepartmentIds: ['d2'], borrowedFrom: null },
    { id: 'b', employeeNo: 'XS-14', name: 'Jo', contract: 'PT', departmentId: 'd1', trainedDepartmentIds: [], borrowedFrom: 'SM Megamall' },
  ],
  shifts: [
    { id: 's1', staffId: 'a', departmentId: 'd1', date: '2026-12-14', startMin: 540, endMin: 1080, activities: [{ kind: 'meal', startMin: 780, endMin: 840 }], status: 'scheduled', edited: { type: 'time_change', by: 'R. Lim', at: '2026-12-13T10:00:00Z' } },
    { id: 's2', staffId: 'b', departmentId: 'd1', date: '2026-12-15', startMin: 600, endMin: 840, activities: [], status: 'scheduled', edited: null },
    { id: 's3', staffId: 'a', departmentId: 'd1', date: '2026-12-16', startMin: 600, endMin: 840, activities: [], status: 'cancelled', edited: null },
    { id: 'o1', staffId: null, departmentId: 'd1', date: '2026-12-19', startMin: 960, endMin: 1320, activities: [], status: 'scheduled', edited: null },
  ],
  overrides: [],
  laborChecks: [],
  canOverride: true,
}

describe('roster DTO adapter', () => {
  const model = toRosterModel(detail)
  it('keys cashiers by staff code, pairs department letters, marks borrowed and ✎', () => {
    expect(model.cashiers.map((c) => [c.id, c.contract])).toEqual([['FT-01', 'fullTime'], ['XS-14', 'borrowed']])
    expect(model.departments.map((d) => d.letter)).toEqual(['M', 'E'])
    expect(model.staffIdOf('XS-14')).toBe('b')
    expect(model.shifts.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(model.shifts[0]?.edited).toEqual({ by: 'R. Lim', at: '2026-12-13T10:00:00Z' })
    expect(model.openShifts.map((o) => o.id)).toEqual(['o1'])
  })
  it('builds day rows, grid rows and totals without cost', () => {
    expect(dayRows(model, '2026-12-14').map((r) => r.shift?.id ?? r.absence)).toEqual(['s1', 'dayOff'])
    const days = ['2026-12-13', '2026-12-14']
    const rows = gridRows(model, days, { from: '2026-12-14', to: '2026-12-20' })
    expect(rows[0]?.cells['2026-12-13']).toBeUndefined()
    expect(rows[1]?.cells['2026-12-14']).toEqual({ kind: 'absence', absence: 'dayOff' })
    const week = ['2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18', '2026-12-19', '2026-12-20']
    expect(rosterTotals(model, week)).toEqual({ shifts: 2, paidHours: 12, openShifts: 1, borrowed: 1 })
  })
  it('lists blocks and new warnings once', () => {
    const b = { rule: 'MANDATORY_REST' as const, severity: 'block' as const, staffId: 'a', date: '2026-12-20', message: '' }
    expect(checkBreaches({ status: 'blocked', breaches: [b], blocking: [b] })).toEqual([b])
  })
})
