import { useEffect, useState } from 'react'
import type { NetworkMapQuery, ShiftOfferDto, StoreCandidatesResponse } from '@lanewise/shared'
import { useAnnouncer } from '@/components/a11y'
import { Cluster, Section, Stack } from '@/components/layout'
import {
  Alert,
  Button,
  Skeleton,
  StatusPill,
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
import { OfferStatusList, type OffersClient } from '@/features/offers'
import { clock, STATUS_PRESENTATION, statusLabel } from './format'

export type PanelState =
  | { readonly state: 'idle' }
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'ready'; readonly data: StoreCandidatesResponse }

/**
 * Selected store (SCR-026 side panel): its gap, nearby stores with spare
 * cashiers, and ranked eligible candidates (requirement 11.2–11.5). Candidates
 * appear as ID, home store and barangay only (requirement 12.5). Roles that
 * may send offers (task 17 — requirement 13, 14) offer the shift to the
 * selected cashiers (30-minute expiry, first acceptance wins; status listed
 * below) and request cashiers from a nearby store for the lending store
 * manager to approve.
 */
export function StorePanel({
  panel,
  query,
  departmentName,
  offers,
  canSend = false,
}: {
  panel: PanelState
  query: NetworkMapQuery
  departmentName: (key: string) => string
  /** Task 17 offers/borrowing client; without it the actions stay disabled. */
  offers?: OffersClient
  canSend?: boolean
}) {
  const { t, formatDate } = useI18n()
  const { announce } = useAnnouncer()
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [sent, setSent] = useState<readonly ShiftOfferDto[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const ready = panel.state === 'ready' ? panel.data : null
  const storeId = ready?.store.storeId
  const shiftId = ready?.shift?.shiftId

  // Offers already out for the panel's shift.
  useEffect(() => {
    if (!offers || !storeId || !shiftId) return
    let live = true
    offers.storeOffers(storeId, { shiftId }).then(
      (o) => live && setSent(o),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [offers, storeId, shiftId])

  if (panel.state === 'idle') return <p className="text-body text-text-muted">{t('map.panel.none')}</p>
  if (panel.state === 'loading')
    return (
      <Stack gap={2} aria-busy="true">
        <span className="sr-only">{t('map.panel.loading')}</span>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </Stack>
    )
  if (panel.state === 'error') return <Alert tone="danger">{t('map.panel.failed')}</Alert>

  const { store, shift, ranked, excluded, nearbySurplus, excludedWithoutConsent, travelSource } = panel.data
  const look = STATUS_PRESENTATION[store.status]
  const headline =
    store.status === 'gap'
      ? t('map.panel.needs', { count: -store.delta })
      : store.status === 'surplus'
        ? t('map.panel.spare', { count: store.delta })
        : t('map.panel.balanced')
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const offered = new Set(sent.filter((o) => o.status === 'sent' || o.status === 'accepted').map((o) => o.staffId))
  const selected = ranked.filter((c) => picked.has(c.staffId) && !offered.has(c.staffId)).map((c) => c.staffId)
  const selectedCount = selected.length
  const enabled = canSend && offers !== undefined && shift !== null

  const say = (tone: 'success' | 'danger', text: string) => {
    setNotice({ tone, text })
    announce(text)
  }
  const sendOffers = async () => {
    if (!offers || !shift) return
    setBusy(true)
    try {
      setSent(await offers.send(store.storeId, shift.shiftId, { staffIds: selected, mode: query.mode, maxTravelMin: query.maxTravelMin }))
      setPicked(new Set())
      say('success', t('map.panel.offerSent', { count: selected.length }))
    } catch {
      say('danger', t('map.panel.offerFailed'))
    } finally {
      setBusy(false)
    }
  }
  const requestBorrow = async (fromStoreId: string, name: string) => {
    if (!offers || !shift) return
    setBusy(true)
    try {
      await offers.requestBorrow(store.storeId, { fromStoreId, shiftIds: [shift.shiftId] })
      say('success', t('map.panel.borrow.requested', { name }))
    } catch {
      say('danger', t('map.panel.borrow.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack gap={4}>
      <Stack gap={1}>
        <h2 className="text-h3 text-text">{store.name}</h2>
        <Cluster gap={2}>
          <StatusPill tone={look.tone}>{statusLabel(t, store)}</StatusPill>
          <span className="text-body text-text">{headline}</span>
        </Cluster>
        <p className="text-body-sm text-text-muted">{t('map.panel.counts', { needed: store.required, rostered: store.rostered })}</p>
        <p className="text-body-sm text-text">
          {shift
            ? t('map.panel.shift', {
                date: formatDate(`${shift.date}T00:00:00+08:00`, { weekday: 'short', month: 'short', day: 'numeric' }),
                start: clock(shift.startHour),
                end: clock(shift.endHour),
                department: departmentName(shift.departmentKey),
              })
            : t('map.panel.noShift')}
        </p>
      </Stack>

      {travelSource === 'straight_line' && <Alert tone="warning">{t('map.travel.straightLine')}</Alert>}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {shift && (
        <Section title={t('map.panel.borrow.title')} titleAs="h3">
          {nearbySurplus.length === 0 ? (
            <p className="text-body-sm text-text-muted">{t('map.panel.borrow.none')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {nearbySurplus.map((s) => (
                <li key={s.storeId}>
                  <Cluster gap={2} justify="between">
                    <span className="text-body-sm text-text">{t('map.panel.borrow.row', { name: s.name, surplus: s.surplus, minutes: s.travelMin })}</span>
                    <Button size="sm" disabled={!enabled || busy} onClick={() => void requestBorrow(s.storeId, s.name)}>
                      {t('map.panel.borrow.request', { count: 1 })}
                    </Button>
                  </Cluster>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {shift && (
        <Section title={t('map.panel.candidates.title', { minutes: query.maxTravelMin })} titleAs="h3">
          <Stack gap={3}>
            <TableWrap>
              <Table aria-label={t('map.panel.candidates.tableLabel')}>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>{t('map.panel.col.select')}</TableHeaderCell>
                    <TableHeaderCell>{t('map.panel.col.cashier')}</TableHeaderCell>
                    <TableHeaderCell className="text-right">{t('map.panel.col.travel')}</TableHeaderCell>
                    <TableHeaderCell>{t('map.panel.col.fit')}</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ranked.length === 0 && <TableEmpty colSpan={4}>{t('map.panel.none.eligible')}</TableEmpty>}
                  {ranked.map((c) => (
                    <TableRow key={c.staffId}>
                      <TableCell>
                        <input
                          type="checkbox"
                          className="size-5 accent-primary"
                          checked={picked.has(c.staffId) || offered.has(c.staffId)}
                          disabled={offered.has(c.staffId)}
                          onChange={() => toggle(c.staffId)}
                          aria-label={t('map.panel.selectCandidate', { id: c.displayId })}
                        />
                      </TableCell>
                      <TableRowHeader>
                        <span className="block">{t('map.panel.cashier', { id: c.displayId, store: c.homeStoreName })}</span>
                        <span className="block text-caption text-text-muted">{t('map.panel.area', c.homeArea)}</span>
                      </TableRowHeader>
                      <TableCell className="text-right">
                        <span className="block">{t('map.panel.travel', { minutes: c.travelMin })}</span>
                        {c.ringBand !== null && <span className="block text-caption text-text-muted">{t('map.panel.ring', { band: c.ringBand })}</span>}
                      </TableCell>
                      <TableCell>
                        <Stack gap={1}>
                          <StatusPill tone="success">{t('map.panel.hours', { hours: c.weeklyHours.withShift, limit: c.weeklyHours.limit })}</StatusPill>
                          {c.flags
                            .filter((f) => f === 'SIXTH_CONSECUTIVE_DAY')
                            .map((f) => (
                              <StatusPill key={f} tone="warning">
                                {t(`map.panel.flag.${f}`)}
                              </StatusPill>
                            ))}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
            {excludedWithoutConsent > 0 && <p className="text-body-sm text-text-muted">{t('map.panel.withoutConsent', { count: excludedWithoutConsent })}</p>}
            <Button variant="primary" disabled={!enabled || busy || selectedCount === 0} onClick={() => void sendOffers()}>
              {t('map.panel.offer', { count: selectedCount })}
            </Button>
            <p className="text-caption text-text-muted">{t('map.panel.offerNote')}</p>
            <OfferStatusList offers={sent} label={t('map.panel.offersLabel')} />
          </Stack>
        </Section>
      )}

      {shift && excluded.length > 0 && (
        <Section title={t('map.panel.nearMiss.title')} titleAs="h3">
          <TableWrap>
            <Table aria-label={t('map.panel.nearMiss.tableLabel')}>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t('map.panel.col.cashier')}</TableHeaderCell>
                  <TableHeaderCell className="text-right">{t('map.panel.col.travel')}</TableHeaderCell>
                  <TableHeaderCell>{t('map.panel.col.reason')}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {excluded.map((c) => (
                  <TableRow key={c.staffId}>
                    <TableRowHeader>
                      <span className="block">{t('map.panel.cashier', { id: c.displayId, store: c.homeStoreName })}</span>
                      <span className="block text-caption text-text-muted">{t('map.panel.area', c.homeArea)}</span>
                    </TableRowHeader>
                    <TableCell className="text-right">{c.travelMin === null ? '—' : t('map.panel.travel', { minutes: c.travelMin })}</TableCell>
                    <TableCell>
                      <Stack gap={1}>
                        {c.reasons.map((r) => (
                          <StatusPill key={r} tone="warning">
                            {t(`map.reason.${r}`)}
                          </StatusPill>
                        ))}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        </Section>
      )}
    </Stack>
  )
}
