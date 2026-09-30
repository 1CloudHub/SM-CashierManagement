import type { ElementType } from 'react'
import { cn } from '@/lib/utils'
import { GAP_CLASS, type Gap } from './scale'
import type { PolymorphicProps } from './polymorphic'

/**
 * Stack (design.md "Layout primitives").
 *
 * Vertical rhythm: a flex column whose gap comes from the spacing scale
 * (SG-005), so screens stack sections/fields/cards without ad-hoc margins.
 * `gap` takes a scale key (default 4 = 16px); `align` sets cross-axis
 * alignment for narrower children.
 *
 * Polymorphic so a stack can be the right element: `as="ul"` for a list,
 * `as="section"` for a labelled region, etc. — attributes follow the chosen
 * tag (this is what the earlier attempt got wrong).
 */
const ALIGN_CLASS = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
} as const

export interface StackOwnProps {
  /** Spacing-scale gap between children. Default 4 (16px). */
  gap?: Gap
  align?: keyof typeof ALIGN_CLASS
  className?: string
}

export function Stack<E extends ElementType = 'div'>({
  as,
  gap = 4,
  align = 'stretch',
  className,
  ...props
}: PolymorphicProps<E, StackOwnProps>) {
  const Comp = (as ?? 'div') as ElementType
  return (
    <Comp
      className={cn('flex flex-col', GAP_CLASS[gap], ALIGN_CLASS[align], className)}
      {...props}
    />
  )
}
