import { describe, expect, it } from 'vitest'
import { DEFAULT_SCENARIO_SETTINGS, ENGINE_SETTING_DEFAULTS, type RoleCode } from '@lanewise/shared'
import { ApiError, createApiClient, createMockAdapter } from '@/api'
import { createScenariosClient } from './api'

function clientFor(role: RoleCode) {
  return createScenariosClient(createApiClient({ adapter: createMockAdapter(), getActiveRole: () => role }))
}

describe('mock /scenarios (task 11)', () => {
  it('lists seeded scenarios with ★ published and stale filters', async () => {
    const c = clientFor('PLN')
    const all = await c.list()
    expect(all.map((s) => s.name)).toContain('Christmas 2026 v3')
    expect(all.find((s) => s.isPublished)?.name).toBe('Christmas 2026 v3')
    const stale = await c.list({ stale: true })
    expect(stale.map((s) => s.name)).toEqual(['Christmas 2026 v5 (what-if)', '5-day FT rule test'])
    expect(await c.list({ q: 'ber' })).toHaveLength(1)
  })

  it('gives a Store Manager the published scenario only, with network cost removed', async () => {
    const c = clientFor('STM')
    const list = await c.list()
    expect(list.map((s) => s.status)).toEqual(['published'])
    const d = await c.get(list[0]!.id)
    expect(d.latestRun?.results?.cost).toBeUndefined()
    const stores = d.latestRun!.results!.stores
    expect(stores.find((s) => s.storeId === 'st-qc')?.cost).toBeGreaterThan(0)
    expect(stores.find((s) => s.storeId === 'st-moa')?.cost).toBeUndefined()
  })

  it('edits, runs and submits a draft; rejects edits to non-drafts (P4)', async () => {
    const c = clientFor('PLN')
    const v4 = await c.get('scn-xmas-2026-v5')
    expect(v4.editable).toBe(true)
    expect(v4.submitBlocker).toBe('stale')
    const ran = await c.run(v4.id)
    expect(ran.stale).toBe(false)
    expect(ran.submitBlocker).toBeNull()
    const edited = await c.update(v4.id, { settings: { ...ran.settings, growth: 1.1 } })
    expect(edited.staleReasons).toEqual(['settings_changed'])
    await c.run(v4.id)
    expect((await c.submit(v4.id)).status).toBe('submitted')
    await expect(c.update('scn-xmas-2026-v3', { settings: v4.settings })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('returns 422 details for invalid settings', async () => {
    const c = clientFor('PLN')
    const v4 = await c.get('scn-xmas-2026-v5')
    const err = await c.update(v4.id, { settings: { ...v4.settings, growth: 9 } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).details[0]?.path).toBe('body.settings.growth')
  })

  it('duplicates, refreshes and compares', async () => {
    const c = clientFor('PLN')
    const copy = await c.duplicate('scn-xmas-2026-v3')
    expect(copy.status).toBe('draft')
    expect(copy.parentScenarioId).toBe('scn-xmas-2026-v3')
    const fresh = await c.refresh('scn-xmas-2026-v3')
    expect(fresh.snapshots.every((s) => s.current)).toBe(true)
    const cmp = await c.compare('scn-xmas-2026-v3', 'scn-xmas-2026-v5')
    expect(cmp.settings.map((s) => s.key)).toContain('growth')
    expect(cmp.results.headcount.delta).toBeGreaterThan(0)
    expect(cmp.results.cost?.delta).toBeGreaterThan(0)
  })

  it('returns rule defaults, base hourly rate, departments, rule publish times and hires', async () => {
    const c = clientFor('PLN')
    const d = await c.get('scn-xmas-2026-v3')
    expect(d.defaults).toEqual(ENGINE_SETTING_DEFAULTS)
    expect(d.baseHourlyRate).toBeGreaterThan(0)
    expect(d.departments.length).toBeGreaterThan(3)
    expect(d.ruleVersions.every((r) => typeof r.publishedAt === 'string')).toBe(true)
    expect(d.rulesAsOf).toBe(d.ruleVersions.map((r) => r.publishedAt!).sort().at(-1))
    expect((await c.list()).every((s) => s.rulesAsOf !== null)).toBe(true)
    const r = d.latestRun!.results!
    expect(r.seasonalHires).toBe(r.stores.reduce((n, s) => n + (s.hires ?? 0), 0))
    expect(r.stores.every((s) => typeof s.hires === 'number')).toBe(true)
    if ((r.seasonalHires ?? 0) > 0) expect(r.firstNeededBy).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // Store Manager: no network cost (base rate hidden), own store's departments only.
    const stm = await clientFor('STM').get('scn-xmas-2026-v3')
    expect(stm.baseHourlyRate).toBeUndefined()
    expect(new Set(stm.departments.map((x) => x.storeId))).toEqual(new Set(['st-qc']))
  })

  it('validates and applies overrides; department issues carry the row and field (P4 outside Draft)', async () => {
    const c = clientFor('PLN')
    const copy = await c.duplicate('scn-xmas-2026-v3')
    const err = await c
      .update(copy.id, {
        settings: {
          ...copy.settings,
          departmentOverrides: [{ departmentId: 'st-qc-d1', baselineTxPerDay: null, handleTimeMin: 99, upliftPct: null }],
        },
      })
      .catch((e: unknown) => e)
    expect((err as ApiError).details.map((x) => x.path)).toEqual(['body.settings.departmentOverrides.0.handleTimeMin'])
    const base = (await c.run(copy.id)).latestRun!.results!
    await c.update(copy.id, { settings: { ...copy.settings, waitSeconds: 20, servedWithinPct: 95, ftShiftPattern: '7+1' } })
    const strict = (await c.run(copy.id)).latestRun!.results!
    expect(strict.headcount).toBeGreaterThanOrEqual(base.headcount)
    expect(strict.paidHours).not.toBe(base.paidHours)
    await expect(c.update('scn-xmas-2026-v3', { settings: { ...DEFAULT_SCENARIO_SETTINGS, waitSeconds: 30 } })).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('compares department overrides', async () => {
    const cmp = await clientFor('PLN').compare('scn-xmas-2026-v3', 'scn-xmas-2026-v4')
    expect(cmp.departmentSettings).toEqual([{ departmentId: 'st-qc-d1', field: 'handleTimeMin', from: null, to: 2.6 }])
    expect(cmp.results.seasonalHires.delta).not.toBeNull()
  })

  it('filters to the caller’s own scenarios with owner=me', async () => {
    const adapter = createMockAdapter()
    const pln = createApiClient({ adapter, getActiveRole: () => 'PLN' })
    const mine = await pln.request<{ scenarios: { ownerId: string }[] }>('GET', '/scenarios?owner=me')
    expect(mine.scenarios.length).toBeGreaterThan(0)
    expect(mine.scenarios.every((s) => s.ownerId === 'u-pln-ana')).toBe(true)
    const hr = createApiClient({ adapter, getActiveRole: () => 'HR' })
    expect((await hr.request<{ scenarios: unknown[] }>('GET', '/scenarios?owner=me')).scenarios).toEqual([])
    await expect(pln.request('GET', '/scenarios?owner=bob')).rejects.toMatchObject({ code: 'validation_failed' })
  })
})
