/**
 * Return-to-URL after (re-)authentication (requirement 1.8, design 401 row:
 * "returns to the same URL after auth").
 *
 * Only same-origin, path-absolute app URLs are accepted, so a crafted
 * `returnTo` can never become an open redirect (`//evil.io`, `/\evil.io`,
 * `https://evil.io`, `javascript:` …). Auth screens themselves are never a
 * return target.
 */

const STORAGE_KEY = 'lw.auth.returnTo'
const MAX_LENGTH = 2048
const AUTH_PATHS = ['/sign-in', '/first-sign-in']

/** Returns a safe in-app path (`/path?query#hash`) or `null`. */
export function sanitizeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length > MAX_LENGTH) return null
  // Must be path-absolute, and not protocol-relative or a backslash trick.
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null
  // No control characters, whitespace or backslashes (browsers strip
  // tabs/newlines in URLs and treat `\` like `/`).
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c <= 0x20 || c === 0x7f || c === 0x5c) return null
  }
  let url: URL
  try {
    url = new URL(value, 'https://lanewise.invalid')
  } catch {
    return null
  }
  if (url.origin !== 'https://lanewise.invalid') return null
  if (AUTH_PATHS.includes(url.pathname)) return null
  // Dot-segment normalisation can itself produce `//host` (e.g. `/.//evil.io`).
  if (url.pathname.startsWith('//')) return null
  return `${url.pathname}${url.search}${url.hash}`
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** Remembers where to go after sign-in (ignored if unsafe). */
export function rememberReturnTo(value: string): void {
  const safe = sanitizeReturnTo(value)
  if (!safe) return
  try {
    storage()?.setItem(STORAGE_KEY, safe)
  } catch {
    // Non-fatal: the user lands on Home instead.
  }
}

/** Reads and clears the remembered return URL; defaults to Home. */
export function consumeReturnTo(fallback = '/'): string {
  const s = storage()
  try {
    const value = s?.getItem(STORAGE_KEY) ?? null
    s?.removeItem(STORAGE_KEY)
    return sanitizeReturnTo(value) ?? fallback
  } catch {
    return fallback
  }
}
