/**
 * User administration and audit log (SCR-070..073; design.md › RBAC matrix
 * rows "Users and roles" and "Audit log"; requirements 1, 2 and 22; P1, P7,
 * P13).
 *
 * Shared by the API (validation, scope filtering) and the SPA (forms, the
 * read-only permission matrix and the audit filters), so the rules cannot
 * drift between the two.
 */
import type { AuditAction, AuditSnapshot } from './audit.js';
import { isAllowedEmail, normaliseEmailInput } from './auth.js';
import type { IsoDateTime, UserStatus } from './entities.js';
import { permissionFor, type Permission, type PermissionAction } from './rbac.js';
import { ROLE_CODES, type RoleAssignment, type RoleCode, type Scope } from './roles.js';

// ---------------------------------------------------------------------------
// Users (SCR-070 / SCR-071)
// ---------------------------------------------------------------------------

/**
 * The data scope an administrator picks for an invited user (SCR-071). It
 * applies to every role except Staff, which is always self-scoped to the
 * staff record linked by work email (Q16, P11).
 */
export type AdminScopeInput =
  | { readonly type: 'global' }
  | { readonly type: 'region'; readonly regionIds: readonly string[] }
  | { readonly type: 'store'; readonly storeIds: readonly string[] };

export const ADMIN_SCOPE_TYPES = ['global', 'region', 'store'] as const;
export type AdminScopeType = (typeof ADMIN_SCOPE_TYPES)[number];

/** Longest display name accepted for an invited user. */
export const USER_NAME_MAX = 120;
/** Most regions or stores one scope may list. */
export const SCOPE_IDS_MAX = 200;

export interface NamedRef {
  readonly id: string;
  readonly name: string;
}

export interface ScopeStoreOption extends NamedRef {
  readonly regionId: string;
}

/** Regions and stores an administrator may assign — only those inside their own scope (P1). */
export interface ScopeOptions {
  readonly regions: readonly NamedRef[];
  readonly stores: readonly ScopeStoreOption[];
}

/** The scope a user row shows, with names resolved for display. */
export type AdminScopeView =
  | { readonly type: 'global' }
  | { readonly type: 'region'; readonly regions: readonly NamedRef[] }
  | { readonly type: 'store'; readonly stores: readonly NamedRef[] }
  | { readonly type: 'self'; readonly staff: NamedRef | null }
  | { readonly type: 'none' };

export interface AdminUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: UserStatus;
  /** Assigned roles, matrix order. */
  readonly roles: readonly RoleCode[];
  /** The data scope of the non-Staff roles (`self` when Staff is the only role; `none` without roles). */
  readonly scope: AdminScopeView;
  readonly lastSignIn: IsoDateTime | null;
  readonly invitedAt: IsoDateTime | null;
}

export interface AdminUserListResponse {
  readonly users: readonly AdminUser[];
  /** Whether the demo role switcher is on: assignments apply only when it is off (SCR-070 banner). */
  readonly demoMode: boolean;
}

export interface AdminUserResponse {
  readonly user: AdminUser;
}

export interface InviteUserRequest {
  readonly email: string;
  readonly name?: string;
  readonly roles: readonly RoleCode[];
  /** Required unless Staff is the only role (Staff is always self-scoped). */
  readonly scope?: AdminScopeInput;
}

export interface UpdateUserRequest {
  readonly name?: string;
  readonly roles?: readonly RoleCode[];
  readonly scope?: AdminScopeInput;
}

export const ADMIN_USER_STATUS_FILTERS = ['all', 'invited', 'active', 'disabled'] as const;
export type AdminUserStatusFilter = (typeof ADMIN_USER_STATUS_FILTERS)[number];

/** Roles in matrix order without duplicates. */
export function sortRoles(roles: readonly RoleCode[]): RoleCode[] {
  const held = new Set(roles);
  return ROLE_CODES.filter((r) => held.has(r));
}

