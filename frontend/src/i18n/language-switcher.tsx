import { useId } from 'react'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useI18n } from './context'
import { LOCALES, LOCALE_LABEL, LOCALE_SHORT, type Locale } from './types'

/**
 * LanguageSwitcher (task 1.8 — req. 23.1, design.md "Language").
 *
 * Switches the UI between English and Filipino and persists the choice (the
 * provider writes it to storage + <html lang>). It appears in two places, so it
 * takes a `variant`:
 *
 *   - "compact" (default) — the top-bar control: short codes (EN / FIL), a
 *     visually-hidden label. Used in the TopBar trailing slot.
 *   - "full" — Profile (SCR-080): a visible label and full endonyms
 *     (English / Filipino).
 *
 * It is a real, labelled <select> (SG-006) so it works with keyboard and
 * screen readers; the accessible name comes from the i18n bundle. On change it
 * calls `setLocale`, which re-renders every consumer of `useI18n()` and
 * re-persists the preference.
 */
export function LanguageSwitcher({
  variant = 'compact',
  className,
}: {
  variant?: 'compact' | 'full'
  className?: string
}) {
  const { locale, setLocale, t } = useI18n()
  const id = useId()
  const label = t('lang.label')
  const compact = variant === 'compact'

  return (
    <div className={cn('inline-flex flex-col gap-1', className)}>
      <label
        htmlFor={id}
        className={cn(compact ? 'sr-only' : 'text-label text-text-muted')}
      >
        {label}
      </label>
      <Select
        id={id}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className={cn(compact && 'w-auto')}
      >
        {LOCALES.map((loc) => (
          <option key={loc} value={loc}>
            {compact ? LOCALE_SHORT[loc] : LOCALE_LABEL[loc]}
          </option>
        ))}
      </Select>
    </div>
  )
}
