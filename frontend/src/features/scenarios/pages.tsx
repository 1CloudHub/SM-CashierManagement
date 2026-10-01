import { useCallback, useMemo } from 'react'
import { useParams } from 'react-router'
import { useApi } from '@/api'
import { useActiveRole } from '@/app/active-role'
import { AppLayout } from '@/app/app-layout'
import { useRouter } from '@/app/router'
import { useScreenCrumbs } from '@/app/screen-crumbs'
import { SCREEN_BY_ID } from '@/app/screens'
import { useI18n } from '@/i18n'
import { createScenariosClient, type ScenariosClient } from './api'
import { comparePath, filtersFromSearch, filtersToSearch, settingsPath } from './logic'
import { ScenarioCompareScreen } from './scenario-compare-screen'
import { ScenarioListScreen } from './scenario-list-screen'
import { ScenarioSettingsScreen } from './scenario-settings-screen'

/**
 * Route pages for the task 8.2 route table: SCR-030 `/scenarios` (filters in
 * the URL), SCR-031 `/scenarios/:scenarioId/settings` and SCR-032
 * `/scenarios/compare?a=&b=`. The client rides on the app's API client, so
 * every request carries the active role.
 */
const SCR_030 = SCREEN_BY_ID['SCR-030']
const SCR_031 = SCREEN_BY_ID['SCR-031']
const SCR_032 = SCREEN_BY_ID['SCR-032']

function useScenariosClient(): ScenariosClient {
  const api = useApi()
  return useMemo(() => createScenariosClient(api), [api])
}

export function ScenarioListPage() {
  const { t } = useI18n()
  const client = useScenariosClient()
  const { role } = useActiveRole()
  const { location, navigate } = useRouter()
  const crumbs = useScreenCrumbs(SCR_030)
  const filters = useMemo(() => filtersFromSearch(location.search), [location.search])
  return (
    <AppLayout title={t(SCR_030.titleKey)} crumbs={crumbs}>
      <ScenarioListScreen
        client={client}
        role={role}
        filters={filters}
        onFiltersChange={(f) => navigate(`${SCR_030.path}${filtersToSearch(f)}`, { replace: true })}
        onNavigate={(path) => navigate(path)}
        onOpen={(id) => navigate(settingsPath(id))}
        onCompare={(id) => navigate(comparePath(id))}
      />
    </AppLayout>
  )
}

export function ScenarioSettingsPage() {
  const { t } = useI18n()
  const client = useScenariosClient()
  const { role } = useActiveRole()
  const { navigate } = useRouter()
  const { scenarioId = '' } = useParams()
  const crumbs = useScreenCrumbs(SCR_031)
  return (
    <AppLayout title={t(SCR_031.titleKey)} crumbs={crumbs}>
      <ScenarioSettingsScreen
        key={scenarioId}
        client={client}
        role={role}
        scenarioId={scenarioId}
        onOpenScenario={(id) => navigate(settingsPath(id))}
      />
    </AppLayout>
  )
}

export function ScenarioComparePage() {
  const { t } = useI18n()
  const client = useScenariosClient()
  const { role } = useActiveRole()
  const { location, navigate } = useRouter()
  const crumbs = useScreenCrumbs(SCR_032)
  const params = new URLSearchParams(location.search)
  const onChange = useCallback((a: string | null, b: string | null) => navigate(comparePath(a, b), { replace: true }), [navigate])
  return (
    <AppLayout title={t(SCR_032.titleKey)} crumbs={crumbs}>
      <ScenarioCompareScreen
        client={client}
        role={role}
        a={params.get('a')}
        b={params.get('b')}
        onChange={onChange}
      />
    </AppLayout>
  )
}
