import { useMemo } from 'react'
import { decodeViewState } from '@lanewise/shared'
import { useApi } from '@/api'
import { useActiveRole } from '@/app/active-role'
import { AppLayout } from '@/app/app-layout'
import { useRouter } from '@/app/router'
import { useScreenCrumbs } from '@/app/screen-crumbs'
import { SCREEN_BY_ID } from '@/app/screens'
import { useMediaQuery } from '@/components/layout/use-media-query'
import { ContextBar } from '@/features/context/context-bar'
import { useContextOptions } from '@/features/context/use-context-data'
import { useI18n } from '@/i18n'
import { createOffersClient } from '@/features/offers'
import { createSelfServiceClient } from '@/features/self-service/api'
import { createRosterClient } from './api'
import { RosterScreen } from './roster-screen'

const SCR_022 = SCREEN_BY_ID['SCR-022']

/**
 * SCR-022 `/plan/roster` (task 13.4) in the task 8.2 route table. The store
 * and department come from the planning context bar (task 20, URL state);
 * with no store picked, the first store in the active role's scope is shown
 * (a Store Manager's own store). The client rides on the app's API client,
 * so every request carries the active role.
 */
export function RosterPage() {
  const { t } = useI18n()
  const api = useApi()
  const client = useMemo(() => createRosterClient(api), [api])
  const offers = useMemo(() => createOffersClient(api), [api])
  const selfService = useMemo(() => createSelfServiceClient(api), [api])
  const { role } = useActiveRole()
  const { location } = useRouter()
  const crumbs = useScreenCrumbs(SCR_022)
  const options = useContextOptions()
  const isPhone = useMediaQuery('(max-width: 599px)')
  const view = useMemo(() => decodeViewState(location.search), [location.search])
  const storeId = view.store ?? options.data?.stores[0]?.id ?? null
  return (
    <AppLayout title={t(SCR_022.titleKey)} crumbs={crumbs} contextBar={<ContextBar screen="SCR-022" />}>
      <h1 className="text-h1 text-text">{t(SCR_022.titleKey)}</h1>
      <RosterScreen
        key={storeId ?? ''}
        client={client}
        storeId={storeId}
        departmentId={view.dept ?? null}
        isPhone={isPhone}
        offers={offers}
        selfService={selfService}
        role={role}
      />
    </AppLayout>
  )
}
