/**
 * `/network-map` routes (task 16.1, 16.4; Req 11, 12; P1, P12, P15, P16).
 *
 * Runs against a real PostgreSQL through the task 8.1 enforcer:
 *   - P1: stores and gaps are limited to the active role's scope; a Store
 *     Manager cannot address another store's candidates (404).
 *   - P15: nothing finer than barangay (store sites aside) in any response;
 *     non-consented / withdrawn staff never appear on the map, as candidates
 *     or in an auto-match proposal — checked for random consent states.
 *   - P16: every ranked or proposed cashier is trained, available and within
 *     every labor rule with their hours at OTHER stores counted.
 */
import { findNetworkMapFineLocation, type AutoMatchResponse, type NetworkMapResponse, type StoreCandidatesResponse } from '@lanewise/shared';
import fc from 'fast-check';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import { createEnforcer } from '../../src/auth/enforcer.js';
import { Router } from '../../src/http/router.js';
import { publishedRosterGaps, type NetworkGapsSource } from '../../src/network-map/gaps.js';
import { registerNetworkMapRoutes } from '../../src/routes/network-map.js';
import { straightLineMinutes } from '../../src/network-map/service.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { insertUser } from '../support/fixtures.js';
import { BARANGAYS, callRoute, callerAs, seedBarangays, type Caller } from '../support/location.js';

let db: TestDatabase;
let router: Router;

const DATE = '2026-12-19'; // Saturday
const Q = { date: DATE, dayPart: 'midday', mode: 'car', maxTravelMin: '60' };
const SECRET_NAME = 'Maria Secret-Name';

interface World {
  regionNorth: string;
  regionSouth: string;
  stores: { mega: string; aura: string; nedsa: string };
  depts: Record<'megaMain' | 'megaExpress' | 'auraMain' | 'nedsaMain', string>;
  staff: Record<string, string>;
  openShifts: { mega: string[]; nedsa: string[] };
}
let w: World;
const callers = {} as Record<'PLN' | 'EXE' | 'HR' | 'FIN' | 'STM' | 'STF', Caller>;

async function one<T extends pg.QueryResultRow>(sql: string, values: unknown[]): Promise<T> {
  const { rows } = await db.pool.query<T>(sql, values);
  return rows[0] as T;
}

