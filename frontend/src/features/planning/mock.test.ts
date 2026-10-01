import { describe, expect, it } from 'vitest'
import { createApiClient, createMockAdapter } from '@/api'
import { createPlanningClient, queryString } from './api'

const client = (role: 'PLN' | 'STM' | 'STF' | 'RST') =>
  createPlanningClient(createApiClient({ adapter: createMockAdapter(), getActiveRole: () => role }))

describe('planning client + mock API', () => {
  it('builds query strings from set values only', () => {
    expect(queryString({ date: '2026-12-19', region: undefined, format: '' })).toBe('?date=2026-12-19')
    expect(queryString({})).toBe('')
  })

  it('P2: every department shows the same figures alone and in the network view', async () => {
    const c = client('PLN')
    for (const date of ['2026-12-05', '2026-12-19', '2026-12-24']) {
      const net = await c.network('scn-xmas-2026-v3', { date })
      for (const row of net.stores.flatMap((s) => s.departments)) {
        const single = await c.departmentDay('scn-xmas-2026-v3', row.departmentId, date)
        expect(single.figures).toEqual(row)
      }
    }
  })

  it('limits the network to the role’s scope (P1) and refuses roles without access', async () => {
    const stm = await client('STM').network('scn-xmas-2026-v3')
    expect(stm.stores.map((s) => s.storeId)).toEqual(['st-qc'])
    expect(stm.kpis.cost).toBeUndefined()
    await expect(client('STF').network('scn-xmas-2026-v3')).rejects.toMatchObject({ code: 'forbidden' })
    const rst = await client('RST').network('scn-xmas-2026-v3')
    expect(JSON.stringify(rst)).not.toMatch(/"cost"/)
  })

  it('runs a hiring-plan job that progresses to a plan, cached per scenario', async () => {
    const c = client('PLN')
    const first = await c.runHiringPlan('scn-xmas-2026-v4')
    expect(first.cached).toBe(false)
    expect((await c.runHiringPlan('scn-xmas-2026-v4')).cached).toBe(true)
    let job = first.job
    for (let i = 0; i < 5 && job.status !== 'succeeded'; i += 1) job = await c.hiringJob('scn-xmas-2026-v4', job.id)
    expect(job.status).toBe('succeeded')
    expect(job.unitsDone).toBe(job.unitsTotal)
    const view = await c.hiringPlan('scn-xmas-2026-v4')
    expect(view.plan?.kpis.seasonalHires).toBeGreaterThan(0)
  })

  it('exports carry the sample-data marker', async () => {
    const file = await client('PLN').exportNetwork('scn-xmas-2026-v3')
    expect(file.content.startsWith('SAMPLE DATA')).toBe(true)
    const summary = await client('PLN').exportSummary('scn-xmas-2026-v3', 'html')
    expect(summary.content).toContain('size: A4')
  })
})
