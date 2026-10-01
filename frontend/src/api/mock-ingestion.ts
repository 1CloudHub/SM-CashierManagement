import {
  DATASET_TYPES,
  HTTP_STATUS_BY_ERROR_CODE,
  ISSUES_PREVIEW_LIMIT,
  buildCsvExport,
  can,
  canChangeSyntheticFlag,
  provenanceInfo,
  type AffectedScenario,
  type ApiErrorCode,
  type ApiErrorDetail,
  type DatasetListResponse,
  type DatasetSnapshot,
  type DatasetType,
  type FileDownload,
  type IngestionDetail,
  type IngestionIssue,
  type IngestionRunDto,
  type LoadIngestionResponse,
  type ProvenanceInfo,
  type RoleCode,
  type UploadUrlResponse,
  type WithProvenance,
} from '@lanewise/shared'
import type { ApiResponse } from './client'
import { PEOPLE, WORLD_DEPARTMENTS, WORLD_SCENARIOS, WORLD_STAFF, WORLD_STORES, demoNow } from './mock-world'

/**
 * In-memory data sources and ingestion for the mock API (task 9, SCR-050/051):
 * datasets in use, ingestion history (a loaded POS refresh, the rejected
 * upload the day before, master and staff loads), snapshots, validation and
 * load — with the API's guards ("Data ingestion": Admin and Planner view,
 * Rules Steward manages; the provenance banner is for everyone). Uploads get
 * a `mock:` URL (nothing is stored) and validate to a deterministic result.
 * Sample data — simulated, not SM actuals.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type Run = Mutable<IngestionRunDto>

const STEWARD = PEOPLE.steward
const FORMER_STEWARD = PEOPLE.formerSteward
const MASTER_ROWS = WORLD_DEPARTMENTS.length
const STAFF_ROWS = WORLD_STAFF.length

const SNAPSHOTS: DatasetSnapshot[] = [
  { id: 'snap-pos-0928', type: 'pos', coversFrom: '2025-08-01', coversTo: '2025-12-31', rowCount: 47_548, synthetic: true, loadedAt: '2026-09-28T14:02:00+08:00' },
  { id: 'snap-pos-0915', type: 'pos', coversFrom: '2025-08-01', coversTo: '2025-11-30', rowCount: 38_016, synthetic: true, loadedAt: '2026-09-15T06:00:00+08:00' },
  { id: 'snap-pos-0812', type: 'pos', coversFrom: '2025-08-01', coversTo: '2025-10-31', rowCount: 28_512, synthetic: true, loadedAt: '2026-08-12T09:30:00+08:00' },
  { id: 'snap-master-0920', type: 'master', coversFrom: '2026-09-20', coversTo: '2026-09-20', rowCount: MASTER_ROWS, synthetic: true, loadedAt: '2026-09-20T10:15:00+08:00' },
  { id: 'snap-master-0805', type: 'master', coversFrom: '2026-08-05', coversTo: '2026-08-05', rowCount: MASTER_ROWS - 3, synthetic: true, loadedAt: '2026-08-05T11:00:00+08:00' },
  { id: 'snap-staff-0901', type: 'staff', coversFrom: '2026-09-01', coversTo: '2026-09-01', rowCount: STAFF_ROWS, synthetic: true, loadedAt: '2026-09-01T06:00:00+08:00' },
]

const run = (r: Omit<Run, 'validRowCount' | 'synthetic'> & { validRowCount?: number }): Run => ({
  ...r,
  validRowCount: r.validRowCount ?? r.rowCount - r.errorCount,
  synthetic: true,
})

/** Ingestion history, newest first (wireframe SCR-050: the Sep 27 upload was rejected, the Sep 28 one loaded). */
const RUNS: Run[] = [
  run({ id: 'run-pos-0928', datasetType: 'pos', userId: STEWARD.id, userName: STEWARD.short, fileName: 'pos_hourly_aug-dec_2025_v2.csv', rowCount: 47_548, warningCount: 8, errorCount: 0, status: 'loaded', snapshotId: 'snap-pos-0928', coversFrom: '2025-08-01', coversTo: '2025-12-31', startedAt: '2026-09-28T14:00:00+08:00', finishedAt: '2026-09-28T14:02:00+08:00', staleScenarioCount: 2 }),
  run({ id: 'run-pos-0927', datasetType: 'pos', userId: STEWARD.id, userName: STEWARD.short, fileName: 'pos_hourly_aug-dec_2025.csv', rowCount: 47_548, warningCount: 8, errorCount: 112, status: 'blocked', snapshotId: null, coversFrom: '2025-08-01', coversTo: '2025-12-31', startedAt: '2026-09-27T09:38:00+08:00', finishedAt: '2026-09-27T09:40:00+08:00', staleScenarioCount: 0 }),
  run({ id: 'run-master-0920', datasetType: 'master', userId: STEWARD.id, userName: STEWARD.short, fileName: 'stores_departments_lanes_2026-09.csv', rowCount: MASTER_ROWS, warningCount: 0, errorCount: 0, status: 'loaded', snapshotId: 'snap-master-0920', coversFrom: '2026-09-20', coversTo: '2026-09-20', startedAt: '2026-09-20T10:14:00+08:00', finishedAt: '2026-09-20T10:15:00+08:00', staleScenarioCount: 0 }),
  run({ id: 'run-pos-0915', datasetType: 'pos', userId: STEWARD.id, userName: STEWARD.short, fileName: 'pos_hourly_aug-nov_2025.csv', rowCount: 38_016, warningCount: 3, errorCount: 0, status: 'loaded', snapshotId: 'snap-pos-0915', coversFrom: '2025-08-01', coversTo: '2025-11-30', startedAt: '2026-09-15T05:58:00+08:00', finishedAt: '2026-09-15T06:00:00+08:00', staleScenarioCount: 1 }),
  run({ id: 'run-staff-0901', datasetType: 'staff', userId: FORMER_STEWARD.id, userName: FORMER_STEWARD.short, fileName: 'staff_roster_2026-09.csv', rowCount: STAFF_ROWS, warningCount: 2, errorCount: 0, status: 'loaded', snapshotId: 'snap-staff-0901', coversFrom: '2026-09-01', coversTo: '2026-09-01', startedAt: '2026-09-01T05:59:00+08:00', finishedAt: '2026-09-01T06:00:00+08:00', staleScenarioCount: 0 }),
  run({ id: 'run-staff-0829', datasetType: 'staff', userId: FORMER_STEWARD.id, userName: FORMER_STEWARD.short, fileName: 'staff_roster_draft.csv', rowCount: STAFF_ROWS - 4, warningCount: 5, errorCount: 0, status: 'cancelled', snapshotId: null, coversFrom: null, coversTo: null, startedAt: '2026-08-29T16:20:00+08:00', finishedAt: '2026-08-29T16:31:00+08:00', staleScenarioCount: 0 }),
  run({ id: 'run-pos-0812', datasetType: 'pos', userId: FORMER_STEWARD.id, userName: FORMER_STEWARD.short, fileName: 'pos_hourly_aug-oct_2025.csv', rowCount: 28_512, warningCount: 0, errorCount: 0, status: 'loaded', snapshotId: 'snap-pos-0812', coversFrom: '2025-08-01', coversTo: '2025-10-31', startedAt: '2026-08-12T09:28:00+08:00', finishedAt: '2026-08-12T09:30:00+08:00', staleScenarioCount: 0 }),
  run({ id: 'run-pos-0811', datasetType: 'pos', userId: FORMER_STEWARD.id, userName: FORMER_STEWARD.short, fileName: 'pos_export.xlsx.csv', rowCount: 0, validRowCount: 0, warningCount: 0, errorCount: 1, status: 'failed', snapshotId: null, coversFrom: null, coversTo: null, startedAt: '2026-08-11T17:05:00+08:00', finishedAt: '2026-08-11T17:05:00+08:00', staleScenarioCount: 0 }),
  run({ id: 'run-master-0805', datasetType: 'master', userId: FORMER_STEWARD.id, userName: FORMER_STEWARD.short, fileName: 'stores_departments_lanes_2026-08.csv', rowCount: MASTER_ROWS - 3, warningCount: 1, errorCount: 0, status: 'loaded', snapshotId: 'snap-master-0805', coversFrom: '2026-08-05', coversTo: '2026-08-05', startedAt: '2026-08-05T10:59:00+08:00', finishedAt: '2026-08-05T11:00:00+08:00', staleScenarioCount: 0 }),
]

