/**
 * RBAC matrix as data (design.md › RBAC matrix; requirements 2 and 3; P12).
 *
 * The API authorises every request against `can(activeRole, resource,
 * action)` and the active role's scope; the SPA uses the same data to hide
 * navigation the role cannot use (requirement 2.3). A test parses the matrix
 * table in design.md and asserts this file matches it cell by cell, so the two
 * cannot drift.
 *
 * Action semantics: every listed action also implies `view`, and `manage`
 * (create/edit/delete) also implies `edit`. Cell qualifiers such as "own
 * store" or "published only" are carried as `limit`; they narrow a grant and
 * are applied by the scope model (store/self scopes) or by the feature that
 * owns the resource.
 */
import { ROLE_CODES, type RoleAssignment, type RoleCode } from './roles.js';

/** V = view, E = edit, A = approve/publish, X = export, M = manage. */
export const PERMISSION_ACTIONS = ['view', 'edit', 'approve', 'export', 'manage'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** One resource per capability row of the matrix, in matrix order. */
export const RBAC_RESOURCES = [
  'home',
  'network_view',
  'department_plan',
  'weekly_roster',
  'shift_edit',
  'staff_availability',
  'my_roster',
  'network_map',
  'shift_offers_send',
  'staff_lending',
  'shift_offers_respond',
  'staff_requests_raise',
  'staff_requests_approve',
  'home_area_consent',
  'hiring_plan',
  'leadership_summary',
  'scenario_settings',
  'scenarios',
  'scenario_submit',
  'approval_headcount',
  'approval_budget',
  'approval_offsystem',
  'approval_plan',
  'cost_figures',
  'data_ingestion',
  'master_data',
  'staff_records',
  'rules',
  'rules_cost_approval',
  'rules_noncost_publish',
  'users_roles',
  'audit_log',
  'own_profile',
] as const;
export type RbacResource = (typeof RBAC_RESOURCES)[number];

/** The capability label of each resource, verbatim from design.md. */
export const RBAC_RESOURCE_LABELS: Readonly<Record<RbacResource, string>> = {
  home: 'Home dashboard',
  network_view: 'Network view (SCR-020)',
  department_plan: 'Department day plan (SCR-021)',
  weekly_roster: 'Weekly roster (SCR-022)',
  shift_edit: 'Edit shifts: times, add/remove, reassign, emergency off',
  staff_availability: 'Staff availability',
  my_roster: 'My roster (SCR-025)',
  network_map: 'Network map (SCR-026)',
  shift_offers_send: 'Send open-shift offers / request staff from another store',
  staff_lending: 'Approve lending own staff to another store',
  shift_offers_respond: 'Accept / decline shift offers',
  staff_requests_raise: 'Raise time-off / swap request',
  staff_requests_approve: 'Approve staff time-off / swap request',
  home_area_consent: 'Share home area and travel limit (consent)',
  hiring_plan: 'Hiring plan (SCR-023)',
  leadership_summary: 'Leadership summary (SCR-024)',
  scenario_settings: 'Scenarios: create / duplicate / edit settings',
  scenarios: 'Scenarios: view / compare',
  scenario_submit: 'Submit scenario for approval',
  approval_headcount: 'Approve headcount',
  approval_budget: 'Approve budget',
  approval_offsystem: 'Record headcount/budget secured outside the system',
  approval_plan: 'Approve / reject / publish plan',
  cost_figures: 'Cost figures (₱)',
  data_ingestion: 'Data ingestion and upload (SCR-050/051)',
  master_data: 'Stores / departments / lanes (SCR-052)',
  staff_records: 'Staff records (SCR-053)',
  rules: 'Business rules: edit / submit',
  rules_cost_approval: 'Business rules: approve cost rules',
  rules_noncost_publish: 'Business rules: publish non-cost rules',
  users_roles: 'Users and roles (SCR-070–072)',
  audit_log: 'Audit log (SCR-073)',
  own_profile: 'Own profile, passkeys, language, notification preferences',
};

/** Qualifiers from the matrix cells, e.g. "V (own store)". */
export const PERMISSION_LIMITS = [
  'own_shifts',
  'own_store',
  'own',
  'draft_scenarios',
  'published_roster_own_store',
  'own_store_gaps_pseudonymised_candidates',
  'published_only',
  'data_rules_events',
] as const;
export type PermissionLimit = (typeof PERMISSION_LIMITS)[number];

export interface Permission {
  readonly actions: readonly PermissionAction[];
  readonly limit?: PermissionLimit;
}

type Row = Readonly<Partial<Record<RoleCode, Permission>>>;

const V: Permission = { actions: ['view'] };
const VX: Permission = { actions: ['view', 'export'] };
const E: Permission = { actions: ['edit'] };
const M: Permission = { actions: ['manage'] };
const A: Permission = { actions: ['approve'] };
const all = (p: Permission): Row => Object.fromEntries(ROLE_CODES.map((r) => [r, p])) as Row;

/** The matrix. A missing role means "— no access". */
export const RBAC_MATRIX: Readonly<Record<RbacResource, Row>> = {
  home: { ADM: V, EXE: V, PLN: V, STM: V, HR: V, FIN: V, RST: V, STF: { actions: ['view'], limit: 'own_shifts' } },
  network_view: { EXE: VX, PLN: VX, STM: { actions: ['view'], limit: 'own_store' }, HR: VX, FIN: VX, RST: V },
  department_plan: { EXE: V, PLN: VX, STM: VX, HR: V, FIN: V, RST: V },
  weekly_roster: {
    EXE: V,
    PLN: { actions: ['view', 'edit', 'export'] },
    STM: { actions: ['view', 'manage', 'export'] },
    HR: VX,
    FIN: V,
  },
  shift_edit: {
    PLN: { actions: ['edit'], limit: 'draft_scenarios' },
    STM: { actions: ['manage'], limit: 'published_roster_own_store' },
  },
  staff_availability: { PLN: E, STM: E, HR: M },
  my_roster: { STF: V },
  network_map: {
    EXE: V,
    PLN: V,
    STM: { actions: ['view'], limit: 'own_store_gaps_pseudonymised_candidates' },
    HR: V,
  },
  shift_offers_send: { PLN: E, STM: { actions: ['edit'], limit: 'own_store' } },
  staff_lending: { PLN: E, STM: { actions: ['edit'], limit: 'own_store' } },
  shift_offers_respond: { STF: E },
  staff_requests_raise: { STF: { actions: ['edit'], limit: 'own' } },
  staff_requests_approve: { STM: { actions: ['manage'], limit: 'own_store' } },
  home_area_consent: { STF: { actions: ['edit'], limit: 'own' } },
  hiring_plan: {
    EXE: VX,
    PLN: { actions: ['view', 'edit', 'export'] },
    STM: { actions: ['view'], limit: 'own_store' },
    HR: VX,
    FIN: VX,
  },
  leadership_summary: { EXE: VX, PLN: VX, HR: VX, FIN: VX },
  scenario_settings: { PLN: M },
  scenarios: { EXE: V, PLN: V, STM: { actions: ['view'], limit: 'published_only' }, HR: V, FIN: V, RST: V },
  scenario_submit: { PLN: E },
  approval_headcount: { EXE: V, HR: A, FIN: V },
  approval_budget: { EXE: V, HR: V, FIN: A },
  approval_offsystem: { EXE: E },
  approval_plan: { EXE: A, HR: V, FIN: V },
  cost_figures: { EXE: V, PLN: V, STM: V, HR: V, FIN: V },
  data_ingestion: { ADM: V, PLN: V, RST: M },
  master_data: { EXE: V, PLN: V, STM: { actions: ['view'], limit: 'own' }, HR: V, RST: M },
  staff_records: { PLN: V, STM: { actions: ['view', 'edit'], limit: 'own_store' }, HR: M, RST: V },
  rules: { EXE: V, PLN: V, HR: V, FIN: V, RST: M },
  rules_cost_approval: { FIN: A },
  rules_noncost_publish: { RST: A },
  users_roles: { ADM: M },
  audit_log: { ADM: VX, RST: { actions: ['view'], limit: 'data_rules_events' } },
  own_profile: all(E),
};

/** The matrix cell for a role and resource, or `null` for "— no access". */
export function permissionFor(role: RoleCode, resource: RbacResource): Permission | null {
  return RBAC_MATRIX[resource][role] ?? null;
}

function grantedActions(permission: Permission | null): PermissionAction[] {
  if (!permission || permission.actions.length === 0) return [];
  const granted = new Set<PermissionAction>(permission.actions);
  granted.add('view');
  if (granted.has('manage')) granted.add('edit');
  return PERMISSION_ACTIONS.filter((a) => granted.has(a));
}

/**
 * Whether `role` may perform `action` on `resource`. A `null` role (not yet
 * resolved, or none selectable) is never granted anything (P12).
 */
export function can(role: RoleCode | null, resource: RbacResource, action: PermissionAction): boolean {
  if (role === null) return false;
  return grantedActions(permissionFor(role, resource)).includes(action);
}

/** Every resource the role can use, with the actions it grants (implied ones included). */
export function effectivePermissions(role: RoleCode | null): Partial<Record<RbacResource, PermissionAction[]>> {
  const out: Partial<Record<RbacResource, PermissionAction[]>> = {};
  if (role === null) return out;
  for (const resource of RBAC_RESOURCES) {
    const actions = grantedActions(permissionFor(role, resource));
    if (actions.length > 0) out[resource] = actions;
  }
  return out;
}

/** Left-nav items (design.md › App shell). An item shows when any of its resources is viewable. */
export const NAV_ITEMS = [
  { key: 'home', screen: 'SCR-010', resources: ['home'] },
  { key: 'network', screen: 'SCR-020', resources: ['network_view'] },
  { key: 'department_plan', screen: 'SCR-021', resources: ['department_plan'] },
  { key: 'roster', screen: 'SCR-022', resources: ['weekly_roster'] },
  { key: 'my_roster', screen: 'SCR-025', resources: ['my_roster'] },
  { key: 'network_map', screen: 'SCR-026', resources: ['network_map'] },
  { key: 'hiring_plan', screen: 'SCR-023', resources: ['hiring_plan'] },
  { key: 'leadership_summary', screen: 'SCR-024', resources: ['leadership_summary'] },
  { key: 'scenarios', screen: 'SCR-030', resources: ['scenarios', 'scenario_settings'] },
  { key: 'approvals', screen: 'SCR-033', resources: ['approval_headcount', 'approval_budget', 'approval_plan'] },
  { key: 'data_sources', screen: 'SCR-050', resources: ['data_ingestion'] },
  { key: 'master_data', screen: 'SCR-052', resources: ['master_data'] },
  { key: 'staff', screen: 'SCR-053', resources: ['staff_records', 'staff_availability'] },
  { key: 'rules', screen: 'SCR-060', resources: ['rules', 'rules_cost_approval', 'rules_noncost_publish'] },
  { key: 'users', screen: 'SCR-070', resources: ['users_roles'] },
  { key: 'audit_log', screen: 'SCR-073', resources: ['audit_log'] },
  { key: 'profile', screen: 'SCR-080', resources: ['own_profile'] },
] as const satisfies readonly { key: string; screen: string; resources: readonly RbacResource[] }[];

export type NavKey = (typeof NAV_ITEMS)[number]['key'];

/** Nav keys the role may see; inaccessible items are hidden, never disabled (requirement 2.3). */
export function visibleNav(role: RoleCode | null): NavKey[] {
  return NAV_ITEMS.filter((item) =>
    (item.resources as readonly RbacResource[]).some((r) => can(role, r, 'view')),
  ).map((item) => item.key);
}

/**
 * Roles the user may make active: all 8 in demo mode (requirement 3.1),
 * otherwise only the roles they are assigned (requirement 3.5). Matrix order.
 */
export function selectableRoles(assignments: readonly RoleAssignment[], demoMode: boolean): RoleCode[] {
  if (demoMode) return [...ROLE_CODES];
  const held = new Set(assignments.map((a) => a.role));
  return ROLE_CODES.filter((r) => held.has(r));
}

export interface ActiveRoleInput {
  /** The `X-Active-Role` request header, if sent (untrusted). */
  readonly header?: string | undefined;
  /** The role the user last switched to, as stored server-side. */
  readonly persisted?: RoleCode | null;
  readonly assignments: readonly RoleAssignment[];
  readonly demoMode: boolean;
}

export type ActiveRoleResult = { readonly ok: true; readonly role: RoleCode | null } | { readonly ok: false };

/**
 * Picks the active role for a request. A header naming anything other than a
 * selectable role is rejected (`ok: false` → 403); without a header the stored
 * choice is used if still selectable, then the first assigned role, else none.
 */
export function resolveActiveRole(input: ActiveRoleInput): ActiveRoleResult {
  const allowed = selectableRoles(input.assignments, input.demoMode);
  if (input.header !== undefined) {
    const role = allowed.find((r) => r === input.header);
    return role === undefined ? { ok: false } : { ok: true, role };
  }
  if (input.persisted && allowed.includes(input.persisted)) return { ok: true, role: input.persisted };
  const assigned = selectableRoles(input.assignments, false);
  return { ok: true, role: assigned[0] ?? null };
}
