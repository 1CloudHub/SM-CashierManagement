/**
 * Master data (SCR-052 stores, departments and lanes; SCR-053 staff and
 * availability) and the `/stores`, `/departments`, `/staff` API client. The
 * app router mounts the screens through `./pages`.
 */
export { createMasterDataClient, staffQueryString, type MasterDataClient } from './api'
export { AvailabilityEditor, type AvailabilityEditorProps } from './availability-editor'
export { StaffPage, StoresPage } from './pages'
export { StaffScreen, type StaffScreenProps } from './staff-screen'
export { StoresScreen, type StoresScreenProps } from './stores-screen'
