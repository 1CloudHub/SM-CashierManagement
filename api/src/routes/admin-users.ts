/**
 * User administration — `/admin/users` and `/admin/scope-options` (SCR-070
 * Users, SCR-071 Invite / edit user; requirements 1, 2, 22; P1, P7, P12, P13).
 *
 * Every route declares its task 8.1 guard on the RBAC row "Users and roles"
 * (`users_roles`: System Admin manages): `view` to read, `manage` to change.
 * Scope (P1): an administrator sees and changes only users whose every role
 * assignment is inside their own scope, and grants only scopes inside it; a
 * user outside it answers the same 404 as a missing one. The work email must
 * be on the smretail.com / 1cloudhub.com allowlist (P13; the database checks
 * it again). Each mutation records exactly one audit event (P7) in the same
 * transaction as the Cognito call, so a failed invitation leaves no trace.
 */
import {
  ADMIN_USER_STATUS_FILTERS,
  DOMAIN_NOT_ALLOWED_MESSAGE,
  ROLE_CODES,
  SCOPE_IDS_MAX,
  USER_NAME_MAX,
  checkInviteEmail,
  isUserInAdminScope,
  scopeContains,
  scopeFromAdminInput,
  sortRoles,
  type AdminScopeInput,
  type AdminUser,
  type AdminUserListResponse,
  type AdminUserResponse,
  type RoleCode,
  type Scope,
  type ScopeOptions,
} from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/guards.js';
import { isUuid } from '../auth/scope.js';
import { DirectoryConflictError, type UserDirectory } from '../auth/user-directory.js';
import { requirePrincipal, type Principal, type RequestContext } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction, type AuditedTx } from '../db/audit.js';
import {
  NoChange,
  deactivateUser,
  getManagedUser,
  getManagedUserByEmail,
  inviteUser,
  listManagedUsers,
  loadOrg,
  resendInvitation,
  selfStaffIds,
  staffByEmail,
  staffByIds,
  toAdminUser,
  updateUserAccess,
  type ManagedUser,
  type OrgDirectory,
  type StaffLink,
} from '../db/repositories/admin-users.js';
import { PG_ERRORS, pgErrorCode } from '../db/rows.js';
import { ApiError, errors } from '../http/errors.js';
import type { Router } from '../http/router.js';
import type { ApiResponse, RoutedRequest } from '../http/types.js';
import { parseInput } from '../http/validation.js';

export interface AdminUserRouteDeps {
  readonly db: () => pg.Pool;
  readonly rbac: { readonly demoRoleSwitcher: boolean };
  /** The Cognito directory; `null` (or absent) when no user pool is configured. */
  readonly directory?: () => UserDirectory | null;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const ids = z.array(z.string().refine(isUuid, { message: 'Not a valid id.' })).min(1).max(SCOPE_IDS_MAX);
const scopeSchema: z.ZodType<AdminScopeInput> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }).strict(),
  z.object({ type: z.literal('region'), regionIds: ids }).strict(),
  z.object({ type: z.literal('store'), storeIds: ids }).strict(),
]);
const roles = z.array(z.enum(ROLE_CODES)).min(1, { message: 'Choose at least one role.' }).max(ROLE_CODES.length);
const name = z.string().max(USER_NAME_MAX).transform((s) => s.trim());

const inviteBody = z
  .object({ email: z.string().max(320), name: name.optional(), roles, scope: scopeSchema.optional() })
  .strict();
const updateBody = z
  .object({ name: name.optional(), roles: roles.optional(), scope: scopeSchema.optional() })
  .strict()
  .refine((b) => b.name !== undefined || b.roles !== undefined || b.scope !== undefined, {
    message: 'Nothing to change.',
  });
const listQuery = z
  .object({
    role: z.enum(ROLE_CODES).optional(),
    status: z.enum(ADMIN_USER_STATUS_FILTERS).optional(),
    q: z.string().max(200).optional(),
  })
  .passthrough();

const invalid = (path: string, message: string) => errors.validationFailed('Some fields are missing or invalid.', [{ path, message }]);

// ---------------------------------------------------------------------------
// Scope (P1)
// ---------------------------------------------------------------------------

