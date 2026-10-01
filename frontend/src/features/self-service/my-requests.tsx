import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  TIME_OFF_REASONS,
  type CreateStaffRequest,
  type IsoDate,
  type MyStaffRequestDto,
  type SwapOptionsResponse,
  type TimeOffReason,
} from '@lanewise/shared'
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
  Input,
  Select,
  Skeleton,
  StatusPill,
  Textarea,
} from '@/components/ui'
import { useRosterFormat } from '@/features/roster/use-roster-format'
import type { SelfServiceClient } from './api'
import { REQUEST_TONE, requestDetail, shiftLabel } from './text'

/**
 * SCR-025 "Requests" (task 18.2 — requirement 15.3/15.4; wireframe
 * scr-025-my-roster.html): request time off or a swap, and the cashier's own
 * requests with their status (cancel while pending). Requests go to the store
 * manager; the roster does not change until they approve (P19).
 */
export function MyRequests({ client, today, onChanged }: { client: SelfServiceClient; today: IsoDate; onChanged?: () => void }) {
  const f = useRosterFormat()
  const { t } = f
  const { announce } = useAnnouncer()
  const [requests, setRequests] = useState<readonly MyStaffRequestDto[] | null>(null)
  const [error, setError] = useState(false)
  const [dialog, setDialog] = useState<'timeOff' | 'swap' | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = useCallback(() => {
    client.requests().then(setRequests, () => setError(true))
  }, [client])
  useEffect(reload, [reload])

  const done = (text: string) => {
    setNotice({ tone: 'success', text })
    announce(text)
    setDialog(null)
    reload()
    onChanged?.()
  }

  const cancel = async (r: MyStaffRequestDto) => {
    setBusy(r.id)
    try {
      await client.cancel(r.id)
      done(t('selfService.cancelled'))
    } catch {
      const text = t('selfService.cancelFailed')
      setNotice({ tone: 'warning', text })
      announce(text)
      reload()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section
      title={t('selfService.requests.title')}
      titleAs="h2"
      description={t('selfService.requests.note')}
      actions={
        <Cluster gap={2}>
          <Button onClick={() => setDialog('timeOff')}>{t('selfService.timeOff.open')}</Button>
          <Button onClick={() => setDialog('swap')}>{t('selfService.swap.open')}</Button>
        </Cluster>
      }
    >
      {notice && <Alert tone={notice.tone} title={notice.text} />}
      {error ? (
        <Alert tone="danger">{t('selfService.loadFailed')}</Alert>
      ) : requests === null ? (
        <Skeleton className="h-16 w-full" />
      ) : requests.length === 0 ? (
        <p className="text-body-sm text-text-muted">{t('selfService.requests.none')}</p>
      ) : (
        <Stack gap={1}>
          <h3 className="text-h3 text-text">{t('selfService.requests.mine')}</h3>
          <ul className="m-0 list-none p-0">
            {requests.map((r) => (
              <li key={r.id} className="border-b border-outline-subtle py-2">
                <Stack gap={1}>
                  <Cluster gap={2} align="center">
                    <span className="text-body-sm font-weight-semibold text-text">{t(`selfService.type.${r.type}`)}</span>
                    <StatusPill tone={REQUEST_TONE[r.status]}>{t(`selfService.status.${r.status}`)}</StatusPill>
                    {r.status === 'pending' && (
                      <Button size="sm" disabled={busy === r.id} onClick={() => void cancel(r)} aria-label={t('selfService.cancelLabel', { request: requestDetail(f, r) })}>
                        {t('selfService.cancel')}
                      </Button>
                    )}
                  </Cluster>
                  <span className="text-body-sm text-text">{requestDetail(f, r)}</span>
                  {r.note && <span className="text-caption text-text-muted">{t('selfService.note', { note: r.note })}</span>}
                  {r.decisionNote && <span className="text-caption text-text-muted">{t('selfService.decisionNote', { note: r.decisionNote })}</span>}
                </Stack>
              </li>
            ))}
          </ul>
        </Stack>
      )}
      {dialog === 'timeOff' && <TimeOffDialog client={client} today={today} onClose={() => setDialog(null)} onSent={() => done(t('selfService.sent'))} />}
      {dialog === 'swap' && <SwapDialog client={client} onClose={() => setDialog(null)} onSent={() => done(t('selfService.sent'))} />}
    </Section>
  )
}

/** Field errors from a 422 (`body.<field>`), keyed by field. */
function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || e.code !== 'validation_failed') return {}
  const out: Record<string, string> = {}
  for (const d of e.details ?? []) {
    const key = d.path.replace(/^body\./, '')
    out[key] ??= d.message
  }
  return out
}

