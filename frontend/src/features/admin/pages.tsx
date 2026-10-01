import { useMemo } from 'react'
import { useParams } from 'react-router'
import { useApi } from '@/api'
import { useActiveRole } from '@/app/active-role'
import { AppLayout } from '@/app/app-layout'
import { useRouter } from '@/app/router'
import { useScreenCrumbs } from '@/app/screen-crumbs'
import { SCREEN_BY_ID, type ScreenId } from '@/app/screens'
import { useI18n } from '@/i18n'
import { createAdminClient, queryString, type AdminClient } from './api'
import { AuditScreen } from './audit-screen'
import { USERS_PATH } from './logic'
import { RolesScreen } from './roles-screen'
import { UserEditScreen } from './user-edit-screen'
import { UsersScreen } from './users-screen'

/**
 * Route pages for the task 8.2 route table: SCR-070 `/admin/users`, SCR-071
 * `/admin/users/invite` and `/admin/users/:userId`, SCR-072 `/admin/roles`
 * and SCR-073 `/admin/audit`. The client rides on the app's API client, so
 * every request carries the active role.
 */
function useAdminClient(): AdminClient {
  const api = useApi()
  return useMemo(() => createAdminClient(api), [api])
}

function Page({ screen, children }: { screen: ScreenId; children: React.ReactNode }) {
  const { t } = useI18n()
  const def = SCREEN_BY_ID[screen]
  const crumbs = useScreenCrumbs(def)
  return (
    <AppLayout title={t(def.titleKey)} crumbs={crumbs}>
      {children}
    </AppLayout>
  )
}

export function UsersPage() {
  const { t } = useI18n()
  const client = useAdminClient()
  const { role } = useActiveRole()
  const { location } = useRouter()
  const params = new URLSearchParams(location.search)
  const invited = params.get('invited')
  const saved = params.get('saved')
  const notice = invited ? t('admin.users.invited', { email: invited }) : saved ? t('admin.users.saved', { name: saved }) : null
  return (
    <Page screen="SCR-070">
      <UsersScreen key={location.search} client={client} role={role} notice={notice} />
    </Page>
  )
}

export function UserEditPage() {
  const client = useAdminClient()
  const { role } = useActiveRole()
  const { navigate } = useRouter()
  const { userId } = useParams()
  return (
    <Page screen="SCR-071">
      <UserEditScreen
        key={userId ?? 'invite'}
        client={client}
        role={role}
        userId={userId ?? null}
        onDone={(user, mode) =>
          navigate(`${USERS_PATH}${queryString(mode === 'invite' ? { invited: user.email } : { saved: user.name })}`)
        }
      />
    </Page>
  )
}

export function RolesPage() {
  const { role } = useActiveRole()
  return (
    <Page screen="SCR-072">
      <RolesScreen role={role} />
    </Page>
  )
}

export function AuditPage() {
  const client = useAdminClient()
  const { role } = useActiveRole()
  return (
    <Page screen="SCR-073">
      <AuditScreen client={client} role={role} />
    </Page>
  )
}
