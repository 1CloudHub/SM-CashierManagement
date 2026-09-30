/**
 * i18n core types (task 1.8 — req. 23, UX-011, NFR-L10N-001).
 *
 * LaneWise ships in English and Filipino. Every user-facing string, date,
 * number and ₱ amount is externalised into a per-locale resource bundle keyed
 * by a stable, dotted message id (see ./resources). Components never hardcode
 * copy — they resolve it through the i18n context (`useI18n` / `t`) or the
 * shared Currency/Num component.
 *
 * A message may take positional/named interpolation values (see `t`); the
 * resource value is a plain string with `{name}` placeholders. Keeping bundles
 * as flat records of strings (not nested objects) makes the id the single
 * source of truth, keeps lookups O(1), and makes it trivial to diff en vs fil
 * for missing keys (see ./resources test).
 */

/** The locales LaneWise supports; matches the language switcher. */
export type Locale = 'en' | 'fil'

/** The default locale used before a preference is known and as a fallback. */
export const DEFAULT_LOCALE: Locale = 'en'

/** All supported locales, ordered as the switcher lists them. */
export const LOCALES: readonly Locale[] = ['en', 'fil'] as const

/** The BCP-47 tag each locale formats against (dates, numbers, ₱). */
export const LOCALE_TAG: Record<Locale, string> = {
  en: 'en-PH',
  fil: 'fil-PH',
}

/** The endonym shown in the language switcher for each locale. */
export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'English',
  fil: 'Filipino',
}

/** The short code shown in the compact switcher (top bar). */
export const LOCALE_SHORT: Record<Locale, string> = {
  en: 'EN',
  fil: 'FIL',
}

/**
 * A resource bundle: a flat map from message id to its localised template.
 * Templates may contain `{name}` placeholders filled by `t(id, values)`.
 * The English bundle is the canonical key set; other locales must cover it.
 */
export type MessageId = string
export type Bundle = Record<MessageId, string>

/** Values interpolated into a message template by name. */
export type MessageValues = Record<string, string | number>
