/**
 * Resolves the caller for a request (task 8.1, P12): the app user matched by
 * the verified email claim, their role assignments (from the database, on
 * every request), the active role (the `X-Active-Role` header, validated) and
 * that role's scope. No other client-supplied identity is read.
 */
import { resolveActiveRole, type RoleCode, type UserStatus } from '@lanewise/shared';
import type pg from 'pg';
import type { Identity, Principal } from '../context.js';
import type { Queryable } from '../db/pool.js';
import { listRoleAssignments } from '../db/repositories/users.js';
import { errors } from '../http/errors.js';
import type { RbacConfig } from './config.js';
import { resolveScope } from './scope.js';

/** Lower-case header name as the Lambda adapter delivers it. */
export const ACTIVE_ROLE_HEADER_KEY = 'x-active-role';

interface AppUserRow extends pg.QueryResultRow {
  id: string;
  name: string;
  status: UserStatus;
  active_role: RoleCode | null;
}

export async function findAppUser(db: Queryable, email: string): Promise<AppUserRow | null> {
  const { rows } = await db.query<AppUserRow>('SELECT id, name, status, active_role FROM app_user WHERE email = $1', [
    email,
  ]);
  return rows[0] ?? null;
}

/**
 * Resolves the principal for a signed-in identity. Returns `null` when the
 * user has no `app_user` row yet (demo self sign-up before the first role
 * choice). Throws 403 for a disabled user or an `X-Active-Role` header naming
 * a role the user may not select.
 */
export async function resolvePrincipal(
  db: Queryable,
  identity: Identity,
  activeRoleHeader: string | undefined,
  config: RbacConfig,
): Promise<Principal | null> {
  const user = await findAppUser(db, identity.email);
  if (!user) {
    // Still validate the header so an unprovisioned caller gets the same answer.
    const check = resolveActiveRole({ header: activeRoleHeader, assignments: [], demoMode: config.demoRoleSwitcher });
    if (!check.ok) throw errors.forbidden();
    return null;
  }
  if (user.status !== 'active') throw errors.forbidden();

  const assignments = await listRoleAssignments(db, user.id);
  const active = resolveActiveRole({
    header: activeRoleHeader,
    persisted: user.active_role,
    assignments,
    demoMode: config.demoRoleSwitcher,
  });
  if (!active.ok) throw errors.forbidden();
  const scope = active.role === null ? null : await resolveScope(db, active.role, assignments, config);
  return {
    userId: user.id,
    email: identity.email,
    name: user.name,
    activeRole: active.role,
    assignments,
    scope,
    demoMode: config.demoRoleSwitcher,
  };
}
