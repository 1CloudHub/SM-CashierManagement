import { can } from '@lanewise/shared'
import { useMemo } from 'react'
import { useApi } from '@/api'
import { useActiveRole } from '@/app/active-role'
import { createApiLocationPrivacyClient } from './api-client'
import { HomeAreaSection } from './home-area-section'
import { LocationPrivacyProvider } from './provider'

/**
 * SCR-080's "Home area and shift offers" section over the app's API client.
 * Shown only while the active role may share a home area (RBAC: Staff, own
 * record); the server enforces the same rule (task 8.1).
 */
export function ProfileHomeArea() {
  const api = useApi()
  const { role } = useActiveRole()
  const client = useMemo(() => createApiLocationPrivacyClient(api), [api])
  if (!can(role, 'home_area_consent', 'edit')) return null
  return (
    <LocationPrivacyProvider client={client}>
      <HomeAreaSection />
    </LocationPrivacyProvider>
  )
}
