import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVE_ROLE_HEADER, ApiError, createApiClient, type ApiAdapter, type ApiRequest } from '@/api'
import { renderApp, useLaptopViewport } from '@/test/app'
import { REAL, run } from '@/test/data'
import { ApiRequestError, dataApiFromClient } from './api'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

function dataAdapter(log: ApiRequest[]): ApiAdapter {
  return async (request) => {
    log.push(request)
    const path = request.path.split('?')[0]
    if (request.method === 'GET' && path === '/datasets') return { status: 200, body: { datasets: [], provenance: REAL } }
    if (request.method === 'GET' && path === '/ingestions') return { status: 200, body: { runs: [run()], provenance: REAL } }
    return { status: 404, body: { error: { code: 'not_found', message: 'Resource not found.', requestId: 'req-404' } } }
  }
}

describe('SCR-050 / SCR-051 in the app router (task 8.2)', () => {
  it('renders SCR-050 in the shell and calls the API with the active role', async () => {
    const log: ApiRequest[] = []
    renderApp({ path: '/data/sources', role: 'RST', adapter: dataAdapter(log) })
    expect(await screen.findByRole('heading', { level: 1, name: 'Data sources and ingestion' })).toBeInTheDocument()
    expect(document.title).toBe('Data sources — LaneWise')
    await waitFor(() => expect(log.map((r) => `${r.method} ${r.path.split('?')[0]}`)).toContain('GET /ingestions'))
    for (const request of log) expect(request.headers[ACTIVE_ROLE_HEADER]).toBe('RST')
  })

  it('"Upload file" opens SCR-051', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/data/sources', role: 'RST', adapter: dataAdapter([]) })
    await user.click(await screen.findByRole('button', { name: 'Upload file' }))
    expect(window.location.pathname).toBe('/data/upload')
  })

  it('SCR-051 is Rules Steward only (No access for a Planner)', () => {
    renderApp({ path: '/data/upload', role: 'PLN', adapter: dataAdapter([]) })
    expect(screen.getByRole('heading', { level: 1, name: /You do not have access/ })).toBeInTheDocument()
  })
})

describe('dataApiFromClient', () => {
  it('maps shared-client errors to ApiRequestError, and a rejected transport to network_error', async () => {
    const failing = createApiClient({
      adapter: async () => ({ status: 403, body: { error: { code: 'forbidden', message: 'No.', requestId: 'req-403' } } }),
      getActiveRole: () => 'PLN',
    })
    const denied = await dataApiFromClient(failing).listDatasets().catch((e: unknown) => e)
    expect(denied).toBeInstanceOf(ApiRequestError)
    expect(denied).toMatchObject({ code: 'forbidden', status: 403, requestId: 'req-403' })
    expect((denied as ApiRequestError).cause).toBeInstanceOf(ApiError)

    const offline = createApiClient({
      adapter: async () => {
        throw new TypeError('Failed to fetch')
      },
      getActiveRole: () => 'PLN',
    })
    await expect(dataApiFromClient(offline).getProvenance()).rejects.toMatchObject({ code: 'network_error', status: 0 })
  })

  it('sends query strings and bodies through the client', async () => {
    const log: ApiRequest[] = []
    const client = createApiClient({
      adapter: async (request) => {
        log.push(request)
        return { status: 200, body: {} }
      },
      getActiveRole: () => 'RST',
    })
    const api = dataApiFromClient(client)
    await api.listIngestions({ datasetType: 'pos', limit: 5 })
    await api.loadIngestion('run/1', { confirmWarnings: true })
    expect(log.map((r) => [r.method, r.path, r.body])).toEqual([
      ['GET', '/ingestions?datasetType=pos&limit=5', undefined],
      ['POST', '/ingestions/run%2F1/load', { confirmWarnings: true }],
    ])
  })
})