function useSubmit(onSent: () => void) {
  const { t } = useRosterFormat()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const submit = async (send: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    setFields({})
    try {
      await send()
      onSent()
    } catch (e) {
      const f = fieldErrors(e)
      setFields(f)
      setError(
        Object.keys(f).length > 0
          ? t('selfService.invalid')
          : e instanceof ApiError && e.code === 'conflict'
            ? t('selfService.conflict')
            : t('selfService.failed'),
      )
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, fields, submit }
}

function TimeOffDialog({ client, today, onClose, onSent }: { client: SelfServiceClient; today: IsoDate; onClose: () => void; onSent: () => void }) {
  const { t } = useRosterFormat()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [reason, setReason] = useState<TimeOffReason | ''>('')
  const [note, setNote] = useState('')
  const { busy, error, fields, submit } = useSubmit(onSent)

  const send = () => {
    const body: CreateStaffRequest = {
      type: 'time_off',
      dateFrom: from,
      dateTo: to,
      ...(reason ? { reason } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }
    void submit(() => client.raise(body))
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('selfService.timeOff.title')}</DialogTitle>
          <DialogDescription>{t('selfService.requests.note')}</DialogDescription>
        </DialogHeader>
        <Stack gap={3}>
          <Cluster gap={3}>
            <Field label={t('selfService.timeOff.from')} error={fields.dateFrom} required>
              {(aria) => <Input {...aria} type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} />}
            </Field>
            <Field label={t('selfService.timeOff.to')} error={fields.dateTo} required>
              {(aria) => <Input {...aria} type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />}
            </Field>
          </Cluster>
          <Field label={t('selfService.timeOff.reason')} error={fields.reason}>
            {(aria) => (
              <Select {...aria} value={reason} onChange={(e) => setReason(e.target.value as TimeOffReason | '')}>
                <option value="">{t('selfService.reason.none')}</option>
                {TIME_OFF_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`selfService.reason.${r}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('selfService.noteLabel')} error={fields.note}>
            {(aria) => <Textarea {...aria} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
        </Stack>
        <DialogFooter>
          <Button onClick={onClose}>{t('selfService.close')}</Button>
          <Button variant="primary" disabled={busy || !from || !to} onClick={send}>
            {t('selfService.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SwapDialog({ client, onClose, onSent }: { client: SelfServiceClient; onClose: () => void; onSent: () => void }) {
  const f = useRosterFormat()
  const { t } = f
  const [options, setOptions] = useState<SwapOptionsResponse | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [give, setGive] = useState('')
  const [take, setTake] = useState('')
  const [note, setNote] = useState('')
  const { busy, error, fields, submit } = useSubmit(onSent)

  useEffect(() => {
    let live = true
    client.swapOptions().then(
      (o) => {
        if (!live) return
        setOptions(o)
        setGive(o.mine[0]?.shiftId ?? '')
      },
      () => live && setLoadError(true),
    )
    return () => {
      live = false
    }
  }, [client])

  const offered = options?.mine.find((s) => s.shiftId === give)
  // Swaps stay within one store: only that store's open shifts can be taken.
  const targets = useMemo(() => (options && offered ? options.open.filter((s) => s.storeId === offered.storeId) : []), [options, offered])
  // The picked open shift, or the first one at the offered shift's store.
  const target = targets.some((s) => s.shiftId === take) ? take : (targets[0]?.shiftId ?? '')

  const send = () => {
    const body: CreateStaffRequest = { type: 'swap', offeredShiftId: give, targetShiftId: target, ...(note.trim() ? { note: note.trim() } : {}) }
    void submit(() => client.raise(body))
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('selfService.swap.title')}</DialogTitle>
          <DialogDescription>{t('selfService.swap.description')}</DialogDescription>
        </DialogHeader>
        <Stack gap={3}>
          {loadError ? (
            <Alert tone="danger">{t('selfService.loadFailed')}</Alert>
          ) : options === null ? (
            <Skeleton className="h-16 w-full" />
          ) : options.mine.length === 0 ? (
            <p className="text-body-sm text-text-muted">{t('selfService.swap.noShifts')}</p>
          ) : (
            <>
              <Field label={t('selfService.swap.give')} error={fields.offeredShiftId} required>
                {(aria) => (
                  <Select {...aria} value={give} onChange={(e) => setGive(e.target.value)}>
                    {options.mine.map((s) => (
                      <option key={s.shiftId} value={s.shiftId}>
                        {shiftLabel(f, s)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {targets.length === 0 ? (
                <p className="text-body-sm text-text-muted">{t('selfService.swap.noOpen')}</p>
              ) : (
                <Field label={t('selfService.swap.take')} error={fields.targetShiftId} required>
                  {(aria) => (
                    <Select {...aria} value={target} onChange={(e) => setTake(e.target.value)}>
                      {targets.map((s) => (
                        <option key={s.shiftId} value={s.shiftId}>
                          {t('selfService.takeOpen', { shift: `${shiftLabel(f, s)} · ${s.departmentName}` })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              <Field label={t('selfService.noteLabel')} error={fields.note}>
                {(aria) => <Textarea {...aria} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
              </Field>
            </>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
        </Stack>
        <DialogFooter>
          <Button onClick={onClose}>{t('selfService.close')}</Button>
          <Button variant="primary" disabled={busy || !give || !target} onClick={send}>
            {t('selfService.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