interface AdminView {
  readonly scope: Scope;
  readonly org: OrgDirectory;
  readonly storeRegion: (id: string) => string | undefined;
}

function adminScope(principal: Principal): Scope {
  if (principal.scope === null) throw errors.forbidden();
  return principal.scope;
}

async function adminView(db: pg.Pool, principal: Principal): Promise<AdminView> {
  const org = await loadOrg(db);
  return { scope: adminScope(principal), org, storeRegion: (id) => org.storeById.get(id)?.regionId };
}

function staffStoreOf(staff: ReadonlyMap<string, StaffLink>) {
  return (id: string) => staff.get(id)?.storeId;
}

function visible(view: AdminView, user: ManagedUser, staff: ReadonlyMap<string, StaffLink>): boolean {
  return isUserInAdminScope(view.scope, user.assignments, view.storeRegion, staffStoreOf(staff));
}

/** The users an administrator (or any scoped reader) may see — the P1 filter shared with the audit log. */
export async function usersInScope(db: pg.Pool, principal: Principal): Promise<{ view: AdminView; users: ManagedUser[]; staff: Map<string, StaffLink> }> {
  const [view, all] = await Promise.all([adminView(db, principal), listManagedUsers(db)]);
  const staff = await staffByIds(db, selfStaffIds(all));
  return { view, users: all.filter((u) => visible(view, u, staff)), staff };
}

/** The regions and stores inside the administrator's scope (what SCR-071 offers). */
export function scopeOptions(view: AdminView): ScopeOptions {
  const { scope, org } = view;
  switch (scope.type) {
    case 'global':
      return { regions: org.regions, stores: org.stores };
    case 'region':
      return {
        regions: org.regions.filter((r) => scope.regionIds.includes(r.id)),
        stores: org.stores.filter((s) => scope.regionIds.includes(s.regionId)),
      };
    case 'store':
      return { regions: [], stores: org.stores.filter((s) => scope.storeIds.includes(s.id)) };
    case 'self':
      return { regions: [], stores: [] };
  }
}

/** Loads a user the administrator may manage, or the same 404 as a missing one (Req 2.4). */
async function managedUser(db: pg.Pool, view: AdminView, userId: string | undefined, lock?: AuditedTx): Promise<ManagedUser> {
  if (userId === undefined || !isUuid(userId)) throw errors.notFoundOrNoAccess();
  const user = await getManagedUser(lock ?? db, userId, lock !== undefined);
  if (!user) throw errors.notFoundOrNoAccess();
  const staff = await staffByIds(lock ?? db, selfStaffIds([user]));
  if (!visible(view, user, staff)) throw errors.notFoundOrNoAccess();
  return user;
}

async function respondUser(db: pg.Pool, view: AdminView, userId: string, statusCode = 200): Promise<ApiResponse> {
  const user = await getManagedUser(db, userId);
  if (!user) throw errors.notFound();
  const staff = await staffByIds(db, selfStaffIds([user]));
  const body: AdminUserResponse = { user: toAdminUser(user, view.org, staff) };
  return { statusCode, body };
}

/** Checks the scope ids exist and the grant is inside the administrator's scope. */
function grantScope(view: AdminView, input: AdminScopeInput): Scope {
  if (input.type === 'region' && input.regionIds.some((id) => !view.org.regionById.has(id))) {
    throw invalid('body.scope.regionIds', 'Choose regions from the list.');
  }
  if (input.type === 'store' && input.storeIds.some((id) => !view.org.storeById.has(id))) {
    throw invalid('body.scope.storeIds', 'Choose stores from the list.');
  }
  const scope = scopeFromAdminInput(input);
  if (!scopeContains(view.scope, scope, view.storeRegion)) throw errors.forbidden();
  return scope;
}

/** The staff record a Staff role is scoped to: matched by work email (Q16) and inside the administrator scope. */
async function staffFor(db: pg.Pool, view: AdminView, email: string, userId: string | null): Promise<string> {
  const staff = await staffByEmail(db, email);
  if (!staff) throw invalid('body.roles', 'No staff record uses this work email, so the Staff role can’t be linked.');
  if (staff.userId !== null && staff.userId !== userId) {
    throw errors.conflict('That staff record is already linked to another user.');
  }
  const scope: Scope = { type: 'self', staffId: staff.id };
  if (!scopeContains(view.scope, scope, view.storeRegion, () => staff.storeId)) throw errors.forbidden();
  return staff.id;
}

