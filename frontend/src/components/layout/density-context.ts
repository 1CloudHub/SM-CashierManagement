import { createContext, use } from 'react'

/**
 * Density context + hook (design.md "Density"), kept in a component-free module
 * so fast refresh stays happy (the <DensityProvider> component lives in
 * density.tsx).
 *
 * Dense data regions — tables, the roster timeline/grid — use a compact
 * spacing variant while keeping tap targets ≥ 44px on touch. Components read
 * `useDensity()` to pick their non-interactive padding; interactive controls
 * inside a compact region still meet the 44px minimum (they pair compact
 * padding with `min-h-tap` / the `--lw-tap-target` token), so a tighter grid
 * never shrinks a hit area below the touch minimum.
 */
export type Density = 'comfortable' | 'compact'

export const DensityContext = createContext<Density>('comfortable')

export function useDensity(): Density {
  return use(DensityContext)
}
