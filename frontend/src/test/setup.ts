import '@testing-library/jest-dom/vitest'
import * as matchers from 'vitest-axe/matchers'
import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jest-axe style matchers (toHaveNoViolations) for vitest.
expect.extend(matchers)

// jsdom does not implement matchMedia; components read prefers-reduced-motion
// and the theme query, so provide a no-match stub by default.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

// jsdom lacks these APIs some primitives touch during interaction tests.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn()
}

afterEach(() => {
  cleanup()
  // The i18n provider persists the chosen locale to localStorage; clear it so a
  // locale-switching test cannot leak into the next test's default locale.
  try {
    window.localStorage.clear()
  } catch {
    // ignore — localStorage may be unavailable in some environments.
  }
})
