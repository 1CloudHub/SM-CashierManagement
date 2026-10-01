import {
  HTTP_STATUS_BY_ERROR_CODE,
  aggregateNetwork,
  can,
  costFigure,
  departmentDayCsv,
  departmentFigures,
  growthPct,
  hiringKpisFor,
  hiringPlanCsv,
  leadershipSummaryCsv,
  matchesNetworkFilter,
  milestoneStatus,
  networkViewCsv,
  offersDueOf,
  seesPublishedScenariosOnly,
  shapeCost,
  type ApiErrorCode,
  type CostDraft,
  type CostViewer,
  type DepartmentDayInput,
  type DepartmentDayView,
  type FileDownload,
  type HiringMilestone,
  type HiringPlanView,
  type HiringStoreRow,
  type LeadershipSummary,
  type LongRosterView,
  type NetworkView,
  type PlanningContractType,
  type PlanningJob,
  type PlanningProvenance,
  type RbacResource,
  type PermissionAction,
  type RoleCode,
} from '@lanewise/shared'
import type { ApiResponse } from './client'
import { MOCK_DEPARTMENTS, MOCK_SCENARIOS, MOCK_STORES, mockStoreScope } from './mock-directory'
import { DEMO_TODAY, WORLD_STORES } from './mock-world'

/**
 * In-memory planning endpoints for the mock API (task 14): network view,
 * department day plan, hiring plan + long-roster jobs, leadership summary.
 *
 * Figures are a deterministic synthetic curve per store/department/date —
 * simulated, not SM actuals — aggregated with the same shared helpers as the
 * API (`departmentFigures`, `aggregateNetwork`), so a department shows the
 * same numbers alone and in the network view (P2). Responses are limited to
 * the role's demo scope and shaped with the shared cost policy. Jobs advance
 * one step per status poll so the progress bar can be seen working.
 */

const HOURS = Array.from({ length: 13 }, (_, i) => 9 + i) // 9 AM – 9 PM
const DEPT_SIZE = [{ lanes: 24, base: 16 }, { lanes: 8, base: 5 }, { lanes: 4, base: 2 }] as const

function hash(s: string): number {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0) / 2 ** 32
}

function dayFactor(date: string): number {
  const d = new Date(`${date}T00:00:00Z`)
  const dow = d.getUTCDay()
  const md = date.slice(5)
  if (md === '12-24') return 1.45
  if (md === '12-25') return 0.7
  return (dow === 0 || dow === 6 ? 1.25 : 1) * (d.getUTCMonth() === 11 ? 1.2 : 1)
}

function curve(hour: number): number {
  return 0.45 + 0.4 * Math.exp(-((hour - 13) ** 2) / 6) + 0.55 * Math.exp(-((hour - 18) ** 2) / 5)
}

interface MockDept {
  readonly id: string
  readonly name: string
  readonly storeId: string
  readonly index: number
}

const STORE_SCALE: Readonly<Record<string, number>> = Object.fromEntries(WORLD_STORES.map((s) => [s.id, s.scale]))
/** NCR minimum wage ÷ 8 plus on-cost (the published wage rule), with a small premium for the CBD stores. */
const rateOf = (regionId: string | undefined) => (regionId === 'reg-ncr-south' ? 94 : 92)

