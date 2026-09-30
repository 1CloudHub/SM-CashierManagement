import type { ElementType } from 'react'
import { cn } from '@/lib/utils'
import type { PolymorphicProps } from './polymorphic'

/**
 * Page (design.md "Layout primitives").
 *
 * The content container for a screen: a centred max-width wrapper with the
 * token-driven outer margin (16 / 24 / 32 at mobile / tablet / laptop+, via
 * `lw-page-x`) and one of the two content widths from the grid table —
 * 1280px on laptop, 1600px on desktop. Screens wrap their body in <Page> so
 * the max-width and margins are consistent instead of per-screen CSS.
 *
 * `width` picks the max width:
 *   - "laptop"  → 1280px cap (default; laptop content width, still centred on
 *                 desktop so line lengths stay readable)
 *   - "desktop" → 1600px cap (wide screens: map, network view, dense grids)
 *   - "fluid"   → no cap (full-bleed regions that manage their own width)
 *
 * Renders a <div> by default; pass `as="main"` to make the page the main
 * landmark, or `as="section"` when it nests inside an existing landmark.
 */
const WIDTH_CLASS = {
  laptop: 'max-w-[var(--lw-container-laptop)]',
  desktop: 'max-w-[var(--lw-container-desktop)]',
  fluid: 'max-w-none',
} as const

export interface PageOwnProps {
  /** Content max width from the grid table. Default "laptop" (1280px). */
  width?: keyof typeof WIDTH_CLASS
  /** Drop the token outer margin (for full-bleed content). */
  flush?: boolean
  className?: string
}

export function Page<E extends ElementType = 'div'>({
  as,
  width = 'laptop',
  flush = false,
  className,
  ...props
}: PolymorphicProps<E, PageOwnProps>) {
  const Comp = (as ?? 'div') as ElementType
  return (
    <Comp
      className={cn(
        'mx-auto w-full',
        WIDTH_CLASS[width],
        !flush && 'lw-page-x',
        className,
      )}
      {...props}
    />
  )
}
