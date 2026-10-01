/**
 * Location privacy and home-area consent (task 15; Req 12; P15, P11, P7).
 *
 * Repository, database-trigger and route behaviour against a real PostgreSQL.
 * The P15 property test lives in ./p15-location-privacy.test.ts.
 */
import { findFineLocation, type RoleCode, type Scope } from '@lanewise/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit, withAuditedTransaction, type Actor } from '../../src/db/audit.js';
import * as repo from '../../src/db/repositories/location-privacy.js';
import type { Router } from '../../src/http/router.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { insertDepartment, insertStaff, insertStore, insertUser } from '../support/fixtures.js';
import { ANONYMOUS, BARANGAYS, callRoute, callerAs, locationRouter, seedBarangays, type Caller } from '../support/location.js';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  await seedBarangays(db.pool);
});
afterAll(async () => {
  await db.dispose();
});

interface Person {
  userId: string;
  staff: repo.StaffRef;
  actor: Actor;
}

async function newStaffPerson(storeId?: string): Promise<Person> {
  const store = storeId ?? (await insertStore(db.pool));
  const dept = await insertDepartment(db.pool, store);
  const staffId = await insertStaff(db.pool, store, dept);
  const userId = await insertUser(db.pool);
  await db.pool.query('UPDATE staff SET user_id = $2 WHERE id = $1', [staffId, userId]);
  const staff = await repo.getStaffRef(db.pool, staffId);
  if (!staff) throw new Error('staff missing');
  return { userId, staff, actor: { userId, activeRole: 'STF', requestId: null } };
}

const grant = (p: Person, version = 1) =>
  withAuditedTransaction(db.pool, p.actor, (tx) =>
    repo.grantConsent(tx, { staff: p.staff, purpose: 'home_area', version, locale: 'en' }),
  );
const setArea = (p: Person, code: string = BARANGAYS[0].code, maxTravelMin = 30) =>
  withAuditedTransaction(db.pool, p.actor, (tx) =>
    repo.setHomeArea(tx, p.staff, { barangayCode: code, maxTravelMin, crossStoreOffers: true }),
  );
const withdraw = (p: Person) =>
  withAuditedTransaction(db.pool, p.actor, (tx) => repo.withdrawConsent(tx, p.staff, 'home_area'));

async function eventsFor(objectType: string, objectId: string) {
  return audit.list(db.pool, { objectType, objectId });
}

