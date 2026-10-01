import { createContext, useContext } from 'react'
import type { LocationPrivacyClient } from './api-client'

export const LocationPrivacyClientContext = createContext<LocationPrivacyClient | null>(null)

export function useLocationPrivacyClient(): LocationPrivacyClient {
  const client = useContext(LocationPrivacyClientContext)
  if (!client) throw new Error('useLocationPrivacyClient must be used within a LocationPrivacyProvider')
  return client
}
