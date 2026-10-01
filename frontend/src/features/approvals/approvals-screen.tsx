import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import {
  APPROVAL_RESOURCE_BY_STEP,
  APPROVAL_STEP_KINDS,
  can,
  type ApprovalDecision,
  type ApprovalDetail,
  type ApprovalQueueItem,
  type ApprovalStepKind,
  type ApprovalStepView,
  type OutsideStep,
  type RoleCode,
} from '@lanewise/shared'
import { ApiError } from '@/api'
import { Cluster, Col, Grid, Section, Stack } from '@/components/layout'
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
} from '@/components/ui'
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { CostValue } from '@/features/cost'
import { DATE_TIME, SCENARIO_STATUS_TONE, SIGNED } from '@/features/scenarios/logic'
import { useI18n } from '@/i18n'
import { errorCode, errorReference } from '@/features/scenarios/api'
import type { ApprovalQueueState, ApprovalsClient } from './api'
import { STEP_STATUS_TONE, approvalPath, commentSatisfies } from './logic'

export interface ApprovalsScreenProps {
  readonly client: ApprovalsClient
  readonly role: RoleCode | null
  /** The scenario under review, or null for the queue. */
  readonly scenarioId: string | null
  readonly onOpen: (scenarioId: string | null) => void
  /** Links out to SCR-024 (summary) and SCR-032 (compare). */
  readonly summaryHref: (scenarioId: string) => string
  readonly compareHref: (a: string, b: string) => string
}

/**
 * SCR-033 Approval review (requirement 9; P10). Without a scenario: the
 * approvals queue. With one: the tracker (headcount → HR, budget → Finance,
 * plan → Executive), the off-system records, checks, the step's own figures,
 * the summary preview and changes vs the published plan, and the active
 * role's decision controls. What the role may do comes from the API
 * (`actions`, the shared workflow model); the plan buttons stay disabled
 * until headcount and budget are both secured.
 */
export function ApprovalsScreen(props: ApprovalsScreenProps) {
  const { t } = useI18n()
  useDocumentTitle(t('approvals.pageTitle'))
  if (!can(props.role, 'approval_plan', 'view')) {
    return <StateBlock variant="no-access" title={t('approvals.noAccess.title')} description={t('approvals.noAccess.description')} />
  }
  return props.scenarioId ? <Review {...props} scenarioId={props.scenarioId} /> : <Queue {...props} />
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

type QueueLoad =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly items: readonly ApprovalQueueItem[] }

