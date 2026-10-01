import { useMemo } from 'react'
import { can, type NetworkView, type RoleCode, type ViewState } from '@lanewise/shared'
import { AppLink } from '@/app/router'
import { Cluster, Col, Grid, Section, Stack } from '@/components/layout'
import {
  Alert,
  CardSkeleton,
  Field,
  KpiCard,
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
} from '@/components/ui'
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { CostValue } from '@/features/cost'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { PlanningClient } from './api'
import {
  HOUR_FORMAT,
  NETWORK_SORTS,
  PRESSURE_CLASS,
  departmentPath,
  hourDate,
  isNetworkSort,
  networkQueryOf,
  pressureBand,
  sortStores,
  type NetworkSort,
} from './logic'
import { useDayText, useLoaded, useScenarioId } from './hooks'
import { ChartOrTable, ExportButton, LabelledBars, ProvenanceLine, StaleBanner } from './parts'

export interface NetworkScreenProps {
  readonly client: PlanningClient
  readonly role: RoleCode | null
  /** The URL view state (context bar, P8). */
  readonly state: ViewState
  readonly onSortChange: (sort: NetworkSort) => void
}

/**
 * SCR-020 Network view (Req 5.1, 5.3, 5.4): every in-scope store and
 * department for a date — KPIs, over-capacity warnings, hourly need by
 * store, the department × hour lane-pressure heatmap (values always printed)
 * and the staffing table, each with a table alternative, plus CSV export of
 * the filtered view. A department row opens its day plan (SCR-021).
 */
export function NetworkScreen({ client, role, state, onSortChange }: NetworkScreenProps) {
  const { t, formatNumber, formatTime } = useI18n()
  useDocumentTitle(t('planning.network.title'))
  const canView = can(role, 'network_view', 'view')
  const { id: scenarioId, resolving } = useScenarioId(client, state.scenario)
  const query = networkQueryOf(state)
  const key = canView && scenarioId ? `${role}|${scenarioId}|${JSON.stringify(query)}` : null
  const [load, reload] = useLoaded<NetworkView>(key, () => client.network(scenarioId ?? '', query))
  const sort: NetworkSort = isNetworkSort(state.sort) ? state.sort : 'store'
  const dayText = useDayText()
  const hour = (h: number) => formatTime(hourDate(h), HOUR_FORMAT)

  if (!canView) {
    return <StateBlock variant="no-access" title={t('planning.noAccess.title')} description={t('planning.noAccess.description')} />
  }

  return (
    <Stack gap={6}>
      <h1 className="text-h1 text-text">{t('planning.network.title')}</h1>
      {!resolving && !scenarioId && (
        <StateBlock
          variant="empty"
          title={t('planning.noScenario.title')}
          description={t('planning.noScenario.description')}
          action={<AppLink href="/scenarios" className="underline focus-visible:outline-focus-ring">{t('planning.noScenario.open')}</AppLink>}
        />
      )}
      {(resolving || load?.kind === 'loading') && <CardSkeleton label={t('state.loading')} />}
      {load?.kind === 'error' && <LoadError code={load.code} referenceId={load.referenceId} onRetry={reload} />}
      {load?.kind === 'ready' && (
        <NetworkBody
          view={load.data}
          role={role}
          state={state}
          sort={sort}
          onSortChange={onSortChange}
          dayText={dayText}
          hour={hour}
          formatNumber={formatNumber}
          onExport={() => client.exportNetwork(load.data.provenance.scenarioId, query)}
        />
      )}
    </Stack>
  )
}

export function LoadError({ code, referenceId, onRetry }: { code: string | null; referenceId?: string; onRetry: () => void }) {
  const { t } = useI18n()
  if (code === 'conflict') {
    return <StateBlock variant="empty" title={t('planning.notRun.title')} description={t('planning.notRun.description')} />
  }
  if (code === 'validation_failed') {
    return <StateBlock variant="empty" title={t('planning.outsideWindow.title')} description={t('planning.outsideWindow.description')} />
  }
  if (code === 'not_found') {
    return <StateBlock variant="no-access" title={t('planning.notFound.title')} description={t('planning.notFound.description')} />
  }
  return (
    <StateBlock
      variant="error"
      title={t('planning.error.title')}
      referenceId={referenceId}
      action={
        <button type="button" className="underline focus-visible:outline-focus-ring" onClick={onRetry}>
          {t('action.retry')}
        </button>
      }
    />
  )
}

