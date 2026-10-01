/**
 * `/admin/users`, `/admin/scope-options` and `/audit-events` (SCR-070..073;
 * requirements 1, 2, 22; P1, P7, P12, P13).
 *
 * Runs against a real PostgreSQL seeded with the demo network, through the
 * app router with the real RBAC enforcer and a fake Cognito directory.
 * Property tests: P13 (no account outside the allowlist), P7 (exactly one
 * audit event per successful mutation, none for a refused one) and P1 (a
 * scoped administrator sees and grants only inside their scope).
 */
import {
  ALLOWED_EMAIL_DOMAINS,
  ROLE_CODES,
  type AdminUser,
  type AuditLogResponse,
  type RoleCode,
  type Scope,
} from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import type { InviteOptions, UserDirectory } from '../../src/auth/user-directory.js';
import { demoUserId } from '../../src/db/demo/dataset.js';
import { seedDemoData } from '../../src/db/demo/seed.js';
import type { Router } from '../../src/http/router.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { dispatch, identity, type TestResponse } from '../support/dispatch.js';
import { MemoryStorage } from '../support/memory-storage.js';
import { insertAppUser, insertRegion, insertStaff, insertStore, setAssignments, uniq } from '../support/rbac.js';

class FakeDirectory implements UserDirectory {
  readonly calls: { op: 'invite' | 'disable'; email: string; resend?: boolean }[] = [];
  failNext = false;
  async invite(email: string, options: InviteOptions): Promise<void> {
    this.check();
    this.calls.push({ op: 'invite', email, resend: options.resend });
  }
  async disable(email: string): Promise<void> {
    this.check();
    this.calls.push({ op: 'disable', email });
  }
  private check(): void {
    if (this.failNext) {
      this.failNext = false;
      throw Object.assign(new Error('boom'), { name: 'InternalErrorException' });
    }
  }
}

let db: TestDatabase;
let app: Router;
const directory = new FakeDirectory();
const emails = {} as Record<RoleCode, string>;

async function as(email: string, role: RoleCode, method: string, target: string, body?: unknown): Promise<TestResponse> {
  const [path, search] = target.split('?', 2) as [string, string | undefined];
  const query = search === undefined ? {} : { query: Object.fromEntries(new URLSearchParams(search)) };
  return dispatch(app, method, path, { identity: identity(email), role, ...query, ...(body === undefined ? {} : { body }) });
}
const adm = (method: string, path: string, body?: unknown) => as(emails.ADM, 'ADM', method, path, body);

async function count(sql: string, values: unknown[] = []): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]?.n ?? 0;
}
const auditCount = () => count('audit_event');
const newEmail = (domain = 'smretail.com') => `user.${uniq()}@${domain}`;

let regions: { id: string; name: string }[] = [];
let stores: { id: string; regionId: string }[] = [];

beforeAll(async () => {
  db = await createTestDatabase();
  await seedDemoData(db.pool);
  const { rows } = await db.pool.query<{ id: string; email: string }>('SELECT id, email FROM app_user');
  for (const role of ROLE_CODES) emails[role] = rows.find((r) => r.id === demoUserId(role))?.email ?? '';
  regions = (await db.pool.query<{ id: string; name: string }>('SELECT id, name FROM region ORDER BY name')).rows;
  stores = (await db.pool.query<{ id: string; region_id: string }>('SELECT id, region_id FROM store ORDER BY code')).rows.map((s) => ({
    id: s.id,
    regionId: s.region_id,
  }));
  app = createApp({
    db: () => db.pool,
    rbac: DEFAULT_RBAC_CONFIG,
    storage: () => new MemoryStorage(),
    directory: () => directory,
  });
});

afterAll(async () => {
  await db?.dispose();
});

beforeEach(() => {
  directory.calls.length = 0;
  directory.failNext = false;
});

describe('guards (RBAC rows "Users and roles" and "Audit log")', () => {
  it('only the System Admin reaches /admin/*', async () => {
    for (const role of ROLE_CODES) {
      const res = await as(emails[role], role, 'GET', '/admin/users');
      expect(res.status, role).toBe(role === 'ADM' ? 200 : 403);
      const invite = await as(emails[role], role, 'POST', '/admin/users', { email: newEmail(), roles: ['PLN'], scope: { type: 'global' } });
      expect(invite.status, role).toBe(role === 'ADM' ? 201 : 403);
    }
  });

  it('the audit log is read by ADM and RST; only ADM exports', async () => {
    for (const role of ROLE_CODES) {
      const list = await as(emails[role], role, 'GET', '/audit-events');
      expect(list.status, role).toBe(role === 'ADM' || role === 'RST' ? 200 : 403);
      const exp = await as(emails[role], role, 'GET', '/audit-events/export');
      expect(exp.status, role).toBe(role === 'ADM' ? 200 : 403);
    }
  });
});

