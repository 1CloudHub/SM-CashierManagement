/**
 * LaneWise layout primitives (design.md "Grid and layout system", task 1.6).
 *
 * Composable, token-driven building blocks so screens are assembled from these
 * instead of bespoke layout CSS:
 *   - Page          shell + centred max-width container + token outer margin
 *   - Grid / Col    the responsive 12 / 8 / 4 column grid with a token gutter
 *   - Stack         vertical rhythm from the spacing scale
 *   - Cluster       horizontal groups that wrap (toolbars, chips, actions)
 *   - Split / Sidebar   content + a docked side track (settings drawer / panel)
 *   - Section       a labelled card region (heading + landmark, wired for a11y)
 *   - AppShell      TopBar + SideNav + breadcrumb + sample-data slot, wired to
 *                   the four breakpoints (mobile drawer + full-screen search)
 *   - DensityProvider / useDensity   compact variant for dense data regions,
 *                   keeping ≥44px touch targets
 */
export { AppShell, type AppShellProps } from './app-shell'
export { Cluster, type ClusterOwnProps } from './cluster'
export { DensityProvider } from './density'
export { useDensity, type Density } from './density-context'
export { Col, Grid, type ColOwnProps, type GridOwnProps } from './grid'
export { Page, type PageOwnProps } from './page'
export { GAP_CLASS, type Gap } from './scale'
export { Section, type SectionProps } from './section'
export { Sidebar, Split, type SidebarProps, type SplitOwnProps } from './split'
export { Stack, type StackOwnProps } from './stack'
export { useMediaQuery } from './use-media-query'
export { type PolymorphicProps } from './polymorphic'
