/**
 * Error / status page copy (SCR-090, UX-010, UX-003 microcopy, req. 2 & 24).
 *
 * As of task 1.8 the real i18n framework is in place (`@/i18n`: en/fil bundles,
 * language switcher, locale-aware formatting). Error copy now lives in the
 * shared resource bundles keyed by `error.<kind>.<field>` / `action.*` /
 * `a11y.*`, so it flows through the SAME mechanism as the rest of the UI and
 * stays consistent and translatable.
 *
 * This module keeps its original API — `resolveErrorCopy`,
 * `resolveActionLabels`, `resolveAnnouncements` and the `ErrorKind` /
 * `RecoveryAction` / `Locale` / `ErrorCopy` types — so `error-page.tsx` and the
 * named pages need no change. Each resolver is now a thin projection over the
 * shared bundle via `translate()`.
 *
 * Copy rules honoured in the bundles (see ../../i18n/resources.ts):
 *  - plain language, no jargon, no stack traces or object/attribute details;
 *  - every page names a clear way back to safety (Home / previous safe screen /
 *    sign-in / retry) — no dead ends;
 *  - 403 (no access) reveals NOTHING about the object it protected (req. 2.4).
 */

import { BUNDLES } from '@/i18n/resources'
import { translate } from '@/i18n/translate'
import type { Locale } from '@/i18n/types'

export type { Locale }

/**
 * The request/connection situations SCR-090 covers. `offline` is a
 * client-side connectivity state, the rest map to HTTP status codes.
 */
export type ErrorKind =
  | '400'
  | '401'
  | '403'
  | '404'
  | '429'
  | '500'
  | '503'
  | 'offline'

/** The "way back to safety" a page offers. No page may offer none. */
export type RecoveryAction = 'home' | 'signIn' | 'search' | 'back' | 'retry'

export interface ErrorCopy {
  /** Short status tag shown to the eye, e.g. "404". Never a raw stack. */
  code: string
  /** Plain-language heading. */
  title: string
  /** One or two calm sentences explaining what happened and what to do. */
  description: string
}

/** Labels for the recovery controls, resolved per locale. */
export type RecoveryLabels = Record<RecoveryAction, string>

/** Visually-hidden prefix that announces the page kind to assistive tech. */
export type Announcements = Record<'errorPage' | 'referenceId', string>

/** Recovery action → the shared bundle id that labels it. */
const ACTION_KEY: Record<RecoveryAction, string> = {
  home: 'action.home',
  signIn: 'action.signIn',
  search: 'action.search',
  back: 'action.back',
  retry: 'action.retry',
}

const t = (locale: Locale, id: string) => translate(BUNDLES, locale, id)

/** Resolve the copy for a kind + locale (falls back to English via translate). */
export function resolveErrorCopy(
  kind: ErrorKind,
  locale: Locale = 'en',
): ErrorCopy {
  return {
    code: t(locale, `error.${kind}.code`),
    title: t(locale, `error.${kind}.title`),
    description: t(locale, `error.${kind}.description`),
  }
}

/** Resolve the recovery-control labels for a locale (falls back to English). */
export function resolveActionLabels(locale: Locale = 'en'): RecoveryLabels {
  return {
    home: t(locale, ACTION_KEY.home),
    signIn: t(locale, ACTION_KEY.signIn),
    search: t(locale, ACTION_KEY.search),
    back: t(locale, ACTION_KEY.back),
    retry: t(locale, ACTION_KEY.retry),
  }
}

/** Resolve the assistive-tech announcement strings for a locale. */
export function resolveAnnouncements(locale: Locale = 'en'): Announcements {
  return {
    errorPage: t(locale, 'a11y.errorPage'),
    referenceId: t(locale, 'a11y.referenceId'),
  }
}
