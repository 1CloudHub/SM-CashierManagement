import { useCallback, useEffect, useRef, useState } from 'react'
import {
  canChangeSyntheticFlag,
  type DatasetSummary,
  type IngestionRunDto,
  type ProvenanceInfo,
  type RoleCode,
} from '@lanewise/shared'
import { useAnnouncer } from '@/components/a11y'
import { Cluster, Section, Stack } from '@/components/layout'
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  StateBlock,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableSkeleton,
  TableWrap,
} from '@/components/ui'
import { useI18n } from '@/i18n'
import { downloadFile, isApiRequestError, type DataApi } from './api'
import {
  datasetStatus,
  errorCopy,
  isoDate,
  ISO_DATE_OPTIONS,
  plural,
  runStatus,
  type ErrorCopy,
} from './helpers'
import { ErrorAlert, SampleDataBanner } from './parts'

/** How many recent runs the history table shows. */
export const HISTORY_LIMIT = 50

type Load<T> = { state: 'loading' } | { state: 'error'; error: unknown } | { state: 'ready'; data: T }

interface DatasetsData {
  datasets: readonly DatasetSummary[]
  provenance: ProvenanceInfo
}

export interface DataSourcesScreenProps {
  api: DataApi
  /** Opens SCR-051 (routing is owned by the app). */
  onUpload?: () => void
  /**
   * The signed-in user's role, when known. Only a Rules Steward sees "Upload
   * file" and "Change"; when omitted the controls show and the API enforces
   * access (a 403 is shown inline).
   */
  role?: RoleCode
}

/**
 * SCR-050 Data sources and ingestion (task 9 — requirement 17, 18): the
 * datasets in use with their provenance flag, the sample-data banner, and the
 * ingestion history with CSV export.
 */
