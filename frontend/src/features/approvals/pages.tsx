import { useMemo } from 'react'
import { useApi } from '@/api'
import { useActiveRole } from '@/app/active-role'
import { AppLayout } from '@/app/app-layout'
import { useRouter } from '@/app/router'
import { useScreenCrumbs } from '@/app/screen-crumbs'
import { SCREEN_BY_ID } from '@/app/screens'
import { comparePath } from '@/features/scenarios/logic'
import { useI18n } from '@/i18n'
import { createApprovalsClient } from './api'
import { ApprovalsScreen } from './approvals-screen'
import { approvalPath, scenarioFromSearch } from './logic'

/**
 * Route page for the task 8.2 route table: SCR-033 `/approvals` (the queue)
 * and `/approvals?scenario=` (one review). The client rides on the app's API
 * client, so every request carries the active role.
 */
const SCR_033 = SCREEN_BY_ID['SCR-033']
const SCR_024 = SCREEN_BY_ID['SCR-024']

export function ApprovalsPage() {
  const { t } = useI18n()
  const api = useApi()
  const client = useMemo(() => createApprovalsClient(api), [api])
  const { role } = useActiveRole()
  const { location, navigate } = useRouter()
  const crumbs = useScreenCrumbs(SCR_033)
  const scenarioId = scenarioFromSearch(location.search)
  return (
    <AppLayout title={t(SCR_033.titleKey)} crumbs={crumbs}>
      <ApprovalsScreen
        key={scenarioId ?? 'queue'}
        client={client}
        role={role}
        scenarioId={scenarioId}
        onOpen={(id) => navigate(approvalPath(id))}
        summaryHref={(id) => `${SCR_024.path}?scenario=${encodeURIComponent(id)}`}
        compareHref={(a, b) => comparePath(a, b)}
      />
    </AppLayout>
  )
}
