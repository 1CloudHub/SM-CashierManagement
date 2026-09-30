/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AA_NON_TEXT,
  AA_TEXT,
  CONTRAST_PAIRS,
  checkContrast,
  contrastRatio,
  parseTokens,
  themeTokens,
} from './contrast'

/**
 * Brand contrast suite (task 22, SG-004, NFR-A11Y-001).
 *
 * Computes the WCAG contrast of every semantic fill/on-colour pairing in both
 * themes straight from tokens.css, and fails if any text pair is < 4.5:1 or
 * any non-text pair (2px outlines, focus ring, status fills, chart series) is
 * < 3:1. Re-run after any ramp or brand-role change (see SG-004 "Swapping the
 * brand"). Automated contrast is necessary, not sufficient: full WCAG
 * conformance still needs manual assistive-technology testing.
 */

// Read from disk: vitest runs with css: false, which stubs `?raw` CSS imports,
// and under jsdom import.meta.url is not a file URL. Vitest's root is frontend/.
const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')
const results = checkContrast(tokensCss)

describe('WCAG helpers', () => {
  it('computes the reference ratios', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5)
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 2)
    expect(contrastRatio([10, 20, 30], [10, 20, 30])).toBe(1)
  })
})

describe('token parsing', () => {
  it('reads tokens.css (not an empty stub)', () => {
    expect(tokensCss).toContain('--lw-primary')
  })

  it('keeps the device-dark and data-theme="dark" blocks identical', () => {
    const { dark, darkMedia } = parseTokens(tokensCss)
    expect(Object.fromEntries(darkMedia)).toEqual(Object.fromEntries(dark))
  })

  it('dark mode is a pure value swap of existing semantic tokens', () => {
    const { light, dark } = parseTokens(tokensCss)
    for (const name of dark.keys()) expect(light.has(name), name).toBe(true)
  })

  it('resolves every pair token to an opaque colour in both themes', () => {
    const parsed = parseTokens(tokensCss)
    for (const theme of ['light', 'dark'] as const) {
      const tokens = themeTokens(parsed, theme)
      for (const { fg, bg } of CONTRAST_PAIRS) {
        expect(tokens.get(`--lw-${fg}`), `${theme} --lw-${fg}`).toMatch(/^#/)
        expect(tokens.get(`--lw-${bg}`), `${theme} --lw-${bg}`).toMatch(/^#/)
      }
    }
  })
})

describe.each(['light', 'dark'] as const)('%s theme contrast', (theme) => {
  const rows = results.filter((r) => r.theme === theme)

  it.each(rows.filter((r) => r.kind === 'text').map((r) => [`--lw-${r.fg} on --lw-${r.bg}`, r] as const))(
    `text: %s ≥ ${AA_TEXT}:1`,
    (_, r) => {
      expect(r.ratio, `${r.use}: ${r.ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT)
    },
  )

  it.each(rows.filter((r) => r.kind === 'non-text').map((r) => [`--lw-${r.fg} on --lw-${r.bg}`, r] as const))(
    `non-text: %s ≥ ${AA_NON_TEXT}:1`,
    (_, r) => {
      expect(r.ratio, `${r.use}: ${r.ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NON_TEXT)
    },
  )
})