function NetworkBody({
  view,
  role,
  state,
  sort,
  onSortChange,
  dayText,
  hour,
  formatNumber,
  onExport,
}: {
  view: NetworkView
  role: RoleCode | null
  state: ViewState
  sort: NetworkSort
  onSortChange: (sort: NetworkSort) => void
  dayText: (date: string) => string
  hour: (h: number) => string
  formatNumber: (v: number, o?: Intl.NumberFormatOptions) => string
  onExport: () => ReturnType<PlanningClient['exportNetwork']>
}) {
  const { t } = useI18n()
  const k = view.kpis
  const stores = useMemo(() => sortStores(view.stores, sort), [view.stores, sort])
  const departments = stores.flatMap((s) => s.departments)
  const over = departments.filter((d) => d.overCapacityHours.length > 0)
  const totalsByHour = view.hours.map((h) => ({ hour: h, lanes: view.stores.reduce((n, s) => n + (s.lanesByHour.find((x) => x.hour === h)?.lanesOpen ?? 0), 0) }))

  if (view.stores.length === 0) {
    return <StateBlock variant="empty" title={t('planning.network.empty.title')} description={t('planning.network.empty.description')} />
  }

  return (
    <Stack gap={6}>
      <Cluster gap={3} align="center" className="justify-between">
        <Stack gap={1}>
          <p className="text-h3 text-text">{dayText(view.date)}</p>
          <Cluster gap={2}>
            <StatusPill tone={view.dayType === 'regular' ? 'neutral' : 'info'}>{t(`planning.dayType.${view.dayType}`)}</StatusPill>
            <span className="text-body-sm text-text-muted">
              {t('planning.network.scopeLine', { stores: formatNumber(k.stores), departments: formatNumber(k.departments) })}
            </span>
          </Cluster>
        </Stack>
        {can(role, 'network_view', 'export') && <ExportButton label={t('planning.export.csv')} run={onExport} />}
      </Cluster>
      <ProvenanceLine provenance={view.provenance} />
      <StaleBanner provenance={view.provenance} />

      <Grid>
        <Col span={2} spanTablet={4} spanLaptop={3}>
          <KpiCard
            emphasis="key"
            label={t('planning.kpi.peakOnLanes')}
            value={formatNumber(k.peakLanes)}
            detail={t('planning.kpi.atHour', { hour: hour(k.peakHour) })}
          />
        </Col>
        <Col span={2} spanTablet={4} spanLaptop={3}>
          <KpiCard
            label={t('planning.kpi.cashiers')}
            value={formatNumber(k.cashiers)}
            detail={t('planning.kpi.byType', { ft: formatNumber(k.cashiersByType.FT), pt: formatNumber(k.cashiersByType.PT), float: formatNumber(k.cashiersByType.FLOAT) })}
          />
        </Col>
        <Col span={2} spanTablet={4} spanLaptop={2}>
          <KpiCard label={t('planning.kpi.paidHours')} value={formatNumber(k.paidHours)} />
        </Col>
        <Col span={2} spanTablet={4} spanLaptop={2}>
          <KpiCard label={t('planning.kpi.rosterCost')} value={<CostValue value={k.cost} level="network" options={{ maximumFractionDigits: 0 }} />} />
        </Col>
        <Col span={4} spanTablet={4} spanLaptop={2}>
          <KpiCard
            label={t('planning.kpi.overCapacity')}
            tone={k.overCapacityDepartments > 0 ? 'warning' : undefined}
            value={t('planning.kpi.ofDepartments', { n: formatNumber(k.overCapacityDepartments), total: formatNumber(k.departments) })}
          />
        </Col>
      </Grid>

      {over.length > 0 && (
        <Alert tone="warning" title={t('planning.network.overTitle')}>
          <ul className="m-0 list-disc pl-5">
            {over.map((d) => (
              <li key={d.departmentId}>
                <AppLink
                  href={departmentPath(state, d.storeId, d.departmentId, view.date)}
                  // inline-block + vertical padding keeps each stacked link a 24px target (WCAG 2.5.8).
                  className="inline-block py-1 underline focus-visible:outline-focus-ring"
                >
                  {t('planning.network.overItem', {
                    store: d.storeName,
                    department: d.departmentName,
                    needs: formatNumber(d.maxLanesNeeded),
                    has: formatNumber(d.installedLanes),
                    hours: formatNumber(d.overCapacityHours.length),
                  })}
                </AppLink>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <ChartOrTable
        title={t('planning.network.byHour')}
        summary={t('planning.network.byHourSummary', { peak: formatNumber(k.peakLanes), hour: hour(k.peakHour) })}
        chart={
          <LabelledBars
            label={t('planning.network.byHour')}
            rows={totalsByHour.map((r) => ({ key: String(r.hour), name: hour(r.hour), value: r.lanes, text: formatNumber(r.lanes) }))}
          />
        }
        table={
          <TableWrap>
            <Table stickyFirstCol>
              <caption className="sr-only">{t('planning.network.byHour')}</caption>
              <TableHead>
                <tr>
                  <TableHeaderCell>{t('planning.col.store')}</TableHeaderCell>
                  {view.hours.map((h) => (
                    <TableHeaderCell key={h} numeric>{hour(h)}</TableHeaderCell>
                  ))}
                </tr>
              </TableHead>
              <TableBody>
                {view.stores.map((s) => (
                  <TableRow key={s.storeId}>
                    <TableRowHeader>{s.storeName}</TableRowHeader>
                    {s.lanesByHour.map((h) => (
                      <TableCell key={h.hour} numeric>{formatNumber(h.lanesOpen)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        }
      />

      <Section title={t('planning.network.heatmap')} description={t('planning.network.heatmapHelp')}>
        <TableWrap>
          <Table stickyFirstCol>
            <caption className="sr-only">{t('planning.network.heatmap')}</caption>
            <TableHead>
              <tr>
                <TableHeaderCell>{t('planning.col.department')}</TableHeaderCell>
                {view.hours.map((h) => (
                  <TableHeaderCell key={h} numeric>{hour(h)}</TableHeaderCell>
                ))}
              </tr>
            </TableHead>
            <TableBody>
              {departments.map((d) => (
                <TableRow key={d.departmentId}>
                  <TableRowHeader>
                    <AppLink href={departmentPath(state, d.storeId, d.departmentId, view.date)} className="underline focus-visible:outline-focus-ring">
                      {t('planning.network.deptLabel', { store: d.storeName, department: d.departmentName })}
                    </AppLink>
                  </TableRowHeader>
                  {view.hours.map((h) => {
                    const cell = d.hours.find((x) => x.hour === h)
                    if (!cell) return <TableCell key={h} numeric>{t('planning.none')}</TableCell>
                    const band = pressureBand(cell.pressurePct, cell.overCapacity)
                    return (
                      <TableCell key={h} numeric className={cn(PRESSURE_CLASS[band])}>
                        {formatNumber(cell.lanesNeeded)}
                        {band === 'over' && <span aria-hidden="true"> ▲</span>}
                        <span className="sr-only">
                          {t(`planning.band.${band}`, { pct: formatNumber(cell.pressurePct) })}
                        </span>
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
        <p className="text-body-sm text-text-muted">{t('planning.network.legend')}</p>
      </Section>

      <Section
        title={t('planning.network.table')}
        actions={
          <Field label={t('planning.sort.label')}>
            {(aria) => (
              <Select {...aria} value={sort} onChange={(e) => onSortChange(e.target.value as NetworkSort)}>
                {NETWORK_SORTS.map((s) => (
                  <option key={s} value={s}>{t(`planning.sort.${s}`)}</option>
                ))}
              </Select>
            )}
          </Field>
        }
      >
        <TableWrap>
          <Table stickyFirstCol>
            <caption className="sr-only">{t('planning.network.table')}</caption>
            <TableHead>
              <tr>
                <TableHeaderCell>{t('planning.col.storeDepartment')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('planning.col.forecastTx')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('planning.col.peakOnLanes')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('planning.col.installedLanes')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('planning.col.cashiers')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('planning.col.paidHours')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('planning.col.cost')}</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {stores.flatMap((s) => [
                <TableRow key={s.storeId} className="bg-surface-2">
                  <TableRowHeader className="font-weight-semibold">{s.storeName}</TableRowHeader>
                  <TableCell numeric>{formatNumber(Math.round(s.forecastTransactions))}</TableCell>
                  <TableCell numeric>{t('planning.peakAt', { n: formatNumber(s.peakLanes), hour: hour(s.peakHour) })}</TableCell>
                  <TableCell numeric>{formatNumber(s.installedLanes)}</TableCell>
                  <TableCell numeric>{formatNumber(s.cashiers)}</TableCell>
                  <TableCell numeric>{formatNumber(s.paidHours)}</TableCell>
                  <TableCell numeric>
                    <CostValue value={s.cost} level="store" align="end" options={{ maximumFractionDigits: 0 }} />
                  </TableCell>
                </TableRow>,
                ...s.departments.map((d) => (
                  <TableRow key={d.departmentId}>
                    <TableRowHeader className="pl-8">
                      <Cluster gap={2} align="center">
                        <AppLink href={departmentPath(state, d.storeId, d.departmentId, view.date)} className="underline focus-visible:outline-focus-ring">
                          {d.departmentName}
                        </AppLink>
                        {d.overCapacityHours.length > 0 && (
                          <StatusPill tone="warning">
                            {t('planning.overCap', { n: formatNumber(d.maxLanesNeeded - d.installedLanes) })}
                          </StatusPill>
                        )}
                      </Cluster>
                    </TableRowHeader>
                    <TableCell numeric>{formatNumber(Math.round(d.forecastTransactions))}</TableCell>
                    <TableCell numeric>{t('planning.peakAt', { n: formatNumber(d.peakLanes), hour: hour(d.peakHour) })}</TableCell>
                    <TableCell numeric>{formatNumber(d.installedLanes)}</TableCell>
                    <TableCell numeric>{formatNumber(d.cashiers)}</TableCell>
                    <TableCell numeric>{formatNumber(d.paidHours)}</TableCell>
                    <TableCell numeric>
                      <CostValue value={d.cost} level="department" align="end" options={{ maximumFractionDigits: 0 }} />
                    </TableCell>
                  </TableRow>
                )),
              ])}
            </TableBody>
          </Table>
        </TableWrap>
      </Section>
    </Stack>
  )
}