describe('SCR-070/071 invite, edit, deactivate, resend', () => {
  it('invites a user with roles and a region scope: one user.invited event and one Cognito invitation', async () => {
    const before = await auditCount();
    const email = newEmail('1cloudhub.com');
    const res = await adm('POST', '/admin/users', {
      email: ` ${email.toUpperCase()} `,
      name: 'Ana Reyes',
      roles: ['HR', 'PLN'],
      scope: { type: 'region', regionIds: [regions[0]?.id] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const user = res.body.user as AdminUser;
    expect(user).toMatchObject({ email, name: 'Ana Reyes', status: 'invited', roles: ['PLN', 'HR'] });
    expect(user.scope).toEqual({ type: 'region', regions: [regions[0]] });
    expect(await auditCount()).toBe(before + 1);
    const { rows } = await db.pool.query('SELECT event, action, object_id FROM audit_event ORDER BY seq DESC LIMIT 1');
    expect(rows[0]).toMatchObject({ event: 'user.invited', action: 'create', object_id: user.id });
    expect(directory.calls).toEqual([{ op: 'invite', email, resend: false }]);

    const list = await adm('GET', '/admin/users?status=invited&role=HR');
    expect((list.body.users as AdminUser[]).map((u) => u.id)).toContain(user.id);
    expect(list.body.demoMode).toBe(true);
    expect((await adm('GET', `/admin/users/${user.id}`)).body.user).toEqual(user);
  });

  it('refuses a duplicate, an unknown store and a missing scope without writing', async () => {
    const email = newEmail();
    expect((await adm('POST', '/admin/users', { email, roles: ['EXE'], scope: { type: 'global' } })).status).toBe(201);
    const before = await auditCount();
    directory.calls.length = 0;
    expect((await adm('POST', '/admin/users', { email, roles: ['EXE'], scope: { type: 'global' } })).status).toBe(409);
    const unknown = await adm('POST', '/admin/users', {
      email: newEmail(),
      roles: ['STM'],
      scope: { type: 'store', storeIds: ['00000000-0000-4000-8000-000000000000'] },
    });
    expect(unknown.status).toBe(422);
    expect((await adm('POST', '/admin/users', { email: newEmail(), roles: ['STM'] })).status).toBe(422);
    expect((await adm('POST', '/admin/users', { email: newEmail(), roles: [], scope: { type: 'global' } })).status).toBe(422);
    expect(await auditCount()).toBe(before);
    expect(directory.calls).toEqual([]);
  });

  it('rolls the invitation back when Cognito fails', async () => {
    const before = await auditCount();
    const email = newEmail();
    directory.failNext = true;
    const res = await adm('POST', '/admin/users', { email, roles: ['FIN'], scope: { type: 'global' } });
    expect(res.status).toBe(503);
    expect(await auditCount()).toBe(before);
    expect(await count('app_user WHERE email = $1', [email])).toBe(0);
  });

  it('links a Staff role to the staff record with the same work email', async () => {
    const staffEmail = newEmail();
    const staffId = await insertStaff(db.pool, stores[0]!.id, 'Ben Cruz');
    await db.pool.query('UPDATE staff SET email = $1 WHERE id = $2', [staffEmail, staffId]);
    const res = await adm('POST', '/admin/users', { email: staffEmail, roles: ['STF'] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const user = res.body.user as AdminUser;
    expect(user.scope).toEqual({ type: 'self', staff: { id: staffId, name: 'Ben Cruz' } });
    expect(await count('staff WHERE id = $1 AND user_id = $2', [staffId, user.id])).toBe(1);
    // No staff record for the email: refused.
    expect((await adm('POST', '/admin/users', { email: newEmail(), roles: ['STF'] })).status).toBe(422);
  });

  it('edits roles and scope in one user.access_updated event; a no-op edit records nothing', async () => {
    const created = await adm('POST', '/admin/users', { email: newEmail(), roles: ['PLN'], scope: { type: 'global' } });
    const id = (created.body.user as AdminUser).id;
    const before = await auditCount();
    const res = await adm('PATCH', `/admin/users/${id}`, { roles: ['PLN', 'FIN'], scope: { type: 'store', storeIds: [stores[1]?.id] } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user).toMatchObject({ roles: ['PLN', 'FIN'], scope: { type: 'store' } });
    expect(await auditCount()).toBe(before + 1);
    const { rows } = await db.pool.query('SELECT event, action FROM audit_event ORDER BY seq DESC LIMIT 1');
    expect(rows[0]).toEqual({ event: 'user.access_updated', action: 'role_change' });
    expect((await adm('PATCH', `/admin/users/${id}`, { roles: ['FIN', 'PLN'] })).status).toBe(200);
    expect(await auditCount()).toBe(before + 1);
  });

  it('deactivates (Cognito disabled, API refused) and re-invites; resends only pending invitations', async () => {
    const email = newEmail();
    const created = await adm('POST', '/admin/users', { email, roles: ['EXE'], scope: { type: 'global' } });
    const id = (created.body.user as AdminUser).id;
    directory.calls.length = 0;

    const resend = await adm('POST', `/admin/users/${id}/resend`);
    expect(resend.status).toBe(200);
    expect(directory.calls).toEqual([{ op: 'invite', email, resend: true }]);

    // First sign-in activates the invited user (one user.activated event).
    const before = await auditCount();
    const me = await as(email, 'EXE', 'GET', '/me');
    expect(me.status).toBe(200);
    expect(await auditCount()).toBe(before + 1);
    expect((await adm('GET', `/admin/users/${id}`)).body.user.status).toBe('active');
    expect((await adm('POST', `/admin/users/${id}/resend`)).status).toBe(409);

    const off = await adm('POST', `/admin/users/${id}/deactivate`);
    expect(off.status).toBe(200);
    expect(off.body.user.status).toBe('disabled');
    expect(directory.calls.at(-1)).toEqual({ op: 'disable', email });
    expect((await as(email, 'EXE', 'GET', '/me')).status).toBe(403);
    expect((await adm('POST', `/admin/users/${id}/deactivate`)).status).toBe(409);

    const again = await adm('POST', '/admin/users', { email, roles: ['HR'], scope: { type: 'global' } });
    expect(again.status).toBe(201);
    expect(again.body.user).toMatchObject({ id, status: 'invited', roles: ['HR'] });
  });

  it('an administrator cannot deactivate themselves or drop their own System Admin role', async () => {
    const self = demoUserId('ADM');
    expect((await adm('POST', `/admin/users/${self}/deactivate`)).status).toBe(409);
    expect((await adm('PATCH', `/admin/users/${self}`, { roles: ['EXE'] })).status).toBe(409);
  });
});

describe('P13: no account is created outside the allowlist', () => {
  it('rejects every non-allowlisted email with 422 and writes nothing', async () => {
    const local = fc.stringMatching(/^[a-z][a-z0-9.]{0,10}[a-z0-9]$/).filter((s) => !s.includes('..'));
    const domain = fc.oneof(
      fc.domain().filter((d) => !(ALLOWED_EMAIL_DOMAINS as readonly string[]).includes(d.toLowerCase())),
      fc.constantFrom('it.smretail.com', 'smretail.com.evil.io', 'evilsmretail.com', '1cloudhub.co'),
    );
    await fc.assert(
      fc.asyncProperty(local, domain, async (l, d) => {
        const users = await count('app_user');
        const events = await auditCount();
        const res = await adm('POST', '/admin/users', { email: `${l}@${d}`, roles: ['PLN'], scope: { type: 'global' } });
        expect(res.status).toBe(422);
        expect(await count('app_user')).toBe(users);
        expect(await auditCount()).toBe(events);
      }),
      { numRuns: 25 },
    );
    expect(directory.calls).toEqual([]);
    expect(await count(`app_user WHERE email !~ '@(smretail\\.com|1cloudhub\\.com)$'`)).toBe(0);
  });
});

describe('P7: one audit event per administrative mutation', () => {
  type Cmd =
    | { kind: 'invite'; roles: RoleCode[]; dup: boolean }
    | { kind: 'update'; roles: RoleCode[] }
    | { kind: 'deactivate' }
    | { kind: 'resend' }
    | { kind: 'export' };
  const roleSet = fc.subarray(['EXE', 'PLN', 'HR', 'FIN', 'RST'] as RoleCode[], { minLength: 1 });
  const cmd: fc.Arbitrary<Cmd> = fc.oneof(
    fc.record({ kind: fc.constant('invite' as const), roles: roleSet, dup: fc.boolean() }),
    fc.record({ kind: fc.constant('update' as const), roles: roleSet }),
    fc.constant({ kind: 'deactivate' as const }),
    fc.constant({ kind: 'resend' as const }),
    fc.constant({ kind: 'export' as const }),
  );

  it('a 2xx mutation adds exactly one event; a refused one adds none', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(cmd, { minLength: 1, maxLength: 6 }), async (cmds) => {
        const email = newEmail();
        let id: string | null = null;
        let held = '';
        const key = (roles: RoleCode[]) => [...new Set(roles)].sort().join(',');
        for (const c of cmds) {
          const before = await auditCount();
          let res: TestResponse;
          switch (c.kind) {
            case 'invite':
              res = await adm('POST', '/admin/users', { email: c.dup || id === null ? email : newEmail(), roles: c.roles, scope: { type: 'global' } });
              if (res.status === 201 && (id === null || (res.body.user as AdminUser).id === id)) {
                id = (res.body.user as AdminUser).id;
                held = key(c.roles);
              }
              break;
            case 'update':
              if (id === null) continue;
              res = await adm('PATCH', `/admin/users/${id}`, { roles: c.roles });
              if (res.status === 200 && key(c.roles) === held) {
                // A no-op edit (same roles) changes nothing and records nothing.
                expect((await auditCount()) - before).toBe(0);
                continue;
              }
              held = key(c.roles);
              break;
            case 'deactivate':
            case 'resend':
              if (id === null) continue;
              res = await adm('POST', `/admin/users/${id}/${c.kind}`);
              break;
            case 'export':
              res = await adm('GET', '/audit-events/export');
              break;
          }
          const added = (await auditCount()) - before;
          expect(added, `${c.kind} ${res.status}`).toBe(res.status >= 200 && res.status < 300 ? 1 : 0);
        }
      }),
      { numRuns: 12 },
    );
  });
});

describe('P1: a scoped administrator sees and grants only inside their scope', () => {
  let scopedEmail = '';
  let regionA = '';
  let regionB = '';
  let storeA = '';
  let storeB = '';
  let insideId = '';
  let outsideId = '';

  beforeAll(async () => {
    regionA = await insertRegion(db.pool);
    regionB = await insertRegion(db.pool);
    storeA = await insertStore(db.pool, regionA);
    storeB = await insertStore(db.pool, regionB);
    scopedEmail = newEmail();
    const adminId = await insertAppUser(db.pool, scopedEmail, { activeRole: 'ADM' });
    await setAssignments(db.pool, adminId, [{ role: 'ADM', scope: { type: 'region', regionIds: [regionA] } }]);
    insideId = await insertAppUser(db.pool, newEmail());
    await setAssignments(db.pool, insideId, [{ role: 'STM', scope: { type: 'store', storeIds: [storeA] } }]);
    outsideId = await insertAppUser(db.pool, newEmail());
    await setAssignments(db.pool, outsideId, [{ role: 'STM', scope: { type: 'store', storeIds: [storeB] } }]);
  });

  const scoped = (method: string, path: string, body?: unknown) => as(scopedEmail, 'ADM', method, path, body);

  it('lists, reads and changes only users inside the scope; outside answers 404', async () => {
    const ids = ((await scoped('GET', '/admin/users')).body.users as AdminUser[]).map((u) => u.id);
    expect(ids).toContain(insideId);
    expect(ids).not.toContain(outsideId);
    expect((await scoped('GET', `/admin/users/${outsideId}`)).status).toBe(404);
    expect((await scoped('POST', `/admin/users/${outsideId}/deactivate`)).status).toBe(404);
    expect((await scoped('GET', `/admin/users/${insideId}`)).status).toBe(200);
  });

  it('offers and grants only scopes inside its own', async () => {
    const options = (await scoped('GET', '/admin/scope-options')).body;
    expect(options.regions.map((r: { id: string }) => r.id)).toEqual([regionA]);
    expect(options.stores.map((s: { id: string }) => s.id)).toEqual([storeA]);
    const before = await auditCount();
    for (const scope of [{ type: 'global' }, { type: 'region', regionIds: [regionB] }, { type: 'store', storeIds: [storeB] }]) {
      expect((await scoped('POST', '/admin/users', { email: newEmail(), roles: ['PLN'], scope })).status).toBe(403);
    }
    expect(await auditCount()).toBe(before);
    expect((await scoped('POST', '/admin/users', { email: newEmail(), roles: ['PLN'], scope: { type: 'store', storeIds: [storeA] } })).status).toBe(201);
  });

  it('every listed user holds only stores inside the scope (random assignments)', async () => {
    const storeRegion = new Map([...stores.map((s) => [s.id, s.regionId] as const), [storeA, regionA], [storeB, regionB]]);
    const scopeArb: fc.Arbitrary<Scope> = fc.oneof(
      fc.constant<Scope>({ type: 'global' }),
      fc.subarray([regionA, regionB], { minLength: 1 }).map((regionIds): Scope => ({ type: 'region', regionIds })),
      fc.subarray([storeA, storeB], { minLength: 1 }).map((storeIds): Scope => ({ type: 'store', storeIds })),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(scopeArb, { minLength: 1, maxLength: 3 }), async (scopes) => {
        const id = await insertAppUser(db.pool, newEmail());
        await setAssignments(db.pool, id, scopes.map((scope, i) => ({ role: (['PLN', 'HR', 'FIN'] as const)[i] ?? 'PLN', scope })));
        const listed = ((await scoped('GET', '/admin/users')).body.users as AdminUser[]).some((u) => u.id === id);
        const inside = scopes.every(
          (s) =>
            (s.type === 'region' && s.regionIds.every((r) => r === regionA)) ||
            (s.type === 'store' && s.storeIds.every((st) => storeRegion.get(st) === regionA)),
        );
        expect(listed).toBe(inside);
      }),
      { numRuns: 15 },
    );
  });

  it('the audit log shows a scoped administrator only events by users inside the scope', async () => {
    const res = await scoped('GET', '/audit-events');
    expect(res.status).toBe(200);
    const body = res.body as AuditLogResponse;
    const allowed = new Set(((await scoped('GET', '/admin/users')).body.users as AdminUser[]).map((u) => u.id));
    expect(body.events.length).toBeGreaterThan(0);
    for (const e of body.events) expect(allowed.has(e.user.id)).toBe(true);
    expect(body.events.some((e) => e.user.id === demoUserId('ADM'))).toBe(false);
  });
});

describe('SCR-073 audit log', () => {
  it('lists newest first with names, filters by type, user and object', async () => {
    const res = await adm('GET', '/audit-events?category=user');
    expect(res.status).toBe(200);
    const body = res.body as AuditLogResponse;
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events.every((e) => e.category === 'user')).toBe(true);
    const at = body.events.map((e) => e.at);
    expect([...at].sort().reverse()).toEqual(at);
    const invited = body.events.find((e) => e.event === 'user.invited');
    expect(invited?.objectName).toBeTruthy();
    expect(body.actors.some((a) => a.id === demoUserId('ADM'))).toBe(true);

    const byUser = (await adm('GET', `/audit-events?userId=${demoUserId('ADM')}`)).body as AuditLogResponse;
    expect(byUser.events.every((e) => e.user.id === demoUserId('ADM'))).toBe(true);
    const byObject = (await adm('GET', `/audit-events?object=${encodeURIComponent(invited?.objectName ?? '')}`)).body as AuditLogResponse;
    expect(byObject.events.some((e) => e.id === invited?.id)).toBe(true);
    expect((await adm('GET', '/audit-events?from=2026-10-05&to=2026-10-01')).status).toBe(422);
    const future = (await adm('GET', '/audit-events?from=2999-01-01')).body as AuditLogResponse;
    expect(future.events).toEqual([]);
  });

  it('a Rules Steward sees data and rules events only, whatever they ask for', async () => {
    const all = (await as(emails.RST, 'RST', 'GET', '/audit-events')).body as AuditLogResponse;
    expect(all.categories).toEqual(['data', 'rules']);
    expect(all.events.every((e) => e.category === 'data' || e.category === 'rules')).toBe(true);
    const users = (await as(emails.RST, 'RST', 'GET', '/audit-events?category=user')).body as AuditLogResponse;
    expect(users.events).toEqual([]);
  });

  it('exports CSV and records one export.generated event', async () => {
    const before = await auditCount();
    const res = await adm('GET', '/audit-events/export?category=user');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fileName: 'audit-log.csv', contentType: 'text/csv' });
    expect(res.body.content).toContain('Time,User,Active role,Event,Event type,Object type,Object id,Object,Detail');
    expect(res.body.content).toContain('user.invited');
    expect(await auditCount()).toBe(before + 1);
    const { rows } = await db.pool.query('SELECT event, action, object_type, after FROM audit_event ORDER BY seq DESC LIMIT 1');
    expect(rows[0]).toMatchObject({ event: 'export.generated', action: 'export', object_type: 'audit_log' });
    expect(rows[0].after).toMatchObject({ screen: 'SCR-073', format: 'csv' });
  });
});
