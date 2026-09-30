/**
 * Authentication policy shared by the pre-sign-up trigger, the API and the SPA
 * (requirement 1, design.md › Authentication; property P13).
 *
 * The email-domain allowlist is the single source of truth for "who may hold a
 * LaneWise account". It is enforced server-side by the Cognito pre-sign-up
 * trigger (no account can be created outside it) and again by the API on every
 * authenticated request; the SPA uses the same check only to give early
 * feedback on the sign-in page.
 *
 * Matching rules (deliberately strict — security over convenience):
 *  - exactly one `@`, a non-empty dot-atom local part of at most 64 characters;
 *  - the domain must be ASCII letters/digits/dots/hyphens and, compared
 *    case-insensitively, must EQUAL one of the allowed domains. Subdomains
 *    (`it.smretail.com`), suffix tricks (`smretail.com.evil.io`,
 *    `evilsmretail.com`), trailing dots (`smretail.com.`) and look-alike
 *    Unicode (`smretaıl.com`, fullwidth letters) are all rejected;
 *  - no whitespace, quotes, comments, IP literals or other RFC 5322 exotica.
 *    Inputs are not trimmed here: callers normalise user input (trim) before
 *    submitting, and the server rejects anything that still carries padding.
 */

/** The email domains allowed to hold a LaneWise account (Q1). Lower case. */
export const ALLOWED_EMAIL_DOMAINS = ['smretail.com', '1cloudhub.com'] as const;

export type AllowedEmailDomain = (typeof ALLOWED_EMAIL_DOMAINS)[number];

/**
 * Message shown (and returned by the pre-sign-up trigger) when an email is
 * outside the allowlist — requirement 1.1, verbatim.
 */
export const DOMAIN_NOT_ALLOWED_MESSAGE = "This work email domain isn't allowed.";

/** Longest email Cognito / RFC 5321 accept. */
export const MAX_EMAIL_LENGTH = 254;

const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const ASCII_DOMAIN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export interface ParsedEmail {
  /** The local part, as given. */
  readonly local: string;
  /** The domain, lower-cased. */
  readonly domain: string;
}

/**
 * Parses a work email under the strict rules above. Returns `null` for
 * anything that is not a plain `local@domain` address.
 */
export function parseEmail(raw: unknown): ParsedEmail | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > MAX_EMAIL_LENGTH) return null;
  const at = raw.indexOf('@');
  if (at <= 0 || at !== raw.lastIndexOf('@')) return null;
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART.test(local)) return null;
  if (domain.length === 0 || !ASCII_DOMAIN.test(domain)) return null;
  return { local, domain: domain.toLowerCase() };
}

/** The lower-cased domain of a well-formed email, or `null`. */
export function emailDomain(raw: unknown): string | null {
  return parseEmail(raw)?.domain ?? null;
}

/** Whether `domain` (any case) is exactly one of the allowed domains. */
export function isAllowedDomain(domain: unknown): domain is string {
  if (typeof domain !== 'string' || !ASCII_DOMAIN.test(domain)) return false;
  const lower = domain.toLowerCase();
  return (ALLOWED_EMAIL_DOMAINS as readonly string[]).includes(lower);
}

/**
 * Whether `raw` is a well-formed email on the allowlist (P13). This is the
 * check the pre-sign-up trigger and the API enforce.
 */
export function isAllowedEmail(raw: unknown): raw is string {
  const parsed = parseEmail(raw);
  return parsed !== null && isAllowedDomain(parsed.domain);
}

/**
 * Normalises what a person typed into the email field: trims surrounding
 * whitespace and lower-cases the address (the user pool is case-insensitive).
 * The result still has to pass `isAllowedEmail`.
 */
export function normaliseEmailInput(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Session policy (requirement 1.8, Q12). */
export const SESSION_POLICY = {
  /** Sign the user out after this long without activity. */
  idleTimeoutMinutes: 60,
  /** Show the "Stay signed in" warning this long before the idle timeout. */
  idleWarningMinutes: 2,
  /** Cognito ID/access token lifetime — matches the idle timeout. */
  accessTokenMinutes: 60,
  /**
   * Cognito refresh token lifetime: an absolute cap on a session (one working
   * day). Idle sign-out happens well before this via the SPA idle timer, which
   * also revokes the refresh token.
   */
  refreshTokenHours: 12,
} as const;
