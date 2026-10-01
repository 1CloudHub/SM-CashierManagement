import { describe, expect, it } from 'vitest'
import { ROLE_CODES, type RoleCode } from '@lanewise/shared'
import { ApiError, createApiClient, createMockAdapter, type ApiAdapter } from '@/api'
import { createAdminClient } from './api'

function clients(adapter: ApiAdapter = createMockAdapter()) {
  return (role: RoleCode) => createAdminClient(createApiClient({ adapter, getActiveRole: () => role }))
}

describe('mock /admin and /audit-events', () => {
  it('serves users to the System Admin only', async () => {
    const as = clients()
    expect((await as('ADM').listUsers()).users.length).toBeGreaterThan(0)
    for (const role of ROLE_CODES.filter((r) => r !== 'ADM')) {
      await expect(as(role).listUsers()).rejects.toBeInstanceOf(ApiError)
    }
  })

  it('refuses non-allowlisted emails (P13) and records one event per change (P7)', async () => {
    const adm = clients()('ADM')
    const count = async () => (await adm.auditLog()).events.length
    const start = await count()
    await expect(adm.invite({ email: 'x@gmail.com', roles: ['PLN'], scope: { type: 'global' } })).rejects.toMatchObject({ code: 'validation_failed' })
    expect(await count()).toBe(start)
    const user = await adm.invite({ email: 'new@1cloudhub.com', roles: ['PLN'], scope: { type: 'global' } })
    expect(await count()).toBe(start + 1)
    await adm.update(user.id, { roles: ['PLN'] }) // no change → no event
    expect(await count()).toBe(start + 1)
    await adm.resend(user.id)
    await adm.deactivate(user.id)
    expect(await count()).toBe(start + 3)
    await expect(adm.deactivate(user.id)).rejects.toMatchObject({ code: 'conflict' })
    await adm.exportAuditLog()
    expect(await count()).toBe(start + 4)
  })

  it('limits the Rules Steward to data and rules events and refuses the export', async () => {
    const rst = clients()('RST')
    const log = await rst.auditLog()
    expect(log.categories).toEqual(['data', 'rules'])
    expect(log.events.every((e) => e.category === 'data' || e.category === 'rules')).toBe(true)
    await expect(rst.exportAuditLog()).rejects.toMatchObject({ code: 'forbidden' })
  })
})
