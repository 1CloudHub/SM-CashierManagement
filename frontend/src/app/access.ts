import type { RoleCode } from '@lanewise/shared'
import { matchPath } from 'react-router'
import { NAV, SCREEN_BY_ID, SCREENS, type NavItemDef, type ScreenDef, type ScreenId } from './screens'

/**
 * Client-side access rules (requirement 2.3 / 2.4, task 8.2). Pure functions
 * over the screen map so they can be property-tested for every role. These
 * only decide what the UI shows; the API authorises every request against the
 * active role (task 8.1, P12).
 */

export function canAccess(role: RoleCode, screen: ScreenId | ScreenDef): boolean {
  const def = typeof screen === 'string' ? SCREEN_BY_ID[screen] : screen
  return def.roles.includes(role)
}

/** The screen whose route matches `pathname`, or `null` (→ 404). */
export function screenForPath(pathname: string): ScreenDef | null {
  // Static segments win over params (/scenarios/compare vs /scenarios/:id/…).
  const candidates = SCREENS.filter((s) => matchPath({ path: s.path, end: true }, pathname))
  if (candidates.length === 0) return null
  return candidates.sort((a, b) => paramCount(a.path) - paramCount(b.path))[0]
}

function paramCount(path: string): number {
  return path.split('/').filter((seg) => seg.startsWith(':')).length
}

/** Whether `role` may stay on `pathname` (unknown paths are kept: they 404). */
export function canStayOn(role: RoleCode, pathname: string): boolean {
  const screen = screenForPath(pathname)
  return screen === null || canAccess(role, screen)
}

export interface VisibleNavSection {
  readonly titleKey?: string
  readonly items: readonly (NavItemDef & { readonly href: string })[]
}

/** The nav filtered to what `role` may open; empty sections are dropped (never shown disabled). */
export function navForRole(role: RoleCode): VisibleNavSection[] {
  return NAV.map((section) => ({
    titleKey: section.titleKey,
    items: section.items
      .filter((item) => canAccess(role, item.screen))
      .map((item) => ({ ...item, href: SCREEN_BY_ID[item.screen].path })),
  })).filter((section) => section.items.length > 0)
}