const STORE_CODES = WORLD_STORES.map((s) => s.code.toUpperCase())

/** Deterministic findings for a run: warnings on busy hours above installed lanes, errors on an unknown store code. */
function issuesFor(r: Run): IngestionIssue[] {
  const out: IngestionIssue[] = []
  if (r.status === 'failed') return [{ row: 0, severity: 'error', code: 'unreadable', message: 'The file is not a UTF-8 CSV. Export it again as CSV.' }]
  for (let i = 0; i < r.errorCount; i += 1) {
    out.push({ row: 1_204 + i * 37, column: 'store_code', severity: 'error', code: 'unknown_store', message: `Unknown store code “SMSM-CEB${i % 3}”. Use one of ${STORE_CODES.slice(0, 3).join(', ')}, …` })
  }
  for (let i = 0; i < r.warningCount; i += 1) {
    const store = STORE_CODES[i % STORE_CODES.length] ?? ''
    out.push(
      r.datasetType === 'pos'
        ? { row: 9_310 + i * 811, column: 'lanes_open', severity: 'warning', code: 'lanes_over_installed', message: `${store}: more lanes open than installed (Dec ${18 + (i % 6)}, ${13 + (i % 6)}:00).` }
        : { row: 2 + i * 3, column: 'email', severity: 'warning', code: 'missing_optional', message: 'No work email: offers will reach this cashier in the app only.' },
    )
  }
  return out
}