function deptInput(scenarioId: string, dept: MockDept, date: string): DepartmentDayInput & { shiftRows: DepartmentDayView['shifts'] } {
  const store = MOCK_STORES.find((s) => s.id === dept.storeId) ?? MOCK_STORES[0]
  const size = DEPT_SIZE[dept.index] ?? DEPT_SIZE[2]
  const scale = (STORE_SCALE[dept.storeId] ?? 1) * (0.95 + hash(scenarioId) * 0.1)
  // Megamall main lanes are short of installed lanes at the afternoon peak (wireframe example).
  const installed = dept.id === 'st-megamall-d1' ? 24 : Math.round(size.lanes * Math.min(scale, 1.3))
  const hours = HOURS.map((hour) => {
    const need = Math.max(1, Math.round(size.base * scale * curve(hour) * dayFactor(date)))
    const open = Math.min(need, installed)
    return { hour, lanesNeeded: need, lanesOpen: open, cashiersRequired: Math.ceil(open * 1.17), overCapacity: need > installed }
  })
  const peak = Math.max(...hours.map((h) => h.cashiersRequired))
  const base = Math.max(1, Math.round(peak * 0.55))
  const shiftRows: DepartmentDayView['shifts'][number][] = []
  for (let i = 0; i < base; i += 1) {
    const start = 9 + (i % 4)
    shiftRows.push({ id: `ft-${i + 1}`, type: 'FT', start, end: start + 9, mealHour: start + 4, paidHours: 8 })
  }
  let k = 0
  for (const h of hours) {
    const covered = shiftRows.filter((s) => h.hour >= s.start && h.hour < s.end && s.mealHour !== h.hour).length
    for (let gap = h.cashiersRequired - covered; gap > 0; gap -= 1) {
      k += 1
      const type: PlanningContractType = k % 5 === 0 ? 'FLOAT' : 'PT'
      const start = Math.min(h.hour, 21 - (type === 'PT' ? 4 : 8))
      shiftRows.push({ id: `${type.toLowerCase()}-${k}`, type, start, end: start + (type === 'PT' ? 4 : 8), mealHour: null, paidHours: type === 'PT' ? 4 : 8 })
    }
  }
  const rate = rateOf(store?.regionId)
  return {
    departmentId: dept.id,
    departmentName: dept.name,
    storeId: dept.storeId,
    storeName: store?.name ?? dept.storeId,
    regionId: store?.regionId ?? '',
    storeFormat: store?.format ?? '',
    installedLanes: installed,
    forecastTransactions: hours.reduce((n, h) => n + h.lanesNeeded * 16, 0),
    hours,
    shifts: shiftRows.map((s) => ({ type: s.type, paidHours: s.paidHours })),
    cost: shiftRows.reduce((n, s) => n + s.paidHours * rate, 0) * dayFactor(date),
    shiftRows,
  }
}

const DEPTS: readonly MockDept[] = MOCK_DEPARTMENTS.map((d) => ({ ...d, index: Number(d.id.slice(-1)) - 1 }))

function scenarioMeta(id: string) {
  return MOCK_SCENARIOS.find((s) => s.id === id) ?? { id, name: id, season: 'christmas-2026', status: 'draft', stale: false }
}

function provenance(scenarioId: string, runId: string | null): PlanningProvenance {
  const s = scenarioMeta(scenarioId)
  return {
    scenarioId,
    scenarioName: s.name,
    scenarioStatus: s.status,
    runId,
    runAt: runId ? '2026-09-28T06:30:00+08:00' : null,
    snapshotIds: { pos: 'snap-pos-0928', staff: 'snap-staff-0901' },
    ruleVersionIds: ['rv-service-1', 'rv-wages-2'],
    synthetic: true,
    stale: s.stale,
  }
}

const WINDOW = { from: '2026-12-01', to: '2026-12-31', peakDay: '2026-12-19' }

let requestSeq = 0
function fail(code: ApiErrorCode, message: string): ApiResponse {
  requestSeq += 1
  return { status: HTTP_STATUS_BY_ERROR_CODE[code], body: { error: { code, message, requestId: `mock-plan-${requestSeq}` } } }
}

const deptRef = (d: { storeId: string; regionId: string }) => ({ id: d.storeId, regionId: d.regionId })

export interface MockPlanningStore {
  handle(input: { method: string; pathname: string; query: URLSearchParams; body: unknown; role: RoleCode; viewer: CostViewer }): ApiResponse | null
}

