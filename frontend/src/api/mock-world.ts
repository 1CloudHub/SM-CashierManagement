import type { IsoDate, StoreFormat } from '@lanewise/shared'

/**
 * The one seeded demo world behind every mock adapter (`VITE_API_MOCK`).
 *
 * Every per-feature mock store (planning, rosters, map, offers, master data,
 * scenarios, approvals, notifications, admin, data sources, rules) reads its
 * stores, departments, cashiers, people and scenarios from here, so the same
 * names, ids and numbers line up across screens — the cashier short on the
 * map is the one in the staff list, the roster and the offer. Values follow
 * the wireframe samples (.kiro/specs/cashier-staffing-planner/wireframes).
 *
 * Deterministic: no `Date.now()` or unseeded randomness. The demo "today" is
 * Oct 1, 2026 and the season being planned is Christmas 2026 (Dec 1–31).
 * Sample data — simulated, not SM actuals.
 */

/** The demo's "today" (Manila) and "now". */
export const DEMO_TODAY: IsoDate = '2026-10-01'
export const DEMO_NOW = '2026-10-01T10:00:00+08:00'

const LOADED_AT = Date.now()

/**
 * The clock for changes made while using the demo (not for seed data): the
 * real time, but never earlier than the seeded history, so a new audit event
 * or upload sorts above the seeded ones whatever the device clock says.
 */
export function demoNow(): Date {
  const real = Date.now()
  const floor = Date.parse(DEMO_NOW)
  return new Date(real >= floor ? real : floor + (real - LOADED_AT))
}

/** A small stable hash in [0, 1) for deterministic per-entity variation. */
export function worldHash(s: string): number {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0) / 2 ** 32
}

// ---------------------------------------------------------------------------
// Regions, stores and departments — eight Metro Manila stores, 24 departments
// ---------------------------------------------------------------------------

export const WORLD_REGIONS = [
  { id: 'reg-ncr-north', code: 'NCR-N', name: 'NCR North' },
  { id: 'reg-ncr-east', code: 'NCR-E', name: 'NCR East' },
  { id: 'reg-ncr-south', code: 'NCR-S', name: 'NCR South' },
] as const

export type WorldRegionId = (typeof WORLD_REGIONS)[number]['id']

export interface WorldStore {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly format: StoreFormat
  readonly regionId: WorldRegionId
  readonly city: string
  /** Approximate site (demo map positions). */
  readonly lat: number
  readonly lon: number
  /** Cashiers needed on lanes vs rostered, Sat Dec 19, 1–5 PM, main lanes (map gaps). */
  readonly required: number
  readonly rostered: number
  /** Workload scale vs a typical supermarket (planning curves). */
  readonly scale: number
}

export const WORLD_STORES: readonly WorldStore[] = [
  { id: 'st-qc', code: 'smsm-qc', name: 'SM Supermarket – Quezon City', format: 'sm_supermarket', regionId: 'reg-ncr-north', city: 'Quezon City', lat: 14.6537, lon: 121.0494, required: 18, rostered: 16, scale: 1 },
  { id: 'st-north-edsa', code: 'smhm-nedsa', name: 'SM Hypermarket – North EDSA', format: 'sm_hypermarket', regionId: 'reg-ncr-north', city: 'Quezon City', lat: 14.6566, lon: 121.03, required: 24, rostered: 21, scale: 1.35 },
  { id: 'st-megamall', code: 'smsm-mega', name: 'SM Supermarket – Megamall', format: 'sm_supermarket', regionId: 'reg-ncr-east', city: 'Mandaluyong', lat: 14.585, lon: 121.0565, required: 26, rostered: 22, scale: 1.3 },
  { id: 'st-pasig', code: 'smsv-pasig', name: 'SaveMore – Center Pasig', format: 'savemore', regionId: 'reg-ncr-east', city: 'Pasig', lat: 14.5794, lon: 121.0801, required: 10, rostered: 12, scale: 0.7 },
  { id: 'st-moa', code: 'smhm-moa', name: 'SM Hypermarket – Mall of Asia', format: 'sm_hypermarket', regionId: 'reg-ncr-south', city: 'Pasay', lat: 14.5352, lon: 120.9822, required: 22, rostered: 20, scale: 1.4 },
  { id: 'st-aura', code: 'smsm-aura', name: 'SM Supermarket – Aura', format: 'sm_supermarket', regionId: 'reg-ncr-south', city: 'Taguig', lat: 14.5455, lon: 121.0546, required: 14, rostered: 17, scale: 0.95 },
  { id: 'st-makati', code: 'smst-makati', name: 'The SM Store – Makati', format: 'sm_store', regionId: 'reg-ncr-south', city: 'Makati', lat: 14.5509, lon: 121.0244, required: 12, rostered: 12, scale: 0.8 },
  { id: 'st-lp', code: 'smsv-lp', name: 'SaveMore – Las Piñas', format: 'savemore', regionId: 'reg-ncr-south', city: 'Las Piñas', lat: 14.433, lon: 121.0102, required: 15, rostered: 14, scale: 0.75 },
]

