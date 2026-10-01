/**
 * Shared setup for the API journey tests (design.md › User journeys J1–J11).
 *
 * Each journey file seeds the demo network once (`seedDemoData` on a fresh
 * migrated database) and walks a journey through the real app router —
 * `createApp` with the real RBAC enforcer, cost shaping, audited
 * transactions and the in-process job queue — as the seeded demo users, one
 * per role, sending the active role as `X-Active-Role` like the SPA does.
 *
 * Raw SQL is used only for setup the API has no route for (a published
 * weekly roster, extra Staff accounts linked to seeded cashiers) and for
 * reading back what a step wrote (audit events, shifts).
 */
import { ROLE_CODES, type RoleCode, type Scope } from '@lanewise/shared';
import type pg from 'pg';
import { expect } from 'vitest';
import { createApp } from '../../src/app.js';
import { DEFAULT_RBAC_CONFIG, type RbacConfig } from '../../src/auth/config.js';
import type { InviteOptions, UserDirectory } from '../../src/auth/user-directory.js';
import { demoUserId } from '../../src/db/demo/dataset.js';
import { seedDemoData } from '../../src/db/demo/seed.js';
import { scopeToColumns } from '../../src/db/repositories/users.js';
import type { Router } from '../../src/http/router.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { dispatch, identity, type TestResponse } from '../support/dispatch.js';
import { MemoryStorage } from '../support/memory-storage.js';

/** A Cognito directory that records calls and never reaches AWS. */
export class FakeDirectory implements UserDirectory {
  readonly calls: { op: 'invite' | 'disable'; email: string; resend: boolean }[] = [];
  async invite(email: string, options: InviteOptions): Promise<void> {
    this.calls.push({ op: 'invite', email, resend: options.resend });
  }
  async disable(email: string): Promise<void> {
    this.calls.push({ op: 'disable', email, resend: false });
  }
}

export interface AuditRow {
  readonly seq: number;
  readonly user_id: string;
  readonly active_role: RoleCode;
  readonly action: string;
  readonly event: string;
  readonly object_type: string;
  readonly object_id: string;
  readonly after: Record<string, unknown> | null;
}

export interface CallOptions {
  readonly body?: unknown;
  readonly query?: Record<string, string>;
}

export interface Journey {
  readonly db: TestDatabase;
  readonly pool: pg.Pool;
  /** The app with the demo role switcher on (the demo deployment). */
  readonly app: Router;
  /** The same app with the demo role switcher off (production RBAC). */
  readonly strictApp: Router;
  readonly directory: FakeDirectory;
  /** Work email of the seeded demo user holding each role. */
  readonly emails: Readonly<Record<RoleCode, string>>;
  /** As the seeded user of `role`, acting in `role`. */
  call(role: RoleCode, method: string, path: string, options?: CallOptions): Promise<TestResponse>;
  /** As any user (by email) with active role `role`; `strict` uses the app without the role switcher. */
  as(email: string, role: RoleCode | undefined, method: string, path: string, options?: CallOptions & { strict?: boolean }): Promise<TestResponse>;
  count(sql: string, values?: unknown[]): Promise<number>;
  one<T extends pg.QueryResultRow>(sql: string, values?: unknown[]): Promise<T>;
  auditSeq(): Promise<number>;
  /** Audit events written after `seq`, oldest first. */
  auditSince(seq: number): Promise<AuditRow[]>;
  /**
   * Runs `step` and checks P7 for it: a success writes exactly one audit
   * event, by `userId` in `role`; a refusal writes none. Returns the response
   * and the event (if any).
   */
  audited(
    expected: { status: number; userId?: string; role?: RoleCode; event?: string },
    step: () => Promise<TestResponse>,
  ): Promise<{ res: TestResponse; event: AuditRow | null }>;
  dispose(): Promise<void>;
}

