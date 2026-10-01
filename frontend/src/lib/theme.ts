/**
 * Light/dark theme preference (SG-009).
 *
 * Dark mode is a token value swap keyed on `data-theme` on <html> (see
 * tokens.css): no attribute follows the device setting; "light" / "dark"
 * force a theme. The user's explicit choice persists per browser under
 * `lw.theme` and is applied before first paint by `initTheme()` in main.tsx.
 */
export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'lw.theme'

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

/** The persisted choice, or null to follow the device. */
export function readStoredTheme(): Theme | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return isTheme(v) ? v : null
  } catch {
    return null
  }
}

/** The device preference (light when matchMedia is unavailable). */
export function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** The theme currently in effect: explicit choice, else the device's. */
export function currentTheme(): Theme {
  return readStoredTheme() ?? systemTheme()
}

/** Sets (or clears, with null) `data-theme` on <html>. */
export function applyTheme(theme: Theme | null): void {
  if (typeof document === 'undefined') return
  if (theme) document.documentElement.dataset.theme = theme
  else delete document.documentElement.dataset.theme
}

/** Applies and persists an explicit choice. */
export function setTheme(theme: Theme): void {
  applyTheme(theme)
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage unavailable (private mode): the choice lasts for this page.
  }
}

/** Applies the persisted choice at startup (no-op when following the device). */
export function initTheme(): void {
  applyTheme(readStoredTheme())
}
