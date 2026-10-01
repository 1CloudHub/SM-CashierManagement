import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/**
 * Shared helpers for the end-to-end journeys (task 25).
 *
 * The SPA runs in mock mode: the in-memory mock API lives in the page, so its
 * state survives client-side navigation and role switches but resets on a full
 * reload. Journeys that hand work from one role to another therefore start
 * with one `open()` and then move with `go()` (client-side) and
 * `switchRole()` (the demo "Viewing as" switcher), never `page.goto()`.
 */
export const ROLES = ['ADM', 'EXE', 'PLN', 'STM', 'HR', 'FIN', 'RST', 'STF'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABEL: Record<Role, string> = {
  ADM: 'System Admin',
  EXE: 'Executive',
  PLN: 'Planner',
  STM: 'Store Manager',
  HR: 'HR',
  FIN: 'Finance',
  RST: 'Rules Steward',
  STF: 'Staff',
}

/** WCAG 2.2 A/AA rule tags (NFR-A11Y-001). */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** Full page load as `role` (English, light theme). Resets the mock API. */
export async function open(page: Page, path: string, role: Role): Promise<void> {
  await page.addInitScript((r) => {
    try {
      // Only on the first load of this page, so a later switchRole() sticks.
      if (!sessionStorage.getItem('lw.e2e.seeded')) {
        localStorage.setItem('lw.activeRole', r)
        localStorage.setItem('lw.locale', 'en')
        sessionStorage.setItem('lw.e2e.seeded', '1')
      }
    } catch {
      // storage blocked: the app falls back to its defaults
    }
  }, role)
  await page.goto(path)
  await expect(page.locator('h1').first()).toBeVisible()
}

/** Client-side navigation (keeps the mock API state). */
export async function go(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    window.history.pushState(null, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await expect(page).toHaveURL(new RegExp(`${escapeRe(path.split('?')[0] ?? path)}`))
  await expect(page.locator('h1').first()).toBeVisible()
}

/** Switches the active role with the demo "Viewing as" switcher (P12). */
export async function switchRole(page: Page, role: Role): Promise<void> {
  const select = page.getByLabel('Viewing as').first()
  await select.selectOption(role)
  await expect(select).toHaveValue(role)
}

/** The page heading (h1). */
export function heading(page: Page) {
  return page.getByRole('heading', { level: 1 })
}

/** Asserts the out-of-scope "No access" page (requirement 2.4, P12). */
export async function expectNoAccess(page: Page): Promise<void> {
  await expect(heading(page)).toContainText('You do not have access')
}

/**
 * Runs axe (WCAG 2.2 A/AA) on the current page, or inside `include`, and
 * fails on any violation. Third-party map canvases are excluded.
 */
export async function expectAccessible(page: Page, include?: string): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS).exclude('.maplibregl-canvas')
  if (include) builder = builder.include(include)
  const { violations } = await builder.analyze()
  const summary = violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
  expect(summary, 'axe violations').toEqual([])
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
