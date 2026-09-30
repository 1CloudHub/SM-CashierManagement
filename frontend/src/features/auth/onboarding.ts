import { isRoleCode, type RoleCode } from '@lanewise/shared'

/**
 * SCR-002 step 3 choices: the demo starting role and notification channels.
 *
 * Kept on this device until the role switcher (task 8) and notification
 * preferences (task 20) persist them per user on the server; those tasks read
 * them once as the initial values. Nothing here grants access — the server
 * authorises every request against the active role (P12).
 */
export interface OnboardingChoices {
  readonly startRole: RoleCode
  readonly notifyInApp: boolean
  readonly notifyEmail: boolean
}

const STORAGE_KEY = 'lw.onboarding'

export function saveOnboardingChoices(choices: OnboardingChoices): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choices))
  } catch {
    // Non-fatal: defaults apply.
  }
}

export function readOnboardingChoices(): OnboardingChoices | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Record<string, unknown>
    if (!isRoleCode(v.startRole)) return null
    return {
      startRole: v.startRole,
      notifyInApp: v.notifyInApp !== false,
      notifyEmail: v.notifyEmail !== false,
    }
  } catch {
    return null
  }
}
