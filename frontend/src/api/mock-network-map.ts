/**
 * Mock network map (task 16.1, 16.4) for `VITE_API_MOCK` and tests: a small
 * Metro Manila network shaped like the SCR-026 wireframe. Synthetic only.
 *
 * It follows the API's rules so screens behave the same against it:
 *   - P1: a Store Manager sees their own store (SM Megamall) only; roles
 *     without the map get 403, and auto-match is Planner / Store Manager only.
 *   - P15: candidates are pseudonymous IDs with a barangay, never a name or
 *     anything finer; the staff layer is counts per barangay.
 *   - Store positions are approximate (demo), as on the wireframe.
 */
import {
  MAP_RING_MINUTES,
  staffingStatus,
  type AutoMatchResponse,
  type MapStorePin,
  type MapTravelMode,
  type NetworkMapQuery,
  type NetworkMapResponse,
  type RankedMapCandidate,
  type RoleCode,
  type StoreCandidatesResponse,
  type StoreFormat,
} from '@lanewise/shared'

/** The store a mock Store Manager is scoped to. */
export const MOCK_STM_STORE_ID = 'store-megamall'

interface MockStore {
  id: string
  code: string
  name: string
  city: string
  format: StoreFormat
  lat: number
  lon: number
  required: number
  rostered: number
}

const S = (id: string, code: string, name: string, city: string, format: StoreFormat, lat: number, lon: number, required: number, rostered: number): MockStore => ({
  id: `store-${id}`,
  code,
  name,
  city,
  format,
  lat,
  lon,
  required,
  rostered,
})

const STORES: readonly MockStore[] = [
  S('megamall', 'MEGA', 'SM Megamall', 'Mandaluyong', 'sm_supermarket', 14.585, 121.0565, 26, 22),
  S('north-edsa', 'NEDSA', 'SM City North EDSA', 'Quezon City', 'sm_hypermarket', 14.6566, 121.03, 24, 21),
  S('moa', 'MOA', 'SM Mall of Asia', 'Pasay', 'sm_supermarket', 14.5352, 120.9822, 22, 20),
  S('fairview', 'FAIR', 'SM City Fairview', 'Quezon City', 'sm_supermarket', 14.7346, 121.0596, 16, 14),
  S('aura', 'AURA', 'SM Aura', 'Taguig', 'sm_supermarket', 14.5455, 121.0546, 14, 17),
  S('center-pasig', 'PASIG', 'SM Center Pasig', 'Pasig', 'savemore', 14.5794, 121.0801, 10, 12),
  S('manila', 'MNL', 'SM City Manila', 'Manila', 'sm_store', 14.5903, 120.983, 18, 20),
  S('makati', 'MKT', 'SM Makati', 'Makati', 'sm_store', 14.5509, 121.0244, 12, 12),
  S('southmall', 'SOUTH', 'SM Southmall', 'Las Piñas', 'sm_hypermarket', 14.433, 121.0102, 15, 14),
  S('valenzuela', 'VAL', 'SM City Valenzuela', 'Valenzuela', 'savemore', 14.6955, 120.9663, 11, 10),
  S('araneta', 'ARA', 'SM City Araneta', 'Quezon City', 'sm_supermarket', 14.6206, 121.0529, 15, 16),
  S('marikina', 'MRK', 'SM City Marikina', 'Marikina', 'sm_hypermarket', 14.6266, 121.0849, 13, 14),
  S('bicutan', 'BIC', 'SM City Bicutan', 'Parañaque', 'savemore', 14.4869, 121.0447, 11, 10),
  S('san-lazaro', 'SLZ', 'SM City San Lazaro', 'Manila', 'savemore', 14.6155, 120.9849, 10, 9),
  S('sta-mesa', 'STM', 'SM City Sta. Mesa', 'Manila', 'sm_supermarket', 14.6039, 121.0177, 12, 12),
]

