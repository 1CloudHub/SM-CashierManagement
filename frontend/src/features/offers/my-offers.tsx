import { useCallback, useEffect, useState } from 'react'
import type { MyOfferDto } from '@lanewise/shared'
import { ApiError } from '@/api'
import { useAnnouncer } from '@/components/a11y'
import { Cluster, Section, Stack } from '@/components/layout'
import { Alert, Button, Currency, Skeleton, StateBlock, StatusPill } from '@/components/ui'
import { useI18n } from '@/i18n'
import { useRosterFormat } from '@/features/roster/use-roster-format'
import type { OffersClient } from './api'
import { OFFER_TONE, minutesLeft, useNow } from './offer-time'

/**
 * SCR-025 "Open shift offers near you" (requirement 13, 15.2; wireframe
 * scr-025-my-roster.html): the Staff user's own offers only (P11) — store,
 * department, day and time, travel time, pay plus transport allowance and the
 * minutes left — with Accept / Decline. The first acceptance wins; a late one
 * is told "This shift has just been filled". Answered and expired offers
 * stay listed below with their status.
 */
export function MyOffers({ client }: { client: OffersClient }) {
  const { t } = useI18n()
  const f = useRosterFormat()
  const { announce } = useAnnouncer()
  const now = useNow()
  const [offers, setOffers] = useState<readonly MyOfferDto[] | null>(null)
  const [error, setError] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = useCallback(() => {
    client.myOffers().then(setOffers, () => setError(true))
  }, [client])
  useEffect(reload, [reload])

  const respond = async (offer: MyOfferDto, action: 'accept' | 'decline') => {
    setBusy(offer.id)
    try {
      await (action === 'accept' ? client.accept(offer.id) : client.decline(offer.id))
      const text = t(action === 'accept' ? 'offers.mine.accepted' : 'offers.mine.declined')
      setNotice({ tone: 'success', text })
      announce(text)
    } catch (e) {
      // Say why from the offer's state now: filled by someone else (withdrawn), expired, or a labor rule.
      let text = t('offers.mine.failed')
      if (e instanceof ApiError && e.code === 'conflict') {
        const latest = await client.myOffers().catch(() => null)
        const status = latest?.find((x) => x.id === offer.id)?.status
        text =
          status === 'withdrawn'
            ? t('offers.filled')
            : status === 'expired' || (status === 'sent' && minutesLeft(offer.expiresAt, new Date()) === 0)
              ? t('offers.mine.expired')
              : action === 'accept'
                ? t('offers.mine.laborRule')
                : t('offers.mine.failed')
      }
      setNotice({ tone: 'warning', text })
      announce(text)
    } finally {
      setBusy(null)
      reload()
    }
  }

  if (error) return <StateBlock variant="error" title={t('offers.mine.loadFailed')} />
  if (offers === null) {
    return (
      <Stack gap={2} aria-busy="true">
        <span className="sr-only">{t('offers.mine.loading')}</span>
        <Skeleton className="h-20 w-full" />
      </Stack>
    )
  }
  const open = offers.filter((o) => o.status === 'sent' && minutesLeft(o.expiresAt, now) > 0)
  const past = offers.filter((o) => !open.includes(o))

  return (
    <Section title={t('offers.mine.title')} titleAs="h2">
      {notice && <Alert tone={notice.tone} title={notice.text} />}
      {open.length === 0 ? (
        <p className="text-body text-text-muted">{t('offers.mine.none')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {open.map((o) => (
            <li key={o.id} className="border border-outline bg-surface p-3">
              <Stack gap={2}>
                <p className="text-body text-text">
                  <span className="font-semibold">{o.storeName}</span> · {o.departmentName} · {f.day(o.date)} · {f.range(o.startMin, o.endMin)}
                </p>
                <p className="text-body-sm text-text">
                  {o.travelMin !== null && <>{t('offers.minutes', { minutes: o.travelMin })} · </>}
                  <Currency value={o.pay} /> + <Currency value={o.allowance} /> {t('offers.mine.transport')} ·{' '}
                  {t('offers.mine.expiresIn', { minutes: minutesLeft(o.expiresAt, now) })}
                </p>
                <Cluster gap={2}>
                  <Button disabled={busy !== null} onClick={() => void respond(o, 'decline')} aria-label={t('offers.mine.declineLabel', { store: o.storeName, day: f.day(o.date) })}>
                    {t('offers.mine.decline')}
                  </Button>
                  <Button variant="primary" disabled={busy !== null} onClick={() => void respond(o, 'accept')} aria-label={t('offers.mine.acceptLabel', { store: o.storeName, day: f.day(o.date) })}>
                    {t('offers.mine.accept')}
                  </Button>
                </Cluster>
              </Stack>
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <Stack gap={2}>
          <h3 className="text-h3 text-text">{t('offers.mine.past')}</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-body-sm">
            {past.map((o) => {
              const status = o.status === 'sent' ? 'expired' : o.status
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={OFFER_TONE[status]}>{t(`offers.status.${status}`)}</StatusPill>
                  <span className="text-text">
                    {o.storeName} · {f.day(o.date)} · {f.range(o.startMin, o.endMin)}
                  </span>
                </li>
              )
            })}
          </ul>
        </Stack>
      )}
    </Section>
  )
}