export async function setupJourney(options: { rbac?: Partial<RbacConfig> } = {}): Promise<Journey> {
  const db = await createTestDatabase();
  await seedDemoData(db.pool);
  const { rows } = await db.pool.query<{ id: string; email: string }>('SELECT id, email FROM app_user');
  const emails = {} as Record<RoleCode, string>;
  for (const role of ROLE_CODES) {
    const user = rows.find((r) => r.id === demoUserId(role));
    if (!user) throw new Error(`demo user for ${role} missing`);
    emails[role] = user.email;
  }
  const directory = new FakeDirectory();
  const storage = new MemoryStorage();
  const deps = (switcher: boolean) => ({
    db: () => db.pool,
    rbac: { ...DEFAULT_RBAC_CONFIG, ...options.rbac, demoRoleSwitcher: switcher },
    storage: () => storage,
    directory: () => directory,
  });
  const app = createApp(deps(true));
  const strictApp = createApp(deps(false));

  const as: Journey['as'] = (email, role, method, path, o = {}) =>
    dispatch(o.strict ? strictApp : app, method, path, {
      identity: identity(email),
      ...(role ? { role } : {}),
      ...(o.body === undefined ? {} : { body: o.body }),
      ...(o.query ? { query: o.query } : {}),
    });
  const count = async (sql: string, values: unknown[] = []) => {
    const r = await db.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) x`, values);
    return r.rows[0]?.n ?? 0;
  };
  const one = async <T extends pg.QueryResultRow>(sql: string, values: unknown[] = []) => {
    const r = await db.pool.query<T>(sql, values);
    if (!r.rows[0]) throw new Error(`no row: ${sql}`);
    return r.rows[0];
  };
  const auditSeq = async () => Number((await one<{ n: string }>('SELECT coalesce(max(seq), 0)::text AS n FROM audit_event')).n);
  const auditSince = async (seq: number) =>
    (
      await db.pool.query<AuditRow>(
        `SELECT seq::int, user_id, active_role, action, event, object_type, object_id, after FROM audit_event WHERE seq > $1 ORDER BY seq`,
        [seq],
      )
    ).rows;

  return {
    db,
    pool: db.pool,
    app,
    strictApp,
    directory,
    emails,
    call: (role, method, path, o = {}) => as(emails[role], role, method, path, o),
    as,
    count,
    one,
    auditSeq,
    auditSince,
    async audited(expected, step) {
      const before = await auditSeq();
      const res = await step();
      expect(res.status, JSON.stringify(res.body)).toBe(expected.status);
      const events = await auditSince(before);
      if (res.status >= 300) {
        expect(events, 'a refused action writes no audit event').toEqual([]);
        return { res, event: null };
      }
      expect(events.map((e) => e.event), 'exactly one audit event per action (P7)').toHaveLength(1);
      const event = events[0] as AuditRow;
      if (expected.userId) expect(event.user_id).toBe(expected.userId);
      if (expected.role) expect(event.active_role).toBe(expected.role);
      if (expected.event) expect(event.event).toBe(expected.event);
      return { res, event };
    },
    dispose: () => db.dispose(),
  };
}

/**
 * Test setup with no API: a Staff account (role STF, self scope) linked to
 * an existing seeded cashier, as an administrator would provision it.
 */
export async function staffAccount(pool: pg.Pool, staffId: string, email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(`INSERT INTO app_user (email, name) VALUES ($1, $2) RETURNING id`, [email, email]);
  const userId = rows[0]?.id ?? '';
  await pool.query('UPDATE staff SET user_id = $2 WHERE id = $1', [staffId, userId]);
  await assign(pool, userId, [{ role: 'STF', scope: { type: 'self', staffId } }]);
  return userId;
}

export async function assign(pool: pg.Pool, userId: string, assignments: readonly { role: RoleCode; scope: Scope }[]): Promise<void> {
  for (const a of assignments) {
    const { scopeType, scopeIds } = scopeToColumns(a.scope);
    await pool.query('INSERT INTO role_assignment (user_id, role, scope_type, scope_ids) VALUES ($1, $2, $3, $4)', [userId, a.role, scopeType, scopeIds]);
  }
}

/** `YYYY-MM-DD` + local minutes after midnight (Asia/Manila, UTC+8) as an ISO instant. */
export function manila(date: string, minutes: number): string {
  return new Date(Date.parse(`${date}T00:00:00+08:00`) + minutes * 60_000).toISOString();
}

/** Test setup with no API (rosters are published by the planning pipeline): a published weekly roster. */
export async function publishedRoster(pool: pg.Pool, storeId: string, departmentId: string, from: string, to: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO roster (store_id, department_id, period_start, period_end, status, published_at, synthetic)
     VALUES ($1, $2, $3, $4, 'published', now(), true) RETURNING id`,
    [storeId, departmentId, from, to],
  );
  return rows[0]?.id ?? '';
}

export async function insertShift(
  pool: pg.Pool,
  rosterId: string,
  departmentId: string,
  staffId: string | null,
  date: string,
  startH: number,
  endH: number,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO shift (roster_id, staff_id, department_id, starts_at, ends_at, synthetic) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
    [rosterId, staffId, departmentId, manila(date, startH * 60), manila(date, endH * 60)],
  );
  return rows[0]?.id ?? '';
}
