import { useEffect, useState } from 'react'
import {
  can,
  type MetricDelta,
  type RoleCode,
  type ScenarioComparison,
  type ScenarioListItem,
  type ScenarioSettingsChange,
} from '@lanewise/shared'
import { Cluster, Col, Grid, Section, Stack } from '@/components/layout'
import {
  Card,
  CardSkeleton,
  Field,
  Select,
  StateBlock,
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
import { errorReference, type ScenariosClient } from './api'
import { CALENDAR_DATE, SIGNED, growthToPct } from './logic'

export interface ScenarioCompareScreenProps {
  readonly client: ScenariosClient
  readonly role: RoleCode | null
  readonly a: string | null
  readonly b: string | null
  readonly onChange: (a: string | null, b: string | null) => void
}

type Load =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly key: string }
  | { readonly kind: 'error'; readonly key: string; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly key: string; readonly comparison: ScenarioComparison }

/**
 * SCR-032 Compare scenarios (requirement 8.6): A vs B — key figure deltas,
 * the settings and inputs that differ, and a by-store table. Cost appears
 * only where the API sent it for the role (task 21).
 */
export function ScenarioCompareScreen({ client, role, a, b, onChange }: ScenarioCompareScreenProps) {
  const { t, formatNumber, formatDate } = useI18n()
  useDocumentTitle(t('scenarios.compare.pageTitle'))
  const [options, setOptions] = useState<readonly ScenarioListItem[]>([])
  const [load, setLoad] = useState<Load>({ kind: 'idle' })
  const canView = can(role, 'scenarios', 'view')
  const key = a && b ? `${a}|${b}` : null

  useEffect(() => {
    if (!canView) return
    let live = true
    client.list().then(
      (list) => live && setOptions(list),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [client, canView])

  useEffect(() => {
    if (!key || !a || !b) return
    let live = true
    client.compare(a, b).then(
      (comparison) => live && setLoad({ kind: 'ready', key, comparison }),
      (error: unknown) => live && setLoad({ kind: 'error', key, referenceId: errorReference(error) }),
    )
    return () => {
      live = false
    }
  }, [client, a, b, key])

  if (!canView) {
    return <StateBlock variant="no-access" title={t('scenarios.list.noAccess.title')} description={t('scenarios.list.noAccess.description')} />
  }

  const num = (v: number | null) => (v === null ? t('scenarios.none') : formatNumber(v))
  const signed = (v: number | null) => (v === null ? t('scenarios.none') : formatNumber(v, SIGNED))
  const metricText = (d: MetricDelta) => `${num(d.a)} → ${num(d.b)} (${signed(d.delta)})`

  const settingValue = (c: ScenarioSettingsChange, v: ScenarioSettingsChange['from']) => {
    if (c.key === 'growth') return `${formatNumber(Number(growthToPct(v as number)), SIGNED)} %`
    if (c.key === 'allowPartTime') return t(v ? 'scenarios.compare.yes' : 'scenarios.compare.no')
    if (c.key === 'notes') return String(v) || t('scenarios.none')
    return formatDate(String(v), CALENDAR_DATE)
  }

  const picker = (label: string, value: string | null, set: (v: string | null) => void) => (
    <Field label={label}>
      {(aria) => (
        <Select {...aria} value={value ?? ''} onChange={(e) => set(e.target.value || null)}>
          <option value="">{t('scenarios.compare.choose')}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.isPublished ? `★ ${o.name}` : o.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )

  const current = load.kind !== 'idle' && load.key === key ? load : null

  return (
    <Stack gap={6}>
      <h1 className="text-h1 text-text">{t('scenarios.compare.title')}</h1>
      <Cluster gap={4} align="end">
        {picker(t('scenarios.compare.a'), a, (v) => onChange(v, b))}
        {picker(t('scenarios.compare.b'), b, (v) => onChange(a, v))}
      </Cluster>

      {!key && (
        <StateBlock variant="empty" title={t('scenarios.compare.empty.title')} description={t('scenarios.compare.empty.description')} />
      )}
      {key && (!current || current.kind === 'loading') && <CardSkeleton label={t('state.loading')} />}
      {current?.kind === 'error' && (
        <StateBlock variant="error" title={t('scenarios.compare.error.title')} referenceId={current.referenceId} />
      )}
      {current?.kind === 'ready' && (
        <ComparisonView
          comparison={current.comparison}
          metricText={metricText}
          settingValue={settingValue}
          signedCost={(d) => (
            <>
              <CostValue value={d?.a ?? undefined} level="network" /> {'→ '}
              <CostValue value={d?.b ?? undefined} level="network" /> {'('}
              <CostValue value={d?.delta ?? undefined} level="network" options={SIGNED} />
              {')'}
            </>
          )}
          num={num}
          signed={signed}
        />
      )}
    </Stack>
  )
}

function ComparisonView({
  comparison: c,
  metricText,
  settingValue,
  signedCost,
  num,
  signed,
}: {
  comparison: ScenarioComparison
  metricText: (d: MetricDelta) => string
  settingValue: (c: ScenarioSettingsChange, v: ScenarioSettingsChange['from']) => string
  signedCost: (d: MetricDelta | undefined) => React.ReactNode
  num: (v: number | null) => string
  signed: (v: number | null) => string
}) {
  const { t } = useI18n()
  const r = c.results
  const snapshots = c.inputs.snapshots.filter((s) => s.a !== s.b)
  const rules = c.inputs.ruleVersions.filter((s) => s.a !== s.b)
  const metrics = [
    ['scenarios.run.headcount', metricText(r.headcount)],
    ['scenarios.run.paidHours', metricText(r.paidHours)],
    ['scenarios.run.cost', signedCost(r.cost)],
    ['scenarios.run.peakLanes', metricText(r.peakLanes)],
  ] as const
  const storeCols = ['scenarios.run.headcount', 'scenarios.run.paidHours', 'scenarios.run.cost', 'scenarios.run.peakLanes'] as const

  return (
    <Stack gap={6}>
      <Section title={t('scenarios.compare.kpis')}>
        <p className="text-body-sm text-text-muted">
          {t('scenarios.compare.pair', { a: c.a.name, b: c.b.name })}
        </p>
        <Grid>
          {metrics.map(([label, value]) => (
            <Col key={label} span={2} spanTablet={4} spanLaptop={3}>
              <Card>
                <Stack gap={1}>
                  <span className="text-label uppercase text-text-muted">{t(label)}</span>
                  <span className="text-body text-text tabular-nums">{value}</span>
                </Stack>
              </Card>
            </Col>
          ))}
        </Grid>
      </Section>

      <Section title={t('scenarios.compare.settings')}>
        {c.settings.length === 0 ? (
          <p className="text-body text-text-muted">{t('scenarios.compare.settings.none')}</p>
        ) : (
          <TableWrap>
            <Table>
              <caption className="sr-only">{t('scenarios.compare.settings')}</caption>
              <TableHead>
                <tr>
                  <TableHeaderCell>{t('scenarios.compare.col.setting')}</TableHeaderCell>
                  <TableHeaderCell>{t('scenarios.compare.col.a')}</TableHeaderCell>
                  <TableHeaderCell>{t('scenarios.compare.col.b')}</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {c.settings.map((ch) => (
                  <TableRow key={ch.key}>
                    <TableRowHeader>{t(`scenarios.settings.${ch.key}`)}</TableRowHeader>
                    <TableCell>{settingValue(ch, ch.from)}</TableCell>
                    <TableCell>{settingValue(ch, ch.to)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        )}
      </Section>

      <Section title={t('scenarios.compare.inputs')}>
        {snapshots.length + rules.length === 0 ? (
          <p className="text-body text-text-muted">{t('scenarios.compare.inputs.none')}</p>
        ) : (
          <TableWrap>
            <Table>
              <caption className="sr-only">{t('scenarios.compare.inputs')}</caption>
              <TableHead>
                <tr>
                  <TableHeaderCell>{t('scenarios.compare.col.input')}</TableHeaderCell>
                  <TableHeaderCell>{t('scenarios.compare.col.a')}</TableHeaderCell>
                  <TableHeaderCell>{t('scenarios.compare.col.b')}</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {snapshots.map((s) => (
                  <TableRow key={s.datasetType}>
                    <TableRowHeader>{t(`scenarios.dataset.${s.datasetType}`)}</TableRowHeader>
                    <TableCell>{s.a ?? t('scenarios.none')}</TableCell>
                    <TableCell>{s.b ?? t('scenarios.none')}</TableCell>
                  </TableRow>
                ))}
                {rules.map((s) => (
                  <TableRow key={s.ruleSetName}>
                    <TableRowHeader>{s.ruleSetName}</TableRowHeader>
                    <TableCell>{s.a === null ? t('scenarios.none') : t('scenarios.version', { version: s.a })}</TableCell>
                    <TableCell>{s.b === null ? t('scenarios.none') : t('scenarios.version', { version: s.b })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        )}
      </Section>

      <Section title={t('scenarios.compare.byStore')}>
        <TableWrap>
          <Table stickyFirstCol>
            <caption className="sr-only">{t('scenarios.compare.byStore')}</caption>
            <TableHead>
              <tr>
                <TableHeaderCell>{t('scenarios.run.col.store')}</TableHeaderCell>
                {storeCols.flatMap((col) => [
                  <TableHeaderCell key={`${col}-a`} numeric>
                    {t('scenarios.compare.metric.a', { metric: t(col) })}
                  </TableHeaderCell>,
                  <TableHeaderCell key={`${col}-b`} numeric>
                    {t('scenarios.compare.metric.b', { metric: t(col) })}
                  </TableHeaderCell>,
                  <TableHeaderCell key={`${col}-d`} numeric>
                    {t('scenarios.compare.metric.delta', { metric: t(col) })}
                  </TableHeaderCell>,
                ])}
              </tr>
            </TableHead>
            <TableBody>
              {r.stores.map((st) => (
                <TableRow key={st.storeId}>
                  <TableRowHeader>{st.storeName}</TableRowHeader>
                  {([st.headcount, st.paidHours] as const).flatMap((m, i) => [
                    <TableCell key={`${i}-a`} numeric>{num(m.a)}</TableCell>,
                    <TableCell key={`${i}-b`} numeric>{num(m.b)}</TableCell>,
                    <TableCell key={`${i}-d`} numeric>{signed(m.delta)}</TableCell>,
                  ])}
                  <TableCell numeric>
                    <CostValue value={st.cost?.a ?? undefined} level="store" align="end" />
                  </TableCell>
                  <TableCell numeric>
                    <CostValue value={st.cost?.b ?? undefined} level="store" align="end" />
                  </TableCell>
                  <TableCell numeric>
                    <CostValue value={st.cost?.delta ?? undefined} level="store" align="end" options={SIGNED} />
                  </TableCell>
                  <TableCell numeric>{num(st.peakLanes.a)}</TableCell>
                  <TableCell numeric>{num(st.peakLanes.b)}</TableCell>
                  <TableCell numeric>{signed(st.peakLanes.delta)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      </Section>
    </Stack>
  )
}
