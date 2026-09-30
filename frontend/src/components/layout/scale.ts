/**
 * Shared spacing-scale keys for the layout primitives (SG-005).
 *
 * The primitives never take raw px/rem gaps — only these token keys, which map
 * to the single spacing scale wired into Tailwind (`--spacing-*`). This keeps
 * margins, gutters and stack gaps referencing one scale (design.md "Spacing
 * scale"). `Gap` covers the values screens actually need for vertical rhythm
 * and horizontal groups; `0` collapses the gap.
 */
export type Gap = 0 | 1 | 2 | 3 | 4 | 6 | 8 | 12

/** gap-* utility for a scale key. Static map so Tailwind sees whole classes. */
export const GAP_CLASS: Record<Gap, string> = {
  0: 'gap-0',
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  6: 'gap-6',
  8: 'gap-8',
  12: 'gap-12',
}