async function store(regionId: string, code: string, name: string, format: string, lat: number, lon: number): Promise<string> {
  const { id } = await one<{ id: string }>(`INSERT INTO store (code, name, format, region_id) VALUES ($1, $2, $3, $4) RETURNING id`, [code, name, format, regionId]);
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
     VALUES ($1, $2, '2026-12-14', '2026-12-20', 'published', now()) RETURNING id`,
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

/** A staff member; `consent` decides whether they share a home area (task 15 path: consent first). */
async function cashier(
  key: string,
  storeId: string,
  departmentId: string,
  options: { consent: 'given' | 'none' | 'withdrawn'; barangay: number; trained?: string[]; type?: string },
): Promise<string> {
  const { id } = await one<{ id: string }>(
    `INSERT INTO staff (store_id, department_id, employee_no, name, employment_type) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [storeId, departmentId, key, SECRET_NAME, options.type ?? 'regular'],
  );
  for (const d of [departmentId, ...(options.trained ?? [])]) {
    await db.pool.query('INSERT INTO staff_training (staff_id, department_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, d]);
  }
  if (options.consent !== 'none') {
    await db.pool.query(`INSERT INTO staff_consent (staff_id, purpose, text_version, text_locale) VALUES ($1, 'home_area', 1, 'en')`, [id]);
    await db.pool.query(
      `INSERT INTO staff_home_area (staff_id, barangay_code, consent_at, max_travel_min, cross_store_offers) VALUES ($1, $2, now(), 90, true)`,
      [id, BARANGAYS[options.barangay]!.code],
    );
    if (options.consent === 'withdrawn') {
      await db.pool.query(
        `UPDATE staff_consent SET withdrawn_at = now(), withdrawal_reason = 'staff_withdrew' WHERE staff_id = $1 AND withdrawn_at IS NULL`,
        [id],
      );
    }
  }
  return id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  await seedBarangays(db.pool);
  const deps = { db: () => db.pool, rbac: { ...DEFAULT_RBAC_CONFIG, demoRoleSwitcher: false } };
  router = registerNetworkMapRoutes(new Router({ enforcer: createEnforcer(deps) }), deps).assertGuarded();

  const regionSouth = (await one<{ id: string }>(`INSERT INTO region (code, name) VALUES ('MM-S', 'Metro Manila South') RETURNING id`, [])).id;
  const regionNorth = (await one<{ id: string }>(`INSERT INTO region (code, name) VALUES ('MM-N', 'Metro Manila North') RETURNING id`, [])).id;
  const stores = {
    mega: await store(regionSouth, 'MEGA', 'SM Megamall', 'sm_supermarket', 14.585, 121.0565),
    aura: await store(regionSouth, 'AURA', 'SM Aura', 'savemore', 14.5455, 121.0546),
    nedsa: await store(regionNorth, 'NEDSA', 'SM North EDSA', 'sm_hypermarket', 14.6566, 121.03),
  };
  const depts = {
    megaMain: await dept(stores.mega, 'Main checkout lanes'),
    megaExpress: await dept(stores.mega, 'Express lanes'),
    auraMain: await dept(stores.aura, 'Main Checkout Lanes'), // same key, different case
    nedsaMain: await dept(stores.nedsa, 'Main checkout lanes'),
  };
  const staff: Record<string, string> = {
    // Consented, trained on Main, free: eligible at Megamall.
    'AU-1': await cashier('AU-1', stores.aura, depts.auraMain, { consent: 'given', barangay: 1 }),
    'AU-2': await cashier('AU-2', stores.aura, depts.auraMain, { consent: 'given', barangay: 2 }),
    // Express only: not trained on Main.
    'MX-1': await cashier('MX-1', stores.mega, depts.megaExpress, { consent: 'given', barangay: 1 }),
    // Part-timer already at 28 h this week at North EDSA: a 4 h shift breaks the 30 h cap (cross-store hours).
    'PT-9': await cashier('PT-9', stores.nedsa, depts.nedsaMain, { consent: 'given', barangay: 0, type: 'part_time' }),
    // Never consented / withdrew: must never appear anywhere.
    'NC-1': await cashier('NC-1', stores.aura, depts.auraMain, { consent: 'none', barangay: 1 }),
    'WD-1': await cashier('WD-1', stores.aura, depts.auraMain, { consent: 'withdrawn', barangay: 1 }),
    // Rostered at Aura in the window (overlaps the Megamall shift).
    'AU-3': await cashier('AU-3', stores.aura, depts.auraMain, { consent: 'given', barangay: 3 }),
    // Rostered at Megamall in the window.
    'MG-1': await cashier('MG-1', stores.mega, depts.megaMain, { consent: 'given', barangay: 1 }),
  };
  const megaMain = await roster(stores.mega, depts.megaMain);
  const nedsaMain = await roster(stores.nedsa, depts.nedsaMain);
  const auraMain = await roster(stores.aura, depts.auraMain);
  await shift(megaMain, depts.megaMain, staff['MG-1']!, DATE, 10, 19);
  const openShifts = {
    mega: [await shift(megaMain, depts.megaMain, null, DATE, 13, 17), await shift(megaMain, depts.megaMain, null, DATE, 13, 17)],
    nedsa: [await shift(nedsaMain, depts.nedsaMain, null, DATE, 14, 18)],
  };
  // PT-9: 4 × 7 h at North EDSA, Mon–Thu of the same week (28 h).
  for (const d of ['2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17']) await shift(nedsaMain, depts.nedsaMain, staff['PT-9']!, d, 8, 15);
  // Aura is balanced: one rostered cashier, no open shifts.
  await shift(auraMain, depts.auraMain, staff['AU-3']!, DATE, 10, 16);
  w = { regionNorth, regionSouth, stores, depts, staff, openShifts };

  callers.PLN = await callerAs(db.pool, await insertUser(db.pool), 'PLN', { type: 'global' });
  callers.EXE = await callerAs(db.pool, await insertUser(db.pool), 'EXE', { type: 'global' });
  callers.HR = await callerAs(db.pool, await insertUser(db.pool), 'HR', { type: 'global' });
  callers.FIN = await callerAs(db.pool, await insertUser(db.pool), 'FIN', { type: 'global' });
  callers.STM = await callerAs(db.pool, await insertUser(db.pool), 'STM', { type: 'store', storeIds: [stores.mega] });
  callers.STF = await callerAs(db.pool, await insertUser(db.pool), 'STF', { type: 'self', staffId: staff['AU-1']! });
});

afterAll(async () => {
  await db.dispose();
});