const BARANGAYS = [
  { code: '991401001', name: 'Wack-Wack Greenhills', city: 'Mandaluyong', count: 6 },
  { code: '991403002', name: 'San Antonio', city: 'Pasig', count: 5 },
  { code: '991403003', name: 'Kapitolyo', city: 'Pasig', count: 4 },
  { code: '991404004', name: 'Socorro', city: 'Quezon City', count: 7 },
  { code: '991404005', name: 'Bagong Pag-asa', city: 'Quezon City', count: 3 },
  { code: '991607006', name: 'Pinagsama', city: 'Taguig', count: 5 },
  { code: '991380007', name: 'Poblacion', city: 'Makati', count: 4 },
  { code: '991305008', name: 'Baclaran', city: 'Parañaque', count: 3 },
  { code: '991305009', name: 'Barangay 76', city: 'Pasay', count: 2 },
  { code: '991501010', name: 'Malinta', city: 'Valenzuela', count: 2 },
]

const DEPARTMENTS = [
  { key: 'main checkout lanes', name: 'Main checkout lanes' },
  { key: 'express lanes', name: 'Express lanes' },
]

interface MockCandidate {
  displayId: string
  homeStoreId: string
  barangay: number
  /** Travel by car (min) to every store, before the mode factor. */
  baseMin: number
  weekly: [number, number]
  exclude?: 'NOT_TRAINED' | 'MANDATORY_REST' | 'WEEKLY_HOURS'
}

const CANDIDATES: readonly MockCandidate[] = [
  { displayId: 'XS-14', homeStoreId: 'store-center-pasig', barangay: 0, baseMin: 8, weekly: [32, 48] },
  { displayId: 'PT-41', homeStoreId: 'store-center-pasig', barangay: 1, baseMin: 11, weekly: [18, 30] },
  { displayId: 'FL-07', homeStoreId: 'store-aura', barangay: 2, baseMin: 13, weekly: [24, 40] },
  { displayId: 'FT-88', homeStoreId: 'store-araneta', barangay: 3, baseMin: 18, weekly: [40, 48], exclude: 'MANDATORY_REST' },
  { displayId: 'PT-19', homeStoreId: 'store-aura', barangay: 5, baseMin: 19, weekly: [12, 30], exclude: 'NOT_TRAINED' },
  { displayId: 'FT-23', homeStoreId: 'store-makati', barangay: 6, baseMin: 14, weekly: [36, 48] },
  { displayId: 'PT-62', homeStoreId: 'store-north-edsa', barangay: 4, baseMin: 16, weekly: [28, 30], exclude: 'WEEKLY_HOURS' },
  { displayId: 'FT-51', homeStoreId: 'store-moa', barangay: 8, baseMin: 12, weekly: [30, 48] },
]

const ROLES_WITH_MAP: readonly RoleCode[] = ['EXE', 'PLN', 'STM', 'HR']
const ROLES_WITH_AUTO_MATCH: readonly RoleCode[] = ['PLN', 'STM']

export type MockNetworkResult<T> = { ok: true; body: T } | { ok: false; status: 403 | 404 | 422; message: string }

const forbidden = { ok: false, status: 403, message: 'Your role doesn’t include the network map.' } as const

function storesFor(role: RoleCode, query: NetworkMapQuery): MockStore[] {
  const scoped = role === 'STM' ? STORES.filter((s) => s.id === MOCK_STM_STORE_ID) : [...STORES]
  return query.formats && query.formats.length > 0 ? scoped.filter((s) => query.formats?.includes(s.format)) : scoped
}

function pin(s: MockStore, query: NetworkMapQuery): MapStorePin {
  // Express lanes are a smaller slice of the same picture.
  const scale = query.department === 'express lanes' ? 0.25 : 1
  const required = Math.round(s.required * scale)
  const rostered = Math.round(s.rostered * scale)
  const { status, delta } = staffingStatus(required, rostered)
  return {
    storeId: s.id,
    code: s.code,
    name: s.name,
    format: s.format,
    site: { lat: s.lat, lon: s.lon },
    required,
    rostered,
    delta,
    status,
    openShifts: Math.max(0, -delta),
  }
}

const travel = (base: number, mode: MapTravelMode, storeIndex: number) => Math.round((base + (storeIndex % 5) * 2) * (mode === 'car' ? 1 : 1.5))

function ring(mode: MapTravelMode, minutes: number): 1 | 2 | 3 | null {
  const [a, b, c] = MAP_RING_MINUTES[mode]
  return minutes <= a ? 1 : minutes <= b ? 2 : minutes <= c ? 3 : null
}

