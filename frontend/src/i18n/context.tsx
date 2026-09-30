import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { BUNDLES } from './resources'
import { translate } from './translate'
import {
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatTime,
} from './format'
import {
  DEFAULT_LOCALE,
  LOCALE_TAG,
  LOCALES,
  type Locale,
  type MessageValues,
} from './types'

/**
 * i18n React context + provider (task 1.8 — req. 23, UX-011, NFR-L10N-001).
 *
 * `I18nProvider` holds the active locale, persists the user's choice, and
 * exposes a bound `t()` plus the locale-aware formatters. Screens and
 * components call `useI18n()` to translate copy and format dates/numbers/₱ —
 * no user-facing string is hardcoded.
 *
 * Persistence (req. 23.1 "persisted per user"): the choice is written to
 * localStorage under a stable key and reflected on <html lang> so assistive
 * tech and the browser pick the right language. When the app has a signed-in
 * user, the server preference (User.language, DOM-002) is the source of truth;
 * pass it as `initialLocale` and remount the provider (via a React `key`) if it
 * changes after sign-in, so the provider seeds cleanly from it.
 */

const STORAGE_KEY = 'lw.locale'

export interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  /** BCP-47 tag for the active locale (e.g. "en-PH"). */
  localeTag: string
  /** Translate a message id, with optional `{name}` interpolation. */
  t: (id: string, values?: MessageValues) => string
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
  formatPercent: (value: number, options?: Intl.NumberFormatOptions) => string
  formatCurrency: (amount: number, options?: Intl.NumberFormatOptions) => string
  formatCurrencyCompact: (
    amount: number,
    options?: Intl.NumberFormatOptions,
  ) => string
  formatDate: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string
  formatTime: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string
  formatDateTime: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** Read the persisted locale (localStorage), falling back to the default. */
function readStoredLocale(): Locale | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isLocale(stored) ? stored : undefined
  } catch {
    // localStorage can throw in private mode / when disabled — ignore.
    return undefined
  }
}

function persistLocale(locale: Locale): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Non-fatal: the choice still applies for this session.
  }
}

export function I18nProvider({
  children,
  /**
   * Force the initial locale (e.g. from the signed-in user's server
   * preference). Seeds state on mount; to adopt a later change, remount the
   * provider with a React `key` so it re-seeds cleanly.
   */
  initialLocale,
}: {
  children: React.ReactNode
  initialLocale?: Locale
}) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initialLocale ?? readStoredLocale() ?? DEFAULT_LOCALE,
  )

  // Keep <html lang> in sync so browsers + assistive tech announce correctly.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = LOCALE_TAG[locale]
    }
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    persistLocale(next)
  }, [])

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      localeTag: LOCALE_TAG[locale],
      t: (id, values) => translate(BUNDLES, locale, id, values),
      formatNumber: (v, options) => formatNumber(v, locale, options),
      formatPercent: (v, options) => formatPercent(v, locale, options),
      formatCurrency: (amount, options) =>
        formatCurrency(amount, locale, options),
      formatCurrencyCompact: (amount, options) =>
        formatCurrencyCompact(amount, locale, options),
      formatDate: (v, options) => formatDate(v, locale, options),
      formatTime: (v, options) => formatTime(v, locale, options),
      formatDateTime: (v, options) => formatDateTime(v, locale, options),
    }),
    [locale, setLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** Access the i18n context. Must be used within an <I18nProvider>. */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return ctx
}

/** Convenience: just the `t()` function for components that only translate. */
export function useT(): I18nContextValue['t'] {
  return useI18n().t
}