const SCENARIO_IMPACT: readonly AffectedScenario[] = WORLD_SCENARIOS.filter((s) => s.season === 'christmas-2026' && (s.status === 'submitted' || s.status === 'draft')).map((s) => ({
  id: s.id,
  name: s.name,
  status: s.status,
  ownerId: PEOPLE.planner.id,
  alreadyStale: s.stale,
}))

let seq = 0
function fail(code: ApiErrorCode, message: string, details?: ApiErrorDetail[]): ApiResponse {
  seq += 1
  return { status: HTTP_STATUS_BY_ERROR_CODE[code], body: { error: { code, message, requestId: `mock-ing-${seq}`, ...(details ? { details } : {}) } } }
}
const ok = (body: unknown, status = 200): ApiResponse => ({ status, body })
const notFound = () => fail('not_found', 'We couldn’t find that upload. It may have been cancelled.')
const forbidden = () => fail('forbidden', 'You do not have access to this resource.')
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isDatasetType = (v: unknown): v is DatasetType => typeof v === 'string' && (DATASET_TYPES as readonly string[]).includes(v)

export interface MockIngestionStore {
  owns(pathname: string): boolean
  handle(input: { method: string; pathname: string; query: URLSearchParams; body: unknown; role: RoleCode }): ApiResponse
}