export function DataSourcesScreen({ api, onUpload, role }: DataSourcesScreenProps) {
  const { t, formatNumber, formatDate, formatDateTime } = useI18n()
  const { announce } = useAnnouncer()
  const [datasets, setDatasets] = useState<Load<DatasetsData>>({ state: 'loading' })
  const [history, setHistory] = useState<Load<readonly IngestionRunDto[]>>({ state: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<ErrorCopy | null>(null)
  const [changing, setChanging] = useState<DatasetSummary | null>(null)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [reportBusy, setReportBusy] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.listDatasets().then(
      (res) => !cancelled && setDatasets({ state: 'ready', data: { datasets: res.datasets, provenance: res.provenance } }),
      (error: unknown) => !cancelled && setDatasets({ state: 'error', error }),
    )
    api.listIngestions({ limit: HISTORY_LIMIT }).then(
      (res) => !cancelled && setHistory({ state: 'ready', data: res.runs }),
      (error: unknown) => !cancelled && setHistory({ state: 'error', error }),
    )
    return () => {
      cancelled = true
    }
  }, [api, reloadKey])

  const reload = useCallback(() => {
    setDatasets({ state: 'loading' })
    setHistory({ state: 'loading' })
    setReloadKey((k) => k + 1)
  }, [])

  const canManage = role === undefined || role === 'RST'
  const typeLabel = (type: string) => t(`data.type.${type}`)

  async function changeSynthetic(summary: DatasetSummary) {
    const snapshot = summary.current
    if (!snapshot) return
    const next = !snapshot.synthetic
    setSaving(true)
    setActionError(null)
    setNotice(null)
    try {
      await api.updateSnapshot(snapshot.id, { synthetic: next })
      if (!mounted.current) return
      const message = t(next ? 'data.synthetic.markedSample' : 'data.synthetic.markedReal', {
        dataset: typeLabel(summary.type),
      })
      setNotice(message)
      announce(message)
      setChanging(null)
      reload()
    } catch (err) {
      if (!mounted.current) return
      setChanging(null)
      setActionError(errorCopy(t, err, { forbidden: 'data.synthetic.forbidden' }))
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  async function exportHistory() {
    setExporting(true)
    setActionError(null)
    try {
      downloadFile(await api.exportHistory())
      if (mounted.current) announce(t('data.history.exported'))
    } catch (err) {
      if (mounted.current) setActionError(errorCopy(t, err))
    } finally {
      if (mounted.current) setExporting(false)
    }
  }

  async function downloadReport(run: IngestionRunDto) {
    setReportBusy(run.id)
    setActionError(null)
    try {
      downloadFile(await api.getReport(run.id))
    } catch (err) {
      if (mounted.current) setActionError(errorCopy(t, err))
    } finally {
      if (mounted.current) setReportBusy(null)
    }
  }

  const heading = (
    <Cluster justify="between" gap={3}>
      <h1 className="text-h1 text-text">{t('data.sources.title')}</h1>
      {/* Rendered while loading too (disabled) so the heading row never shifts. */}
      {canManage && (
        <Button variant="primary" onClick={onUpload} disabled={datasets.state !== 'ready'}>
          {t('data.sources.upload')}
        </Button>
      )}
    </Cluster>
  )

  if (datasets.state === 'error' && isApiRequestError(datasets.error) && datasets.error.code === 'forbidden') {
    return (
      <Stack gap={6}>
        <h1 className="text-h1 text-text">{t('data.sources.title')}</h1>
        <StateBlock variant="no-access" title={t('state.noAccess.title')} description={t('state.noAccess.description')} />
      </Stack>
    )
  }

  if (datasets.state === 'error') {
    const copy = errorCopy(t, datasets.error)
    return (
      <Stack gap={6}>
        <h1 className="text-h1 text-text">{t('data.sources.title')}</h1>
        <StateBlock
          variant={copy.code === 'network_error' ? 'offline' : 'error'}
          title={t('data.sources.loadFailed')}
          description={
            <>
              {copy.message}
              {copy.requestId && (
                <>
                  {' '}
                  {t('a11y.referenceId')}: <span className="lw-numeric">{copy.requestId}</span>
                </>
              )}
            </>
          }
          action={<Button onClick={reload}>{t('action.retry')}</Button>}
        />
      </Stack>
    )
  }

  const provenance = datasets.state === 'ready' ? datasets.data.provenance : null

  return (
    <Stack gap={6}>
      <SampleDataBanner provenance={provenance} />
      {heading}
      <p className="max-w-prose text-body text-text-muted">{t('data.sources.intro')}</p>

      {notice && (
        <Alert tone="success" live={false}>
          {notice}
        </Alert>
      )}
      {actionError && <ErrorAlert error={actionError} />}

      <Section title={t('data.datasets.title')}>
        {datasets.state === 'loading' ? (
          <TableSkeleton columns={7} rows={3} label={t('data.datasets.loading')} />
        ) : (
          <TableWrap>
            <Table aria-label={t('data.datasets.title')} stickyFirstCol>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t('data.col.dataset')}</TableHeaderCell>
                  <TableHeaderCell>{t('data.col.source')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('data.col.rows')}</TableHeaderCell>
                  <TableHeaderCell>{t('data.col.covers')}</TableHeaderCell>
                  <TableHeaderCell>{t('data.col.lastLoad')}</TableHeaderCell>
                  <TableHeaderCell>{t('data.col.status')}</TableHeaderCell>
                  <TableHeaderCell>{t('data.col.synthetic')}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {datasets.data.datasets.length === 0 && (
                  <TableEmpty colSpan={7}>{t('data.datasets.empty')}</TableEmpty>
                )}
                {datasets.data.datasets.map((d) => {
                  const status = datasetStatus(d)
                  const snap = d.current
                  const showChange =
                    snap !== null && (role === undefined || canChangeSyntheticFlag(role, snap.synthetic, !snap.synthetic))
                  return (
                    <TableRow key={d.type}>
                      <TableRowHeader>{typeLabel(d.type)}</TableRowHeader>
                      <TableCell>{t(`data.source.${d.type}`)}</TableCell>
                      <TableCell numeric>{snap ? formatNumber(snap.rowCount) : t('data.none')}</TableCell>
                      <TableCell>
                        {snap
                          ? t('data.range', {
                              from: formatDate(isoDate(snap.coversFrom), ISO_DATE_OPTIONS),
                              to: formatDate(isoDate(snap.coversTo), ISO_DATE_OPTIONS),
                            })
                          : t('data.none')}
                      </TableCell>
                      <TableCell>{snap ? formatDateTime(snap.loadedAt) : t('data.none')}</TableCell>
                      <TableCell>
                        <StatusPill tone={status.tone}>{t(status.key)}</StatusPill>
                      </TableCell>
                      <TableCell>
                        {snap ? (
                          <Cluster gap={2} wrap={false}>
                            {snap.synthetic ? (
                              <StatusPill tone="warning">{t('data.yes')}</StatusPill>
                            ) : (
                              <span>{t('data.no')}</span>
                            )}
                            {showChange && (
                              <Button
                                size="sm"
                                aria-label={t('data.synthetic.changeLabel', { dataset: typeLabel(d.type) })}
                                onClick={() => {
                                  setActionError(null)
                                  setChanging(d)
                                }}
                              >
                                {t('data.synthetic.change')}
                              </Button>
                            )}
                          </Cluster>
                        ) : (
                          t('data.none')
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>
        )}
      </Section>

      <Section
        title={t('data.history.title')}
        actions={
          <Button
            onClick={() => void exportHistory()}
            loading={exporting}
            loadingLabel={t('data.working')}
            disabled={history.state !== 'ready' || history.data.length === 0}
          >
            {t('data.history.export')}
          </Button>
        }
      >
        {history.state === 'loading' && <TableSkeleton columns={7} rows={3} label={t('data.history.loading')} />}
        {history.state === 'error' && (
          <ErrorAlert
            assertive={false}
            error={{ ...errorCopy(t, history.error), message: t('data.history.loadFailed') }}
            action={
              <Button size="sm" onClick={reload}>
                {t('action.retry')}
              </Button>
            }
          />
        )}
        {history.state === 'ready' && (
          <TableWrap>
            <Table aria-label={t('data.history.title')} stickyFirstCol>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t('data.col.time')}</TableHeaderCell>
                  <TableHeaderCell>{t('data.col.dataset')}</TableHeaderCell>
                  <TableHeaderCell>{t('data.col.user')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('data.col.rows')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('data.col.warnings')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('data.col.errors')}</TableHeaderCell>
                  <TableHeaderCell>{t('data.col.result')}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {history.data.length === 0 && <TableEmpty colSpan={7}>{t('data.history.empty')}</TableEmpty>}
                {history.data.map((run) => {
                  const status = runStatus(run)
                  return (
                    <TableRow key={run.id}>
                      <TableRowHeader>{formatDateTime(run.startedAt)}</TableRowHeader>
                      <TableCell>{typeLabel(run.datasetType)}</TableCell>
                      <TableCell>{run.userName ?? run.userId}</TableCell>
                      <TableCell numeric>{formatNumber(run.rowCount)}</TableCell>
                      <TableCell numeric>{formatNumber(run.warningCount)}</TableCell>
                      <TableCell numeric>{formatNumber(run.errorCount)}</TableCell>
                      <TableCell>
                        <Cluster gap={2}>
                          <StatusPill tone={status.tone}>{t(status.key)}</StatusPill>
                          {run.status === 'loaded' && run.staleScenarioCount > 0 && (
                            <span>{plural(t, 'data.history.markedStale', run.staleScenarioCount)}</span>
                          )}
                          {(run.status === 'blocked' || run.status === 'failed') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={reportBusy === run.id}
                              loadingLabel={t('data.working')}
                              aria-label={t('data.history.reportLabel', { file: run.fileName })}
                              onClick={() => void downloadReport(run)}
                            >
                              {t('data.history.report')}
                            </Button>
                          )}
                        </Cluster>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>
        )}
      </Section>

      <Dialog open={changing !== null} onOpenChange={(open) => !open && !saving && setChanging(null)}>
        {/* The footer's Cancel closes it (and Esc); the shared close icon's name isn't localised. */}
        <DialogContent hideClose>
          {changing?.current && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t(changing.current.synthetic ? 'data.synthetic.toReal.title' : 'data.synthetic.toSample.title', {
                    dataset: typeLabel(changing.type),
                  })}
                </DialogTitle>
                <DialogDescription>
                  {t(
                    changing.current.synthetic
                      ? 'data.synthetic.toReal.description'
                      : 'data.synthetic.toSample.description',
                    { dataset: typeLabel(changing.type) },
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => setChanging(null)} disabled={saving}>
                  {t('action.cancel')}
                </Button>
                <Button
                  variant="primary"
                  loading={saving}
                  loadingLabel={t('data.working')}
                  onClick={() => void changeSynthetic(changing)}
                >
                  {t(changing.current.synthetic ? 'data.synthetic.toReal.confirm' : 'data.synthetic.toSample.confirm')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  )
}
