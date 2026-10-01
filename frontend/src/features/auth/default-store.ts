/**
 * SCR-080 › Default store. There is no profile-preferences API yet, so the
 * choice is kept per user in this browser's localStorage (like the "Viewing
 * as" role, ../../app/active-role-storage). Storage can be unavailable
 * (private mode, blocked site data): reads then return null and writes are
 * dropped, so the preference is a convenience, never required state.
 */
const KEY_PREFIX = 'lanewise.profile.defaultStore'

function keyFor(userId: string | undefined): string {
  return userId ? `${KEY_PREFIX}.${userId}` : KEY_PREFIX
}

export function readDefaultStore(userId: string | undefined): string | null {
  try {
    return window.localStorage.getItem(keyFor(userId))
  } catch {
    return null
  }
}

export function storeDefaultStore(userId: string | undefined, storeId: string | null): void {
  try {
    if (storeId) window.localStorage.setItem(keyFor(userId), storeId)
    else window.localStorage.removeItem(keyFor(userId))
  } catch {
    // Storage unavailable: keep the in-memory choice only.
  }
}
