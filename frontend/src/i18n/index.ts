/**
 * LaneWise internationalisation (task 1.8 — req. 23, UX-003, UX-011,
 * NFR-L10N-001).
 *
 * The i18n framework: English + Filipino resource bundles, a React provider
 * that holds and persists the active locale, a bound `t()` and locale-aware
 * formatters (dates, numbers, ₱), the language switcher, and the canonical
 * microcopy reference. Every user-facing string, date, number and ₱ amount
 * flows through here — nothing is hardcoded.
 *
 *   - I18nProvider / useI18n / useT   locale state + t() + formatters
 *   - LanguageSwitcher                top-bar (compact) and Profile (full)
 *   - format*                         standalone locale-aware formatters
 *   - translate                       the pure, framework-agnostic resolver
 *   - BUNDLES                         the en/fil resource bundles
 *
 * The peso sign is always the Unicode ₱ (U+20B1), rendered with tabular figures
 * via the shared Currency/Num component (@/components/ui/currency) — see SG-002.
 */
export {
  I18nProvider,
  useI18n,
  useT,
  type I18nContextValue,
} from './context'
export { LanguageSwitcher } from './language-switcher'
export { translate } from './translate'
export { BUNDLES } from './resources'
export {
  PESO_SIGN,
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatTime,
} from './format'
export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABEL,
  LOCALE_SHORT,
  LOCALE_TAG,
  type Bundle,
  type Locale,
  type MessageId,
  type MessageValues,
} from './types'