function Queue({ client, onOpen }: ApprovalsScreenProps) {
  const { t, formatDateTime } = useI18n()
  const [show, setShow] = useState<ApprovalQueueState>('pending')
  const [load, setLoad] = useState<QueueLoad>({ kind: 'loading' })

  useEffect(() => {
    let live = true
    client.list(show).then(
      (items) => live && setLoad({ kind: 'ready', items }),
      (error: unknown) => live && setLoad({ kind: 'error', referenceId: errorReference(error) }),
    )
    return () => {
      live = false
    }
  }, [client, show])

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <h1 className="text-h1 text-text">{t('approvals.queue.title')}</h1>
        <p className="text-body text-text-muted">{t('approvals.queue.intro')}</p>
      </Stack>
      <Cluster gap={4} align="end">
        <Field label={t('approvals.queue.show')}>
          {(aria) => (
            <Select
              {...aria}
              value={show}
              onChange={(e) => {
                setLoad({ kind: 'loading' })
                setShow(e.target.value as ApprovalQueueState)
              }}
            >
              <option value="pending">{t('approvals.queue.show.pending')}</option>
              <option value="all">{t('approvals.queue.show.all')}</option>
            </Select>
          )}
        </Field>
      </Cluster>

      {load.kind === 'loading' && <CardSkeleton label={t('state.loading')} />}
      {load.kind === 'error' && <StateBlock variant="error" title={t('approvals.queue.error.title')} referenceId={load.referenceId} />}
      {load.kind === 'ready' && load.items.length === 0 && (
        <StateBlock variant="empty" title={t('approvals.queue.empty.title')} description={t('approvals.queue.empty.description')} />
      )}
      {load.kind === 'ready' && load.items.length > 0 && (
        <TableWrap>
          <Table>
            <caption className="sr-only">{t('approvals.queue.caption')}</caption>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t('approvals.queue.col.scenario')}</TableHeaderCell>
                <TableHeaderCell>{t('approvals.queue.col.submitted')}</TableHeaderCell>
                {APPROVAL_STEP_KINDS.map((k) => (
                  <TableHeaderCell key={k}>{t(`approvals.step.${k}`)}</TableHeaderCell>
                ))}
                <TableHeaderCell>{t('approvals.queue.col.status')}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {load.items.map((item) => (
                <TableRow key={item.scenarioId}>
                  <TableRowHeader>
                    <Stack gap={1}>
                      <a
                        href={approvalPath(item.scenarioId)}
                        className="text-primary underline"
                        onClick={(e) => {
                          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                          e.preventDefault()
                          onOpen(item.scenarioId)
                        }}
                      >
                        {item.name}
                      </a>
                      {item.awaitingYou && (
                        <span>
                          <StatusPill tone="info">{t('approvals.queue.awaitingYou')}</StatusPill>
                        </span>
                      )}
                    </Stack>
                  </TableRowHeader>
                  <TableCell>
                    {item.submittedAt ? formatDateTime(item.submittedAt, DATE_TIME) : t('approvals.none')}
                    {item.submittedBy && <span className="block text-body-sm text-text-muted">{item.submittedBy.name}</span>}
                  </TableCell>
                  {APPROVAL_STEP_KINDS.map((k) => {
                    const step = item.steps.find((s) => s.step === k)
                    const ready = k === 'plan' && step?.status === 'pending' && item.planReady
                    return (
                      <TableCell key={k}>
                        {step && (
                          <StatusPill tone={ready ? 'info' : STEP_STATUS_TONE[step.status]}>
                            {t(ready ? 'approvals.status.ready' : `approvals.status.${step.status}`)}
                          </StatusPill>
                        )}
                      </TableCell>
                    )
                  })}
                  <TableCell>
                    <Cluster gap={2}>
                      <StatusPill tone={SCENARIO_STATUS_TONE[item.status]}>{t(`scenario.status.${item.status}`)}</StatusPill>
                      {item.stale && <StatusPill tone="warning">{t('scenarios.stale')}</StatusPill>}
                    </Cluster>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      )}
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

type ReviewLoad =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly detail: ApprovalDetail }

type Notice = { readonly tone: 'success' | 'danger'; readonly text: string } | null

const APPROVE_LABEL: Record<ApprovalStepKind, string> = {
  headcount: 'approvals.action.approve.headcount',
  budget: 'approvals.action.approve.budget',
  plan: 'approvals.action.approve.plan',
}

function Review({ client, role, scenarioId, onOpen, summaryHref, compareHref }: ApprovalsScreenProps & { scenarioId: string }) {
  const { t, formatDateTime, formatNumber } = useI18n()
  const [load, setLoad] = useState<ReviewLoad>({ kind: 'loading' })
  const [comment, setComment] = useState('')
  const [commentError, setCommentError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [outsideOpen, setOutsideOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)

  const fetchOne = useCallback(() => {
    client.get(scenarioId).then(
      (detail) => setLoad({ kind: 'ready', detail }),
      (error: unknown) => setLoad({ kind: 'error', referenceId: errorReference(error) }),
    )
  }, [client, scenarioId])

  useEffect(() => {
    fetchOne()
  }, [fetchOne])

  const back = (
    <a
      href={approvalPath()}
      className="text-primary underline"
      onClick={(e) => {
        e.preventDefault()
        onOpen(null)
      }}
    >
      {t('approvals.back')}
    </a>
  )

  if (load.kind === 'loading') {
    return (
      <Stack gap={4}>
        {back}
        <CardSkeleton label={t('state.loading')} />
      </Stack>
    )
  }
  if (load.kind === 'error') {
    return (
      <Stack gap={4}>
        {back}
        <StateBlock
          variant="error"
          title={t('approvals.review.error.title')}
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

  const d = load.detail
  const s = d.scenario
  const actions = d.actions
  const myDecisionSteps = APPROVAL_STEP_KINDS.filter((k) => can(role, APPROVAL_RESOURCE_BY_STEP[k], 'approve'))
  const paused = s.status === 'submitted' && !d.checks.notStale

  const fail = (e: unknown) => {
    const code = errorCode(e)
    const blocker = e instanceof ApiError ? e.details.find((x) => x.path === 'blocker')?.message : undefined
    setNotice({
      tone: 'danger',
      text: t(
        blocker === 'paused'
          ? 'approvals.error.paused'
          : code === 'conflict'
            ? 'approvals.error.conflict'
            : code === 'validation_failed'
              ? 'approvals.error.validation'
              : 'approvals.error.generic',
      ),
    })
    if (code === 'conflict') fetchOne()
  }

  const perform = async (fn: () => Promise<ApprovalDetail>, done: string) => {
    setBusy(true)
    setNotice(null)
    try {
      const detail = await fn()
      setLoad({ kind: 'ready', detail })
      setComment('')
      setCommentError(false)
      setNotice({ tone: 'success', text: t(done) })
      return true
    } catch (e) {
      fail(e)
      return false
    } finally {
      setBusy(false)
    }
  }

  const decide = (step: ApprovalStepKind, decision: ApprovalDecision) => {
    if (!commentSatisfies(decision, comment)) {
      setCommentError(true)
      return
    }
    const done = decision === 'approve' ? (step === 'plan' ? 'approvals.done.published' : 'approvals.done.approved') : 'approvals.done.returned'
    void perform(
      () =>
        client.decide(s.id, step, {
          decision,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
          submissionNo: d.submissionNo,
        }),
      done,
    ).then((ok) => ok && setPublishOpen(false))
  }

  const results = d.results
  const storeDelta = (storeId: string) => d.changes?.stores.find((x) => x.storeId === storeId)
  const signed = (v: number | null | undefined) => (v === null || v === undefined ? t('approvals.none') : formatNumber(v, SIGNED))

  return (
    <Stack gap={6}>
      {back}
      <Stack gap={2}>
        <h1 className="text-h1 text-text">{t('approvals.review.title', { name: s.name })}</h1>
        <Cluster gap={2} align="center">
          <StatusPill tone={SCENARIO_STATUS_TONE[s.status]}>{t(`scenario.status.${s.status}`)}</StatusPill>
          <span className="text-body-sm text-text-muted">
            {d.submittedAt && d.submittedBy
              ? t('approvals.review.submitted', { name: d.submittedBy.name, date: formatDateTime(d.submittedAt, DATE_TIME), n: d.submissionNo })
              : t('approvals.review.notSubmitted')}
          </span>
        </Cluster>
        {s.notes && <p className="text-body text-text">{t('approvals.review.notes', { notes: s.notes })}</p>}
      </Stack>

      {notice && <Alert tone={notice.tone} title={notice.text} assertive={notice.tone === 'danger'} />}
      {paused && <Alert tone="warning" title={t('approvals.paused.title')}>{t('approvals.paused.description')}</Alert>}

      <Section title={t('approvals.tracker.title')} description={t('approvals.tracker.sequence')}>
        {d.steps.length === 0 ? (
          <p className="text-body text-text-muted">{t('approvals.review.notSubmitted')}</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {d.steps.map((step, i) => (
              <li key={step.step}>
                <StepLine step={step} n={i + 1} planReady={d.planReady} />
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={t('approvals.checks.title')}>
        <ul className="flex flex-col gap-2">
          <Check ok={d.checks.runComplete} text={t(d.checks.runComplete ? 'approvals.checks.runComplete' : 'approvals.checks.runMissing')} />
          <Check ok={d.checks.notStale} text={t(d.checks.notStale ? 'approvals.checks.notStale' : 'approvals.checks.stale')} />
        </ul>
      </Section>

      {results && myDecisionSteps.includes('headcount') && (
        <Section title={t('approvals.your.headcount')}>
          <TableWrap>
            <Table>
              <caption className="sr-only">{t('approvals.your.headcount.caption')}</caption>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t('approvals.col.store')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('approvals.col.headcount')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('approvals.col.vsPublished')}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {results.stores.map((st) => (
                  <TableRow key={st.storeId}>
                    <TableRowHeader>{st.storeName}</TableRowHeader>
                    <TableCell numeric>
                      <Num value={st.headcount} />
                    </TableCell>
                    <TableCell numeric>{signed(storeDelta(st.storeId)?.headcount.delta)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableRowHeader>{t('approvals.total')}</TableRowHeader>
                  <TableCell numeric>
                    <Num value={results.headcount} />
                  </TableCell>
                  <TableCell numeric>{signed(d.changes?.headcount.delta)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableWrap>
        </Section>
      )}

      {results && myDecisionSteps.includes('budget') && (
        <Section title={t('approvals.your.budget')}>
          <TableWrap>
            <Table>
              <caption className="sr-only">{t('approvals.your.budget.caption')}</caption>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t('approvals.col.store')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('approvals.col.cost')}</TableHeaderCell>
                  <TableHeaderCell numeric>{t('approvals.col.vsPublished')}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {results.stores.map((st) => (
                  <TableRow key={st.storeId}>
                    <TableRowHeader>{st.storeName}</TableRowHeader>
                    <TableCell numeric>
                      <CostValue value={st.cost} level="store" align="end" />
                    </TableCell>
                    <TableCell numeric>
                      <CostValue value={storeDelta(st.storeId)?.cost?.delta ?? undefined} level="store" align="end" options={SIGNED} />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableRowHeader>{t('approvals.total')}</TableRowHeader>
                  <TableCell numeric>
                    <CostValue value={results.cost} level="network" align="end" />
                  </TableCell>
                  <TableCell numeric>
                    <CostValue value={d.changes?.cost?.delta ?? undefined} level="network" align="end" options={SIGNED} />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableWrap>
        </Section>
      )}

      <Section
        title={t('approvals.summary.title')}
        actions={
          <a href={summaryHref(s.id)} className="text-primary underline">
            {t('approvals.summary.openFull')}
          </a>
        }
      >
        {results ? (
          <Grid>
            <Col span={2} spanTablet={4} spanLaptop={3}>
              <KpiCard label={t('approvals.kpi.headcount')} value={<Num value={results.headcount} />} />
            </Col>
            <Col span={2} spanTablet={4} spanLaptop={3}>
              <KpiCard label={t('approvals.kpi.paidHours')} value={<Num value={results.paidHours} />} />
            </Col>
            <Col span={2} spanTablet={4} spanLaptop={3}>
              <KpiCard label={t('approvals.kpi.cost')} value={<CostValue value={results.cost} level="network" />} />
            </Col>
            <Col span={2} spanTablet={4} spanLaptop={3}>
              <KpiCard label={t('approvals.kpi.peak')} value={<Num value={results.peak.lanesOpen} />} />
            </Col>
          </Grid>
        ) : (
          <p className="text-body text-text-muted">{t('approvals.summary.none')}</p>
        )}
      </Section>

      <Section
        title={t('approvals.changes.title')}
        actions={
          d.published ? (
            <a href={compareHref(d.published.id, s.id)} className="text-primary underline">
              {t('approvals.changes.full')}
            </a>
          ) : undefined
        }
      >
        {d.published && d.changes ? (
          <Stack gap={2}>
            <p className="text-body-sm text-text-muted">{t('approvals.changes.against', { name: d.published.name })}</p>
            <p className="text-body text-text tabular-nums">
              {t('approvals.changes.headcount', {
                a: d.changes.headcount.a === null ? t('approvals.none') : formatNumber(d.changes.headcount.a),
                b: d.changes.headcount.b === null ? t('approvals.none') : formatNumber(d.changes.headcount.b),
                delta: signed(d.changes.headcount.delta),
              })}
            </p>
            <p className="text-body text-text tabular-nums">
              {t('approvals.changes.cost')}: <CostValue value={d.changes.cost?.a ?? undefined} level="network" /> {'→ '}
              <CostValue value={d.changes.cost?.b ?? undefined} level="network" /> {'('}
              <CostValue value={d.changes.cost?.delta ?? undefined} level="network" options={SIGNED} />
              {')'}
            </p>
          </Stack>
        ) : (
          <p className="text-body text-text-muted">{t('approvals.changes.none')}</p>
        )}
      </Section>

      {d.history.length > 0 && (
        <Section title={t('approvals.history.title')}>
          <Stack gap={4}>
            {d.history.map((h) => (
              <Stack key={h.submissionNo} gap={2}>
                <h3 className="text-h4 text-text">{t('approvals.history.item', { n: h.submissionNo })}</h3>
                <ol className="flex flex-col gap-2">
                  {h.steps.map((step, i) => (
                    <li key={step.step}>
                      <StepLine step={step} n={i + 1} planReady={false} />
                    </li>
                  ))}
                </ol>
              </Stack>
            ))}
          </Stack>
        </Section>
      )}

      {s.status === 'submitted' && (myDecisionSteps.length > 0 || can(role, 'approval_offsystem', 'edit')) && (
        <Section title={t('approvals.decide.title')}>
          <Stack gap={4}>
            {myDecisionSteps.length > 0 && (
              <Field label={t('approvals.comment')} error={commentError ? t('approvals.comment.required') : undefined}>
                {(aria) => (
                  <Textarea
                    {...aria}
                    value={comment}
                    onChange={(e) => {
                      setComment(e.target.value)
                      if (e.target.value.trim()) setCommentError(false)
                    }}
                  />
                )}
              </Field>
            )}
            {myDecisionSteps.map((step) => {
              const available = actions.decide[step]
              const disabled = busy || available.length === 0
              const stepName = t(`approvals.step.${step}`)
              return (
                <Stack key={step} gap={2}>
                  <Cluster gap={2}>
                    {step === 'plan' && (
                      <Button disabled={disabled} onClick={() => decide(step, 'reject')} aria-label={t('approvals.action.reject.step', { step: stepName })}>
                        {t('approvals.action.reject')}
                      </Button>
                    )}
                    <Button
                      disabled={disabled}
                      onClick={() => decide(step, 'request_changes')}
                      aria-label={t('approvals.action.request_changes.step', { step: stepName })}
                    >
                      {t('approvals.action.request_changes')}
                    </Button>
                    <Button
                      variant="primary"
                      disabled={disabled}
                      loading={busy}
                      loadingLabel={t('approvals.working')}
                      onClick={() => (step === 'plan' ? setPublishOpen(true) : decide(step, 'approve'))}
                    >
                      {t(APPROVE_LABEL[step])}
                    </Button>
                  </Cluster>
                  {step === 'plan' && actions.blockers.plan === 'not_ready' && (
                    <p className="text-body-sm text-text-muted">{t('approvals.planDisabled')}</p>
                  )}
                </Stack>
              )
            })}
            {actions.recordOutside.length > 0 && (
              <Cluster gap={2}>
                <Button disabled={busy} onClick={() => setOutsideOpen(true)}>
                  {t('approvals.action.recordOutside')}
                </Button>
              </Cluster>
            )}
          </Stack>
        </Section>
      )}

      <OutsideDialog
        open={outsideOpen}
        steps={actions.recordOutside}
        busy={busy}
        onClose={() => setOutsideOpen(false)}
        onRecord={(step, reference, note) =>
          void perform(() => client.recordOutside(s.id, { step, reference, note, submissionNo: d.submissionNo }), 'approvals.done.outside').then(
            (ok) => ok && setOutsideOpen(false),
          )
        }
      />

      <Dialog open={publishOpen} onOpenChange={(open) => !open && setPublishOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('approvals.publish.title')}</DialogTitle>
            <DialogDescription>
              {d.published
                ? t('approvals.publish.replaces', { name: s.name, published: d.published.name })
                : t('approvals.publish.first', { name: s.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setPublishOpen(false)} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" loading={busy} loadingLabel={t('approvals.working')} onClick={() => decide('plan', 'approve')}>
              {t('approvals.publish.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Stack>
  )
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle
  return (
    <li className="flex items-center gap-2 text-body text-text">
      <Icon aria-hidden="true" className={ok ? 'size-4 shrink-0 text-success' : 'size-4 shrink-0 text-warning'} />
      <span>{text}</span>
    </li>
  )
}

function StepLine({ step, n, planReady }: { step: ApprovalStepView; n: number; planReady: boolean }) {
  const { t, formatDateTime } = useI18n()
  const name = t(`approvals.step.${step.step}`)
  const ready = step.step === 'plan' && step.status === 'pending' && planReady
  const role = t(`role.${step.approverRole}`)
  let detail: React.ReactNode
  if (step.outside && step.decidedBy && step.decidedAt) {
    detail = (
      <>
        <span>
          {t('approvals.step.outside', { name: step.decidedBy.name, date: formatDateTime(step.decidedAt, DATE_TIME), reference: step.outside.reference })}
        </span>
        {step.outside.note && <span>{t('approvals.step.outsideNote', { note: step.outside.note })}</span>}
        <span>{t('approvals.step.visibleTo')}</span>
      </>
    )
  } else if (step.decidedBy && step.decidedAt) {
    detail = (
      <>
        <span>
          {t('approvals.step.decided', {
            name: step.decidedBy.name,
            role: t(`role.${step.decidedAsRole ?? step.approverRole}`),
            date: formatDateTime(step.decidedAt, DATE_TIME),
          })}
        </span>
        {step.comment && <span>{t('approvals.step.comment', { comment: step.comment })}</span>}
      </>
    )
  } else if (step.step === 'plan') {
    detail = <span>{t(ready ? 'approvals.step.readyPlan' : 'approvals.step.waitingPlan')}</span>
  } else {
    detail = <span>{t('approvals.step.waiting', { role })}</span>
  }
  return (
    <Stack gap={1}>
      <Cluster gap={2} align="center">
        <span className="text-h4 text-text">{t('approvals.step.number', { n, step: name })}</span>
        <span className="text-body-sm text-text-muted">({role})</span>
        <StatusPill tone={ready ? 'info' : STEP_STATUS_TONE[step.status]}>
          {t(ready ? 'approvals.status.ready' : `approvals.status.${step.status}`)}
        </StatusPill>
      </Cluster>
      <span className="flex flex-col text-body-sm text-text-muted">{detail}</span>
    </Stack>
  )
}

function OutsideDialog({
  open,
  steps,
  busy,
  onClose,
  onRecord,
}: {
  open: boolean
  steps: readonly OutsideStep[]
  busy: boolean
  onClose: () => void
  onRecord: (step: OutsideStep, reference: string, note: string) => void
}) {
  const { t } = useI18n()
  const [step, setStep] = useState<OutsideStep | ''>('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [invalid, setInvalid] = useState(false)
  const chosen = step && steps.includes(step) ? step : (steps[0] ?? '')

  const submit = () => {
    if (!chosen || !reference.trim() || !note.trim()) {
      setInvalid(true)
      return
    }
    onRecord(chosen, reference.trim(), note.trim())
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose()
          setInvalid(false)
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('approvals.outside.title')}</DialogTitle>
          <DialogDescription>{t('approvals.outside.hint')}</DialogDescription>
        </DialogHeader>
        <Stack gap={4}>
          <Field label={t('approvals.outside.step')}>
            {(aria) => (
              <Select {...aria} value={chosen} onChange={(e) => setStep(e.target.value as OutsideStep)}>
                {steps.map((k) => (
                  <option key={k} value={k}>
                    {t(`approvals.step.${k}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('approvals.outside.reference')}
            required
            error={invalid && !reference.trim() ? t('approvals.outside.required') : undefined}
          >
            {(aria) => <Input {...aria} value={reference} onChange={(e) => setReference(e.target.value)} />}
          </Field>
          <Field label={t('approvals.outside.note')} required error={invalid && !note.trim() ? t('approvals.outside.required') : undefined}>
            {(aria) => <Textarea {...aria} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </Stack>
        <DialogFooter>
          <Button onClick={onClose} disabled={busy}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" loading={busy} loadingLabel={t('approvals.working')} onClick={submit}>
            {t('approvals.outside.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
