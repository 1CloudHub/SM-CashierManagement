import {
  encodeViewState,
  type RoleCode,
  type SearchDepartmentHit,
  type SearchScenarioHit,
  type SearchStaffHit,
  type SearchStoreHit,
  type ViewState,
} from '@lanewise/shared'
import { canAccess } from '@/app/access'
import { SCREEN_BY_ID, SCREENS, type ScreenId } from '@/app/screens'

/**
 * Where each search hit opens (wireframes/scr-041-search.html), as URL view
 * state so the target screen opens already filtered. A hit links only when
 * the role may open the target screen; otherwise it is plain text.
 */

function to(role: RoleCode, screen: ScreenId, view: ViewState = {}): string | null {
  if (!canAccess(role, screen)) return null
  const query = encodeViewState(view)
  return `${SCREEN_BY_ID[screen].path}${query ? `?${query}` : ''}`
}

export function storeHref(role: RoleCode, hit: SearchStoreHit): string | null {
  return to(role, 'SCR-021', { store: hit.id })
}

export function departmentHref(role: RoleCode, hit: SearchDepartmentHit): string | null {
  return to(role, 'SCR-021', { store: hit.storeId, dept: hit.id })
}

export function scenarioHref(role: RoleCode, hit: SearchScenarioHit): string | null {
  if (!canAccess(role, 'SCR-031')) return null
  return `/scenarios/${encodeURIComponent(hit.id)}/settings`
}

export function staffHref(role: RoleCode, hit: SearchStaffHit): string | null {
  return to(role, 'SCR-053', { store: hit.storeId })
}

/** Screens that make sense as search targets (no path params, not the status or search pages). */
const PAGE_EXCLUDED: readonly ScreenId[] = ['SCR-041', 'SCR-090']

export interface PageHit {
  readonly id: ScreenId
  readonly title: string
  readonly href: string
}

/**
 * The "Pages" group, matched in the SPA: screens the role may open whose
 * (localised) title contains the query. Pages the role can't open never show
 * (requirement 2.3).
 */
export function matchPages(role: RoleCode, query: string, title: (key: string) => string): PageHit[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []
  return SCREENS.filter((s) => !s.path.includes(':') && !PAGE_EXCLUDED.includes(s.id) && canAccess(role, s))
    .map((s) => ({ id: s.id, title: title(s.titleKey), href: s.path }))
    .filter((p) => p.title.toLowerCase().includes(needle))
}
