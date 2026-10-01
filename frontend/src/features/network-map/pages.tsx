import { useEffect, useMemo, useState } from 'react'
import { useApi } from '@/api'
import { useActiveRole } from '@/app/active-role'
import { AppLayout } from '@/app/app-layout'
import { API_MOCK } from '@/app/config'
import { useScreenCrumbs } from '@/app/screen-crumbs'
import { SCREEN_BY_ID } from '@/app/screens'
import { useI18n } from '@/i18n'
import { createOffersClient } from '@/features/offers'
import { networkMapApiFromClient } from './api'
import { loadMapConfig, type MapRuntimeConfig } from './map-config'
import { NetworkMapScreen } from './network-map-screen'

/** Amazon Location settings for this deployment (null in mock mode / unconfigured). */
function useMapConfig(): MapRuntimeConfig | null {
  const [config, setConfig] = useState<MapRuntimeConfig | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadMapConfig({ mock: API_MOCK }).then((c) => !cancelled && setConfig(c))
    return () => {
      cancelled = true
    }
  }, [])
  return config
}

/**
 * SCR-026 inside the app shell (task 8.2 route table): the network map API
 * over the shared client (token + active role, P12). The server scopes every
 * response to the active role (P1) either way.
 */
export function NetworkMapPage() {
  const { t } = useI18n()
  const { role } = useActiveRole()
  const client = useApi()
  const api = useMemo(() => networkMapApiFromClient(client), [client])
  const offers = useMemo(() => createOffersClient(client), [client])
  const mapConfig = useMapConfig()
  const screen = SCREEN_BY_ID['SCR-026']
  const crumbs = useScreenCrumbs(screen)
  return (
    <AppLayout title={t(screen.titleKey)} crumbs={crumbs}>
      <NetworkMapScreen api={api} role={role} mapConfig={mapConfig} offers={offers} />
    </AppLayout>
  )
}