export const DEPARTMENT_NAMES = ['Main checkout lanes', 'Express lanes', 'Customer service'] as const
export type WorldDepartmentName = (typeof DEPARTMENT_NAMES)[number]

export interface WorldDepartment {
  readonly id: string
  readonly storeId: string
  readonly name: WorldDepartmentName
  readonly installedLanes: number
  readonly handleTimeMin: number
}

const DEPT_SHAPE: Readonly<Record<WorldDepartmentName, { readonly lanes: number; readonly aht: number }>> = {
  'Main checkout lanes': { lanes: 30, aht: 2.5 },
  'Express lanes': { lanes: 11, aht: 1.2 },
  'Customer service': { lanes: 4, aht: 3 },
}

export const WORLD_DEPARTMENTS: readonly WorldDepartment[] = WORLD_STORES.flatMap((store) =>
  DEPARTMENT_NAMES.map((name, i) => ({
    id: `${store.id}-d${i + 1}`,
    storeId: store.id,
    name,
    // Main lanes scale with the store; Megamall's main lanes are the wireframe's over-capacity example.
    installedLanes: store.id === 'st-megamall' && i === 0 ? 24 : Math.max(2, Math.round(DEPT_SHAPE[name].lanes * (i === 0 ? Math.min(store.scale, 1.3) : 1))),
    handleTimeMin: DEPT_SHAPE[name].aht,
  })),
)

export const storeById = (id: string): WorldStore | undefined => WORLD_STORES.find((s) => s.id === id)
export const storeNameOf = (id: string): string => storeById(id)?.name ?? id
export const departmentById = (id: string): WorldDepartment | undefined => WORLD_DEPARTMENTS.find((d) => d.id === id)
export const regionNameOf = (id: string): string => WORLD_REGIONS.find((r) => r.id === id)?.name ?? ''

// ---------------------------------------------------------------------------
// Home areas — barangay level only (P15), approximate centroids for travel
// ---------------------------------------------------------------------------

export interface WorldBarangay {
  readonly code: string
  readonly name: string
  readonly city: string
  readonly lat: number
  readonly lon: number
}

export const WORLD_BARANGAYS: readonly WorldBarangay[] = [
  { code: '137404001', name: 'Bagong Pag-asa', city: 'Quezon City', lat: 14.6571, lon: 121.0374 },
  { code: '137404002', name: 'Socorro', city: 'Quezon City', lat: 14.6195, lon: 121.0532 },
  { code: '137404003', name: 'Commonwealth', city: 'Quezon City', lat: 14.6966, lon: 121.0886 },
  { code: '137404004', name: 'Batasan Hills', city: 'Quezon City', lat: 14.6823, lon: 121.0995 },
  { code: '137404005', name: 'Project 6', city: 'Quezon City', lat: 14.6614, lon: 121.0391 },
  { code: '137401001', name: 'Wack-Wack Greenhills', city: 'Mandaluyong', lat: 14.5937, lon: 121.0546 },
  { code: '137401002', name: 'Highway Hills', city: 'Mandaluyong', lat: 14.5828, lon: 121.0497 },
  { code: '137403001', name: 'San Antonio', city: 'Pasig', lat: 14.5826, lon: 121.0626 },
  { code: '137403002', name: 'Kapitolyo', city: 'Pasig', lat: 14.5718, lon: 121.0592 },
  { code: '137403003', name: 'Ugong', city: 'Pasig', lat: 14.5752, lon: 121.0757 },
  { code: '137605001', name: 'Barangay 76', city: 'Pasay', lat: 14.5378, lon: 120.9973 },
  { code: '137605002', name: 'Malibay', city: 'Pasay', lat: 14.5446, lon: 121.0037 },
  { code: '137607001', name: 'Pinagsama', city: 'Taguig', lat: 14.5331, lon: 121.0539 },
  { code: '137607002', name: 'Western Bicutan', city: 'Taguig', lat: 14.5106, lon: 121.0383 },
  { code: '137602001', name: 'Poblacion', city: 'Makati', lat: 14.5649, lon: 121.0309 },
  { code: '137602002', name: 'Guadalupe Nuevo', city: 'Makati', lat: 14.5626, lon: 121.0456 },
  { code: '137601001', name: 'Talon Dos', city: 'Las Piñas', lat: 14.4325, lon: 121.0111 },
  { code: '137601002', name: 'Pamplona Uno', city: 'Las Piñas', lat: 14.4587, lon: 120.9868 },
  { code: '137604001', name: 'Baclaran', city: 'Parañaque', lat: 14.5293, lon: 120.9972 },
]

