import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FineLocationError, type RoleCode } from '@lanewise/shared'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { createApiClient, createMockAdapter, type ApiRequest } from '@/api'
import { renderData } from '@/test/data'
import { createOffersClient, type OffersClient } from '@/features/offers'
import { networkMapApiFromClient, networkMapSearch, type NetworkMapApi } from './api'
import { manilaToday } from './format'
import { ringRadiusKm, staffByCity } from './geo'
import { loadMapConfig, mapStyleUrl, parseMapConfig } from './map-config'
import { NetworkMapScreen } from './network-map-screen'

const DATE = '2026-12-19'

function mockApi(role: RoleCode, log: ApiRequest[] = []): NetworkMapApi {
  const client = createApiClient({ adapter: createMockAdapter({ log }), getActiveRole: () => role })
  return networkMapApiFromClient(client)
}

function renderMap(role: RoleCode = 'PLN', options: { api?: NetworkMapApi; locale?: 'en' | 'fil'; log?: ApiRequest[]; offers?: OffersClient } = {}) {
  return renderData(
    <NetworkMapScreen
      api={options.api ?? mockApi(role, options.log)}
      role={role}
      mapConfig={null}
      initialDate={DATE}
      {...(options.offers ? { offers: options.offers } : {})}
    />,
    options.locale,
  )
}

const storesTable = () => screen.findByRole('table', { name: 'Stores by staffing gap' })