const get = (c: Caller, path: string, query: Record<string, string> = Q) => callRoute(router, c, 'GET', path, { query });
const CONSENTED = () => ['AU-1', 'AU-2', 'AU-3', 'MX-1', 'PT-9', 'MG-1'].map((k) => w.staff[k]!);
const HIDDEN = () => ['NC-1', 'WD-1'].map((k) => w.staff[k]!);

function expectPrivate(body: unknown): void {
  expect(findNetworkMapFineLocation(body)).toEqual([]);
  const text = JSON.stringify(body);
  expect(text).not.toContain(SECRET_NAME);
  for (const id of HIDDEN()) expect(text).not.toContain(id);
}

describe('GET /network-map', () => {
  it('plots in-scope stores as gap/balanced pins with sites, a consented staff layer and rings', async () => {
    const res = await get(callers.PLN, '/network-map');
    expect(res.status).toBe(200);
    const body = res.body as unknown as NetworkMapResponse;
    expectPrivate(body);
    expect(body.gapsSource).toBe('published_roster');
    expect(body.rings).toEqual([20, 40, 60]);
    const byCode = Object.fromEntries(body.stores.map((s) => [s.code, s]));
    expect(byCode.MEGA).toMatchObject({ status: 'gap', delta: -2, openShifts: 2, rostered: 1, required: 3, site: { lat: 14.585, lon: 121.0565 } });
    expect(byCode.NEDSA).toMatchObject({ status: 'gap', delta: -1, openShifts: 1 });
    expect(byCode.AURA).toMatchObject({ status: 'balanced', delta: 0, openShifts: 0 });
    // Staff layer: consented staff only, counted per barangay.
    expect(body.staffLayer.reduce((a, b) => a + b.count, 0)).toBe(CONSENTED().length);
    expect(body.staffLayer.every((b) => Object.keys(b).sort().join() === 'barangay,count')).toBe(true);
    expect(body.departments.map((d) => d.key)).toEqual(['express lanes', 'main checkout lanes']);
  });

  it('filters by store format and by department', async () => {
    const fmt = await get(callers.PLN, '/network-map', { ...Q, formats: 'savemore,sm_hypermarket' });
    expect((fmt.body as unknown as NetworkMapResponse).stores.map((s) => s.code).sort()).toEqual(['AURA', 'NEDSA']);
    const dep = await get(callers.PLN, '/network-map', { ...Q, department: 'Express lanes' });
    expect((dep.body as unknown as NetworkMapResponse).stores.every((s) => s.openShifts === 0)).toBe(true);
    expect((await get(callers.PLN, '/network-map', { ...Q, formats: 'mall' })).status).toBe(422);
    expect((await get(callers.PLN, '/network-map', { ...Q, date: '2026-13-40' })).status).toBe(422);
    expect((await get(callers.PLN, '/network-map', { ...Q, lat: '14.5' })).status).toBe(422);
  });

  it('P1: a Store Manager sees only their own store; Finance and Staff have no map', async () => {
    const stm = await get(callers.STM, '/network-map');
    expect(stm.status).toBe(200);
    expect((stm.body as unknown as NetworkMapResponse).stores.map((s) => s.code)).toEqual(['MEGA']);
    expect((await get(callers.FIN, '/network-map')).status).toBe(403);
    expect((await get(callers.STF, '/network-map')).status).toBe(403);
  });
});

