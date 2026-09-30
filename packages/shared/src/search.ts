/**
 * Global search and saved views — wire contracts (design.md › Search and
 * filter; requirement 21; task 20; P1, P11).
 *
 * `GET /search` returns hits grouped by kind, every one inside the active
 * role's scope; a group the role has no permission for is always empty.
 * "Pages" are matched in the SPA from the screens the role may open, so they
 * are not part of the API response.
 */
import type { StoreFormat, IsoDateTime } from './entities.js';
import { can, permissionFor, type RbacResource } from './rbac.js';
import type { RoleCode } from './roles.js';
import type { ScenarioStatus } from './scenario.js';

export const SEARCH_GROUPS = ['stores', 'departments', 'scenarios', 'staff'] as const;
export type SearchGroupKey = (typeof SEARCH_GROUPS)[number];

/** Longest search text accepted (characters, after trimming). */
export const SEARCH_QUERY_MAX = 100;
/** Hits per group in the top-bar dropdown. */
export const SEARCH_DROPDOWN_LIMIT = 5;
/** Most hits per group the API returns (SCR-041). */
export const SEARCH_PAGE_LIMIT = 50;

/**
 * The RBAC resources that make each group searchable: the role needs `view`
 * on at least one. Scope still applies to every hit (P1), and Staff never get
 * other cashiers (P11: no Staff role holds `staff_records`).
 */
export const SEARCH_GROUP_RESOURCES: Readonly<Record<SearchGroupKey, readonly RbacResource[]>> = {
  stores: ['master_data', 'network_view'],
  departments: ['department_plan', 'master_data'],
  scenarios: ['scenarios'],
  staff: ['staff_records', 'staff_availability'],
};

/** Groups the role may search, in display order. */
export function searchableGroups(role: RoleCode | null): SearchGroupKey[] {
  return SEARCH_GROUPS.filter((g) => SEARCH_GROUP_RESOURCES[g].some((r) => can(role, r, 'view')));
}

/** Whether the role only sees Published scenarios ("V (published only)", e.g. Store Manager). */
export function seesPublishedScenariosOnly(role: RoleCode): boolean {
  return permissionFor(role, 'scenarios')?.limit === 'published_only';
}

export interface SearchStoreHit {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly format: StoreFormat;
  readonly regionId: string;
  readonly regionName: string;
}

export interface SearchDepartmentHit {
  readonly id: string;
  readonly name: string;
  readonly storeId: string;
  readonly storeName: string;
}

export interface SearchScenarioHit {
  readonly id: string;
  readonly name: string;
  readonly season: string;
  readonly status: ScenarioStatus;
}

export interface SearchStaffHit {
  readonly id: string;
  readonly name: string;
  readonly employeeNo: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly departmentName: string;
}

export interface SearchGroup<T> {
  /** All in-scope matches (the items may be fewer: see `limit`). */
  readonly total: number;
  readonly items: readonly T[];
}

/** `GET /search?q=…&limit=…` */
export interface SearchResponse {
  /** The trimmed query that was searched. */
  readonly query: string;
  readonly groups: {
    readonly stores: SearchGroup<SearchStoreHit>;
    readonly departments: SearchGroup<SearchDepartmentHit>;
    readonly scenarios: SearchGroup<SearchScenarioHit>;
    readonly staff: SearchGroup<SearchStaffHit>;
  };
}

/** Screens that have a context bar, and so can save views (design.md › Search and filter). */
export const SAVED_VIEW_SCREENS = ['SCR-020', 'SCR-021', 'SCR-022', 'SCR-023', 'SCR-024', 'SCR-026'] as const;
export type SavedViewScreen = (typeof SAVED_VIEW_SCREENS)[number];

export const SAVED_VIEW_NAME_MAX = 80;

/** A named view of one screen, private to the user who saved it (requirement 21.5). */
export interface SavedView {
  readonly id: string;
  readonly screen: SavedViewScreen;
  readonly name: string;
  /** Canonical view query string (see ./view-state), without the leading `?`. */
  readonly query: string;
  /** At most one default per user per screen. */
  readonly isDefault: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/** `GET /saved-views?screen=…` — only the caller's own views. */
export interface SavedViewListResponse {
  readonly views: readonly SavedView[];
}

/** `POST /saved-views` */
export interface CreateSavedViewRequest {
  readonly screen: SavedViewScreen;
  readonly name: string;
  readonly query: string;
  readonly isDefault?: boolean;
}

/** `PATCH /saved-views/:viewId` — rename, replace the filters, or (un)set the default. */
export interface UpdateSavedViewRequest {
  readonly name?: string;
  readonly query?: string;
  readonly isDefault?: boolean;
}
