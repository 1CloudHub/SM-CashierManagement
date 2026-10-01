/**
 * Data scope for the active role (design.md › Roles and data scope; P1, P11).
 *
 * Scope kinds: global, region(s), store(s) and self (a Staff user's own staff
 * record). A role the user is assigned uses that assignment's scope; a role
 * taken through the demo role switcher uses its demo scope.
 */
import { isStoreInScope, type RoleAssignment, type RoleCode, type Scope } from '@lanewise/shared';
import type pg from 'pg';
import type { Principal } from '../context.js';
import type { Queryable } from '../db/pool.js';
import type { RbacConfig } from './config.js';
import type { ScopeTarget } from './guards.js';

/** Matches no row: used when a demo store/cashier isn't seeded, so the scope is empty. */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

async function demoStoreId(db: Queryable, config: RbacConfig): Promise<string | null> {
  const { rows } = await db.query<{ id: string } & pg.QueryResultRow>('SELECT id FROM store WHERE code = $1', [
    config.demoStoreCode,
  ]);
  return rows[0]?.id ?? null;
}

async function demoStaffId(db: Queryable, config: RbacConfig): Promise<string | null> {
  const { rows } = await db.query<{ id: string } & pg.QueryResultRow>(
    `SELECT s.id FROM staff s JOIN store st ON st.id = s.store_id
      WHERE st.code = $1 AND s.employee_no = $2 AND s.synthetic`,
    [config.demoStoreCode, config.demoStaffEmployeeNo],
  );
  return rows[0]?.id ?? null;
}

/**
 * The scope `role` applies with: the user's own assignment when they hold the
 * role, otherwise the demo scope (Planner = all regions, Store Manager = the
 * demo store, Staff = the demo cashier, the others = global). Call only for a
 * role that `resolveActiveRole` accepted.
 */
export async function resolveScope(
  db: Queryable,
  role: RoleCode,
  assignments: readonly RoleAssignment[],
  config: RbacConfig,
): Promise<Scope> {
  const held = assignments.find((a) => a.role === role);
  if (held) return held.scope;
  switch (role) {
    case 'STM': {
      const id = await demoStoreId(db, config);
      return { type: 'store', storeIds: id ? [id] : [] };
    }
    case 'STF':
      return { type: 'self', staffId: (await demoStaffId(db, config)) ?? NIL_UUID };
    default:
      return { type: 'global' };
  }
}

/**
 * Whether the object a deep link addresses exists **and** is in scope (for a
 * saved view or notification: belongs to the caller). The caller answers `false` with the
 * same 404 whether the object is missing or out of scope, so nothing about it
 * is revealed (requirement 2.4).
 */
export async function isTargetInScope(
  db: Queryable,
  principal: Pick<Principal, 'userId' | 'scope'>,
  target: ScopeTarget,
  id: string,
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const scope = principal.scope;
  if (scope === null) return false;
  switch (target.kind) {
    case 'saved_view': {
      const { rows } = await db.query<{ id: string } & pg.QueryResultRow>(
        'SELECT id FROM saved_view WHERE id = $1 AND user_id = $2',
        [id, principal.userId],
      );
      return rows.length === 1;
    }
    case 'notification': {
      const { rows } = await db.query<{ id: string } & pg.QueryResultRow>(
        'SELECT id FROM notification WHERE id = $1 AND user_id = $2',
        [id, principal.userId],
      );
      return rows.length === 1;
    }
    case 'store': {
      const { rows } = await db.query<{ id: string; region_id: string } & pg.QueryResultRow>(
        'SELECT id, region_id FROM store WHERE id = $1',
        [id],
      );
      const row = rows[0];
      return row !== undefined && isStoreInScope(scope, { id: row.id, regionId: row.region_id });
    }
    case 'department': {
      const { rows } = await db.query<{ store_id: string; region_id: string } & pg.QueryResultRow>(
        'SELECT d.store_id, st.region_id FROM department d JOIN store st ON st.id = d.store_id WHERE d.id = $1',
        [id],
      );
      const row = rows[0];
      return row !== undefined && isStoreInScope(scope, { id: row.store_id, regionId: row.region_id });
    }
    case 'staff': {
      const { rows } = await db.query<{ id: string; store_id: string; region_id: string } & pg.QueryResultRow>(
        'SELECT s.id, s.store_id, st.region_id FROM staff s JOIN store st ON st.id = s.store_id WHERE s.id = $1',
        [id],
      );
      const row = rows[0];
      if (row === undefined) return false;
      // Staff see only their own record (P11); others by the record's store.
      if (scope.type === 'self') return row.id === scope.staffId;
      return isStoreInScope(scope, { id: row.store_id, regionId: row.region_id });
    }
  }
}