function candidateBase(c: MockCandidate, storeIndex: number, mode: MapTravelMode) {
  const b = BARANGAYS[c.barangay] ?? BARANGAYS[0]!
  const travelMin = travel(c.baseMin, mode, storeIndex)
  return {
    staffId: `staff-${c.displayId.toLowerCase()}`,
    displayId: c.displayId,
    homeStoreId: c.homeStoreId,
    homeStoreName: STORES.find((s) => s.id === c.homeStoreId)?.name ?? '',
    homeArea: { barangay: b.name, city: b.city },
    travelMin,
    ringBand: ring(mode, travelMin),
  }
}

function ranked(storeIndex: number, storeId: string, query: NetworkMapQuery): RankedMapCandidate[] {
  return CANDIDATES.filter((c) => !c.exclude)
    .map((c) => candidateBase(c, storeIndex, query.mode))
    .filter((c) => c.travelMin <= query.maxTravelMin)
    .sort((a, b) => a.travelMin - b.travelMin || (a.displayId < b.displayId ? -1 : 1))
    .map((c, i) => {
      const src = CANDIDATES.find((x) => x.displayId === c.displayId)!
      const withShift = src.weekly[0] + 4
      return {
        ...c,
        rank: i + 1,
        weeklyHours: { withShift, limit: src.weekly[1], headroom: src.weekly[1] - withShift },
        flags: c.homeStoreId === storeId ? [] : (['CROSS_STORE'] as const),
      }
    })
}

export function mockNetworkMap(role: RoleCode, query: NetworkMapQuery): MockNetworkResult<NetworkMapResponse> {
  if (!ROLES_WITH_MAP.includes(role)) return forbidden
  return {
    ok: true,
    body: {
      query,
      rings: [...MAP_RING_MINUTES[query.mode]],
      gapsSource: 'network_view',
      stores: storesFor(role, query).map((s) => pin(s, query)),
      staffLayer: BARANGAYS.map((b) => ({ barangay: { code: b.code, name: b.name, city: b.city }, count: b.count })),
      departments: DEPARTMENTS,
    },
  }
}

export function mockStoreCandidates(role: RoleCode, storeId: string, query: NetworkMapQuery): MockNetworkResult<StoreCandidatesResponse> {
  if (!ROLES_WITH_MAP.includes(role)) return forbidden
  const index = STORES.findIndex((s) => s.id === storeId)
  const store = STORES[index]
  if (!store || !storesFor(role, { ...query, formats: undefined }).some((s) => s.id === storeId)) {
    return { ok: false, status: 404, message: 'We couldn’t find that store, or it isn’t in your scope.' }
  }
  const p = pin(store, query)
  const short = p.status === 'gap'
  const startHour = query.dayPart === 'early' ? 7 : query.dayPart === 'midday' ? 13 : 17
  const excluded = CANDIDATES.filter((c) => c.exclude)
    .map((c) => ({ ...candidateBase(c, index, query.mode), reasons: [c.exclude!] }))
    .filter((c) => (c.travelMin ?? Infinity) <= query.maxTravelMin)
  const nearbySurplus = STORES.map((s, i) => ({ s, p: pin(s, query), i }))
    .filter(({ s, p: other }) => s.id !== storeId && other.status === 'surplus' && role !== 'STM')
    .map(({ s, p: other, i }) => ({ storeId: s.id, name: s.name, surplus: other.delta, travelMin: travel(10, query.mode, i + index) }))
    .filter((x) => x.travelMin <= query.maxTravelMin)
    .sort((a, b) => a.travelMin - b.travelMin)
  return {
    ok: true,
    body: {
      query,
      store: p,
      shift: short
        ? { shiftId: `open-${store.code.toLowerCase()}-1`, departmentKey: query.department ?? 'main checkout lanes', date: query.date, startHour, endHour: startHour + 4 }
        : null,
      travelSource: 'matrix',
      ranked: short ? ranked(index, storeId, query) : [],
      excluded: short ? excluded : [],
      excludedWithoutConsent: short ? 3 : 0,
      nearbySurplus: short ? nearbySurplus : [],
    },
  }
}

