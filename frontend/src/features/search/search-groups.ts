import { searchableGroups, type RoleCode, type SearchGroupKey, type SearchResponse } from '@lanewise/shared'
import { departmentHref, matchPages, scenarioHref, staffHref, storeHref } from './search-links'

/**
 * Search results as display groups — shared by the top-bar dropdown and
 * SCR-041 so both show the same labels, details and targets. Only groups the
 * role may search appear (plus Pages); the API already returned only
 * in-scope hits (P1).
 */

export type DisplayGroupKey = SearchGroupKey | 'pages'

export interface DisplayHit {
  readonly id: string
  readonly label: string
  readonly detail?: string
  /** `null` when the role can't open the target screen. */
  readonly href: string | null
}

export interface DisplayGroup {
  readonly key: DisplayGroupKey
  readonly label: string
  readonly total: number
  readonly hits: readonly DisplayHit[]
}

type T = (id: string, values?: Record<string, string | number>) => string

export function displayGroups(role: RoleCode, query: string, data: SearchResponse | null, t: T, pageLimit: number): DisplayGroup[] {
  const groups: DisplayGroup[] = []
  const allowed = searchableGroups(role)
  if (data) {
    const g = data.groups
    const add = (key: SearchGroupKey, total: number, hits: DisplayHit[]) => {
      if (allowed.includes(key)) groups.push({ key, label: t(`search.group.${key}`), total, hits })
    }
    add(
      'stores',
      g.stores.total,
      g.stores.items.map((s) => ({
        id: s.id,
        label: s.name,
        detail: t('search.hit.store', { region: s.regionName, format: t(`format.${s.format}`) }),
        href: storeHref(role, s),
      })),
    )
    add(
      'departments',
      g.departments.total,
      g.departments.items.map((d) => ({ id: d.id, label: d.name, detail: d.storeName, href: departmentHref(role, d) })),
    )
    add(
      'scenarios',
      g.scenarios.total,
      g.scenarios.items.map((s) => ({ id: s.id, label: s.name, detail: t(`scenario.status.${s.status}`), href: scenarioHref(role, s) })),
    )
    add(
      'staff',
      g.staff.total,
      g.staff.items.map((s) => ({
        id: s.id,
        label: s.name,
        detail: t('search.hit.staff', { employeeNo: s.employeeNo, store: s.storeName, department: s.departmentName }),
        href: staffHref(role, s),
      })),
    )
  }
  const pages = matchPages(role, query, (k) => t(k))
  groups.push({
    key: 'pages',
    label: t('search.group.pages'),
    total: pages.length,
    hits: pages.slice(0, pageLimit).map((p) => ({ id: p.id, label: p.title, detail: t('search.hit.page'), href: p.href })),
  })
  return groups
}
