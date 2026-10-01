import type { RoleCode } from '@lanewise/shared'
import { Inbox } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { HomeSummary } from '@/api'
import { AppLink } from '@/app/router'
import { AppLayout } from '@/app/app-layout'
import { Cluster, Col, Grid, Section, Stack } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { CardSkeleton } from '@/components/ui/card'
import { Num } from '@/components/ui/currency'
import { KpiCard } from '@/components/ui/kpi-card'
import { StatusPill } from '@/components/ui/pill'
import { StateBlock } from '@/components/ui/state-block'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableWrap,
} from '@/components/ui/table'
import { CostValue } from '@/features/cost'
import { useI18n } from '@/i18n'
import { greetingKey } from './greeting'
import { useHome } from './use-home'

/**
 * SCR-010 Home (wireframes/scr-010-home.html): the role-based dashboard.
 * Content comes from `GET /home`, which the server shapes for the active role
 * (the mock adapter does the same), so each role sees only its own variant —
 * e.g. Staff never receives a ₱ figure or another cashier (P11). Every ₱
 * figure renders through `<CostValue>` (task 21).
 */

// Plan dates are calendar dates; shifts are shown in store (Manila) time.
const DATE_ONLY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' }
const SHIFT_DAY: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' }
const SHIFT_TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }

export function HomeScreen() {
  const { t } = useI18n()
  const { data, error, loading, retry } = useHome()
  const title = t('screen.home')

  return (
    <AppLayout title={title} crumbs={[]}>
      {loading ? (
        <Stack gap={4} aria-busy="true">
          <CardSkeleton label={t('state.loading')} />
          <CardSkeleton label={t('state.loading')} />
        </Stack>
      ) : error || !data ? (
        <StateBlock
          variant="error"
          title={t('home.error.title')}
          description={t('state.error.description')}
          action={<Button onClick={retry}>{t('action.retry')}</Button>}
        />
      ) : (
        <HomeContent data={data} />
      )}
    </AppLayout>
  )
}

function HomeContent({ data }: { data: HomeSummary }) {
  const { t } = useI18n()
  // Fixed per load so the greeting and deadline pills don't shift on re-render.
  const [now] = useState(() => Date.now())
  return (
    <Stack gap={4}>
      <div>
        <h1 className="text-h1 text-text">{t(greetingKey(now), { name: data.firstName })}</h1>
        <p className="mt-1 text-body text-text-muted">{t(`home.subtitle.${data.role}`)}</p>
      </div>
      <RoleCards data={data} now={now} />
      {data.kpis && <Kpis kpis={data.kpis} />}
      {data.recentScenarios && <RecentScenarios rows={data.recentScenarios} />}
    </Stack>
  )
}

/** Two cards side by side from laptop up, stacked below. */
function Pair({ children }: { children: [ReactNode, ReactNode] }) {
  return (
    <Grid>
      <Col span={4} spanTablet={8} spanLaptop={6}>
        {children[0]}
      </Col>
      <Col span={4} spanTablet={8} spanLaptop={6}>
        {children[1]}
      </Col>
    </Grid>
  )
}

/** In-card empty state: an icon plus text, so it never relies on colour. */
function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-body text-text-muted">
      <Inbox aria-hidden="true" className="size-5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** Whole-variant empty state, when the server has nothing for this role yet. */
function NothingToShow({ role }: { role: RoleCode }) {
  const { t } = useI18n()
  return (
    <StateBlock
      variant="empty"
      title={t('home.empty.title')}
      description={t(`home.subtitle.${role}`)}
    />
  )
}

function LinkButton({ href, primary, children }: { href: string; primary?: boolean; children: ReactNode }) {
  return (
    <AppLink href={href} className={buttonVariants({ variant: primary ? 'primary' : 'secondary' })}>
      {children}
    </AppLink>
  )
}

function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <AppLink href={href} className="underline focus-visible:outline-focus-ring">
      {children}
    </AppLink>
  )
}

