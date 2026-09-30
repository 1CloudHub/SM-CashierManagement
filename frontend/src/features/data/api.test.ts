import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError, codeForStatus, createDataApi, downloadFile, type FetchLike } from './api'

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function setup(response: Response | (() => Response) = json(200, {}), token: string | null = 'id-token') {
  const fetch = vi.fn<FetchLike>().mockImplementation(async () =>
    typeof response === 'function' ? response() : response.clone(),
  )
  const api = createDataApi({ baseUrl: 'https://api.example.com/', getToken: async () => token, fetch })
  return { api, fetch }
}

function call(fetch: ReturnType<typeof setup>['fetch'], i = 0) {
  const [url, init] = fetch.mock.calls[i]!
  return { url, init: init!, headers: init!.headers as Record<string, string> }
}

describe('createDataApi request shapes', () => {
  it('GET /datasets with the raw ID token as Authorization', async () => {
    const { api, fetch } = setup(json(200, { datasets: [], provenance: { sampleData: false, syntheticDatasetTypes: [] } }))
    const res = await api.listDatasets()
    expect(res.datasets).toEqual([])
    const { url, init, headers } = call(fetch)
    expect(url).toBe('https://api.example.com/datasets')
    expect(init.method).toBe('GET')
    expect(headers.Authorization).toBe('id-token')
    expect(init.body).toBeUndefined()
  })

  it('builds query strings for history and snapshots', async () => {
    const { api, fetch } = setup(json(200, { runs: [] }))
    await api.listIngestions({ datasetType: 'pos', limit: 20 })
    await api.listIngestions()
    await api.listSnapshots({ datasetType: 'master', current: true })
    expect(call(fetch, 0).url).toBe('https://api.example.com/ingestions?datasetType=pos&limit=20')
    expect(call(fetch, 1).url).toBe('https://api.example.com/ingestions')
    expect(call(fetch, 2).url).toBe('https://api.example.com/snapshots?datasetType=master&current=true')
  })

  it('sends JSON bodies for POST and PATCH routes', async () => {
    const { api, fetch } = setup(json(200, {}))
    await api.requestUploadUrl({ datasetType: 'pos', fileName: 'a.csv', contentType: 'text/csv', sizeBytes: 10 })
    await api.createIngestion({ datasetType: 'pos', fileKey: 'k', fileName: 'a.csv', synthetic: true, columnMapping: { date: 'Date' } })
    await api.loadIngestion('run/1', { confirmWarnings: true })
    await api.cancelIngestion('run-1')
    await api.updateSnapshot('snap-1', { synthetic: false })
    const calls = fetch.mock.calls.map(([url, init]) => [init!.method, url, init!.body])
    expect(calls).toEqual([
      ['POST', 'https://api.example.com/ingestions/uploads', JSON.stringify({ datasetType: 'pos', fileName: 'a.csv', contentType: 'text/csv', sizeBytes: 10 })],
      ['POST', 'https://api.example.com/ingestions', JSON.stringify({ datasetType: 'pos', fileKey: 'k', fileName: 'a.csv', synthetic: true, columnMapping: { date: 'Date' } })],
      ['POST', 'https://api.example.com/ingestions/run%2F1/load', JSON.stringify({ confirmWarnings: true })],
      ['POST', 'https://api.example.com/ingestions/run-1/cancel', undefined],
      ['PATCH', 'https://api.example.com/snapshots/snap-1', JSON.stringify({ synthetic: false })],
    ])
    expect(call(fetch, 0).headers['Content-Type']).toBe('application/json')
    expect(call(fetch, 3).headers['Content-Type']).toBeUndefined()
  })

  it('reads single runs, reports, provenance and the history export', async () => {
    const { api, fetch } = setup(json(200, { fileName: 'r.csv', contentType: 'text/csv', content: 'x' }))
    await api.getIngestion('run-1')
    await api.getReport('run-1')
    await api.getProvenance()
    await api.exportHistory()
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.com/ingestions/run-1',
      'https://api.example.com/ingestions/run-1/report',
      'https://api.example.com/datasets/provenance',
      'https://api.example.com/ingestions/export',
    ])
  })

  it('PUTs the file to the presigned URL with exactly the signed headers and no Authorization', async () => {
    const { api, fetch } = setup(new Response(null, { status: 200 }))
    const file = new Blob(['a,b\n1,2\n'], { type: 'text/csv' })
    await api.uploadFile(
      { fileKey: 'k', uploadUrl: 'https://s3.example.com/k?sig=1', headers: { 'Content-Type': 'text/csv', 'x-amz-meta-a': '1' }, expiresAt: '' },
      file,
    )
    const { url, init, headers } = call(fetch)
    expect(url).toBe('https://s3.example.com/k?sig=1')
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(file)
    expect(headers).toEqual({ 'Content-Type': 'text/csv', 'x-amz-meta-a': '1' })
  })
})

describe('error parsing', () => {
  it('turns an ApiErrorBody into a typed ApiRequestError', async () => {
    const { api } = setup(json(409, { error: { code: 'conflict', message: 'Dataset changed', requestId: 'req-123' } }))
    const err = await api.loadIngestion('run-1', { confirmWarnings: false }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiRequestError)
    expect(err).toMatchObject({ code: 'conflict', status: 409, requestId: 'req-123', message: 'Dataset changed' })
  })

  it('falls back to the status when the body is not an ApiErrorBody', async () => {
    const { api } = setup(() => new Response('<html>Bad gateway</html>', { status: 503, headers: { 'x-request-id': 'gw-1' } }))
    await expect(api.listDatasets()).rejects.toMatchObject({ code: 'service_unavailable', status: 503, requestId: 'gw-1' })
  })

  it('reports a network failure as network_error', async () => {
    const fetch = vi.fn<FetchLike>().mockRejectedValue(new TypeError('Failed to fetch'))
    const api = createDataApi({ baseUrl: 'https://api.example.com', getToken: async () => 't', fetch })
    await expect(api.listDatasets()).rejects.toMatchObject({ code: 'network_error', status: 0 })
  })

  it('refuses to call the API without a token', async () => {
    const { api, fetch } = setup(json(200, {}), null)
    await expect(api.listDatasets()).rejects.toMatchObject({ code: 'unauthenticated', status: 401 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports a failed S3 PUT with the status code', async () => {
    const { api } = setup(new Response('denied', { status: 403 }))
    await expect(
      api.uploadFile({ fileKey: 'k', uploadUrl: 'https://s3.example.com/k', headers: {}, expiresAt: '' }, new Blob(['x'])),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 })
  })

  it('maps unknown statuses to a sensible code', () => {
    expect(codeForStatus(422)).toBe('validation_failed')
    expect(codeForStatus(418)).toBe('bad_request')
    expect(codeForStatus(502)).toBe('internal_error')
  })
})

describe('downloadFile', () => {
  it('saves the content via a Blob object URL with the file name', async () => {
    const createObjectURL = vi.fn(() => 'blob:report')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('report.csv')
      expect(this.getAttribute('href')).toBe('blob:report')
    })
    downloadFile({ fileName: 'report.csv', contentType: 'text/csv', content: 'a,b' })
    expect(click).toHaveBeenCalledTimes(1)
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0]
    expect(await blob.text()).toBe('a,b')
    expect(document.querySelector('a[download]')).toBeNull()
    await new Promise((r) => setTimeout(r, 0))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report')
    click.mockRestore()
  })
})
