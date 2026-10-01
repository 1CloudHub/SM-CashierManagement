import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { Star } from 'lucide-react'
import {
  DEPARTMENT_OVERRIDE_FIELDS,
  DEPARTMENT_OVERRIDE_RANGES,
  FT_SHIFT_PATTERNS,
  SCENARIO_NUMERIC_RANGES,
  can,
  type DepartmentOverrideField,
  type FtShiftPattern,
  type RoleCode,
  type ScenarioDepartmentBaseline,
  type ScenarioDetail,
  type ScenarioNumericOverrideKey,
  type ScenarioSettingsValues,
} from '@lanewise/shared'
import { ApiError } from '@/api'
import { canAccess } from '@/app/access'
import { AppLink } from '@/app/router'
import { Cluster, Col, Grid, Section, Stack } from '@/components/layout'
import { useMediaQuery } from '@/components/layout/use-media-query'
import {
  Alert,
  Button,
  CardSkeleton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  KpiCard,
  Num,
  Pill,
  Select,
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
  Textarea,
  useUnsavedChanges,
} from '@/components/ui'
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { CostValue } from '@/features/cost'
import { useI18n } from '@/i18n'
import { errorCode, errorReference, type ScenariosClient } from './api'
import {
  CALENDAR_DATE,
  DATE_ONLY,
  DATE_TIME,
  DEPARTMENT_FIELD_LABEL_KEY,
  FT_PATTERN_LABEL_KEY,
  SCENARIO_STATUS_TONE,
    SETTING_LABEL_KEY,
  deptIssueId,
  formEquals,
  issuesAfterBlur,
  issuesFromDetails,
  settingIssueKey,
  settingsBlocker,
  toForm,
  validateForm,
  type DepartmentForm,
  type IssueId,
  type SettingsForm,
} from './logic'

export interface ScenarioSettingsScreenProps {
  readonly client: ScenariosClient
  readonly role: RoleCode | null
  readonly scenarioId: string
  /** Opens another scenario's settings (after "Duplicate as draft" / refresh). */
  readonly onOpenScenario: (id: string) => void
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly scenario: ScenarioDetail; readonly form: SettingsForm }

type Notice = { readonly tone: 'success' | 'danger'; readonly text: string } | null

/** In-page section anchors (wireframe SCR-031 section nav). */
const SECTIONS = [
  ['scn-demand', 'scenarios.settings.demand'],
  ['scn-service', 'scenarios.settings.service'],
  ['scn-shifts', 'scenarios.settings.shifts'],
  ['scn-labor', 'scenarios.settings.labor'],
  ['scn-season', 'scenarios.settings.season'],
  ['scn-rules-data', 'scenarios.settings.rulesData'],
  ['scn-notes', 'scenarios.settings.notes'],
  ['scn-results', 'scenarios.run.title'],
] as const

const EMPTY_DEPARTMENT: DepartmentForm = { baselineTxPerDay: '', handleTimeMin: '', upliftPct: '' }

/**
 * SCR-031 Scenario settings (requirement 8.2–8.5, P4, P5): the settings a
 * run uses — demand with per-department overrides, service and labor
 * standards, shift and labor rules (each "empty = the pinned rule's value",
 * marked "edited · default X" when overridden) — the rules and data it is
 * pinned to, the stale banner with Recalculate, and the latest run's
 * results. Settings are editable in Draft only, by a planner, on a tablet or
 * larger; anything else is read-only (a non-draft offers "Duplicate as draft").
 */
