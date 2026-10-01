import {
  SAVED_VIEW_NAME_MAX,
  SAVED_VIEW_SCREENS,
  SEARCH_DROPDOWN_LIMIT,
  SEARCH_PAGE_LIMIT,
  SEARCH_QUERY_MAX,
  normalizeViewQuery,
  searchableGroups,
  seesPublishedScenariosOnly,
  type RoleCode,
  type SavedView,
  type SavedViewScreen,
  type SearchGroup,
  type SearchResponse,
  type StoreFormat,
} from '@lanewise/shared'
import type { ContextOptions } from './types'
import { STM_STORE_ID, WORLD_DEPARTMENTS, WORLD_REGIONS, WORLD_SCENARIOS, WORLD_STAFF, WORLD_STORES } from './mock-world'

/**
 * Mock organisation for search, the context bar and saved views (task 20).
 * Scope mirrors the server's demo scopes: Store Manager = the Quezon City
 * store, Staff = no store-wide data and no other cashier (P11), everyone else
 * the whole network. Group permissions come from the shared RBAC matrix, so
 * the mock can never show a role more than the API would. Sample data —
 * simulated, not SM actuals.
 */

export const MOCK_REGIONS: readonly { id: string; name: string }[] = WORLD_REGIONS.map(({ id, name }) => ({ id, name }))

export const MOCK_STORES: readonly {
  id: string
  code: string
  name: string
  format: StoreFormat
  regionId: string
}[] = WORLD_STORES.map(({ id, code, name, format, regionId }) => ({ id, code, name, format, regionId }))

export const MOCK_DEPARTMENTS: readonly { id: string; name: string; storeId: string }[] = WORLD_DEPARTMENTS.map(({ id, name, storeId }) => ({ id, name, storeId }))

export const MOCK_SCENARIOS = WORLD_SCENARIOS

/** Every cashier of the demo world; the Staff persona is Juan dela Cruz (PT-02) at Quezon City. */
export const MOCK_STAFF: readonly { id: string; name: string; employeeNo: string; storeId: string; departmentId: string }[] = WORLD_STAFF.map(
  ({ id, name, employeeNo, storeId, departmentId }) => ({ id, name, employeeNo, storeId, departmentId }),
)

export const MOCK_SEASONS = [
  { id: 'nov02-dec31', start: '2026-11-02', end: '2026-12-31' },
  { id: 'nov16-dec31', start: '2026-11-16', end: '2026-12-31' },
  { id: 'nov30-dec31', start: '2026-11-30', end: '2026-12-31' },
] as const

/** Store ids in the role's (demo) scope; Staff see no store-wide data. */
export function mockStoreScope(role: RoleCode): readonly string[] {
  if (role === 'STF') return []
  if (role === 'STM') return [STM_STORE_ID]
  return MOCK_STORES.map((s) => s.id)
}

const storeById = (id: string) => MOCK_STORES.find((s) => s.id === id)
const regionName = (id: string) => MOCK_REGIONS.find((r) => r.id === id)?.name ?? ''

function take<T>(all: readonly T[], limit: number): SearchGroup<T> {
  return { total: all.length, items: all.slice(0, limit) }
}

export type MockResult<T> = { ok: true; body: T } | { ok: false; status: 404 | 409 | 422; message: string }

export function mockSearch(role: RoleCode, rawQuery: string | null, rawLimit: string | null): MockResult<SearchResponse> {
  const query = (rawQuery ?? '').trim()
  const limit = rawLimit === null ? SEARCH_DROPDOWN_LIMIT : Number(rawLimit)
  if (query.length === 0 || query.length > SEARCH_QUERY_MAX || !Number.isInteger(limit) || limit < 1 || limit > SEARCH_PAGE_LIMIT) {
    return { ok: false, status: 422, message: 'Some fields are missing or invalid.' }
  }
  const needle = query.toLowerCase()
  const has = (...texts: string[]) => texts.some((t) => t.toLowerCase().includes(needle))
  const groups = searchableGroups(role)
  const scope = new Set(mockStoreScope(role))
  const inScope = (storeId: string) => scope.has(storeId)

  const stores = groups.includes('stores')
    ? MOCK_STORES.filter((s) => inScope(s.id) && has(s.name, s.code, regionName(s.regionId))).map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        format: s.format,
        regionId: s.regionId,
        regionName: regionName(s.regionId),
      }))
    : []
  const departments = groups.includes('departments')
    ? MOCK_DEPARTMENTS.filter((d) => inScope(d.storeId) && has(d.name, storeById(d.storeId)?.name ?? '')).map((d) => ({
        id: d.id,
        name: d.name,
        storeId: d.storeId,
        storeName: storeById(d.storeId)?.name ?? '',
      }))
    : []
  const publishedOnly = seesPublishedScenariosOnly(role)
  const scenarios = groups.includes('scenarios')
    ? MOCK_SCENARIOS.filter((s) => (!publishedOnly || s.status === 'published') && has(s.name, s.season)).map(
        ({ id, name, season, status }) => ({ id, name, season, status }),
      )
    : []
  const staff = groups.includes('staff')
    ? MOCK_STAFF.filter((s) => inScope(s.storeId) && has(s.name, s.employeeNo, storeById(s.storeId)?.name ?? '')).map((s) => ({
        id: s.id,
        name: s.name,
        employeeNo: s.employeeNo,
        storeId: s.storeId,
        storeName: storeById(s.storeId)?.name ?? '',
        departmentName: MOCK_DEPARTMENTS.find((d) => d.id === s.departmentId)?.name ?? '',
      }))
    : []

  return {
    ok: true,
    body: {
      query,
      groups: {
        stores: take(stores, limit),
        departments: take(departments, limit),
        scenarios: take(scenarios, limit),
        staff: take(staff, limit),
      },
    },
  }
}

