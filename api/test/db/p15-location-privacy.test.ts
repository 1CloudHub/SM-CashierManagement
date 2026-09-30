/**
 * Property 15 — Location privacy (Req 12.1–12.5; task 15).
 *
 *   No screen, export or API response exposes a staff member's location more
 *   precisely than barangay, and staff who have not consented (or withdrew
 *   consent) never appear on the map or in travel-based matching.
 *
 * Random sequences of consent / home-area operations — through the routes and
 * the task 8.1 enforcer, as the staff member, plus staff deactivation by HR — run against a real
 * PostgreSQL and a small model. After every step:
 *   1. every API response (own view, manager/HR view, consents, barangay
 *      search) and every stored person-linked row (staff_home_area,
 *      staff_consent, audit_event) is free of anything finer than barangay;
 *   2. the matching input and the map aggregation contain exactly the staff
 *      the model says are consented, active and have a home area — so a
 *      consent=false staff member never appears in either;
 *   3. the manager/HR view shows a barangay only for those same staff.
 */
import { findFineLocation } from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as repo from '../../src/db/repositories/location-privacy.js';
import type { Router } from '../../src/http/router.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { insertDepartment, insertStaff, insertStore, insertUser } from '../support/fixtures.js';
import { BARANGAYS, callRoute, callerAs, locationRouter, seedBarangays, type Caller } from '../support/location.js';

let db: TestDatabase;
let router: Router;
let hr: Caller;

beforeAll(async () => {
  db = await createTestDatabase();
  await seedBarangays(db.pool);
  router = locationRouter(db.pool);
  hr = await callerAs(db.pool, await insertUser(db.pool), 'HR', { type: 'global' });
});
afterAll(async () => {
  await db.dispose();
});

const call = (c: Caller, method: string, path: string, body?: unknown, query: Record<string, string> = {}) =>
  callRoute(router, c, method, path, { body, query });

type Op =
  | { kind: 'grant'; who: number; locale: 'en' | 'fil' }
  | { kind: 'set'; who: number; barangay: number; maxTravelMin: number; crossStore: boolean; extra: 'none' | 'lat' | 'address' }
  | { kind: 'clear'; who: number }
  | { kind: 'withdraw'; who: number }
  | { kind: 'deactivate'; who: number }
  | { kind: 'reactivate'; who: number };

const STAFF = 3;
const who = fc.integer({ min: 0, max: STAFF - 1 });
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('grant' as const), who, locale: fc.constantFrom('en' as const, 'fil' as const) }),
  fc.record({
    kind: fc.constant('set' as const),
    who,
    barangay: fc.integer({ min: 0, max: BARANGAYS.length - 1 }),
    maxTravelMin: fc.constantFrom(15, 30, 45),
    crossStore: fc.boolean(),
    extra: fc.constantFrom('none' as const, 'none' as const, 'lat' as const, 'address' as const),
  }),
  fc.record({ kind: fc.constant('clear' as const), who }),
  fc.record({ kind: fc.constant('withdraw' as const), who }),
  fc.record({ kind: fc.constant('deactivate' as const), who }),
  fc.record({ kind: fc.constant('reactivate' as const), who }),
);

interface ModelStaff {
  consent: boolean;
  active: boolean;
  area: number | null;
}

