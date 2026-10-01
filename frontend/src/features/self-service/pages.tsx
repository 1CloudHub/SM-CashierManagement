import { useMemo } from 'react'
import { instantToLocal } from '@lanewise/shared'
import { useApi } from '@/api'
import { AppLayout } from '@/app/app-layout'
import { useScreenCrumbs } from '@/app/screen-crumbs'
import { SCREEN_BY_ID } from '@/app/screens'
import { Stack } from '@/components/layout'
import { createOffersClient } from '@/features/offers'
import { useI18n } from '@/i18n'
import { createSelfServiceClient } from './api'
import { MyRosterScreen } from './my-roster-screen'

const SCR_025 = SCREEN_BY_ID['SCR-025']

/**
 * SCR-025 `/my-roster` for Staff (tasks 17 and 18 — requirement 15) in the
 * task 8.2 route table: the cashier's own roster, open-shift offers within
 * their travel limit, and time-off and swap requests. The clients ride on
 * the app's API client, so every request carries the active role.
 */
export function MyRosterPage() {
  const { t } = useI18n()
  const api = useApi()
  const client = useMemo(() => createSelfServiceClient(api), [api])
  const offers = useMemo(() => createOffersClient(api), [api])
  const crumbs = useScreenCrumbs(SCR_025)
  const today = useMemo(() => instantToLocal(new Date()).date, [])
  return (
    <AppLayout title={t(SCR_025.titleKey)} crumbs={crumbs}>
      <Stack gap={4}>
        <h1 className="text-h1 text-text">{t(SCR_025.titleKey)}</h1>
        <MyRosterScreen client={client} offers={offers} today={today} />
      </Stack>
    </AppLayout>
  )
}
