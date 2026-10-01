import { can, growthPct, type LeadershipSummary, type RoleCode, type ViewState } from '@lanewise/shared'
import { Cluster, Col, Grid, Section, Stack } from '@/components/layout'
import {
  Alert,
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
import { DATE_FORMAT, HOUR_FORMAT, MILESTONE_TONE, hourDate } from './logic'
import { LoadError } from './network-screen'
import { useLoaded, useScenarioId } from './hooks'
import { ExportButton, ProvenanceLine, StaleBanner } from './parts'

export interface SummaryScreenProps {
  readonly client: PlanningClient
  readonly role: RoleCode | null
  readonly state: ViewState
  /** Opens the browser's print dialog (Print → Save as PDF on A4). */
  readonly onPrint?: () => void
}

/**
 * SCR-024 Leadership summary (Req 10.3, 18.3): the one-page brief generated
 * from a scenario — bottom line, five KPIs, the action timeline, hires by
 * store, the network peak and how to read the numbers — with Print / PDF,
 * a downloadable print-ready A4 page and CSV. The sample-data badge shows
 * while synthetic data is in use (P9); provenance names the scenario run.
 */
export function SummaryScreen({ client, role, state, onPrint = () => window.print() }: SummaryScreenProps) {
  const { t } = useI18n()
  useDocumentTitle(t('planning.summary.title'))
  const canView = can(role, 'leadership_summary', 'view')
  const { id: scenarioId, resolving } = useScenarioId(client, state.scenario)
  const key = canView && scenarioId ? `${role}|${scenarioId}` : null
  const [load, reload] = useLoaded<LeadershipSummary>(key, () => client.summary(scenarioId ?? ''))

  if (!canView) {
    return <StateBlock variant="no-access" title={t('planning.noAccess.title')} description={t('planning.noAccess.description')} />
  }
  return (
    <Stack gap={6}>
      {load?.kind !== 'ready' && <h1 className="text-h1 text-text">{t('planning.summary.title')}</h1>}
      {!resolving && !scenarioId && <StateBlock variant="empty" title={t('planning.noScenario.title')} description={t('planning.noScenario.description')} />}
      {(resolving || load?.kind === 'loading') && <CardSkeleton label={t('state.loading')} />}
      {load?.kind === 'error' && <LoadError code={load.code} referenceId={load.referenceId} onRetry={reload} />}
      {load?.kind === 'ready' && <SummaryBody summary={load.data} client={client} role={role} onPrint={onPrint} />}
    </Stack>
  )
}

function SummaryBody({ summary, client, role, onPrint }: { summary: LeadershipSummary; client: PlanningClient; role: RoleCode | null; onPrint: () => void }) {
  const { t, formatNumber, formatDate, formatTime } = useI18n()
  const date = (d: string | null) => (d ? formatDate(`${d}T00:00:00Z`, DATE_FORMAT) : t('planning.none'))
  const h = summary.hiring
  const k = h?.kpis
  const scenarioId = summary.provenance.scenarioId
  const canExport = can(role, 'leadership_summary', 'export')

  return (
    <Stack gap={6}>
      <Cluster gap={3} align="center" className="justify-between print:hidden">
        <ProvenanceLine provenance={summary.provenance} />
        <Cluster gap={2}>
          <Button size="sm" variant="primary" onClick={onPrint}>{t('planning.summary.print')}</Button>
          {canExport && <ExportButton label={t('planning.summary.download')} run={() => client.exportSummary(scenarioId, 'html')} />}
          {canExport && <ExportButton label={t('planning.export.csv')} run={() => client.exportSummary(scenarioId, 'csv')} />}
        </Cluster>
      </Cluster>
      <StaleBanner provenance={summary.provenance} />

      <article aria-labelledby="summary-title" className="flex flex-col gap-6">
        <Cluster gap={3} align="center">
          <h1 id="summary-title" className="text-h1 text-text">
            {t('planning.summary.heading', { scenario: summary.provenance.scenarioName })}
          </h1>
          {summary.sampleData && <StatusPill tone="warning">{t('planning.summary.illustrative')}</StatusPill>}
        </Cluster>
        <p className="text-body text-text-muted">
          {t('planning.summary.scope', {
            stores: formatNumber(summary.storeCount),
            departments: formatNumber(summary.departmentCount),
            from: date(summary.from),
            to: date(summary.to),
          })}
        </p>

        {!h || !k ? (
          <StateBlock variant="empty" title={t('planning.summary.noPlan.title')} description={t('planning.summary.noPlan.description')} />
        ) : (
          <>
            <Alert tone="info" title={t('planning.summary.bottomLine')} live={false}>
              {t('planning.summary.bottomLineText', {
                hires: formatNumber(k.seasonalHires),
                baseline: formatNumber(k.baselineTeam),
                growth: formatNumber(growthPct(k.baselineTeam, k.seasonalHires)),
              })}{' '}
              {summary.offersDue && t('planning.summary.offersBy', { date: date(summary.offersDue) })}
            </Alert>

            <Grid>
              <Col span={2} spanTablet={4} spanLaptop={2}>
                <KpiCard
                  emphasis="key"
                  label={t('planning.kpi.seasonalHires')}
                  value={formatNumber(k.seasonalHires)}
                  detail={t('planning.kpi.byType', { ft: formatNumber(k.hiresByType.FT), pt: formatNumber(k.hiresByType.PT), float: formatNumber(k.hiresByType.FLOAT) })}
                />
              </Col>
              <Col span={2} spanTablet={4} spanLaptop={2}>
                <KpiCard label={t('planning.kpi.firstNeeded')} value={date(k.firstNeededBy)} detail={summary.offersDue ? t('planning.kpi.offersDue', { date: date(summary.offersDue) }) : undefined} />
              </Col>
              <Col span={2} spanTablet={4} spanLaptop={3}>
                <KpiCard label={t('planning.kpi.peakTeam')} value={formatNumber(k.peakTeam)} detail={t('planning.kpi.vsBaseline', { n: formatNumber(k.baselineTeam) })} />
              </Col>
              <Col span={2} spanTablet={4} spanLaptop={2}>
                <KpiCard label={t('planning.kpi.seasonHours')} value={formatNumber(k.seasonPaidHours)} />
              </Col>
              <Col span={4} spanTablet={4} spanLaptop={3}>
                <KpiCard label={t('planning.kpi.seasonCost')} value={<CostValue value={k.seasonCost} level="network" options={{ maximumFractionDigits: 0 }} />} />
              </Col>
            </Grid>

            <Grid>
              <Col span={4} spanTablet={8} spanLaptop={6}>
                <Section title={t('planning.summary.when')}>
                  <TableWrap>
                    <Table>
                      <caption className="sr-only">{t('planning.summary.when')}</caption>
                      <TableHead>
                        <tr>
                          <TableHeaderCell>{t('planning.col.date')}</TableHeaderCell>
                          <TableHeaderCell>{t('planning.col.action')}</TableHeaderCell>
                          <TableHeaderCell>{t('planning.col.status')}</TableHeaderCell>
                        </tr>
                      </TableHead>
                      <TableBody>
                        {h.timeline.map((m) => (
                          <TableRow key={`${m.waveId}-${m.name}`}>
                            <TableRowHeader>{date(m.date)}</TableRowHeader>
                            <TableCell>{t('planning.hiring.milestone', { name: m.name, type: t(`planning.contract.${m.contractType}`), n: formatNumber(m.count) })}</TableCell>
                            <TableCell>
                              <StatusPill tone={MILESTONE_TONE[m.status]}>{t(`planning.milestone.${m.status}`)}</StatusPill>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableWrap>
                </Section>
              </Col>
              <Col span={4} spanTablet={8} spanLaptop={6}>
                <Section title={t('planning.summary.where')}>
                  <TableWrap>
                    <Table>
                      <caption className="sr-only">{t('planning.summary.where')}</caption>
                      <TableHead>
                        <tr>
                          <TableHeaderCell>{t('planning.col.store')}</TableHeaderCell>
                          <TableHeaderCell numeric>{t('planning.col.baseline')}</TableHeaderCell>
                          <TableHeaderCell numeric>{t('planning.col.hires')}</TableHeaderCell>
                          <TableHeaderCell numeric>{t('planning.col.growth')}</TableHeaderCell>
                          <TableHeaderCell>{t('planning.col.neededBy')}</TableHeaderCell>
                        </tr>
                      </TableHead>
                      <TableBody>
                        {h.stores.map((s) => (
                          <TableRow key={s.storeId}>
                            <TableRowHeader>{s.storeName}</TableRowHeader>
                            <TableCell numeric>{formatNumber(s.baseline)}</TableCell>
                            <TableCell numeric>{formatNumber(s.hires)}</TableCell>
                            <TableCell numeric>{t('planning.pct', { n: formatNumber(growthPct(s.baseline, s.hires)) })}</TableCell>
                            <TableCell>{date(s.neededBy)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableWrap>
                </Section>
              </Col>
            </Grid>
          </>
        )}

        {summary.peak && (
          <p className="text-body text-text">
            {t('planning.summary.peak', {
              n: formatNumber(summary.peak.lanesOpen),
              hour: formatTime(hourDate(summary.peak.hour), HOUR_FORMAT),
              date: date(summary.peak.date),
            })}
          </p>
        )}

        <details className="border-2 border-outline p-3">
          <summary className="cursor-pointer text-body text-text font-weight-semibold">{t('planning.summary.howToRead')}</summary>
          <p className="mt-2 text-body-sm text-text">{t('planning.summary.howToReadText')}</p>
          {summary.sampleData && <p className="mt-2 text-body-sm text-text">{t('planning.summary.sampleNote')}</p>}
        </details>
      </article>
    </Stack>
  )
}
