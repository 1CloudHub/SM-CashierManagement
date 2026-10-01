/**
 * WCAG contrast tooling for the --lw-* token layer (task 22, SG-004,
 * NFR-A11Y-001).
 *
 * Reads tokens.css as text, resolves the semantic tokens for each theme the
 * same way the browser does (dark = the light :root declarations with the dark
 * value swap layered on top, then var() chains resolved), and computes the
 * WCAG 2.x contrast ratio for every fill/on-colour pairing in CONTRAST_PAIRS.
 *
 * The contrast suite (tokens.contrast.test.ts) fails if any pair drops below
 * its threshold, so a re-brand (new ramps from SM) cannot silently ship an
 * inaccessible palette. This module holds no colour values of its own.
 */

export type Theme = 'light' | 'dark'
export type TokenMap = ReadonlyMap<string, string>

/** WCAG 2.2 AA thresholds: 1.4.3 (normal text) and 1.4.11 (non-text UI). */
export const AA_TEXT = 4.5
export const AA_NON_TEXT = 3

export interface ContrastPair {
  /** Foreground token (text, icon, outline or series colour), without `--lw-`. */
  fg: string
  /** Background token it sits on, without `--lw-`. */
  bg: string
  kind: 'text' | 'non-text'
  /** Where the pairing is used, for failure messages and docs. */
  use: string
}

const STATUSES = ['success', 'warning', 'danger', 'info'] as const
const SURFACES = ['bg', 'surface', 'surface-2'] as const
const VIZ = [1, 2, 3, 4, 5, 6] as const