describe('Property 15: location privacy', () => {
  it('never exposes or stores anything finer than barangay, and only consented staff reach map and matching', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 12 }), async (ops) => {
        // A fresh store and staff per run; checks filter to them.
        const storeId = await insertStore(db.pool);
        const dept = await insertDepartment(db.pool, storeId);
        const people: { staffId: string; userId: string }[] = [];
        for (let i = 0; i < STAFF; i += 1) {
          const staffId = await insertStaff(db.pool, storeId, dept);
          const userId = await insertUser(db.pool);
          await db.pool.query('UPDATE staff SET user_id = $2 WHERE id = $1', [staffId, userId]);
          people.push({ staffId, userId });
        }
        const staffIds = people.map((p) => p.staffId);
        const model: ModelStaff[] = people.map(() => ({ consent: false, active: true, area: null }));
        const callers: Caller[] = [];
        for (const p of people) callers.push(await callerAs(db.pool, p.userId, 'STF', { type: 'self', staffId: p.staffId }));
        const me = (i: number) => callers[i] as Caller;

        for (const op of ops) {
          const m = model[op.who] as ModelStaff;
          const staffId = staffIds[op.who] as string;
          switch (op.kind) {
            case 'grant': {
              const r = await call(me(op.who), 'POST', '/me/consents', { purpose: 'home_area', version: 1, locale: op.locale });
              const ok = m.active && !m.consent;
              expect(r.status).toBe(ok ? 201 : 409);
              if (ok) m.consent = true;
              break;
            }
            case 'set': {
              const b = BARANGAYS[op.barangay] as (typeof BARANGAYS)[number];
              const extra = op.extra === 'lat' ? { lat: 14.65812 } : op.extra === 'address' ? { address: '12 Rizal St' } : {};
              const r = await call(me(op.who), 'PUT', '/me/home-area', {
                barangayCode: b.code,
                maxTravelMin: op.maxTravelMin,
                crossStoreOffers: op.crossStore,
                ...extra,
              });
              if (op.extra !== 'none') expect(r.status).toBe(422);
              else if (m.consent && m.active) {
                expect(r.status).toBe(200);
                m.area = op.barangay;
              } else expect(r.status).toBe(409);
              break;
            }
            case 'clear': {
              const r = await call(me(op.who), 'DELETE', '/me/home-area');
              expect(r.status).toBe(m.area !== null ? 200 : 409);
              m.area = null;
              break;
            }
            case 'withdraw': {
              const r = await call(me(op.who), 'DELETE', '/me/consents/home_area');
              expect(r.status).toBe(m.consent ? 200 : 409);
              m.consent = false;
              m.area = null;
              break;
            }
            case 'deactivate':
              await db.pool.query('UPDATE staff SET active = false WHERE id = $1', [staffId]);
              if (m.active) {
                m.consent = false;
                m.area = null;
              }
              m.active = false;
              break;
            case 'reactivate':
              await db.pool.query('UPDATE staff SET active = true WHERE id = $1', [staffId]);
              m.active = true;
              break;
          }

          // (1) No response or stored person-linked row is finer than barangay.
          const responses: unknown[] = [
            (await call(hr, 'GET', `/staff/${staffIds[0]}/home-area`)).body,
            (await call(hr, 'GET', `/staff/${staffIds[1]}/home-area`)).body,
            (await call(hr, 'GET', `/staff/${staffIds[2]}/home-area`)).body,
            (await call(me(op.who), 'GET', '/me/home-area')).body,
            (await call(me(op.who), 'GET', '/me/consents')).body,
            (await call(me(op.who), 'GET', '/me/home-area/barangays', undefined, { q: 'a' })).body,
          ];
          expect(findFineLocation(responses)).toEqual([]);
          const { rows } = await db.pool.query(
            `SELECT 'home' AS t, row_to_json(h)::jsonb AS r FROM staff_home_area h WHERE staff_id = ANY($1::uuid[])
             UNION ALL SELECT 'consent', row_to_json(c)::jsonb FROM staff_consent c WHERE staff_id = ANY($1::uuid[])
             UNION ALL SELECT 'audit', row_to_json(a)::jsonb FROM audit_event a
                        WHERE object_id = ANY($1::text[]) OR after->>'staffId' = ANY($1::text[])`,
            [staffIds],
          );
          expect(findFineLocation(rows)).toEqual([]);

          // (2) Map and matching contain exactly the consented, active staff with a home area.
          const expected = staffIds.filter((_, i) => {
            const s = model[i] as ModelStaff;
            return s.consent && s.active && s.area !== null;
          });
          const matching = await repo.listMatchingHomeAreas(db.pool, { staffIds });
          expect(matching.map((x) => x.staffId).sort()).toEqual([...expected].sort());
          expect(findFineLocation(matching)).toEqual([]);
          const counts = await repo.aggregateHomeAreasByBarangay(db.pool, { homeStoreIds: [storeId] });
          expect(counts.reduce((n, c) => n + c.count, 0)).toBe(expected.length);
          for (const c of counts) {
            const want = model.filter(
              (s) => s.consent && s.active && s.area !== null && BARANGAYS[s.area]?.code === c.barangay.code,
            ).length;
            expect(c.count).toBe(want);
          }

          // (3) The manager/HR view shows a barangay only for those staff.
          for (const [i, body] of responses.slice(0, 3).entries()) {
            const shared = expected.includes(staffIds[i] as string);
            expect(body).toMatchObject({ staffId: staffIds[i], shared });
            if (!shared) expect(Object.keys(body as object).sort()).toEqual(['shared', 'staffId']);
          }
        }
      }),
      { numRuns: 25 },
    );
  });
});
