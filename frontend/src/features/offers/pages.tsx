import { useMemo } from 'react'
import { useApi } from '@/api'
import { AppLayout } from '@/app/app-layout'
import { useScreenCrumbs } from '@/app/screen-crumbs'
import { SCREEN_BY_ID } from '@/app/screens'
import { Stack } from '@/components/layout'
import { useI18n } from '@/i18n'
import { createOffersClient } from './api'
import { MyOffers } from './my-offers'

const SCR_025 = SCREEN_BY_ID['SCR-025']

/**
 * SCR-025 `/my-roster` for Staff (task 17 — requirement 13, 15.2): open-shift
 * offers near the cashier with Accept / Decline. The cashier's own weekly
 * roster, changes and requests on this screen are task 18.
 */
export function MyRosterPage() {
  const { t } = useI18n()
  const api = useApi()
  const client = useMemo(() => createOffersClient(api), [api])
  const crumbs = useScreenCrumbs(SCR_025)
  return (
    <AppLayout title={t(SCR_025.titleKey)} crumbs={crumbs}>
      <Stack gap={4}>
        <h1 className="text-h1 text-text">{t(SCR_025.titleKey)}</h1>
        <MyOffers client={client} />
      </Stack>
    </AppLayout>
  )
}