export const barangayByCode = (code: string): WorldBarangay | undefined => WORLD_BARANGAYS.find((b) => b.code === code)

/** Road distance proxy (km) between two points. */
function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = (aLat - bLat) * 111
  const dLon = (aLon - bLon) * 107.6
  return Math.sqrt(dLat * dLat + dLon * dLon) * 1.3
}

/** Simulated travel time (min) from a barangay to a store: car/motorcycle, or public transport (×1.5). */
export function travelMinutes(barangayCode: string, storeId: string, mode: 'car' | 'public_transport' = 'public_transport'): number {
  const b = barangayByCode(barangayCode)
  const s = storeById(storeId)
  if (!b || !s) return 999
  const car = 5 + km(b.lat, b.lon, s.lat, s.lon) * 1.6
  return Math.round(mode === 'car' ? car : car * 1.5)
}

/** Simulated store-to-store travel (min) for lending moves. */
export function storeTravelMinutes(fromStoreId: string, toStoreId: string, mode: 'car' | 'public_transport' = 'public_transport'): number {
  const a = storeById(fromStoreId)
  const b = storeById(toStoreId)
  if (!a || !b) return 999
  const car = 6 + km(a.lat, a.lon, b.lat, b.lon) * 1.6
  return Math.round(mode === 'car' ? car : car * 1.5)
}

// ---------------------------------------------------------------------------
// Cashiers — 51 named staff across the eight stores
// ---------------------------------------------------------------------------

export type WorldContract = 'FT' | 'PT' | 'FLOAT'
export type WorldAvailability = 'any' | 'student' | 'evenings' | 'weekends' | 'no_sundays'

export interface WorldStaff {
  readonly id: string
  readonly employeeNo: string
  readonly name: string
  readonly contract: WorldContract
  readonly storeId: string
  readonly departmentId: string
  readonly trainedDepartmentIds: readonly string[]
  /** Barangay code when the cashier shares a home area (opt-in, P15); null when not shared. */
  readonly homeArea: string | null
  readonly maxTravelMin: number
  readonly crossStoreOffers: boolean
  readonly availability: WorldAvailability
  readonly preferredRestDay: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | null
  readonly unavailable: readonly { readonly date: IsoDate; readonly reason: string }[]
  /** Paid hours already booked in the week of Dec 14 (map / offer fit). */
  readonly weekHours: number
  /** On a 6th working day in a row on Sat Dec 19 (map exclusion). */
  readonly restBlocked?: boolean
  readonly active: boolean
}

export const WEEKLY_LIMIT: Readonly<Record<WorldContract, number>> = { FT: 48, PT: 30, FLOAT: 40 }

type StaffSeed = readonly [
  employeeNo: string,
  name: string,
  dept: 1 | 2 | 3,
  trained: readonly (1 | 2 | 3)[],
  homeArea: string | null,
  availability: WorldAvailability,
  weekHours: number,
]

