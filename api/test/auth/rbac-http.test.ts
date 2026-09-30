import {
  NOT_FOUND_OR_NO_ACCESS_MESSAGE,
  ROLE_CODES,
  effectivePermissions,
  visibleNav,
  type MeResponse,
  type StoreListResponse,
} from '@lanewise/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import {
  insertAppUser,
  makeClient,
  one,
  seedOrg,
  setAssignments,
  uniq,
  writeCounts,
} from '../support/rbac.js';

let db: TestDatabase;
let org: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  db = await createTestDatabase();
  org = await seedOrg(db.pool);
});

afterAll(async () => {
  await db?.dispose();
});

const email = () => `user.${uniq()}@smretail.com`;

function errorBody(body: unknown): { code: string; message: string } {
  const { code, message } = (body as { error: { code: string; message: string } }).error;
  return { code, message };
}

describe('authentication', () => {
  it('rejects every guarded route without verified claims (401)', async () => {
    const { call } = makeClient(db.pool, true);
    for (const path of ['/me', '/stores', `/stores/${org.demoStoreId}`]) {
      expect((await call({ path })).status).toBe(401);
    }
    expect((await call({ method: 'PUT', path: '/me/active-role', body: { role: 'PLN' } })).status).toBe(401);
  });
});

describe('GET /me and the demo role switcher (requirement 3)', () => {
  it('describes an unprovisioned demo user without writing anything', async () => {
    const { call } = makeClient(db.pool, true);
    const before = await writeCounts(db.pool);
    const me = (await call({ path: '/me', email: email() })).body as MeResponse;
    expect(me).toMatchObject({ provisioned: false, demoMode: true, activeRole: null, scope: null, nav: [], staff: null });
    expect(me.selectableRoles).toEqual(ROLE_CODES);

    const asStm = (await call({ path: '/me', email: email(), role: 'STM' })).body as MeResponse;
    expect(asStm.activeRole).toBe('STM');
    expect(asStm.scope).toEqual({ type: 'store', storeIds: [org.demoStoreId] });
    expect(asStm.permissions).toEqual(effectivePermissions('STM'));
    expect(asStm.nav).toEqual(visibleNav('STM'));
    expect(await writeCounts(db.pool)).toEqual(before);
  });

  it('uses the demo scopes: Planner global, Staff the demo cashier (own record only)', async () => {
    const { call } = makeClient(db.pool, true);
    const pln = (await call({ path: '/me', email: email(), role: 'PLN' })).body as MeResponse;
    expect(pln.scope).toEqual({ type: 'global' });
    const stf = (await call({ path: '/me', email: email(), role: 'STF' })).body as MeResponse;
    expect(stf.scope).toEqual({ type: 'self', staffId: org.demoStaffId });
    expect(stf.staff).toEqual({ id: org.demoStaffId, name: org.staff[0]?.name });
    expect(stf.nav).toContain('my_roster');
    expect(stf.nav).not.toContain('master_data');
  });

  it('rejects an X-Active-Role that is not a role (403), and never trusts other identity input', async () => {
    const { call } = makeClient(db.pool, true);
    for (const role of ['root', 'adm', '', 'PLN,ADM']) {
      const res = await call({ path: '/me', email: email(), role });
      expect(res.status).toBe(403);
    }
  });

  it('provisions on the first role choice and audits each switch exactly once with user + role (P7/P12)', async () => {
    const { call } = makeClient(db.pool, true);
    const who = email();
    const c0 = await writeCounts(db.pool);

    const first = await call({ method: 'PUT', path: '/me/active-role', email: who, body: { role: 'EXE' } });
    expect(first.status).toBe(200);
    const me = first.body as MeResponse;
    expect(me).toMatchObject({ provisioned: true, activeRole: 'EXE' });
    const c1 = await writeCounts(db.pool);
    expect(c1.audit).toBe(c0.audit + 1);
    const created = await one<{ user_id: string; active_role: string; event: string; action: string }>(
      db.pool,
      'SELECT user_id, active_role, event, action FROM audit_event ORDER BY seq DESC LIMIT 1',
    );
    expect(created).toEqual({ user_id: me.user.id, active_role: 'EXE', event: 'user.created', action: 'create' });

    // Same role again: no change, no event.
    await call({ method: 'PUT', path: '/me/active-role', email: who, body: { role: 'EXE' } });
    expect((await writeCounts(db.pool)).audit).toBe(c1.audit);

    // Switch: exactly one role_change event naming the user and the new role.
    const switched = await call({ method: 'PUT', path: '/me/active-role', email: who, body: { role: 'FIN' } });
    expect((switched.body as MeResponse).activeRole).toBe('FIN');
    expect((await writeCounts(db.pool)).audit).toBe(c1.audit + 1);
    const event = await one<{ user_id: string; active_role: string; event: string; before: unknown; after: unknown }>(
      db.pool,
      'SELECT user_id, active_role, event, before, after FROM audit_event ORDER BY seq DESC LIMIT 1',
    );
    expect(event).toEqual({
      user_id: me.user.id,
      active_role: 'FIN',
      event: 'user.active_role_changed',
      before: { activeRole: 'EXE' },
      after: { activeRole: 'FIN' },
    });

    // The persisted choice applies when no header is sent.
    expect(((await call({ path: '/me', email: who })).body as MeResponse).activeRole).toBe('FIN');
  });

  it('audits concurrent identical switches once', async () => {
    const { call } = makeClient(db.pool, true);
    const who = email();
    await call({ method: 'PUT', path: '/me/active-role', email: who, body: { role: 'EXE' } });
    const before = (await writeCounts(db.pool)).audit;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => call({ method: 'PUT', path: '/me/active-role', email: who, body: { role: 'HR' } })),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect((await writeCounts(db.pool)).audit).toBe(before + 1);
  });

  it('validates the body (422) and writes nothing', async () => {
    const { call } = makeClient(db.pool, true);
    const before = await writeCounts(db.pool);
    const res = await call({ method: 'PUT', path: '/me/active-role', email: email(), body: { role: 'GOD' } });
    expect(res.status).toBe(422);
    expect(await writeCounts(db.pool)).toEqual(before);
  });
});

