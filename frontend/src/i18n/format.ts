/**
 * Locale-aware formatting (task 1.8 — req. 23.2, SG-002, NFR-L10N-001).
 *
 * All dates, numbers and ₱ amounts are formatted through here so nothing is
 * hardcoded and every locale (en-PH / fil-PH) is handled consistently. The
 * shared Currency/Num component (../components/ui/currency.tsx) renders the
 * strings these functions return with tabular figures via the `--font-num`
 * token.
 *
 * Peso rendering (SG-002): the peso amount is emitted with the Unicode peso
 * sign ₱ (U+20B1) — never a hardcoded "P" or a different glyph. We ask
 * Intl.NumberFormat for the PHP currency and then normalise whatever symbol the
 * platform's CLDR data produces (it may be "₱", "PHP" or "P") to the canonical
 * ₱, so the glyph is stable across platforms. The `--font-num` stack includes
 * Noto Sans, which carries U+20B1, so the glyph renders even where a device
 * font lacks it.
 */

import { LOCALE_TAG, type Locale } from './types'

/** The canonical Unicode peso sign (U+20B1). Never hardcode this elsewhere. */
export const PESO_SIGN = '\u20B1'

/**
 * Normalise whatever currency symbol a platform's CLDR produced for PHP to the
 * canonical ₱. Some platforms render "PHP" or a bare "P"; we standardise so
 * columns align and the glyph is predictable.
 */
function normalisePeso(formatted: string): string {
  return formatted.replace(/PHP\s?|(?<![A-Za-z])P(?=[\d\s.,])/u, PESO_SIGN)
}

/**
 * Format a ₱ amount for display. Two fraction digits by default (centavos);
 * pass `maximumFractionDigits: 0` for whole-peso figures. The returned string
 * always starts with the ₱ sign (U+20B1).
 *
 *   formatCurrency(13600000, 'en')            → "₱13,600,000.00"
 *   formatCurrency(13.6e6, 'en', { maximumFractionDigits: 0 }) → "₱13,600,000"
 */
export function formatCurrency(
  amount: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  const formatter = new Intl.NumberFormat(LOCALE_TAG[locale], {
    style: 'currency',
    currency: 'PHP',
    currencyDisplay: 'symbol',
    ...options,
  })
  return normalisePeso(formatter.format(amount))
}

/**
 * Format a ₱ amount compactly for KPIs and dense tables (e.g. "₱13.6M").
 * Compact notation still routes through the peso normaliser.
 */
export function formatCurrencyCompact(
  amount: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  return formatCurrency(amount, locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
    ...options,
  })
}

/** Format a plain number for the locale (grouping separators, etc.). */
export function formatNumber(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale], options).format(value)
}

/** Format a percentage. `value` is a ratio (0.9 → "90%"). */
export function formatPercent(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    style: 'percent',
    maximumFractionDigits: 0,
    ...options,
  }).format(value)
}

/**
 * Format a date for the locale. Defaults to a medium date ("Dec 19, 2026").
 * Accepts a Date or an ISO string / epoch ms.
 */
export function formatDate(
  value: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], options).format(date)
}

/** Format a time of day (defaults to short, e.g. "9:00 AM"). */
export function formatTime(
  value: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { timeStyle: 'short' },
): string {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], options).format(date)
}

/** Format a date + time together (medium date, short time). */
export function formatDateTime(
  value: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
  },
): string {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], options).format(date)
}