export function ScenarioSettingsScreen({ client, role, scenarioId, onOpenScenario }: ScenarioSettingsScreenProps) {
  const { t, formatDate, formatDateTime, formatNumber } = useI18n()
  useDocumentTitle(t('scenarios.settings.pageTitle'))
  const ids = useId()
  const canEdit = can(role, 'scenario_settings', 'edit')
  const isTabletUp = useMediaQuery('(min-width: 37.5rem)')
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [issues, setIssues] = useState<ReadonlySet<IssueId>>(new Set())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const accept = useCallback((scenario: ScenarioDetail) => {
    setLoad({ kind: 'ready', scenario, form: toForm(scenario.settings) })
    setIssues(new Set())
  }, [])

  const fetchOne = useCallback(() => {
    client.get(scenarioId).then(accept, (error: unknown) => setLoad({ kind: 'error', referenceId: errorReference(error) }))
  }, [client, scenarioId, accept])

  useEffect(() => {
    fetchOne()
  }, [fetchOne])

  const dirty = load.kind === 'ready' && !formEquals(load.form, toForm(load.scenario.settings))
  useUnsavedChanges(dirty)

  if (load.kind === 'loading') {
    return (
      <Stack gap={4}>
        <h1 className="text-h1 text-text">{t('scenarios.settings.pageTitle')}</h1>
        <CardSkeleton label={t('state.loading')} />
      </Stack>
    )
  }
  if (load.kind === 'error') {
    return (
      <Stack gap={4}>
        <h1 className="text-h1 text-text">{t('scenarios.settings.pageTitle')}</h1>
        <StateBlock
          variant="error"
          title={t('scenarios.settings.error.title')}
          referenceId={load.referenceId}
          action={
            <Button
              onClick={() => {
                setLoad({ kind: 'loading' })
                fetchOne()
              }}
            >
              {t('action.retry')}
            </Button>
          }
        />
      </Stack>
    )
  }

  const { scenario: s, form: f } = load
  const editable = s.editable && canEdit && isTabletUp
  const blocker = settingsBlocker(s.submitBlocker, dirty)
  const update = (patch: Partial<SettingsForm>) => setLoad({ ...load, form: { ...f, ...patch } })
  const blur = (key: IssueId) => setIssues((prev) => issuesAfterBlur(f, prev, key))
  const issueText = (key: Exclude<IssueId, `dept:${string}`>) => (issues.has(key) ? t(settingIssueKey(key)) : undefined)
  const formId = `${ids}-form`
  const blockerId = `${ids}-blocker`

  const fail = (e: unknown, submitted?: ScenarioSettingsValues) => {
    const code = errorCode(e)
    if (code === 'validation_failed' && e instanceof ApiError) setIssues(issuesFromDetails(e.details, submitted))
    setNotice({
      tone: 'danger',
      text: t(code === 'conflict' ? 'scenarios.error.conflict' : code === 'validation_failed' ? 'scenarios.error.validation' : 'scenarios.error.generic'),
    })
  }

  const perform = async (fn: () => Promise<void>, submitted?: ScenarioSettingsValues) => {
    setBusy(true)
    setNotice(null)
    try {
      await fn()
    } catch (e) {
      fail(e, submitted)
    } finally {
      setBusy(false)
    }
  }

  const save = (thenRun: boolean) => {
    const v = validateForm(f)
    if (!v.ok) {
      setIssues(v.issues)
      setNotice({ tone: 'danger', text: t('scenarios.error.validation') })
      return
    }
    void perform(async () => {
      let next = dirty ? await client.update(s.id, { settings: v.settings }) : s
      if (thenRun) next = await client.run(s.id)
      accept(next)
      setNotice({ tone: 'success', text: t(thenRun ? 'scenarios.settings.ran' : 'scenarios.settings.saved') })
    }, v.settings)
  }

  const recalculate = () =>
    void perform(async () => {
      if (s.status === 'draft') {
        accept(await client.run(s.id))
        setNotice({ tone: 'success', text: t('scenarios.settings.ran') })
      } else {
        const fresh = await client.refresh(s.id)
        onOpenScenario(fresh.id)
      }
    })

  const duplicate = () =>
    void perform(async () => {
      const copy = await client.duplicate(s.id)
      onOpenScenario(copy.id)
    })

  const submit = () =>
    void perform(async () => {
      accept(await client.submit(s.id))
      setNotice({ tone: 'success', text: t('scenarios.settings.submitted') })
    })

  const discard = () => {
    setConfirmDiscard(false)
    accept(s)
    setNotice(null)
  }

  // ── Field builders ────────────────────────────────────────────────────────
  const fmt = (v: number) => formatNumber(v, { maximumFractionDigits: 2 })
  const defaultHint = (edited: boolean, value: string): ReactNode =>
    edited ? <Pill tone="info">{t('scenarios.settings.edited', { value })}</Pill> : t('scenarios.settings.default', { value })

  const numberField = (key: ScenarioNumericOverrideKey) => {
    const range = SCENARIO_NUMERIC_RANGES[key]
    const raw = f.numeric[key]
    const def = s.defaults[key]
    return (
      <Field key={key} label={t(SETTING_LABEL_KEY[key])} hint={defaultHint(raw.trim() !== '', fmt(def))} error={issueText(key)}>
        {(aria) => (
          <Input
            {...aria}
            name={key}
            type="number"
            inputMode="decimal"
            min={range.min}
            max={range.max}
            step={range.integer ? 1 : 'any'}
            placeholder={String(def)}
            value={raw}
            disabled={!editable}
            onChange={(e) => update({ numeric: { ...f.numeric, [key]: e.target.value } })}
            onBlur={() => blur(key)}
          />
        )}
      </Field>
    )
  }

  const checkbox = (id: string, label: string, checked: boolean, onChange: (v: boolean) => void, hint?: ReactNode) => (
    <div className="flex flex-col gap-1">
      <Cluster gap={2} as="label" htmlFor={id} className="min-h-tap text-body text-text">
        <input
          id={id}
          type="checkbox"
          className="size-5 accent-primary"
          checked={checked}
          disabled={!editable}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </Cluster>
      {hint && (
        <p id={`${id}-hint`} className="text-body-sm text-text-muted">
          {hint}
        </p>
      )}
    </div>
  )

  const pattern = f.ftShiftPattern ?? s.defaults.ftShiftPattern
  const restDay = f.respectPreferredRestDay ?? s.defaults.respectPreferredRestDay
  const yesNo = (v: boolean) => t(v ? 'scenarios.compare.yes' : 'scenarios.compare.no')

  const results = s.latestRun?.status === 'succeeded' ? s.latestRun.results : null
  const hasPhone = !isTabletUp

  return (
    <Stack gap={6}>
      {hasPhone && <Alert tone="info" live={false} title={t('scenarios.phone.readOnly')} />}

      <form
        id={formId}
        noValidate
        aria-label={t('scenarios.settings.formLabel', { name: s.name })}
        onSubmit={(e) => {
          e.preventDefault()
          if (editable && !busy) save(false)
        }}
      >
        <Stack gap={6}>
          <Stack gap={2}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <Cluster gap={2} align="center">
                {s.isPublished && <Star aria-label={t('scenarios.published')} role="img" className="size-5 shrink-0 fill-current" />}
                <h1 className="text-h1 text-text">{s.name}</h1>
                <StatusPill tone={SCENARIO_STATUS_TONE[s.status]}>{t(`scenario.status.${s.status}`)}</StatusPill>
                {s.stale && <StatusPill tone="warning">{t('scenarios.stale')}</StatusPill>}
              </Cluster>
              {editable && (
                <Cluster gap={2}>
                  <Button type="button" variant="ghost" disabled={!dirty || busy} onClick={() => setConfirmDiscard(true)}>
                    {t('action.discard')}
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {t('scenarios.settings.save')}
                  </Button>
                  <Button type="button" variant="primary" disabled={busy} aria-busy={busy || undefined} onClick={() => save(true)}>
                    {t('scenarios.settings.saveAndRun')}
                  </Button>
                  {can(role, 'scenario_submit', 'edit') && (
                    <Button type="button" disabled={busy || blocker !== null} aria-describedby={blocker ? blockerId : undefined} onClick={submit}>
                      {t('scenarios.settings.submit')}
                    </Button>
                  )}
                </Cluster>
              )}
            </div>
            <p className="text-body-sm text-text-muted">
              {t('scenarios.season.range', { from: formatDate(s.planningFrom, CALENDAR_DATE), to: formatDate(s.planningTo, CALENDAR_DATE) })}
            </p>
            {editable && blocker && can(role, 'scenario_submit', 'edit') && (
              <p id={blockerId} className="text-body-sm text-text-muted">
                {t(`scenarios.blocker.${blocker}`)}
              </p>
            )}
          </Stack>

          {notice && <Alert tone={notice.tone} title={notice.text} assertive={notice.tone === 'danger'} />}

          {s.stale && (
            <Alert
              tone="warning"
              title={t('scenarios.settings.stale.title')}
              action={
                canEdit && isTabletUp ? (
                  <Button size="sm" variant="primary" onClick={recalculate} disabled={busy}>
                    {t('action.recalculate')}
                  </Button>
                ) : undefined
              }
            >
              <ul className="list-disc pl-5">
                {s.staleReasons.map((r) => (
                  <li key={r}>{t(`scenarios.reason.${r}`)}</li>
                ))}
              </ul>
            </Alert>
          )}

          {!canEdit && <Alert tone="info" live={false} title={t('scenarios.settings.readOnlyRole')} />}
          {canEdit && !s.editable && (
            <Alert
              tone="info"
              live={false}
              title={t('scenarios.settings.readOnly.title')}
              action={
                isTabletUp ? (
                  <Button size="sm" onClick={duplicate} disabled={busy}>
                    {t('action.duplicateAsDraft')}
                  </Button>
                ) : undefined
              }
            >
              {t('scenarios.settings.readOnly.description')}
            </Alert>
          )}

          <Grid>
            <Col span={4} spanTablet={8} spanLaptop={3}>
              <nav aria-label={t('scenarios.settings.sections')} className="border border-outline bg-surface p-4 laptop:sticky laptop:top-4">
                <ul className="flex flex-col gap-1">
                  {SECTIONS.map(([id, key]) => (
                    <li key={id}>
                      <a href={`#${id}`} className="inline-flex min-h-tap items-center text-body text-primary underline">
                        {t(key)}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </Col>
            <Col span={4} spanTablet={8} spanLaptop={9}>
              <Stack gap={4}>
                <FormSection id="scn-demand" legend={t('scenarios.settings.demand')}>
                  <Field
                    label={t('scenarios.settings.growth')}
                    hint={t('scenarios.settings.growth.hint')}
                    error={issueText('growth')}
                    className="max-w-xs"
                  >
                    {(aria) => (
                      <Input
                        {...aria}
                        name="growth"
                        type="number"
                        step="0.5"
                        inputMode="decimal"
                        value={f.growthPct}
                        disabled={!editable}
                        onChange={(e) => update({ growthPct: e.target.value })}
                        onBlur={() => blur('growth')}
                      />
                    )}
                  </Field>
                  <DepartmentOverrides
                    departments={s.departments}
                    form={f.departments}
                    editable={editable}
                    issues={issues}
                    onChange={(id, field, value) =>
                      update({ departments: { ...f.departments, [id]: { ...(f.departments[id] ?? EMPTY_DEPARTMENT), [field]: value } } })
                    }
                    onBlur={(id, field) => blur(deptIssueId(id, field))}
                  />
                </FormSection>

                <FormSection id="scn-service" legend={t('scenarios.settings.service')}>
                  <FieldGrid>
                    {numberField('servedWithinPct')}
                    {numberField('waitSeconds')}
                    {numberField('shrinkage')}
                    {numberField('minOpenLanes')}
                    <div className="flex flex-col gap-1">
                      <span className="text-label text-text">{t('scenarios.settings.baseRate')}</span>
                      <span className="text-body text-text">
                        <CostValue value={s.baseHourlyRate} level="network" />
                      </span>
                      <span className="text-body-sm text-text-muted">{t('scenarios.settings.baseRate.hint')}</span>
                    </div>
                  </FieldGrid>
                </FormSection>

                <FormSection id="scn-shifts" legend={t('scenarios.settings.shifts')}>
                  <FieldGrid>
                    <Field
                      label={t(SETTING_LABEL_KEY.ftShiftPattern)}
                      hint={defaultHint(f.ftShiftPattern !== null, t(FT_PATTERN_LABEL_KEY[s.defaults.ftShiftPattern]))}
                      error={issueText('ftShiftPattern')}
                    >
                      {(aria) => (
                        <Select
                          {...aria}
                          name="ftShiftPattern"
                          value={pattern}
                          disabled={!editable}
                          onChange={(e) => {
                            const v = e.target.value as FtShiftPattern
                            update({ ftShiftPattern: v === s.defaults.ftShiftPattern ? null : v })
                          }}
                        >
                          {FT_SHIFT_PATTERNS.map((p) => (
                            <option key={p} value={p}>
                              {t(FT_PATTERN_LABEL_KEY[p])}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    {checkbox(`${ids}-pt`, t('scenarios.settings.allowPartTime'), f.allowPartTime, (v) => update({ allowPartTime: v }))}
                    {numberField('ptShiftHours')}
                    {numberField('maxPtSharePct')}
                    {numberField('mealEarliestAfterHours')}
                    {numberField('absenceReservePct')}
                  </FieldGrid>
                </FormSection>

                <FormSection id="scn-labor" legend={t('scenarios.settings.labor')}>
                  <FieldGrid>
                    {numberField('ftMaxDaysPerWeek')}
                    {numberField('ftMaxHoursPerWeek')}
                    {numberField('ptMaxDaysPerWeek')}
                    {numberField('ptMaxHoursPerWeek')}
                    {numberField('minRestHours')}
                    {numberField('maxConsecutiveDays')}
                    {checkbox(
                      `${ids}-rest`,
                      t(SETTING_LABEL_KEY.respectPreferredRestDay),
                      restDay,
                      (v) => update({ respectPreferredRestDay: v === s.defaults.respectPreferredRestDay ? null : v }),
                      defaultHint(f.respectPreferredRestDay !== null, yesNo(s.defaults.respectPreferredRestDay)),
                    )}
                  </FieldGrid>
                </FormSection>

                <FormSection id="scn-season" legend={t('scenarios.settings.season')}>
                  <FieldGrid>
                    {(['planningFrom', 'planningTo', 'peakDay'] as const).map((key) => (
                      <Field key={key} label={t(SETTING_LABEL_KEY[key])} error={issueText(key)}>
                        {(aria) => (
                          <Input
                            {...aria}
                            name={key}
                            type="date"
                            value={f[key]}
                            disabled={!editable}
                            onChange={(e) => update({ [key]: e.target.value } as Pick<SettingsForm, typeof key>)}
                            onBlur={() => blur(key)}
                          />
                        )}
                      </Field>
                    ))}
                  </FieldGrid>
                </FormSection>

                <RulesAndData scenario={s} role={role} />

                <FormSection id="scn-notes" legend={t('scenarios.settings.notes')}>
                  <Field label={t('scenarios.settings.notes.why')} error={issueText('notes')}>
                    {(aria) => (
                      <Textarea
                        {...aria}
                        name="notes"
                        value={f.notes}
                        disabled={!editable}
                        onChange={(e) => update({ notes: e.target.value })}
                        onBlur={() => blur('notes')}
                      />
                    )}
                  </Field>
                </FormSection>
              </Stack>
            </Col>
          </Grid>
        </Stack>
      </form>

      <Section
        id="scn-results"
        title={t('scenarios.run.title')}
        description={
          results && s.lastRunAt
            ? t(s.stale || dirty ? 'scenarios.run.asOfStale' : 'scenarios.run.asOf', { date: formatDateTime(s.lastRunAt, DATE_TIME) })
            : undefined
        }
        actions={results && (s.stale || dirty) ? <StatusPill tone="warning">{t('scenarios.stale')}</StatusPill> : undefined}
      >
        {s.latestRun?.status === 'failed' && <Alert tone="danger" title={t('scenarios.run.failed')} />}
        {!results && s.latestRun?.status !== 'failed' && <p className="text-body text-text-muted">{t('scenarios.run.none')}</p>}
        {results && (
          <Stack gap={4}>
            <Grid>
              {results.seasonalHires !== null && (
                <Col span={2} spanTablet={4} spanLaptop={3}>
                  <KpiCard
                    label={t('scenarios.run.hires')}
                    value={<Num value={results.seasonalHires} />}
                    detail={
                      results.firstNeededBy
                        ? t('scenarios.run.firstNeededBy', { date: formatDate(results.firstNeededBy, CALENDAR_DATE) })
                        : undefined
                    }
                  />
                </Col>
              )}
              <Col span={2} spanTablet={4} spanLaptop={3}>
                <KpiCard label={t('scenarios.run.headcount')} value={<Num value={results.headcount} />} />
              </Col>
              <Col span={2} spanTablet={4} spanLaptop={3}>
                <KpiCard label={t('scenarios.run.paidHours')} value={<Num value={results.paidHours} />} />
              </Col>
              <Col span={2} spanTablet={4} spanLaptop={3}>
                <KpiCard label={t('scenarios.run.cost')} value={<CostValue value={results.cost} level="network" />} />
              </Col>
              <Col span={2} spanTablet={4} spanLaptop={3}>
                <KpiCard
                  label={t('scenarios.run.peakLanes')}
                  value={<Num value={results.peak.lanesOpen} />}
                  detail={t('scenarios.run.peakAt', { date: formatDate(results.peak.date, CALENDAR_DATE), hour: results.peak.hour })}
                />
              </Col>
            </Grid>
            <TableWrap>
              <Table stickyFirstCol>
                <caption className="sr-only">{t('scenarios.run.byStore')}</caption>
                <TableHead>
                  <tr>
                    <TableHeaderCell>{t('scenarios.run.col.store')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('scenarios.run.hires')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('scenarios.run.headcount')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('scenarios.run.paidHours')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('scenarios.run.cost')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('scenarios.run.peakLanes')}</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {results.stores.map((st) => (
                    <TableRow key={st.storeId}>
                      <TableRowHeader>{st.storeName}</TableRowHeader>
                      <TableCell numeric>{st.hires === null ? t('scenarios.none') : <Num value={st.hires} />}</TableCell>
                      <TableCell numeric>
                        <Num value={st.headcount} />
                      </TableCell>
                      <TableCell numeric>
                        <Num value={st.paidHours} />
                      </TableCell>
                      <TableCell numeric>
                        <CostValue value={st.cost} level="store" align="end" />
                      </TableCell>
                      <TableCell numeric>
                        <Num value={st.peakLanes} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          </Stack>
        )}
      </Section>

      <Dialog open={confirmDiscard} onOpenChange={(open) => !open && setConfirmDiscard(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('state.unsaved.title')}</DialogTitle>
            <DialogDescription>{t('scenarios.settings.discard.description', { name: s.name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
              {t('scenarios.settings.discard.keep')}
            </Button>
            <Button variant="primary" onClick={discard}>
              {t('action.discard')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Stack>
  )
}

/** A form section: a fieldset whose legend is the section heading (anchor target for the section nav). */
function FormSection({ id, legend, children }: { id: string; legend: string; children: ReactNode }) {
  return (
    <fieldset id={id} className="min-w-0 scroll-mt-4 border border-outline bg-surface p-4">
      <legend className="float-left mb-4 w-full text-h3 text-text">{legend}</legend>
      <div className="clear-left flex flex-col gap-4">{children}</div>
    </fieldset>
  )
}

function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2 laptop:grid-cols-3">{children}</div>
}

/** SCR-031 "Department overrides": learned baselines with optional per-department overrides. */
function DepartmentOverrides({
  departments,
  form,
  editable,
  issues,
  onChange,
  onBlur,
}: {
  departments: readonly ScenarioDepartmentBaseline[]
  form: Readonly<Record<string, DepartmentForm>>
  editable: boolean
  issues: ReadonlySet<IssueId>
  onChange: (departmentId: string, field: DepartmentOverrideField, value: string) => void
  onBlur: (departmentId: string, field: DepartmentOverrideField) => void
}) {
  const { t, formatNumber } = useI18n()
  const ids = useId()
  const captionId = `${ids}-caption`
  if (departments.length === 0) {
    return <p className="text-body-sm text-text-muted">{t('scenarios.settings.dept.none')}</p>
  }
  return (
    <Stack gap={2}>
      <p className="text-body-sm text-text-muted">{t('scenarios.settings.dept.hint')}</p>
      <TableWrap>
        <Table stickyFirstCol>
          <caption id={captionId} className="sr-only">
            {t('scenarios.settings.dept.caption')}
          </caption>
          <TableHead>
            <tr>
              <TableHeaderCell>{t('scenarios.settings.dept.department')}</TableHeaderCell>
              {DEPARTMENT_OVERRIDE_FIELDS.map((field) => (
                <TableHeaderCell key={field} numeric>
                  {t(DEPARTMENT_FIELD_LABEL_KEY[field])}
                </TableHeaderCell>
              ))}
            </tr>
          </TableHead>
          <TableBody>
            {departments.map((d) => {
              const name = t('scenarios.settings.dept.name', { store: d.storeName, department: d.departmentName })
              return (
                <TableRow key={d.departmentId}>
                  <TableRowHeader>{name}</TableRowHeader>
                  {DEPARTMENT_OVERRIDE_FIELDS.map((field) => {
                    const range = DEPARTMENT_OVERRIDE_RANGES[field]
                    const raw = form[d.departmentId]?.[field] ?? ''
                    const learned = formatNumber(d[field], { maximumFractionDigits: 2 })
                    const invalid = issues.has(deptIssueId(d.departmentId, field))
                    const noteId = `${ids}-${d.departmentId}-${field}`
                    return (
                      <TableCell key={field} numeric>
                        <div className="flex flex-col items-end gap-1">
                          <Input
                            type="number"
                            inputMode="decimal"
                            className="w-28 text-right"
                            aria-label={t('scenarios.settings.dept.inputLabel', { field: t(DEPARTMENT_FIELD_LABEL_KEY[field]), department: name })}
                            aria-describedby={noteId}
                            aria-invalid={invalid || undefined}
                            min={range.min}
                            max={range.max}
                            step="any"
                            placeholder={String(d[field])}
                            value={raw}
                            disabled={!editable}
                            onChange={(e) => onChange(d.departmentId, field, e.target.value)}
                            onBlur={() => onBlur(d.departmentId, field)}
                          />
                          <span id={noteId} className="text-body-sm text-text-muted">
                            {invalid ? (
                              <span className="text-on-danger-soft">{t('scenarios.settings.dept.issue', { min: range.min, max: range.max })}</span>
                            ) : raw.trim() !== '' ? (
                              <Pill tone="info">{t('scenarios.settings.edited', { value: learned })}</Pill>
                            ) : (
                              t('scenarios.settings.dept.learned', { value: learned })
                            )}
                          </span>
                        </div>
                      </TableCell>
                    )
                  })}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableWrap>
    </Stack>
  )
}

/** SCR-031 "Rules and data": what the scenario is pinned to, with links to the rule sets and data sources. */
function RulesAndData({ scenario: s, role }: { scenario: ScenarioDetail; role: RoleCode | null }) {
  const { t, formatDate } = useI18n()
  const rulesHref = role && canAccess(role, 'SCR-060') ? '/rules' : null
  const dataHref = role && canAccess(role, 'SCR-050') ? '/data/sources' : null
  return (
    <section id="scn-rules-data" aria-labelledby="scn-rules-data-title" className="scroll-mt-4 border border-outline bg-surface p-4">
      <Stack gap={4}>
        <h2 id="scn-rules-data-title" className="text-h3 text-text">
          {t('scenarios.settings.rulesData')}
        </h2>
        <dl className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-label text-text-muted">{t('scenarios.settings.inputs.rules')}</dt>
            <dd>
              <ul className="flex flex-col gap-1">
                {s.ruleVersions.map((r) => (
                  <li key={r.ruleVersionId}>
                    <Cluster gap={2} align="center">
                      <span className="text-body text-text">{r.ruleSetName}</span>
                      <Pill>{t('scenarios.version', { version: r.version })}</Pill>
                      {r.publishedAt && (
                        <span className="text-body-sm text-text-muted">
                          {t('scenarios.settings.rules.published', { date: formatDate(r.publishedAt, DATE_ONLY) })}
                        </span>
                      )}
                      {!r.current && <StatusPill tone="warning">{t('scenarios.superseded')}</StatusPill>}
                    </Cluster>
                  </li>
                ))}
              </ul>
              {rulesHref && (
                <AppLink href={rulesHref} className="mt-2 inline-flex min-h-tap items-center text-body text-primary underline">
                  {t('scenarios.settings.rules.link')}
                </AppLink>
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-label text-text-muted">{t('scenarios.settings.inputs.snapshots')}</dt>
            <dd>
              <ul className="flex flex-col gap-1">
                {s.snapshots.map((p) => (
                  <li key={p.snapshotId}>
                    <Cluster gap={2} align="center">
                      <span className="text-body text-text">{t(`scenarios.dataset.${p.datasetType}`)}</span>
                      <span className="text-body-sm text-text-muted">
                        {t('scenarios.settings.data.asOf', { date: formatDate(p.loadedAt, DATE_ONLY) })}
                      </span>
                      {s.synthetic && <Pill>{t('scenarios.settings.data.synthetic')}</Pill>}
                      {!p.current && <StatusPill tone="warning">{t('scenarios.superseded')}</StatusPill>}
                    </Cluster>
                  </li>
                ))}
              </ul>
              {dataHref && (
                <AppLink href={dataHref} className="mt-2 inline-flex min-h-tap items-center text-body text-primary underline">
                  {t('scenarios.settings.data.link')}
                </AppLink>
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-label text-text-muted">{t('scenarios.settings.season')}</dt>
            <dd className="text-body text-text">
              {t('scenarios.season.range', { from: formatDate(s.planningFrom, CALENDAR_DATE), to: formatDate(s.planningTo, CALENDAR_DATE) })}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-label text-text-muted">{t('scenarios.settings.baseline')}</dt>
            <dd className="text-body text-text">{t('scenarios.settings.baseline.value')}</dd>
          </div>
        </dl>
      </Stack>
    </section>
  )
}