const SEEDS: Readonly<Record<string, readonly StaffSeed[]>> = {
  'st-qc': [
    ['FT-01', 'Isa Palma', 1, [2], '137404005', 'any', 40],
    ['FT-03', 'Cora Fisco', 1, [3], '137404001', 'any', 40],
    ['FT-07', 'Ralph Edu', 1, [], '137404003', 'any', 48],
    ['FT-09', 'Dina Rusel', 1, [3], '137404004', 'any', 40],
    ['PT-02', 'Juan dela Cruz', 2, [1], '137404001', 'student', 12],
    ['PT-05', 'Guy Hapin', 2, [], '137404002', 'evenings', 20],
    ['PT-06', 'Arlene Mac', 1, [], null, 'no_sundays', 16],
    ['FL-01', 'Cam Wills', 1, [2, 3], '137404005', 'any', 32],
    ['FT-12', 'Marites Dizon', 3, [1], '137404004', 'any', 40],
    ['PT-14', 'Paolo Aquino', 2, [1], '137404003', 'student', 16],
  ],
  'st-north-edsa': [
    ['FT-21', 'Rodel Manalo', 1, [2], '137404001', 'any', 40],
    ['FT-22', 'Jenny Ocampo', 1, [], '137404005', 'any', 36],
    ['PT-62', 'Kristine Bernardo', 2, [1], '137404001', 'student', 28],
    ['PT-24', 'Mark Anthony Pascual', 2, [], null, 'weekends', 12],
    ['FL-25', 'Noel Castillo', 1, [2, 3], '137404003', 'any', 32],
    ['FT-26', 'Lorna Salazar', 3, [1], '137404004', 'any', 40],
    ['FT-88', 'Eric Lacson', 1, [], '137404002', 'any', 40],
  ],
  'st-megamall': [
    ['XS-14', 'Jo Tan', 1, [2], '137401001', 'any', 32],
    ['FT-31', 'Rowena Gatchalian', 1, [], '137401002', 'any', 40],
    ['FT-32', 'Jerome Santiago', 1, [2], '137403002', 'any', 40],
    ['PT-33', 'Camille Navarro', 2, [], '137401002', 'student', 16],
    ['PT-34', 'Jessa Mendoza', 2, [1], null, 'evenings', 20],
    ['FT-35', 'Ramil Dela Paz', 3, [1], '137401001', 'any', 40],
  ],
  'st-pasig': [
    ['PT-41', 'Rosa Lim', 1, [], '137403001', 'any', 18],
    ['FT-42', 'Edgar Soriano', 1, [2], '137403003', 'any', 40],
    ['FT-43', 'Michelle Tolentino', 1, [], '137403001', 'any', 36],
    ['PT-44', 'Angelica Reyes', 2, [1], '137403002', 'student', 12],
    ['FL-07', 'Nestor Ramos', 1, [2, 3], '137403002', 'any', 24],
    ['FT-45', 'Gina Valdez', 3, [], null, 'any', 40],
  ],
  'st-moa': [
    ['FT-51', 'Ben Cruz', 1, [2], '137605001', 'any', 30],
    ['FT-52', 'Liza Garcia', 1, [], '137605002', 'any', 40],
    ['PT-53', 'Ella Ramos', 2, [1], '137604001', 'student', 16],
    ['PT-54', 'Carlo Mercado', 2, [], '137605001', 'weekends', 12],
    ['FT-55', 'Aileen Domingo', 3, [1], null, 'any', 40],
    ['FL-56', 'Ronald Flores', 1, [2, 3], '137605002', 'any', 32],
  ],
  'st-aura': [
    ['PT-19', 'Fe Bautista', 2, [], '137607001', 'evenings', 12],
    ['FT-61', 'Dan Villanueva', 1, [2], '137607002', 'any', 40],
    ['FT-62', 'Sheila Cabrera', 1, [], '137607001', 'any', 36],
    ['PT-63', 'Kevin Aguilar', 2, [1], '137602002', 'student', 16],
    ['FT-64', 'Joy Panganiban', 3, [1], '137607002', 'any', 40],
    ['FL-65', 'Arnel Perez', 1, [2, 3], '137607001', 'any', 28],
  ],
  'st-makati': [
    ['FT-23', 'Nina Torres', 1, [2], '137602001', 'any', 36],
    ['FT-71', 'Oscar Lim', 1, [], '137602002', 'any', 40],
    ['PT-72', 'Pia Mendoza', 2, [1], '137602001', 'student', 12],
    ['PT-73', 'Bea Gonzales', 2, [], null, 'evenings', 16],
    ['FT-74', 'Jun Villareal', 3, [1], '137602002', 'any', 40],
  ],
  'st-lp': [
    ['FT-81', 'Mark Flores', 1, [2], '137601001', 'any', 40],
    ['FT-82', 'Teresa Ignacio', 1, [], '137601002', 'any', 36],
    ['PT-83', 'Ramon Bautista', 2, [1], '137601001', 'student', 12],
    ['PT-84', 'Hazel Rivera', 2, [], '137601002', 'weekends', 16],
    ['FL-85', 'Dante Espiritu', 1, [2, 3], null, 'any', 24],
  ],
}

