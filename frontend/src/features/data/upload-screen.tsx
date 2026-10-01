import { useEffect, useId, useRef, useState } from 'react'
import { CheckCircle2, CircleX, TriangleAlert } from 'lucide-react'
import {
  DATASET_COLUMNS,
  DATASET_TYPES,
  MAX_UPLOAD_BYTES,
  type DatasetType,
  type IngestionDetail,
  type LoadIngestionResponse,
  type ProvenanceInfo,
  type RoleCode,
} from '@lanewise/shared'
import { useAnnouncer } from '@/components/a11y'
import { Cluster, Grid, Col, Section, Stack } from '@/components/layout'
import {
  Alert,
  Button,
  Card,
  CardTitle,
  Field,
  FileInput,
  Select,
  Spinner,
  StateBlock,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableWrap,
} from '@/components/ui'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { downloadFile, type DataApi } from './api'
import {
  autoMapColumns,
  looksLikeCsv,
  mappingProblems,
  readHeaderRow,
  toColumnMapping,
  type DraftMapping,
} from './columns'
import { errorCopy, plural, sortIssues, type ErrorCopy } from './helpers'
import { ErrorAlert, SampleDataBanner } from './parts'

type Step = 1 | 2 | 3 | 4 | 'done'
type Phase = 'uploading' | 'validating' | 'ready' | 'error'

const STEPS = [1, 2, 3, 4] as const

/** Target fields with a format hint (`data.field.<field>.hint`) on the mapping step. */
const FIELD_HINTS: ReadonlySet<string> = new Set([
  'date',
  'hour',
  'avg_handle_time_min',
  'handle_time_min',
  'format',
  'open',
  'close',
  'employment_type',
  'preferred_rest_day',
])

export interface UploadScreenProps {
  api: DataApi
  /**
   * Leaves the flow (Cancel, or "Back to data sources" after a load). Receives
   * the load result when data was loaded. Routing is owned by the app.
   */
  onDone: (result?: LoadIngestionResponse) => void
  /** Pre-selects a dataset type. */
  initialType?: DatasetType
  /** The signed-in user's role when known; only a Rules Steward may upload. */
  role?: RoleCode
}

/**
 * SCR-051 Upload and validation (task 9 — requirement 17): choose a dataset
 * and CSV, map its columns, upload and validate, then confirm and load. Files
 * with errors cannot be loaded (the prior dataset stays active); files with
 * warnings need an explicit confirmation.
 */