describe('SCR-026 Network map', () => {
  it('shows a loading state, then the schematic map, the stores table and the home-area counts', async () => {
    renderMap()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    const table = await storesTable()
    expect(screen.getByTestId('schematic-map')).toBeInTheDocument()
    expect(screen.queryByTestId('maplibre-map')).toBeNull()
    // Status in words (not colour alone), short stores first.
    const rows = within(table).getAllByRole('row').slice(1)
    expect(within(rows[0]!).getByRole('rowheader')).toHaveTextContent('SM Megamall')
    expect(rows[0]).toHaveTextContent('Short 4')
    expect(within(table).getByRole('rowheader', { name: 'SM Aura' }).closest('tr')).toHaveTextContent('Spare 3')
    expect(within(table).getByRole('rowheader', { name: 'SM Makati' }).closest('tr')).toHaveTextContent('Balanced')
    // Pins are buttons named with their status.
    expect(screen.getByRole('button', { name: 'SM Megamall: Short 4. 26 needed, 22 rostered.' })).toBeInTheDocument()
    // Staff layer: counts per barangay only.
    const counts = screen.getByRole('table', { name: /home area|barangay/i })
    expect(within(counts).getByRole('rowheader', { name: 'Wack-Wack Greenhills' })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: /cashiers share their home area/ }).length).toBeGreaterThan(0)
    expect(screen.getByText('Rings: 15, 30 and 45 min')).toBeInTheDocument()
  })

  it('selecting a store shows ranked, pseudonymous candidates and near misses with reasons; without an offers client nothing is sent', async () => {
    const user = userEvent.setup()
    renderMap()
    await storesTable()
    await user.click(screen.getByRole('button', { name: 'Find cover at SM Megamall' }))
    const ranked = await screen.findByRole('table', { name: 'Candidates ranked by travel time' })
    const first = within(ranked).getAllByRole('row')[1]!
    expect(first).toHaveTextContent('XS-14 · SM Center Pasig')
    expect(first).toHaveTextContent('Brgy. Wack-Wack Greenhills, Mandaluyong')
    const nearMiss = screen.getByRole('table', { name: 'Cashiers within reach who can’t take this shift' })
    expect(nearMiss).toHaveTextContent('Not trained on this department')
    expect(screen.getByText('3 cashiers aren’t shown because they don’t share a home area.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SM Megamall: Short 4. 26 needed, 22 rostered.' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(ranked).getByRole('checkbox', { name: 'Select XS-14' }))
    expect(screen.getByRole('button', { name: 'Offer shift to 1 selected' })).toBeDisabled()
    expect(screen.getByRole('complementary', { name: 'Selected store' })).toHaveTextContent('Borrow from a nearby store')
  })

  it('task 17: offers the shift to the selected cashiers and requests a borrow from a nearby store', async () => {
    const user = userEvent.setup()
    const log: ApiRequest[] = []
    const adapter = createMockAdapter({ log })
    const client = createApiClient({ adapter, getActiveRole: () => 'PLN' })
    renderMap('PLN', { api: networkMapApiFromClient(client), offers: createOffersClient(client) })
    await storesTable()
    await user.click(screen.getByRole('button', { name: 'Find cover at SM Megamall' }))
    const ranked = await screen.findByRole('table', { name: 'Candidates ranked by travel time' })
    await user.click(within(ranked).getByRole('checkbox', { name: 'Select XS-14' }))
    await user.click(screen.getByRole('button', { name: 'Offer shift to 1 selected' }))
    const panel = screen.getByRole('complementary', { name: 'Selected store' })
    expect(await within(panel).findByText('Offers sent to 1 cashiers.')).toBeInTheDocument()
    const status = screen.getByRole('list', { name: 'Offers for this shift' })
    expect(status).toHaveTextContent(/XS-14 · waiting, 30 min left/)
    // Already offered: the checkbox is checked and locked.
    expect(within(ranked).getByRole('checkbox', { name: 'Select XS-14' })).toBeDisabled()
    await user.click(screen.getAllByRole('button', { name: 'Request 1' })[0]!)
    expect(await within(panel).findByText(/Borrow request sent to .*Its store manager decides\./)).toBeInTheDocument()
    expect(log.filter((r) => r.method === 'POST').map((r) => r.path.replace(/^\/stores\/[^/]+/, ''))).toEqual([
      expect.stringMatching(/^\/shifts\/[^/]+\/offers$/),
      '/borrow-requests',
    ])
  })

  it('selects a store from its pin with the keyboard', async () => {
    const user = userEvent.setup()
    renderMap()
    await storesTable()
    const pin = screen.getByRole('button', { name: /^SM Aura: Spare 3/ })
    pin.focus()
    await user.keyboard('{Enter}')
    expect(pin).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('No open shifts at this store in this window.')).toBeInTheDocument()
  })

  it('filters by store format', async () => {
    const user = userEvent.setup()
    renderMap()
    const table = await storesTable()
    expect(within(table).getByRole('rowheader', { name: 'SM Center Pasig' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'SaveMore' }))
    await waitFor(async () => expect(within(await storesTable()).queryByRole('rowheader', { name: 'SM Center Pasig' })).toBeNull())
    expect(within(await storesTable()).getByRole('rowheader', { name: 'SM Megamall' })).toBeInTheDocument()
  })

  it('P1: a Store Manager sees their own store only; Executives and HR get no auto-match', async () => {
    const { unmount } = renderMap('STM')
    const table = await storesTable()
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Auto-match all gaps' })).toBeInTheDocument()
    unmount()
    renderMap('EXE')
    await storesTable()
    expect(screen.queryByRole('button', { name: 'Auto-match all gaps' })).toBeNull()
  })

  it('auto-match: reviews suggestions with remove/restore, then sends the kept offers and borrow requests (task 17)', async () => {
    const user = userEvent.setup()
    const log: ApiRequest[] = []
    const adapter = createMockAdapter({ log })
    const api = networkMapApiFromClient(createApiClient({ adapter, getActiveRole: () => 'PLN' }))
    const offers = createOffersClient(createApiClient({ adapter, getActiveRole: () => 'PLN' }))
    renderMap('PLN', { api, offers })
    await storesTable()
    await user.click(screen.getByRole('button', { name: 'Auto-match all gaps' }))
    const dialog = await screen.findByRole('dialog', { name: 'Review suggested cover' })
    await within(dialog).findByRole('table', { name: 'Suggested offers' })
    expect(dialog).toHaveTextContent(/Suggested: \d+ offers and \d+ moves across \d+ stores cover \d+ of \d+ open shifts/)
    const send = within(dialog).getByRole('button', { name: /^Send \d+ offers and \d+ borrow requests$/ })
    const before = Number(/Send (\d+) offers/.exec(send.textContent ?? '')![1])
    const remove = within(dialog).getAllByRole('button', { name: /^Remove / })[0]!
    await user.click(remove)
    expect(remove).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByRole('button', { name: new RegExp(`^Send ${before - 1} offers`) })).toBeInTheDocument()
    await user.click(remove)
    await user.click(within(dialog).getByRole('button', { name: new RegExp(`^Send ${before} offers`) }))
    expect(await within(dialog).findByText(new RegExp(`^Sent ${before} offers and \\d+ borrow requests\\.$`))).toBeInTheDocument()
    const posts = log.filter((r) => r.method === 'POST')
    expect(posts.filter((r) => /\/shifts\/[^/]+\/offers$/.test(r.path))).toHaveLength(before)
    expect(posts.every((r) => /\/offers$|\/borrow-requests$/.test(r.path))).toBe(true)
  })

  it('shows an error with retry when the map fails to load', async () => {
    const user = userEvent.setup()
    const good = mockApi('PLN')
    const getMap = vi.fn().mockRejectedValueOnce(new Error('boom')).mockImplementation(good.getMap)
    renderMap('PLN', { api: { ...good, getMap } })
    expect(await screen.findByText('We couldn’t load the network map.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await storesTable()).toBeInTheDocument()
  })

  it('P15: renders no coordinates or addresses, only barangay/city', async () => {
    const user = userEvent.setup()
    renderMap()
    await storesTable()
    await user.click(screen.getByRole('button', { name: 'Find cover at SM Megamall' }))
    await screen.findByRole('table', { name: 'Candidates ranked by travel time' })
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/-?\d{1,3}\.\d{3,}/)
    expect(text).not.toMatch(/street|address/i)
  })

  it('has no automatic accessibility violations', async () => {
    const user = userEvent.setup()
    const { container } = renderMap()
    await storesTable()
    await user.click(screen.getByRole('button', { name: 'Find cover at SM Megamall' }))
    await screen.findByRole('table', { name: 'Candidates ranked by travel time' })
    expect(await axe(container)).toHaveNoViolations()
  })

  it('is translated into Filipino', async () => {
    renderMap('PLN', { locale: 'fil' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Mapa ng network — Metro Manila' })).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Mga store ayon sa kakulangan sa tauhan' })).toBeInTheDocument()
  })
})

