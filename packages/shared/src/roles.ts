/**
 * Roles and data scope (design.md › Roles and data scope; RBAC matrix).
 *
 * Authorization itself is enforced server-side (task 8.1, P12); these are the
 * shared vocabulary types only.
 */

/** The 8 role codes of the RBAC matrix, in matrix column order. */
export const ROLE_CODES = ['ADM', 'EXE', 'PLN', 'STM', 'HR', 'FIN', 'RST', 'STF'] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

/** English display names; UI copy is localised in the SPA's resource bundles. */
export const ROLE_NAMES: Readonly<Record<RoleCode, string>> = {
  ADM: 'System Admin',
  EXE: 'Executive / Leadership',
  PLN: 'Network / Regional Planner',
  STM: 'Store Manager',
  HR: 'HR / Recruitment',
  FIN: 'Finance',
  RST: 'Data / Rules Steward',
  STF: 'Staff (cashier)',
};

export function isRoleCode(value: unknown): value is RoleCode {
  return typeof value === 'string' && (ROLE_CODES as readonly string[]).includes(value);
}

/** Scope kinds: global, assigned region(s), assigned store(s), or own staff record. */
export const SCOPE_TYPES = ['global', 'region', 'store', 'self'] as const;

export type ScopeType = (typeof SCOPE_TYPES)[number];

export type Scope =
  | { readonly type: 'global' }
  | { readonly type: 'region'; readonly regionIds: readonly string[] }
  | { readonly type: 'store'; readonly storeIds: readonly string[] }
  | { readonly type: 'self'; readonly staffId: string };

/** A role held by a user together with the scope it applies to (DOM-002 RoleAssignment). */
export interface RoleAssignment {
  readonly userId: string;
  readonly role: RoleCode;
  readonly scope: Scope;
}

/** Minimal store reference needed to evaluate scope. */
export interface StoreRef {
  readonly id: string;
  readonly regionId: string;
}

/**
 * Whether store-wide data for `store` is visible under `scope`.
 *
 * A `self` scope never grants store-wide access: a Staff user sees only their
 * own staff record and shifts (P11), which is checked per staff record, not per
 * store.
 */
export function isStoreInScope(scope: Scope, store: StoreRef): boolean {
  switch (scope.type) {
    case 'global':
      return true;
    case 'region':
      return scope.regionIds.includes(store.regionId);
    case 'store':
      return scope.storeIds.includes(store.id);
    case 'self':
      return false;
  }
}
