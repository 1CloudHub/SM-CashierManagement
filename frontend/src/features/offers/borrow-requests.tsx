import { useCallback, useEffect, useState } from 'react'
import type { BorrowRequestDto, BorrowRequestsResponse, BorrowStatus, LendCandidate, RoleCode } from '@lanewise/shared'
import { ApiError } from '@/api'
import { useAnnouncer } from '@/components/a11y'
import { Cluster, Section, Stack } from '@/components/layout'
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
  Textarea,
  type StatusTone,
} from '@/components/ui'
import { useI18n } from '@/i18n'
import type { OffersClient } from './api'

const TONE: Readonly<Record<BorrowStatus, StatusTone>> = {
  pending: 'warning',
  approved: 'success',
  overridden: 'success',
  declined: 'neutral',
  cancelled: 'neutral',
}

/**
 * Store-to-store borrowing on SCR-022 (requirement 14; Q24): requests this
 * store made (cashiers coming in) and requests asking it to lend. The lending
 * Store Manager reviews a request, picks who goes from the cashiers who can
 * take the shifts within every labor rule (P16), and approves or declines; a
 * Planner may approve instead only with a recorded reason (an override).
 * Approved cashiers then appear on the receiving roster, marked with their
 * home store and travel time.
 */
export function BorrowRequests({
  client,
  storeId,
  role,
  canLend,
  refreshKey = 0,
  onChanged,
}: {
  client: OffersClient
  storeId: string
  role: RoleCode
  /** "Approve lending own staff" (Store Manager own store, Planner). */
  canLend: boolean
  refreshKey?: number
  onChanged?: () => void
}) {
  const { t, formatDateTime } = useI18n()
  const [data, setData] = useState<BorrowRequestsResponse | null>(null)
  const [error, setError] = useState(false)
  const [reviewing, setReviewing] = useState<BorrowRequestDto | null>(null)

  const reload = useCallback(() => {
    client.borrowRequests(storeId).then(setData, () => setError(true))
  }, [client, storeId])
  useEffect(reload, [reload, refreshKey])

  if (error) return <Alert tone="danger">{t('borrow.loadFailed')}</Alert>
  if (!data) return <Skeleton className="h-16 w-full" />
  if (data.incoming.length === 0 && data.outgoing.length === 0) {
    return (
      <Section title={t('borrow.title')} titleAs="h2">
        <p className="text-body-sm text-text-muted">{t('borrow.none')}</p>
      </Section>
    )
  }

  const row = (r: BorrowRequestDto, incoming: boolean) => (
    <li key={r.id} className="border-b border-outline-subtle py-2">
      <Stack gap={1}>
        <Cluster gap={2} align="center">
          <StatusPill tone={TONE[r.status]}>{t(`borrow.status.${r.status}`)}</StatusPill>
          <span className="text-body-sm text-text">
            {t(incoming ? 'borrow.incoming.row' : 'borrow.outgoing.row', {
              count: r.count,
              store: incoming ? r.toStoreName : r.fromStoreName,
              when: formatDateTime(r.windowStart, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
            })}
            {r.travelMin !== null && ` · ${t('offers.minutes', { minutes: r.travelMin })}`}
          </span>
          {incoming && r.status === 'pending' && canLend && (
            <Button size="sm" onClick={() => setReviewing(r)} aria-label={t('borrow.reviewLabel', { store: r.toStoreName })}>
              {t('borrow.review')}
            </Button>
          )}
        </Cluster>
        {r.note && <span className="text-caption text-text-muted">{t('borrow.note', { note: r.note })}</span>}
        {r.cashiers.length > 0 && (
          <span className="text-caption text-text-muted">{t('borrow.cashiers', { names: r.cashiers.map((c) => `${c.employeeNo} ${c.name}`).join(', ') })}</span>
        )}
        {r.overrideReason && <span className="text-caption text-text-muted">{t('borrow.overrideReason', { reason: r.overrideReason, by: r.decidedBy ?? '' })}</span>}
        {r.declineReason && <span className="text-caption text-text-muted">{t('borrow.declineReason', { reason: r.declineReason })}</span>}
      </Stack>
    </li>
  )

  return (
    <Section title={t('borrow.title')} titleAs="h2">
      {data.incoming.length > 0 && (
        <Stack gap={1}>
          <h3 className="text-h3 text-text">{t('borrow.incoming.title')}</h3>
          <ul className="m-0 list-none p-0">{data.incoming.map((r) => row(r, true))}</ul>
        </Stack>
      )}
      {data.outgoing.length > 0 && (
        <Stack gap={1}>
          <h3 className="text-h3 text-text">{t('borrow.outgoing.title')}</h3>
          <ul className="m-0 list-none p-0">{data.outgoing.map((r) => row(r, false))}</ul>
        </Stack>
      )}
      {reviewing && (
        <LendDialog
          client={client}
          request={reviewing}
          needsReason={role !== 'STM'}
          onClose={() => setReviewing(null)}
          onDecided={() => {
            setReviewing(null)
            reload()
            onChanged?.()
          }}
        />
      )}
    </Section>
  )
}

function LendDialog({
  client,
  request,
  needsReason,
  onClose,
  onDecided,
}: {
  client: OffersClient
  request: BorrowRequestDto
  needsReason: boolean
  onClose: () => void
  onDecided: () => void
}) {
  const { t, formatNumber } = useI18n()
  const { announce } = useAnnouncer()
  const [candidates, setCandidates] = useState<readonly LendCandidate[] | null>(null)
  const [picked, setPicked] = useState<readonly string[]>([])
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    client.lendCandidates(request.fromStoreId, request.id).then(
      (c) => live && setCandidates(c),
      () => live && setCandidates([]),
    )
    return () => {
      live = false
    }
  }, [client, request])

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < request.count ? [...p, id] : p))

  const decide = async (decision: 'approve' | 'decline') => {
    setError(null)
    setReasonError(null)
    if (decision === 'approve' && needsReason && !reason.trim()) {
      setReasonError(t('borrow.lend.reasonRequired'))
      return
    }
    setBusy(true)
    try {
      await client.decide(
        request.fromStoreId,
        request.id,
        decision === 'approve' ? { decision, staffIds: picked, ...(reason.trim() ? { reason: reason.trim() } : {}) } : { decision, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      )
      announce(t(decision === 'approve' ? 'borrow.lend.approved' : 'borrow.lend.declined'))
      onDecided()
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'validation_failed' ? t('borrow.lend.invalid') : e instanceof ApiError && e.code === 'conflict' ? t('borrow.lend.conflict') : t('borrow.lend.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('borrow.lend.title', { store: request.toStoreName })}</DialogTitle>
          <DialogDescription>{t('borrow.lend.description', { count: request.count })}</DialogDescription>
        </DialogHeader>
        <Stack gap={3}>
          {candidates === null ? (
            <Skeleton className="h-16 w-full" />
          ) : candidates.length === 0 ? (
            <p className="text-body-sm text-text-muted">{t('borrow.lend.none')}</p>
          ) : (
            <fieldset className="m-0 border-0 p-0">
              <legend className="text-body-sm text-text">{t('borrow.lend.pick', { count: request.count })}</legend>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {candidates.map((c) => (
                  <li key={c.staffId}>
                    <label className="flex min-h-tap items-center gap-2 text-body-sm text-text">
                      <input type="checkbox" className="size-5 accent-primary" checked={picked.includes(c.staffId)} onChange={() => toggle(c.staffId)} />
                      {t('borrow.lend.candidate', { code: c.employeeNo, name: c.name, hours: formatNumber(c.weekHours) })}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <Field label={needsReason ? t('borrow.lend.overrideReason') : t('borrow.lend.reason')} hint={needsReason ? t('borrow.lend.overrideHint') : undefined} error={reasonError ?? undefined} required={needsReason}>
            {(aria) => <Textarea {...aria} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
        </Stack>
        <DialogFooter>
          <Button disabled={busy} onClick={() => void decide('decline')}>
            {t('borrow.lend.decline')}
          </Button>
          <Button variant="primary" disabled={busy || picked.length === 0} onClick={() => void decide('approve')}>
            {t('borrow.lend.approve', { count: picked.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
