import { describe, expect, it, vi } from 'vitest'
import { ACTIVE_ROLE_HEADER, createApiClient, type ApiAdapter } from '@/api'
import { RulesApiError, createRulesClient } from './api'

function clientWith(adapter: ApiAdapter) {
  return createRulesClient(createApiClient({ adapter, getActiveRole: () => 'FIN', getAuthToken: async () => 'id-token' }))
}

describe('createRulesClient', () => {
  it('sends the active role, the ID token and a JSON body to the rules routes', async () => {
    const adapter = vi.fn<ApiAdapter>(async () => ({ status: 200, body: { version: { id: 'v2' } } }))
    await clientWith(adapter).requestChanges('v/2', 'Cite the wage order')
    expect(adapter).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/rule-versions/v%2F2/request-changes',
        body: { comment: 'Cite the wage order' },
        headers: expect.objectContaining({ [ACTIVE_ROLE_HEADER]: 'FIN', Authorization: 'Bearer id-token' }),
      }),
    )
  })

  it('raises the server error code, field details and reference id', async () => {
    const adapter: ApiAdapter = async () => ({
      status: 422,
      body: {
        error: {
          code: 'validation_failed',
          message: 'Some rule values are missing or invalid.',
          requestId: 'req-1',
          details: [{ path: 'body.payload.employerLoading', message: 'Must be at most 1.' }],
        },
      },
    })
    const error = await clientWith(adapter).saveDraft('v2', { payload: {} }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RulesApiError)
    expect(error).toMatchObject({ status: 422, code: 'validation_failed', requestId: 'req-1' })
    expect((error as RulesApiError).details).toHaveLength(1)
  })

  it('treats a non-JSON failure as an internal error', async () => {
    const adapter: ApiAdapter = async () => ({ status: 502, body: null })
    await expect(clientWith(adapter).listRuleSets()).rejects.toMatchObject({ status: 502, code: 'internal_error' })
  })
})