function RoleCards({ data, now }: { data: HomeSummary; now: number }) {
  const { t, formatDate, formatNumber, formatTime } = useI18n()
  const date = (d: string) => formatDate(d, DATE_ONLY)

  switch (data.role) {
    case 'PLN':
      return (
        <Pair>
          <Section title={t('home.pln.attention')}>
            {!data.attention?.length && <EmptyNote>{t('home.empty.title')}</EmptyNote>}
            <ul className="flex flex-col gap-2 text-body">
              {data.attention?.map((item) => (
                <li key={item.kind}>
                  {item.kind === 'staleScenarios' && (
                    <>
                      <StatusPill tone="warning">{t('home.pln.staleScenarios', { count: item.count })}</StatusPill>{' '}
                      <TextLink href="/scenarios">{t('home.link.review')}</TextLink>
                    </>
                  )}
                  {item.kind === 'overCapacity' && (
                    <>
                      <StatusPill tone="warning">
                        {t('home.pln.overCapacity', { count: item.count, date: date(item.date) })}
                      </StatusPill>{' '}
                      <TextLink href="/plan/network">{t('nav.network')}</TextLink>
                    </>
                  )}
                  {item.kind === 'runComplete' && (
                    <>
                      <StatusPill tone="info">{t('home.pln.runComplete', { name: item.scenarioName })}</StatusPill>{' '}
                      <TextLink href="/plan/hiring">{t('home.link.open')}</TextLink>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('home.pln.deadlines')}>
            {!data.deadlines?.length && <EmptyNote>{t('home.empty.deadlines')}</EmptyNote>}
            <ol className="flex flex-col gap-2 text-body">
              {data.deadlines?.map((d) => (
                <li key={d.kind}>
                  <Cluster gap={2}>
                    <span className="font-weight-semibold">{date(d.date)}</span>
                    <DeadlinePill date={d.date} now={now} />
                    <span>
                      {d.kind === 'firstWave'
                        ? t('home.deadline.firstWave', { count: formatNumber(d.count ?? 0) })
                        : t(`home.deadline.${d.kind}`)}
                    </span>
                  </Cluster>
                </li>
              ))}
            </ol>
          </Section>
        </Pair>
      )
    case 'EXE':
      return (
        <Pair>
          <Section title={t('home.exe.approvalTitle')}>
            {!data.pendingApproval && <EmptyNote>{t('home.empty.title')}</EmptyNote>}
            {data.pendingApproval && (
              <Stack gap={3}>
                <p className="text-body">{t('home.exe.approvalBody', { name: data.pendingApproval.scenarioName })}</p>
                <div>
                  <LinkButton href="/approvals" primary>
                    {t('home.exe.approvalAction')}
                  </LinkButton>
                </div>
              </Stack>
            )}
          </Section>
          <Section title={t('home.exe.publishedTitle')}>
            {!data.publishedPlan && <EmptyNote>{t('home.empty.published')}</EmptyNote>}
            {data.publishedPlan && (
              <p className="text-body">
                <span aria-hidden="true">★ </span>
                {data.publishedPlan.name} · <TextLink href="/plan/summary">{t('nav.summary')}</TextLink>
              </p>
            )}
          </Section>
        </Pair>
      )
    case 'STM': {
      const w = data.storeWeek
      if (!w) return <NothingToShow role={data.role} />
      return (
        <Section title={t('home.stm.title', { store: w.storeName })}>
          <Cluster gap={2}>
            <StatusPill tone="warning">
              {t('home.stm.unfilled', { count: w.unfilledShifts, date: date(w.unfilledDate), department: w.departmentName })}
            </StatusPill>
            <StatusPill tone="danger">{t('home.stm.failing', { count: w.failingRuleChecks })}</StatusPill>
          </Cluster>
          <Cluster gap={2}>
            <LinkButton href="/plan/roster" primary>
              {t('home.stm.openRoster')}
            </LinkButton>
            <LinkButton href="/data/staff">{t('home.stm.availability')}</LinkButton>
          </Cluster>
        </Section>
      )
    }
    case 'HR':
      return (
        <Pair>
          <Section title={t('home.hr.approvalTitle')}>
            {!data.pendingApproval && <EmptyNote>{t('home.empty.title')}</EmptyNote>}
            {data.pendingApproval && (
              <Stack gap={3}>
                <p className="text-body">
                  {t('home.hr.approvalBody', {
                    name: data.pendingApproval.scenarioName,
                    count: formatNumber(data.pendingApproval.headcount ?? 0),
                  })}
                </p>
                <div>
                  <LinkButton href="/approvals" primary>
                    {t('home.hr.approvalAction')}
                  </LinkButton>
                </div>
              </Stack>
            )}
          </Section>
          <Section title={t('home.hr.recruitingTitle')}>
            {!data.recruiting && <EmptyNote>{t('home.empty.deadlines')}</EmptyNote>}
            {data.recruiting && (
              <p className="text-body">
                {t('home.hr.recruitingBody', {
                  date: date(data.recruiting.offersDue),
                  min: formatNumber(data.recruiting.toRecruitMin),
                  max: formatNumber(data.recruiting.toRecruitMax),
                })}{' '}
                · <TextLink href="/plan/hiring">{t('nav.hiring')}</TextLink>
              </p>
            )}
          </Section>
        </Pair>
      )
    case 'FIN':
      return (
        <Pair>
          <Section title={t('home.fin.approvalTitle')}>
            {!data.pendingApproval && <EmptyNote>{t('home.empty.title')}</EmptyNote>}
            {data.pendingApproval && (
              <Stack gap={3}>
                <p className="text-body">
                  {t('home.fin.approvalBody', { name: data.pendingApproval.scenarioName })}{' '}
                  <CostValue value={data.pendingApproval.seasonCost} level="network" compact />
                </p>
                <div>
                  <LinkButton href="/approvals" primary>
                    {t('home.fin.approvalAction')}
                  </LinkButton>
                </div>
              </Stack>
            )}
          </Section>
          <Section title={t('home.fin.costTitle')}>
            {!data.costWatch && <EmptyNote>{t('home.empty.published')}</EmptyNote>}
            {data.costWatch && (
              <ul className="flex flex-col gap-1 text-body">
                <li>
                  {t('home.fin.costPublished')} <CostValue value={data.costWatch.publishedCost} level="network" compact />
                </li>
                <li>
                  {t('home.fin.costDraft', { name: data.costWatch.draftScenarioName })}{' '}
                  <CostValue value={data.costWatch.draftCost} level="network" compact />
                </li>
                <li>
                  <TextLink href="/scenarios/compare">{t('nav.compare')}</TextLink>
                </li>
              </ul>
            )}
          </Section>
        </Pair>
      )
    case 'RST':
      return (
        <Pair>
          <Section title={t('home.rst.freshnessTitle')}>
            <ul className="flex flex-col gap-1 text-body">
              {data.dataFreshness?.map((d) => (
                <li key={d.dataset}>
                  {t(`home.rst.dataset.${d.dataset}`)}:{' '}
                  {d.loadedAt ? (
                    <StatusPill tone="success">{t('home.rst.loaded', { date: formatDate(d.loadedAt, { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' }) })}</StatusPill>
                  ) : (
                    <StatusPill tone="warning">{t('home.rst.notLoaded')}</StatusPill>
                  )}
                </li>
              ))}
              <li>
                <TextLink href="/data/sources">{t('nav.dataSources')}</TextLink>
              </li>
            </ul>
          </Section>
          <Section title={t('home.rst.draftRulesTitle')}>
            {!data.draftRules?.length && <EmptyNote>{t('home.empty.draftRules')}</EmptyNote>}
            <ul className="flex flex-col gap-1 text-body">
              {data.draftRules?.map((r) => (
                <li key={r.ruleSetId}>
                  {t('home.rst.draftRule', { name: r.name, version: r.version })} —{' '}
                  <TextLink href={`/rules/${encodeURIComponent(r.ruleSetId)}/edit`}>{t('home.rst.continue')}</TextLink>
                </li>
              ))}
            </ul>
          </Section>
        </Pair>
      )
    case 'STF': {
      const s = data.nextShifts
      if (!s) return <NothingToShow role={data.role} />
      return (
        <Section title={t('home.stf.title', { store: s.storeName, department: s.departmentName })}>
          {s.shifts.length === 0 && <EmptyNote>{t('home.empty.shifts')}</EmptyNote>}
          <ul className="flex flex-col gap-2 text-body">
            {s.shifts.map((shift) => (
              <li key={shift.start}>
                <Cluster gap={2}>
                  <span className="font-weight-semibold">
                    {t('home.stf.shift', {
                      date: formatDate(shift.start, SHIFT_DAY),
                      start: formatTime(shift.start, SHIFT_TIME),
                      end: formatTime(shift.end, SHIFT_TIME),
                    })}
                  </span>
                  {shift.mealStart && <span>· {t('home.stf.meal', { time: formatTime(shift.mealStart, SHIFT_TIME) })}</span>}
                  {shift.changed && <StatusPill tone="warning">{t('home.stf.changed')}</StatusPill>}
                </Cluster>
              </li>
            ))}
          </ul>
          <div>
            <LinkButton href="/my-roster" primary>
              {t('nav.myRoster')}
            </LinkButton>
          </div>
        </Section>
      )
    }
    case 'ADM':
      return (
        <Pair>
          <Section title={t('home.adm.invitationsTitle')}>
            <p className="text-body">
              {t('home.adm.invitationsBody', { count: formatNumber(data.pendingInvitations ?? 0) })} —{' '}
              <TextLink href="/admin/users">{t('nav.users')}</TextLink>
            </p>
          </Section>
          <Section title={t('home.adm.auditTitle')}>
            <Stack gap={2}>
              {!data.recentAudit?.length && <EmptyNote>{t('home.empty.audit')}</EmptyNote>}
              {!!data.recentAudit?.length && (
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {data.recentAudit.map((e) => (
                    <li key={e.id} className="text-body-sm text-text">
                      <span className="lw-numeric text-text-muted">{formatDate(e.at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                      {' · '}
                      {e.userName} · <span className="lw-numeric">{e.event}</span>
                      {e.objectName && ` · ${e.objectName}`}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-body">
                <TextLink href="/admin/audit">{t('nav.audit')}</TextLink>
              </p>
            </Stack>
          </Section>
        </Pair>
      )
  }
}

function DeadlinePill({ date, now }: { date: string; now: number }) {
  const { t } = useI18n()
  const days = Math.ceil((Date.parse(`${date}T00:00:00+08:00`) - now) / 86_400_000)
  if (days >= 0 && days <= 7) {
    return <StatusPill tone="warning">{t('home.deadline.inDays', { count: days })}</StatusPill>
  }
  return <StatusPill tone="neutral">{t('home.deadline.upcoming')}</StatusPill>
}

function Kpis({ kpis }: { kpis: NonNullable<HomeSummary['kpis']> }) {
  const { t, formatDate, formatNumber } = useI18n()
  return (
    <section aria-label={t('home.kpi.label')}>
      <Grid>
        <Col span={2} spanTablet={4} spanLaptop={3}>
          <KpiCard
            emphasis="key"
            label={t('home.kpi.hires')}
            value={<Num value={kpis.seasonalHires} />}
            detail={t('home.kpi.hiresDetail', { ft: formatNumber(kpis.fullTime), pt: formatNumber(kpis.partTime) })}
          />
        </Col>
        <Col span={2} spanTablet={4} spanLaptop={3}>
          <KpiCard
            label={t('home.kpi.toRecruit')}
            value={t('home.kpi.toRecruitValue', { min: formatNumber(kpis.toRecruitMin), max: formatNumber(kpis.toRecruitMax) })}
            detail={t('home.kpi.toRecruitDetail')}
          />
        </Col>
        <Col span={2} spanTablet={4} spanLaptop={3}>
          <KpiCard
            label={t('home.kpi.firstNeeded')}
            value={formatDate(kpis.firstNeeded, DATE_ONLY)}
            detail={t('home.kpi.firstNeededDetail', { date: formatDate(kpis.offersDue, DATE_ONLY) })}
          />
        </Col>
        <Col span={2} spanTablet={4} spanLaptop={3}>
          <KpiCard
            label={t('home.kpi.seasonCost')}
            value={<CostValue value={kpis.seasonCost} level="network" compact />}
            detail={t('home.kpi.seasonCostDetail')}
          />
        </Col>
      </Grid>
    </section>
  )
}

function RecentScenarios({ rows }: { rows: NonNullable<HomeSummary['recentScenarios']> }) {
  const { t, formatDate } = useI18n()
  return (
    <TableWrap>
      <Table>
        <caption className="px-3 py-2 text-left text-h3 text-text">{t('home.scenarios.caption')}</caption>
        <TableHead>
          <TableRow>
            <TableHeaderCell>{t('home.scenarios.name')}</TableHeaderCell>
            <TableHeaderCell>{t('home.scenarios.status')}</TableHeaderCell>
            <TableHeaderCell>{t('home.scenarios.updated')}</TableHeaderCell>
            <TableHeaderCell>{t('home.scenarios.owner')}</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 && <TableEmpty colSpan={4}>{t('home.empty.scenarios')}</TableEmpty>}
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableRowHeader>
                <TextLink href={`/scenarios/${encodeURIComponent(row.id)}/settings`}>
                  {row.status === 'published' && <span aria-hidden="true">★ </span>}
                  {row.name}
                </TextLink>
              </TableRowHeader>
              <TableCell>
                <Cluster gap={1}>
                  <StatusPill tone={row.status === 'published' ? 'success' : 'neutral'}>
                    {t(`scenario.status.${row.status}`)}
                  </StatusPill>
                  {row.stale && <StatusPill tone="warning">{t('home.scenarios.stale')}</StatusPill>}
                </Cluster>
              </TableCell>
              <TableCell>{formatDate(row.updatedAt, { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })}</TableCell>
              <TableCell>{row.ownerName}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableWrap>
  )
}
