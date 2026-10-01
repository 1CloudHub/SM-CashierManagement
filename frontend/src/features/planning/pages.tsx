import { useMemo } from 'react'
import { encodeViewState } from '@lanewise/shared'
import { useApi } from '@/api'
import { useActiveRole } from '@/app/active-role'
import { AppLayout } from '@/app/app-layout'
import { useRouter } from '@/app/router'
import { useScreenCrumbs } from '@/app/screen-crumbs'
import { SCREEN_BY_ID, type ScreenId } from '@/app/screens'
import { ContextBar } from '@/features/context/context-bar'
import { useI18n } from '@/i18n'
import { createPlanningClient, type PlanningClient } from './api'
import { DepartmentScreen } from './department-screen'
import { HiringScreen } from './hiring-screen'
import { viewStateOf } from './logic'
import { NetworkScreen } from './network-screen'
import { SummaryScreen } from './summary-screen'

/**
 * Route pages for the task 8.2 route table: SCR-020 `/plan/network`,
 * SCR-021 `/plan/department`, SCR-023 `/plan/hiring` (each with the task 20
 * planning context bar, whose URL state they read) and SCR-024
 * `/plan/summary?scenario=`. The client rides on the app's API client, so
 * every request carries the active role.
 */
function usePlanningClient(): PlanningClient {
  const api = useApi()
  return useMemo(() => createPlanningClient(api), [api])
}

function usePage(id: ScreenId) {
  const { t } = useI18n()
  const screen = SCREEN_BY_ID[id]
  return { title: t(screen.titleKey), crumbs: useScreenCrumbs(screen) }
}

export function NetworkPage() {
  const client = usePlanningClient()
  const { role } = useActiveRole()
  const { location, navigate } = useRouter()
  const { title, crumbs } = usePage('SCR-020')
  const state = useMemo(() => viewStateOf(location.search), [location.search])
  return (
    <AppLayout title={title} crumbs={crumbs} contextBar={<ContextBar screen="SCR-020" />}>
      <NetworkScreen
        client={client}
        role={role}
        state={state}
        onSortChange={(sort) => {
          const q = encodeViewState({ ...state, sort: sort === 'store' ? undefined : sort })
          navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true })
        }}
      />
    </AppLayout>
  )
}

export function DepartmentPage() {
  const client = usePlanningClient()
  const { role } = useActiveRole()
  const { location } = useRouter()
  const { title, crumbs } = usePage('SCR-021')
  const state = useMemo(() => viewStateOf(location.search), [location.search])
  return (
    <AppLayout title={title} crumbs={crumbs} contextBar={<ContextBar screen="SCR-021" />}>
      <DepartmentScreen client={client} role={role} state={state} />
    </AppLayout>
  )
}

export function HiringPage() {
  const client = usePlanningClient()
  const { role } = useActiveRole()
  const { location } = useRouter()
  const { title, crumbs } = usePage('SCR-023')
  const state = useMemo(() => viewStateOf(location.search), [location.search])
  return (
    <AppLayout title={title} crumbs={crumbs} contextBar={<ContextBar screen="SCR-023" />}>
      <HiringScreen client={client} role={role} state={state} />
    </AppLayout>
  )
}

export function SummaryPage() {
  const client = usePlanningClient()
  const { role } = useActiveRole()
  const { location } = useRouter()
  const { title, crumbs } = usePage('SCR-024')
  const state = useMemo(() => viewStateOf(location.search), [location.search])
  return (
    <AppLayout title={title} crumbs={crumbs}>
      <SummaryScreen client={client} role={role} state={state} />
    </AppLayout>
  )
}
