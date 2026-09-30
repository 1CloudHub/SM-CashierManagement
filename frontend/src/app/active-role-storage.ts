import { isRoleCode, type RoleCode } from '@lanewise/shared'

/** Per-user persistence of the demo "Viewing as" role (requirement 3). */
export const ACTIVE_ROLE_STORAGE_KEY = 'lw.activeRole'
export const DEFAULT_DEMO_ROLE: RoleCode = 'PLN'

export function activeRoleStorageKey(userId?: string): string {
  return userId ? `${ACTIVE_ROLE_STORAGE_KEY}.${userId}` : ACTIVE_ROLE_STORAGE_KEY
}

export function readStoredRole(userId?: string): RoleCode | null {
  try {
    const v = window.localStorage.getItem(activeRoleStorageKey(userId))
    return isRoleCode(v) ? v : null
  } catch {
    return null
  }
}

export function storeRole(role: RoleCode, userId?: string): void {
  try {
    window.localStorage.setItem(activeRoleStorageKey(userId), role)
  } catch {
    // Non-fatal: the choice still applies in this tab.
  }
}
