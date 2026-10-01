/**
 * The demo network as database rows (task 23; Req 19.1, 19.6).
 *
 * Pure and deterministic: everything is derived from `@lanewise/domain`'s
 * seeded demo dataset (DOM-001 Fixture B — the same master data, staff pool,
 * rule versions and POS-history generator the parity suite uses), and every
 * row id is a name-based UUID (`demoId`), so seeding twice — or on two
 * machines — produces identical rows and URLs to demo objects survive a reset.
 *
 * All rows here are synthetic (P18); the loader in ./seed.ts writes them with
 * `synthetic = true` and never mixes them with real rows.
 */
import { createHash } from 'node:crypto';
import {
  DEFAULT_SETTINGS,
  DEMO_HIRING_RULES,
  DEMO_LABOR_RULES,
  DEMO_PREMIUM_RULES,
  DEMO_STAFFING_RULES,
  DEMO_WAGE_RULES,
  dateRange,
  demo,
  holidayOn,
  type ContractType,
  type StoreFormat,
} from '@lanewise/domain';
import type { RoleCode, ScopeType } from '@lanewise/shared';

/** Fixed namespace for demo ids (UUID v5-style, SHA-1 of namespace + name). */
const DEMO_NAMESPACE = 'lanewise.demo.v1';

/** Deterministic UUID for a demo entity, e.g. `demoId('store', 'smsm-qc')`. */
export function demoId(kind: string, key: string): string {
  const h = createHash('sha1').update(`${DEMO_NAMESPACE}\u0000${kind}\u0000${key}`).digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50; // version 5
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Fixed business timestamps so seeded rows are identical on every run. */
export const DEMO_TIMES = {
  consentAt: '2026-06-01T09:00:00+08:00',
  snapshotLoadedAt: '2026-01-05T09:00:00+08:00',
  rulesSubmittedAt: '2026-01-06T10:00:00+08:00',
  rulesApprovedAt: '2026-01-07T10:00:00+08:00',
  rulesPublishedAt: '2026-01-08T10:00:00+08:00',
  scenarioRunAt: '2026-09-10T14:00:00+08:00',
  headcountApprovedAt: '2026-09-12T10:00:00+08:00',
  budgetApprovedAt: '2026-09-13T10:00:00+08:00',
  planApprovedAt: '2026-09-15T10:00:00+08:00',
} as const;

/** Christmas season the demo plan covers (DOM-001 Fixture C: Dec 19 2026). */
export const DEMO_SEASON = 'christmas-2026';
export const DEMO_PLAN_FROM = '2026-12-01';
export const DEMO_PLAN_TO = '2026-12-31';

export interface DemoRegionRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface DemoStoreRow {
  readonly id: string;
  readonly domainId: string;
  readonly code: string;
  readonly name: string;
  readonly format: 'sm_supermarket' | 'sm_hypermarket' | 'savemore' | 'sm_store';
  readonly regionId: string;
  readonly lat: number;
  readonly lon: number;
}

export interface DemoDepartmentRow {
  readonly id: string;
  readonly domainId: string;
  readonly storeId: string;
  readonly name: string;
  readonly installedLanes: number;
  readonly defaultHandleTimeMin: number;
  readonly tradingOpen: string;
  readonly tradingClose: string;
}

export interface DemoBarangayRow {
  readonly psgcCode: string;
  readonly name: string;
  readonly city: string;
  readonly lat: number;
  readonly lon: number;
}

export interface DemoStaffRow {
  readonly id: string;
  readonly domainId: string;
  readonly storeId: string;
  readonly departmentId: string;
  readonly employeeNo: string;
  readonly name: string;
  readonly email: string;
  readonly employmentType: 'regular' | 'seasonal' | 'part_time';
  readonly preferredRestDay: number;
  readonly weeklyPattern: Readonly<Record<string, unknown>>;
  /** Departments trained on (always includes the home department). */
  readonly trainedDepartmentIds: readonly string[];
}

export interface DemoAvailabilityRow {
  readonly id: string;
  readonly staffId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly reason: string;
}

export interface DemoHomeAreaRow {
  readonly staffId: string;
  readonly barangayCode: string;
  readonly maxTravelMin: number;
  readonly crossStoreOffers: boolean;
}

export interface DemoUserRow {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: RoleCode;
  readonly scopeType: ScopeType;
  /** Scope ids: region ids, store ids or the single staff id. */
  readonly scopeIds: readonly string[];
}

export interface DemoRuleVersionRow {
  readonly id: string;
  readonly ruleSetType: DemoRuleSetType;
  readonly ruleSetName: string;
  readonly isCostRule: boolean;
  readonly effectiveFrom: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly changeNote: string;
}

export type DemoRuleSetType =
  | 'holidays'
  | 'wages'
  | 'premiums'
  | 'lead_times'
  | 'labor'
  | 'service_levels'
  | 'transport_allowance';

export interface DemoSnapshotRow {
  readonly id: string;
  readonly datasetType: 'pos' | 'master' | 'staff';
  readonly coversFrom: string;
  readonly coversTo: string;
  readonly rowCount: number;
  readonly storageKey: string;
}

export interface DemoScenarioRow {
  readonly id: string;
  readonly name: string;
  readonly season: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly runId: string;
  readonly runIdempotencyKey: string;
  readonly runResultsRef: string;
}

export interface DemoDataset {
  readonly seed: number;
  readonly snapshotKey: string;
  readonly regions: readonly DemoRegionRow[];
  readonly stores: readonly DemoStoreRow[];
  readonly departments: readonly DemoDepartmentRow[];
  readonly barangays: readonly DemoBarangayRow[];
  readonly staff: readonly DemoStaffRow[];
  readonly availability: readonly DemoAvailabilityRow[];
  readonly homeAreas: readonly DemoHomeAreaRow[];
  readonly users: readonly DemoUserRow[];
  readonly ruleVersions: readonly DemoRuleVersionRow[];
  readonly snapshots: readonly DemoSnapshotRow[];
  readonly scenario: DemoScenarioRow;
}

const FORMAT_CODE: Readonly<Record<StoreFormat, DemoStoreRow['format']>> = {
  Supermarket: 'sm_supermarket',
  Hypermarket: 'sm_hypermarket',
  'SM Store': 'sm_store',
  SaveMore: 'savemore',
};

/** Contract type -> DOM-002 employment type (the contract type is kept in weekly_pattern). */
const EMPLOYMENT_TYPE: Readonly<Record<ContractType, DemoStaffRow['employmentType']>> = {
  FT: 'regular',
  PT: 'part_time',
  FLOAT: 'seasonal',
};

/** Approximate store positions (source `demo_approximate`). */
const STORE_POSITION: Readonly<Record<string, readonly [number, number]>> = {
  'smsm-qc': [14.6565, 121.029],
  'smsm-ceb': [10.3115, 123.918],
  'smhm-pam': [15.0535, 120.697],
  'smhm-dav': [7.099, 125.631],
  'sms-mnl': [14.5905, 120.983],
  'sms-mkt': [14.551, 121.024],
  'svm-ilo': [10.714, 122.551],
  'svm-lpc': [14.45, 120.993],
};

/**
 * Demo home-area barangays near each store, with approximate public
 * centroids. Codes use the reserved '99' prefix (not a PSGC region; see
 * migration 0230), so they can never be confused with the real PSGC list.
 * The four NCR stores share one pool so cross-store matching has candidates.
 */
const BARANGAYS_BY_AREA: Readonly<Record<string, readonly (readonly [string, string, number, number])[]>> = {
  ncr: [
    ['Bagong Pag-asa', 'Quezon City', 14.6581, 121.0345],
    ['Pag-asa', 'Quezon City', 14.6555, 121.043],
    ['Vasra', 'Quezon City', 14.663, 121.048],
    ['Santo Cristo', 'Quezon City', 14.654, 121.026],
    ['Ermita', 'Manila', 14.583, 120.984],
    ['Malate', 'Manila', 14.572, 120.99],
    ['Paco', 'Manila', 14.58, 121.0],
    ['San Lorenzo', 'Makati', 14.552, 121.023],
    ['Poblacion', 'Makati', 14.565, 121.03],
    ['Pio del Pilar', 'Makati', 14.55, 121.012],
    ['Talon Uno', 'Las Piñas', 14.445, 120.995],
    ['Pamplona Dos', 'Las Piñas', 14.458, 120.988],
    ['Almanza Uno', 'Las Piñas', 14.433, 121.012],
  ],
  'Central Visayas': [
    ['Mabolo', 'Cebu City', 10.319, 123.915],
    ['Kamputhaw', 'Cebu City', 10.308, 123.896],
    ['Lahug', 'Cebu City', 10.331, 123.9],
  ],
  'Central Luzon': [
    ['Dolores', 'San Fernando', 15.045, 120.68],
    ['San Agustin', 'San Fernando', 15.038, 120.695],
    ['Sindalan', 'San Fernando', 15.066, 120.657],
  ],
  'Davao Region': [
    ['Buhangin', 'Davao City', 7.11, 125.612],
    ['Lanang', 'Davao City', 7.103, 125.632],
    ['Agdao', 'Davao City', 7.087, 125.623],
  ],
  'Western Visayas': [
    ['Mandurriao', 'Iloilo City', 10.719, 122.546],
    ['Jaro', 'Iloilo City', 10.73, 122.56],
    ['Molo', 'Iloilo City', 10.697, 122.546],
  ],
};

function areaOf(region: string): string {
  return region === 'NCR' ? 'ncr' : region;
}

/** Demo users, one per role, on the sign-in allowlist domains (P13). */
const DEMO_USERS: readonly { role: RoleCode; email: string; name: string }[] = [
  { role: 'ADM', email: 'demo.admin@1cloudhub.com', name: 'Demo Administrator' },
  { role: 'EXE', email: 'demo.executive@smretail.com', name: 'Demo Executive' },
  { role: 'PLN', email: 'demo.planner@smretail.com', name: 'Demo Network Planner' },
  { role: 'STM', email: 'demo.storemanager@smretail.com', name: 'Demo Store Manager' },
  { role: 'HR', email: 'demo.hr@smretail.com', name: 'Demo HR Partner' },
  { role: 'FIN', email: 'demo.finance@smretail.com', name: 'Demo Finance Partner' },
  { role: 'RST', email: 'demo.datasteward@smretail.com', name: 'Demo Data Steward' },
  { role: 'STF', email: 'demo.cashier@smretail.com', name: 'Demo Cashier' },
];

export const DEMO_USER_EMAILS: readonly string[] = DEMO_USERS.map((u) => u.email);

/** Id of the seeded demo user holding `role`. */
export function demoUserId(role: RoleCode): string {
  return demoId('user', role);
}

/** Staff pool size per department, scaled to installed lanes (~25–60 cashiers per store). */
function staffCounts(installedLanes: number): Record<ContractType, number> {
  return {
    FT: Math.max(2, Math.round(installedLanes * 0.5)),
    PT: Math.round(installedLanes * 0.3),
    FLOAT: Math.max(1, Math.round(installedLanes * 0.1)),
  };
}

function hhmm(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function ruleVersions(): DemoRuleVersionRow[] {
  const holidays = dateRange('2026-01-01', '2026-12-31').flatMap((date) => {
    const h = holidayOn(date);
    return h ? [{ date, name: h.name, dayType: h.dayType }] : [];
  });
  // Payloads hold only the rule values, in the shape the rule API validates
  // (`validateRulePayload`): a version's id and effective date live on the row,
  // so "New draft" from a seeded version passes validation (J6).
  const values = (rule: Readonly<Record<string, unknown>>): Record<string, unknown> => {
    const out = { ...rule };
    delete out.id;
    delete out.effectiveFrom;
    return out;
  };
  const note = 'Demo assumption (DOM-003 scaffold); synthetic, not SM policy.';
  const v = (
    type: DemoRuleSetType,
    name: string,
    isCostRule: boolean,
    payload: Record<string, unknown>,
  ): DemoRuleVersionRow => ({
    id: demoId('rule_version', `${type}:1`),
    ruleSetType: type,
    ruleSetName: name,
    isCostRule,
    effectiveFrom: '2025-01-01',
    payload,
    changeNote: note,
  });
  return [
    v('holidays', 'Holidays', false, { holidays }),
    v('wages', 'Wages', true, values({ ...DEMO_WAGE_RULES })),
    v('premiums', 'Premiums', true, values({ ...DEMO_PREMIUM_RULES })),
    v('lead_times', 'Lead times', false, values({ ...DEMO_HIRING_RULES })),
    v('labor', 'Labor rules', false, values({ ...DEMO_LABOR_RULES })),
    v('service_levels', 'Service levels', false, values({ ...DEMO_STAFFING_RULES })),
    v('transport_allowance', 'Transport allowance', true, {
      // Flat allowance by travel band (Q23); demo values.
      bands: [
        { upToMinutes: 15, amount: 0 },
        { upToMinutes: 30, amount: 50 },
        { upToMinutes: 45, amount: 80 },
        { upToMinutes: 60, amount: 120 },
      ],
    }),
  ];
}

/**
 * Builds the demo dataset. `seed` drives the synthetic POS history exactly as
 * in `@lanewise/domain` (default: the DOM-001 Fixture B seed).
 */
export function buildDemoDataset(seed: number = demo.DEMO_SEED): DemoDataset {
  const snapshot = demo.createDemoSnapshot(seed);

  const regionNames = [...new Set(demo.DEMO_STORES.map((s) => s.region))];
  const regions: DemoRegionRow[] = regionNames.map((name) => ({
    id: demoId('region', name),
    code: `DEMO-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
    name,
  }));
  const regionId = (name: string): string => demoId('region', name);

  const stores: DemoStoreRow[] = demo.DEMO_STORES.map((s) => {
    const [lat, lon] = STORE_POSITION[s.id] ?? [14.6, 121.0];
    return {
      id: demoId('store', s.id),
      domainId: s.id,
      code: `DEMO-${s.id.toUpperCase()}`,
      name: s.name,
      format: FORMAT_CODE[s.format],
      regionId: regionId(s.region),
      lat,
      lon,
    };
  });

  const departments: DemoDepartmentRow[] = demo.DEMO_DEPARTMENT_SEEDS.map((ds) => {
    const d = ds.department;
    return {
      id: demoId('department', d.id),
      domainId: d.id,
      storeId: demoId('store', d.storeId),
      name: d.name,
      installedLanes: d.installedLanes,
      defaultHandleTimeMin: Math.round((ds.ahtSec / 60) * 1000) / 1000,
      tradingOpen: hhmm(d.tradingHours.default.open),
      tradingClose: hhmm(d.tradingHours.default.close),
    };
  });

  const barangays: DemoBarangayRow[] = [];
  const barangaysByArea = new Map<string, string[]>();
  Object.entries(BARANGAYS_BY_AREA).forEach(([area, list], ai) => {
    const codes: string[] = [];
    list.forEach(([name, city, lat, lon], bi) => {
      const psgcCode = `99${String(ai + 1).padStart(4, '0')}${String(bi + 1).padStart(4, '0')}`;
      barangays.push({ psgcCode, name, city, lat, lon });
      codes.push(psgcCode);
    });
    barangaysByArea.set(area, codes);
  });

  const staff: DemoStaffRow[] = [];
  const availability: DemoAvailabilityRow[] = [];
  const homeAreas: DemoHomeAreaRow[] = [];
  const periodDays = dateRange(DEMO_PLAN_FROM, DEMO_PLAN_TO).length;
  const rng = demo.createPrng((seed ^ demo.hashSeed('demo-seed:home-areas')) >>> 0);
  for (const ds of demo.DEMO_DEPARTMENT_SEEDS) {
    const d = ds.department;
    const store = demo.DEMO_STORES.find((s) => s.id === d.storeId);
    if (!store) throw new Error(`unknown demo store ${d.storeId}`);
    const siblings = demo.DEMO_DEPARTMENTS.filter((o) => o.storeId === d.storeId && o.id !== d.id);
    const pool = demo.generateStaffPool({
      storeId: d.storeId,
      departmentId: d.id,
      counts: staffCounts(d.installedLanes),
      periodStart: DEMO_PLAN_FROM,
      periodDays,
    });
    const areaCodes = barangaysByArea.get(areaOf(store.region)) ?? [];
    for (const member of pool) {
      const id = demoId('staff', member.id);
      const localId = member.id.slice(d.storeId.length + 1); // e.g. main:ft-001
      // ~1 in 4 cashiers is cross-trained on a second department of the store.
      const extra = siblings.length > 0 && rng.next() < 0.25 ? [rng.pick(siblings).id] : [];
      staff.push({
        id,
        domainId: member.id,
        storeId: demoId('store', member.storeId),
        departmentId: demoId('department', member.departmentId),
        employeeNo: `DEMO-${localId.toUpperCase().replace(':', '-')}`,
        name: member.name,
        email: `${member.id.replace(/:/g, '.')}@demo.local`,
        employmentType: EMPLOYMENT_TYPE[member.contractType],
        preferredRestDay: member.preferredRestDay,
        weeklyPattern: { contractType: member.contractType, preferredRestDay: member.preferredRestDay },
        trainedDepartmentIds: [demoId('department', member.departmentId), ...extra.map((x) => demoId('department', x))],
      });
      for (const date of member.unavailableDates) {
        availability.push({
          id: demoId('staff_availability', `${member.id}:${date}`),
          staffId: id,
          startsAt: `${date}T00:00:00+08:00`,
          endsAt: `${nextDay(date)}T00:00:00+08:00`,
          reason: 'Demo availability exception',
        });
      }
      // ~9 in 10 cashiers opted in to sharing a barangay-level home area (P15);
      // the rest have no home-area row at all.
      if (areaCodes.length > 0 && rng.next() < 0.9) {
        homeAreas.push({
          staffId: id,
          barangayCode: rng.pick(areaCodes),
          maxTravelMin: rng.pick([20, 30, 45, 60]),
          crossStoreOffers: rng.next() < 0.5,
        });
      }
    }
  }

  // Scopes: planner over all demo regions, store manager over the QC store,
  // the Staff persona linked to the first QC main-lanes cashier.
  const personaStaffId = demoId('staff', 'smsm-qc:main:ft-001');
  const qcStoreId = demoId('store', 'smsm-qc');
  const users: DemoUserRow[] = DEMO_USERS.map((u) => {
    const base = { id: demoUserId(u.role), email: u.email, name: u.name, role: u.role };
    switch (u.role) {
      case 'PLN':
        return { ...base, scopeType: 'region', scopeIds: regions.map((r) => r.id) };
      case 'STM':
        return { ...base, scopeType: 'store', scopeIds: [qcStoreId] };
      case 'STF':
        return { ...base, scopeType: 'self', scopeIds: [personaStaffId] };
      default:
        return { ...base, scopeType: 'global', scopeIds: [] };
    }
  });

  const snapshotKey = snapshot.snapshotId;
  const snapshots: DemoSnapshotRow[] = [
    {
      id: demoId('dataset_snapshot', `${snapshotKey}:pos`),
      datasetType: 'pos',
      coversFrom: demo.DEMO_HISTORY_FROM,
      coversTo: demo.DEMO_HISTORY_TO,
      rowCount: snapshot.history.length,
      // Not materialised: the rows are regenerated from @lanewise/domain with this seed.
      storageKey: `demo://${snapshotKey}/pos?seed=${seed}`,
    },
    {
      id: demoId('dataset_snapshot', `${snapshotKey}:master`),
      datasetType: 'master',
      coversFrom: demo.DEMO_HISTORY_FROM,
      coversTo: DEMO_PLAN_TO,
      rowCount: stores.length + departments.length,
      storageKey: `demo://${snapshotKey}/master`,
    },
    {
      id: demoId('dataset_snapshot', `${snapshotKey}:staff`),
      datasetType: 'staff',
      coversFrom: DEMO_PLAN_FROM,
      coversTo: DEMO_PLAN_TO,
      rowCount: staff.length,
      storageKey: `demo://${snapshotKey}/staff`,
    },
  ];

  const scenario: DemoScenarioRow = {
    id: demoId('scenario', DEMO_SEASON),
    name: 'Christmas 2026 network plan',
    season: DEMO_SEASON,
    settings: {
      ...DEFAULT_SETTINGS,
      planningFrom: DEMO_PLAN_FROM,
      planningTo: DEMO_PLAN_TO,
      peakDay: '2026-12-19',
      serviceTarget: { ...DEMO_STAFFING_RULES.serviceTarget },
    },
    runId: demoId('scenario_run', `${DEMO_SEASON}:network`),
    runIdempotencyKey: `demo:${DEMO_SEASON}:network`,
    runResultsRef: `demo://runs/${DEMO_SEASON}/network?snapshot=${snapshotKey}`,
  };

  return {
    seed,
    snapshotKey,
    regions,
    stores,
    departments,
    barangays,
    staff,
    availability,
    homeAreas,
    users,
    ruleVersions: ruleVersions(),
    snapshots,
    scenario,
  };
}
