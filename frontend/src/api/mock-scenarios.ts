import {
  DEFAULT_SCENARIO_SETTINGS,
  ENGINE_SETTING_DEFAULTS,
  HTTP_STATUS_BY_ERROR_CODE,
  canSeeCost,
  compareScenarioResults,
  diffDepartmentOverrides,
  diffScenarioSettings,
  effectiveSetting,
  isStoreInScope,
  isScenarioSettingsEditable,
  scenarioSubmitBlocker,
  validateScenarioSettings,
  type ApiErrorCode,
  type ApiErrorDetail,
  type CostViewer,
  type RoleCode,
  type ScenarioComparison,
  type ScenarioDepartmentBaseline,
  type ScenarioDetail,
  type ScenarioListItem,
  type ScenarioRunResults,
  type ScenarioSettingsValues,
  type ScenarioStatus,
  type ScenarioStoreResult,
} from '@lanewise/shared'
import type { ApiResponse } from './client'
import { MOCK_PEOPLE, createApprovalBook, type MockApprovalBook } from './mock-approvals'
import { PEOPLE, SCENARIO_STORE_BASE, WORLD_DEPARTMENTS, WORLD_STORES, worldHash } from './mock-world'

/**
 * In-memory `/scenarios` for the mock API (task 11). Scenarios live per
 * adapter, so mutations (create, edit, run, submit, …) persist for the
 * session. Responses are shaped for the role here — cost figures removed
 * where `canSeeCost` says no, Store Manager sees published only — and are
 * returned already shaped (the adapter skips its generic cost pass).
 * Figures are simulated, not SM actuals.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type Row = Mutable<Omit<ScenarioDetail, 'editable' | 'submitBlocker' | 'defaults' | 'baseHourlyRate' | 'departments'>>

/** ₱ all-in hourly cost by region: the published NCR wage rule plus on-cost, holiday premiums and night differential. */
const RATE_BY_REGION: Readonly<Record<string, number>> = { 'reg-ncr-north': 136, 'reg-ncr-east': 136, 'reg-ncr-south': 139 }

const STORES = WORLD_STORES.map((s) => ({
  storeId: s.id,
  storeName: s.name,
  regionId: s.regionId,
  ...(SCENARIO_STORE_BASE[s.id] ?? { base: 30, lanes: 12, staff: 22 }),
  rate: RATE_BY_REGION[s.regionId] ?? 92,
}))

/** POS-learned department baselines (simulated) for the SCR-031 overrides table: main and express lanes per store. */
const DEPARTMENTS: readonly (ScenarioDepartmentBaseline & { readonly regionId: string })[] = WORLD_DEPARTMENTS.filter((d) => !d.id.endsWith('-d3')).map((d) => {
  const store = WORLD_STORES.find((s) => s.id === d.storeId)
  const main = d.id.endsWith('-d1')
  const scale = store?.scale ?? 1
  return {
    departmentId: d.id,
    departmentName: d.name,
    storeId: d.storeId,
    storeName: store?.name ?? d.storeId,
    regionId: store?.regionId ?? '',
    baselineTxPerDay: Math.round((main ? 1636 : 971) * scale),
    handleTimeMin: main ? 2.43 : 1.17,
    upliftPct: Math.round((main ? 81 : 64) + (worldHash(d.id) - 0.5) * 12),
  }
})

/** ₱ base hourly rate of the pinned wage rule (its default rate). */
const BASE_HOURLY_RATE = 80

/** Workload multiplier from a store's department overrides (1 = as learned). */
function departmentFactor(s: ScenarioSettingsValues, storeId: string): number {
  const own = DEPARTMENTS.filter((d) => d.storeId === storeId)
  if (own.length === 0) return 1
  const weights = own.map((d) => {
    const o = s.departmentOverrides.find((x) => x.departmentId === d.departmentId)
    const learned = d.baselineTxPerDay * d.handleTimeMin * (1 + d.upliftPct / 100)
    const tx = o?.baselineTxPerDay ?? d.baselineTxPerDay
    const aht = o?.handleTimeMin ?? d.handleTimeMin
    const uplift = o?.upliftPct ?? d.upliftPct
    return { learned, now: tx * aht * (1 + uplift / 100) }
  })
  const learned = weights.reduce((n, w) => n + w.learned, 0)
  return learned > 0 ? weights.reduce((n, w) => n + w.now, 0) / learned : 1
}