export function createPlanningStore(): MockPlanningStore {
  const hiringJobs = new Map<string, PlanningJob>()
  const rosterJobs = new Map<string, PlanningJob & { departmentId?: string }>()
  let seq = 0
  const now = () => new Date().toISOString()
  // The published plan already has a finished hiring plan.
  hiringJobs.set('scn-xmas-2026-v3', {
    id: 'job-hiring-v3',
    type: 'hiring_plan',
    scenarioId: 'scn-xmas-2026-v3',
    status: 'succeeded',
    progress: 1,
    unitsDone: DEPTS.length,
    unitsTotal: DEPTS.length,
    createdAt: '2026-09-28T07:00:00+08:00',
    startedAt: '2026-09-28T07:00:00+08:00',
    finishedAt: '2026-09-28T07:02:00+08:00',
    errorMessage: null,
    from: WINDOW.from,
    to: WINDOW.to,
  })

  function networkDraft(scenarioId: string, role: RoleCode, q: URLSearchParams): CostDraft<NetworkView> {
    const date = q.get('date') || WINDOW.peakDay
    const scope = new Set(mockStoreScope(role))
    const filter = { regionId: q.get('region') ?? '', storeFormat: q.get('format') ?? '', storeId: q.get('store') ?? '', departmentId: q.get('dept') ?? '' }
    const rows = DEPTS.filter((d) => scope.has(d.storeId))
      .map((d) => departmentFigures(deptInput(scenarioId, d, date)))
      .filter((f) => matchesNetworkFilter(f, filter))
    const agg = aggregateNetwork(rows)
    const day = new Date(`${date}T00:00:00Z`).getUTCDay()
    return {
      provenance: provenance(scenarioId, `run-${scenarioId}`),
      date,
      dayType: date.endsWith('12-25') ? 'regularHoliday' : date.endsWith('12-24') ? 'special' : day >= 0 ? 'regular' : 'regular',
      hours: agg.hours,
      kpis: { ...agg.kpis, cost: costFigure({ level: 'network' }, agg.kpis.cost) },
      stores: agg.stores.map((s) => ({
        ...s,
        cost: costFigure({ level: 'store', store: deptRef(s) }, s.cost),
        departments: s.departments.map((d) => ({ ...d, cost: costFigure({ level: 'department', store: deptRef(d) }, d.cost) })),
      })),
    }
  }

  function departmentDraft(scenarioId: string, dept: MockDept, date: string): CostDraft<DepartmentDayView> {
    const input = deptInput(scenarioId, dept, date)
    const f = departmentFigures(input)
    return {
      provenance: provenance(scenarioId, `run-${scenarioId}`),
      date,
      dayType: 'regular',
      serviceTarget: { serviceLevel: 0.9, thresholdSec: 60 },
      shrinkage: 0.17,
      figures: { ...f, cost: costFigure({ level: 'department', store: deptRef(f) }, f.cost) },
      hours: input.hours.map((h) => {
        const erl = Math.max(0.1, h.lanesOpen * 0.78)
        return {
          hour: h.hour,
          transactions: h.lanesNeeded * 16,
          erlangs: Math.round(erl * 100) / 100,
          lanesNeeded: h.lanesNeeded,
          lanesOpen: h.lanesOpen,
          cashiersRequired: h.cashiersRequired,
          scheduled: input.shiftRows.filter((s) => h.hour >= s.start && h.hour < s.end && s.mealHour !== h.hour).length,
          utilization: erl / Math.max(1, h.lanesOpen),
          serviceLevel: h.overCapacity ? 0.74 : 0.91,
          avgWaitSec: h.overCapacity ? 38 : 11,
          overCapacity: h.overCapacity,
        }
      }),
      shifts: input.shiftRows,
    }
  }

  function hiringRaw(scenarioId: string, role: RoleCode) {
    const scope = new Set(mockStoreScope(role))
    const growth = 1 + hash(scenarioId) * 0.1
    const stores = MOCK_STORES.filter((s) => scope.has(s.id)).map((s, i) => {
      const departments = DEPTS.filter((d) => d.storeId === s.id).map((d) => {
        const baseline = Math.round((DEPT_SIZE[d.index]?.base ?? 2) * 2.2 * (STORE_SCALE[s.id] ?? 1))
        const hires = Math.round(baseline * 0.6 * growth)
        const hiresByType = { FT: Math.round(hires * 0.6), PT: hires - Math.round(hires * 0.6), FLOAT: 0 }
        const paidHours = (baseline + hires) * 6 * 31
        return {
          departmentId: d.id,
          departmentName: d.name,
          baseline,
          season: baseline + hires,
          hires,
          hiresByType,
          neededBy: i % 2 === 0 ? '2026-11-30' : '2026-12-07',
          busiestWeek: '2026-12-21',
          shifts: Math.round(paidHours / 7),
          paidHours,
          cost: paidHours * rateOf(s.regionId),
          ftAvgWeeklyHours: 46.5,
        }
      })
      const sum = (f: (d: (typeof departments)[number]) => number) => departments.reduce((n, d) => n + f(d), 0)
      return {
        storeId: s.id,
        storeName: s.name,
        regionId: s.regionId,
        baseline: sum((d) => d.baseline),
        season: sum((d) => d.season),
        hires: sum((d) => d.hires),
        hiresByType: { FT: sum((d) => d.hiresByType.FT), PT: sum((d) => d.hiresByType.PT), FLOAT: 0 },
        neededBy: departments[0]?.neededBy ?? null,
        busiestWeek: '2026-12-21',
        shifts: sum((d) => d.shifts),
        paidHours: sum((d) => d.paidHours),
        cost: sum((d) => d.cost),
        departments,
      }
    }) satisfies (Omit<HiringStoreRow, 'cost'> & { cost: number })[]
    const today = DEMO_TODAY
    const ft = stores.reduce((n, s) => n + s.hiresByType.FT, 0)
    const pt = stores.reduce((n, s) => n + s.hiresByType.PT, 0)
    const milestones: [string, string, PlanningContractType, number][] = [
      ['2026-10-19', 'Requisition approved', 'FT', ft],
      ['2026-10-23', 'Job posted', 'FT', ft],
      ['2026-11-02', 'Interviews complete', 'FT', ft],
      ['2026-11-09', 'Offers accepted', 'FT', ft],
      ['2026-11-02', 'Requisition approved', 'PT', pt],
      ['2026-11-16', 'Offers accepted', 'PT', pt],
      ['2026-11-23', 'Onboarding and POS training', 'FT', ft],
      ['2026-11-30', 'Start on the floor', 'FT', ft],
      ['2026-11-30', 'Start on the floor', 'PT', pt],
    ]
    const timeline: HiringMilestone[] = milestones
      .map(([date, name, contractType, count]) => ({ date, name, contractType, count, waveId: `wave-${contractType.toLowerCase()}-2026-11-30`, status: milestoneStatus(date, today) }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    const waves = [{ needBy: '2026-11-30', recruitStart: '2026-10-19', storeIds: stores.map((s) => s.storeId) }]
    return { stores, timeline, kpis: hiringKpisFor(stores, waves) }
  }

  function hiringDraft(scenarioId: string, role: RoleCode): CostDraft<HiringPlanView> {
    const job = hiringJobs.get(scenarioId) ?? null
    const done = job?.status === 'succeeded'
    const raw = done ? hiringRaw(scenarioId, role) : null
    return {
      provenance: provenance(scenarioId, done ? job.id : null),
      job,
      from: WINDOW.from,
      to: WINDOW.to,
      plan: raw && {
        kpis: { ...raw.kpis, seasonCost: costFigure({ level: 'network' }, raw.kpis.seasonCost) },
        timeline: raw.timeline,
        stores: raw.stores.map((s) => ({
          ...s,
          cost: costFigure({ level: 'store', store: deptRef(s) }, s.cost),
          departments: s.departments.map((d) => ({ ...d, cost: costFigure({ level: 'department', store: deptRef(s) }, d.cost) })),
        })),
      },
    }
  }

  function summaryDraft(scenarioId: string, role: RoleCode): CostDraft<LeadershipSummary> {
    const job = hiringJobs.get(scenarioId)
    const raw = job?.status === 'succeeded' ? hiringRaw(scenarioId, role) : null
    const net = networkDraft(scenarioId, role, new URLSearchParams())
    return {
      provenance: provenance(scenarioId, job?.status === 'succeeded' ? job.id : null),
      generatedAt: now(),
      season: scenarioMeta(scenarioId).season,
      from: WINDOW.from,
      to: WINDOW.to,
      storeCount: raw?.stores.length ?? 0,
      departmentCount: raw ? raw.stores.reduce((n, s) => n + s.departments.length, 0) : 0,
      sampleData: true,
      hiring: raw && {
        kpis: { ...raw.kpis, seasonCost: costFigure({ level: 'network' }, raw.kpis.seasonCost) },
        timeline: raw.timeline,
        stores: raw.stores.map((s) => ({ storeId: s.storeId, storeName: s.storeName, baseline: s.baseline, hires: s.hires, neededBy: s.neededBy })),
      },
      peak: { date: net.date, hour: net.kpis.peakHour as number, lanesOpen: net.kpis.peakLanes as number },
      offersDue: raw ? offersDueOf(raw.timeline) : null,
    }
  }

  /** One poll = one step of progress, so the UI's progress bar can be seen working. */
  function advance(job: PlanningJob): PlanningJob {
    if (job.status === 'succeeded' || job.status === 'failed') return job
    const unitsDone = Math.min(job.unitsTotal, job.unitsDone + Math.ceil(job.unitsTotal / 3))
    const finished = unitsDone >= job.unitsTotal
    return {
      ...job,
      status: finished ? 'succeeded' : 'running',
      unitsDone,
      progress: finished ? 1 : Math.round((unitsDone / job.unitsTotal) * 100) / 100,
      startedAt: job.startedAt ?? now(),
      finishedAt: finished ? now() : null,
    }
  }

  function newJob(type: PlanningJob['type'], scenarioId: string, from: string, to: string): PlanningJob {
    seq += 1
    return {
      id: `job-${type}-${seq}`,
      type,
      scenarioId,
      status: 'queued',
      progress: 0,
      unitsDone: 0,
      unitsTotal: type === 'hiring_plan' ? DEPTS.length : 1,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      from,
      to,
    }
  }

  return {
    handle({ method, pathname, query, body, role, viewer }) {
      const m = /^\/scenarios\/([^/]+)\/(network|departments|hiring-plan|rosters|summary)(?:\/(.*))?$/.exec(pathname)
      if (!m) return null
      const scenarioId = decodeURIComponent(m[1] ?? '')
      const area = m[2] ?? ''
      const rest = m[3] ?? ''
      const ok = (draft: unknown, status = 200): ApiResponse => ({ status, body: shapeCost<unknown>(draft, viewer) })
      const allow = (resource: RbacResource, action: PermissionAction) => can(role, resource, action)
      const deny = () => fail('forbidden', 'You don’t have access to this.')
      const meta = MOCK_SCENARIOS.find((s) => s.id === scenarioId)
      if (meta && seesPublishedScenariosOnly(role) && meta.status !== 'published') return fail('not_found', 'We couldn’t find that.')
      const download = (fileName: string, content: string, contentType = 'text/csv'): ApiResponse => ({
        status: 200,
        body: { fileName, contentType, content } satisfies FileDownload,
      })
      const header = { generatedAt: now(), generatedBy: 'demo@smretail.com', filters: query.toString() }

      if (area === 'network') {
        const exporting = rest === 'export'
        if (!allow('network_view', exporting ? 'export' : 'view')) return deny()
        const date = query.get('date') || WINDOW.peakDay
        if (date < WINDOW.from || date > WINDOW.to) return fail('validation_failed', `Pick a date between ${WINDOW.from} and ${WINDOW.to}.`)
        const draft = networkDraft(scenarioId, role, query)
        if (!exporting) return ok({ view: draft })
        return download(`network-${date}.csv`, networkViewCsv(shapeCost<NetworkView>(draft, viewer), header))
      }

      if (area === 'departments') {
        const [deptId = '', day, exp] = rest.split('/')
        if (day !== 'day') return fail('not_found', 'We couldn’t find that.')
        const exporting = exp === 'export'
        if (!allow('department_plan', exporting ? 'export' : 'view')) return deny()
        const dept = DEPTS.find((d) => d.id === decodeURIComponent(deptId))
        if (!dept || !mockStoreScope(role).includes(dept.storeId)) return fail('not_found', 'This item doesn’t exist or you don’t have access to it.')
        const date = query.get('date') || WINDOW.peakDay
        const draft = departmentDraft(scenarioId, dept, date)
        if (!exporting) return ok({ view: draft })
        return download(`department-${dept.id}-${date}.csv`, departmentDayCsv(shapeCost<DepartmentDayView>(draft, viewer), header))
      }

      if (area === 'hiring-plan') {
        if (rest === '' && method === 'GET') return allow('hiring_plan', 'view') ? ok({ view: hiringDraft(scenarioId, role) }) : deny()
        if (rest === 'export') {
          if (!allow('hiring_plan', 'export')) return deny()
          const view = shapeCost<HiringPlanView>(hiringDraft(scenarioId, role), viewer)
          if (!view.plan) return fail('conflict', 'Run the hiring plan before exporting it.')
          return download('hiring-plan.csv', hiringPlanCsv(view, header))
        }
        if (rest === 'jobs' && method === 'POST') {
          if (!allow('hiring_plan', 'edit')) return deny()
          const existing = hiringJobs.get(scenarioId)
          if (existing && existing.status !== 'failed') return ok({ job: existing, cached: true })
          const job = newJob('hiring_plan', scenarioId, WINDOW.from, WINDOW.to)
          hiringJobs.set(scenarioId, job)
          return ok({ job, cached: false }, 202)
        }
        const jm = /^jobs\/([^/]+)$/.exec(rest)
        if (jm && method === 'GET') {
          if (!allow('hiring_plan', 'view')) return deny()
          const job = hiringJobs.get(scenarioId)
          if (!job || job.id !== jm[1]) return fail('not_found', 'We couldn’t find that.')
          const next = advance(job)
          hiringJobs.set(scenarioId, next)
          return ok({ job: next })
        }
      }

      if (area === 'rosters') {
        if (rest === 'jobs' && method === 'POST') {
          if (!allow('weekly_roster', 'edit')) return deny()
          const b = (body ?? {}) as { from?: string; to?: string; departmentId?: string }
          const days = b.from && b.to ? (Date.parse(b.to) - Date.parse(b.from)) / 86_400_000 + 1 : 0
          if (days < 29 || days > 92) return fail('validation_failed', 'Background rosters cover 29 to 92 days.')
          const job = { ...newJob('long_roster', scenarioId, b.from ?? '', b.to ?? ''), ...(b.departmentId ? { departmentId: b.departmentId } : {}) }
          rosterJobs.set(job.id, job)
          return ok({ job, cached: false }, 202)
        }
        const jm = /^jobs\/([^/]+)$/.exec(rest)
        if (jm && method === 'GET') {
          if (!allow('weekly_roster', 'view')) return deny()
          const job = rosterJobs.get(jm[1] ?? '')
          if (!job) return fail('not_found', 'We couldn’t find that.')
          const next = { ...job, ...advance(job) }
          rosterJobs.set(next.id, next)
          const scope = mockStoreScope(role)
          const depts = DEPTS.filter((d) => scope.includes(d.storeId) && (!job.departmentId || d.id === job.departmentId))
          const weeks = next.status === 'succeeded'
            ? depts.flatMap((d) => {
                const f = departmentFigures(deptInput(scenarioId, d, WINDOW.peakDay))
                return ['2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28'].map((weekStart) => ({
                  storeId: f.storeId,
                  storeName: f.storeName,
                  regionId: f.regionId,
                  departmentId: f.departmentId,
                  departmentName: f.departmentName,
                  weekStart,
                  shifts: f.cashiers * 7,
                  assigned: f.cashiers * 7 - 2,
                  openShifts: 2,
                  paidHours: f.paidHours * 7,
                  laborWarnings: 0,
                  cost: costFigure({ level: 'department', store: deptRef(f) }, f.cost * 7),
                }))
              })
            : null
          return ok({ view: { provenance: provenance(scenarioId, next.id), job: next, weeks } satisfies CostDraft<LongRosterView> })
        }
      }

      if (area === 'summary') {
        const exporting = rest === 'export'
        if (!allow('leadership_summary', exporting ? 'export' : 'view')) return deny()
        const draft = summaryDraft(scenarioId, role)
        if (!exporting) return ok({ summary: draft })
        const summary = shapeCost<LeadershipSummary>(draft, viewer)
        if (query.get('format') === 'csv') return download('leadership-summary.csv', leadershipSummaryCsv(summary, header))
        const k = summary.hiring?.kpis
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${summary.provenance.scenarioName}</title><style>@page { size: A4; }</style></head><body><p>SAMPLE DATA</p><h1>${summary.provenance.scenarioName}</h1><p>${k ? `${k.seasonalHires} seasonal hires (+${growthPct(k.baselineTeam, k.seasonalHires)}%)` : ''}</p></body></html>`
        return download('leadership-summary.html', html, 'text/html')
      }

      return fail('not_found', 'We couldn’t find that.')
    },
  }
}
