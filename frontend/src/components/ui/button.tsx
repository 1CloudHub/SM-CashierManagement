import { type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { forwardRef } from 'react'
import { useUiT } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { buttonVariants } from './button-variants'

/**
 * Button (SG-006 component styling, UX-004 labelling).
 *
 * The class recipe lives in `./button-variants`. Accessibility: a button always
 * needs an accessible name — text buttons get it from their children; icon-only
 * buttons (size="icon") MUST pass `aria-label` (dev warning below). The loading
 * state sets `aria-busy`, disables interaction and shows a spinner that stops
 * under reduced motion.
 */
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean
  /** Accessible loading announcement (visually hidden). */
  loadingLabel?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant,
      size,
      loading = false,
      loadingLabel,
      disabled,
      children,
      type = 'button',
      ...props
    },
    ref,
  ) {
    const t = useUiT()
    if (import.meta.env?.DEV && size === 'icon' && !props['aria-label']) {
      // Icon-only buttons must carry an accessible name (UX-004).
      console.warn(
        'Button: icon-only buttons (size="icon") require an aria-label.',
      )
    }

    return (
      <button
        ref={ref}
        type={type}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {loading && (
          <>
            <Loader2
              aria-hidden="true"
              className="size-4 motion-safe:animate-spin"
            />
            <span className="sr-only">{loadingLabel ?? t('ui.button.working')}</span>
          </>
        )}
        {children}
      </button>
    )
  },
)