/** Deterministic simulated results from the settings (overrides fall back to `ENGINE_SETTING_DEFAULTS`). */
export function simulateResults(s: ScenarioSettingsValues): ScenarioRunResults {
  const eff = <K extends Parameters<typeof effectiveSetting>[2]>(k: K) => effectiveSetting(s, ENGINE_SETTING_DEFAULTS, k)
  const days = Math.round((Date.parse(s.planningTo) - Date.parse(s.planningFrom)) / 86_400_000) + 1
  const mix = s.allowPartTime ? 1 : 1.08
  // A stricter service target, more shrinkage or an absence reserve needs more people.
  const service = 1 + (eff('servedWithinPct') - 90) / 100 + (60 - eff('waitSeconds')) / 600
  const shrink = (eff('shrinkage') / ENGINE_SETTING_DEFAULTS.shrinkage) * (1 + eff('absenceReservePct') / 100)
  const paidPerHead = eff('ftShiftPattern') === '7+1' ? 6.5 * (7 / 8) : 6.5
  const stores: ScenarioStoreResult[] = STORES.map((st) => {
    const load = s.growth * mix * Math.max(0.5, service) * shrink * departmentFactor(s, st.storeId)
    const headcount = Math.round(st.base * load)
    const paidHours = Math.round(headcount * days * paidPerHead * (s.allowPartTime ? 0.92 : 1))
    return {
      storeId: st.storeId,
      storeName: st.storeName,
      regionId: st.regionId,
      headcount,
      paidHours,
      cost: Math.round(paidHours * st.rate),
      peakLanes: Math.min(st.lanes, Math.max(eff('minOpenLanes'), Math.round(st.lanes * 0.8 * s.growth * Math.max(0.5, service)))),
      hires: Math.max(0, headcount - st.staff),
    }
  })
  const sum = (f: (x: ScenarioStoreResult) => number) => stores.reduce((n, x) => n + f(x), 0)
  const headcount = sum((x) => x.headcount)
  const pt = s.allowPartTime ? Math.round(headcount * 0.38) : 0
  const seasonalHires = sum((x) => x.hires ?? 0)
  // Hires start on the floor a week before the season opens.
  const needBy = new Date(Date.parse(`${s.planningFrom}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10)
  return {
    from: s.planningFrom,
    to: s.planningTo,
    headcount,
    headcountByType: { FT: headcount - pt - Math.round(headcount * 0.05), PT: pt, FLOAT: Math.round(headcount * 0.05) },
    paidHours: sum((x) => x.paidHours),
    cost: sum((x) => x.cost ?? 0),
    peak: { date: s.peakDay, hour: 17, lanesOpen: sum((x) => x.peakLanes) },
    seasonalHires,
    firstNeededBy: seasonalHires > 0 ? needBy : null,
    stores,
  }
}

const POS_OLD = { datasetType: 'pos', snapshotId: 'snap-pos-0915', loadedAt: '2026-09-15T06:00:00+08:00' }
const POS_NEW = { datasetType: 'pos', snapshotId: 'snap-pos-0928', loadedAt: '2026-09-28T14:02:00+08:00' }
const STAFF = { datasetType: 'staff', snapshotId: 'snap-staff-0901', loadedAt: '2026-09-01T06:00:00+08:00' }
const RULES = [
  { ruleSetId: 'rules-wages', ruleSetName: 'Wage rates (by region)', ruleSetType: 'wages', ruleVersionId: 'rv-wages-2', version: 2, effectiveFrom: '2026-07-01', publishedAt: '2026-06-20T10:00:00+08:00' },
  { ruleSetId: 'rules-service', ruleSetName: 'Service targets', ruleSetType: 'service_levels', ruleVersionId: 'rv-service-1', version: 1, effectiveFrom: '2026-01-01', publishedAt: '2025-12-15T10:00:00+08:00' },
  { ruleSetId: 'rules-holidays', ruleSetName: 'Holiday calendar 2026', ruleSetType: 'holidays', ruleVersionId: 'rv-holidays-2', version: 2, effectiveFrom: '2026-01-01', publishedAt: '2025-11-20T10:00:00+08:00' },
  { ruleSetId: 'rules-labor', ruleSetName: 'Labor rules (PH)', ruleSetType: 'labor', ruleVersionId: 'rv-labor-1', version: 1, effectiveFrom: '2025-01-01', publishedAt: '2024-12-15T10:00:00+08:00' },
] as const

/** Latest publish time among the pinned rule versions ("Rules version"). */
const RULES_AS_OF = RULES.map((r) => r.publishedAt).reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a))

function currentPins(): Pick<Row, 'snapshots' | 'ruleVersions' | 'dataAsOf' | 'rulesAsOf'> {
  return {
    snapshots: [
      { ...POS_NEW, current: true },
      { ...STAFF, current: true },
    ],
    ruleVersions: RULES.map((r) => ({ ...r, current: true })),
    dataAsOf: POS_NEW.loadedAt,
    rulesAsOf: RULES_AS_OF,
  }
}

function run(id: string, s: ScenarioSettingsValues, at: string, snapshots: Row['snapshots'], rules: Row['ruleVersions']): Row['latestRun'] {
  return {
    id: `run-${id}-${at.slice(0, 10)}`,
    status: 'succeeded',
    createdAt: at,
    finishedAt: at,
    errorMessage: null,
    snapshotIds: Object.fromEntries(snapshots.map((p) => [p.datasetType, p.snapshotId])),
    ruleVersionIds: rules.map((r) => r.ruleVersionId),
    results: simulateResults(s),
  }
}

function seed(): Row[] {
  const xmas = (over: Partial<ScenarioSettingsValues>): ScenarioSettingsValues => ({
    ...DEFAULT_SCENARIO_SETTINGS,
    growth: 1.05,
    allowPartTime: true,
    planningFrom: '2026-12-01',
    planningTo: '2026-12-31',
    peakDay: '2026-12-19',
    notes: '',
    ...over,
  })
  const base = {
    season: 'christmas-2026',
    ownerId: 'u-pln-ana',
    ownerName: 'Ana Reyes',
    planningFrom: '2026-12-01',
    planningTo: '2026-12-31',
    synthetic: true,
  } as const
  const oldPins = {
    snapshots: [
      { ...POS_OLD, current: false },
      { ...STAFF, current: true },
    ],
    ruleVersions: RULES.map((r) => ({ ...r, current: true })),
    dataAsOf: POS_OLD.loadedAt,
    rulesAsOf: RULES_AS_OF,
  }
  const v3s = xmas({ notes: 'Approved plan for the 2026 Christmas season.' })
  const v4s = xmas({
    growth: 0.96,
    notes: 'Stricter labor rules per HR guidance; leaner growth after the September POS refresh.',
    waitSeconds: 45,
    departmentOverrides: [{ departmentId: 'st-qc-d1', baselineTxPerDay: null, handleTimeMin: 2.6, upliftPct: null }],
  })
  const v5s = xmas({ growth: 1.12, notes: 'What if growth reaches 12%?' })
  const ft5s = xmas({ growth: 1.05, ftShiftPattern: '7+1', notes: 'Five-day full-time weeks.' })
  const v2s = xmas({ growth: 1.03, allowPartTime: false })
  const v1s = xmas({ growth: 1, allowPartTime: false, notes: 'First cut from the 2025 baseline.' })
  const ber = { ...xmas({ growth: 0.85, planningFrom: '2026-10-01', planningTo: '2026-11-30', peakDay: '2026-11-28' }) }
  const x25 = xmas({ growth: 1, planningFrom: '2025-12-01', planningTo: '2025-12-31', peakDay: '2025-12-20', notes: 'Last year’s published plan.' })
  const paolo = { ownerId: PEOPLE.planner2.id, ownerName: PEOPLE.planner2.name } as const
  const current = currentPins()
  const row = (r: Omit<Row, keyof typeof base | 'latestRun'> & Partial<Pick<Row, 'season' | 'ownerId' | 'ownerName' | 'planningFrom' | 'planningTo'>> & { readonly runAt: string | null }): Row => {
    const { runAt, ...rest } = r
    const merged = { ...base, ...rest }
    return { ...merged, latestRun: runAt ? run(merged.id, merged.settings, runAt, merged.snapshots, merged.ruleVersions) : null }
  }
  return [
    row({ id: 'scn-xmas-2026-v3', name: 'Christmas 2026 v3', status: 'published', isPublished: true, stale: false, staleReasons: [], parentScenarioId: 'scn-xmas-2026-v2', ...oldPins, lastRunAt: '2026-09-16T10:00:00+08:00', updatedAt: '2026-09-18T09:00:00+08:00', settings: v3s, runAt: '2026-09-16T10:00:00+08:00' }),
    row({ id: 'scn-xmas-2026-v4', name: 'Christmas 2026 v4', status: 'submitted', isPublished: false, stale: false, staleReasons: [], parentScenarioId: 'scn-xmas-2026-v3', ...current, lastRunAt: '2026-09-29T08:40:00+08:00', updatedAt: '2026-09-29T09:10:00+08:00', settings: v4s, runAt: '2026-09-29T08:40:00+08:00' }),
    row({ id: 'scn-ber-2026-v1', name: 'Ber months 2026 v1', season: 'ber-2026', planningFrom: ber.planningFrom, planningTo: ber.planningTo, status: 'submitted', isPublished: false, stale: false, staleReasons: [], parentScenarioId: null, ...current, lastRunAt: '2026-09-29T11:00:00+08:00', updatedAt: '2026-09-29T11:30:00+08:00', settings: ber, runAt: '2026-09-29T11:00:00+08:00' }),
    row({ id: 'scn-xmas-2026-v5', name: 'Christmas 2026 v5 (what-if)', ...paolo, status: 'draft', isPublished: false, stale: true, staleReasons: ['snapshot_superseded'], parentScenarioId: 'scn-xmas-2026-v4', ...oldPins, lastRunAt: '2026-09-22T16:00:00+08:00', updatedAt: '2026-09-22T16:05:00+08:00', settings: v5s, runAt: '2026-09-22T16:00:00+08:00' }),
    row({ id: 'scn-xmas-2026-ft5', name: '5-day FT rule test', ...paolo, status: 'draft', isPublished: false, stale: true, staleReasons: ['snapshot_superseded'], parentScenarioId: 'scn-xmas-2026-v3', ...oldPins, lastRunAt: '2026-09-24T10:00:00+08:00', updatedAt: '2026-09-24T10:20:00+08:00', settings: ft5s, runAt: '2026-09-24T10:00:00+08:00' }),
    row({ id: 'scn-xmas-2026-v2', name: 'Christmas 2026 v2', status: 'superseded', isPublished: false, stale: false, staleReasons: [], parentScenarioId: 'scn-xmas-2026-v1', ...oldPins, lastRunAt: '2026-09-10T09:00:00+08:00', updatedAt: '2026-09-18T09:00:00+08:00', settings: v2s, runAt: '2026-09-10T09:00:00+08:00' }),
    row({ id: 'scn-xmas-2026-v1', name: 'Christmas 2026 v1', status: 'archived', isPublished: false, stale: false, staleReasons: [], parentScenarioId: null, ...oldPins, lastRunAt: '2026-09-02T14:00:00+08:00', updatedAt: '2026-09-05T11:00:00+08:00', settings: v1s, runAt: '2026-09-02T14:00:00+08:00' }),
    row({ id: 'scn-xmas-2025', name: 'Christmas 2025', season: 'christmas-2025', planningFrom: x25.planningFrom, planningTo: x25.planningTo, status: 'superseded', isPublished: false, stale: false, staleReasons: [], parentScenarioId: null, ...oldPins, lastRunAt: '2025-09-20T10:00:00+08:00', updatedAt: '2026-09-18T09:00:00+08:00', settings: x25, runAt: '2025-09-20T10:00:00+08:00' }),
  ]
}

let seq = 0
function fail(code: ApiErrorCode, message: string, details?: ApiErrorDetail[]): ApiResponse {
  seq += 1
  return {
    status: HTTP_STATUS_BY_ERROR_CODE[code],
    body: { error: { code, message, requestId: `mock-scn-${seq}`, ...(details ? { details } : {}) } },
  }
}

const ok = (body: unknown, status = 200): ApiResponse => ({ status, body })

function stripResults(r: ScenarioRunResults | null, viewer: CostViewer): ScenarioRunResults | null {
  if (!r) return null
  const { cost, stores, ...rest } = r
  const network = canSeeCost(viewer, { level: 'network' })
  return {
    ...rest,
    ...(network && cost !== undefined ? { cost } : {}),
    stores: stores.map(({ cost: c, ...s }) =>
      canSeeCost(viewer, { level: 'store', store: { id: s.storeId, regionId: s.regionId } }) && c !== undefined ? { ...s, cost: c } : s,
    ),
  }
}

export interface MockScenarioStore {
  handle(input: { method: string; pathname: string; query: URLSearchParams; body: unknown; role: RoleCode; viewer: CostViewer }): ApiResponse
  /** `/approvals` over the same scenarios (task 12, ./mock-approvals). */
  readonly approvals: MockApprovalBook
}

export function createScenarioStore(now: () => string = () => new Date().toISOString()): MockScenarioStore {
  const rows = seed()

  function view(row: Row, role: RoleCode, viewer: CostViewer): ScenarioDetail {
    const hasSucceededRun = row.latestRun?.status === 'succeeded'
    const scope = viewer.scope
    return {
      ...row,
      defaults: ENGINE_SETTING_DEFAULTS,
      // Network-level cost figure: removed for roles without network cost (e.g. Store Manager).
      ...(canSeeCost(viewer, { level: 'network' }) ? { baseHourlyRate: BASE_HOURLY_RATE } : {}),
      // In-scope departments only (P1).
      departments: DEPARTMENTS.filter((d) => scope !== null && isStoreInScope(scope, { id: d.storeId, regionId: d.regionId })).map(
        (d): ScenarioDepartmentBaseline => ({
          departmentId: d.departmentId,
          departmentName: d.departmentName,
          storeId: d.storeId,
          storeName: d.storeName,
          baselineTxPerDay: d.baselineTxPerDay,
          handleTimeMin: d.handleTimeMin,
          upliftPct: d.upliftPct,
        }),
      ),
      latestRun: row.latestRun ? { ...row.latestRun, results: stripResults(row.latestRun.results, viewer) } : null,
      editable: role === 'PLN' && isScenarioSettingsEditable(row.status),
      submitBlocker: scenarioSubmitBlocker({ status: row.status, stale: row.stale, hasSucceededRun }),
    }
  }

  function listItem(d: ScenarioDetail): ScenarioListItem {
    return {
      id: d.id,
      name: d.name,
      season: d.season,
      status: d.status,
      isPublished: d.isPublished,
      stale: d.stale,
      staleReasons: d.staleReasons,
      ownerId: d.ownerId,
      ownerName: d.ownerName,
      parentScenarioId: d.parentScenarioId,
      planningFrom: d.planningFrom,
      planningTo: d.planningTo,
      dataAsOf: d.dataAsOf,
      rulesAsOf: d.rulesAsOf,
      lastRunAt: d.lastRunAt,
      updatedAt: d.updatedAt,
      synthetic: d.synthetic,
    }
  }

  function newDraft(from: Pick<Row, 'name' | 'season' | 'settings'>, parent: string | null): Row {
    seq += 1
    const t = now()
    const row: Row = {
      id: `scn-new-${seq}`,
      name: from.name,
      season: from.season,
      status: 'draft',
      isPublished: false,
      stale: false,
      staleReasons: [],
      ownerId: MOCK_PEOPLE.PLN.id,
      ownerName: MOCK_PEOPLE.PLN.name,
      parentScenarioId: parent,
      planningFrom: from.settings.planningFrom,
      planningTo: from.settings.planningTo,
      lastRunAt: null,
      updatedAt: t,
      synthetic: true,
      settings: from.settings,
      latestRun: null,
      ...currentPins(),
    }
    rows.unshift(row)
    return row
  }

  const approvals = createApprovalBook({ rows: () => rows, detail: view, listItem, now })

  return {
    approvals,
    handle({ method, pathname, query, body, role, viewer }) {
      const visible = (r: Row) => (role === 'STM' ? r.status === 'published' : role !== 'STF' && role !== 'ADM')
      const planner = role === 'PLN'
      const b = (body ?? {}) as Record<string, unknown>
      const parts = pathname.split('/').filter(Boolean) // ['scenarios', id?, action?]
      const id = parts[1] ? decodeURIComponent(parts[1]) : null
      const action = parts[2] ?? null

      if (role === 'STF' || role === 'ADM') return fail('forbidden', 'You don’t have access to scenarios.')

      if (!id) {
        if (method === 'GET') {
          const status = query.get('status')
          const season = query.get('season')
          const stale = query.get('stale') === 'true'
          const q = (query.get('q') ?? '').trim().toLowerCase()
          const owner = query.get('owner')
          if (owner !== null && owner !== 'me') {
            return fail('validation_failed', 'Some query parameters are invalid.', [{ path: 'query.owner', message: 'Use "me".' }])
          }
          // "me": the PLN persona owns the seeded scenarios; other roles own none.
          const me = role === 'PLN' ? MOCK_PEOPLE.PLN.id : `u-${role.toLowerCase()}-mock`
          const scenarios = rows
            .filter(visible)
            .filter((r) => owner === null || r.ownerId === me)
            .filter((r) => (!status || r.status === status) && (!season || r.season === season) && (!stale || r.stale))
            .filter((r) => !q || r.name.toLowerCase().includes(q))
            .map((r) => listItem(view(r, role, viewer)))
          return ok({ scenarios })
        }
        if (method === 'POST') {
          if (!planner) return fail('forbidden', 'Only planners can create scenarios.')
          const name = typeof b.name === 'string' ? b.name.trim() : ''
          const season = typeof b.season === 'string' ? b.season.trim() : ''
          if (!name || !season) {
            return fail('validation_failed', 'Enter a name and a season.', [
              ...(!name ? [{ path: 'body.name', message: 'Required.' }] : []),
              ...(!season ? [{ path: 'body.season', message: 'Required.' }] : []),
            ])
          }
          const settings = b.settings ? validateScenarioSettings(b.settings) : null
          if (settings && !settings.ok) return fail('validation_failed', 'Some settings are invalid.')
          const row = newDraft({ name, season, settings: settings?.ok ? settings.settings : rows[0]!.settings }, null)
          return ok({ scenario: view(row, role, viewer) }, 201)
        }
        return fail('not_found', 'We couldn’t find that.')
      }

      if (id === 'compare' && method === 'GET') {
        const ra = rows.find((r) => r.id === query.get('a') && visible(r))
        const rb = rows.find((r) => r.id === query.get('b') && visible(r))
        if (!ra || !rb) return fail('not_found', 'We couldn’t find one of those scenarios.')
        const a = view(ra, role, viewer)
        const bb = view(rb, role, viewer)
        const types = [...new Set([...a.snapshots, ...bb.snapshots].map((s) => s.datasetType))]
        const sets = [...new Set([...a.ruleVersions, ...bb.ruleVersions].map((r) => r.ruleSetName))]
        const comparison: ScenarioComparison = {
          a,
          b: bb,
          settings: diffScenarioSettings(a.settings, bb.settings),
          departmentSettings: diffDepartmentOverrides(a.settings.departmentOverrides, bb.settings.departmentOverrides),
          inputs: {
            snapshots: types.map((datasetType) => ({
              datasetType,
              a: a.snapshots.find((s) => s.datasetType === datasetType)?.snapshotId ?? null,
              b: bb.snapshots.find((s) => s.datasetType === datasetType)?.snapshotId ?? null,
            })),
            ruleVersions: sets.map((ruleSetName) => ({
              ruleSetName,
              a: a.ruleVersions.find((r) => r.ruleSetName === ruleSetName)?.version ?? null,
              b: bb.ruleVersions.find((r) => r.ruleSetName === ruleSetName)?.version ?? null,
            })),
          },
          results: compareScenarioResults(a.latestRun?.results ?? null, bb.latestRun?.results ?? null),
        }
        return ok(comparison)
      }

      const row = rows.find((r) => r.id === id)
      if (!row || !visible(row)) return fail('not_found', 'We couldn’t find that scenario.')
      const reply = (r: Row, status = 200) => ok({ scenario: view(r, role, viewer) }, status)
      const setStatus = (s: ScenarioStatus) => {
        row.status = s
        row.updatedAt = now()
      }

      if (method === 'GET' && !action) return reply(row)
      if (!planner) return fail('forbidden', 'Only planners can change scenarios.')

      if (method === 'PATCH' && !action) {
        if (row.status !== 'draft') return fail('conflict', 'Only a draft can be changed. Duplicate it as a draft.')
        if (typeof b.name === 'string' && b.name.trim()) row.name = b.name.trim()
        if (b.settings !== undefined) {
          const v = validateScenarioSettings(b.settings)
          if (!v.ok) {
            return fail(
              'validation_failed',
              'Some settings are invalid.',
              v.issues.map((i) => ({
                path:
                  i.index === undefined
                    ? `body.settings.${i.path}`
                    : `body.settings.${i.path}.${i.index}${i.field === undefined ? '' : `.${i.field}`}`,
                message: i.message,
              })),
            )
          }
          const changed =
            diffScenarioSettings(row.settings, v.settings).length > 0 ||
            diffDepartmentOverrides(row.settings.departmentOverrides, v.settings.departmentOverrides).length > 0
          row.settings = v.settings
          row.planningFrom = v.settings.planningFrom
          row.planningTo = v.settings.planningTo
          if (changed && row.latestRun && !row.staleReasons.includes('settings_changed')) {
            row.stale = true
            row.staleReasons = [...row.staleReasons, 'settings_changed']
          }
        }
        row.updatedAt = now()
        return reply(row)
      }

      if (method !== 'POST') return fail('not_found', 'We couldn’t find that.')
      switch (action) {
        case 'duplicate': {
          const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : `${row.name} (copy)`
          return reply(newDraft({ name, season: row.season, settings: row.settings }, row.id), 201)
        }
        case 'refresh':
          return reply(newDraft({ name: `${row.name} (recalculated)`, season: row.season, settings: row.settings }, row.id), 201)
        case 'run': {
          if (row.status !== 'draft') return fail('conflict', 'Only a draft can be run.')
          Object.assign(row, currentPins())
          const t = now()
          row.latestRun = run(row.id, row.settings, t, row.snapshots, row.ruleVersions)
          row.lastRunAt = t
          row.updatedAt = t
          row.stale = false
          row.staleReasons = []
          return reply(row, 201)
        }
        case 'submit': {
          const blocker = scenarioSubmitBlocker({ status: row.status, stale: row.stale, hasSucceededRun: row.latestRun?.status === 'succeeded' })
          if (blocker) return fail('conflict', `This scenario can’t be submitted (${blocker}).`)
          setStatus('submitted')
          approvals.submit(row.id, role)
          return reply(row)
        }
        case 'archive':
          if (row.status !== 'draft') return fail('conflict', 'Only a draft can be archived.')
          setStatus('archived')
          return reply(row)
        default:
          return fail('not_found', 'We couldn’t find that.')
      }
    },
  }
}