export function mockAutoMatch(role: RoleCode, query: NetworkMapQuery): MockNetworkResult<AutoMatchResponse> {
  if (!ROLES_WITH_AUTO_MATCH.includes(role)) return { ok: false, status: 403, message: 'Only planners and store managers can propose offers.' }
  const stores = storesFor(role, query).map((s) => ({ s, p: pin(s, query), i: STORES.indexOf(s) }))
  const short = stores.filter((x) => x.p.status === 'gap')
  const lenders = role === 'STM' ? [] : stores.filter((x) => x.p.status === 'surplus').map((x) => ({ ...x, left: x.p.delta }))
  const used = new Set<string>()
  const offers: AutoMatchResponse['offers'][number][] = []
  const moves: AutoMatchResponse['moves'][number][] = []
  const unfilled: AutoMatchResponse['unfilled'][number][] = []
  const startHour = query.dayPart === 'early' ? 7 : query.dayPart === 'midday' ? 13 : 17
  const departmentKey = query.department ?? 'main checkout lanes'
  for (const { s, p, i } of short) {
    for (let k = 0; k < p.openShifts; k++) {
      const shiftId = `open-${s.code.toLowerCase()}-${k + 1}`
      const cand = ranked(i, s.id, query).find((c) => !used.has(c.staffId))
      const lender = lenders.find((l) => l.left > 0)
      const moveMin = lender ? travel(10, query.mode, lender.i + i) : Infinity
      if (cand && cand.travelMin <= moveMin) {
        used.add(cand.staffId)
        offers.push({ shiftId, storeId: s.id, storeName: s.name, departmentKey, date: query.date, startHour, endHour: startHour + 4, travelMin: cand.travelMin, candidate: cand })
      } else if (lender && moveMin <= query.maxTravelMin) {
        lender.left -= 1
        const existing = moves.find((m) => m.fromStoreId === lender.s.id && m.toStoreId === s.id)
        if (existing) moves[moves.indexOf(existing)] = { ...existing, count: existing.count + 1, shiftIds: [...existing.shiftIds, shiftId] }
        else moves.push({ fromStoreId: lender.s.id, fromStoreName: lender.s.name, toStoreId: s.id, toStoreName: s.name, departmentKey, date: query.date, count: 1, travelMin: moveMin, shiftIds: [shiftId] })
      } else {
        unfilled.push({ shiftId, storeId: s.id, storeName: s.name, departmentKey })
      }
    }
  }
  const movedCashiers = moves.reduce((a, m) => a + m.count, 0)
  const covered = offers.length + movedCashiers
  const totalTravelMin = offers.reduce((a, o) => a + o.travelMin, 0) + moves.reduce((a, m) => a + m.travelMin * m.count, 0)
  const involved = new Set([...offers.map((o) => o.storeId), ...moves.flatMap((m) => [m.fromStoreId, m.toStoreId])])
  return {
    ok: true,
    body: {
      query,
      gapsSource: 'network_view',
      travelSource: 'matrix',
      offers,
      moves,
      unfilled,
      summary: {
        openShifts: covered + unfilled.length,
        covered,
        offers: offers.length,
        moves: moves.length,
        movedCashiers,
        storesInvolved: involved.size,
        totalTravelMin,
        averageTravelMin: covered === 0 ? 0 : Math.round((totalTravelMin / covered) * 10) / 10,
        excludedWithoutConsent: 3,
      },
    },
  }
}

/** The query the API would accept, or null (→ 422) — mirrors the route's validation. */
export function parseMockNetworkQuery(q: URLSearchParams): NetworkMapQuery | null {
  const date = q.get('date') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return null
  const dayPart = q.get('dayPart') ?? 'midday'
  const mode = q.get('mode') ?? 'public_transport'
  const maxTravelMin = Number(q.get('maxTravelMin') ?? '30')
  if (!['early', 'midday', 'evening'].includes(dayPart) || !['public_transport', 'car'].includes(mode)) return null
  if (!Number.isInteger(maxTravelMin) || maxTravelMin < 5 || maxTravelMin > 180) return null
  const formats = (q.get('formats') ?? '').split(',').filter((f) => f.length > 0)
  if (formats.some((f) => !['sm_supermarket', 'sm_hypermarket', 'savemore', 'sm_store'].includes(f))) return null
  const department = q.get('department')
  return {
    date,
    dayPart: dayPart as NetworkMapQuery['dayPart'],
    mode: mode as MapTravelMode,
    maxTravelMin,
    ...(department ? { department } : {}),
    ...(formats.length > 0 ? { formats: formats as StoreFormat[] } : {}),
  }
}
