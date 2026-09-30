/**
 * Users and role assignments (DOM-002 User, RoleAssignment). Every mutation
 * records exactly one audit event (P7); role grants/revocations and active-
 * role switches are `role_change` events.
 */
import type {
  Language,
  RoleAssignment,
  RoleCode,
  Scope,
  ScopeType,
  User,
  UserStatus,
} from '@lanewise/shared';
import type pg from 'pg';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { isoOrNull, queryMaybe, queryOne } from '../rows.js';

interface UserRow extends pg.QueryResultRow {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  last_sign_in_at: Date | null;
  active_role: RoleCode | null;
  language: Language;
}

const USER_COLUMNS = 'id, email, name, status, last_sign_in_at, active_role, language';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    lastSignIn: isoOrNull(row.last_sign_in_at),
    activeRole: row.active_role,
    language: row.language,
  };
}

export async function getUser(db: Queryable, id: string): Promise<User | null> {
  const row = await queryMaybe<UserRow>(db, `SELECT ${USER_COLUMNS} FROM app_user WHERE id = $1`, [id]);
  return row && toUser(row);
}

export async function getUserByEmail(db: Queryable, email: string): Promise<User | null> {
  const row = await queryMaybe<UserRow>(db, `SELECT ${USER_COLUMNS} FROM app_user WHERE email = $1`, [
    email.toLowerCase(),
  ]);
  return row && toUser(row);
}

export interface CreateUserInput {
  readonly email: string;
  readonly name: string;
  readonly language?: Language;
  readonly synthetic?: boolean;
}

export async function createUser(tx: AuditedTx, input: CreateUserInput): Promise<User> {
  const row = await queryOne<UserRow>(
    tx,
    `INSERT INTO app_user (email, name, language, synthetic) VALUES ($1, $2, $3, $4) RETURNING ${USER_COLUMNS}`,
    [input.email.toLowerCase(), input.name, input.language ?? 'en', input.synthetic ?? false],
  );
  const user = toUser(row);
  await audit.record(tx, {
    action: 'create',
    event: 'user.created',
    objectType: 'user',
    objectId: user.id,
    after: { email: user.email, name: user.name, language: user.language },
    synthetic: input.synthetic ?? false,
  });
  return user;
}

export interface UpdateProfileInput {
  readonly name?: string;
  readonly language?: Language;
}

export async function updateUserProfile(tx: AuditedTx, userId: string, input: UpdateProfileInput): Promise<User> {
  const before = await queryOne<UserRow>(tx, `SELECT ${USER_COLUMNS} FROM app_user WHERE id = $1 FOR UPDATE`, [
    userId,
  ]);
  const row = await queryOne<UserRow>(
    tx,
    `UPDATE app_user SET name = coalesce($2, name), language = coalesce($3, language)
      WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [userId, input.name ?? null, input.language ?? null],
  );
  await audit.record(tx, {
    action: 'edit',
    event: 'user.profile_updated',
    objectType: 'user',
    objectId: userId,
    before: { name: before.name, language: before.language },
    after: { name: row.name, language: row.language },
  });
  return toUser(row);
}

/** Switches the user's active role (demo role switcher, task 8.2). */
export async function setActiveRole(tx: AuditedTx, userId: string, role: RoleCode): Promise<User> {
  const before = await queryOne<UserRow>(tx, `SELECT ${USER_COLUMNS} FROM app_user WHERE id = $1 FOR UPDATE`, [
    userId,
  ]);
  const row = await queryOne<UserRow>(
    tx,
    `UPDATE app_user SET active_role = $2 WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [userId, role],
  );
  await audit.record(tx, {
    action: 'role_change',
    event: 'user.active_role_changed',
    objectType: 'user',
    objectId: userId,
    before: { activeRole: before.active_role },
    after: { activeRole: role },
  });
  return toUser(row);
}

interface RoleAssignmentRow extends pg.QueryResultRow {
  user_id: string;
  role: RoleCode;
  scope_type: ScopeType;
  scope_ids: string[];
}

export function scopeToColumns(scope: Scope): { scopeType: ScopeType; scopeIds: string[] } {
  switch (scope.type) {
    case 'global':
      return { scopeType: 'global', scopeIds: [] };
    case 'region':
      return { scopeType: 'region', scopeIds: [...scope.regionIds] };
    case 'store':
      return { scopeType: 'store', scopeIds: [...scope.storeIds] };
    case 'self':
      return { scopeType: 'self', scopeIds: [scope.staffId] };
  }
}

export function scopeFromColumns(scopeType: ScopeType, scopeIds: readonly string[]): Scope {
  switch (scopeType) {
    case 'global':
      return { type: 'global' };
    case 'region':
      return { type: 'region', regionIds: [...scopeIds] };
    case 'store':
      return { type: 'store', storeIds: [...scopeIds] };
    case 'self': {
      const staffId = scopeIds[0];
      if (staffId === undefined) throw new Error('self scope without a staff id');
      return { type: 'self', staffId };
    }
  }
}

function toAssignment(row: RoleAssignmentRow): RoleAssignment {
  return { userId: row.user_id, role: row.role, scope: scopeFromColumns(row.scope_type, row.scope_ids) };
}

export async function listRoleAssignments(db: Queryable, userId: string): Promise<RoleAssignment[]> {
  const { rows } = await db.query<RoleAssignmentRow>(
    'SELECT user_id, role, scope_type, scope_ids FROM role_assignment WHERE user_id = $1 ORDER BY role',
    [userId],
  );
  return rows.map(toAssignment);
}

/** Grants a role (or replaces its scope if already held). */
export async function grantRole(tx: AuditedTx, assignment: RoleAssignment): Promise<RoleAssignment> {
  const { scopeType, scopeIds } = scopeToColumns(assignment.scope);
  const before = await queryMaybe<RoleAssignmentRow>(
    tx,
    'SELECT user_id, role, scope_type, scope_ids FROM role_assignment WHERE user_id = $1 AND role = $2 FOR UPDATE',
    [assignment.userId, assignment.role],
  );
  const row = await queryOne<RoleAssignmentRow>(
    tx,
    `INSERT INTO role_assignment (user_id, role, scope_type, scope_ids, granted_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, role) DO UPDATE
       SET scope_type = EXCLUDED.scope_type, scope_ids = EXCLUDED.scope_ids, granted_by = EXCLUDED.granted_by
     RETURNING user_id, role, scope_type, scope_ids`,
    [assignment.userId, assignment.role, scopeType, scopeIds, tx.actor.userId],
  );
  const granted = toAssignment(row);
  await audit.record(tx, {
    action: 'role_change',
    event: 'role.granted',
    objectType: 'user',
    objectId: assignment.userId,
    before: before && { role: before.role, scope: toAssignment(before).scope },
    after: { role: granted.role, scope: granted.scope },
  });
  return granted;
}

export async function revokeRole(tx: AuditedTx, userId: string, role: RoleCode): Promise<void> {
  const row = await queryOne<RoleAssignmentRow>(
    tx,
    'DELETE FROM role_assignment WHERE user_id = $1 AND role = $2 RETURNING user_id, role, scope_type, scope_ids',
    [userId, role],
  );
  await audit.record(tx, {
    action: 'role_change',
    event: 'role.revoked',
    objectType: 'user',
    objectId: userId,
    before: { role: row.role, scope: toAssignment(row).scope },
    after: null,
  });
}