export type InviteEmailProblem = 'required' | 'domain_not_allowed';

/**
 * Checks the work email typed into SCR-071 (client and server, P13): returns
 * the normalised email or the problem. Anything that is not a plain address on
 * the smretail.com / 1cloudhub.com allowlist is refused.
 */
export function checkInviteEmail(raw: string): { ok: true; email: string } | { ok: false; problem: InviteEmailProblem } {
  const email = normaliseEmailInput(raw);
  if (email.length === 0) return { ok: false, problem: 'required' };
  if (!isAllowedEmail(email)) return { ok: false, problem: 'domain_not_allowed' };
  return { ok: true, email };
}

/** The scope stored for a non-Staff role given the administrator's choice. */
export function scopeFromAdminInput(input: AdminScopeInput): Scope {
  switch (input.type) {
    case 'global':
      return { type: 'global' };
    case 'region':
      return { type: 'region', regionIds: [...new Set(input.regionIds)] };
    case 'store':
      return { type: 'store', storeIds: [...new Set(input.storeIds)] };
  }
}

/** Looks up the region of a store; `undefined` for an unknown store. */
export type StoreRegionLookup = (storeId: string) => string | undefined;
/** Looks up the store of a staff record; `undefined` for an unknown record. */
export type StaffStoreLookup = (staffId: string) => string | undefined;

/**
 * Whether everything `inner` grants is also inside `outer` (P1): an
 * administrator may only see and assign access within their own scope.
 * Unknown stores or staff are never contained.
 */
export function scopeContains(
  outer: Scope,
  inner: Scope,
  storeRegion: StoreRegionLookup,
  staffStore: StaffStoreLookup = () => undefined,
): boolean {
  if (outer.type === 'global') return true;
  if (outer.type === 'self') return inner.type === 'self' && inner.staffId === outer.staffId;
  const storeInOuter = (storeId: string): boolean => {
    const regionId = storeRegion(storeId);
    if (regionId === undefined) return false;
    return outer.type === 'region' ? outer.regionIds.includes(regionId) : outer.storeIds.includes(storeId);
  };
  switch (inner.type) {
    case 'global':
      return false;
    case 'region':
      return outer.type === 'region' && inner.regionIds.every((r) => outer.regionIds.includes(r));
    case 'store':
      return inner.storeIds.every(storeInOuter);
    case 'self': {
      const storeId = staffStore(inner.staffId);
      return storeId !== undefined && storeInOuter(storeId);
    }
  }
}

/**
 * Whether an administrator scoped to `adminScope` may see (and manage) a user
 * with these role assignments (P1). A user without assignments holds no
 * store-bound access, so only a network-wide (global) administrator sees them.
 */
export function isUserInAdminScope(
  adminScope: Scope,
  assignments: readonly Pick<RoleAssignment, 'scope'>[],
  storeRegion: StoreRegionLookup,
  staffStore: StaffStoreLookup = () => undefined,
): boolean {
  if (adminScope.type === 'global') return true;
  if (assignments.length === 0) return false;
  return assignments.every((a) => scopeContains(adminScope, a.scope, storeRegion, staffStore));
}

// ---------------------------------------------------------------------------
// Permission matrix (SCR-072)
// ---------------------------------------------------------------------------

/** The matrix letters of SCR-072: V view · E edit · A approve · X export · M manage. */
export const PERMISSION_LETTERS: Readonly<Record<PermissionAction, string>> = {
  view: 'V',
  edit: 'E',
  approve: 'A',
  export: 'X',
  manage: 'M',
};

/** The letters of one matrix cell as design.md writes them (`V X`), or `null` for "—". */
export function permissionLetters(permission: Permission | null): string | null {
  if (!permission || permission.actions.length === 0) return null;
  return permission.actions.map((a) => PERMISSION_LETTERS[a]).join(' ');
}

// ---------------------------------------------------------------------------
// Audit log (SCR-073)
// ---------------------------------------------------------------------------

