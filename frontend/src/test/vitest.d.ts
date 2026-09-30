import 'vitest'
import type { AxeMatchers } from 'vitest-axe/matchers'

/**
 * Merge the vitest-axe matcher types into vitest's Assertion so
 * `toHaveNoViolations` type-checks. (`@testing-library/jest-dom/vitest`
 * augments its own matchers separately at import time.)
 */
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
