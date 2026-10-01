import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import {
  can,
  type DepartmentSettingsChange,
  type MetricDelta,
  type RoleCode,
  type ScenarioComparison,
  type ScenarioDetail,
  type ScenarioListItem,
  type ScenarioSettingsChange,
} from '@lanewise/shared'
import { Cluster, Section, Stack } from '@/components/layout'
import { useMediaQuery } from '@/components/layout/use-media-query'
import {
  Alert,
  Button,
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
import { CostValue, useCanSeeCost } from '@/features/cost'
import { useI18n } from '@/i18n'
import { errorReference, type ScenariosClient } from './api'
import { CALENDAR_DATE, DEPARTMENT_FIELD_LABEL_KEY, FT_PATTERN_LABEL_KEY, SETTING_LABEL_KEY, SIGNED, growthToPct } from './logic'

export interface ScenarioCompareScreenProps {
  readonly client: ScenariosClient
  readonly role: RoleCode | null
  readonly a: string | null
  readonly b: string | null
  readonly onChange: (a: string | null, b: string | null) => void
}

type Load =
  | { readonly kind: 'loading'; readonly key: string }
  | { readonly kind: 'error'; readonly key: string; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly key: string; readonly comparison: ScenarioComparison }

type Options =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly list: readonly ScenarioListItem[] }

const DAY_MS = 86_400_000

/**
 * SCR-032 Compare scenarios (requirement 8.6): A vs B — the headline
 * differences (seasonal hires, peak-season team, season cost, first needed
 * by), the settings and inputs that differ, and a by-store table. Cost rows
 * and columns appear only for roles that may see cost at that level (task 21).
 */
