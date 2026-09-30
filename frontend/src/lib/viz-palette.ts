/**
 * Data-visualisation categorical palette (SG-010, SG-004).
 *
 * This is the SEPARATE, labelled palette for charts — deliberately distinct
 * from the status colours (success/warning/danger/info), which mean specific
 * things and must never be borrowed for arbitrary series. The colours are the
 * Okabe–Ito colour-blind-safe set, defined once as the --lw-viz-* tokens in
 * tokens.css (light + dark value swap) and mapped to the viz-* Tailwind
 * utilities in index.css.
 *
 * Accessibility rules baked in (SG-010, NFR-A11Y-001):
 *   - Max 6 series; consume them IN ORDER via VIZ_SERIES so colour assignment
 *     is stable and predictable across charts.
 *   - Colour is NEVER the only channel: every series also carries a distinct
 *     `marker` shape and a human `name` so a legend/label + marker convey the
 *     series without relying on hue (protects red-green colour blindness).
 *
 * Consumers reference `token`/`colorClass` (token-backed) — never a raw hex.
 */

/** A distinct marker shape per series so charts don't rely on colour alone. */
export type VizMarker = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross'

export interface VizSeriesToken {
  /** 1-based series index, matching the --lw-viz-N token. */
  readonly index: 1 | 2 | 3 | 4 | 5 | 6
  /** Human-readable colour name (for docs / debugging, not user-facing copy). */
  readonly name: string
  /** The CSS custom property holding the colour (light/dark aware). */
  readonly token: `--lw-viz-${1 | 2 | 3 | 4 | 5 | 6}`
  /** Token-backed utility class (e.g. for `fill`, `stroke`, `bg`). */
  readonly colorClass: `viz-${1 | 2 | 3 | 4 | 5 | 6}`
  /** Distinct marker shape — the non-colour channel that labels the series. */
  readonly marker: VizMarker
}

/**
 * The categorical palette in canonical order. Assign series to data in this
 * order (series 1 first) so the same category gets the same colour + marker
 * everywhere. Do not exceed 6 categories in a single chart (SG-010); beyond
 * that, group into "Other" or use small multiples.
 */
export const VIZ_SERIES: readonly VizSeriesToken[] = [
  { index: 1, name: 'Blue', token: '--lw-viz-1', colorClass: 'viz-1', marker: 'circle' },
  { index: 2, name: 'Vermillion', token: '--lw-viz-2', colorClass: 'viz-2', marker: 'square' },
  { index: 3, name: 'Green', token: '--lw-viz-3', colorClass: 'viz-3', marker: 'triangle' },
  { index: 4, name: 'Pink', token: '--lw-viz-4', colorClass: 'viz-4', marker: 'diamond' },
  { index: 5, name: 'Neutral', token: '--lw-viz-5', colorClass: 'viz-5', marker: 'cross' },
  { index: 6, name: 'Sky', token: '--lw-viz-6', colorClass: 'viz-6', marker: 'circle' },
] as const

/** Hard cap on categorical series per chart (SG-010). */
export const VIZ_MAX_SERIES = VIZ_SERIES.length

/**
 * Pick the series token for a 0-based data index, cycling within the palette
 * so an accidental overflow degrades gracefully rather than throwing. Callers
 * should still respect VIZ_MAX_SERIES for legibility.
 */
export function vizSeries(dataIndex: number): VizSeriesToken {
  const i = ((dataIndex % VIZ_MAX_SERIES) + VIZ_MAX_SERIES) % VIZ_MAX_SERIES
  return VIZ_SERIES[i]
}
