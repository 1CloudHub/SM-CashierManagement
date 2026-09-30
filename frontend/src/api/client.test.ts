import { ROLE_CODES, costLevelsFor, type RoleCode } from '@lanewise/shared'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { ACTIVE_ROLE_HEADER, ApiError, createApiClient, fetchAdapter, type ApiRequest } from './client'
import { createMockAdapter, mockHome } from './mock'

const role = fc.constantFrom(...ROLE_CODES)

describe('API client', () => {
  it('property: every request carries the role active at request time (requirement 3.2, P12)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(role, { minLength: 1, maxLength: 6 }), async (roles) => {
        const log: ApiRequest[] = []
        let active: RoleCode = roles[0]
        const api = createApiClient({ adapter: createMockAdapter({ log }), getActiveRole: () => active })
        for (const r of roles) {
          active = r
          const home = await api.getHome()
          expect(home.role).toBe(r)
        }
        expect(log.map((req) => req.headers[ACTIVE_ROLE_HEADER])).toEqual(roles)
      }),
    )
  })

  it('sends the bearer token when signed in', async () => {
    const log: ApiRequest[] = []
    const api = createApiClient({
      adapter: createMockAdapter({ log }),
      getActiveRole: () => 'PLN',
      getAuthToken: async () => 'tok-123',
    })
    await api.getHealth()
    expect(log[0].headers.Authorization).toBe('Bearer tok-123')
  })

  it('surfaces the shared error model as ApiError (safe message + reference id)', async () => {
    const api = createApiClient({ adapter: createMockAdapter(), getActiveRole: () => 'PLN' })
    const err = await api.request('GET', '/nope').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 404, code: 'not_found' })
    expect((err as ApiError).requestId).toMatch(/^mock-/)
  })

  it('the mock rejects a request without a valid active role', async () => {
    const res = await createMockAdapter()({ method: 'GET', path: '/home', headers: { [ACTIVE_ROLE_HEADER]: 'ROOT' } })
    expect(res.status).toBe(400)
  })

  it('maps a non-JSON failure to a generic ApiError', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('boom', { status: 503 }))
    const api = createApiClient({ adapter: fetchAdapter('https://api.example.test/', fetchImpl), getActiveRole: () => 'FIN' })
    await expect(api.getHealth()).rejects.toMatchObject({ status: 503, code: 'service_unavailable' })
  })

  it('fetchAdapter joins the base URL and forwards method, headers and JSON body', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const api = createApiClient({ adapter: fetchAdapter('https://api.example.test/', fetchImpl), getActiveRole: () => 'HR' })
    await expect(api.request('POST', '/things', { body: { a: 1 } })).resolves.toEqual({ ok: true })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.example.test/things')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"a":1}')
    expect((init?.headers as Record<string, string>)[ACTIVE_ROLE_HEADER]).toBe('HR')
  })
})

describe('mock /home is shaped by the active role', () => {
  const COST_ROLES: readonly RoleCode[] = ['EXE', 'PLN', 'STM', 'HR', 'FIN']

  it('property: only cost roles receive ₱ figures; Staff gets only its own shifts (P11)', () => {
    fc.assert(
      fc.property(role, (r) => {
        const home = mockHome(r)
        expect(home.role).toBe(r)
        const hasCost =
          home.kpis?.seasonCost !== undefined ||
          home.costWatch?.publishedCost !== undefined ||
          home.costWatch?.draftCost !== undefined ||
          home.pendingApproval?.seasonCost !== undefined
        if (hasCost) expect(COST_ROLES).toContain(r)
        // Every ₱ figure on Home is network level: none for a Store Manager (25.1).
        if (!costLevelsFor(r).includes('network')) expect(JSON.stringify(home)).not.toMatch(/cost"\s*:/i)
        if (r === 'STF') {
          expect(Object.keys(home).sort()).toEqual(['firstName', 'nextShifts', 'role'])
        } else {
          expect(home.nextShifts).toBeUndefined()
        }
      }),
    )
  })
})
