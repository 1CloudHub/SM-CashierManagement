import { cva } from 'class-variance-authority'

/**
 * Button variants (SG-006). Kept in its own module so button.tsx exports only
 * the component (React Fast Refresh stays happy) while screens and related
 * components (e.g. anchor-as-button) can still reuse the class recipe.
 *
 * Design language: square corners, no shadow, 2px outline. SOLID fill is
 * reserved for the single primary action on a screen; everything else is
 * outline or ghost. `danger` is for destructive confirms. Accent red is
 * emphasis only and never a status, so it is not a button tone. Every size
 * keeps a ≥44px touch target (`min-h-tap`); `sm` only reduces padding/text.
 */
export const buttonVariants = cva(
  'lw-btn inline-flex items-center justify-center gap-2 border-2 whitespace-nowrap select-none font-weight-semibold rounded-none motion-interactive focus-visible:outline-focus-ring disabled:opacity-50 disabled:pointer-events-none aria-busy:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary border-primary hover:opacity-90',
        secondary: 'bg-surface text-text border-outline hover:bg-surface-2',
        ghost: 'bg-transparent text-text border-transparent hover:bg-surface-2',
        danger: 'bg-danger text-on-danger border-danger hover:opacity-90',
      },
      size: {
        md: 'min-h-tap px-4 text-body',
        sm: 'min-h-tap px-3 text-body-sm',
        icon: 'min-h-tap min-w-tap size-tap p-0',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
)