describe('GET /network-map/stores/:storeId/candidates', () => {
  it('ranks consented, eligible cashiers by travel and lists near misses with reasons (P15, P16)', async () => {
    const res = await get(callers.PLN, `/network-map/stores/${w.stores.mega}/candidates`);
    expect(res.status).toBe(200);
    const body = res.body as unknown as StoreCandidatesResponse;
    expectPrivate(body);
    expect(body.shift).toMatchObject({ departmentKey: 'main checkout lanes', date: DATE, startHour: 13, endHour: 17 });
    expect(body.travelSource).toBe('straight_line');
    const ranked = body.ranked.map((c) => c.displayId);
    expect(ranked.sort()).toEqual(['AU-1', 'AU-2']);
    expect(body.ranked.map((c) => c.travelMin)).toEqual([...body.ranked.map((c) => c.travelMin)].sort((a, b) => a - b));
    for (const c of body.ranked) {
      expect(Object.keys(c.homeArea).sort()).toEqual(['barangay', 'city']);
      expect(c.homeStoreName).toBe('SM Aura');
      expect(c.flags).toContain('CROSS_STORE');
    }
    const excluded = Object.fromEntries(body.excluded.map((c) => [c.displayId, c.reasons]));
    expect(excluded['MX-1']).toContain('NOT_TRAINED');
    expect(excluded['PT-9']).toContain('WEEKLY_HOURS'); // 28 h at North EDSA + 4 h > 30 h
    expect(excluded['MG-1']).toContain('ALREADY_ROSTERED');
    expect(excluded['AU-3']).toContain('ALREADY_ROSTERED'); // rostered at Aura, a different store
  });

  it('uses the straight-line estimate when no matrix row exists, and the matrix when one does', async () => {
    const before = (await get(callers.PLN, `/network-map/stores/${w.stores.mega}/candidates`)).body as unknown as StoreCandidatesResponse;
    const au1 = before.ranked.find((c) => c.displayId === 'AU-1')!;
    expect(au1.travelMin).toBeGreaterThanOrEqual(straightLineMinutes(0, 'car'));
    await db.pool.query(
      `INSERT INTO travel_time (barangay_code, store_id, mode, time_window, minutes, source) VALUES ($1, $2, 'car', 'weekend_midday', 33.5, 'amazon_location')`,
      [BARANGAYS[1]!.code, w.stores.mega],
    );
    try {
      const after = (await get(callers.PLN, `/network-map/stores/${w.stores.mega}/candidates`)).body as unknown as StoreCandidatesResponse;
      expect(after.ranked.find((c) => c.displayId === 'AU-1')?.travelMin).toBe(33.5);
    } finally {
      await db.pool.query('DELETE FROM travel_time');
    }
  });

  it('P1: a Store Manager may open their own store only; other stores are 404', async () => {
    expect((await get(callers.STM, `/network-map/stores/${w.stores.mega}/candidates`)).status).toBe(200);
    expect((await get(callers.STM, `/network-map/stores/${w.stores.aura}/candidates`)).status).toBe(404);
    expect((await get(callers.PLN, '/network-map/stores/00000000-0000-4000-8000-000000000000/candidates')).status).toBe(404);
    expect((await get(callers.FIN, `/network-map/stores/${w.stores.mega}/candidates`)).status).toBe(403);
  });
});

describe('GET /network-map/auto-match', () => {
  it('proposes offers covering the open shifts with eligible, consented cashiers only — nothing is sent', async () => {
    const offersBefore = await one<{ n: number }>('SELECT count(*)::int AS n FROM shift_offer', []);
    const auditBefore = await one<{ n: number }>('SELECT count(*)::int AS n FROM audit_event', []);
    const res = await get(callers.PLN, '/network-map/auto-match');
    expect(res.status).toBe(200);
    const body = res.body as unknown as AutoMatchResponse;
    expectPrivate(body);
    expect(body.summary.openShifts).toBe(3);
    // Megamall's two open shifts go to AU-1 and AU-2 (one offer each); North EDSA's to nobody else eligible.
    const mega = body.offers.filter((o) => o.storeId === w.stores.mega).map((o) => o.candidate.displayId).sort();
    expect(mega).toEqual(['AU-1', 'AU-2']);
    const staffIds = body.offers.map((o) => o.candidate.staffId);
    expect(new Set(staffIds).size).toBe(staffIds.length);
    for (const id of staffIds) expect(CONSENTED()).toContain(id);
    expect(body.offers.some((o) => o.candidate.displayId === 'PT-9' || o.candidate.displayId === 'MX-1')).toBe(false);
    expect(body.summary.covered + body.unfilled.length).toBe(body.summary.openShifts);
    expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM shift_offer', [])).n).toBe(offersBefore.n);
    expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM audit_event', [])).n).toBe(auditBefore.n);
  });

  it('is limited to roles that may send offers, and to their scope (P1)', async () => {
    expect((await get(callers.EXE, '/network-map/auto-match')).status).toBe(403);
    expect((await get(callers.HR, '/network-map/auto-match')).status).toBe(403);
    const stm = (await get(callers.STM, '/network-map/auto-match')).body as unknown as AutoMatchResponse;
    expect(stm.summary.openShifts).toBe(2);
    expect([...stm.offers.map((o) => o.storeId), ...stm.unfilled.map((u) => u.storeId)].every((id) => id === w.stores.mega)).toBe(true);
  });
});

