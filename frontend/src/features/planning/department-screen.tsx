import { useState } from 'react'
import { can, scheduledByHour, type DepartmentDayView, type LongRosterView, type PlanningJob, type RoleCode, type ViewState } from '@lanewise/shared'
import { AppLink } from '@/app/router'
import { Cluster, Col, Grid, Section, Stack } from '@/components/layout'
import {
  Button,
  CardSkeleton,
  KpiCard,
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
} from '@/components/ui'
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { CostValue } from '@/features/cost'
import { useI18n } from '@/i18n'
import type { PlanningClient } from './api'
import { DATE_FORMAT, HOUR_FORMAT, hourDate, rosterPath } from './logic'
import { LoadError } from './network-screen'
import { useDayText, useLoaded, usePolledJob, useScenarioId } from './hooks'
import { ChartOrTable, ExportButton, JobProgress, LabelledBars, ProvenanceLine, StaleBanner } from './parts'

export interface DepartmentScreenProps {
  readonly client: PlanningClient
  readonly role: RoleCode | null
  readonly state: ViewState
}

/**
 * SCR-021 Department day plan (Req 5.2–5.4): one department for one day —
 * hourly demand, Erlang C lanes, shrinkage and the suggested shifts (shift
 * builder), each chart with a table alternative, plus CSV export. The
 * headline figures are the very ones the network view shows for the
 * department (P2). Planners and store managers can also build the season's
 * roster for the department as a background job (Req 10.2).
 */
export function DepartmentScreen({ client, role, state }: DepartmentScreenProps) {
  const { t } = useI18n()
  useDocumentTitle(t('planning.department.title'))
  const canView = can(role, 'department_plan', 'view')
  const { id: scenarioId, resolving } = useScenarioId(client, state.scenario)
  const dept = state.dept ?? null
  const key = canView && scenarioId && dept ? `${role}|${scenarioId}|${dept}|${state.date ?? ''}` : null
  const [load, reload] = useLoaded<DepartmentDayView>(key, () => client.departmentDay(scenarioId ?? '', dept ?? '', state.date))

  if (!canView) {
    return <StateBlock variant="no-access" title={t('planning.noAccess.title')} description={t('planning.noAccess.description')} />
  }
  return (
    <Stack gap={6}>
      <h1 className="text-h1 text-text">
        {load?.kind === 'ready'
          ? t('planning.department.heading', { department: load.data.figures.departmentName, store: load.data.figures.storeName })
          : t('planning.department.title')}
      </h1>
      {!dept && <StateBlock variant="empty" title={t('planning.department.pick.title')} description={t('planning.department.pick.description')} />}
      {dept && (resolving || load?.kind === 'loading') && <CardSkeleton label={t('state.loading')} />}
      {load?.kind === 'error' && <LoadError code={load.code} referenceId={load.referenceId} onRetry={reload} />}
      {load?.kind === 'ready' && <DepartmentBody view={load.data} client={client} role={role} state={state} />}
    </Stack>
  )
}

