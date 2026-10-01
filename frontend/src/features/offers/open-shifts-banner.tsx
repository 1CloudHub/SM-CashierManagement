import { useCallback, useEffect, useState } from 'react'
import type { ShiftOfferDto } from '@lanewise/shared'
import { Cluster, Stack } from '@/components/layout'
import { Button, StatusPill } from '@/components/ui'
import { useI18n } from '@/i18n'
import { useRosterFormat } from '@/features/roster/use-roster-format'
import type { OffersClient } from './api'
import { OfferDialog, type OfferShift } from './offer-dialog'
import { OfferStatusList } from './offer-status'

/**
 * SCR-022 open-shift banner (wireframe: "⚠ 2 open shifts Sat 1–5 PM [Find
 * cover nearby → SCR-026] [Offer to eligible staff]"; requirement 13): each
 * open shift on the roster with its offers' status, an "Offer to eligible
 * staff" action for roles that may send offers, and a link to the network
 * map to find cover or borrow from a nearby store.
 */
export function OpenShiftsBanner({
  client,
  storeId,
  rosterId,
  openShifts,
  canSend,
  mapHref,
  refreshKey = 0,
}: {
  client: OffersClient
  storeId: string
  rosterId: string
  openShifts: readonly OfferShift[]
  canSend: boolean
  mapHref: string
  refreshKey?: number
}) {
  const { t } = useI18n()
  const f = useRosterFormat()
  const [offers, setOffers] = useState<readonly ShiftOfferDto[]>([])
  const [offering, setOffering] = useState<OfferShift | null>(null)

  const reload = useCallback(() => {
    client.storeOffers(storeId, { rosterId }).then(setOffers, () => setOffers([]))
  }, [client, storeId, rosterId])
  useEffect(reload, [reload, refreshKey])

  if (openShifts.length === 0) return null
  return (
    <section aria-label={t('offers.banner.label')} className="border border-warning bg-surface p-3">
      <Stack gap={2}>
        <Cluster gap={3} align="center">
          <StatusPill tone="warning">{t('offers.banner.count', { count: openShifts.length })}</StatusPill>
          <a href={mapHref} className="text-body-sm text-primary underline">
            {t('offers.banner.findCover')}
          </a>
        </Cluster>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {openShifts.map((s) => {
            const mine = offers.filter((o) => o.shiftId === s.id)
            const label = t('offers.banner.shift', { day: f.day(s.date), time: f.range(s.startMin, s.endMin) })
            return (
              <li key={s.id}>
                <Stack gap={1}>
                  <Cluster gap={2} align="center">
                    <span className="text-body-sm text-text">{label}</span>
                    {canSend && (
                      <Button size="sm" onClick={() => setOffering(s)} aria-label={t('offers.banner.offerLabel', { shift: label })}>
                        {t('offers.banner.offer')}
                      </Button>
                    )}
                  </Cluster>
                  <OfferStatusList offers={mine} label={t('offers.banner.statusLabel', { shift: label })} />
                </Stack>
              </li>
            )
          })}
        </ul>
      </Stack>
      {offering && (
        <OfferDialog
          client={client}
          storeId={storeId}
          shift={offering}
          open
          onOpenChange={(o) => !o && setOffering(null)}
          onSent={() => reload()}
        />
      )}
    </section>
  )
}