/** The event-type filter of SCR-073. */
export const AUDIT_EVENT_CATEGORIES = ['scenario', 'rules', 'data', 'user', 'export', 'other'] as const;
export type AuditEventCategory = (typeof AUDIT_EVENT_CATEGORIES)[number];

/**
 * Event-name prefixes (`object` of `object.verb`) per category. Exports are
 * matched by their `export` action instead; anything else is `other`.
 */
export const AUDIT_CATEGORY_PREFIXES: Readonly<Record<Exclude<AuditEventCategory, 'export' | 'other'>, readonly string[]>> = {
  scenario: ['scenario', 'approval'],
  rules: ['rule_set', 'rule_version', 'rules'],
  data: ['dataset', 'ingestion', 'snapshot', 'region', 'store', 'department', 'staff', 'lane', 'data'],
  user: ['user', 'role'],
};

/** Categories a Rules Steward may see: data and rules events only (RBAC `data_rules_events`). */
export const DATA_RULES_AUDIT_CATEGORIES: readonly AuditEventCategory[] = ['data', 'rules'];

export function auditEventCategory(event: { readonly event: string; readonly action: AuditAction }): AuditEventCategory {
  if (event.action === 'export') return 'export';
  const prefix = event.event.split('.', 1)[0] ?? '';
  for (const [category, prefixes] of Object.entries(AUDIT_CATEGORY_PREFIXES)) {
    if (prefixes.includes(prefix)) return category as AuditEventCategory;
  }
  return 'other';
}

/**
 * The categories `role` may read in the audit log, or `null` for none. A Rules
 * Steward (`data_rules_events` limit) sees data and rules events only; this is
 * applied server-side on every list and export.
 */
export function auditCategoriesFor(role: RoleCode | null): readonly AuditEventCategory[] | null {
  if (role === null) return null;
  const permission = permissionFor(role, 'audit_log');
  if (!permission) return null;
  return permission.limit === 'data_rules_events' ? DATA_RULES_AUDIT_CATEGORIES : AUDIT_EVENT_CATEGORIES;
}

export interface AuditLogQuery {
  /** Inclusive calendar dates (`YYYY-MM-DD`, Asia/Manila). */
  readonly from?: string;
  readonly to?: string;
  readonly userId?: string;
  readonly category?: AuditEventCategory;
  /** Case-insensitive match on the object type, id or name. */
  readonly object?: string;
}

export interface AuditLogEntry {
  readonly id: string;
  readonly at: IsoDateTime;
  readonly user: NamedRef;
  readonly activeRole: RoleCode;
  readonly action: AuditAction;
  readonly event: string;
  readonly category: AuditEventCategory;
  readonly objectType: string;
  readonly objectId: string;
  /** A readable name for the object when it still exists (scenario, user, store…). */
  readonly objectName: string | null;
  readonly before: AuditSnapshot;
  readonly after: AuditSnapshot;
}

export interface AuditLogResponse {
  readonly events: readonly AuditLogEntry[];
  /** More events match than were returned (narrow the filters). */
  readonly truncated: boolean;
  /** People who appear in the visible events, for the user filter. */
  readonly actors: readonly NamedRef[];
  /** The categories this role may filter by. */
  readonly categories: readonly AuditEventCategory[];
}

/** Events per page of SCR-073; the export takes up to `AUDIT_EXPORT_MAX`. */
export const AUDIT_PAGE_SIZE = 200;
export const AUDIT_EXPORT_MAX = 10_000;

export interface AuditChange {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
}

function show(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * The before → after detail of an event (SCR-073 "Detail"): one entry per
 * top-level field whose value changed, in a stable order.
 */
export function auditChanges(before: AuditSnapshot, after: AuditSnapshot): AuditChange[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  const out: AuditChange[] = [];
  for (const field of keys) {
    const b = show(before?.[field]);
    const a = show(after?.[field]);
    if (b !== a) out.push({ field, before: b, after: a });
  }
  return out;
}
