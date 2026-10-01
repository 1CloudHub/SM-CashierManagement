import type { ReactNode } from 'react'
import type { LocationPrivacyClient } from './api-client'
import { LocationPrivacyClientContext } from './client-context'

/** Supplies the location-privacy API client to the feature's components. */
export function LocationPrivacyProvider({ client, children }: { client: LocationPrivacyClient; children: ReactNode }) {
  return <LocationPrivacyClientContext.Provider value={client}>{children}</LocationPrivacyClientContext.Provider>
}
