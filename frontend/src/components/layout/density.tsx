import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { DensityContext, type Density } from './density-context'

/**
 * DensityProvider (design.md "Density").
 *
 * Wrap a dense region — a table, the roster timeline/grid — so its descendants
 * render with the compact spacing variant while interactive controls keep the
 * ≥ 44px touch minimum. Descendants read `useDensity()` (from density-context)
 * to pick their padding; a `data-density` attribute is also exposed so
 * token-driven CSS can respond.
 */
export function DensityProvider({
  density = 'compact',
  className,
  children,
}: {
  density?: Density
  className?: string
  children: ReactNode
}) {
  return (
    <DensityContext value={density}>
      <div data-density={density} className={cn(className)}>
        {children}
      </div>
    </DensityContext>
  )
}