const contractOf = (employeeNo: string): WorldContract => (employeeNo.startsWith('PT') ? 'PT' : employeeNo.startsWith('FL') ? 'FLOAT' : 'FT')
const REST_DAYS = ['mon', 'tue', 'wed', 'thu'] as const

/** Dated exceptions (exams, family events, a leaver) on top of the weekly patterns. */
const UNAVAILABLE: Readonly<Record<string, readonly { date: IsoDate; reason: string }[]>> = {
  'st-qc-pt02': [{ date: '2026-12-14', reason: 'Exam' }],
  'st-qc-pt06': [{ date: '2026-12-19', reason: 'Family event' }],
  'st-qc-pt14': [{ date: '2026-12-15', reason: 'Exam' }, { date: '2026-12-16', reason: 'Exam' }],
  'st-north-edsa-pt62': [{ date: '2026-12-21', reason: 'Exam' }],
  'st-megamall-pt33': [{ date: '2026-12-18', reason: 'Exam' }],
  'st-moa-pt53': [{ date: '2026-12-14', reason: 'Exam' }],
  'st-aura-pt63': [{ date: '2026-12-17', reason: 'Exam' }],
  'st-lp-ft82': [{ date: '2026-12-24', reason: 'Family event' }],
}

export const WORLD_STAFF: readonly WorldStaff[] = WORLD_STORES.flatMap((store) =>
  (SEEDS[store.id] ?? []).map(([employeeNo, name, dept, trained, homeArea, availability, weekHours], i): WorldStaff => {
    const contract = contractOf(employeeNo)
    const id = `${store.id}-${employeeNo.replace('-', '').toLowerCase()}`
    return {
      id,
      employeeNo,
      name,
      contract,
      storeId: store.id,
      departmentId: `${store.id}-d${dept}`,
      trainedDepartmentIds: trained.map((d) => `${store.id}-d${d}`),
      homeArea,
      maxTravelMin: contract === 'PT' ? 30 : 45,
      crossStoreOffers: homeArea !== null && i % 5 !== 3,
      availability,
      preferredRestDay: contract === 'FT' ? (REST_DAYS[i % REST_DAYS.length] ?? 'mon') : null,
      unavailable: UNAVAILABLE[id] ?? [],
      weekHours,
      ...(employeeNo === 'FT-88' ? { restBlocked: true } : {}),
      // One leaver keeps history but is no longer rostered.
      active: id !== 'st-north-edsa-pt24',
    }
  }),
)

export const staffById = (id: string): WorldStaff | undefined => WORLD_STAFF.find((s) => s.id === id)

/** The demo scopes: the Store Manager runs Quezon City; the Staff persona is Juan dela Cruz (PT-02) there. */
export const STM_STORE_ID = 'st-qc'
export const STF_STAFF_ID = 'st-qc-pt02'

// ---------------------------------------------------------------------------
// People — app users (HQ, store managers, a few staff accounts)
// ---------------------------------------------------------------------------

export interface WorldPerson {
  readonly id: string
  readonly name: string
  /** Short form used in trackers and the audit log (wireframes: "L. Tan"). */
  readonly short: string
  readonly email: string
}

export const PEOPLE = {
  admin: { id: 'u-adm-juan', name: 'Juan dela Cruz', short: 'Juan dela Cruz', email: 'juan@smretail.com' },
  planner: { id: 'u-pln-ana', name: 'Ana Reyes', short: 'Ana Reyes', email: 'ana@1cloudhub.com' },
  planner2: { id: 'u-pln-paolo', name: 'Paolo Navarro', short: 'P. Navarro', email: 'p.navarro@smretail.com' },
  hr: { id: 'u-hr-ltan', name: 'Liza Tan', short: 'L. Tan', email: 'l.tan@smretail.com' },
  finance: { id: 'u-fin-clim', name: 'Carmela Lim', short: 'C. Lim', email: 'c.lim@smretail.com' },
  executive: { id: 'u-exe-mcruz', name: 'Miguel Cruz', short: 'M. Cruz', email: 'm.cruz@smretail.com' },
  steward: { id: 'u-rst-rsantos', name: 'Rafael Santos', short: 'R. Santos', email: 'r.santos@smretail.com' },
  formerSteward: { id: 'u-rst-klim', name: 'Kevin Lim', short: 'K. Lim', email: 'k.lim@smretail.com' },
} as const satisfies Readonly<Record<string, WorldPerson>>

