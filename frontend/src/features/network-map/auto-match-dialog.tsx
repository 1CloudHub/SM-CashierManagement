import { useState } from 'react'
import type { AutoMatchResponse, NetworkMapQuery } from '@lanewise/shared'
import { useAnnouncer } from '@/components/a11y'
import { Section, Stack } from '@/components/layout'
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableWrap,
} from '@/components/ui'
import { useI18n } from '@/i18n'
import type { OffersClient } from '@/features/offers'
import { clock } from './format'

export type AutoMatchState =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'ready'; readonly data: AutoMatchResponse }

const offerKey = (o: AutoMatchResponse['offers'][number]) => `offer:${o.shiftId}`
const moveKey = (m: AutoMatchResponse['moves'][number]) => `move:${m.fromStoreId}:${m.toStoreId}:${m.shiftIds.join(',')}`

type SendState = { readonly state: 'idle' } | { readonly state: 'sending' } | { readonly state: 'done'; readonly offers: number; readonly moves: number; readonly failed: number }

/**
 * "Auto-match all gaps" review (requirement 11.7): the network-wide proposal
 * from the API — offers to cashiers and store-to-store moves — with a
 * Remove / Restore toggle per suggestion before sending. Sending (task 17)
 * broadcasts each kept offer (30-minute expiry, first acceptance wins, P17)
 * and sends each kept move as a borrow request for the lending store manager;
 * the server re-checks eligibility (P16), so anything filled meanwhile is
 * reported as not sent.
 */
