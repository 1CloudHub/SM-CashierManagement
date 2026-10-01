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
 *
 * States use token colours, never opacity: hover on a solid fill steps to its
 * `--lw-*-hover` token; disabled drops to the subtle outline,
 * muted text and a surface-2 (or transparent) fill, keeping pointer events so
 * `cursor-not-allowed` shows.
 */
export const buttonVariants = cva(
  'lw-btn inline-flex items-center justify-center gap-2 border whitespace-nowrap select-none font-weight-semibold rounded-none motion-interactive focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:border-outline-subtle disabled:text-text-muted aria-busy:cursor-progress',
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-on-primary border-primary hover:not-disabled:bg-primary-hover hover:not-disabled:border-primary-hover disabled:bg-surface-2',
        secondary: 'bg-surface text-text border-outline hover:not-disabled:bg-surface-2 disabled:bg-surface-2',
        ghost: 'bg-transparent text-text border-transparent hover:not-disabled:bg-surface-2 disabled:border-transparent',
        danger:
          'bg-danger text-on-danger border-danger hover:not-disabled:bg-danger-hover hover:not-disabled:border-danger-hover disabled:bg-surface-2',
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
