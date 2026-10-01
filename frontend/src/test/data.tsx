import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import type {
  AffectedScenario,
  DatasetSnapshot,
  DatasetSummary,
  IngestionDetail,
  IngestionRunDto,
  ProvenanceInfo,
} from '@lanewise/shared'
import { AnnouncerProvider } from '@/components/a11y'
import { I18nProvider } from '@/i18n'
import type { DataApi } from '@/features/data/api'

export const REAL: ProvenanceInfo = { sampleData: false, syntheticDatasetTypes: [] }
export const SAMPLE: ProvenanceInfo = { sampleData: true, syntheticDatasetTypes: ['pos'] }

export function snapshot(overrides: Partial<DatasetSnapshot> = {}): DatasetSnapshot {
  return {
    id: 'snap-pos-1',
    type: 'pos',
    coversFrom: '2025-08-01',
    coversTo: '2025-12-31',
    rowCount: 47548,
    synthetic: true,
    loadedAt: '2026-09-28T06:02:00Z',
    ...overrides,
  }
}

export function run(overrides: Partial<IngestionRunDto> = {}): IngestionRunDto {
  return {
    id: 'run-1',
    datasetType: 'pos',
    userId: 'u-rst',
    userName: 'R. Santos',
    fileName: 'pos_hourly_2025.csv',
    rowCount: 47548,
    validRowCount: 47540,
    warningCount: 8,
    errorCount: 0,
    status: 'loaded',
    snapshotId: 'snap-pos-1',
    synthetic: true,
    coversFrom: '2025-08-01',
    coversTo: '2025-12-31',
    startedAt: '2026-09-28T06:00:00Z',
    finishedAt: '2026-09-28T06:02:00Z',
    staleScenarioCount: 3,
    ...overrides,
  }
}

export function summaries(): DatasetSummary[] {
  const pos = snapshot()
  const master = snapshot({ id: 'snap-master-1', type: 'master', rowCount: 24, loadedAt: '2026-09-20T02:00:00Z' })
  return [
    { type: 'pos', current: pos, currentReal: null, currentSynthetic: pos, lastRun: run() },
    { type: 'master', current: master, currentReal: null, currentSynthetic: master, lastRun: null },
    { type: 'staff', current: null, currentReal: null, currentSynthetic: null, lastRun: null },
  ]
}

export function scenario(id: string, name: string, alreadyStale = false): AffectedScenario {
  return { id, name, status: 'draft', ownerId: 'u-pln', alreadyStale }
}

export function detail(overrides: Partial<IngestionRunDto> = {}, extra: Partial<IngestionDetail> = {}): IngestionDetail & {
  provenance: ProvenanceInfo
} {
  const r = run({ id: 'run-new', status: 'validated', snapshotId: null, staleScenarioCount: 0, ...overrides })
  return {
    run: r,
    issues: [
      { row: 1204, column: 'lanes_open', severity: 'warning', code: 'lanes_over_installed', message: 'Lanes open is greater than installed lanes.' },
    ],
    issuesTruncated: false,
    impact: [scenario('sc-1', 'Christmas 2026 v3'), scenario('sc-2', 'Christmas 2026 v4', true)],
    provenance: SAMPLE,
    ...extra,
  }
}

/** A controllable fake of the data API (no network). */
export function fakeDataApi(overrides: Partial<DataApi> = {}) {
  const api = {
    listDatasets: vi.fn<DataApi['listDatasets']>().mockResolvedValue({ datasets: summaries(), provenance: SAMPLE }),
    getProvenance: vi.fn<DataApi['getProvenance']>().mockResolvedValue(SAMPLE),
    listIngestions: vi.fn<DataApi['listIngestions']>().mockResolvedValue({
      runs: [
        run(),
        run({ id: 'run-0', status: 'blocked', errorCount: 112, staleScenarioCount: 0, startedAt: '2026-09-27T01:40:00Z' }),
      ],
      provenance: SAMPLE,
    }),
    exportHistory: vi.fn<DataApi['exportHistory']>().mockResolvedValue({
      fileName: 'ingestion-history.csv',
      contentType: 'text/csv',
      content: 'SAMPLE DATA\r\n',
    }),
    requestUploadUrl: vi.fn<DataApi['requestUploadUrl']>().mockResolvedValue({
      fileKey: 'uploads/pos/abc.csv',
      uploadUrl: 'https://bucket.s3.amazonaws.com/uploads/pos/abc.csv?X-Amz-Signature=x',
      headers: { 'Content-Type': 'text/csv' },
      expiresAt: '2026-09-30T10:00:00Z',
    }),
    uploadFile: vi.fn<DataApi['uploadFile']>().mockResolvedValue(undefined),
    createIngestion: vi.fn<DataApi['createIngestion']>().mockResolvedValue(detail()),
    getIngestion: vi.fn<DataApi['getIngestion']>().mockResolvedValue(detail()),
    getReport: vi.fn<DataApi['getReport']>().mockResolvedValue({
      fileName: 'validation-report.csv',
      contentType: 'text/csv',
      content: 'row,column\r\n',
    }),
    loadIngestion: vi.fn<DataApi['loadIngestion']>().mockImplementation(async () => ({
      run: run({ id: 'run-new' }),
      snapshot: snapshot({ id: 'snap-pos-2', rowCount: 47540 }),
      staleScenarios: [scenario('sc-1', 'Christmas 2026 v3')],
    })),
    cancelIngestion: vi.fn<DataApi['cancelIngestion']>().mockResolvedValue({ run: run({ id: 'run-new', status: 'cancelled' }) }),
    listSnapshots: vi.fn<DataApi['listSnapshots']>().mockResolvedValue({ snapshots: [snapshot()], provenance: SAMPLE }),
    updateSnapshot: vi.fn<DataApi['updateSnapshot']>().mockResolvedValue(snapshot({ synthetic: false })),
    ...overrides,
  } satisfies DataApi
  return api
}

export function renderData(ui: ReactNode, locale: 'en' | 'fil' = 'en') {
  return render(
    <I18nProvider initialLocale={locale}>
      <AnnouncerProvider>{ui}</AnnouncerProvider>
    </I18nProvider>,
  )
}
