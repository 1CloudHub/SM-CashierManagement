/**
 * Idle-timeout policy (requirement 1.8, Q12): sign out after 60 minutes
 * without activity, warning 2 minutes before.
 *
 * Pure functions over timestamps so the policy is unit/property-testable; the
 * React hook (./use-idle-timeout) wires them to timers and DOM events. The
 * last-activity time is shared across tabs through localStorage, so working
 * in one tab keeps the others alive, and a reload after the deadline signs
 * the user out before any protected content renders.
 */
import { SESSION_POLICY } from '@lanewise/shared'

export interface IdlePolicy {
  readonly timeoutMs: number
  readonly warningMs: number
}

export const DEFAULT_IDLE_POLICY: IdlePolicy = {
  timeoutMs: SESSION_POLICY.idleTimeoutMinutes * 60_000,
  warningMs: SESSION_POLICY.idleWarningMinutes * 60_000,
}

export type IdlePhase = 'active' | 'warning' | 'expired'

/** The phase of a session whose last activity was at `lastActivity`. */
export function idlePhase(now: number, lastActivity: number, policy: IdlePolicy = DEFAULT_IDLE_POLICY): IdlePhase {
  const idle = Math.max(0, now - lastActivity)
  if (idle >= policy.timeoutMs) return 'expired'
  if (idle >= policy.timeoutMs - policy.warningMs) return 'warning'
  return 'active'
}

/** Milliseconds left until sign-out (never negative). */
export function msUntilTimeout(now: number, lastActivity: number, policy: IdlePolicy = DEFAULT_IDLE_POLICY): number {
  return Math.max(0, lastActivity + policy.timeoutMs - now)
}

/**
 * Milliseconds until the next phase boundary (warning or timeout) — how long
 * the hook can sleep before it must re-evaluate.
 */
export function msUntilNextPhase(now: number, lastActivity: number, policy: IdlePolicy = DEFAULT_IDLE_POLICY): number {
  const warnAt = lastActivity + policy.timeoutMs - policy.warningMs
  const expireAt = lastActivity + policy.timeoutMs
  if (now < warnAt) return warnAt - now
  return Math.max(0, expireAt - now)
}

/** `m:ss` for the warning countdown. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const STORAGE_KEY = 'lw.session.lastActivity'

/** Persisted last activity (ms since epoch), or `null` when unknown. */
export function readLastActivity(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const n = raw === null ? NaN : Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function writeLastActivity(at: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(at))
  } catch {
    // Non-fatal: the in-memory timer still applies to this tab.
  }
}

export function clearLastActivity(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export const LAST_ACTIVITY_STORAGE_KEY = STORAGE_KEY