export function UploadScreen({ api, onDone, initialType = 'pos', role }: UploadScreenProps) {
  const { t, formatNumber } = useI18n()
  const { announce } = useAnnouncer()
  const ids = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const mounted = useRef(true)

  const [step, setStep] = useState<Step>(1)
  const [provenance, setProvenance] = useState<ProvenanceInfo | null>(null)

  // Step 1
  const [datasetType, setDatasetType] = useState<DatasetType>(initialType)
  const [file, setFile] = useState<File | null>(null)
  const [synthetic, setSynthetic] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  // Step 2
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<DraftMapping>({})
  const [mappingTouched, setMappingTouched] = useState(false)

  // Step 3
  const [phase, setPhase] = useState<Phase>('uploading')
  const [runError, setRunError] = useState<ErrorCopy | null>(null)
  const [detail, setDetail] = useState<IngestionDetail | null>(null)
  const [reportBusy, setReportBusy] = useState(false)
  const [reportError, setReportError] = useState<ErrorCopy | null>(null)

  // Step 4
  const [confirmWarnings, setConfirmWarnings] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<ErrorCopy | null>(null)
  const [result, setResult] = useState<LoadIngestionResponse | null>(null)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const allowed = role === undefined || role === 'RST'
  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    api.getProvenance().then(
      (p) => !cancelled && setProvenance(p),
      () => undefined, // The banner is best-effort here; SCR-050 and the shell also show it.
    )
    return () => {
      cancelled = true
    }
  }, [api, allowed])

  // Move focus to the step heading when the step changes (screen-reader context).
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    headingRef.current?.focus()
  }, [step])

  const typeLabel = (type: string) => t(`data.type.${type}`)
  const columns = DATASET_COLUMNS[datasetType]
  const problems = mappingProblems(datasetType, mapping)
  const run = detail?.run ?? null
  const hasErrors = run ? run.errorCount > 0 || run.status === 'blocked' : false
  const hasWarnings = run ? run.warningCount > 0 : false
  const stepTitles: Record<(typeof STEPS)[number], string> = {
    1: t('data.upload.step1'),
    2: t('data.upload.step2'),
    3: t('data.upload.step3'),
    4: t('data.upload.step4'),
  }

  if (!allowed) {
    return (
      <Stack gap={6}>
        <h1 className="text-h1 text-text">{t('data.upload.title')}</h1>
        <StateBlock variant="no-access" title={t('state.noAccess.title')} description={t('data.upload.noAccess')} />
      </Stack>
    )
  }

  // ── Actions ────────────────────────────────────────────────────────────
  async function cancelRun() {
    if (run && (run.status === 'validated' || run.status === 'blocked' || run.status === 'validating')) {
      try {
        await api.cancelIngestion(run.id)
      } catch {
        // Best effort: an unloaded run never changes the data in use.
      }
    }
  }

  async function cancel() {
    setCancelling(true)
    await cancelRun()
    if (mounted.current) setCancelling(false)
    onDone()
  }

  async function continueFromFile() {
    setFileError(null)
    if (!file) return setFileError(t('data.upload.file.required'))
    if (!looksLikeCsv(file)) return setFileError(t('data.upload.file.notCsv'))
    if (file.size === 0) return setFileError(t('data.upload.file.empty'))
    if (file.size > MAX_UPLOAD_BYTES) {
      return setFileError(t('data.upload.file.tooLarge', { size: formatNumber(MAX_UPLOAD_BYTES / (1024 * 1024)) }))
    }
    setReading(true)
    try {
      const found = await readHeaderRow(file)
      if (!mounted.current) return
      if (found.length === 0) return setFileError(t('data.upload.file.noHeader'))
      setHeaders(found)
      setMapping(autoMapColumns(datasetType, found))
      setMappingTouched(false)
      setStep(2)
    } catch {
      if (mounted.current) setFileError(t('data.upload.file.unreadable'))
    } finally {
      if (mounted.current) setReading(false)
    }
  }

  async function uploadAndValidate() {
    if (!file) return
    setMappingTouched(true)
    if (problems.missingRequired.length > 0 || problems.duplicateHeaders.length > 0) return
    setStep(3)
    setPhase('uploading')
    setRunError(null)
    setDetail(null)
    setReportError(null)
    setConfirmWarnings(false)
    try {
      const target = await api.requestUploadUrl({
        datasetType,
        fileName: file.name,
        contentType: 'text/csv',
        sizeBytes: file.size,
      })
      await api.uploadFile(target, file)
      if (!mounted.current) return
      setPhase('validating')
      const res = await api.createIngestion({
        datasetType,
        fileKey: target.fileKey,
        fileName: file.name,
        synthetic,
        columnMapping: toColumnMapping(datasetType, mapping),
      })
      if (!mounted.current) return
      setDetail(res)
      setProvenance(res.provenance)
      setPhase('ready')
      const rejected = res.run.errorCount > 0 || res.run.status === 'blocked'
      announce(rejected ? `${t('data.upload.validated')} ${t('data.upload.blocked.title')}` : t('data.upload.validated'))
    } catch (err) {
      if (!mounted.current) return
      setRunError(errorCopy(t, err))
      setPhase('error')
    }
  }

  /** From a failed or rejected validation: drop the run and start again from file selection. */
  async function chooseAnotherFile() {
    await cancelRun()
    if (!mounted.current) return
    setDetail(null)
    setRunError(null)
    setReportError(null)
    setFile(null)
    setFileError(null)
    setHeaders([])
    setMapping({})
    setMappingTouched(false)
    setPhase('uploading')
    setStep(1)
  }

  async function backToMapping() {
    await cancelRun()
    if (!mounted.current) return
    setDetail(null)
    setStep(2)
  }

  async function downloadReport() {
    if (!run) return
    setReportBusy(true)
    setReportError(null)
    try {
      downloadFile(await api.getReport(run.id))
    } catch (err) {
      if (mounted.current) setReportError(errorCopy(t, err))
    } finally {
      if (mounted.current) setReportBusy(false)
    }
  }

  async function load() {
    if (!run || hasErrors || (hasWarnings && !confirmWarnings)) return
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api.loadIngestion(run.id, { confirmWarnings: hasWarnings && confirmWarnings })
      if (!mounted.current) return
      setResult(res)
      setStep('done')
      announce(t('data.upload.done.title'))
    } catch (err) {
      if (!mounted.current) return
      setLoadError(
        errorCopy(
          t,
          err,
          { conflict: 'data.upload.load.conflict', validation_failed: 'data.upload.load.needsConfirm' },
          { dataset: typeLabel(datasetType) },
        ),
      )
    } finally {
      if (mounted.current) setLoading(false)
    }
  }

  // ── Render helpers ───────────────────────────────────────────────────────
  const stepHeading = (text: string) => (
    <h2 ref={headingRef} tabIndex={-1} className="text-h2 text-text focus-visible:outline-focus-ring">
      {text}
    </h2>
  )

  const columnLabel = (column: string) =>
    columns.some((c) => c.field === column) ? t(`data.field.${column}`) : column

  const chooseAnotherButton = (
    <Button size="sm" onClick={() => void chooseAnotherFile()}>
      {t('data.upload.chooseAnother')}
    </Button>
  )

  const cancelButton = (
    <Button onClick={() => void cancel()} loading={cancelling} loadingLabel={t('data.working')}>
      {t('action.cancel')}
    </Button>
  )

  const stepper = (
    <ol aria-label={t('data.upload.progress')} className="flex flex-wrap gap-3">
      {STEPS.map((n) => {
        const current = n === step
        const complete = step === 'done' || (typeof step === 'number' && n < step)
        return (
          <li
            key={n}
            aria-current={current ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 text-body-sm',
              current ? 'font-weight-semibold text-text' : 'text-text-muted',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'lw-numeric inline-flex size-6 items-center justify-center border-2',
                current ? 'border-primary bg-primary text-on-primary' : 'border-outline',
              )}
            >
              {complete ? <CheckCircle2 className="size-4" /> : n}
            </span>
            <span className="sr-only">
              {t('data.upload.stepOf', { step: n, total: STEPS.length })}
              {complete ? `, ${t('data.upload.stepComplete')}` : ''}:{' '}
            </span>
            {stepTitles[n]}
          </li>
        )
      })}
    </ol>
  )

  const fileLine = file ? t('data.upload.fileSummary', { file: file.name, dataset: typeLabel(datasetType) }) : null

  return (
    <Stack gap={6}>
      <SampleDataBanner provenance={provenance} />
      <Stack gap={3}>
        <h1 className="text-h1 text-text">{t('data.upload.title')}</h1>
        {stepper}
      </Stack>

      {step === 1 && (
        <Section aria-label={stepTitles[1]} bare>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              void continueFromFile()
            }}
          >
            <Stack gap={4}>
              {stepHeading(t('data.upload.chooseTitle'))}
              <Grid>
                <Col span={4} spanTablet={4} spanLaptop={6}>
                  <Field label={t('data.upload.datasetType')} required>
                    {(aria) => (
                      <Select
                        {...aria}
                        value={datasetType}
                        onChange={(e) => setDatasetType(e.target.value as DatasetType)}
                      >
                        {DATASET_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {typeLabel(type)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </Col>
                <Col span={4} spanTablet={4} spanLaptop={6}>
                  <Field
                    label={t('data.upload.file')}
                    hint={t('data.upload.file.hint', { size: formatNumber(MAX_UPLOAD_BYTES / (1024 * 1024)) })}
                    error={fileError}
                    required
                  >
                    {(aria) => (
                      <FileInput
                        {...aria}
                        accept=".csv,text/csv"
                        file={file}
                        chooseLabel={t('data.upload.file.choose')}
                        emptyLabel={t('data.upload.file.none')}
                        invalid={Boolean(fileError)}
                        onFileChange={(next) => {
                          setFile(next)
                          setFileError(null)
                        }}
                      />
                    )}
                  </Field>
                </Col>
              </Grid>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-label text-text">{t('data.upload.flags')}</legend>
                <Cluster gap={2} as="label" htmlFor={`${ids}-synthetic`} className="min-h-tap text-body text-text">
                  <input
                    id={`${ids}-synthetic`}
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={synthetic}
                    onChange={(e) => setSynthetic(e.target.checked)}
                  />
                  {t('data.upload.synthetic')}
                </Cluster>
                <p className="text-body-sm text-text-muted">{t('data.upload.synthetic.hint')}</p>
              </fieldset>
              <Cluster gap={3}>
                {cancelButton}
                <Button type="submit" variant="primary" loading={reading} loadingLabel={t('data.working')}>
                  {t('data.upload.continue')}
                </Button>
              </Cluster>
            </Stack>
          </form>
        </Section>
      )}

      {step === 2 && (
        <Section aria-label={stepTitles[2]} bare>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              void uploadAndValidate()
            }}
          >
            <Stack gap={4}>
              {stepHeading(t('data.upload.mapTitle'))}
              {fileLine && <p className="text-body text-text-muted">{fileLine}</p>}
              <p className="max-w-prose text-body text-text-muted">{t('data.upload.mapIntro')}</p>
              {mappingTouched && problems.missingRequired.length + problems.duplicateHeaders.length > 0 && (
                <Alert tone="danger" assertive>
                  {t('data.upload.map.fix')}
                </Alert>
              )}
              <Grid>
                {columns.map((c) => {
                  const value = mapping[c.field] ?? ''
                  const missing = mappingTouched && problems.missingRequired.includes(c.field)
                  const duplicate = mappingTouched && value !== '' && problems.duplicateHeaders.includes(value)
                  return (
                    <Col key={c.field} span={4} spanTablet={4} spanLaptop={4}>
                      <Field
                        label={t(`data.field.${c.field}`)}
                        hint={FIELD_HINTS.has(c.field) ? t(`data.field.${c.field}.hint`) : undefined}
                        required={c.required}
                        error={
                          missing
                            ? t('data.upload.map.missing')
                            : duplicate
                              ? t('data.upload.map.duplicate')
                              : undefined
                        }
                      >
                        {(aria) => (
                          <Select
                            {...aria}
                            invalid={missing || duplicate}
                            value={value}
                            onChange={(e) => setMapping((m) => ({ ...m, [c.field]: e.target.value }))}
                          >
                            <option value="">{t('data.upload.map.none')}</option>
                            {headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </Col>
                  )
                })}
              </Grid>
              <Cluster gap={3}>
                {cancelButton}
                <Button onClick={() => setStep(1)}>{t('data.upload.back')}</Button>
                <Button type="submit" variant="primary">
                  {t('data.upload.validate')}
                </Button>
              </Cluster>
            </Stack>
          </form>
        </Section>
      )}

      {step === 3 && (
        <Section aria-label={stepTitles[3]} bare>
          <Stack gap={4}>
            {stepHeading(t('data.upload.validateTitle'))}
            {(phase === 'uploading' || phase === 'validating') && (
              <Cluster gap={2} role="status" className="text-body text-text-muted">
                <Spinner delayMs={0} label={t('data.working')} />
                {t(phase === 'uploading' ? 'data.upload.uploading' : 'data.upload.validating')}
              </Cluster>
            )}
            {phase === 'error' && runError && (
              <ErrorAlert
                error={runError}
                action={
                  <Cluster gap={2}>
                    <Button size="sm" onClick={() => void uploadAndValidate()}>
                      {t('action.retry')}
                    </Button>
                    {chooseAnotherButton}
                  </Cluster>
                }
              />
            )}
            {phase === 'ready' && detail && run && (
              <>
                <Card>
                  <Stack gap={3}>
                    <CardTitle as="h3">{t('data.upload.results', { file: run.fileName })}</CardTitle>
                    <ul className="flex flex-col gap-2 text-body">
                      <li className="flex items-center gap-2">
                        <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-success" />
                        {plural(t, 'data.upload.validRows', run.validRowCount, {
                          n: formatNumber(run.validRowCount),
                        })}
                      </li>
                      <li className="flex items-center gap-2">
                        <TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-warning" />
                        {plural(t, 'data.upload.warnings', run.warningCount, { n: formatNumber(run.warningCount) })}
                      </li>
                      <li className="flex items-center gap-2">
                        <CircleX aria-hidden="true" className="size-5 shrink-0 text-danger" />
                        {plural(t, 'data.upload.errors', run.errorCount, { n: formatNumber(run.errorCount) })}
                      </li>
                    </ul>
                    <Cluster gap={3}>
                      <Button
                        size="sm"
                        onClick={() => void downloadReport()}
                        loading={reportBusy}
                        loadingLabel={t('data.working')}
                      >
                        {t('data.upload.report')}
                      </Button>
                    </Cluster>
                    {reportError && <ErrorAlert error={reportError} />}
                  </Stack>
                </Card>

                {detail.issues.length > 0 && (
                  <Stack gap={2}>
                    <h3 id={`${ids}-issues`} className="text-h3 text-text">
                      {t('data.upload.issues')}
                    </h3>
                    <TableWrap>
                      <Table aria-labelledby={`${ids}-issues`} aria-describedby={`${ids}-issues-caption`}>
                        <caption id={`${ids}-issues-caption`} className="sr-only">
                          {t('data.upload.issues.caption')}
                        </caption>
                        <TableHead>
                          <TableRow>
                            <TableHeaderCell numeric>{t('data.col.row')}</TableHeaderCell>
                            <TableHeaderCell>{t('data.col.column')}</TableHeaderCell>
                            <TableHeaderCell>{t('data.col.severity')}</TableHeaderCell>
                            <TableHeaderCell>{t('data.col.message')}</TableHeaderCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {sortIssues(detail.issues).map((issue, i) => (
                            <TableRow key={`${issue.row}-${issue.column ?? ''}-${issue.code}-${i}`}>
                              <TableRowHeader className="lw-numeric text-right">
                                {issue.row === 0 ? t('data.upload.wholeFile') : formatNumber(issue.row)}
                              </TableRowHeader>
                              <TableCell>{issue.column ? columnLabel(issue.column) : t('data.none')}</TableCell>
                              <TableCell>
                                <StatusPill tone={issue.severity === 'error' ? 'danger' : 'warning'}>
                                  {t(issue.severity === 'error' ? 'data.severity.error' : 'data.severity.warning')}
                                </StatusPill>
                              </TableCell>
                              <TableCell>{issue.message}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableWrap>
                    {detail.issuesTruncated && (
                      <p className="text-body-sm text-text-muted">
                        {t('data.upload.truncated', { count: formatNumber(detail.issues.length) })}
                      </p>
                    )}
                  </Stack>
                )}

                <ImpactNotice detail={detail} dataset={typeLabel(datasetType)} />

                {hasErrors && (
                  <Alert
                    id={`${ids}-blocked`}
                    tone="danger"
                    title={t('data.upload.blocked.title')}
                    live={false}
                    action={chooseAnotherButton}
                  >
                    {plural(t, 'data.upload.blocked.description', run.errorCount, {
                      n: formatNumber(run.errorCount),
                      dataset: typeLabel(datasetType),
                    })}
                  </Alert>
                )}
              </>
            )}
            <Cluster gap={3}>
              {cancelButton}
              <Button onClick={() => void backToMapping()} disabled={phase === 'uploading' || phase === 'validating'}>
                {t('data.upload.back')}
              </Button>
              {/* One stable button: its label never swaps; busy while uploading/validating. */}
              <Button
                variant="primary"
                loading={phase === 'uploading' || phase === 'validating'}
                loadingLabel={t('data.working')}
                disabled={phase !== 'ready' || hasErrors}
                aria-describedby={phase === 'ready' && hasErrors ? `${ids}-blocked` : undefined}
                onClick={() => setStep(4)}
              >
                {t('data.upload.continue')}
              </Button>
            </Cluster>
          </Stack>
        </Section>
      )}

      {step === 4 && run && detail && (
        <Section aria-label={stepTitles[4]} bare>
          <Stack gap={4}>
            {stepHeading(t('data.upload.confirmTitle'))}
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
              <dt className="text-text-muted">{t('data.col.dataset')}</dt>
              <dd>{typeLabel(datasetType)}</dd>
              <dt className="text-text-muted">{t('data.upload.file')}</dt>
              <dd>{run.fileName}</dd>
              <dt className="text-text-muted">{t('data.upload.rowsToLoad')}</dt>
              <dd className="lw-numeric">{formatNumber(run.validRowCount)}</dd>
              <dt className="text-text-muted">{t('data.col.warnings')}</dt>
              <dd className="lw-numeric">{formatNumber(run.warningCount)}</dd>
              <dt className="text-text-muted">{t('data.upload.staleCount')}</dt>
              <dd className="lw-numeric">{formatNumber(detail.impact.length)}</dd>
              <dt className="text-text-muted">{t('data.col.synthetic')}</dt>
              <dd>{t(run.synthetic ? 'data.yes' : 'data.no')}</dd>
            </dl>
            <ImpactNotice detail={detail} dataset={typeLabel(datasetType)} />
            {hasWarnings && (
              <Cluster
                gap={2}
                as="label"
                htmlFor={`${ids}-confirm`}
                wrap={false}
                align="start"
                className="min-h-tap text-body text-text"
              >
                <input
                  id={`${ids}-confirm`}
                  type="checkbox"
                  className="mt-0.5 size-5 shrink-0 accent-primary"
                  checked={confirmWarnings}
                  onChange={(e) => setConfirmWarnings(e.target.checked)}
                />
                {plural(t, 'data.upload.confirmWarnings', run.warningCount, { n: formatNumber(run.warningCount) })}
              </Cluster>
            )}
            {loadError && <ErrorAlert error={loadError} />}
            <Cluster gap={3}>
              {cancelButton}
              <Button onClick={() => setStep(3)} disabled={loading}>
                {t('data.upload.back')}
              </Button>
              <Button
                variant="primary"
                onClick={() => void load()}
                loading={loading}
                loadingLabel={t('data.working')}
                disabled={hasErrors || (hasWarnings && !confirmWarnings)}
              >
                {t('data.upload.load')}
              </Button>
            </Cluster>
          </Stack>
        </Section>
      )}

      {step === 'done' && result && (
        <Section aria-label={t('data.upload.done.title')} bare>
          <Stack gap={4} align="start">
            <Cluster gap={2}>
              <CheckCircle2 aria-hidden="true" className="size-6 text-success" />
              {stepHeading(t('data.upload.done.title'))}
            </Cluster>
            <Alert tone="success" live={false}>
              <p>
                {t('data.upload.done.rows', {
                  n: formatNumber(result.snapshot.rowCount),
                  dataset: typeLabel(result.snapshot.type),
                })}
              </p>
              <p>
                {result.staleScenarios.length > 0
                  ? plural(t, 'data.upload.done.stale', result.staleScenarios.length, {
                      n: formatNumber(result.staleScenarios.length),
                    })
                  : t('data.upload.done.noStale')}
              </p>
            </Alert>
            <Button variant="primary" onClick={() => onDone(result)}>
              {t('data.upload.done.back')}
            </Button>
          </Stack>
        </Section>
      )}
    </Stack>
  )
}

/** Which scenarios become stale when this file is loaded (requirement 17.4). */
function ImpactNotice({ detail, dataset }: { detail: IngestionDetail; dataset: string }) {
  const { t, formatNumber } = useI18n()
  const count = detail.impact.length
  if (count === 0) {
    return (
      <Alert tone="info" live={false}>
        {t('data.upload.impact.none', { dataset })}
      </Alert>
    )
  }
  return (
    <Alert tone="info" live={false} title={plural(t, 'data.upload.impact', count, { n: formatNumber(count) })}>
      <ul className="mt-1 list-disc pl-5">
        {detail.impact.map((s) => (
          <li key={s.id}>
            {s.name}
            {s.alreadyStale && <> {t('data.upload.impact.alreadyStale')}</>}
          </li>
        ))}
      </ul>
    </Alert>
  )
}