export function createIngestionStore(now: () => string = () => demoNow().toISOString()): MockIngestionStore {
  const runs: Run[] = RUNS.map((r) => ({ ...r }))
  const snapshots: DatasetSnapshot[] = SNAPSHOTS.map((s) => ({ ...s }))
  const uploads = new Map<string, { datasetType: DatasetType; fileName: string }>()

  const current = (type: DatasetType, synthetic: boolean) =>
    snapshots.filter((s) => s.type === type && s.synthetic === synthetic).sort((a, b) => Date.parse(b.loadedAt) - Date.parse(a.loadedAt))[0] ?? null
  const inUse = (type: DatasetType) => current(type, false) ?? current(type, true)
  const provenance = (): ProvenanceInfo =>
    provenanceInfo(DATASET_TYPES.map((type) => inUse(type)).filter((s): s is DatasetSnapshot => s !== null).map((s) => ({ type: s.type, synthetic: s.synthetic })))
  const detail = (r: Run): WithProvenance<IngestionDetail> => {
    const issues = issuesFor(r)
    return {
      run: { ...r },
      issues: issues.slice(0, ISSUES_PREVIEW_LIMIT),
      issuesTruncated: issues.length > ISSUES_PREVIEW_LIMIT,
      impact: r.datasetType === 'pos' && (r.status === 'validated' || r.status === 'loaded') ? SCENARIO_IMPACT : [],
      provenance: provenance(),
    }
  }
  const csv = (title: string, meta: readonly (readonly [string, string])[], columns: readonly string[], rows: readonly (readonly string[])[]): FileDownload => ({
    fileName: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`,
    contentType: 'text/csv',
    content: buildCsvExport({ title, generatedAt: now(), generatedBy: STEWARD.email, sampleData: provenance().sampleData, meta, columns, rows }),
  })

  return {
    owns: (pathname) => /^\/(datasets|ingestions|snapshots)(\/|$)/.test(pathname),
    handle({ method, pathname, query, body, role }) {
      const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
      // The sample-data banner is for every signed-in role (Req 18.1).
      if (pathname === '/datasets/provenance' && method === 'GET') return ok(provenance())
      if (!can(role, 'data_ingestion', 'view')) return forbidden()
      const manage = can(role, 'data_ingestion', 'manage')

      if (parts[0] === 'datasets' && parts.length === 1 && method === 'GET') {
        const body: WithProvenance<DatasetListResponse> = {
          datasets: DATASET_TYPES.map((type) => ({
            type,
            current: inUse(type),
            currentReal: current(type, false),
            currentSynthetic: current(type, true),
            lastRun: runs.find((r) => r.datasetType === type) ?? null,
          })),
          provenance: provenance(),
        }
        return ok(body)
      }

      if (parts[0] === 'snapshots') {
        if (parts.length === 1 && method === 'GET') {
          const type = query.get('datasetType')
          const list = snapshots
            .filter((s) => !isDatasetType(type) || s.type === type)
            .filter((s) => query.get('current') !== 'true' || inUse(s.type)?.id === s.id)
            .sort((a, b) => Date.parse(b.loadedAt) - Date.parse(a.loadedAt))
          return ok({ snapshots: list, provenance: provenance() })
        }
        const snap = snapshots.find((s) => s.id === parts[1])
        if (!snap || parts.length !== 2) return notFound()
        if (method === 'GET') return ok(snap)
        if (method !== 'PATCH') return notFound()
        if (!manage) return forbidden()
        const synthetic = isRecord(body) ? body.synthetic : undefined
        if (typeof synthetic !== 'boolean') return fail('validation_failed', 'Some fields are missing or invalid.', [{ path: 'body.synthetic', message: 'Required.' }])
        if (!canChangeSyntheticFlag(role, snap.synthetic, synthetic)) return fail('conflict', 'The flag already has that value.')
        const next = { ...snap, synthetic }
        snapshots.splice(snapshots.indexOf(snap), 1, next)
        return ok(next)
      }

      // /ingestions…
      if (parts.length === 1) {
        if (method === 'GET') {
          const type = query.get('datasetType')
          const limit = Number(query.get('limit') ?? '50')
          return ok({ runs: runs.filter((r) => !isDatasetType(type) || r.datasetType === type).slice(0, Number.isInteger(limit) && limit > 0 ? limit : 50), provenance: provenance() })
        }
        if (method !== 'POST') return notFound()
        if (!manage) return forbidden()
        const b = isRecord(body) ? body : {}
        const upload = typeof b.fileKey === 'string' ? uploads.get(b.fileKey) : undefined
        if (!upload || !isDatasetType(b.datasetType) || upload.datasetType !== b.datasetType) {
          return fail('validation_failed', 'Some fields are missing or invalid.', [{ path: 'body.fileKey', message: 'Upload the file to the presigned URL first.' }])
        }
        seq += 1
        const at = now()
        const rows = upload.datasetType === 'pos' ? 48_216 : upload.datasetType === 'master' ? MASTER_ROWS : STAFF_ROWS
        const created = run({
          id: `run-new-${seq}`,
          datasetType: upload.datasetType,
          userId: role === 'RST' ? STEWARD.id : `u-${role.toLowerCase()}`,
          userName: role === 'RST' ? STEWARD.short : `Demo ${role}`,
          fileName: upload.fileName,
          rowCount: rows,
          warningCount: upload.datasetType === 'pos' ? 4 : 1,
          errorCount: 0,
          status: 'validated',
          snapshotId: null,
          coversFrom: upload.datasetType === 'pos' ? '2025-08-01' : null,
          coversTo: upload.datasetType === 'pos' ? '2025-12-31' : null,
          startedAt: at,
          finishedAt: at,
          staleScenarioCount: 0,
        })
        created.synthetic = b.synthetic !== false
        runs.unshift(created)
        return ok(detail(created), 201)
      }
      if (parts[1] === 'uploads' && method === 'POST') {
        if (!manage) return forbidden()
        const b = isRecord(body) ? body : {}
        if (!isDatasetType(b.datasetType) || typeof b.fileName !== 'string' || !/\.csv$/i.test(b.fileName)) {
          return fail('validation_failed', 'Some fields are missing or invalid.', [{ path: 'body.fileName', message: 'Upload a .csv file.' }])
        }
        seq += 1
        const fileKey = `uploads/${b.datasetType}/mock-${seq}/${b.fileName}`
        uploads.set(fileKey, { datasetType: b.datasetType, fileName: b.fileName })
        const res: UploadUrlResponse = { fileKey, uploadUrl: `mock://${fileKey}`, headers: { 'Content-Type': 'text/csv' }, expiresAt: new Date(Date.parse(now()) + 15 * 60_000).toISOString() }
        return ok(res, 201)
      }
      if (parts[1] === 'export' && method === 'GET') {
        return ok(
          csv(
            'Ingestion history',
            [],
            ['Started', 'Dataset', 'File', 'User', 'Rows', 'Warnings', 'Errors', 'Status'],
            runs.map((r) => [r.startedAt, r.datasetType, r.fileName, r.userName ?? '', String(r.rowCount), String(r.warningCount), String(r.errorCount), r.status]),
          ),
        )
      }
      const r = runs.find((x) => x.id === parts[1])
      if (!r || parts.length > 3) return notFound()
      const action = parts[2]
      if (action === undefined && method === 'GET') return ok(detail(r))
      if (action === 'report' && method === 'GET') {
        return ok(
          csv(
            `Validation report ${r.fileName}`,
            [
              ['Dataset', r.datasetType],
              ['File', r.fileName],
            ],
            ['Row', 'Column', 'Severity', 'Code', 'Message'],
            issuesFor(r).map((i) => [String(i.row), i.column ?? '', i.severity, i.code, i.message]),
          ),
        )
      }
      if (method !== 'POST' || !manage) return manage ? notFound() : forbidden()
      if (action === 'cancel') {
        if (r.status !== 'validated') return fail('conflict', `A ${r.status} upload cannot be cancelled.`)
        r.status = 'cancelled'
        r.finishedAt = now()
        return ok({ run: { ...r } })
      }
      if (action === 'load') {
        if (r.status !== 'validated') return fail('conflict', `A ${r.status} upload cannot be loaded.`)
        if (r.warningCount > 0 && !(isRecord(body) && body.confirmWarnings === true)) {
          return fail('validation_failed', 'Confirm the warnings to load this file.', [{ path: 'body.confirmWarnings', message: 'Required when the file has warnings.' }])
        }
        const at = now()
        const snapshot: DatasetSnapshot = {
          id: `snap-${r.id}`,
          type: r.datasetType,
          coversFrom: r.coversFrom ?? at.slice(0, 10),
          coversTo: r.coversTo ?? at.slice(0, 10),
          rowCount: r.validRowCount,
          synthetic: r.synthetic,
          loadedAt: at,
        }
        snapshots.push(snapshot)
        const stale = r.datasetType === 'pos' ? SCENARIO_IMPACT : []
        r.status = 'loaded'
        r.snapshotId = snapshot.id
        r.staleScenarioCount = stale.filter((s) => !s.alreadyStale).length
        r.finishedAt = at
        const res: LoadIngestionResponse = { run: { ...r }, snapshot, staleScenarios: stale }
        return ok(res)
      }
      return notFound()
    },
  }
}
