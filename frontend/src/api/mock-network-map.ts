/**
 * Mock network map (task 16.1, 16.4) for `VITE_API_MOCK` and tests: a small
 * Metro Manila network shaped like the SCR-026 wireframe. Synthetic only.
 *
 * It follows the API's rules so screens behave the same against it:
 *   - P1: a Store Manager sees their own store (Quezon City) only; roles
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
import {
  STM_STORE_ID,
  WEEKLY_LIMIT,
  WORLD_BARANGAYS,
  WORLD_STAFF,
  WORLD_STORES,
  barangayByCode,
  storeNameOf,
  storeTravelMinutes,
  travelMinutes,
  type WorldStaff,
  type WorldStore,
} from './mock-world'

/** The store a mock Store Manager is scoped to. */
export const MOCK_STM_STORE_ID = STM_STORE_ID

type MockStore = WorldStore
const STORES: readonly MockStore[] = WORLD_STORES

/** Barangays with at least one cashier sharing a home area there (the staff layer counts them). */
const BARANGAYS = WORLD_BARANGAYS.map((b) => ({
  code: b.code,
  name: b.name,
  city: b.city,
  count: WORLD_STAFF.filter((w) => w.active && w.homeArea === b.code).length,
})).filter((b) => b.count > 0)

const DEPARTMENTS = [
  { key: 'main checkout lanes', name: 'Main checkout lanes' },
  { key: 'express lanes', name: 'Express lanes' },
]

type Exclusion = 'NOT_TRAINED' | 'MANDATORY_REST' | 'WEEKLY_HOURS'

/** Cashiers who opted in to sharing a home area; everyone else is only counted (P15). */
const SHARING: readonly WorldStaff[] = WORLD_STAFF.filter((w) => w.active && w.homeArea !== null)
const WITHOUT_CONSENT = WORLD_STAFF.filter((w) => w.active && w.homeArea === null).length

function exclusionOf(w: WorldStaff, departmentKey: string): Exclusion | null {
  if (w.restBlocked) return 'MANDATORY_REST'
  if (w.weekHours + 4 > WEEKLY_LIMIT[w.contract]) return 'WEEKLY_HOURS'
  const suffix = departmentKey === 'express lanes' ? '-d2' : '-d1'
  return w.departmentId.endsWith(suffix) || w.trainedDepartmentIds.some((d) => d.endsWith(suffix)) ? null : 'NOT_TRAINED'
}

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

function ring(mode: MapTravelMode, minutes: number): 1 | 2 | 3 | null {
  const [a, b, c] = MAP_RING_MINUTES[mode]
  return minutes <= a ? 1 : minutes <= b ? 2 : minutes <= c ? 3 : null
}

function candidateBase(w: WorldStaff, storeId: string, mode: MapTravelMode) {
  const b = barangayByCode(w.homeArea ?? '')
  const travelMin = travelMinutes(w.homeArea ?? '', storeId, mode)
  return {
    staffId: w.id,
    displayId: w.employeeNo,
    homeStoreId: w.storeId,
    homeStoreName: storeNameOf(w.storeId),
    homeArea: { barangay: b?.name ?? '', city: b?.city ?? '' },
    travelMin,
    ringBand: ring(mode, travelMin),
  }
}

const departmentKeyOf = (query: NetworkMapQuery) => query.department ?? 'main checkout lanes'

function ranked(storeId: string, query: NetworkMapQuery): RankedMapCandidate[] {
  return SHARING.filter((w) => exclusionOf(w, departmentKeyOf(query)) === null && (w.crossStoreOffers || w.storeId === storeId))
    .map((w) => ({ w, c: candidateBase(w, storeId, query.mode) }))
    .filter(({ c }) => c.travelMin <= query.maxTravelMin)
    .sort((a, b) => a.c.travelMin - b.c.travelMin || (a.c.displayId < b.c.displayId ? -1 : 1))
    .map(({ w, c }, i) => {
      const withShift = w.weekHours + 4
      const limit = WEEKLY_LIMIT[w.contract]
      return {
        ...c,
        rank: i + 1,
        weeklyHours: { withShift, limit, headroom: limit - withShift },
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
  const store = STORES.find((s) => s.id === storeId)
  if (!store || !storesFor(role, { ...query, formats: undefined }).some((s) => s.id === storeId)) {
    return { ok: false, status: 404, message: 'We couldn’t find that store, or it isn’t in your scope.' }
  }
  const p = pin(store, query)
  const short = p.status === 'gap'
  const startHour = query.dayPart === 'early' ? 7 : query.dayPart === 'midday' ? 13 : 17
  const excluded = SHARING.map((w) => ({ w, reason: exclusionOf(w, departmentKeyOf(query)) }))
    .filter((x): x is { w: WorldStaff; reason: Exclusion } => x.reason !== null)
    .map(({ w, reason }) => ({ ...candidateBase(w, storeId, query.mode), reasons: [reason] }))
    .filter((c) => (c.travelMin ?? Infinity) <= query.maxTravelMin)
  const nearbySurplus = STORES.map((s) => ({ s, p: pin(s, query) }))
    .filter(({ s, p: other }) => s.id !== storeId && other.status === 'surplus' && role !== 'STM')
    .map(({ s, p: other }) => ({ storeId: s.id, name: s.name, surplus: other.delta, travelMin: storeTravelMinutes(s.id, storeId, query.mode) }))
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
      ranked: short ? ranked(storeId, query) : [],
      excluded: short ? excluded : [],
      excludedWithoutConsent: short ? WITHOUT_CONSENT : 0,
      nearbySurplus: short ? nearbySurplus : [],
    },
  }
}

export function mockAutoMatch(role: RoleCode, query: NetworkMapQuery): MockNetworkResult<AutoMatchResponse> {
  if (!ROLES_WITH_AUTO_MATCH.includes(role)) return { ok: false, status: 403, message: 'Only planners and store managers can propose offers.' }
  const stores = storesFor(role, query).map((s) => ({ s, p: pin(s, query) }))
  const short = stores.filter((x) => x.p.status === 'gap')
  const lenders = role === 'STM' ? [] : stores.filter((x) => x.p.status === 'surplus').map((x) => ({ ...x, left: x.p.delta }))
  const used = new Set<string>()
  const offers: AutoMatchResponse['offers'][number][] = []
  const moves: AutoMatchResponse['moves'][number][] = []
  const unfilled: AutoMatchResponse['unfilled'][number][] = []
  const startHour = query.dayPart === 'early' ? 7 : query.dayPart === 'midday' ? 13 : 17
  const departmentKey = query.department ?? 'main checkout lanes'
  for (const { s, p } of short) {
    for (let k = 0; k < p.openShifts; k++) {
      const shiftId = `open-${s.code.toLowerCase()}-${k + 1}`
      const cand = ranked(s.id, query).find((c) => !used.has(c.staffId))
      const lender = lenders.find((l) => l.left > 0)
      const moveMin = lender ? storeTravelMinutes(lender.s.id, s.id, query.mode) : Infinity
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
        excludedWithoutConsent: WITHOUT_CONSENT,
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
