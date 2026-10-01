import { useEffect, useState } from 'react'
import { MAP_MAX_TRAVEL_CHOICES, type IsoDate, type OfferCandidatesResponse, type ShiftOfferDto } from '@lanewise/shared'
import { ApiError } from '@/api'
import { useAnnouncer } from '@/components/a11y'
import { Stack } from '@/components/layout'
import {
  Alert,
  Button,
  Currency,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableWrap,
} from '@/components/ui'
import { useI18n } from '@/i18n'
import { useRosterFormat } from '@/features/roster/use-roster-format'
import type { OffersClient } from './api'

export interface OfferShift {
  readonly id: string
  readonly date: IsoDate
  readonly startMin: number
  readonly endMin: number
}

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: OfferCandidatesResponse }
type Keyed = { readonly key: string; readonly ok: true; readonly data: OfferCandidatesResponse } | { readonly key: string; readonly ok: false }

/**
 * "Offer to eligible staff" (SCR-022 open-shift banner — requirement 13.1,
 * 11.5): the cashiers who may take the open shift — trained, available and
 * within every labor rule with their hours at every store counted (P16) —
 * as ID, home store and barangay only (requirement 12.5), with travel time
 * and the transport allowance by band. Picked cashiers get the offer on
 * their phones; it expires in 30 minutes and the first acceptance wins.
 */
export function OfferDialog({
  client,
  storeId,
  shift,
  open,
  onOpenChange,
  onSent,
}: {
  client: OffersClient
  storeId: string
  shift: OfferShift
  open: boolean
  onOpenChange: (open: boolean) => void
  onSent?: (offers: readonly ShiftOfferDto[]) => void
}) {
  const { t } = useI18n()
  const f = useRosterFormat()
  const { announce } = useAnnouncer()
  const [maxTravelMin, setMaxTravelMin] = useState(30)
  const [result, setResult] = useState<Keyed | null>(null)
  const loadKey = `${shift.id}|${maxTravelMin}`
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    client.candidates(storeId, shift.id, { mode: 'public_transport', maxTravelMin }).then(
      (data) => live && setResult({ key: loadKey, ok: true, data }),
      () => live && setResult({ key: loadKey, ok: false }),
    )
    return () => {
      live = false
    }
  }, [client, storeId, shift.id, maxTravelMin, open, loadKey])
  // Keyed by the request, so "loading" is derived and a stale list never shows for a new limit.
  const load: Load = result === null || result.key !== loadKey ? { state: 'loading' } : result.ok ? { state: 'ready', data: result.data } : { state: 'error' }

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const candidates = load.state === 'ready' ? load.data.candidates : []
  const selected = candidates.filter((c) => picked.has(c.staffId) && !c.offered).map((c) => c.staffId)

  const send = async () => {
    setSending(true)
    setError(null)
    try {
      const offers = await client.send(storeId, shift.id, { staffIds: selected, mode: 'public_transport', maxTravelMin })
      announce(t('offers.dialog.sent', { count: selected.length }))
      setPicked(new Set())
      onSent?.(offers)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'conflict' ? t('offers.filled') : e instanceof ApiError && e.code === 'validation_failed' ? t('offers.dialog.ineligible') : t('offers.dialog.failed'))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('offers.dialog.title')}</DialogTitle>
          <DialogDescription>{t('offers.dialog.description', { day: f.day(shift.date), time: f.range(shift.startMin, shift.endMin) })}</DialogDescription>
        </DialogHeader>
        <Stack gap={3}>
          <Field label={t('offers.dialog.maxTravel')} className="max-w-48">
            {(aria) => (
              <Select {...aria} value={String(maxTravelMin)} onChange={(e) => setMaxTravelMin(Number(e.target.value))}>
                {MAP_MAX_TRAVEL_CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {t('offers.minutes', { minutes: m })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="max-h-[50vh] overflow-y-auto">
            {load.state === 'loading' && (
              <Stack gap={2} aria-busy="true">
                <span className="sr-only">{t('offers.dialog.loading')}</span>
                <Skeleton className="h-24 w-full" />
              </Stack>
            )}
            {load.state === 'error' && <Alert tone="danger">{t('offers.dialog.loadFailed')}</Alert>}
            {load.state === 'ready' && (
              <Stack gap={2}>
                <TableWrap>
                  <Table aria-label={t('offers.dialog.tableLabel')}>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>{t('offers.col.select')}</TableHeaderCell>
                        <TableHeaderCell>{t('offers.col.cashier')}</TableHeaderCell>
                        <TableHeaderCell className="text-right">{t('offers.col.travel')}</TableHeaderCell>
                        <TableHeaderCell className="text-right">{t('offers.col.allowance')}</TableHeaderCell>
                        <TableHeaderCell>{t('offers.col.hours')}</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {candidates.length === 0 && <TableEmpty colSpan={5}>{t('offers.dialog.none')}</TableEmpty>}
                      {candidates.map((c) => (
                        <TableRow key={c.staffId}>
                          <TableCell>
                            <input
                              type="checkbox"
                              className="size-5 accent-primary"
                              checked={c.offered || picked.has(c.staffId)}
                              disabled={c.offered}
                              onChange={() => toggle(c.staffId)}
                              aria-label={t('offers.dialog.select', { id: c.displayId })}
                            />
                          </TableCell>
                          <TableRowHeader>
                            <span className="block">{t('offers.cashier', { id: c.displayId, store: c.homeStoreName })}</span>
                            <span className="block text-caption text-text-muted">
                              {t('offers.area', c.homeArea)}
                              {c.offered && ` · ${t('offers.dialog.alreadyOffered')}`}
                            </span>
                          </TableRowHeader>
                          <TableCell className="text-right">{t('offers.minutes', { minutes: c.travelMin })}</TableCell>
                          <TableCell className="text-right">
                            <Currency value={c.allowance} />
                          </TableCell>
                          <TableCell>{t('offers.hours', { hours: c.weeklyHours.withShift, limit: c.weeklyHours.limit })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrap>
                {load.data.excludedWithoutConsent > 0 && (
                  <p className="text-body-sm text-text-muted">{t('offers.dialog.withoutConsent', { count: load.data.excludedWithoutConsent })}</p>
                )}
                <p className="text-caption text-text-muted">{t('offers.dialog.note')}</p>
              </Stack>
            )}
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
        </Stack>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('offers.cancel')}</Button>
          <Button variant="primary" disabled={selected.length === 0 || sending} onClick={() => void send()}>
            {t('offers.dialog.send', { count: selected.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
