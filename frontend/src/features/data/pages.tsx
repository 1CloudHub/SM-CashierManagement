import { useMemo } from 'react'
import { useApi } from '@/api'
import { useActiveRole } from '@/app/active-role'
import { AppLayout } from '@/app/app-layout'
import { useRouter } from '@/app/router'
import { useScreenCrumbs } from '@/app/screen-crumbs'
import { SCREEN_BY_ID } from '@/app/screens'
import { useI18n } from '@/i18n'
import { dataApiFromClient } from './api'
import { datasetFromSearch } from './helpers'
import { DataSourcesScreen } from './data-sources-screen'
import { UploadScreen } from './upload-screen'

/**
 * SCR-050 / SCR-051 inside the app shell (task 8.2 route table): the data API
 * over the shared client (token + active role, P12) and the active role for
 * the Rules-Steward-only controls. The server enforces access either way.
 */
function useDataApi() {
  const client = useApi()
  return useMemo(() => dataApiFromClient(client), [client])
}

export function DataSourcesPage() {
  const { t } = useI18n()
  const { role } = useActiveRole()
  const { navigate } = useRouter()
  const api = useDataApi()
  const screen = SCREEN_BY_ID['SCR-050']
  const crumbs = useScreenCrumbs(screen)
  return (
    <AppLayout title={t(screen.titleKey)} crumbs={crumbs}>
      <DataSourcesScreen api={api} role={role} onUpload={() => navigate(SCREEN_BY_ID['SCR-051'].path)} />
    </AppLayout>
  )
}

export function UploadPage() {
  const { t } = useI18n()
  const { role } = useActiveRole()
  const { navigate, location } = useRouter()
  const initialType = datasetFromSearch(location.search)
  const api = useDataApi()
  const screen = SCREEN_BY_ID['SCR-051']
  const crumbs = useScreenCrumbs(screen)
  return (
    <AppLayout title={t(screen.titleKey)} crumbs={crumbs}>
      <UploadScreen api={api} role={role} initialType={initialType} onDone={() => navigate(SCREEN_BY_ID['SCR-050'].path)} />
    </AppLayout>
  )
}