export function ScenarioCompareScreen({ client, role, a, b, onChange }: ScenarioCompareScreenProps) {
  const { t } = useI18n()
  useDocumentTitle(t('scenarios.compare.pageTitle'))
  const isTabletUp = useMediaQuery('(min-width: 37.5rem)')
  const [options, setOptions] = useState<Options>({ kind: 'loading' })
  const [optionsAttempt, setOptionsAttempt] = useState(0)
  const [load, setLoad] = useState<Load | null>(null)
  const [compareAttempt, setCompareAttempt] = useState(0)
  const canView = can(role, 'scenarios', 'view')
  const same = a !== null && a === b
  const key = a && b && !same ? `${a}|${b}|${compareAttempt}` : null

  useEffect(() => {
    if (!canView) return
    let live = true
    client.list().then(
      (list) => live && setOptions({ kind: 'ready', list }),
      (error: unknown) => live && setOptions({ kind: 'error', referenceId: errorReference(error) }),
    )
    return () => {
      live = false
    }
  }, [client, canView, optionsAttempt])

  // Only A given: compare it against the season's published scenario by default.
  const list = options.kind === 'ready' ? options.list : null
  useEffect(() => {
    if (!list || !a || b) return
    const from = list.find((o) => o.id === a)
    const published = list.find((o) => o.isPublished && o.id !== a && (!from || o.season === from.season)) ?? list.find((o) => o.isPublished && o.id !== a)
    if (published) onChange(a, published.id)
  }, [list, a, b, onChange])

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

  const picker = (label: string, value: string | null, other: string | null, set: (v: string | null) => void) => (
    <Field label={label}>
      {(aria) => (
        <Select {...aria} value={value ?? ''} disabled={!list} onChange={(e) => set(e.target.value || null)}>
          <option value="">{t('scenarios.compare.choose')}</option>
          {(list ?? []).map((o) => (
            <option key={o.id} value={o.id} disabled={o.id === other}>
              {t(o.isPublished ? 'scenarios.compare.option.published' : 'scenarios.compare.option', {
                name: o.name,
                status: t(`scenario.status.${o.status}`),
              })}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )

  const current = load && load.key === key ? load : null

  return (
    <Stack gap={6}>
      {!isTabletUp && <Alert tone="info" live={false} title={t('scenarios.phone.readOnly')} />}
      <h1 className="text-h1 text-text">{t('scenarios.compare.title')}</h1>
      <Cluster gap={4} align="end">
        {picker(t('scenarios.compare.a'), a, b, (v) => onChange(v, b))}
        {picker(t('scenarios.compare.b'), b, a, (v) => onChange(a, v))}
        <Button disabled={!a && !b} onClick={() => onChange(b, a)}>
          <ArrowLeftRight aria-hidden="true" className="size-4" />
          {t('scenarios.compare.swap')}
        </Button>
      </Cluster>

      {options.kind === 'error' && (
        <Alert
          tone="danger"
          title={t('scenarios.compare.optionsError')}
          referenceId={options.referenceId}
          action={
            <Button
              size="sm"
              onClick={() => {
                setOptions({ kind: 'loading' })
                setOptionsAttempt((n) => n + 1)
              }}
            >
              {t('action.retry')}
            </Button>
          }
        />
      )}

      {same && <Alert tone="warning" title={t('scenarios.compare.same')} />}
      {!a && !b && (
        <StateBlock variant="empty" title={t('scenarios.compare.empty.title')} description={t('scenarios.compare.empty.description')} />
      )}
      {!same && (a === null) !== (b === null) && !key && (
        <p className="text-body text-text-muted">{t('scenarios.compare.pickOther')}</p>
      )}
      {key && (!current || current.kind === 'loading') && <CardSkeleton label={t('state.loading')} />}
      {current?.kind === 'error' && (
        <StateBlock
          variant="error"
          title={t('scenarios.compare.error.title')}
          referenceId={current.referenceId}
          action={<Button onClick={() => setCompareAttempt((n) => n + 1)}>{t('action.retry')}</Button>}
        />
      )}
      {current?.kind === 'ready' && <ComparisonView comparison={current.comparison} />}
    </Stack>
  )
}

/** Days from `a` to `b` (calendar dates). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

function ComparisonView({ comparison: c }: { comparison: ScenarioComparison }) {
  const { t, formatNumber, formatDate } = useI18n()
  const seesNetworkCost = useCanSeeCost('network')
  const seesStoreCost = useCanSeeCost('store')
  const r = c.results
  const none = t('scenarios.none')
  const num = (v: number | null) => (v === null ? none : formatNumber(v))
  const signed = (v: number | null) => (v === null ? none : formatNumber(v, SIGNED))
  const date = (v: string | null) => (v === null ? none : formatDate(v, CALENDAR_DATE))
  const snapshots = c.inputs.snapshots.filter((s) => s.a !== s.b)
  const rules = c.inputs.ruleVersions.filter((s) => s.a !== s.b)

  const firstA = r.firstNeededBy.a
  const firstB = r.firstNeededBy.b
  const firstDelta = firstA && firstB ? daysBetween(firstA, firstB) : null

  const metricRow = (label: string, d: MetricDelta) => (
    <TableRow key={label}>
      <TableRowHeader>{label}</TableRowHeader>
      <TableCell numeric>{num(d.a)}</TableCell>
      <TableCell numeric>{num(d.b)}</TableCell>
      <TableCell numeric>{signed(d.delta)}</TableCell>
    </TableRow>
  )

  const departmentName = (id: string) => {
    const d = c.a.departments.find((x) => x.departmentId === id) ?? c.b.departments.find((x) => x.departmentId === id)
    return d ? t('scenarios.settings.dept.name', { store: d.storeName, department: d.departmentName }) : id
  }

  return (
    <Stack gap={6}>
      <Section title={t('scenarios.compare.headline')} description={t('scenarios.compare.pair', { a: c.a.name, b: c.b.name })}>
        <TableWrap>
          <Table>
            <caption className="sr-only">{t('scenarios.compare.headline')}</caption>
            <TableHead>
              <tr>
                <TableHeaderCell>{t('scenarios.compare.col.measure')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('scenarios.compare.col.a')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('scenarios.compare.col.b')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('scenarios.compare.col.delta')}</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {metricRow(t('scenarios.run.hires'), r.seasonalHires)}
              {metricRow(t('scenarios.compare.team'), r.headcount)}
              {seesNetworkCost && (
                <TableRow>
                  <TableRowHeader>{t('scenarios.run.cost')}</TableRowHeader>
                  <TableCell numeric>
                    <CostValue value={r.cost ? r.cost.a : null} level="network" align="end" />
                  </TableCell>
                  <TableCell numeric>
                    <CostValue value={r.cost ? r.cost.b : null} level="network" align="end" />
                  </TableCell>
                  <TableCell numeric>
                    <CostValue value={r.cost ? r.cost.delta : null} level="network" align="end" options={SIGNED} />
                  </TableCell>
                </TableRow>
              )}
              {metricRow(t('scenarios.run.paidHours'), r.paidHours)}
              {metricRow(t('scenarios.run.peakLanes'), r.peakLanes)}
              <TableRow>
                <TableRowHeader>{t('scenarios.compare.firstNeededBy')}</TableRowHeader>
                <TableCell numeric>{date(firstA)}</TableCell>
                <TableCell numeric>{date(firstB)}</TableCell>
                <TableCell numeric>
                  {firstDelta === null ? none : firstDelta === 0 ? t('scenarios.compare.sameDay') : t('scenarios.compare.days', { days: formatNumber(firstDelta, SIGNED) })}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableWrap>
      </Section>

      <Section title={t('scenarios.compare.settings')}>
        {c.settings.length + c.departmentSettings.length === 0 ? (
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
                    <TableRowHeader>{t(SETTING_LABEL_KEY[ch.key])}</TableRowHeader>
                    <TableCell>
                      <SettingValue change={ch} side="from" scenario={c.a} />
                    </TableCell>
                    <TableCell>
                      <SettingValue change={ch} side="to" scenario={c.b} />
                    </TableCell>
                  </TableRow>
                ))}
                {c.departmentSettings.map((ch) => (
                  <TableRow key={`${ch.departmentId}-${ch.field}`}>
                    <TableRowHeader>
                      {t('scenarios.compare.deptSetting', { department: departmentName(ch.departmentId), field: t(DEPARTMENT_FIELD_LABEL_KEY[ch.field]) })}
                    </TableRowHeader>
                    <TableCell>{departmentValue(ch, ch.from, c.a, t, formatNumber)}</TableCell>
                    <TableCell>{departmentValue(ch, ch.to, c.b, t, formatNumber)}</TableCell>
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
                    <TableCell>{s.a ?? none}</TableCell>
                    <TableCell>{s.b ?? none}</TableCell>
                  </TableRow>
                ))}
                {rules.map((s) => (
                  <TableRow key={s.ruleSetName}>
                    <TableRowHeader>{s.ruleSetName}</TableRowHeader>
                    <TableCell>{s.a === null ? none : t('scenarios.version', { version: s.a })}</TableCell>
                    <TableCell>{s.b === null ? none : t('scenarios.version', { version: s.b })}</TableCell>
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
                <TableHeaderCell rowSpan={2}>{t('scenarios.run.col.store')}</TableHeaderCell>
                <TableHeaderCell scope="colgroup" colSpan={3} className="text-center">
                  {t('scenarios.run.hires')}
                </TableHeaderCell>
                {seesStoreCost && (
                  <TableHeaderCell scope="colgroup" colSpan={3} className="text-center">
                    {t('scenarios.run.cost')}
                  </TableHeaderCell>
                )}
              </tr>
              <tr>
                {groupHeaders(t('scenarios.run.hires'), t)}
                {seesStoreCost && groupHeaders(t('scenarios.run.cost'), t)}
              </tr>
            </TableHead>
            <TableBody>
              {r.stores.map((st) => (
                <TableRow key={st.storeId}>
                  <TableRowHeader>{st.storeName}</TableRowHeader>
                  <TableCell numeric>{num(st.hires.a)}</TableCell>
                  <TableCell numeric>{num(st.hires.b)}</TableCell>
                  <TableCell numeric>{signed(st.hires.delta)}</TableCell>
                  {seesStoreCost && (
                    <>
                      <TableCell numeric>
                        <CostValue value={st.cost ? st.cost.a : null} level="store" align="end" />
                      </TableCell>
                      <TableCell numeric>
                        <CostValue value={st.cost ? st.cost.b : null} level="store" align="end" />
                      </TableCell>
                      <TableCell numeric>
                        <CostValue value={st.cost ? st.cost.delta : null} level="store" align="end" options={SIGNED} />
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      </Section>
    </Stack>
  )
}

/** A, B and change sub-headers under a grouped header ("Hires" → A / B / Change). */
function groupHeaders(group: string, t: (id: string, values?: Record<string, string | number>) => string): ReactNode {
  return (['a', 'b', 'delta'] as const).map((side) => (
    <TableHeaderCell key={`${group}-${side}`} numeric>
      <span aria-hidden="true">{t(`scenarios.compare.col.${side}`)}</span>
      <span className="sr-only">{t(`scenarios.compare.metric.${side}`, { metric: group })}</span>
    </TableHeaderCell>
  ))
}

/**
 * One side of a changed setting, formatted by its key (no fallback: every
 * key has its own branch, so a new setting fails the type check until it is
 * formatted). A `null` override reads "Default (X)" with that side's default.
 */
function SettingValue({ change, side, scenario }: { change: ScenarioSettingsChange; side: 'from' | 'to'; scenario: ScenarioDetail }) {
  const { t, formatNumber, formatDate } = useI18n()
  const n = (v: number) => formatNumber(v, { maximumFractionDigits: 2 })
  const orDefault = (text: string | null, def: string) => text ?? t('scenarios.compare.defaultValue', { value: def })
  const yesNo = (v: boolean) => t(v ? 'scenarios.compare.yes' : 'scenarios.compare.no')
  const d = scenario.defaults
  let text: string
  switch (change.key) {
    case 'growth':
      text = `${formatNumber(Number(growthToPct(change[side])), SIGNED)} %`
      break
    case 'allowPartTime':
      text = yesNo(change[side])
      break
    case 'planningFrom':
    case 'planningTo':
    case 'peakDay':
      text = formatDate(change[side], CALENDAR_DATE)
      break
    case 'notes':
      text = change[side] || t('scenarios.none')
      break
    case 'ftShiftPattern': {
      const v = change[side]
      text = orDefault(v === null ? null : t(FT_PATTERN_LABEL_KEY[v]), t(FT_PATTERN_LABEL_KEY[d.ftShiftPattern]))
      break
    }
    case 'respectPreferredRestDay': {
      const v = change[side]
      text = orDefault(v === null ? null : yesNo(v), yesNo(d.respectPreferredRestDay))
      break
    }
    case 'servedWithinPct':
    case 'waitSeconds':
    case 'shrinkage':
    case 'minOpenLanes':
    case 'ptShiftHours':
    case 'maxPtSharePct':
    case 'mealEarliestAfterHours':
    case 'absenceReservePct':
    case 'ftMaxDaysPerWeek':
    case 'ftMaxHoursPerWeek':
    case 'ptMaxDaysPerWeek':
    case 'ptMaxHoursPerWeek':
    case 'minRestHours':
    case 'maxConsecutiveDays': {
      const v = change[side]
      text = orDefault(v === null ? null : n(v), n(d[change.key]))
      break
    }
    default: {
      const unreachable: never = change
      text = String(unreachable)
    }
  }
  return <>{text}</>
}

function departmentValue(
  change: DepartmentSettingsChange,
  value: number | null,
  scenario: ScenarioDetail,
  t: (id: string, values?: Record<string, string | number>) => string,
  formatNumber: (v: number, o?: Intl.NumberFormatOptions) => string,
): string {
  if (value !== null) return formatNumber(value, { maximumFractionDigits: 2 })
  const learned = scenario.departments.find((d) => d.departmentId === change.departmentId)?.[change.field]
  return learned === undefined ? t('scenarios.compare.learned') : t('scenarios.compare.learnedValue', { value: formatNumber(learned, { maximumFractionDigits: 2 }) })
}
