/**
 * Location privacy and home-area consent (task 15; requirement 12, P15).
 *
 *   - HomeAreaSection      SCR-080 "Home area and shift offers" (consent, barangay, stop sharing)
 *   - StaffHomeAreaPanel   SCR-053 staff record home area (own-store manager / HR)
 *   - BarangayCountTable   SCR-026 home-area layer as a counts-only data table
 *   - ProfileHomeArea      HomeAreaSection wired to the app's API client, for SCR-080
 *   - LocationPrivacyProvider / createApiLocationPrivacyClient   the API port
 *
 * SCR-080 (Profile) renders ProfileHomeArea; the SCR-053 staff record (task
 * 9.1) composes StaffHomeAreaPanel.
 */
export { HomeAreaSection } from './home-area-section'
export { StaffHomeAreaPanel } from './staff-home-area'
export { BarangayCountTable } from './barangay-count-table'
export { LocationPrivacyProvider } from './provider'
export { useLocationPrivacyClient } from './client-context'
export { createApiLocationPrivacyClient, type LocationPrivacyClient } from './api-client'
export { ProfileHomeArea } from './profile-home-area'