describe('demo mode off (requirement 3.5): roles come from assignments', () => {
  it('only an assigned role may be made active; anything else is 403 and writes nothing', async () => {
    const { call } = makeClient(db.pool, false);
    const who = email();
    const userId = await insertAppUser(db.pool, who);
    await setAssignments(db.pool, userId, [{ role: 'HR', scope: { type: 'region', regionIds: [org.regions[1] as string] } }]);

    const me = (await call({ path: '/me', email: who })).body as MeResponse;
    expect(me).toMatchObject({ demoMode: false, selectableRoles: ['HR'], activeRole: 'HR' });
    expect(me.scope).toEqual({ type: 'region', regionIds: [org.regions[1]] });

    const before = await writeCounts(db.pool);
    expect((await call({ path: '/me', email: who, role: 'EXE' })).status).toBe(403);
    expect((await call({ path: '/stores', email: who, role: 'EXE' })).status).toBe(403);
    expect((await call({ method: 'PUT', path: '/me/active-role', email: who, body: { role: 'EXE' } })).status).toBe(403);
    expect(await writeCounts(db.pool)).toEqual(before);
  });

  it('an unprovisioned user cannot provision themselves', async () => {
    const { call } = makeClient(db.pool, false);
    const before = await writeCounts(db.pool);
    const res = await call({ method: 'PUT', path: '/me/active-role', email: email(), body: { role: 'PLN' } });
    expect(res.status).toBe(403);
    expect(await writeCounts(db.pool)).toEqual(before);
    expect(((await call({ path: '/me', email: email() })).body as MeResponse).selectableRoles).toEqual([]);
  });

  it('a disabled user is refused everywhere (403)', async () => {
    const { call } = makeClient(db.pool, false);
    const who = email();
    const userId = await insertAppUser(db.pool, who, { status: 'disabled' });
    await setAssignments(db.pool, userId, [{ role: 'EXE', scope: { type: 'global' } }]);
    expect((await call({ path: '/me', email: who })).status).toBe(403);
    expect((await call({ path: '/stores', email: who })).status).toBe(403);
  });
});

describe('GET /stores and deep links (P1, requirement 2.4)', () => {
  it('lists only in-scope stores for a region-scoped planner', async () => {
    const { call } = makeClient(db.pool, false);
    const who = email();
    const userId = await insertAppUser(db.pool, who);
    const region = org.regions[2] as string;
    await setAssignments(db.pool, userId, [{ role: 'PLN', scope: { type: 'region', regionIds: [region] } }]);
    const { stores } = (await call({ path: '/stores', email: who })).body as StoreListResponse;
    expect(stores.map((s) => s.id).sort()).toEqual(org.stores.filter((s) => s.regionId === region).map((s) => s.id).sort());
  });

  it('answers out-of-scope, missing and malformed ids with the identical 404', async () => {
    const { call } = makeClient(db.pool, true);
    const who = email();
    expect((await call({ path: `/stores/${org.demoStoreId}`, email: who, role: 'STM' })).status).toBe(403); // not provisioned yet
    await call({ method: 'PUT', path: '/me/active-role', email: who, body: { role: 'STM' } });
    const outOfScope = org.stores.find((s) => s.id !== org.demoStoreId)?.id as string;
    const inScope = await call({ path: `/stores/${org.demoStoreId}`, email: who, role: 'STM' });
    expect(inScope.status).toBe(200);
    const bodies = [];
    for (const id of [outOfScope, '5b4f1f53-8d0e-4c43-9d3a-3a0a3c1d2e11', 'not-a-uuid']) {
      const res = await call({ path: `/stores/${id}`, email: who, role: 'STM' });
      expect(res.status).toBe(404);
      bodies.push(errorBody(res.body));
      expect(res.raw).not.toContain(id === 'not-a-uuid' ? 'SM ' : id);
    }
    expect(bodies).toEqual([
      { code: 'not_found', message: NOT_FOUND_OR_NO_ACCESS_MESSAGE },
      { code: 'not_found', message: NOT_FOUND_OR_NO_ACCESS_MESSAGE },
      { code: 'not_found', message: NOT_FOUND_OR_NO_ACCESS_MESSAGE },
    ]);
  });

  it('refuses roles without master-data access (403) before looking anything up', async () => {
    const { call } = makeClient(db.pool, true);
    const who = email();
    await call({ method: 'PUT', path: '/me/active-role', email: who, body: { role: 'PLN' } });
    expect((await call({ path: '/stores', email: who, role: 'PLN' })).status).toBe(200);
    for (const role of ['ADM', 'FIN', 'STF']) {
      expect((await call({ path: '/stores', email: who, role })).status).toBe(403);
      expect((await call({ path: `/stores/${org.demoStoreId}`, email: who, role })).status).toBe(403);
      expect((await call({ path: '/stores/not-a-uuid', email: who, role })).status).toBe(403);
    }
  });
});
