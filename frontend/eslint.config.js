import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * Token-usage enforcement (SG-002/004/005/007, ADR-0003).
 *
 * Components must consume design tokens (via token-backed Tailwind utilities
 * or the --lw-* CSS variables), never raw values. These rules catch the common
 * violations in JS/TS/JSX; the rest is caught in review:
 *   - raw hex colours            use bg / text / border token utilities
 *   - px font sizes              use the text-* type-scale utilities
 *   - ad-hoc ms/s timings        use duration-fast/base/slow + ease-* tokens
 *
 * The regexes target string + template literals, which is where these values
 * leak into components (className strings, inline style objects, styled CSS).
 */
const HEX_COLOR = String.raw`#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b`
const PX_FONT_SIZE = String.raw`font-size\s*:\s*\d`
const RAW_DURATION = String.raw`(?:transition|animation)(?:-duration)?\s*:\s*[^;]*\d+m?s`

const tokenEnforcement = [
  {
    selector: `Literal[value=/${HEX_COLOR}/]`,
    message:
      'No raw hex colours in components. Use a token-backed utility (bg-*, text-*, border-*) or a --lw-* variable. Raw colours live only in src/styles/tokens.css.',
  },
  {
    selector: `TemplateElement[value.raw=/${HEX_COLOR}/]`,
    message:
      'No raw hex colours in components. Use a token-backed utility (bg-*, text-*, border-*) or a --lw-* variable. Raw colours live only in src/styles/tokens.css.',
  },
  {
    selector: `Literal[value=/${PX_FONT_SIZE}/]`,
    message:
      'No px font sizes in components. Use the text-* type-scale utilities (text-body, text-h1, text-kpi, ...).',
  },
  {
    selector: `TemplateElement[value.raw=/${PX_FONT_SIZE}/]`,
    message:
      'No px font sizes in components. Use the text-* type-scale utilities (text-body, text-h1, text-kpi, ...).',
  },
  {
    selector: `Literal[value=/${RAW_DURATION}/]`,
    message:
      'No ad-hoc timings in components. Use the motion tokens (duration-fast/base/slow, ease-standard/enter/exit).',
  },
  {
    selector: `TemplateElement[value.raw=/${RAW_DURATION}/]`,
    message:
      'No ad-hoc timings in components. Use the motion tokens (duration-fast/base/slow, ease-standard/enter/exit).',
  },
]

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Token enforcement applies to app source, not the token definitions
    // themselves or config/test scaffolding.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...tokenEnforcement],
    },
  },
])