describe('a gaps source with a surplus (the task 14 network view seam)', () => {
  it('shows the surplus pin, lists the lender near a short store, and proposes a store-to-store move', async () => {
    // Stand-in for task 14: Aura has two spare Main-lane cashiers in the window.
    const withSurplus: NetworkGapsSource = {
      kind: 'network_view',
      async gaps(pool, q) {
        const gaps = await publishedRosterGaps.gaps(pool, q);
        return gaps.map((g) => (g.storeId === w.stores.aura && g.departmentKey === 'main checkout lanes' ? { ...g, surplus: 2 } : g));
      },
    };
    const deps = { db: () => db.pool, rbac: { ...DEFAULT_RBAC_CONFIG, demoRoleSwitcher: false }, gapsSource: withSurplus };
    const r = registerNetworkMapRoutes(new Router({ enforcer: createEnforcer(deps) }), deps).assertGuarded();
    const call = (path: string) => callRoute(r, callers.PLN, 'GET', path, { query: Q });

    const map = (await call('/network-map')).body as unknown as NetworkMapResponse;
    expect(map.gapsSource).toBe('network_view');
    expect(map.stores.find((s) => s.code === 'AURA')).toMatchObject({ status: 'surplus', delta: 2 });

    const nedsa = (await call(`/network-map/stores/${w.stores.nedsa}/candidates`)).body as unknown as StoreCandidatesResponse;
    expect(nedsa.nearbySurplus).toEqual([expect.objectContaining({ storeId: w.stores.aura, name: 'SM Aura', surplus: 2 })]);

    const am = (await call('/network-map/auto-match')).body as unknown as AutoMatchResponse;
    expectPrivate(am);
    // Which short store the move serves is the optimiser's call (least total travel).
    expect(am.moves).toEqual([expect.objectContaining({ fromStoreId: w.stores.aura, fromStoreName: 'SM Aura', count: 1 })]);
    expect([...w.openShifts.mega, ...w.openShifts.nedsa]).toContain(am.moves[0]!.shiftIds[0]);
    expect(am.summary).toMatchObject({ openShifts: 3, covered: 3, offers: 2, moves: 1, movedCashiers: 1 });
  });
});

describe('P15 — random consent states never leak into the map, candidates or auto-match', () => {
  it('holds for any mix of given / none / withdrawn consents', async () => {
    const pool = Object.keys(w.staff).filter((k) => !['NC-1', 'WD-1'].includes(k));
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom('given', 'none', 'withdrawn'), { minLength: pool.length, maxLength: pool.length }), async (states) => {
        // Reset every pool member to the drawn state through the consent tables (task 15 path).
        for (const [i, key] of pool.entries()) {
          const id = w.staff[key]!;
          await db.pool.query(
            `UPDATE staff_consent SET withdrawn_at = now(), withdrawal_reason = 'staff_withdrew' WHERE staff_id = $1 AND withdrawn_at IS NULL`,
            [id],
          );
          if (states[i] !== 'none') {
            await db.pool.query(`INSERT INTO staff_consent (staff_id, purpose, text_version, text_locale) VALUES ($1, 'home_area', 1, 'en')`, [id]);
            await db.pool.query(
              `INSERT INTO staff_home_area (staff_id, barangay_code, consent_at, max_travel_min, cross_store_offers) VALUES ($1, $2, now(), 90, true)`,
              [id, BARANGAYS[i % BARANGAYS.length]!.code],
            );
            if (states[i] === 'withdrawn') {
              await db.pool.query(
                `UPDATE staff_consent SET withdrawn_at = now(), withdrawal_reason = 'staff_withdrew' WHERE staff_id = $1 AND withdrawn_at IS NULL`,
                [id],
              );
            }
          }
        }
        const visible = new Set(pool.filter((_, i) => states[i] === 'given').map((k) => w.staff[k]!));
        const hidden = [...HIDDEN(), ...pool.filter((_, i) => states[i] !== 'given').map((k) => w.staff[k]!)];
        const bodies = [
          (await get(callers.PLN, '/network-map')).body,
          (await get(callers.PLN, `/network-map/stores/${w.stores.mega}/candidates`)).body,
          (await get(callers.PLN, `/network-map/stores/${w.stores.nedsa}/candidates`)).body,
          (await get(callers.PLN, '/network-map/auto-match')).body,
        ];
        for (const body of bodies) {
          expect(findNetworkMapFineLocation(body)).toEqual([]);
          const text = JSON.stringify(body);
          expect(text).not.toContain(SECRET_NAME);
          for (const id of hidden) expect(text).not.toContain(id);
        }
        const map = bodies[0] as unknown as NetworkMapResponse;
        expect(map.staffLayer.reduce((a, b) => a + b.count, 0)).toBe(visible.size);
        const am = bodies[3] as unknown as AutoMatchResponse;
        for (const o of am.offers) expect(visible.has(o.candidate.staffId)).toBe(true);
      }),
      { numRuns: 15 },
    );
  });
});
