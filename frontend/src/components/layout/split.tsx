import type { ElementType, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { GAP_CLASS, type Gap } from './scale'
import type { PolymorphicProps } from './polymorphic'

/**
 * Split + Sidebar (design.md "Layout primitives", Breakpoints).
 *
 * Split is a two-track row: a fluid main content area and a fixed-width side
 * track (a docked settings drawer, a detail panel, filters). It stacks to a
 * single column below the given breakpoint so the side content sits under the
 * main content on tablet/mobile, matching the breakpoints table (drawers
 * overlay/are full-screen on smaller widths; only desktop docks beside
 * content). The first child is the main track, the second is the side track.
 *
 * Sidebar is the common preset: main content with a labelled side region
 * docked on the `sideEdge` edge from `dockAt` up (default desktop, per
 * "settings drawer can dock beside content"), and hidden below it (the parent
 * renders it as an overlay Drawer there instead). Gutter comes from the
 * spacing scale (SG-005).
 */

// Docked column templates. When the side track is on the start edge the side
// column comes first; otherwise the main column comes first. Whole classes so
// the Tailwind scanner keeps them.
const DOCK_GRID = {
  laptop: {
    start: 'laptop:grid-cols-[var(--side-w)_1fr]',
    end: 'laptop:grid-cols-[1fr_var(--side-w)]',
  },
  desktop: {
    start: 'desktop:grid-cols-[var(--side-w)_1fr]',
    end: 'desktop:grid-cols-[1fr_var(--side-w)]',
  },
} as const

const DOCK_SHOW = {
  laptop: 'hidden laptop:block',
  desktop: 'hidden desktop:block',
} as const

export interface SplitOwnProps {
  /** Fixed width of the side track. Default 20rem (matches the drawer max-w). */
  sideWidth?: string
  /** Which edge the side track docks on. Default "end" (right). */
  sideEdge?: 'start' | 'end'
  /** Breakpoint from which the tracks sit side by side. Default "desktop". */
  dockAt?: 'laptop' | 'desktop'
  /** Spacing-scale gap between the tracks. Default 6 (24px). */
  gap?: Gap
  className?: string
}

export function Split<E extends ElementType = 'div'>({
  as,
  sideWidth = '20rem',
  sideEdge = 'end',
  dockAt = 'desktop',
  gap = 6,
  className,
  style,
  ...props
}: PolymorphicProps<E, SplitOwnProps>) {
  const Comp = (as ?? 'div') as ElementType
  return (
    <Comp
      className={cn(
        'grid grid-cols-1',
        DOCK_GRID[dockAt][sideEdge],
        GAP_CLASS[gap],
        className,
      )}
      style={{ ['--side-w' as string]: sideWidth, ...(style as object) }}
      {...props}
    />
  )
}

export interface SidebarProps {
  /** The primary content. */
  children: ReactNode
  /** The docked side content (settings drawer / detail panel / filters). */
  side: ReactNode
  /** Accessible name for the side region (renders as a complementary <aside>). */
  sideLabel: string
  /** Which edge the side track docks on. Default "end" (right). */
  sideEdge?: 'start' | 'end'
  /** Fixed width of the side track. Default 20rem. */
  sideWidth?: string
  /** Breakpoint from which the side track docks beside content. Default "desktop". */
  dockAt?: 'laptop' | 'desktop'
  /** Spacing-scale gap between tracks. Default 6 (24px). */
  gap?: Gap
  className?: string
}

export function Sidebar({
  children,
  side,
  sideLabel,
  sideEdge = 'end',
  sideWidth = '20rem',
  dockAt = 'desktop',
  gap = 6,
  className,
}: SidebarProps) {
  const main = <div className="min-w-0">{children}</div>
  const aside = (
    <aside aria-label={sideLabel} className={cn(DOCK_SHOW[dockAt], 'min-w-0')}>
      {side}
    </aside>
  )
  return (
    <div
      className={cn(
        'grid grid-cols-1',
        DOCK_GRID[dockAt][sideEdge],
        GAP_CLASS[gap],
        className,
      )}
      style={{ ['--side-w' as string]: sideWidth }}
    >
      {sideEdge === 'start' ? (
        <>
          {aside}
          {main}
        </>
      ) : (
        <>
          {main}
          {aside}
        </>
      )}
    </div>
  )
}
