/**
 * User administration (SCR-070/071; requirements 1, 2, 22; P1, P7, P13).
 *
 * Each mutation records exactly one audit event for the whole change — an
 * invitation with its role assignments is one `user.invited`, an access edit
 * one `user.access_updated` — so it runs inside `withAuditedTransaction`.
 * Scope rules (an administrator only sees and grants access inside their own
 * scope) are applied by the route with the shared `scopeContains`; this
 * module only reads and writes.
 */
import {
  ROLE_CODES,
  sortRoles,
  type AdminScopeView,
  type AdminUser,
  type NamedRef,
  type RoleAssignment,
  type RoleCode,
  type Scope,
  type ScopeStoreOption,
  type ScopeType,
  type UserStatus,
} from '@lanewise/shared';
import type pg from 'pg';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { isoOrNull, queryMaybe, queryOne } from '../rows.js';
import { scopeFromColumns, scopeToColumns } from './users.js';

// ---------------------------------------------------------------------------
// Organisation lookups (scope checks and names)
// ---------------------------------------------------------------------------

export interface OrgDirectory {
  readonly regions: readonly NamedRef[];
  readonly stores: readonly ScopeStoreOption[];
  readonly regionById: ReadonlyMap<string, NamedRef>;
  readonly storeById: ReadonlyMap<string, ScopeStoreOption>;
}

export async function loadOrg(db: Queryable): Promise<OrgDirectory> {
  const [regions, stores] = await Promise.all([
    db.query<{ id: string; name: string } & pg.QueryResultRow>('SELECT id, name FROM region ORDER BY name, id'),
    db.query<{ id: string; name: string; region_id: string } & pg.QueryResultRow>(
      'SELECT id, name, region_id FROM store WHERE active ORDER BY name, id',
    ),
  ]);
  const regionList = regions.rows.map((r) => ({ id: r.id, name: r.name }));
  const storeList = stores.rows.map((s) => ({ id: s.id, name: s.name, regionId: s.region_id }));
  return {
    regions: regionList,
    stores: storeList,
    regionById: new Map(regionList.map((r) => [r.id, r])),
    storeById: new Map(storeList.map((s) => [s.id, s])),
  };
}

export interface StaffLink {
  readonly id: string;
  readonly name: string;
  readonly storeId: string;
  readonly userId: string | null;
}

interface StaffRow extends pg.QueryResultRow {
  id: string;
  name: string;
  store_id: string;
  user_id: string | null;
}

const toStaff = (r: StaffRow): StaffLink => ({ id: r.id, name: r.name, storeId: r.store_id, userId: r.user_id });

export async function staffByIds(db: Queryable, ids: readonly string[]): Promise<Map<string, StaffLink>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<StaffRow>('SELECT id, name, store_id, user_id FROM staff WHERE id = ANY($1::uuid[])', [
    [...new Set(ids)],
  ]);
  return new Map(rows.map((r) => [r.id, toStaff(r)]));
}

