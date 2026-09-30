import type { ErrorKind } from './messages'

/**
 * Reference IDs for error/status pages (SCR-090).
 *
 * Server-side failures we cannot explain to the user (400/429/500/503) and the
 * offline state carry a short, non-sensitive reference the user can quote to
 * support. It correlates to a server log entry; it deliberately encodes NOTHING
 * about the user, the object, or the failure internals (no stack traces, no
 * ids of protected resources — req. 2.4 / UX-010).
 *
 * 401/403/404 do not surface a reference by default: they are expected,
 * self-explanatory outcomes (signed out / not permitted / not found) rather
 * than faults, and a reference would only add noise. A caller may still pass an
 * explicit `referenceId` for any kind.
 */
const KINDS_WITH_REFERENCE: ReadonlySet<ErrorKind> = new Set<ErrorKind>([
  '400',
  '429',
  '500',
  '503',
  'offline',
])

export function kindHasReference(kind: ErrorKind): boolean {
  return KINDS_WITH_REFERENCE.has(kind)
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous 0/O/1/I

/**
 * Generate a random support reference, e.g. `LW-7K3P9Q`. Uses the Web Crypto
 * RNG when available (all target browsers) and falls back to Math.random in
 * non-crypto environments (e.g. jsdom without the API). The value is opaque and
 * carries no user or resource data.
 */
export function generateReferenceId(length = 6): string {
  const cryptoObj =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  let out = ''

  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(length)
    cryptoObj.getRandomValues(bytes)
    for (let i = 0; i < length; i++) {
      out += ALPHABET[bytes[i] % ALPHABET.length]
    }
  } else {
    for (let i = 0; i < length; i++) {
      out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
    }
  }

  return `LW-${out}`
}
