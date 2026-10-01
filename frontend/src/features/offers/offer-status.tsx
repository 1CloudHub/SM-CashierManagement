import type { ShiftOfferDto } from '@lanewise/shared'
import { Currency, StatusPill } from '@/components/ui'
import { useI18n } from '@/i18n'
import { OFFER_TONE, minutesLeft, useNow } from './offer-time'

/**
 * Offer status for one shift (SCR-022 open-shift banner, SCR-026 panel —
 * requirement 13): each offered cashier as ID (the name only once they
 * accept, requirement 12.5) with ✓ accepted · ⏳ sent (minutes left) ·
 * ✕ declined / expired / withdrawn, and the pay when the role may see it.
 */
export function OfferStatusList({ offers, label }: { offers: readonly ShiftOfferDto[]; label: string }) {
  const { t } = useI18n()
  const now = useNow()
  if (offers.length === 0) return null
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-wrap gap-2 p-0">
      {offers.map((o) => {
        const who = o.name ? t('offers.status.named', { id: o.displayId, name: o.name }) : o.displayId
        const status =
          o.status === 'sent' ? t('offers.status.sentLeft', { minutes: minutesLeft(o.expiresAt, now) }) : t(`offers.status.${o.status}`)
        return (
          <li key={o.id}>
            <StatusPill tone={OFFER_TONE[o.status]}>
              <span>
                {who} · {status}
                {o.pay !== undefined && (
                  <>
                    {' · '}
                    <Currency value={o.pay} />
                  </>
                )}
              </span>
            </StatusPill>
          </li>
        )
      })}
    </ul>
  )
}