/**
 * Every semantic pairing the design system allows. Adding a new fill role
 * means adding its on-colour pair here so it is covered by the suite.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  // Body text on every surface step.
  ...SURFACES.flatMap((bg): ContrastPair[] => [
    { fg: 'text', bg, kind: 'text', use: 'body text' },
    { fg: 'text-muted', bg, kind: 'text', use: 'secondary text' },
  ]),
  // Solid fills with their on-colours.
  { fg: 'on-primary', bg: 'primary', kind: 'text', use: 'primary button / key KPI' },
  { fg: 'on-primary-soft', bg: 'primary-soft', kind: 'text', use: 'selected / hover' },
  { fg: 'on-primary', bg: 'primary-hover', kind: 'text', use: 'primary button hover' },
  { fg: 'on-danger', bg: 'danger-hover', kind: 'text', use: 'danger button hover' },
  { fg: 'on-accent', bg: 'accent', kind: 'text', use: 'emphasis badge' },
  ...STATUSES.flatMap((s): ContrastPair[] => [
    { fg: `on-${s}`, bg: s, kind: 'text', use: `solid ${s} chip` },
    { fg: `on-${s}-soft`, bg: `${s}-soft`, kind: 'text', use: `${s} alert` },
    { fg: s, bg: 'surface', kind: 'text', use: `outline ${s} chip label` },
  ]),
  // Colour used as text on surfaces (links, outline buttons, emphasis).
  { fg: 'primary', bg: 'surface', kind: 'text', use: 'link / outline button' },
  { fg: 'primary', bg: 'bg', kind: 'text', use: 'link on page background' },
  { fg: 'accent', bg: 'surface', kind: 'text', use: 'emphasis text' },
  // Brand (task 22).
  { fg: 'on-brand', bg: 'brand', kind: 'text', use: 'brand mark bars / wordmark' },
  { fg: 'on-appbar', bg: 'appbar', kind: 'text', use: 'reversed app bar text + 2px controls' },
  { fg: 'brand', bg: 'surface', kind: 'text', use: 'wordmark on surface' },
  { fg: 'brand', bg: 'bg', kind: 'text', use: 'wordmark on page background' },
  { fg: 'brand-endorsement', bg: 'surface', kind: 'text', use: '"by SM Retail" endorsement' },
  { fg: 'brand-endorsement', bg: 'bg', kind: 'text', use: '"by SM Retail" endorsement' },
  // Non-text: 2px outlines, focus ring, status fills and chart series.
  ...SURFACES.map((bg): ContrastPair => ({ fg: 'outline', bg, kind: 'non-text', use: '2px outline' })),
  { fg: 'focus-ring', bg: 'surface', kind: 'non-text', use: 'focus ring' },
  { fg: 'focus-ring', bg: 'bg', kind: 'non-text', use: 'focus ring' },
  { fg: 'focus-ring', bg: 'primary-soft', kind: 'non-text', use: 'focus ring on selection' },
  { fg: 'brand', bg: 'surface', kind: 'non-text', use: 'brand mark tile' },
  ...STATUSES.map((s): ContrastPair => ({ fg: s, bg: 'surface', kind: 'non-text', use: `${s} fill / outline` })),
  ...VIZ.flatMap((n): ContrastPair[] => [
    { fg: `viz-${n}`, bg: 'surface', kind: 'non-text', use: `chart series ${n}` },
    { fg: `viz-${n}`, bg: 'bg', kind: 'non-text', use: `chart series ${n}` },
  ]),
]

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Declarations (`--lw-*` only) inside the first block opened by `selector {`. */
function blockDeclarations(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`tokens.css: no block for ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const out = new Map<string, string>()
  for (const decl of css.slice(open + 1, close).split(';')) {
    const m = /^\s*(--lw-[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(decl)
    if (m) out.set(m[1], m[2].replace(/\s+/g, ' '))
  }
  return out
}

export interface ParsedTokens {
  light: Map<string, string>
  /** The `data-theme="dark"` override block. */
  dark: Map<string, string>
  /** The `prefers-color-scheme: dark` block (must equal `dark`). */
  darkMedia: Map<string, string>
}

export function parseTokens(css: string): ParsedTokens {
  const clean = stripComments(css)
  const light = blockDeclarations(clean.slice(clean.search(/^:root \{/m)), ':root')
  return {
    light,
    dark: blockDeclarations(clean, ':root[data-theme="dark"]'),
    darkMedia: blockDeclarations(clean, ':root:not([data-theme="light"])'),
  }
}

/** The fully resolved token set for a theme (dark = light + value swap). */
export function themeTokens(parsed: ParsedTokens, theme: Theme): TokenMap {
  const merged = new Map(parsed.light)
  if (theme === 'dark') for (const [k, v] of parsed.dark) merged.set(k, v)
  const resolve = (value: string, depth = 0): string => {
    if (depth > 20) throw new Error(`tokens.css: var() cycle near ${value}`)
    return value.replace(/var\((--lw-[\w-]+)\)/g, (_, name: string) => {
      const next = merged.get(name)
      if (next === undefined) throw new Error(`tokens.css: undefined ${name}`)
      return resolve(next, depth + 1)
    })
  }
  const out = new Map<string, string>()
  for (const [k, v] of merged) out.set(k, resolve(v))
  return out
}

export type Rgb = readonly [number, number, number]

/** Parse an opaque `#rgb` / `#rrggbb` colour. */
export function parseHex(value: string): Rgb {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (!m) throw new Error(`not an opaque hex colour: ${value}`)
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio (1–21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export interface ContrastResult extends ContrastPair {
  theme: Theme
  ratio: number
  min: number
  pass: boolean
}

/** Evaluate every pair in both themes. */
export function checkContrast(
  css: string,
  pairs: readonly ContrastPair[] = CONTRAST_PAIRS,
): ContrastResult[] {
  const parsed = parseTokens(css)
  return (['light', 'dark'] as const).flatMap((theme) => {
    const tokens = themeTokens(parsed, theme)
    const colour = (name: string) => {
      const v = tokens.get(`--lw-${name}`)
      if (v === undefined) throw new Error(`tokens.css: missing --lw-${name}`)
      return parseHex(v)
    }
    return pairs.map((p) => {
      const ratio = contrastRatio(colour(p.fg), colour(p.bg))
      const min = p.kind === 'text' ? AA_TEXT : AA_NON_TEXT
      return { ...p, theme, ratio, min, pass: ratio >= min }
    })
  })
}
