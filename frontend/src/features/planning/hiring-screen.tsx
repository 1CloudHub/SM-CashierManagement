import { useState } from 'react'
import { can, type HiringPlanView, type PlanningJob, type RoleCode, type ViewState } from '@lanewise/shared'
import { AppLink } from '@/app/router'
import { useAnnouncer } from '@/components/a11y'
import { Cluster, Col, Grid, Section, Stack } from '@/components/layout'
import {
  Button,
  CardSkeleton,
  KpiCard,
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
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { CostValue } from '@/features/cost'
import { useI18n } from '@/i18n'
import type { PlanningClient } from './api'
import { DATE_FORMAT, MILESTONE_TONE, summaryPath } from './logic'
import { LoadError } from './network-screen'
import { useLoaded, usePolledJob, useScenarioId } from './hooks'
import { ChartOrTable, ExportButton, JobProgress, LabelledBars, ProvenanceLine, StaleBanner } from './parts'

export interface HiringScreenProps {
  readonly client: PlanningClient
  readonly role: RoleCode | null
  readonly state: ViewState
}

/**
 * SCR-023 Hiring plan (Req 10.1, 10.2): the seasonal hires by store and
 * role, the "When to act" timeline and the team table. The plan runs as a
 * background job: the progress bar counts departments, the user can leave
 * the page and is notified when it finishes; results are cached per scenario
 * version, and a stale plan offers Recalculate.
 */
export function HiringScreen({ client, role, state }: HiringScreenProps) {
  const { t } = useI18n()
  useDocumentTitle(t('planning.hiring.title'))
  const canView = can(role, 'hiring_plan', 'view')
  const { id: scenarioId, resolving } = useScenarioId(client, state.scenario)
  const key = canView && scenarioId ? `${role}|${scenarioId}` : null
  const [load, reload] = useLoaded<HiringPlanView>(key, () => client.hiringPlan(scenarioId ?? ''))

  if (!canView) {
    return <StateBlock variant="no-access" title={t('planning.noAccess.title')} description={t('planning.noAccess.description')} />
  }
  return (
    <Stack gap={6}>
      <h1 className="text-h1 text-text">{t('planning.hiring.title')}</h1>
      {!resolving && !scenarioId && <StateBlock variant="empty" title={t('planning.noScenario.title')} description={t('planning.noScenario.description')} />}
      {(resolving || load?.kind === 'loading') && <CardSkeleton label={t('state.loading')} />}
      {load?.kind === 'error' && <LoadError code={load.code} referenceId={load.referenceId} onRetry={reload} />}
      {load?.kind === 'ready' && <HiringBody key={load.data.provenance.scenarioId} view={load.data} client={client} role={role} onReload={reload} />}
    </Stack>
  )
}

function HiringBody({ view, client, role, onReload }: { view: HiringPlanView; client: PlanningClient; role: RoleCode | null; onReload: () => void }) {
  const { t, formatNumber, formatDate } = useI18n()
  const { announce } = useAnnouncer()
  const date = (d: string | null) => (d ? formatDate(`${d}T00:00:00Z`, DATE_FORMAT) : t('planning.none'))
  const scenarioId = view.provenance.scenarioId
  const [started, setStarted] = useState<PlanningJob | null>(null)
  const [runError, setRunError] = useState(false)
  const job = usePolledJob(started ?? view.job, (j) => client.hiringJob(scenarioId, j.id), () => onReload())
  const running = job !== null && (job.status === 'queued' || job.status === 'running')
  const canRun = can(role, 'hiring_plan', 'edit')

  const run = () => {
    setRunError(false)
    client.runHiringPlan(scenarioId).then(
      (r) => {
        if (r.cached && r.job.status === 'succeeded') {
          announce(t('planning.hiring.cached'))
          onReload()
        } else {
          setStarted(r.job)
          announce(t('planning.job.started'))
        }
      },
      () => setRunError(true),
    )
  }
  const runButton = canRun ? (
    <Button variant={view.plan ? 'secondary' : 'primary'} onClick={run} disabled={running}>
      {view.plan ? t('action.recalculate') : t('planning.hiring.run')}
    </Button>
  ) : null

  const plan = view.plan
  return (
    <Stack gap={6}>
      <Cluster gap={3} align="center" className="justify-between">
        <p className="text-body text-text">{t('planning.hiring.season', { from: date(view.from), to: date(view.to) })}</p>
        <Cluster gap={2} align="center">
          {runButton}
          <AppLink href={summaryPath(scenarioId)} className="underline focus-visible:outline-focus-ring">{t('planning.hiring.openSummary')}</AppLink>
          {plan && can(role, 'hiring_plan', 'export') && <ExportButton label={t('planning.export.csv')} run={() => client.exportHiringPlan(scenarioId)} />}
        </Cluster>
      </Cluster>
      {plan && <ProvenanceLine provenance={view.provenance} />}
      {plan && <StaleBanner provenance={view.provenance} action={runButton ?? undefined} />}
      {running && job && <JobProgress job={job} />}
      {job?.status === 'failed' && (
        <StateBlock variant="error" title={t('planning.job.failed')} description={job.errorMessage ?? undefined} />
      )}
      {runError && <p role="alert" className="text-body-sm text-danger">{t('planning.error.title')}</p>}
      {!plan && !running && (
        <StateBlock
          variant="empty"
          title={t('planning.hiring.empty.title')}
          description={canRun ? t('planning.hiring.empty.planner') : t('planning.hiring.empty.other')}
        />
      )}

      {plan && (
        <>
          <Grid>
            <Col span={2} spanTablet={4} spanLaptop={2}>
              <KpiCard
                emphasis="key"
                label={t('planning.kpi.seasonalHires')}
                value={formatNumber(plan.kpis.seasonalHires)}
                detail={t('planning.kpi.byType', { ft: formatNumber(plan.kpis.hiresByType.FT), pt: formatNumber(plan.kpis.hiresByType.PT), float: formatNumber(plan.kpis.hiresByType.FLOAT) })}
              />
            </Col>
            <Col span={2} spanTablet={4} spanLaptop={2}>
              <KpiCard label={t('planning.kpi.peakTeam')} value={formatNumber(plan.kpis.peakTeam)} detail={t('planning.kpi.vsBaseline', { n: formatNumber(plan.kpis.baselineTeam) })} />
            </Col>
            <Col span={2} spanTablet={4} spanLaptop={3}>
              <KpiCard label={t('planning.kpi.firstNeeded')} value={date(plan.kpis.firstNeededBy)} detail={t('planning.kpi.recruitFrom', { date: date(plan.kpis.recruitFrom) })} />
            </Col>
            <Col span={2} spanTablet={4} spanLaptop={2}>
              <KpiCard label={t('planning.kpi.seasonHours')} value={formatNumber(plan.kpis.seasonPaidHours)} />
            </Col>
            <Col span={4} spanTablet={4} spanLaptop={3}>
              <KpiCard label={t('planning.kpi.seasonCost')} value={<CostValue value={plan.kpis.seasonCost} level="network" options={{ maximumFractionDigits: 0 }} />} />
            </Col>
          </Grid>

          <ChartOrTable
            title={t('planning.hiring.byStore')}
            summary={t('planning.hiring.byStoreSummary', { hires: formatNumber(plan.kpis.seasonalHires), stores: formatNumber(plan.stores.length) })}
            chart={
              <LabelledBars
                label={t('planning.hiring.byStore')}
                rows={plan.stores.map((s) => ({
                  key: s.storeId,
                  name: s.storeName,
                  value: s.hires,
                  text: t('planning.hiring.barText', { hires: formatNumber(s.hires), baseline: formatNumber(s.baseline) }),
                }))}
              />
            }
            table={
              <TableWrap>
                <Table stickyFirstCol>
                  <caption className="sr-only">{t('planning.hiring.byStore')}</caption>
                  <TableHead>
                    <tr>
                      <TableHeaderCell>{t('planning.col.store')}</TableHeaderCell>
                      <TableHeaderCell numeric>{t('planning.col.baseline')}</TableHeaderCell>
                      <TableHeaderCell numeric>{t('planning.col.ftHires')}</TableHeaderCell>
                      <TableHeaderCell numeric>{t('planning.col.ptHires')}</TableHeaderCell>
                      <TableHeaderCell numeric>{t('planning.col.floatHires')}</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {plan.stores.map((s) => (
                      <TableRow key={s.storeId}>
                        <TableRowHeader>{s.storeName}</TableRowHeader>
                        <TableCell numeric>{formatNumber(s.baseline)}</TableCell>
                        <TableCell numeric>{formatNumber(s.hiresByType.FT)}</TableCell>
                        <TableCell numeric>{formatNumber(s.hiresByType.PT)}</TableCell>
                        <TableCell numeric>{formatNumber(s.hiresByType.FLOAT)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
            }
          />

          <Section title={t('planning.hiring.timeline')} description={t('planning.hiring.timelineHelp')}>
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {plan.timeline.map((m) => (
                <li key={`${m.waveId}-${m.name}`} className="flex flex-wrap items-center gap-3 border-b-2 border-outline pb-2">
                  <span className="lw-numeric w-28 text-body text-text">{date(m.date)}</span>
                  <StatusPill tone={MILESTONE_TONE[m.status]}>{t(`planning.milestone.${m.status}`)}</StatusPill>
                  <span className="text-body text-text">
                    {t('planning.hiring.milestone', { name: m.name, type: t(`planning.contract.${m.contractType}`), n: formatNumber(m.count) })}
                  </span>
                </li>
              ))}
            </ol>
          </Section>

          <Section title={t('planning.hiring.team')}>
            <TableWrap>
              <Table stickyFirstCol>
                <caption className="sr-only">{t('planning.hiring.team')}</caption>
                <TableHead>
                  <tr>
                    <TableHeaderCell>{t('planning.col.storeDepartment')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('planning.col.baseline')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('planning.col.season')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('planning.col.hires')}</TableHeaderCell>
                    <TableHeaderCell>{t('planning.col.neededBy')}</TableHeaderCell>
                    <TableHeaderCell>{t('planning.col.busiestWeek')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('planning.col.shifts')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('planning.col.paidHours')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('planning.col.cost')}</TableHeaderCell>
                    <TableHeaderCell numeric>{t('planning.col.ftAvg')}</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {plan.stores.flatMap((s) => [
                    <TableRow key={s.storeId} className="bg-surface-2">
                      <TableRowHeader className="font-weight-semibold">{s.storeName}</TableRowHeader>
                      <TableCell numeric>{formatNumber(s.baseline)}</TableCell>
                      <TableCell numeric>{formatNumber(s.season)}</TableCell>
                      <TableCell numeric>{formatNumber(s.hires)}</TableCell>
                      <TableCell>{date(s.neededBy)}</TableCell>
                      <TableCell>{date(s.busiestWeek)}</TableCell>
                      <TableCell numeric>{formatNumber(s.shifts)}</TableCell>
                      <TableCell numeric>{formatNumber(s.paidHours)}</TableCell>
                      <TableCell numeric>
                        <CostValue value={s.cost} level="store" align="end" options={{ maximumFractionDigits: 0 }} />
                      </TableCell>
                      <TableCell numeric>{t('planning.none')}</TableCell>
                    </TableRow>,
                    ...s.departments.map((d) => (
                      <TableRow key={d.departmentId}>
                        <TableRowHeader className="pl-8">{d.departmentName}</TableRowHeader>
                        <TableCell numeric>{formatNumber(d.baseline)}</TableCell>
                        <TableCell numeric>{formatNumber(d.season)}</TableCell>
                        <TableCell numeric>{formatNumber(d.hires)}</TableCell>
                        <TableCell>{date(d.neededBy)}</TableCell>
                        <TableCell>{date(d.busiestWeek)}</TableCell>
                        <TableCell numeric>{formatNumber(d.shifts)}</TableCell>
                        <TableCell numeric>{formatNumber(d.paidHours)}</TableCell>
                        <TableCell numeric>
                          <CostValue value={d.cost} level="department" align="end" options={{ maximumFractionDigits: 0 }} />
                        </TableCell>
                        <TableCell numeric>{d.ftAvgWeeklyHours === null ? t('planning.none') : formatNumber(d.ftAvgWeeklyHours, { maximumFractionDigits: 1 })}</TableCell>
                      </TableRow>
                    )),
                  ])}
                </TableBody>
              </Table>
            </TableWrap>
          </Section>
        </>
      )}
    </Stack>
  )
}
