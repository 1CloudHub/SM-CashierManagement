import type { CostLevel } from '@lanewise/shared'
import { EyeOff } from 'lucide-react'
import { Currency, type CurrencyProps } from '@/components/ui/currency'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { useCanSeeCost } from './use-can-see-cost'

export interface CostValueProps extends Omit<CurrencyProps, 'value'> {
  /** The ₱ amount from the API; absent when the server removed it for this role. */
  value: number | undefined
  /** The level the figure is reported at (network / store / department / individual). */
  level: CostLevel
}

/**
 * CostValue — renders a ₱ figure through the shared `Currency` component when
 * the active role may see cost at `level` and the API sent it; otherwise the
 * "Hidden for your role" state (text + icon, never colour alone), so layouts
 * keep their shape and screen-reader users hear why there is no figure.
 *
 * Use it for every cost figure on every screen (task 21; requirement 25), e.g.
 * `<CostValue value={row.cost} level="store" align="end" />` in a table cell.
 * Where a whole cost column or card makes no sense for a role, hide it with
 * `useCanSeeCost(level)` instead.
 */
export function CostValue({ value, level, as = 'inline', className, ...currency }: CostValueProps) {
  const { t } = useI18n()
  const canSee = useCanSeeCost(level)
  if (canSee && value !== undefined) return <Currency value={value} as={as} className={className} {...currency} />
  return (
    <span
      className={cn(
        as === 'block' ? 'flex' : 'inline-flex',
        'items-center gap-1 text-text-muted',
        currency.align === 'end' && 'justify-end',
        className,
      )}
    >
      <EyeOff aria-hidden="true" className="size-4 shrink-0" />
      <span>{t('cost.hidden')}</span>
    </span>
  )
}