export function mockContextOptions(role: RoleCode): ContextOptions {
  const scope = new Set(mockStoreScope(role))
  const stores = MOCK_STORES.filter((s) => scope.has(s.id)).map(({ id, name, regionId, format }) => ({ id, name, regionId, format }))
  const regionIds = new Set(stores.map((s) => s.regionId))
  const publishedOnly = role === 'STF' || seesPublishedScenariosOnly(role)
  return {
    scenarios: role === 'STF' ? [] : MOCK_SCENARIOS.filter((s) => s.status !== 'archived' && (!publishedOnly || s.status === 'published')).map(({ id, name, status, stale }) => ({ id, name, status, stale })),
    regions: MOCK_REGIONS.filter((r) => regionIds.has(r.id)),
    formats: [...new Set(stores.map((s) => s.format))],
    stores,
    departments: MOCK_DEPARTMENTS.filter((d) => scope.has(d.storeId)),
    seasons: role === 'STF' ? [] : MOCK_SEASONS,
  }
}

/**
 * In-memory saved views for the one mock user (views belong to the user, not
 * the role). Mirrors the API: canonical queries, unique names per screen, one
 * default per screen.
 */
export function createSavedViewStore(now: () => Date = () => new Date()) {
  let views: SavedView[] = []
  let seq = 0

  const validName = (name: unknown): string | null => {
    if (typeof name !== 'string') return null
    const trimmed = name.trim()
    return trimmed.length > 0 && trimmed.length <= SAVED_VIEW_NAME_MAX ? trimmed : null
  }
  const clash = (screen: string, name: string, exceptId?: string) =>
    views.some((v) => v.screen === screen && v.name === name && v.id !== exceptId)
  const clearDefault = (screen: string) => {
    views = views.map((v) => (v.screen === screen && v.isDefault ? { ...v, isDefault: false } : v))
  }
  const duplicate = { ok: false, status: 409, message: 'You already have a view with that name on this screen. Choose another name.' } as const
  const invalid = { ok: false, status: 422, message: 'Some fields are missing or invalid.' } as const
  const missing = { ok: false, status: 404, message: 'This item doesn’t exist or you don’t have access to it.' } as const

  return {
    list(screen: string | null): MockResult<{ views: SavedView[] }> {
      if (screen !== null && !(SAVED_VIEW_SCREENS as readonly string[]).includes(screen)) return invalid
      return { ok: true, body: { views: views.filter((v) => screen === null || v.screen === screen) } }
    },
    create(body: unknown): MockResult<SavedView> {
      const b = (body ?? {}) as Record<string, unknown>
      const name = validName(b.name)
      const screen = b.screen as SavedViewScreen
      if (!name || !(SAVED_VIEW_SCREENS as readonly unknown[]).includes(screen) || typeof b.query !== 'string') return invalid
      if (clash(screen, name)) return duplicate
      if (b.isDefault === true) clearDefault(screen)
      seq += 1
      const at = now().toISOString()
      const view: SavedView = {
        id: `view-${seq}`,
        screen,
        name,
        query: normalizeViewQuery(b.query),
        isDefault: b.isDefault === true,
        createdAt: at,
        updatedAt: at,
      }
      views = [...views, view]
      return { ok: true, body: view }
    },
    update(id: string, body: unknown): MockResult<SavedView> {
      const current = views.find((v) => v.id === id)
      if (!current) return missing
      const b = (body ?? {}) as Record<string, unknown>
      const name = b.name === undefined ? current.name : validName(b.name)
      if (!name || (b.query !== undefined && typeof b.query !== 'string')) return invalid
      if (clash(current.screen, name, id)) return duplicate
      if (b.isDefault === true) clearDefault(current.screen)
      const next: SavedView = {
        ...current,
        name,
        query: typeof b.query === 'string' ? normalizeViewQuery(b.query) : current.query,
        isDefault: typeof b.isDefault === 'boolean' ? b.isDefault : current.isDefault,
        updatedAt: now().toISOString(),
      }
      views = views.map((v) => (v.id === id ? next : v))
      return { ok: true, body: next }
    },
    remove(id: string): MockResult<SavedView> {
      const current = views.find((v) => v.id === id)
      if (!current) return missing
      views = views.filter((v) => v.id !== id)
      return { ok: true, body: current }
    },
  }
}
