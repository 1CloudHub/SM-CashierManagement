/**
 * Shift offers and store-to-store borrowing (task 17; Req 13, 14, 15.2; P1,
 * P7, P11, P14, P16, P17) against a real PostgreSQL through the task 8.1
 * enforcer.
 *
 *   - P16: offers go only to cashiers who are trained, available and within
 *     every labor rule with their hours at every store counted; a selection
 *     with anyone else is refused and writes nothing (fast-check over random
 *     selections).
 *   - P17: concurrent acceptances of one shift — exactly one wins, every
 *     other offer for the shift is withdrawn at that moment, the shift is
 *     filled once (fast-check over random offer groups and orders).
 *   - Expiry after 30 minutes (lazy and from the worker's scheduled sweep),
 *     sender notifications, Staff self-scope (P11), scope 404s (P1) and one
 *     audit event per mutation (P7).
 *   - Borrowing: lending-manager approval, Planner override only with a
 *     reason, borrowed cashiers on the receiving roster with home store and
 *     travel time, and their hours counted to their own limits (P14).
 */
import type { BorrowRequestDto, MyOfferDto, OfferCandidatesResponse, RosterDetail, ShiftOfferDto } from '@lanewise/shared';
import fc from 'fast-check';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import { createEnforcer } from '../../src/auth/enforcer.js';
import { expireDueOffers } from '../../src/db/repositories/offers.js';
import { Router } from '../../src/http/router.js';
import { createWorkerHandler } from '../../src/jobs/worker.js';
import { registerOfferRoutes } from '../../src/routes/offers.js';
import { registerRosterRoutes } from '../../src/routes/rosters.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { insertUser } from '../support/fixtures.js';
import { BARANGAYS, callRoute, callerAs, seedBarangays, type Caller } from '../support/location.js';

let db: TestDatabase;
let router: Router;

const SECRET = 'Secret-Name';
const Q = { mode: 'car', maxTravelMin: '60' };

interface World {
  stores: { mega: string; aura: string; nedsa: string };
  depts: { megaMain: string; megaExpress: string; auraMain: string; nedsaMain: string };
  rosters: { mega: string; aura: string; nedsa: string };
  staff: Record<string, string>;
}
let w: World;
const callers = {} as Record<'PLN' | 'HR' | 'EXE' | 'STM' | 'STM_AURA' | 'STF', Caller>;
const staffCallers = new Map<string, Caller>();

async function one<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T> {
  const { rows } = await db.pool.query<T>(sql, values);
  return rows[0] as T;
}

async function count(sql: string, values: unknown[] = []): Promise<number> {
  return (await one<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) x`, values)).n;
}

async function store(regionId: string, code: string, name: string, lat: number, lon: number): Promise<string> {
  const { id } = await one<{ id: string }>(`INSERT INTO store (code, name, format, region_id) VALUES ($1, $2, 'sm_supermarket', $3) RETURNING id`, [code, name, regionId]);
  await db.pool.query(`INSERT INTO store_location (store_id, lat, lon, source) VALUES ($1, $2, $3, 'manual')`, [id, lat, lon]);
  return id;
}

async function dept(storeId: string, name: string): Promise<string> {
  const { id } = await one<{ id: string }>(
    `INSERT INTO department (store_id, name, installed_lanes, default_handle_time_min, trading_open, trading_close)
     VALUES ($1, $2, 10, 2.5, '10:00', '22:00') RETURNING id`,
    [storeId, name],
  );
  return id;
}

async function roster(storeId: string, departmentId: string): Promise<string> {
  const { id } = await one<{ id: string }>(
    `INSERT INTO roster (store_id, department_id, period_start, period_end, status, published_at)
     VALUES ($1, $2, '2030-01-01', '2030-12-31', 'published', now()) RETURNING id`,
    [storeId, departmentId],
  );
  return id;
}

async function shift(rosterId: string, departmentId: string, staffId: string | null, date: string, start: number, end: number): Promise<string> {
  const iso = (h: number) => `${date}T${String(h).padStart(2, '0')}:00:00+08:00`;
  const { id } = await one<{ id: string }>(
    `INSERT INTO shift (roster_id, staff_id, department_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [rosterId, staffId, departmentId, iso(start), iso(end)],
  );
  return id;
}

