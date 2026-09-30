import { describe, expect, it, vi } from 'vitest'
import { RulesApiError, createHttpRulesClient } from './api'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('createHttpRulesClient', () => {
  it('sends the ID token and a JSON body to the rules routes', async () => {
    const fetchImpl = vi.fn(async () => json(200, { version: { id: 'v2' } }))
    const client = createHttpRulesClient({
      baseUrl: 'https://api.example.com/prod/',
      getToken: async () => 'id-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await client.requestChanges('v/2', 'Cite the wage order')
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.com/prod/rule-versions/v%2F2/request-changes', {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: 'id-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Cite the wage order' }),
    })
  })

  it('raises the server error code, field details and reference id', async () => {
    const fetchImpl = vi.fn(async () =>
      json(422, {
        error: {
          code: 'validation_failed',
          message: 'Some rule values are missing or invalid.',
          requestId: 'req-1',
          details: [{ path: 'body.payload.employerLoading', message: 'Must be at most 1.' }],
        },
      }),
    )
    const client = createHttpRulesClient({ baseUrl: 'https://api.example.com', getToken: async () => null, fetchImpl: fetchImpl as unknown as typeof fetch })
    const error = await client.saveDraft('v2', { payload: {} }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RulesApiError)
    expect(error).toMatchObject({ status: 422, code: 'validation_failed', requestId: 'req-1' })
    expect((error as RulesApiError).details).toHaveLength(1)
  })

  it('treats a non-JSON failure as an internal error', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad gateway', { status: 502 }))
    const client = createHttpRulesClient({ baseUrl: 'https://api.example.com', getToken: async () => null, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.listRuleSets()).rejects.toMatchObject({ status: 502, code: 'internal_error' })
  })
})