/** The staff record a Staff user is linked to by work email (Q16). */
export async function staffByEmail(db: Queryable, email: string): Promise<StaffLink | null> {
  const row = await queryMaybe<StaffRow>(db, 'SELECT id, name, store_id, user_id FROM staff WHERE email = $1 AND active', [
    email,
  ]);
  return row && toStaff(row);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface AdminUserRow extends pg.QueryResultRow {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  last_sign_in_at: Date | null;
  invited_at: Date | null;
}

interface AssignmentRow extends pg.QueryResultRow {
  user_id: string;
  role: RoleCode;
  scope_type: ScopeType;
  scope_ids: string[];
}

const USER_COLUMNS = 'id, email, name, status, last_sign_in_at, invited_at';

/** A user with their assignments, as loaded for administration. */
export interface ManagedUser {
  readonly row: AdminUserRow;
  readonly assignments: readonly RoleAssignment[];
}

async function assignmentsFor(db: Queryable, userIds: readonly string[] | null): Promise<Map<string, RoleAssignment[]>> {
  const { rows } = await db.query<AssignmentRow>(
    `SELECT user_id, role, scope_type, scope_ids FROM role_assignment
      ${userIds === null ? '' : 'WHERE user_id = ANY($1::uuid[])'} ORDER BY user_id, role`,
    userIds === null ? [] : [[...userIds]],
  );
  const out = new Map<string, RoleAssignment[]>();
  for (const r of rows) {
    const list = out.get(r.user_id) ?? [];
    list.push({ userId: r.user_id, role: r.role, scope: scopeFromColumns(r.scope_type, r.scope_ids) });
    out.set(r.user_id, list);
  }
  return out;
}

export async function listManagedUsers(db: Queryable): Promise<ManagedUser[]> {
  const [{ rows }, assignments] = await Promise.all([
    db.query<AdminUserRow>(`SELECT ${USER_COLUMNS} FROM app_user ORDER BY lower(name), email`),
    assignmentsFor(db, null),
  ]);
  return rows.map((row) => ({ row, assignments: assignments.get(row.id) ?? [] }));
}

export async function getManagedUser(db: Queryable, userId: string, lock = false): Promise<ManagedUser | null> {
  const row = await queryMaybe<AdminUserRow>(
    db,
    `SELECT ${USER_COLUMNS} FROM app_user WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [userId],
  );
  if (!row) return null;
  return { row, assignments: (await assignmentsFor(db, [userId])).get(userId) ?? [] };
}

export async function getManagedUserByEmail(db: Queryable, email: string, lock = false): Promise<ManagedUser | null> {
  const row = await queryMaybe<AdminUserRow>(
    db,
    `SELECT ${USER_COLUMNS} FROM app_user WHERE email = $1${lock ? ' FOR UPDATE' : ''}`,
    [email],
  );
  if (!row) return null;
  return { row, assignments: (await assignmentsFor(db, [row.id])).get(row.id) ?? [] };
}

const SCOPE_RANK: Readonly<Record<Scope['type'], number>> = { global: 3, region: 2, store: 1, self: 0 };

/**
 * The scope a user row shows: the broadest scope of their non-Staff roles
 * (an invitation gives them all the same scope), else the Staff self scope.
 */
export function scopeView(assignments: readonly RoleAssignment[], org: OrgDirectory, staff: ReadonlyMap<string, StaffLink>): AdminScopeView {
  const shared = assignments.filter((a) => a.scope.type !== 'self');
  if (shared.length === 0) {
    const self = assignments.find((a) => a.scope.type === 'self');
    if (!self || self.scope.type !== 'self') return { type: 'none' };
    const record = staff.get(self.scope.staffId);
    return { type: 'self', staff: record ? { id: record.id, name: record.name } : null };
  }
  const broadest = [...shared].sort((a, b) => SCOPE_RANK[b.scope.type] - SCOPE_RANK[a.scope.type])[0]?.scope;
  if (!broadest || broadest.type === 'global') return { type: 'global' };
  if (broadest.type === 'region') {
    const ids = new Set(shared.flatMap((a) => (a.scope.type === 'region' ? a.scope.regionIds : [])));
    return { type: 'region', regions: [...ids].map((id) => org.regionById.get(id) ?? { id, name: id }) };
  }
  const ids = new Set(shared.flatMap((a) => (a.scope.type === 'store' ? a.scope.storeIds : [])));
  return {
    type: 'store',
    stores: [...ids].map((id) => {
      const s = org.storeById.get(id);
      return s ? { id: s.id, name: s.name } : { id, name: id };
    }),
  };
}

export function toAdminUser(user: ManagedUser, org: OrgDirectory, staff: ReadonlyMap<string, StaffLink>): AdminUser {
  return {
    id: user.row.id,
    email: user.row.email,
    name: user.row.name,
    status: user.row.status,
    roles: sortRoles(user.assignments.map((a) => a.role)),
    scope: scopeView(user.assignments, org, staff),
    lastSignIn: isoOrNull(user.row.last_sign_in_at),
    invitedAt: isoOrNull(user.row.invited_at),
  };
}

/** Staff ids referenced by self-scoped assignments. */
export function selfStaffIds(users: readonly ManagedUser[]): string[] {
  return users.flatMap((u) => u.assignments.flatMap((a) => (a.scope.type === 'self' ? [a.scope.staffId] : [])));
}

// ---------------------------------------------------------------------------
// Writes (one audit event each)
// ---------------------------------------------------------------------------

/** What an access change sets: the roles and, per role, its scope. */
export interface AccessGrant {
  readonly roles: readonly RoleCode[];
  /** The scope of every role except Staff. */
  readonly scope: Scope;
  /** The staff record a Staff role is scoped to (required when `roles` has STF). */
  readonly staffId: string | null;
}

/** A JSON snapshot of a user's access for the audit before/after. */
function accessSnapshot(name: string, assignments: readonly Pick<RoleAssignment, 'role' | 'scope'>[]) {
  const sorted = [...assignments].sort((a, b) => ROLE_CODES.indexOf(a.role) - ROLE_CODES.indexOf(b.role));
  return {
    name,
    roles: sortRoles(sorted.map((a) => a.role)),
    scopes: Object.fromEntries(sorted.map((a) => [a.role, a.scope])),
  };
}

function grantAssignments(userId: string, grant: AccessGrant): RoleAssignment[] {
  return sortRoles(grant.roles).map((role) => {
    if (role !== 'STF') return { userId, role, scope: grant.scope };
    if (grant.staffId === null) throw new Error('a Staff role needs a staff record');
    return { userId, role, scope: { type: 'self', staffId: grant.staffId } };
  });
}

/** Replaces a user's role assignments and the Staff link (no audit: the caller records the one event). */
async function replaceAccess(tx: AuditedTx, userId: string, grant: AccessGrant): Promise<RoleAssignment[]> {
  await tx.query('DELETE FROM role_assignment WHERE user_id = $1', [userId]);
  const assignments = grantAssignments(userId, grant);
  for (const a of assignments) {
    const { scopeType, scopeIds } = scopeToColumns(a.scope);
    await tx.query(
      'INSERT INTO role_assignment (user_id, role, scope_type, scope_ids, granted_by) VALUES ($1, $2, $3, $4, $5)',
      [userId, a.role, scopeType, scopeIds, tx.actor.userId],
    );
  }
  await tx.query('UPDATE staff SET user_id = NULL WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)', [
    userId,
    grant.staffId,
  ]);
  if (grant.staffId !== null) await tx.query('UPDATE staff SET user_id = $1 WHERE id = $2', [userId, grant.staffId]);
  return assignments;
}

export interface InviteInput extends AccessGrant {
  readonly email: string;
  readonly name: string;
}

/**
 * Invites a new user (`user.invited`, a create) or re-invites a deactivated
 * one (`user.reinvited`, a role change), with their role assignments.
 * Returns the user id.
 */
export async function inviteUser(tx: AuditedTx, input: InviteInput, existing: ManagedUser | null): Promise<string> {
  if (existing === null) {
    const row = await queryOne<{ id: string } & pg.QueryResultRow>(
      tx,
      `INSERT INTO app_user (email, name, status, invited_at, invited_by)
       VALUES ($1, $2, 'invited', now(), $3) RETURNING id`,
      [input.email, input.name, tx.actor.userId],
    );
    const assignments = await replaceAccess(tx, row.id, input);
    await audit.record(tx, {
      action: 'create',
      event: 'user.invited',
      objectType: 'user',
      objectId: row.id,
      after: { email: input.email, status: 'invited', ...accessSnapshot(input.name, assignments) },
    });
    return row.id;
  }
  const id = existing.row.id;
  await tx.query(
    `UPDATE app_user SET status = 'invited', name = $2, invited_at = now(), invited_by = $3, deactivated_at = NULL
      WHERE id = $1`,
    [id, input.name, tx.actor.userId],
  );
  const assignments = await replaceAccess(tx, id, input);
  await audit.record(tx, {
    action: 'role_change',
    event: 'user.reinvited',
    objectType: 'user',
    objectId: id,
    before: { status: existing.row.status, ...accessSnapshot(existing.row.name, existing.assignments) },
    after: { status: 'invited', ...accessSnapshot(input.name, assignments) },
  });
  return id;
}

/** Nothing would change: the caller rolls back and records no event. */
export class NoChange extends Error {
  constructor() {
    super('no change');
    this.name = 'NoChange';
  }
}

export interface UpdateAccessInput {
  readonly name: string;
  /** `null` keeps the current roles and scopes. */
  readonly grant: AccessGrant | null;
}

/**
 * Changes a user's name and/or access: one `user.access_updated` role change
 * (or `user.updated` edit when only the name changed). Throws `NoChange`
 * (nothing recorded) when nothing would change.
 */
export async function updateUserAccess(tx: AuditedTx, user: ManagedUser, input: UpdateAccessInput): Promise<void> {
  const before = accessSnapshot(user.row.name, user.assignments);
  const nextAssignments = input.grant ? grantAssignments(user.row.id, input.grant) : user.assignments;
  const after = accessSnapshot(input.name, nextAssignments);
  const accessChanged = JSON.stringify(before.scopes) !== JSON.stringify(after.scopes);
  if (!accessChanged && before.name === after.name) throw new NoChange();
  if (before.name !== after.name) await tx.query('UPDATE app_user SET name = $2 WHERE id = $1', [user.row.id, input.name]);
  if (accessChanged && input.grant) await replaceAccess(tx, user.row.id, input.grant);
  await audit.record(tx, {
    action: accessChanged ? 'role_change' : 'edit',
    event: accessChanged ? 'user.access_updated' : 'user.updated',
    objectType: 'user',
    objectId: user.row.id,
    before,
    after,
  });
}

/** Deactivates a user (`user.deactivated`). Their assignments and work stay for the record. */
export async function deactivateUser(tx: AuditedTx, user: ManagedUser): Promise<void> {
  await tx.query(`UPDATE app_user SET status = 'disabled', deactivated_at = now() WHERE id = $1`, [user.row.id]);
  await audit.record(tx, {
    action: 'edit',
    event: 'user.deactivated',
    objectType: 'user',
    objectId: user.row.id,
    before: { status: user.row.status },
    after: { status: 'disabled' },
  });
}

/** Re-sends a pending invitation (`user.invitation_resent`). */
export async function resendInvitation(tx: AuditedTx, user: ManagedUser): Promise<void> {
  const row = await queryOne<{ invited_at: Date } & pg.QueryResultRow>(
    tx,
    'UPDATE app_user SET invited_at = now(), invited_by = $2 WHERE id = $1 RETURNING invited_at',
    [user.row.id, tx.actor.userId],
  );
  await audit.record(tx, {
    action: 'edit',
    event: 'user.invitation_resent',
    objectType: 'user',
    objectId: user.row.id,
    before: { invitedAt: isoOrNull(user.row.invited_at) },
    after: { invitedAt: row.invited_at.toISOString() },
  });
}

/**
 * The first verified sign-in of an invited user (`user.activated`, recorded
 * with the user as the actor): links the Cognito identity and makes them active.
 */
export async function activateInvitedUser(tx: AuditedTx, userId: string, cognitoSub: string): Promise<void> {
  const { rowCount } = await tx.query(
    `UPDATE app_user SET status = 'active', last_sign_in_at = now(), cognito_sub = coalesce(cognito_sub, $2)
      WHERE id = $1 AND status = 'invited'`,
    [userId, cognitoSub],
  );
  if (rowCount !== 1) throw new NoChange();
  await audit.record(tx, {
    action: 'edit',
    event: 'user.activated',
    objectType: 'user',
    objectId: userId,
    before: { status: 'invited' },
    after: { status: 'active' },
  });
}
