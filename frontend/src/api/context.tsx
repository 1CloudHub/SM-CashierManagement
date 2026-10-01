import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useActiveRole } from '@/app/active-role'
import { createApiClient, type ApiAdapter, type ApiClient } from './client'

/**
 * Provides the API client to screens. The adapter is chosen once at the app
 * root (mock vs fetch); the client reads the active role at request time, so
 * a role switch applies to every subsequent request (requirement 3.2). The
 * client is also re-created on a role switch, so screens whose loaders
 * depend on it refetch for the new role instead of keeping the previous
 * role's rows on screen (P1, P12).
 */
const ApiContext = createContext<ApiClient | null>(null)

export function ApiProvider({
  adapter,
  getAuthToken,
  children,
}: {
  adapter: ApiAdapter
  getAuthToken?: () => Promise<string | null>
  children: ReactNode
}) {
  const { role, getRole } = useActiveRole()
  const client = useMemo(
    // `role` is a dependency on purpose: a new client identity makes every
    // screen that loads through it refetch after a role switch.
    () => createApiClient({ adapter, getActiveRole: getRole, getAuthToken }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapter, getRole, getAuthToken, role],
  )
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>
}

export function useApi(): ApiClient {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error('useApi must be used within an ApiProvider')
  return ctx
}

/** The API client, or `null` outside an ApiProvider (for optional shell widgets). */
export function useOptionalApi(): ApiClient | null {
  return useContext(ApiContext)
}