export function AutoMatchDialog({
  open,
  onOpenChange,
  result,
  offers,
  query,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  result: AutoMatchState
  offers?: OffersClient
  query?: Pick<NetworkMapQuery, 'mode' | 'maxTravelMin'>
}) {
  const { t, formatNumber } = useI18n()
  const { announce } = useAnnouncer()
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set())
  const [send, setSend] = useState<SendState>({ state: 'idle' })

  const toggle = (key: string) =>
    setRemoved((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const close = (next: boolean) => {
    if (!next) {
      setRemoved(new Set())
      setSend({ state: 'idle' })
    }
    onOpenChange(next)
  }

  const data = result.state === 'ready' ? result.data : null
  const keptOffers = data ? data.offers.filter((o) => !removed.has(offerKey(o))).length : 0
  const keptMoves = data ? data.moves.filter((m) => !removed.has(moveKey(m))).length : 0

  const sendAll = async () => {
    if (!data || !offers || !query) return
    setSend({ state: 'sending' })
    const offerCount = data.offers.filter((o) => !removed.has(offerKey(o))).length
    const results = await Promise.allSettled([
      ...data.offers
        .filter((o) => !removed.has(offerKey(o)))
        .map((o) => offers.send(o.storeId, o.shiftId, { staffIds: [o.candidate.staffId], mode: query.mode, maxTravelMin: query.maxTravelMin })),
      ...data.moves
        .filter((m) => !removed.has(moveKey(m)))
        .map((m) => offers.requestBorrow(m.toStoreId, { fromStoreId: m.fromStoreId, shiftIds: m.shiftIds })),
    ])
    const ok = (from: number, to: number) => results.slice(from, to).filter((r) => r.status === 'fulfilled').length
    const sentOffers = ok(0, offerCount)
    const sentMoves = ok(offerCount, results.length)
    const done = { state: 'done' as const, offers: sentOffers, moves: sentMoves, failed: results.length - sentOffers - sentMoves }
    setSend(done)
    announce(
      done.failed === 0
        ? t('map.autoMatch.sent', { offers: done.offers, moves: done.moves })
        : t('map.autoMatch.partial', { sent: done.offers + done.moves, total: results.length, failed: done.failed }),
    )
  }

  const toggleButton = (key: string, item: string) => {
    const isRemoved = removed.has(key)
    return (
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={isRemoved}
        aria-label={t(isRemoved ? 'map.autoMatch.restoreLabel' : 'map.autoMatch.removeLabel', { item })}
        onClick={() => toggle(key)}
      >
        {t(isRemoved ? 'map.autoMatch.restore' : 'map.autoMatch.remove')}
      </Button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('map.autoMatch.title')}</DialogTitle>
          <DialogDescription>{t('map.autoMatch.description')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {result.state === 'loading' && (
            <Stack gap={2} aria-busy="true">
              <span className="sr-only">{t('map.autoMatch.loading')}</span>
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-24 w-full" />
            </Stack>
          )}
          {result.state === 'error' && <Alert tone="danger">{t('map.autoMatch.failed')}</Alert>}
          {data && (
            <Stack gap={4}>
              {data.summary.openShifts === 0 ? (
                <p className="text-body text-text">{t('map.autoMatch.nothing')}</p>
              ) : (
                <p className="text-body text-text">
                  {t('map.autoMatch.summary', {
                    offers: data.summary.offers,
                    moves: data.summary.moves,
                    stores: data.summary.storesInvolved,
                    covered: data.summary.covered,
                    open: data.summary.openShifts,
                    average: formatNumber(data.summary.averageTravelMin, { maximumFractionDigits: 1 }),
                  })}
                </p>
              )}
              {data.travelSource === 'straight_line' && <Alert tone="warning">{t('map.travel.straightLine')}</Alert>}
              {data.summary.excludedWithoutConsent > 0 && (
                <p className="text-body-sm text-text-muted">{t('map.autoMatch.withoutConsent', { count: data.summary.excludedWithoutConsent })}</p>
              )}

              {data.offers.length > 0 && (
                <Section title={t('map.autoMatch.offers.title')} titleAs="h3" bare>
                  <TableWrap>
                    <Table aria-label={t('map.autoMatch.offers.tableLabel')}>
                      <TableHead>
                        <TableRow>
                          <TableHeaderCell>{t('map.autoMatch.col.shift')}</TableHeaderCell>
                          <TableHeaderCell>{t('map.autoMatch.col.cashier')}</TableHeaderCell>
                          <TableHeaderCell className="text-right">{t('map.autoMatch.col.travel')}</TableHeaderCell>
                          <TableHeaderCell>{t('map.autoMatch.col.keep')}</TableHeaderCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {data.offers.map((o) => {
                          const key = offerKey(o)
                          const label = `${o.candidate.displayId} → ${o.storeName}`
                          return (
                            <TableRow key={key} className={removed.has(key) ? 'text-text-muted line-through' : undefined}>
                              <TableRowHeader>{t('map.autoMatch.shift', { store: o.storeName, start: clock(o.startHour), end: clock(o.endHour) })}</TableRowHeader>
                              <TableCell>
                                <span className="block">{t('map.panel.cashier', { id: o.candidate.displayId, store: o.candidate.homeStoreName })}</span>
                                <span className="block text-caption text-text-muted">{t('map.panel.area', o.candidate.homeArea)}</span>
                              </TableCell>
                              <TableCell className="text-right">{t('map.panel.travel', { minutes: o.travelMin })}</TableCell>
                              <TableCell>{toggleButton(key, label)}</TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </TableWrap>
                </Section>
              )}

              {data.moves.length > 0 && (
                <Section title={t('map.autoMatch.moves.title')} titleAs="h3" bare>
                  <TableWrap>
                    <Table aria-label={t('map.autoMatch.moves.tableLabel')}>
                      <TableHead>
                        <TableRow>
                          <TableHeaderCell>{t('map.autoMatch.col.from')}</TableHeaderCell>
                          <TableHeaderCell>{t('map.autoMatch.col.to')}</TableHeaderCell>
                          <TableHeaderCell className="text-right">{t('map.autoMatch.col.count')}</TableHeaderCell>
                          <TableHeaderCell className="text-right">{t('map.autoMatch.col.travel')}</TableHeaderCell>
                          <TableHeaderCell>{t('map.autoMatch.col.keep')}</TableHeaderCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {data.moves.map((m) => {
                          const key = moveKey(m)
                          return (
                            <TableRow key={key} className={removed.has(key) ? 'text-text-muted line-through' : undefined}>
                              <TableRowHeader>{m.fromStoreName}</TableRowHeader>
                              <TableCell>{m.toStoreName}</TableCell>
                              <TableCell className="text-right">{formatNumber(m.count)}</TableCell>
                              <TableCell className="text-right">{t('map.panel.travel', { minutes: m.travelMin })}</TableCell>
                              <TableCell>{toggleButton(key, `${m.fromStoreName} → ${m.toStoreName}`)}</TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </TableWrap>
                </Section>
              )}

              {data.unfilled.length > 0 && (
                <p className="text-body-sm text-text">
                  {t('map.autoMatch.unfilled', { stores: [...new Set(data.unfilled.map((u) => u.storeName))].join(', ') })}
                </p>
              )}
              {send.state === 'done' &&
                (send.failed === 0 ? (
                  <Alert tone="success">{t('map.autoMatch.sent', { offers: send.offers, moves: send.moves })}</Alert>
                ) : (
                  <Alert tone="warning">{t('map.autoMatch.partial', { sent: send.offers + send.moves, total: send.offers + send.moves + send.failed, failed: send.failed })}</Alert>
                ))}
            </Stack>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => close(false)}>{t('map.autoMatch.close')}</Button>
          <Button
            variant="primary"
            disabled={!data || !offers || !query || keptOffers + keptMoves === 0 || send.state !== 'idle'}
            onClick={() => void sendAll()}
          >
            {send.state === 'sending' ? t('map.autoMatch.sending') : t('map.autoMatch.send', { offers: keptOffers, moves: keptMoves })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
