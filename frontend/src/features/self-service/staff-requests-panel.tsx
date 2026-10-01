import { useCallback, useEffect, useState } from 'react'
import type { StoreStaffRequestDto } from '@lanewise/shared'
import { ApiError } from '@/api'
import { useAnnouncer } from '@/components/a11y'
import { Cluster, Stack } from '@/components/layout'
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Skeleton,
  StatusPill,
  STATUS_META,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrap,
  Textarea,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import { useRosterFormat } from '@/features/roster/use-roster-format'
import type { SelfServiceClient } from './api'
import { REQUEST_TONE, requestDetail } from './text'

/**
 * SCR-022 "Staff requests" (task 18.2 — requirement 15.4–15.7; wireframe
 * scr-022-roster.html): the store's pending time-off and swap requests for
 * its Store Manager, with Approve / Decline. Approving a swap applies it as a
 * roster change (both cashiers notified); approving time off marks the
 * cashier unavailable and flags the shifts it leaves open. A swap that breaks
 * a labor rule needs a reason; a missed 24-hour rest can't be approved
 * (Req 7.3/7.4). Other roster viewers (Planner, HR, …) see it read-only.
 */
export function StaffRequestsPanel({
  client,
  storeId,
  canDecide,
  refreshKey = 0,
  onChanged,
}: {
  client: SelfServiceClient
  storeId: string
  /** "Approve staff time-off / swap request" — the Store Manager of this store. */
  canDecide: boolean
  refreshKey?: number
  onChanged?: () => void
}) {
  const f = useRosterFormat()
  const { t } = f
  const [requests, setRequests] = useState<readonly StoreStaffRequestDto[] | null>(null)
  const [error, setError] = useState(false)
  const [deciding, setDeciding] = useState<{ request: StoreStaffRequestDto; decision: 'approve' | 'decline' } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(() => {
    client.storeRequests(storeId).then(setRequests, () => setError(true))
  }, [client, storeId])
  useEffect(reload, [reload, refreshKey])

  if (error) return <Alert tone="danger">{t('selfService.panel.loadFailed')}</Alert>
  if (!requests) return <Skeleton className="h-16 w-full" />
  const pending = requests.filter((r) => r.status === 'pending')
  const decided = requests.filter((r) => r.status !== 'pending').slice(0, 10)

  return (
    <details className="border border-outline bg-surface p-4" open={pending.length > 0}>
      <summary className="min-h-tap cursor-pointer text-h3 text-text">
        {t('selfService.panel.title', { count: pending.length })}
      </summary>
      <Stack gap={3} className="mt-3">
        {notice && <Alert tone="success" title={notice} live={false} />}
        {pending.length === 0 ? (
          <p className="text-body-sm text-text-muted">{t('selfService.panel.none')}</p>
        ) : (
          <TableWrap>
            <Table>
              <caption className="sr-only">{t('selfService.panel.caption')}</caption>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t('selfService.panel.staff')}</TableHeaderCell>
                  <TableHeaderCell>{t('selfService.panel.type')}</TableHeaderCell>
                  <TableHeaderCell>{t('selfService.panel.detail')}</TableHeaderCell>
                  {canDecide && <TableHeaderCell>{t('selfService.panel.actions')}</TableHeaderCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {pending.map((r) => {
                  const who = `${r.staff.employeeNo} ${r.staff.name}`
                  const blocked = r.check?.status === 'blocked'
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{who}</TableCell>
                      <TableCell>{t(`selfService.type.${r.type}`)}</TableCell>
                      <TableCell>
                        <Stack gap={1}>
                          <span>
                            {requestDetail(f, r)}
                            {r.target?.staffName && ` · ${t('selfService.panel.with', { name: r.target.staffName })}`}
                          </span>
                          {r.note && <span className="text-caption text-text-muted">{t('selfService.note', { note: r.note })}</span>}
                          {r.shiftsLeftOpen !== null && r.shiftsLeftOpen > 0 && (
                            <span className="text-caption text-text">{t('selfService.panel.leavesOpen', { count: r.shiftsLeftOpen })}</span>
                          )}
                          {r.stale && <RuleLine tone="warning" text={t('selfService.panel.stale')} />}
                          {r.check?.status === 'needsReason' && <RuleLine tone="warning" text={t('selfService.panel.needsReason')} />}
                          {blocked && <RuleLine tone="danger" text={t('selfService.panel.blocked')} />}
                          {r.check && [...r.check.breaches, ...r.check.blocking].map((b) => (
                            <span key={`${b.rule}|${b.staffId}|${b.date}`} className="text-caption text-text-muted">
                              {b.message}
                            </span>
                          ))}
                        </Stack>
                      </TableCell>
                      {canDecide && (
                        <TableCell>
                          <Cluster gap={2}>
                            <Button size="sm" onClick={() => setDeciding({ request: r, decision: 'decline' })} aria-label={t('selfService.panel.declineLabel', { who })}>
                              {t('selfService.panel.decline')}
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={blocked || r.stale}
                              onClick={() => setDeciding({ request: r, decision: 'approve' })}
                              aria-label={t('selfService.panel.approveLabel', { who })}
                            >
                              {t('selfService.panel.approve')}
                            </Button>
                          </Cluster>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>
        )}
        <p className="text-caption text-text-muted">{t('selfService.panel.help')}</p>
        {decided.length > 0 && (
          <Stack gap={1}>
            <h3 className="text-body font-weight-semibold text-text">{t('selfService.panel.recent')}</h3>
            <ul className="m-0 list-none p-0 text-body-sm">
              {decided.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 border-b border-outline-subtle py-1 text-text">
                  <StatusPill tone={REQUEST_TONE[r.status]}>{t(`selfService.status.${r.status}`)}</StatusPill>
                  {`${r.staff.employeeNo} ${r.staff.name} · ${t(`selfService.type.${r.type}`)} · ${requestDetail(f, r)}`}
                </li>
              ))}
            </ul>
          </Stack>
        )}
      </Stack>
      {deciding && (
        <DecisionDialog
          client={client}
          storeId={storeId}
          request={deciding.request}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
          onDecided={(text) => {
            setDeciding(null)
            setNotice(text)
            reload()
            onChanged?.()
          }}
        />
      )}
    </details>
  )
}

function RuleLine({ tone, text }: { tone: 'warning' | 'danger'; text: string }) {
  const Icon = STATUS_META[tone].icon
  return (
    <span className="flex items-center gap-1 text-caption text-text">
      <Icon aria-hidden="true" className={cn('size-4 shrink-0', STATUS_META[tone].fg)} />
      {text}
    </span>
  )
}

function DecisionDialog({
  client,
  storeId,
  request,
  decision,
  onClose,
  onDecided,
}: {
  client: SelfServiceClient
  storeId: string
  request: StoreStaffRequestDto
  decision: 'approve' | 'decline'
  onClose: () => void
  onDecided: (text: string) => void
}) {
  const f = useRosterFormat()
  const { t } = f
  const { announce } = useAnnouncer()
  const needsReason = decision === 'approve' && request.check?.status === 'needsReason'
  const [text, setText] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const who = `${request.staff.employeeNo} ${request.staff.name}`

  const submit = async () => {
    setError(null)
    setFieldError(null)
    if (needsReason && !text.trim()) {
      setFieldError(t('selfService.panel.reasonRequired'))
      return
    }
    setBusy(true)
    try {
      const body = decision === 'approve' ? { decision, ...(text.trim() ? { reason: text.trim() } : {}) } : { decision, ...(text.trim() ? { note: text.trim() } : {}) }
      await client.decide(storeId, request.id, body)
      const done = t(decision === 'approve' ? 'selfService.panel.approved' : 'selfService.panel.declined', { who })
      announce(done)
      onDecided(done)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'validation_failed') setFieldError(t('selfService.panel.reasonRequired'))
      else setError(e instanceof ApiError && e.code === 'conflict' ? t('selfService.panel.conflict') : t('selfService.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(decision === 'approve' ? 'selfService.panel.approveTitle' : 'selfService.panel.declineTitle', { who })}</DialogTitle>
          <DialogDescription>{`${t(`selfService.type.${request.type}`)} · ${requestDetail(f, request)}`}</DialogDescription>
        </DialogHeader>
        <Stack gap={3}>
          {decision === 'approve' && (
            <p className="text-body-sm text-text">
              {t(request.type === 'swap' ? 'selfService.panel.approveSwapEffect' : 'selfService.panel.approveTimeOffEffect', {
                count: request.shiftsLeftOpen ?? 0,
              })}
            </p>
          )}
          <Field
            label={t(decision === 'approve' ? (needsReason ? 'selfService.panel.reason' : 'selfService.panel.reasonOptional') : 'selfService.panel.comment')}
            hint={needsReason ? t('selfService.panel.needsReason') : undefined}
            error={fieldError ?? undefined}
            required={needsReason}
          >
            {(aria) => <Textarea {...aria} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />}
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
        </Stack>
        <DialogFooter>
          <Button onClick={onClose}>{t('selfService.close')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {t(decision === 'approve' ? 'selfService.panel.approve' : 'selfService.panel.decline')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
