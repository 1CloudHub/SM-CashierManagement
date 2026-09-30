/**
 * The pure translation function (task 1.8).
 *
 * `translate(bundles, locale, id, values?)` resolves a message id against a
 * locale's bundle, falling back to the default locale and finally to the id
 * itself (so a missing key is visible in development rather than blank). Any
 * `{name}` placeholders in the template are replaced from `values`.
 *
 * This is framework-agnostic and side-effect-free so it can be unit tested and
 * reused outside React (e.g. formatting a notification string). The React hook
 * `useI18n().t` in ./context is a thin binding over it.
 */

import { DEFAULT_LOCALE, type Bundle, type Locale, type MessageValues } from './types'

/** Replace `{name}` placeholders in a template with values (numbers coerced). */
function interpolate(template: string, values?: MessageValues): string {
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}

export function translate(
  bundles: Record<Locale, Bundle>,
  locale: Locale,
  id: string,
  values?: MessageValues,
): string {
  const template =
    bundles[locale]?.[id] ?? bundles[DEFAULT_LOCALE]?.[id] ?? id
  return interpolate(template, values)
}
