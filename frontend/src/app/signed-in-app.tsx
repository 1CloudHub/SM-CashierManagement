import { useCallback, useMemo } from 'react'
import { ApiProvider } from '@/api'
import { useAuth } from '@/features/auth/auth-context'
import { ActiveRoleProvider } from './active-role'
import { ShellSlotsProvider } from './app-layout'
import { AppRoutes } from './app-routes'
import { defaultAdapter } from './api-adapter'

/**
 * Everything behind sign-in (task 8.2): the active role (per user), the API
 * client, the signed-in account for the shell's user menu and the route
 * table.
 */
export function SignedInApp({ apiBaseUrl }: { apiBaseUrl?: string | null }) {
  const { user, client, signOut } = useAuth()
  const adapter = useMemo(() => defaultAdapter(apiBaseUrl), [apiBaseUrl])
  const getAuthToken = useCallback(() => client.idToken(), [client])
  const slots = useMemo(
    () => ({
      account: user
        ? { email: user.email, name: user.name, onSignOut: () => void signOut() }
        : undefined,
    }),
    [user, signOut],
  )

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