/** Store managers, one per store (Quezon City is the demo Store Manager's store). */
export const STORE_MANAGERS: readonly (WorldPerson & { readonly storeId: string })[] = [
  { id: 'u-stm-mbautista', name: 'Maricel Bautista', short: 'M. Bautista', email: 'm.bautista@smretail.com', storeId: 'st-qc' },
  { id: 'u-stm-rgomez', name: 'Ricardo Gomez', short: 'R. Gomez', email: 'r.gomez@smretail.com', storeId: 'st-north-edsa' },
  { id: 'u-stm-lsy', name: 'Lourdes Sy', short: 'L. Sy', email: 'l.sy@smretail.com', storeId: 'st-megamall' },
  { id: 'u-stm-jdelacruz', name: 'Joel de la Rosa', short: 'J. de la Rosa', email: 'j.delarosa@smretail.com', storeId: 'st-pasig' },
  { id: 'u-stm-avillanueva', name: 'Arlene Villanueva', short: 'A. Villanueva', email: 'a.villanueva@smretail.com', storeId: 'st-moa' },
  { id: 'u-stm-bcastro', name: 'Bernard Castro', short: 'B. Castro', email: 'b.castro@smretail.com', storeId: 'st-aura' },
  { id: 'u-stm-cmorales', name: 'Cristina Morales', short: 'C. Morales', email: 'c.morales@smretail.com', storeId: 'st-makati' },
  { id: 'u-stm-fpineda', name: 'Francis Pineda', short: 'F. Pineda', email: 'f.pineda@smretail.com', storeId: 'st-lp' },
]

export const managerOf = (storeId: string) => STORE_MANAGERS.find((m) => m.storeId === storeId)

// ---------------------------------------------------------------------------
// Scenarios — Christmas 2026 v1–v5, Ber months 2026, Christmas 2025
// ---------------------------------------------------------------------------

export const WORLD_SCENARIOS = [
  { id: 'scn-xmas-2026-v3', name: 'Christmas 2026 v3', season: 'christmas-2026', status: 'published', stale: false },
  { id: 'scn-xmas-2026-v4', name: 'Christmas 2026 v4', season: 'christmas-2026', status: 'submitted', stale: false },
  { id: 'scn-ber-2026-v1', name: 'Ber months 2026 v1', season: 'ber-2026', status: 'submitted', stale: false },
  { id: 'scn-xmas-2026-v5', name: 'Christmas 2026 v5 (what-if)', season: 'christmas-2026', status: 'draft', stale: true },
  { id: 'scn-xmas-2026-ft5', name: '5-day FT rule test', season: 'christmas-2026', status: 'draft', stale: true },
  { id: 'scn-xmas-2026-v2', name: 'Christmas 2026 v2', season: 'christmas-2026', status: 'superseded', stale: false },
  { id: 'scn-xmas-2026-v1', name: 'Christmas 2026 v1', season: 'christmas-2026', status: 'archived', stale: false },
  { id: 'scn-xmas-2025', name: 'Christmas 2025', season: 'christmas-2025', status: 'superseded', stale: false },
] as const

export const PUBLISHED_SCENARIO = WORLD_SCENARIOS[0]
export const SUBMITTED_SCENARIO = WORLD_SCENARIOS[1]

/** Scenario stores: the run's per-store base headcount, peak lanes and current cashiers (simulated). */
export const SCENARIO_STORE_BASE: Readonly<Record<string, { readonly base: number; readonly lanes: number; readonly staff: number }>> = {
  'st-qc': { base: 61, lanes: 18, staff: 30 },
  'st-north-edsa': { base: 82, lanes: 24, staff: 40 },
  'st-megamall': { base: 79, lanes: 22, staff: 37 },
  'st-pasig': { base: 44, lanes: 12, staff: 22 },
  'st-moa': { base: 88, lanes: 26, staff: 42 },
  'st-aura': { base: 58, lanes: 17, staff: 30 },
  'st-makati': { base: 50, lanes: 14, staff: 25 },
  'st-lp': { base: 47, lanes: 13, staff: 24 },
}
