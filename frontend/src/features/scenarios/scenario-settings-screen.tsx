import { useCallback, useEffect, useId, useState } from 'react'
import { Star } from 'lucide-react'
import { can, type RoleCode, type ScenarioDetail, type ScenarioSettingKey } from '@lanewise/shared'
import { Cluster, Col, Grid, Section, Stack } from '@/components/layout'
import {
  Alert,
  Button,
  CardSkeleton,
  Checkbox,
  Field,
  Input,
  KpiCard,
  Num,
  Pill,
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
} from '@/components/ui'
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { CostValue } from '@/features/cost'
import { useI18n } from '@/i18n'
import { errorCode, errorReference, type ScenariosClient } from './api'
import { CALENDAR_DATE, DATE_TIME, SCENARIO_STATUS_TONE, formEquals, issuesFromDetails, toForm, validateForm, type SettingsForm } from './logic'
import { ApiError } from '@/api'

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
  | { readonly kind: 'ready'; readonly scenario: ScenarioDetail }

type Notice = { readonly tone: 'success' | 'danger'; readonly text: string } | null

/**
 * SCR-031 Scenario settings (requirement 8.2–8.5, P4, P5): the settings a
 * run uses, the pinned inputs, the stale banner with Recalculate, and the
 * latest run's results. Settings are editable in Draft only; any other state
 * offers "Duplicate as draft".
 */
