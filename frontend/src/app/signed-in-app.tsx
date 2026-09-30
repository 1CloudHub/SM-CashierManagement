import { useCallback, useMemo } from 'react'
import { ApiProvider } from '@/api'
import { useAuth } from '@/features/auth/auth-context'
import { AccountMenu } from '@/features/auth/profile-screen'
import { ActiveRoleProvider } from './active-role'
import { ShellSlotsProvider } from './app-layout'
import { AppRoutes } from './app-routes'
import { defaultAdapter } from './api-adapter'

/**
 * Everything behind sign-in (task 8.2): the active role (per user), the API
 * client, the account menu slot and the route table.
 */
export function SignedInApp({ apiBaseUrl }: { apiBaseUrl?: string | null }) {
  const { user, client } = useAuth()
  const adapter = useMemo(() => defaultAdapter(apiBaseUrl), [apiBaseUrl])
  const getAuthToken = useCallback(() => client.idToken(), [client])
  const slots = useMemo(() => ({ account: <AccountMenu /> }), [])

  return (
    <ActiveRoleProvider userId={user?.userId}>
      <ApiProvider adapter={adapter} getAuthToken={getAuthToken}>
        <ShellSlotsProvider value={slots}>
          <AppRoutes />
        </ShellSlotsProvider>
      </ApiProvider>
    </ActiveRoleProvider>
  )
}
