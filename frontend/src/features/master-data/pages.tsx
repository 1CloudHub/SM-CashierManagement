import { useMemo } from 'react'
import { useApi } from '@/api'
import { useActiveRole } from '@/app/active-role'
import { AppLayout } from '@/app/app-layout'
import { useRouter } from '@/app/router'
import { useScreenCrumbs } from '@/app/screen-crumbs'
import { SCREEN_BY_ID } from '@/app/screens'
import { createApiLocationPrivacyClient } from '@/features/location-privacy'
import { useI18n } from '@/i18n'
import { createMasterDataClient } from './api'
import { StaffScreen } from './staff-screen'
import { StoresScreen } from './stores-screen'

/**
 * Route pages for the task 8.2 route table: SCR-052 `/data/stores` and
 * SCR-053 `/data/staff`. The clients ride on the app's API client, so every
 * request carries the active role; the server enforces the RBAC rows and
 * scope either way.
 */
const SCR_052 = SCREEN_BY_ID['SCR-052']
const SCR_053 = SCREEN_BY_ID['SCR-053']

function useMasterDataClient() {
  const api = useApi()
  return useMemo(() => createMasterDataClient(api), [api])
}

export function StoresPage() {
  const { t } = useI18n()
  const client = useMasterDataClient()
  const { role } = useActiveRole()
  const { navigate } = useRouter()
  const crumbs = useScreenCrumbs(SCR_052)
  return (
    <AppLayout title={t(SCR_052.titleKey)} crumbs={crumbs}>
      <StoresScreen client={client} role={role} onNavigate={navigate} />
    </AppLayout>
  )
}

export function StaffPage() {
  const { t } = useI18n()
  const api = useApi()
  const client = useMasterDataClient()
  const homeAreaClient = useMemo(() => createApiLocationPrivacyClient(api), [api])
  const { role } = useActiveRole()
  const { navigate } = useRouter()
  const crumbs = useScreenCrumbs(SCR_053)
  return (
    <AppLayout title={t(SCR_053.titleKey)} crumbs={crumbs}>
      <StaffScreen client={client} role={role} onNavigate={navigate} homeAreaClient={homeAreaClient} />
    </AppLayout>
  )
}
