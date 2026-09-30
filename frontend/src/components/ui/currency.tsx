import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

/**
 * Currency / Num — the shared numeric renderer (task 1.8 — SG-002, req. 23.2,
 * req. 25).
 *
 * Every ₱ amount and every aligned number in a table, KPI or chart axis is
 * rendered through these so:
 *
 *  - the peso sign is the Unicode ₱ (U+20B1), emitted by the locale formatter
 *    and normalised to the canonical glyph — never a hardcoded "P" or literal
 *    "₱" in copy (SG-002);
 *  - figures use the `--font-num` stack (which includes Noto Sans, carrying
 *    U+20B1) with tabular figures (`font-variant-numeric: tabular-nums`) via
 *    the `lw-numeric` utility, so ₱ renders across Windows/macOS/iOS/Android/
 *    Linux and columns align;
 *  - amounts are formatted for the active locale (en-PH / fil-PH) through the
 *    i18n context — nothing is hardcoded.
 *
 * In right-aligned table columns pass `align="end"`; `<TableCell numeric>`
 * already handles cell alignment, so inside it the default inline rendering is
 * fine. Screen-reader users hear the formatted string as-is (₱ is read as the
 * currency), so no extra label is needed.
 */

type Numeric = 'inline' | 'block'

interface BaseProps {
  /** `inline` renders a <span>; `block` renders a right-alignable element. */
  as?: Numeric
  /** Text alignment for block usage (KPI values, right-aligned columns). */
  align?: 'start' | 'end'
  className?: string
}

export interface CurrencyProps extends BaseProps {
  /** The amount in pesos (may include centavos). */
  value: number
  /** Compact notation for KPIs / dense tables (e.g. ₱13.6M). */
  compact?: boolean
  /** Passed through to Intl.NumberFormat (e.g. maximumFractionDigits: 0). */
  options?: Intl.NumberFormatOptions
}

export interface NumProps extends BaseProps {
  value: number
  /** Render as a percentage (value is a ratio: 0.9 → 90%). */
  percent?: boolean
  options?: Intl.NumberFormatOptions
}

function alignClass(align?: 'start' | 'end') {
  return align === 'end' ? 'text-right tabular-nums' : undefined
}

/** Render a ₱ amount (SG-002). */
export function Currency({
  value,
  compact = false,
  options,
  as = 'inline',
  align,
  className,
}: CurrencyProps) {
  const { formatCurrency, formatCurrencyCompact } = useI18n()
  const text = compact
    ? formatCurrencyCompact(value, options)
    : formatCurrency(value, options)
  const cls = cn('lw-numeric', alignClass(align), className)
  return as === 'block' ? (
    <span className={cn('block', cls)}>{text}</span>
  ) : (
    <span className={cls}>{text}</span>
  )
}

/** Render a locale-formatted number (tabular, aligns in columns). */
export function Num({
  value,
  percent = false,
  options,
  as = 'inline',
  align,
  className,
}: NumProps) {
  const { formatNumber, formatPercent } = useI18n()
  const text = percent
    ? formatPercent(value, options)
    : formatNumber(value, options)
  const cls = cn('lw-numeric', alignClass(align), className)
  return as === 'block' ? (
    <span className={cn('block', cls)}>{text}</span>
  ) : (
    <span className={cls}>{text}</span>
  )
}
