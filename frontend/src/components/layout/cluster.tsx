import type { ElementType } from 'react'
import { cn } from '@/lib/utils'
import { GAP_CLASS, type Gap } from './scale'
import type { PolymorphicProps } from './polymorphic'

/**
 * Cluster (design.md "Layout primitives").
 *
 * Horizontal groups that wrap: toolbars, filter chips, button rows, the
 * context/scope bar. A flex row with a spacing-scale gap (SG-005) that wraps
 * onto new lines instead of overflowing — so a crowded action bar degrades
 * gracefully on narrow widths rather than needing a per-screen media query.
 *
 * `justify` distributes along the main axis; `align` sets cross-axis
 * alignment (default center, which keeps mixed-height controls aligned).
 * Polymorphic: `as="nav"` for a link cluster, `as="ul"` for a chip list, etc.
 */
const JUSTIFY_CLASS = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
} as const

const ALIGN_CLASS = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  baseline: 'items-baseline',
} as const

export interface ClusterOwnProps {
  /** Spacing-scale gap between items. Default 3 (12px). */
  gap?: Gap
  justify?: keyof typeof JUSTIFY_CLASS
  align?: keyof typeof ALIGN_CLASS
  /** Allow items to wrap onto new lines. Default true. */
  wrap?: boolean
  className?: string
}

export function Cluster<E extends ElementType = 'div'>({
  as,
  gap = 3,
  justify = 'start',
  align = 'center',
  wrap = true,
  className,
  ...props
}: PolymorphicProps<E, ClusterOwnProps>) {
  const Comp = (as ?? 'div') as ElementType
  return (
    <Comp
      className={cn(
        'flex',
        wrap ? 'flex-wrap' : 'flex-nowrap',
        GAP_CLASS[gap],
        JUSTIFY_CLASS[justify],
        ALIGN_CLASS[align],
        className,
      )}
      {...props}
    />
  )
}
