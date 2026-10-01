import { useState, type ReactNode } from 'react'
import type { FileDownload, PlanningJob, PlanningProvenance } from '@lanewise/shared'
import { AppLink } from '@/app/router'
import { useAnnouncer } from '@/components/a11y'
import { Cluster, Stack } from '@/components/layout'
import { Alert, Button, StatusPill } from '@/components/ui'
import { downloadFile } from '@/features/data/api'
import { useI18n } from '@/i18n'
import { settingsPath } from './logic'

/**
 * Shared building blocks of the planning screens (task 14): scenario
 * resolution, loading, provenance + sample-data labelling (P6, P9), the
 * stale banner, "View as table" chart alternatives, job progress and export.
 */

/** Where the figures come from: scenario, run, rules and data snapshots (P6), plus the sample-data pill (P9). */
export function ProvenanceLine({ provenance }: { provenance: PlanningProvenance }) {
  const { t, formatDateTime } = useI18n()
  return (
    <Cluster gap={2} align="center">
      <p className="text-body-sm text-text-muted">
        {t('planning.provenance', {
          scenario: provenance.scenarioName,
          status: t(`scenario.status.${provenance.scenarioStatus}`),
          run: provenance.runAt ? formatDateTime(provenance.runAt) : t('planning.notRun'),
          rules: provenance.ruleVersionIds.length,
          snapshots: Object.values(provenance.snapshotIds).join(', ') || t('planning.none'),
        })}
      </p>
      {provenance.synthetic && <StatusPill tone="warning">{t('planning.sampleData')}</StatusPill>}
    </Cluster>
  )
}

/** "Settings or data changed since this run" with the way to recalculate (P5). */
export function StaleBanner({ provenance, action }: { provenance: PlanningProvenance; action?: ReactNode }) {
  const { t } = useI18n()
  if (!provenance.stale) return null
  return (
    <Alert
      tone="warning"
      title={t('planning.stale.title')}
      action={action ?? <AppLink href={settingsPath(provenance.scenarioId)} className="underline focus-visible:outline-focus-ring">{t('planning.stale.open')}</AppLink>}
    >
      {t('planning.stale.body')}
    </Alert>
  )
}

/** A chart with its "View as table" alternative (Req 5.4); the text summary is always shown. */
export function ChartOrTable({
  title,
  summary,
  chart,
  table,
}: {
  title: string
  summary: string
  chart: ReactNode
  table: ReactNode
}) {
  const { t } = useI18n()
  const [asTable, setAsTable] = useState(false)
  return (
    <Stack gap={2}>
      <Cluster gap={3} align="center" className="justify-between">
        <h2 className="text-h3 text-text">{title}</h2>
        <Button size="sm" variant="ghost" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          {asTable ? t('planning.viewAsChart') : t('planning.viewAsTable')}
        </Button>
      </Cluster>
      <p className="text-body-sm text-text-muted">{summary}</p>
      {asTable ? table : chart}
    </Stack>
  )
}

/** Horizontal bars with the value printed on each bar (never colour or length alone). */
export function LabelledBars({ label, rows }: { label: string; rows: readonly { key: string; name: string; value: number; text: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <figure aria-label={label} className="m-0">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,12rem)_1fr] items-center gap-2">
            <span className="truncate text-body-sm text-text">{r.name}</span>
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="h-4 bg-viz-1" style={{ width: `${(r.value / max) * 100}%` }} />
              <span className="lw-numeric text-body-sm text-text">{r.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

/** Progress of a background job ("14 of 24 departments"), announced politely as it changes. */
export function JobProgress({ job }: { job: PlanningJob }) {
  const { t, formatNumber } = useI18n()
  const pct = Math.round(job.progress * 100)
  return (
    <Stack gap={1}>
      <Cluster gap={2} align="center">
        <span className="text-body text-text font-weight-semibold">{t(`planning.job.status.${job.status}`)}</span>
        <span className="text-body-sm text-text-muted">
          {t('planning.job.units', { done: formatNumber(job.unitsDone), total: formatNumber(job.unitsTotal) })}
        </span>
      </Cluster>
      <div
        role="progressbar"
        aria-label={t('planning.job.progressLabel')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={t('planning.job.units', { done: formatNumber(job.unitsDone), total: formatNumber(job.unitsTotal) })}
        className="h-3 w-full border-2 border-outline bg-surface"
      >
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-body-sm text-text-muted">{t('planning.job.background')}</p>
    </Stack>
  )
}

/** An export button: downloads the file the API built (audited server-side, P7). */
export function ExportButton({ label, run }: { label: string; run: () => Promise<FileDownload> }) {
  const { t } = useI18n()
  const { announce } = useAnnouncer()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <Stack gap={1}>
      <Button
        size="sm"
        loading={busy}
        loadingLabel={t('planning.export.busy')}
        onClick={() => {
          setBusy(true)
          setFailed(false)
          run().then(
            (file) => {
              downloadFile(file)
              announce(t('planning.export.done'))
              setBusy(false)
            },
            () => {
              setFailed(true)
              setBusy(false)
            },
          )
        }}
      >
        {label}
      </Button>
      {failed && (
        <p role="alert" className="text-body-sm text-danger">
          {t('planning.export.failed')}
        </p>
      )}
    </Stack>
  )
}

