import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useActiveRole } from '@/app/active-role'
import { createApiClient, type ApiAdapter, type ApiClient } from './client'

/**
 * Provides the API client to screens. The adapter is chosen once at the app
 * root (mock vs fetch); the client reads the active role at request time, so
 * a role switch applies to every subsequent request (requirement 3.2).
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
  const { getRole } = useActiveRole()
  const client = useMemo(
    () => createApiClient({ adapter, getActiveRole: getRole, getAuthToken }),
    [adapter, getRole, getAuthToken],
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