export function ScenarioSettingsScreen({ client, role, scenarioId, onOpenScenario }: ScenarioSettingsScreenProps) {
  const { t, formatDate, formatDateTime } = useI18n()
  useDocumentTitle(t('scenarios.settings.pageTitle'))
  const ids = useId()
  const canEdit = can(role, 'scenario_settings', 'edit')
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [issues, setIssues] = useState<ReadonlySet<ScenarioSettingKey>>(new Set())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const accept = useCallback((scenario: ScenarioDetail) => {
    setLoad({ kind: 'ready', scenario })
    setForm(toForm(scenario.settings))
    setIssues(new Set())
  }, [])

  const fetchOne = useCallback(() => {
    client.get(scenarioId).then(accept, (error: unknown) => setLoad({ kind: 'error', referenceId: errorReference(error) }))
  }, [client, scenarioId, accept])

  useEffect(() => {
    fetchOne()
  }, [fetchOne])

  if (load.kind === 'loading' || (load.kind === 'ready' && !form)) {
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

  const s = load.scenario
  const f = form!
  const editable = s.editable && canEdit
  const dirty = !formEquals(f, toForm(s.settings))
  const blocker = dirty ? (s.submitBlocker ?? 'stale') : s.submitBlocker
  const update = (patch: Partial<SettingsForm>) => setForm({ ...f, ...patch })
  const issue = (key: ScenarioSettingKey) => (issues.has(key) ? t(`scenarios.settings.issue.${key}`) : undefined)

  const fail = (e: unknown) => {
    const code = errorCode(e)
    if (code === 'validation_failed' && e instanceof ApiError) setIssues(issuesFromDetails(e.details))
    setNotice({
      tone: 'danger',
      text: t(code === 'conflict' ? 'scenarios.error.conflict' : code === 'validation_failed' ? 'scenarios.error.validation' : 'scenarios.error.generic'),
    })
  }

  const perform = async (fn: () => Promise<void>) => {
    setBusy(true)
    setNotice(null)
    try {
      await fn()
    } catch (e) {
      fail(e)
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
    })
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

  const results = s.latestRun?.status === 'succeeded' ? s.latestRun.results : null
  const blockerId = `${ids}-blocker`

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Cluster gap={2} align="center">
          {s.isPublished && <Star aria-label={t('scenarios.published')} role="img" className="size-5 shrink-0 fill-current" />}
          <h1 className="text-h1 text-text">{s.name}</h1>
        </Cluster>
        <Cluster gap={2}>
          <StatusPill tone={SCENARIO_STATUS_TONE[s.status]}>{t(`scenario.status.${s.status}`)}</StatusPill>
          {s.stale && <StatusPill tone="warning">{t('scenarios.stale')}</StatusPill>}
          <span className="text-body-sm text-text-muted">
            {t('scenarios.season.range', { from: formatDate(s.planningFrom, CALENDAR_DATE), to: formatDate(s.planningTo, CALENDAR_DATE) })}
          </span>
        </Cluster>
      </Stack>

      {notice && <Alert tone={notice.tone} title={notice.text} assertive={notice.tone === 'danger'} />}

      {s.stale && (
        <Alert
          tone="warning"
          title={t('scenarios.settings.stale.title')}
          action={
            canEdit ? (
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

      {!editable && (
        <Alert
          tone="info"
          live={false}
          title={t('scenarios.settings.readOnly.title')}
          action={
            canEdit ? (
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
        <Col span={4} spanTablet={8} spanLaptop={6}>
          <Stack gap={4}>
            <Section title={t('scenarios.settings.demand')}>
              <Field label={t('scenarios.settings.growth')} hint={t('scenarios.settings.growth.hint')} error={issue('growth')}>
                {(aria) => (
                  <Input
                    {...aria}
                    type="number"
                    step="0.5"
                    inputMode="decimal"
                    value={f.growthPct}
                    disabled={!editable}
                    onChange={(e) => update({ growthPct: e.target.value })}
                  />
                )}
              </Field>
            </Section>
            <Section title={t('scenarios.settings.shifts')}>
              <Checkbox
                id={`${ids}-pt`}
                label={t('scenarios.settings.allowPartTime')}
                checked={f.allowPartTime}
                disabled={!editable}
                onChange={(e) => update({ allowPartTime: e.target.checked })}
              />
            </Section>
            <Section title={t('scenarios.settings.season')}>
              <Field label={t('scenarios.settings.planningFrom')} error={issue('planningFrom')}>
                {(aria) => (
                  <Input {...aria} type="date" value={f.planningFrom} disabled={!editable} onChange={(e) => update({ planningFrom: e.target.value })} />
                )}
              </Field>
              <Field label={t('scenarios.settings.planningTo')} error={issue('planningTo')}>
                {(aria) => (
                  <Input {...aria} type="date" value={f.planningTo} disabled={!editable} onChange={(e) => update({ planningTo: e.target.value })} />
                )}
              </Field>
              <Field label={t('scenarios.settings.peakDay')} error={issue('peakDay')}>
                {(aria) => (
                  <Input {...aria} type="date" value={f.peakDay} disabled={!editable} onChange={(e) => update({ peakDay: e.target.value })} />
                )}
              </Field>
            </Section>
            <Section title={t('scenarios.settings.notes')}>
              <Field label={t('scenarios.settings.notes')} error={issue('notes')}>
                {(aria) => <Textarea {...aria} value={f.notes} disabled={!editable} onChange={(e) => update({ notes: e.target.value })} />}
              </Field>
            </Section>
          </Stack>
        </Col>
        <Col span={4} spanTablet={8} spanLaptop={6}>
          <Section title={t('scenarios.settings.inputs')}>
            <h3 className="text-h3 text-text">{t('scenarios.settings.inputs.snapshots')}</h3>
            <ul className="flex flex-col gap-2">
              {s.snapshots.map((p) => (
                <li key={p.snapshotId}>
                  <Cluster gap={2}>
                    <span className="text-body text-text">{t(`scenarios.dataset.${p.datasetType}`)}</span>
                    <span className="text-body-sm text-text-muted">
                      {t('scenarios.settings.inputs.loaded', { date: formatDateTime(p.loadedAt, DATE_TIME) })}
                    </span>
                    {!p.current && <StatusPill tone="warning">{t('scenarios.superseded')}</StatusPill>}
                  </Cluster>
                </li>
              ))}
            </ul>
            <h3 className="text-h3 text-text">{t('scenarios.settings.inputs.rules')}</h3>
            <ul className="flex flex-col gap-2">
              {s.ruleVersions.map((r) => (
                <li key={r.ruleVersionId}>
                  <Cluster gap={2}>
                    <span className="text-body text-text">{r.ruleSetName}</span>
                    <Pill>{t('scenarios.version', { version: r.version })}</Pill>
                    {!r.current && <StatusPill tone="warning">{t('scenarios.superseded')}</StatusPill>}
                  </Cluster>
                </li>
              ))}
            </ul>
          </Section>
        </Col>
      </Grid>

      {editable && (
        <Stack gap={2}>
          <Cluster gap={3}>
            <Button variant="ghost" disabled={!dirty || busy} onClick={() => accept(s)}>
              {t('action.discard')}
            </Button>
            <Button disabled={busy} onClick={() => save(false)}>
              {t('scenarios.settings.save')}
            </Button>
            <Button variant="primary" disabled={busy} aria-busy={busy || undefined} onClick={() => save(true)}>
              {t('scenarios.settings.saveAndRun')}
            </Button>
            {can(role, 'scenario_submit', 'edit') && (
              <Button disabled={busy || blocker !== null} aria-describedby={blocker ? blockerId : undefined} onClick={submit}>
                {t('scenarios.settings.submit')}
              </Button>
            )}
          </Cluster>
          {blocker && (
            <p id={blockerId} className="text-body-sm text-text-muted">
              {t(`scenarios.blocker.${blocker}`)}
            </p>
          )}
        </Stack>
      )}

      <Section title={t('scenarios.run.title')}>
        {s.latestRun?.status === 'failed' && <Alert tone="danger" title={t('scenarios.run.failed')} />}
        {!results && s.latestRun?.status !== 'failed' && <p className="text-body text-text-muted">{t('scenarios.run.none')}</p>}
        {results && (
          <Stack gap={4}>
            {s.lastRunAt && <p className="text-body-sm text-text-muted">{formatDateTime(s.lastRunAt, DATE_TIME)}</p>}
            <Grid>
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
    </Stack>
  )
}
