/**
 * Component gallery navigation (task 1.10 — SG-000, the living style-guide
 * reference).
 *
 * The gallery is organised as a set of top-level sections, each mapped to an
 * on-page anchor and a nav entry. Screens (there is only one here) render the
 * side-nav from this single list so the reference is navigable and the section
 * order stays in one place. IDs double as the `id` on each rendered
 * <section> so the side-nav links and the skip target line up.
 *
 * The gallery documents everything built in tasks 1.4–1.9:
 *   - foundations  design tokens (colour, type, spacing, radius, motion) — 1.1/1.2
 *   - primitives   the UI components — 1.4 (SG-001/006)
 *   - states       the UX-010 state set — 1.4
 *   - layout       the grid + layout primitives — 1.6
 *   - patterns     accessibility (1.7), i18n (1.8), keyboard + help (1.9)
 *   - errors       the SCR-090 error/status pages — 1.5
 *
 * These are reference/scaffolding labels for the style guide itself, so they
 * are intentionally plain strings (not product copy in the i18n bundles). All
 * product UI rendered inside the sections still flows through `t()`.
 */
export interface GallerySection {
  /** Anchor id + nav target (also the rendered <section> id). */
  id: string
  /** Short nav label. */
  label: string
  /** One-line description shown under the section heading. */
  description: string
}

export const GALLERY_SECTIONS: readonly GallerySection[] = [
  {
    id: 'foundations',
    label: 'Foundations',
    description:
      'The design tokens every component reads: colour, type scale, spacing, shape and motion. No component hardcodes these values.',
  },
  {
    id: 'primitives',
    label: 'Primitives',
    description:
      'The atomic and composite UI components the screens compose (SG-001/006): buttons, inputs, tabs, cards, KPIs, tables, pills, dialogs and toasts.',
  },
  {
    id: 'states',
    label: 'States',
    description:
      'The standard state set (UX-010): loading/skeleton, empty, error, no-access, stale, unsaved and success — each with its own recovery path.',
  },
  {
    id: 'layout',
    label: 'Layout',
    description:
      'The token-driven grid and layout primitives (task 1.6): Page, Grid/Col, Stack, Cluster, Split/Sidebar and Section — screens compose these instead of bespoke CSS.',
  },
  {
    id: 'patterns',
    label: 'Patterns',
    description:
      'The cross-cutting layers: accessibility and labelling (task 1.7), internationalisation and ₱/number formatting (task 1.8), and keyboard shortcuts and help (task 1.9).',
  },
  {
    id: 'errors',
    label: 'Error pages',
    description:
      'The 4xx/5xx and offline pages (SCR-090): plain-language message, a reference id, and a clear way back to safety — never a dead end.',
  },
] as const
