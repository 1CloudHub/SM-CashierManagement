import type { ElementType } from 'react'
import { cn } from '@/lib/utils'
import type { PolymorphicProps } from './polymorphic'

/**
 * Grid + Col (design.md "Grid and layout system").
 *
 * The responsive column grid from the grid table: 4 columns on mobile, 8 on
 * tablet, 12 on laptop and desktop. The gutter is token-driven (16 / 20 / 24)
 * via the `lw-grid` utility (which reads `--lw-grid-gutter`), so screens never
 * hand-roll `grid-template-columns` or gutter px.
 *
 *   <Grid>
 *     <Col span={2} spanTablet={4} spanLaptop={8}>…</Col>
 *     <Col span={2} spanTablet={4} spanLaptop={4}>…</Col>
 *   </Grid>
 *
 * `Col` spans are expressed against each breakpoint's column count (≤4 mobile,
 * ≤8 tablet, ≤12 laptop+). Static class maps keep whole class names visible to
 * the Tailwind scanner. A Col with no span fills a single column at every
 * breakpoint.
 */

// The grid itself: `lw-grid` is 4 cols + token gutter; step up the column
// count at tablet (8) and laptop (12). Whole classes for the scanner.
const GRID_COLS =
  'lw-grid tablet:grid-cols-8 laptop:grid-cols-12'

export interface GridOwnProps {
  className?: string
}

export function Grid<E extends ElementType = 'div'>({
  as,
  className,
  ...props
}: PolymorphicProps<E, GridOwnProps>) {
  const Comp = (as ?? 'div') as ElementType
  return <Comp className={cn(GRID_COLS, className)} {...props} />
}

// Column spans — mobile (1–4), tablet (1–8), laptop+ (1–12). Static maps so
// Tailwind emits the classes; missing keys just fall through.
const SPAN_MOBILE: Record<number, string> = {
  1: 'col-span-1',
  2: 'col-span-2',
  3: 'col-span-3',
  4: 'col-span-4',
}
const SPAN_TABLET: Record<number, string> = {
  1: 'tablet:col-span-1',
  2: 'tablet:col-span-2',
  3: 'tablet:col-span-3',
  4: 'tablet:col-span-4',
  5: 'tablet:col-span-5',
  6: 'tablet:col-span-6',
  7: 'tablet:col-span-7',
  8: 'tablet:col-span-8',
}
const SPAN_LAPTOP: Record<number, string> = {
  1: 'laptop:col-span-1',
  2: 'laptop:col-span-2',
  3: 'laptop:col-span-3',
  4: 'laptop:col-span-4',
  5: 'laptop:col-span-5',
  6: 'laptop:col-span-6',
  7: 'laptop:col-span-7',
  8: 'laptop:col-span-8',
  9: 'laptop:col-span-9',
  10: 'laptop:col-span-10',
  11: 'laptop:col-span-11',
  12: 'laptop:col-span-12',
}

export interface ColOwnProps {
  /** Columns to span on mobile (1–4). Default 1. */
  span?: number
  /** Columns to span on tablet (1–8). Falls back to `span`. */
  spanTablet?: number
  /** Columns to span on laptop and desktop (1–12). Falls back to spanTablet/span. */
  spanLaptop?: number
  className?: string
}

export function Col<E extends ElementType = 'div'>({
  as,
  span = 1,
  spanTablet,
  spanLaptop,
  className,
  ...props
}: PolymorphicProps<E, ColOwnProps>) {
  const Comp = (as ?? 'div') as ElementType
  return (
    <Comp
      className={cn(
        SPAN_MOBILE[span],
        spanTablet && SPAN_TABLET[spanTablet],
        spanLaptop && SPAN_LAPTOP[spanLaptop],
        className,
      )}
      {...props}
    />
  )
}