async function cashier(
  key: string,
  storeId: string,
  departmentId: string,
  options: { consent: boolean; barangay?: number; type?: string; trained?: string[] },
): Promise<string> {
  const userId = await insertUser(db.pool);
  const { id } = await one<{ id: string }>(
    `INSERT INTO staff (store_id, department_id, employee_no, name, employment_type, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [storeId, departmentId, key, `${key} ${SECRET}`, options.type ?? 'regular', userId],
  );
  for (const d of [departmentId, ...(options.trained ?? [])]) {
    await db.pool.query('INSERT INTO staff_training (staff_id, department_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, d]);
  }
  if (options.consent) {
    await db.pool.query(`INSERT INTO staff_consent (staff_id, purpose, text_version, text_locale) VALUES ($1, 'home_area', 1, 'en')`, [id]);
    await db.pool.query(
      `INSERT INTO staff_home_area (staff_id, barangay_code, consent_at, max_travel_min, cross_store_offers) VALUES ($1, $2, now(), 90, true)`,
      [id, BARANGAYS[options.barangay ?? 1]!.code],
    );
  }
  staffCallers.set(key, await callerAs(db.pool, userId, 'STF', { type: 'self', staffId: id }));
  return id;
}

const call = (c: Caller, method: string, path: string, options: { body?: unknown; query?: Record<string, string> } = {}) =>
  callRoute(router, c, method, path, options);
const me = (key: string) => staffCallers.get(key)!;

/** A fresh open shift on Megamall Main on `date` (default far ahead of the clock). */
const openMega = (date: string, start = 13, end = 17) => shift(w.rosters.mega, w.depts.megaMain, null, date, start, end);

beforeAll(async () => {
  db = await createTestDatabase();
  await seedBarangays(db.pool);
  const deps = { db: () => db.pool, rbac: { ...DEFAULT_RBAC_CONFIG, demoRoleSwitcher: false } };
  router = new Router({ enforcer: createEnforcer(deps) });
  registerOfferRoutes(router, deps);
  registerRosterRoutes(router, deps);
  router.assertGuarded();

  const region = (await one<{ id: string }>(`INSERT INTO region (code, name) VALUES ('MM', 'Metro Manila') RETURNING id`)).id;
  const stores = {
    mega: await store(region, 'MEGA', 'SM Megamall', 14.585, 121.0565),
    aura: await store(region, 'AURA', 'SM Aura', 14.5455, 121.0546),
    nedsa: await store(region, 'NEDSA', 'SM North EDSA', 14.6566, 121.03),
  };
  const depts = {
    megaMain: await dept(stores.mega, 'Main checkout lanes'),
    megaExpress: await dept(stores.mega, 'Express lanes'),
    auraMain: await dept(stores.aura, 'Main checkout lanes'),
    nedsaMain: await dept(stores.nedsa, 'Main checkout lanes'),
  };
  const rosters = { mega: await roster(stores.mega, depts.megaMain), aura: await roster(stores.aura, depts.auraMain), nedsa: await roster(stores.nedsa, depts.nedsaMain) };
  w = { stores, depts, rosters, staff: {} };
  const s = w.staff;
  for (const k of ['AU-1', 'AU-2', 'AU-4', 'AU-5', 'AU-6']) s[k] = await cashier(k, stores.aura, depts.auraMain, { consent: true, barangay: 1 });
  s['MX-1'] = await cashier('MX-1', stores.mega, depts.megaExpress, { consent: true, barangay: 1 }); // not trained on Main
  s['PT-9'] = await cashier('PT-9', stores.nedsa, depts.nedsaMain, { consent: true, barangay: 0, type: 'part_time' }); // near the 30 h cap
  s['NC-1'] = await cashier('NC-1', stores.aura, depts.auraMain, { consent: false }); // no consent: never offered
  s['AU-3'] = await cashier('AU-3', stores.aura, depts.auraMain, { consent: true, barangay: 3 }); // busy at Aura on the P16 day
  s['AU-UN'] = await cashier('AU-UN', stores.aura, depts.auraMain, { consent: true, barangay: 1 }); // unavailable on the P16 day
  // Lending-store pool for borrowing (no consent needed for a store move).
  s['AL-1'] = await cashier('AL-1', stores.aura, depts.auraMain, { consent: false });
  s['AL-PT'] = await cashier('AL-PT', stores.aura, depts.auraMain, { consent: false, type: 'part_time' });

  // PT-9: 4 × 7 h at North EDSA, Mon–Thu of the P16 week (28 h; +4 h breaks 30 h).
  for (const d of ['2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10']) await shift(rosters.nedsa, depts.nedsaMain, s['PT-9'], d, 8, 15);
  await shift(rosters.aura, depts.auraMain, s['AU-3'], '2030-01-12', 10, 16);
  await db.pool.query(
    `INSERT INTO staff_availability (staff_id, kind, starts_at, ends_at, source) VALUES ($1, 'unavailable', '2030-01-12T00:00:00+08:00', '2030-01-13T00:00:00+08:00', 'manual')`,
    [s['AU-UN']],
  );
  // AL-PT: 26 h at Aura in the week of 2030-03-04 (borrow P14 test).
  for (const d of ['2030-03-04', '2030-03-05']) await shift(rosters.aura, depts.auraMain, s['AL-PT'], d, 8, 21);

  callers.PLN = await callerAs(db.pool, await insertUser(db.pool), 'PLN', { type: 'global' });
  callers.HR = await callerAs(db.pool, await insertUser(db.pool), 'HR', { type: 'global' });
  callers.EXE = await callerAs(db.pool, await insertUser(db.pool), 'EXE', { type: 'global' });
  callers.STM = await callerAs(db.pool, await insertUser(db.pool), 'STM', { type: 'store', storeIds: [stores.mega] });
  callers.STM_AURA = await callerAs(db.pool, await insertUser(db.pool), 'STM', { type: 'store', storeIds: [stores.aura] });
  callers.STF = me('AU-1');
});

afterAll(async () => {
  await db.dispose();
});

const P16_DAY = '2030-01-12'; // Saturday; PT-9 has 28 h that week

describe('offer candidates and sending (P16)', () => {
  it('lists only eligible cashiers, pseudonymised, with the allowance by travel band', async () => {
    const shiftId = await openMega(P16_DAY);
    const res = await call(callers.STM, 'GET', `/stores/${w.stores.mega}/shifts/${shiftId}/offer-candidates`, { query: Q });
    expect(res.status).toBe(200);
    const body = res.body as unknown as OfferCandidatesResponse;
    const ids = body.candidates.map((c) => c.staffId);
    for (const k of ['AU-1', 'AU-2', 'AU-4', 'AU-5', 'AU-6']) expect(ids).toContain(w.staff[k]);
    for (const k of ['MX-1', 'PT-9', 'NC-1', 'AU-3', 'AU-UN', 'AL-1']) expect(ids).not.toContain(w.staff[k]);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    for (const c of body.candidates) expect(c.allowance).toBe(c.travelMin <= 15 ? 0 : c.travelMin <= 30 ? 50 : c.travelMin <= 45 ? 80 : 120);
    // Another store's shift is a 404 for a Store Manager (P1) and an unknown one for everyone.
    const nedsaShift = await shift(w.rosters.nedsa, w.depts.nedsaMain, null, P16_DAY, 13, 17);
    expect((await call(callers.STM, 'GET', `/stores/${w.stores.nedsa}/shifts/${nedsaShift}/offer-candidates`, { query: Q })).status).toBe(404);
    expect((await call(callers.STM, 'GET', `/stores/${w.stores.mega}/shifts/${nedsaShift}/offer-candidates`, { query: Q })).status).toBe(404);
    expect((await call(callers.HR, 'GET', `/stores/${w.stores.mega}/shifts/${shiftId}/offer-candidates`, { query: Q })).status).toBe(403);
  });

  it('property: a selection is sent iff every cashier in it is eligible; otherwise nothing is written', async () => {
    const all = ['AU-1', 'AU-2', 'MX-1', 'PT-9', 'NC-1', 'AU-3', 'AU-UN'];
    const eligible = new Set(['AU-1', 'AU-2']);
    await fc.assert(
      fc.asyncProperty(fc.uniqueArray(fc.constantFrom(...all), { minLength: 1, maxLength: 4 }), async (picked) => {
        const shiftId = await openMega(P16_DAY);
        const before = await count('SELECT 1 FROM shift_offer');
        const audits = await count('SELECT 1 FROM audit_event');
        const res = await call(callers.STM, 'POST', `/stores/${w.stores.mega}/shifts/${shiftId}/offers`, {
          body: { staffIds: picked.map((k) => w.staff[k]), mode: 'car', maxTravelMin: 60 },
        });
        if (picked.every((k) => eligible.has(k))) {
          expect(res.status).toBe(201);
          const offers = (res.body as { offers: ShiftOfferDto[] }).offers;
          expect(offers.map((o) => o.staffId).sort()).toEqual(picked.map((k) => w.staff[k]).sort());
          expect(await count('SELECT 1 FROM audit_event') - audits).toBe(1);
        } else {
          expect(res.status).toBe(422);
          expect(await count('SELECT 1 FROM shift_offer')).toBe(before);
          expect(await count('SELECT 1 FROM audit_event')).toBe(audits);
        }
      }),
      { numRuns: 12 },
    );
  });

  it('records the terms, a 30-minute expiry, notifies the cashiers and audits once', async () => {
    const shiftId = await openMega('2030-01-14');
    const started = Date.now();
    const res = await call(callers.STM, 'POST', `/stores/${w.stores.mega}/shifts/${shiftId}/offers`, {
      body: { staffIds: [w.staff['AU-1'], w.staff['AU-2']], mode: 'car', maxTravelMin: 60 },
    });
    expect(res.status).toBe(201);
    const offers = (res.body as { offers: ShiftOfferDto[] }).offers;
    expect(offers).toHaveLength(2);
    for (const o of offers) {
      expect(o.status).toBe('sent');
      expect(o.name).toBeNull(); // another store's cashier: ID only until accepted (Req 12.5)
      expect(Date.parse(o.expiresAt) - Date.parse(o.sentAt)).toBe(30 * 60_000);
      expect(Date.parse(o.sentAt)).toBeGreaterThanOrEqual(started - 1000);
      expect(o.pay).toBeGreaterThan(0); // own store: the Store Manager sees individual cost
      expect(o.travelMin).not.toBeNull();
    }
    expect(await count(`SELECT 1 FROM notification WHERE event = 'shift_offer.received' AND object_id = ANY($1::text[])`, [offers.map((o) => o.id)])).toBe(2);
    expect(await count(`SELECT 1 FROM audit_event WHERE event = 'shift_offer.sent' AND object_id = $1`, [shiftId])).toBe(1);
    // A second offer to the same cashier while one is live is refused.
    const again = await call(callers.STM, 'POST', `/stores/${w.stores.mega}/shifts/${shiftId}/offers`, { body: { staffIds: [w.staff['AU-1']], mode: 'car', maxTravelMin: 60 } });
    expect(again.status).toBe(422);
    // Roles without individual cost never get the pay figure; Staff can't list store offers at all.
    const exe = await call(callers.EXE, 'GET', `/stores/${w.stores.mega}/offers`, { query: { shiftId } });
    expect(exe.status).toBe(200);
    expect((await call(callers.STF, 'GET', `/stores/${w.stores.mega}/offers`)).status).toBe(403);
  });
});

describe('responding (P11, P17)', () => {
  async function send(date: string, keys: readonly string[]): Promise<{ shiftId: string; offers: ShiftOfferDto[] }> {
    const shiftId = await openMega(date);
    const res = await call(callers.STM, 'POST', `/stores/${w.stores.mega}/shifts/${shiftId}/offers`, {
      body: { staffIds: keys.map((k) => w.staff[k]), mode: 'car', maxTravelMin: 60 },
    });
    expect(res.status).toBe(201);
    return { shiftId, offers: (res.body as { offers: ShiftOfferDto[] }).offers };
  }
  const offerOf = (offers: readonly ShiftOfferDto[], key: string) => offers.find((o) => o.staffId === w.staff[key])!;

  it('shows a cashier only their own offers and refuses other roles', async () => {
    const { offers } = await send('2030-01-16', ['AU-1', 'AU-2']);
    const mine = await call(me('AU-1'), 'GET', '/me/offers');
    expect(mine.status).toBe(200);
    const list = (mine.body as { offers: MyOfferDto[] }).offers;
    expect(list.some((o) => o.id === offerOf(offers, 'AU-1').id)).toBe(true);
    expect(list.some((o) => o.id === offerOf(offers, 'AU-2').id)).toBe(false);
    expect(JSON.stringify(list)).not.toContain(SECRET);
    expect(list.find((o) => o.id === offerOf(offers, 'AU-1').id)).toMatchObject({ storeName: 'SM Megamall', status: 'sent' });
    // Another cashier's offer is a 404 (P11); non-Staff roles have no "respond" permission.
    expect((await call(me('AU-1'), 'POST', `/me/offers/${offerOf(offers, 'AU-2').id}/accept`)).status).toBe(404);
    expect((await call(callers.PLN, 'GET', '/me/offers')).status).toBe(403);
  });

  it('accepting fills the shift, withdraws the others at that moment, reveals the name and notifies the sender', async () => {
    const { shiftId, offers } = await send('2030-01-18', ['AU-1', 'AU-2', 'AU-4']);
    const res = await call(me('AU-2'), 'POST', `/me/offers/${offerOf(offers, 'AU-2').id}/accept`);
    expect(res.status).toBe(200);
    expect((res.body as { offer: MyOfferDto }).offer.status).toBe('accepted');
    const rows = (await db.pool.query<{ staff_id: string; status: string; responded_at: Date }>(`SELECT staff_id, status, responded_at FROM shift_offer WHERE shift_id = $1`, [shiftId])).rows;
    expect(rows.filter((r) => r.status === 'accepted').map((r) => r.staff_id)).toEqual([w.staff['AU-2']]);
    expect(rows.filter((r) => r.status === 'withdrawn')).toHaveLength(2);
    expect(new Set(rows.map((r) => r.responded_at.toISOString())).size).toBe(1);
    expect((await one<{ staff_id: string }>('SELECT staff_id FROM shift WHERE id = $1', [shiftId])).staff_id).toBe(w.staff['AU-2']);
    expect(await count(`SELECT 1 FROM shift_override WHERE shift_id = $1 AND override_type = 'offer_fill'`, [shiftId])).toBe(1);
    expect(await count(`SELECT 1 FROM notification WHERE event = 'shift_offer.accepted' AND object_id = $1`, [shiftId])).toBe(1);
    expect(await count(`SELECT 1 FROM notification WHERE event = 'shift_offer.withdrawn'`)).toBeGreaterThanOrEqual(2);
    // A late acceptance is told the shift has just been filled.
    const late = await call(me('AU-1'), 'POST', `/me/offers/${offerOf(offers, 'AU-1').id}/accept`);
    expect(late.status).toBe(409);
    // The sender now sees the name; the roster shows the borrowed cashier with home store and travel time.
    const view = (await call(callers.STM, 'GET', `/stores/${w.stores.mega}/offers`, { query: { shiftId } })).body as { offers: ShiftOfferDto[] };
    expect(view.offers.find((o) => o.status === 'accepted')?.name).toBe(`AU-2 ${SECRET}`);
    const detail = (await call(callers.STM, 'GET', `/stores/${w.stores.mega}/rosters/${w.rosters.mega}`)).body as unknown as RosterDetail;
    const au2 = detail.staff.find((s) => s.id === w.staff['AU-2'])!;
    expect(au2.borrowedFrom).toBe('SM Aura');
    expect(au2.borrowedTravelMin).toBeGreaterThan(0);
    expect(detail.overrides.some((o) => o.shiftId === shiftId && o.type === 'offer_fill')).toBe(true);
  });

  it('property (P17): concurrent acceptances of one shift — exactly one wins, the rest are withdrawn', async () => {
    let day = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray(['AU-1', 'AU-2', 'AU-4', 'AU-5', 'AU-6'], { minLength: 2 }),
        fc.array(fc.nat(5), { minLength: 5, maxLength: 5 }),
        async (keys, delays) => {
          // Two days apart, so no run's filled shift makes a cashier ineligible for the next.
          const date = new Date(Date.UTC(2030, 4, 1 + 2 * day++)).toISOString().slice(0, 10);
          const { shiftId, offers } = await send(date, keys);
          const audits = await count(`SELECT 1 FROM audit_event WHERE event = 'shift_offer.accepted'`);
          const results = await Promise.all(
            keys.map(async (k, i) => {
              await new Promise((r) => setTimeout(r, delays[i] ?? 0));
              return { k, res: await call(me(k), 'POST', `/me/offers/${offerOf(offers, k).id}/accept`) };
            }),
          );
          const winners = results.filter((r) => r.res.status === 200);
          expect(winners).toHaveLength(1);
          expect(results.filter((r) => r.res.status === 409)).toHaveLength(keys.length - 1);
          const rows = (await db.pool.query<{ staff_id: string; status: string }>(`SELECT staff_id, status FROM shift_offer WHERE shift_id = $1`, [shiftId])).rows;
          expect(rows.filter((r) => r.status === 'accepted').map((r) => r.staff_id)).toEqual([w.staff[winners[0]!.k]]);
          expect(rows.filter((r) => r.status === 'sent')).toHaveLength(0);
          expect(rows.filter((r) => r.status === 'withdrawn')).toHaveLength(keys.length - 1);
          expect((await one<{ staff_id: string }>('SELECT staff_id FROM shift WHERE id = $1', [shiftId])).staff_id).toBe(w.staff[winners[0]!.k]);
          expect(await count(`SELECT 1 FROM shift_override WHERE shift_id = $1`, [shiftId])).toBe(1);
          expect((await count(`SELECT 1 FROM audit_event WHERE event = 'shift_offer.accepted'`)) - audits).toBe(1);
        },
      ),
      { numRuns: 8 },
    );
  });

  it('the database refuses a second accepted offer and offers for a filled shift', async () => {
    const { shiftId, offers } = await send('2030-01-20', ['AU-1', 'AU-2']);
    await db.pool.query(`UPDATE shift_offer SET status = 'accepted', responded_at = now() WHERE id = $1`, [offers[0]!.id]);
    // The trigger withdrew the other offer, so it can no longer become accepted.
    await expect(db.pool.query(`UPDATE shift_offer SET status = 'accepted', responded_at = now() WHERE id = $1`, [offers[1]!.id])).rejects.toThrow();
    const by = (await one<{ sent_by: string }>('SELECT sent_by FROM shift_offer WHERE id = $1', [offers[0]!.id])).sent_by;
    await expect(
      db.pool.query(`INSERT INTO shift_offer (shift_id, staff_id, sent_by, expires_at) VALUES ($1, $2, $3, now() + interval '30 minutes')`, [shiftId, w.staff['AU-4'], by]),
    ).rejects.toThrow(/already filled/);
  });

  it('declining notifies the sender; an expired offer can no longer be answered', async () => {
    const { shiftId, offers } = await send('2030-01-22', ['AU-1', 'AU-2']);
    const d = await call(me('AU-1'), 'POST', `/me/offers/${offerOf(offers, 'AU-1').id}/decline`);
    expect(d.status).toBe(200);
    expect((d.body as { offer: MyOfferDto }).offer.status).toBe('declined');
    expect(await count(`SELECT 1 FROM notification WHERE event = 'shift_offer.declined' AND object_id = $1`, [shiftId])).toBe(1);
    expect((await call(me('AU-1'), 'POST', `/me/offers/${offerOf(offers, 'AU-1').id}/accept`)).status).toBe(409);

    // 31 minutes later the worker's scheduled sweep expires the other offer and notifies the sender once.
    const later = new Date(Date.now() + 31 * 60_000);
    const handler = createWorkerHandler(() => db.pool, () => undefined, () => later);
    await handler({ source: 'aws.events', 'detail-type': 'Scheduled Event' } as never);
    expect((await one<{ status: string }>('SELECT status FROM shift_offer WHERE id = $1', [offerOf(offers, 'AU-2').id])).status).toBe('expired');
    expect(await count(`SELECT 1 FROM notification WHERE event = 'shift_offer.expired' AND object_id = $1`, [shiftId])).toBe(1);
    expect(await expireDueOffers(db.pool, later)).toBe(0); // idempotent
    const late = await call(me('AU-2'), 'POST', `/me/offers/${offerOf(offers, 'AU-2').id}/accept`);
    expect(late.status).toBe(409);
  });
});

describe('borrowing (Req 14; P14, P16)', () => {
  async function request(date: string, n: number, start = 13, end = 17): Promise<{ id: string; shiftIds: string[] }> {
    const shiftIds: string[] = [];
    for (let i = 0; i < n; i++) shiftIds.push(await openMega(date, start, end));
    const res = await call(callers.STM, 'POST', `/stores/${w.stores.mega}/borrow-requests`, { body: { fromStoreId: w.stores.aura, shiftIds, note: 'Payday rush' } });
    expect(res.status).toBe(201);
    const req = (res.body as { request: BorrowRequestDto }).request;
    expect(req).toMatchObject({ status: 'pending', count: n, fromStoreName: 'SM Aura', toStoreName: 'SM Megamall', note: 'Payday rush' });
    expect(req.travelMin).toBeGreaterThan(0);
    return { id: req.id, shiftIds };
  }

  it('notifies the lending manager and lets only the lending store decide', async () => {
    const { id } = await request('2030-02-04', 1);
    expect(await count(`SELECT 1 FROM notification WHERE event = 'borrow.requested' AND object_id = $1`, [id])).toBe(1);
    expect(await count(`SELECT 1 FROM audit_event WHERE event = 'transfer_request.created' AND object_id = $1`, [id])).toBe(1);
    // The borrowing manager cannot approve for the lending store (P1: not in scope).
    expect((await call(callers.STM, 'POST', `/stores/${w.stores.aura}/borrow-requests/${id}/decision`, { body: { decision: 'decline' } })).status).toBe(404);
    // The request is addressed to Aura; Megamall as the "lending store" is a 404.
    expect((await call(callers.PLN, 'GET', `/stores/${w.stores.mega}/borrow-requests/${id}/candidates`)).status).toBe(404);
    const list = (await call(callers.STM_AURA, 'GET', `/stores/${w.stores.aura}/borrow-requests`)).body as unknown as { incoming: BorrowRequestDto[] };
    expect(list.incoming.map((r) => r.id)).toContain(id);
    const cands = (await call(callers.STM_AURA, 'GET', `/stores/${w.stores.aura}/borrow-requests/${id}/candidates`)).body as unknown as { candidates: { staffId: string }[] };
    expect(cands.candidates.map((c) => c.staffId)).toContain(w.staff['AL-1']);
    const d = await call(callers.STM_AURA, 'POST', `/stores/${w.stores.aura}/borrow-requests/${id}/decision`, { body: { decision: 'decline', reason: 'Short ourselves' } });
    expect(d.status).toBe(200);
    expect((d.body as { request: BorrowRequestDto }).request).toMatchObject({ status: 'declined', declineReason: 'Short ourselves' });
    expect((await call(callers.STM_AURA, 'POST', `/stores/${w.stores.aura}/borrow-requests/${id}/decision`, { body: { decision: 'decline' } })).status).toBe(409);
  });

  it('applies an approved borrow: the cashier fills the shift, shown with home store and travel time', async () => {
    const { id, shiftIds } = await request('2030-02-06', 1);
    const res = await call(callers.STM_AURA, 'POST', `/stores/${w.stores.aura}/borrow-requests/${id}/decision`, {
      body: { decision: 'approve', staffIds: [w.staff['AL-1']] },
    });
    expect(res.status).toBe(200);
    const req = (res.body as { request: BorrowRequestDto }).request;
    expect(req.status).toBe('approved');
    expect(req.cashiers).toEqual([expect.objectContaining({ staffId: w.staff['AL-1'], shiftId: shiftIds[0] })]);
    expect((await one<{ staff_id: string }>('SELECT staff_id FROM shift WHERE id = $1', [shiftIds[0]])).staff_id).toBe(w.staff['AL-1']);
    expect(await count(`SELECT 1 FROM shift_override WHERE transfer_request_id = $1 AND override_type = 'borrow_fill'`, [id])).toBe(1);
    expect(await count(`SELECT 1 FROM audit_event WHERE object_id = $1 AND event = 'transfer_request.approved'`, [id])).toBe(1);
    const detail = (await call(callers.STM, 'GET', `/stores/${w.stores.mega}/rosters/${w.rosters.mega}`)).body as unknown as RosterDetail;
    const al = detail.staff.find((s) => s.id === w.staff['AL-1'])!;
    expect(al.borrowedFrom).toBe('SM Aura');
    expect(al.borrowedTravelMin).toBe(req.travelMin);
  });

  it('a Planner may approve instead of the lending manager only with a reason', async () => {
    const { id } = await request('2030-02-08', 1);
    const noReason = await call(callers.PLN, 'POST', `/stores/${w.stores.aura}/borrow-requests/${id}/decision`, { body: { decision: 'approve', staffIds: [w.staff['AL-1']] } });
    expect(noReason.status).toBe(422);
    expect(await count(`SELECT 1 FROM transfer_request_staff WHERE transfer_request_id = $1`, [id])).toBe(0);
    const ok = await call(callers.PLN, 'POST', `/stores/${w.stores.aura}/borrow-requests/${id}/decision`, {
      body: { decision: 'approve', staffIds: [w.staff['AL-1']], reason: 'Lending manager off today' },
    });
    expect(ok.status).toBe(200);
    expect((ok.body as { request: BorrowRequestDto }).request).toMatchObject({ status: 'overridden', overrideReason: 'Lending manager off today' });
    expect((await one<{ reason: string }>(`SELECT reason FROM shift_override WHERE transfer_request_id = $1`, [id])).reason).toBe('Lending manager off today');
    expect(await count(`SELECT 1 FROM notification WHERE event = 'borrow.overridden' AND object_id = $1`, [id])).toBeGreaterThanOrEqual(1);
  });

  it('P14: borrowed hours count toward the cashier’s own weekly limit', async () => {
    // AL-PT already has 26 h at Aura in the week of 2030-03-04; a 4 h borrow reaches the 30 h cap, a second one would pass it.
    const first = await request('2030-03-07', 1, 13, 17);
    const cands = (await call(callers.STM_AURA, 'GET', `/stores/${w.stores.aura}/borrow-requests/${first.id}/candidates`)).body as unknown as { candidates: { staffId: string }[] };
    expect(cands.candidates.map((c) => c.staffId)).toContain(w.staff['AL-PT']);
    expect(
      (await call(callers.STM_AURA, 'POST', `/stores/${w.stores.aura}/borrow-requests/${first.id}/decision`, { body: { decision: 'approve', staffIds: [w.staff['AL-PT']] } })).status,
    ).toBe(200);
    const second = await request('2030-03-08', 1, 13, 17);
    const after = (await call(callers.STM_AURA, 'GET', `/stores/${w.stores.aura}/borrow-requests/${second.id}/candidates`)).body as unknown as { candidates: { staffId: string }[] };
    expect(after.candidates.map((c) => c.staffId)).not.toContain(w.staff['AL-PT']);
    const refused = await call(callers.STM_AURA, 'POST', `/stores/${w.stores.aura}/borrow-requests/${second.id}/decision`, {
      body: { decision: 'approve', staffIds: [w.staff['AL-PT']] },
    });
    expect(refused.status).toBe(422);
    expect((await one<{ status: string }>('SELECT status FROM transfer_request WHERE id = $1', [second.id])).status).toBe('pending');
  });

  it('refuses shifts of another store and duplicate pending requests', async () => {
    const auraShift = await shift(w.rosters.aura, w.depts.auraMain, null, '2030-02-10', 13, 17);
    expect((await call(callers.STM, 'POST', `/stores/${w.stores.mega}/borrow-requests`, { body: { fromStoreId: w.stores.aura, shiftIds: [auraShift] } })).status).toBe(422);
    const { shiftIds } = await request('2030-02-12', 1);
    expect((await call(callers.STM, 'POST', `/stores/${w.stores.mega}/borrow-requests`, { body: { fromStoreId: w.stores.nedsa, shiftIds } })).status).toBe(409);
    // A Store Manager cannot borrow for a store they don't manage.
    expect((await call(callers.STM_AURA, 'POST', `/stores/${w.stores.mega}/borrow-requests`, { body: { fromStoreId: w.stores.nedsa, shiftIds } })).status).toBe(404);
  });
});