describe('consent', () => {
  it('records a versioned, timestamped grant with exactly one audit event', async () => {
    const p = await newStaffPerson();
    const before = await repo.getConsentStatus(db.pool, p.staff.id, 'home_area');
    expect(before).toMatchObject({ active: false, grantedVersion: null, currentVersion: 1 });

    const record = await grant(p);
    expect(record).toMatchObject({ purpose: 'home_area', textVersion: 1, textLocale: 'en', withdrawnAt: null });
    expect(Date.parse(record.grantedAt)).not.toBeNaN();

    const status = await repo.getConsentStatus(db.pool, p.staff.id, 'home_area');
    expect(status).toMatchObject({ active: true, grantedVersion: 1, reconsentRequired: false });
    const events = await eventsFor('staff_consent', record.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'create', event: 'consent.granted', userId: p.userId, activeRole: 'STF' });
  });

  it('refuses a stale text version and a duplicate grant', async () => {
    const p = await newStaffPerson();
    await expect(grant(p, 7)).rejects.toMatchObject({ code: 'conflict' });
    await grant(p);
    await expect(grant(p)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('serves the consent text in Filipino and falls back to English', async () => {
    const fil = await repo.getCurrentConsentText(db.pool, 'home_area', 'fil');
    expect(fil).toMatchObject({ locale: 'fil', version: 1 });
    expect(fil.body).toContain('RA 10173');
    const en = await repo.getCurrentConsentText(db.pool, 'home_area', 'en');
    expect(en.body).toMatch(/never my address/);
  });

  it('keeps consent text immutable', async () => {
    await expect(db.pool.query(`UPDATE consent_text SET body = 'x' WHERE version = 1`)).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('keeps a grant immutable except for its one withdrawal', async () => {
    const p = await newStaffPerson();
    const record = await grant(p);
    await expect(
      db.pool.query('UPDATE staff_consent SET text_version = 1, granted_at = now() - interval \'1 day\' WHERE id = $1', [
        record.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await withdraw(p);
    await expect(
      db.pool.query('UPDATE staff_consent SET withdrawn_at = NULL, withdrawal_reason = NULL WHERE id = $1', [record.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('home area', () => {
  it('needs consent first', async () => {
    const p = await newStaffPerson();
    await expect(setArea(p)).rejects.toMatchObject({ code: 'conflict' });
    const { rows } = await db.pool.query('SELECT 1 FROM staff_home_area WHERE staff_id = $1', [p.staff.id]);
    expect(rows).toHaveLength(0);
  });

  it('the database refuses a home area without an active consent', async () => {
    const p = await newStaffPerson();
    await expect(
      db.pool.query(
        `INSERT INTO staff_home_area (staff_id, barangay_code, consent_at, max_travel_min) VALUES ($1, $2, now(), 30)`,
        [p.staff.id, BARANGAYS[0].code],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts only a barangay from the reference list', async () => {
    const p = await newStaffPerson();
    await grant(p);
    await expect(setArea(p, '999999999')).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('sets and edits at barangay level and never audits the barangay', async () => {
    const p = await newStaffPerson();
    await grant(p);
    const created = await setArea(p);
    expect(created.barangay).toEqual(BARANGAYS[0]);
    await setArea(p, BARANGAYS[1].code, 45);
    expect(await repo.getOwnHomeArea(db.pool, p.staff.id)).toMatchObject({
      barangay: BARANGAYS[1],
      maxTravelMin: 45,
    });

    const events = await eventsFor('staff_home_area', p.staff.id);
    expect(events.map((e) => [e.action, e.event])).toEqual([
      ['edit', 'home_area.set'],
      ['create', 'home_area.set'],
    ]);
    const serialised = JSON.stringify(events);
    for (const b of BARANGAYS) {
      expect(serialised).not.toContain(b.code);
      expect(serialised).not.toContain(b.name);
    }
  });

  it('clearing keeps the consent', async () => {
    const p = await newStaffPerson();
    await grant(p);
    await setArea(p);
    await withAuditedTransaction(db.pool, p.actor, (tx) => repo.clearHomeArea(tx, p.staff));
    expect(await repo.getOwnHomeArea(db.pool, p.staff.id)).toBeNull();
    expect((await repo.getConsentStatus(db.pool, p.staff.id, 'home_area')).active).toBe(true);
  });
});

describe('withdrawal and retention', () => {
  it('withdrawing deletes the home area at once and removes the person from map and matching', async () => {
    const p = await newStaffPerson();
    await grant(p);
    await setArea(p);
    expect((await repo.listMatchingHomeAreas(db.pool, { staffIds: [p.staff.id] })).map((m) => m.staffId)).toEqual([
      p.staff.id,
    ]);

    const record = await withdraw(p);
    expect(record.withdrawalReason).toBe('staff_withdrew');
    const { rows } = await db.pool.query('SELECT 1 FROM staff_home_area WHERE staff_id = $1', [p.staff.id]);
    expect(rows).toHaveLength(0);
    expect(await repo.listMatchingHomeAreas(db.pool, { staffIds: [p.staff.id] })).toEqual([]);
    expect(await repo.aggregateHomeAreasByBarangay(db.pool, { staffIds: [p.staff.id] })).toEqual([]);
    expect(await repo.getStaffHomeArea(db.pool, p.staff.id)).toEqual({ staffId: p.staff.id, shared: false });

    const events = await eventsFor('staff_consent', record.id);
    expect(events.map((e) => e.event)).toEqual(['consent.withdrawn', 'consent.granted']);
    await expect(withdraw(p)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('deactivating a staff record withdraws consent and deletes the home area', async () => {
    const p = await newStaffPerson();
    await grant(p);
    await setArea(p);
    await db.pool.query('UPDATE staff SET active = false WHERE id = $1', [p.staff.id]);
    const [latest] = await repo.listConsentHistory(db.pool, p.staff.id, 'home_area');
    expect(latest).toMatchObject({ withdrawalReason: 'staff_inactive' });
    const { rows } = await db.pool.query('SELECT 1 FROM staff_home_area WHERE staff_id = $1', [p.staff.id]);
    expect(rows).toHaveLength(0);
  });

  it('purges withdrawn consent records only after 5 years', async () => {
    const p = await newStaffPerson();
    const record = await grant(p);
    await withdraw(p);
    const admin: Actor = { userId: p.userId, activeRole: 'ADM', requestId: null };
    const purge = (now: Date) => withAuditedTransaction(db.pool, admin, (tx) => repo.purgeExpiredConsentRecords(tx, now));
    await purge(new Date());
    expect(await repo.listConsentHistory(db.pool, p.staff.id, 'home_area')).toHaveLength(1);
    const later = new Date(Date.parse(record.grantedAt) + 5 * 366 * 86_400_000);
    expect(await purge(later)).toBeGreaterThanOrEqual(1);
    expect(await repo.listConsentHistory(db.pool, p.staff.id, 'home_area')).toHaveLength(0);
  });
});

describe('consent text versions', () => {
  it('a material new version requires re-consent; re-consenting keeps the home area', async () => {
    // Own database: publishing a version affects every staff member.
    const local = await createTestDatabase();
    try {
      await seedBarangays(local.pool);
      const store = await insertStore(local.pool);
      const dept = await insertDepartment(local.pool, store);
      const staffId = await insertStaff(local.pool, store, dept);
      const userId = await insertUser(local.pool);
      const staff = (await repo.getStaffRef(local.pool, staffId)) as repo.StaffRef;
      const actor: Actor = { userId, activeRole: 'STF', requestId: null };
      const run = <T>(fn: Parameters<typeof withAuditedTransaction<T>>[2]) => withAuditedTransaction(local.pool, actor, fn);

      await run((tx) => repo.grantConsent(tx, { staff, purpose: 'home_area', version: 1, locale: 'fil' }));
      await run((tx) => repo.setHomeArea(tx, staff, { barangayCode: BARANGAYS[2].code, maxTravelMin: 15, crossStoreOffers: false }));

      await local.pool.query(
        `INSERT INTO consent_text (purpose, version, locale, body, requires_reconsent) VALUES
           ('home_area', 2, 'en', 'Version two.', true), ('home_area', 2, 'fil', 'Bersyon dalawa.', true)`,
      );
      expect(await repo.getConsentStatus(local.pool, staffId, 'home_area')).toMatchObject({
        active: false,
        reconsentRequired: true,
        grantedVersion: 1,
        currentVersion: 2,
      });
      expect(await repo.listMatchingHomeAreas(local.pool)).toEqual([]);
      expect(await repo.getOwnHomeArea(local.pool, staffId)).toBeNull();

      const renewed = await run((tx) => repo.grantConsent(tx, { staff, purpose: 'home_area', version: 2, locale: 'en' }));
      expect(renewed.textVersion).toBe(2);
      const history = await repo.listConsentHistory(local.pool, staffId, 'home_area');
      expect(history.map((h) => [h.textVersion, h.withdrawalReason])).toEqual([
        [2, null],
        [1, 'superseded'],
      ]);
      expect(await repo.getOwnHomeArea(local.pool, staffId)).toMatchObject({ barangay: BARANGAYS[2] });
      expect((await repo.listMatchingHomeAreas(local.pool)).map((m) => m.staffId)).toEqual([staffId]);
    } finally {
      await local.dispose();
    }
  });
});

describe('aggregation', () => {
  it('counts consenting staff per barangay without identifying anyone, honouring a minimum count', async () => {
    const store = await insertStore(db.pool);
    const people = await Promise.all([1, 2, 3].map(() => newStaffPerson(store)));
    for (const p of people) await grant(p);
    await setArea(people[0] as Person, BARANGAYS[3].code);
    await setArea(people[1] as Person, BARANGAYS[3].code);
    await setArea(people[2] as Person, BARANGAYS[4].code);
    const counts = await repo.aggregateHomeAreasByBarangay(db.pool, { homeStoreIds: [store] });
    expect(counts).toEqual([
      { barangay: BARANGAYS[3], count: 2 },
      { barangay: BARANGAYS[4], count: 1 },
    ]);
    expect(findFineLocation(counts)).toEqual([]);
    expect(JSON.stringify(counts)).not.toMatch(/staff/i);
    expect(await repo.aggregateHomeAreasByBarangay(db.pool, { homeStoreIds: [store], minCount: 2 })).toEqual([
      { barangay: BARANGAYS[3], count: 2 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe('routes (behind the task 8.1 enforcer)', () => {
  let router: Router;
  beforeAll(() => {
    router = locationRouter(db.pool);
  });
  const call = (caller: Caller, method: string, path: string, options?: { body?: unknown; query?: Record<string, string> }) =>
    callRoute(router, caller, method, path, options);
  const asStaff = (p: Person) => callerAs(db.pool, p.userId, 'STF', { type: 'self', staffId: p.staff.id });

  it('registers every route with a guard: /me authenticated, the manager/HR view authorised', () => {
    expect(router.routes().map((r) => `${r.method} ${r.pattern} ${r.guard?.kind}`)).toEqual([
      'GET /me/consents authenticated',
      'POST /me/consents authenticated',
      'DELETE /me/consents/:purpose authenticated',
      'GET /me/home-area authenticated',
      'PUT /me/home-area authenticated',
      'DELETE /me/home-area authenticated',
      'GET /me/home-area/barangays authenticated',
      'GET /staff/:staffId/home-area authorize',
    ]);
    expect(router.routes().at(-1)?.guard).toEqual({
      kind: 'authorize',
      resource: 'staff_home_area',
      action: 'view',
      scopeTarget: { kind: 'staff', param: 'staffId' },
    });
  });

  it('lets a cashier consent, set, read and withdraw their own home area', async () => {
    const p = await newStaffPerson();
    const me = await asStaff(p);

    const consents = await call(me, 'GET', '/me/consents', { query: { locale: 'fil' } });
    expect(consents.status).toBe(200);
    expect(JSON.stringify(consents.body)).toContain('"locale":"fil"');

    expect((await call(me, 'PUT', '/me/home-area', { body: { barangayCode: BARANGAYS[0].code, maxTravelMin: 30, crossStoreOffers: true } })).status).toBe(409);
    expect((await call(me, 'POST', '/me/consents', { body: { purpose: 'home_area', version: 1, locale: 'en' } })).status).toBe(201);

    const put = await call(me, 'PUT', '/me/home-area', {
      body: { barangayCode: BARANGAYS[0].code, maxTravelMin: 30, crossStoreOffers: true },
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ consent: { active: true }, homeArea: { barangay: BARANGAYS[0], maxTravelMin: 30 } });

    const search = await call(me, 'GET', '/me/home-area/barangays', { query: { q: 'pag-asa' } });
    expect(search.body).toEqual({ barangays: [BARANGAYS[0]] });

    const del = await call(me, 'DELETE', '/me/consents/home_area');
    expect(del.status).toBe(200);
    const after = await call(me, 'GET', '/me/home-area');
    expect(after.body).toMatchObject({ consent: { active: false }, homeArea: null });
  });

  it('rejects anything finer than a barangay code in the request body', async () => {
    const p = await newStaffPerson();
    const me = await asStaff(p);
    await call(me, 'POST', '/me/consents', { body: { purpose: 'home_area', version: 1, locale: 'en' } });
    for (const extra of [{ lat: 14.65 }, { lon: 121.03 }, { address: '12 Rizal St' }, { street: 'Rizal' }, { centroidLat: 1 }]) {
      const res = await call(me, 'PUT', '/me/home-area', {
        body: { barangayCode: BARANGAYS[0].code, maxTravelMin: 30, crossStoreOffers: true, ...extra },
      });
      expect(res.status).toBe(422);
    }
    const free = await call(me, 'PUT', '/me/home-area', {
      body: { barangayCode: 'Brgy. Bagong Pag-asa, 12 Rizal St', maxTravelMin: 30, crossStoreOffers: true },
    });
    expect(free.status).toBe(422);
  });

  it('refuses other roles, unprovisioned callers and people without a role on /me routes (P11)', async () => {
    const p = await newStaffPerson();
    // Linked to the staff record, but acting as Planner: not their own self scope.
    expect((await call(await callerAs(db.pool, p.userId, 'PLN', { type: 'global' }), 'GET', '/me/home-area')).status).toBe(403);
    expect((await call(await callerAs(db.pool, p.userId, null), 'GET', '/me/home-area')).status).toBe(403);
    expect((await call(ANONYMOUS, 'GET', '/me/home-area')).status).toBe(401);
    expect((await call({ email: 'nobody.yet@smretail.com' }, 'GET', '/me/home-area')).status).toBe(403);
    const manager = await insertUser(db.pool);
    const stm = await callerAs(db.pool, manager, 'STM', { type: 'store', storeIds: [p.staff.storeId] });
    expect((await call(stm, 'PUT', '/me/home-area', { body: { barangayCode: BARANGAYS[0].code, maxTravelMin: 30, crossStoreOffers: true } })).status).toBe(403);
  });

  it('shows a staff member’s barangay to their own store manager and HR only', async () => {
    const p = await newStaffPerson();
    await grant(p);
    await setArea(p, BARANGAYS[1].code);
    const userId = await insertUser(db.pool);
    const path = `/staff/${p.staff.id}/home-area`;
    const as = (role: RoleCode, scope: Scope) => callerAs(db.pool, userId, role, scope);

    const own = await call(await as('STM', { type: 'store', storeIds: [p.staff.storeId] }), 'GET', path);
    expect(own.body).toEqual({ staffId: p.staff.id, shared: true, barangay: BARANGAYS[1], maxTravelMin: 30, crossStoreOffers: true });
    expect((await call(await as('HR', { type: 'global' }), 'GET', path)).status).toBe(200);
    expect((await call(await as('HR', { type: 'region', regionIds: [p.staff.regionId] }), 'GET', path)).status).toBe(200);

    // Out of scope and unknown staff get the same 404 (P1); roles without the permission get 403.
    const otherStore = await insertStore(db.pool);
    expect((await call(await as('STM', { type: 'store', storeIds: [otherStore] }), 'GET', path)).status).toBe(404);
    const hr = await callerAs(db.pool, await insertUser(db.pool), 'HR', { type: 'global' });
    expect((await call(hr, 'GET', '/staff/00000000-0000-4000-8000-000000000000/home-area')).status).toBe(404);
    for (const role of ['PLN', 'RST', 'EXE', 'FIN'] as const) {
      expect((await call(await as(role, { type: 'global' }), 'GET', path)).status).toBe(403);
    }
    expect((await call(await asStaff(p), 'GET', path)).status).toBe(403);

    await withdraw(p);
    expect((await call(hr, 'GET', path)).body).toEqual({ staffId: p.staff.id, shared: false });
  });
});