describe('network map API port', () => {
  it('builds the query string the API validates', () => {
    expect(networkMapSearch({ date: DATE, dayPart: 'evening', mode: 'car', maxTravelMin: 45, department: 'express lanes', formats: ['savemore', 'sm_store'] })).toBe(
      'date=2026-12-19&dayPart=evening&mode=car&maxTravelMin=45&department=express+lanes&formats=savemore%2Csm_store',
    )
  })

  it('P15: rejects a response carrying anything finer than barangay', async () => {
    const client = createApiClient({
      adapter: async () => ({
        status: 200,
        body: { stores: [], staffLayer: [{ barangay: { code: '1', name: 'X', city: 'Y' }, count: 2, centroid: { lat: 14.5952, lon: 121.0521 } }] },
      }),
      getActiveRole: () => 'PLN',
    })
    await expect(networkMapApiFromClient(client).getMap({ date: DATE, dayPart: 'midday', mode: 'car', maxTravelMin: 30 })).rejects.toBeInstanceOf(FineLocationError)
  })
})

describe('map config', () => {
  const good = { region: 'ap-southeast-1', mapName: 'lanewise-prod-map', apiKey: 'v1.public.abc123DEF' }

  it('accepts a valid map config and builds the Amazon Location style URL', () => {
    expect(parseMapConfig(good)).toEqual(good)
    expect(mapStyleUrl(good)).toBe('https://maps.geo.ap-southeast-1.amazonaws.com/maps/v0/maps/lanewise-prod-map/style-descriptor?key=v1.public.abc123DEF')
    expect(parseMapConfig({ ...good, region: 'evil.com/x' })).toBeNull()
    expect(parseMapConfig({ ...good, apiKey: 'has space' })).toBeNull()
    expect(parseMapConfig(null)).toBeNull()
  })

  it('is never loaded in mock mode, and reads runtime-config.json otherwise', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ map: good }), { headers: { 'content-type': 'application/json' } }))
    expect(await loadMapConfig({ mock: true, fetch: fetchImpl })).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await loadMapConfig({ mock: false, fetch: fetchImpl, env: {} })).toEqual(good)
    const empty = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }))
    expect(await loadMapConfig({ mock: false, fetch: empty, env: {} })).toBeNull()
  })
})

describe('map geometry', () => {
  it('rolls barangay counts up to cities (coarser than barangay)', () => {
    const rows = staffByCity([
      { barangay: { code: '1', name: 'San Antonio', city: 'Pasig' }, count: 2 },
      { barangay: { code: '2', name: 'Kapitolyo', city: 'Pasig' }, count: 3 },
      { barangay: { code: '3', name: 'X', city: 'Atlantis' }, count: 1 },
    ])
    expect(rows).toEqual([
      { city: 'Atlantis', count: 1, anchor: null },
      { city: 'Pasig', count: 5, anchor: expect.objectContaining({ lat: expect.any(Number) }) },
    ])
  })

  it('sizes rings like the API’s straight-line estimate', () => {
    expect(ringRadiusKm(60, 'car')).toBeCloseTo(20 / 1.3)
    expect(ringRadiusKm(45, 'public_transport')).toBeCloseTo(((45 / 60) * 20) / 1.3 / 1.5)
  })

  it('knows today in Metro Manila', () => {
    expect(manilaToday(new Date('2026-12-18T17:30:00Z'))).toBe('2026-12-19')
  })
})