/** The shared (non-Staff) scope a user holds today, used when an edit changes roles only. */
function currentSharedScope(user: ManagedUser): Scope | null {
  const shared = user.assignments.filter((a) => a.scope.type !== 'self');
  return shared.find((a) => a.scope.type === 'global')?.scope ?? shared[0]?.scope ?? null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Runs one audited change (DB writes, the audit event, then Cognito) atomically. */
async function mutate(db: pg.Pool, principal: Principal, context: RequestContext, fn: (tx: AuditedTx) => Promise<unknown>): Promise<void> {
  try {
    await withAuditedTransaction(db, actorFromPrincipal(principal, context.requestId), fn);
  } catch (error) {
    if (error instanceof NoChange || error instanceof ApiError) throw error;
    const code = pgErrorCode(error);
    if (code === PG_ERRORS.uniqueViolation) throw errors.conflict('Someone with this work email already has an account.');
    if (code === PG_ERRORS.checkViolation) throw invalid('body.email', DOMAIN_NOT_ALLOWED_MESSAGE);
    throw error;
  }
}

/**
 * Calls the Cognito directory inside the mutation's transaction: a failure
 * rolls the change and its audit event back and answers 503 (409 for an
 * invitation that can no longer be resent).
 */
async function inDirectory(context: RequestContext, call: (() => Promise<void>) | null): Promise<void> {
  if (call === null) return;
  try {
    await call();
  } catch (error) {
    if (error instanceof DirectoryConflictError) throw errors.conflict(error.message);
    context.logger.error('user directory call failed', { error: error instanceof Error ? error.name : 'unknown' });
    throw errors.serviceUnavailable();
  }
}

function displayName(email: string, typed: string | undefined): string {
  return typed && typed.length > 0 ? typed : email.slice(0, email.indexOf('@'));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const VIEW = authorize('users_roles', 'view');
const MANAGE = authorize('users_roles', 'manage');

export function registerAdminUserRoutes(router: Router, deps: AdminUserRouteDeps): Router {
  const directory = (): UserDirectory | null => deps.directory?.() ?? null;
  const userIdOf = (request: RoutedRequest) => request.params.userId;

  return router
    .get('/admin/scope-options', VIEW, async (_request, context) => {
      const view = await adminView(deps.db(), requirePrincipal(context));
      return { statusCode: 200, body: scopeOptions(view) };
    })
    .get('/admin/users', VIEW, async (request, context) => {
      const query = parseInput(listQuery, request.query, 'query');
      const db = deps.db();
      const { view, users, staff } = await usersInScope(db, requirePrincipal(context));
      const q = query.q?.trim().toLowerCase() ?? '';
      const list: AdminUser[] = users
        .map((u) => toAdminUser(u, view.org, staff))
        .filter((u) => query.role === undefined || u.roles.includes(query.role))
        .filter((u) => query.status === undefined || query.status === 'all' || u.status === query.status)
        .filter((u) => q.length === 0 || u.name.toLowerCase().includes(q) || u.email.includes(q));
      const body: AdminUserListResponse = { users: list, demoMode: deps.rbac.demoRoleSwitcher };
      return { statusCode: 200, body };
    })
    .get('/admin/users/:userId', VIEW, async (request, context) => {
      const db = deps.db();
      const view = await adminView(db, requirePrincipal(context));
      const user = await managedUser(db, view, userIdOf(request));
      return respondUser(db, view, user.row.id);
    })
    .post('/admin/users', MANAGE, async (request, context) => {
      const principal = requirePrincipal(context);
      const body = parseInput(inviteBody, request.body ?? {}, 'body');
      const checked = checkInviteEmail(body.email);
      if (!checked.ok) {
        throw invalid('body.email', checked.problem === 'required' ? 'Enter a work email.' : DOMAIN_NOT_ALLOWED_MESSAGE);
      }
      const email = checked.email;
      const db = deps.db();
      const view = await adminView(db, principal);
      const roleList = sortRoles(body.roles);
      const shared = roleList.some((r) => r !== 'STF');
      if (shared && body.scope === undefined) throw invalid('body.scope', 'Choose a data scope.');
      const scope = shared && body.scope ? grantScope(view, body.scope) : { type: 'global' as const };
      const existing = await getManagedUserByEmail(db, email);
      if (existing && existing.row.status !== 'disabled') {
        throw errors.conflict('Someone with this work email already has an account. Edit their roles instead.');
      }
      const staffId = roleList.includes('STF') ? await staffFor(db, view, email, existing?.row.id ?? null) : null;
      const userName = displayName(email, body.name);
      let userId = '';
      await mutate(db, principal, context, async (tx) => {
        const locked = await getManagedUserByEmail(tx, email, true);
        if (locked && locked.row.status !== 'disabled') throw errors.conflict('Someone with this work email already has an account.');
        userId = await inviteUser(tx, { email, name: userName, roles: roleList, scope, staffId }, locked);
        const dir = directory();
        await inDirectory(context, dir && (() => dir.invite(email, { name: userName, resend: false })));
      });
      return respondUser(db, view, userId, 201);
    })
    .patch('/admin/users/:userId', MANAGE, async (request, context) => {
      const principal = requirePrincipal(context);
      const body = parseInput(updateBody, request.body ?? {}, 'body');
      const db = deps.db();
      const view = await adminView(db, principal);
      const target = await managedUser(db, view, userIdOf(request));
      const nextRoles: RoleCode[] = body.roles ? sortRoles(body.roles) : sortRoles(target.assignments.map((a) => a.role));
      if (target.row.id === principal.userId && !nextRoles.includes('ADM')) {
        throw errors.conflict('You can’t remove your own System Admin role.');
      }
      let grant = null;
      if (body.roles !== undefined || body.scope !== undefined) {
        const shared = nextRoles.some((r) => r !== 'STF');
        let scope: Scope = { type: 'global' };
        if (shared) {
          if (body.scope) scope = grantScope(view, body.scope);
          else {
            const current = currentSharedScope(target);
            if (current === null) throw invalid('body.scope', 'Choose a data scope.');
            scope = current;
          }
        }
        const staffId = nextRoles.includes('STF') ? await staffFor(db, view, target.row.email, target.row.id) : null;
        grant = { roles: nextRoles, scope, staffId };
      }
      try {
        await mutate(db, principal, context, async (tx) => {
          const locked = await managedUser(db, view, target.row.id, tx);
          await updateUserAccess(tx, locked, { name: body.name && body.name.length > 0 ? body.name : locked.row.name, grant });
        });
      } catch (error) {
        if (!(error instanceof NoChange)) throw error;
      }
      return respondUser(db, view, target.row.id);
    })
    .post('/admin/users/:userId/deactivate', MANAGE, async (request, context) => {
      const principal = requirePrincipal(context);
      const db = deps.db();
      const view = await adminView(db, principal);
      const target = await managedUser(db, view, userIdOf(request));
      if (target.row.id === principal.userId) throw errors.conflict('You can’t deactivate your own account.');
      await mutate(db, principal, context, async (tx) => {
        const locked = await managedUser(db, view, target.row.id, tx);
        if (locked.row.status === 'disabled') throw errors.conflict('This user is already deactivated.');
        await deactivateUser(tx, locked);
        const dir = directory();
        await inDirectory(context, dir && (() => dir.disable(locked.row.email)));
      });
      return respondUser(db, view, target.row.id);
    })
    .post('/admin/users/:userId/resend', MANAGE, async (request, context) => {
      const principal = requirePrincipal(context);
      const db = deps.db();
      const view = await adminView(db, principal);
      const target = await managedUser(db, view, userIdOf(request));
      await mutate(db, principal, context, async (tx) => {
        const locked = await managedUser(db, view, target.row.id, tx);
        if (locked.row.status !== 'invited') throw errors.conflict('Only a pending invitation can be resent.');
        await resendInvitation(tx, locked);
        const dir = directory();
        await inDirectory(context, dir && (() => dir.invite(locked.row.email, { name: locked.row.name, resend: true })));
      });
      return respondUser(db, view, target.row.id);
    });
}
