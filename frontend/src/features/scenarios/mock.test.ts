import { describe, expect, it } from 'vitest'
import type { RoleCode } from '@lanewise/shared'
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
    expect(stale.map((s) => s.name)).toEqual(['Christmas 2026 v4'])
    expect(await c.list({ q: 'ber' })).toHaveLength(1)
  })

  it('gives a Store Manager the published scenario only, with network cost removed', async () => {
    const c = clientFor('STM')
    const list = await c.list()
    expect(list.map((s) => s.status)).toEqual(['published'])
    const d = await c.get(list[0]!.id)
    expect(d.latestRun?.results?.cost).toBeUndefined()
    const stores = d.latestRun!.results!.stores
    expect(stores.find((s) => s.storeId === 'store-smsm-qc')?.cost).toBeGreaterThan(0)
    expect(stores.find((s) => s.storeId === 'st-cebu')?.cost).toBeUndefined()
  })

  it('edits, runs and submits a draft; rejects edits to non-drafts (P4)', async () => {
    const c = clientFor('PLN')
    const v4 = await c.get('scn-xmas-2026-v4')
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
    const v4 = await c.get('scn-xmas-2026-v4')
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
    const cmp = await c.compare('scn-xmas-2026-v3', 'scn-xmas-2026-v4')
    expect(cmp.settings.map((s) => s.key)).toContain('growth')
    expect(cmp.results.headcount.delta).toBeGreaterThan(0)
    expect(cmp.results.cost?.delta).toBeGreaterThan(0)
  })
})