function DepartmentBody({ view, client, role, state }: { view: DepartmentDayView; client: PlanningClient; role: RoleCode | null; state: ViewState }) {
  const { t, formatNumber, formatPercent, formatTime } = useI18n()
  const dayText = useDayText()
  const hour = (h: number) => formatTime(hourDate(h), HOUR_FORMAT)
  const f = view.figures
  const hours = view.hours.map((h) => h.hour)
  const scheduled = scheduledByHour(view.shifts, hours)
  const peakRow = view.hours.find((h) => h.hour === f.peakHour)
  const shiftStart = Math.min(...view.shifts.map((s) => s.start), ...hours)
  const shiftEnd = Math.max(...view.shifts.map((s) => s.end), ...hours.map((h) => h + 1))
  const grid = Array.from({ length: Math.max(0, shiftEnd - shiftStart) }, (_, i) => shiftStart + i)

  return (
    <Stack gap={6}>
      <Cluster gap={3} align="center" className="justify-between">
        <Stack gap={1}>
          <p className="text-h3 text-text">{dayText(view.date)}</p>
          <StatusPill tone={view.dayType === 'regular' ? 'neutral' : 'info'}>{t(`planning.dayType.${view.dayType}`)}</StatusPill>
        </Stack>
        <Cluster gap={2} align="center">
          <AppLink href={rosterPath(state)} className="underline focus-visible:outline-focus-ring">
            {t('planning.department.openRoster')}
          </AppLink>
          {can(role, 'department_plan', 'export') && (
            <ExportButton label={t('planning.export.csv')} run={() => client.exportDepartmentDay(view.provenance.scenarioId, f.departmentId, view.date)} />
          )}
        </Cluster>
      </Cluster>
      <ProvenanceLine provenance={view.provenance} />
      <StaleBanner provenance={view.provenance} />

      <Grid>
        <Col span={2} spanTablet={4} spanLaptop={2}>
          <KpiCard emphasis="key" label={t('planning.kpi.peakOnLanes')} value={formatNumber(f.peakLanes)} detail={t('planning.kpi.atHour', { hour: hour(f.peakHour) })} />
        </Col>
        <Col span={2} spanTablet={4} spanLaptop={2}>
          <KpiCard label={t('planning.kpi.scheduledAtPeak')} value={formatNumber(peakRow?.scheduled ?? 0)} detail={t('planning.kpi.inclShrinkage', { pct: formatPercent(view.shrinkage) })} />
        </Col>
        <Col span={2} spanTablet={4} spanLaptop={2}>
          <KpiCard label={t('planning.kpi.cashierHours')} value={formatNumber(f.paidHours)} />
        </Col>
        <Col span={2} spanTablet={4} spanLaptop={2}>
          <KpiCard label={t('planning.kpi.laborCost')} value={<CostValue value={f.cost} level="department" options={{ maximumFractionDigits: 0 }} />} />
        </Col>
        <Col span={2} spanTablet={4} spanLaptop={2}>
          <KpiCard label={t('planning.kpi.forecastTx')} value={formatNumber(Math.round(f.forecastTransactions))} />
        </Col>
        <Col span={2} spanTablet={4} spanLaptop={2}>
          <KpiCard
            label={t('planning.kpi.cashiers')}
            value={formatNumber(f.cashiers)}
            detail={t('planning.kpi.byType', { ft: formatNumber(f.cashiersByType.FT), pt: formatNumber(f.cashiersByType.PT), float: formatNumber(f.cashiersByType.FLOAT) })}
          />
        </Col>
      </Grid>

      <ChartOrTable
        title={t('planning.department.demand')}
        summary={t('planning.department.demandSummary', {
          peak: formatNumber(f.peakLanes),
          hour: hour(f.peakHour),
          target: formatPercent(view.serviceTarget.serviceLevel),
          seconds: formatNumber(view.serviceTarget.thresholdSec),
        })}
        chart={
          <LabelledBars
            label={t('planning.department.demand')}
            rows={view.hours.map((h) => ({
              key: String(h.hour),
              name: hour(h.hour),
              value: h.lanesNeeded,
              text: t('planning.department.barText', { needed: formatNumber(h.lanesNeeded), scheduled: formatNumber(h.scheduled) }),
            }))}
          />
        }
        table={
          <TableWrap>
            <Table stickyFirstCol>
              <caption className="sr-only">{t('planning.department.hourly')}</caption>
              <TableHead>
                <tr>
                  <TableHeaderCell>{t('planning.col.hour')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('planning.col.tx')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('planning.col.erlangs')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('planning.col.onLanes')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('planning.col.required')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('planning.col.scheduled')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('planning.col.utilization')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('planning.col.withinTarget', { seconds: formatNumber(view.serviceTarget.thresholdSec) })}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('planning.col.avgWait')}</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {view.hours.map((h) => (
                  <TableRow key={h.hour}>
                    <TableRowHeader>
                      <Cluster gap={2} align="center">
                        {hour(h.hour)}
                        {h.overCapacity && <StatusPill tone="warning">{t('planning.overCapShort')}</StatusPill>}
                      </Cluster>
                    </TableRowHeader>
                    <TableCell numeric>{formatNumber(Math.round(h.transactions))}</TableCell>
                    <TableCell numeric>{formatNumber(h.erlangs, { maximumFractionDigits: 1 })}</TableCell>
                    <TableCell numeric>{formatNumber(h.lanesOpen)}</TableCell>
                    <TableCell numeric>{formatNumber(h.cashiersRequired)}</TableCell>
                    <TableCell numeric>{formatNumber(h.scheduled)}</TableCell>
                    <TableCell numeric>{formatPercent(h.utilization, { maximumFractionDigits: 0 })}</TableCell>
                    <TableCell numeric>{formatPercent(h.serviceLevel, { maximumFractionDigits: 0 })}</TableCell>
                    <TableCell numeric>{t('planning.seconds', { n: formatNumber(Math.round(h.avgWaitSec)) })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        }
      />

      <Section title={t('planning.department.shifts')} description={t('planning.department.shiftsHelp')}>
        <TableWrap>
          <Table stickyFirstCol>
            <caption className="sr-only">{t('planning.department.shifts')}</caption>
            <TableHead>
              <tr>
                <TableHeaderCell>{t('planning.col.shift')}</TableHeaderCell>
                {grid.map((h) => (
                  <TableHeaderCell key={h} numeric>{hour(h)}</TableHeaderCell>
                ))}
              </tr>
            </TableHead>
            <TableBody>
              {view.shifts.map((s, i) => (
                <TableRow key={s.id}>
                  <TableRowHeader>
                    <Cluster gap={2} align="center">
                      <span>{t('planning.shiftLabel', { n: formatNumber(i + 1) })}</span>
                      <Pill>{t(`planning.contract.${s.type}`)}</Pill>
                      <span className="text-body-sm text-text-muted">{t('planning.shiftTimes', { start: hour(s.start), end: hour(s.end) })}</span>
                    </Cluster>
                  </TableRowHeader>
                  {grid.map((h) => {
                    const on = h >= s.start && h < s.end
                    const meal = s.mealHour === h
                    return (
                      <TableCell key={h} numeric className={on && !meal ? 'bg-viz-1' : on ? 'bg-surface-2' : undefined}>
                        {meal ? t('planning.mealMark') : on ? <span aria-hidden="true">■</span> : null}
                        <span className="sr-only">{meal ? t('planning.meal') : on ? t('planning.onShift') : t('planning.offShift')}</span>
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
              {[
                ['planning.col.required', grid.map((h) => view.hours.find((x) => x.hour === h)?.cashiersRequired ?? 0)],
                ['planning.col.covered', scheduledByHour(view.shifts, grid)],
              ].map(([label, values]) => (
                <TableRow key={label as string} className="bg-surface-2">
                  <TableRowHeader>{t(label as string)}</TableRowHeader>
                  {(values as number[]).map((v, i) => (
                    <TableCell key={grid[i]} numeric>{formatNumber(v)}</TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow className="bg-surface-2">
                <TableRowHeader>{t('planning.col.gap')}</TableRowHeader>
                {grid.map((h, i) => {
                  const required = view.hours.find((x) => x.hour === h)?.cashiersRequired ?? 0
                  const gap = (scheduledByHour(view.shifts, grid)[i] ?? 0) - required
                  return (
                    <TableCell key={h} numeric>
                      {formatNumber(gap, { signDisplay: 'exceptZero' })}
                    </TableCell>
                  )
                })}
              </TableRow>
            </TableBody>
          </Table>
        </TableWrap>
        <p className="text-body-sm text-text-muted">
          {t('planning.department.coverage', { short: formatNumber(scheduled.filter((s, i) => s < (view.hours[i]?.cashiersRequired ?? 0)).length) })}
        </p>
      </Section>

      {can(role, 'weekly_roster', 'edit') && <SeasonRoster client={client} view={view} />}

      <details className="border border-outline p-3">
        <summary className="cursor-pointer text-body text-text font-weight-semibold">{t('planning.howItWorks')}</summary>
        <p className="mt-2 text-body-sm text-text">{t('planning.department.howItWorks', { shrinkage: formatPercent(view.shrinkage) })}</p>
      </details>
    </Stack>
  )
}

/** Builds the department's roster for the whole planning window as a background job (Req 10.2). */
function SeasonRoster({ client, view }: { client: PlanningClient; view: DepartmentDayView }) {
  const { t, formatNumber, formatDate } = useI18n()
  const [job, setJob] = useState<PlanningJob | null>(null)
  const [result, setResult] = useState<LongRosterView | null>(null)
  const [error, setError] = useState(false)
  const scenarioId = view.provenance.scenarioId
  const from = view.date.slice(0, 8) + '01'
  const end = new Date(Date.UTC(Number(view.date.slice(0, 4)), Number(view.date.slice(5, 7)), 0)).toISOString().slice(0, 10)
  const current = usePolledJob(
    job,
    (j) => client.longRoster(scenarioId, j.id).then((v) => v.job),
    (done) => {
      if (done.status === 'succeeded') client.longRoster(scenarioId, done.id).then(setResult, () => setError(true))
    },
  )

  const start = () => {
    setError(false)
    setResult(null)
    client.runLongRoster(scenarioId, { from, to: end, departmentId: view.figures.departmentId }).then(
      (r) => {
        setJob(r.job)
        if (r.job.status === 'succeeded') client.longRoster(scenarioId, r.job.id).then(setResult, () => setError(true))
      },
      () => setError(true),
    )
  }

  return (
    <Section
      title={t('planning.season.title')}
      description={t('planning.season.description', { from: formatDate(`${from}T00:00:00Z`, DATE_FORMAT), to: formatDate(`${end}T00:00:00Z`, DATE_FORMAT) })}
      actions={
        <Button size="sm" onClick={start} disabled={current?.status === 'queued' || current?.status === 'running'}>
          {t('planning.season.run')}
        </Button>
      }
    >
      {current && current.status !== 'succeeded' && <JobProgress job={current} />}
      {error && <p role="alert" className="text-body-sm text-danger">{t('planning.error.title')}</p>}
      {result?.weeks && (
        <TableWrap>
          <Table stickyFirstCol>
            <caption className="sr-only">{t('planning.season.title')}</caption>
            <TableHead>
              <tr>
                <TableHeaderCell>{t('planning.col.week')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('planning.col.shifts')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('planning.col.assigned')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('planning.col.open')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('planning.col.paidHours')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('planning.col.warnings')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('planning.col.cost')}</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {result.weeks.map((w) => (
                <TableRow key={`${w.departmentId}-${w.weekStart}`}>
                  <TableRowHeader>{formatDate(`${w.weekStart}T00:00:00Z`, DATE_FORMAT)}</TableRowHeader>
                  <TableCell numeric>{formatNumber(w.shifts)}</TableCell>
                  <TableCell numeric>{formatNumber(w.assigned)}</TableCell>
                  <TableCell numeric>{formatNumber(w.openShifts)}</TableCell>
                  <TableCell numeric>{formatNumber(w.paidHours)}</TableCell>
                  <TableCell numeric>{formatNumber(w.laborWarnings)}</TableCell>
                  <TableCell numeric>
                    <CostValue value={w.cost} level="department" align="end" options={{ maximumFractionDigits: 0 }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      )}
    </Section>
  )
}
