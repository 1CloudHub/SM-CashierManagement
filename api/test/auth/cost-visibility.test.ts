/**
 * Property tests for task 21 — cost visibility (requirement 25; P1, P11, P12),
 * fast-check over real PostgreSQL and the real Lambda handler:
 *
 *  - for every role x scope, each cost field of a response is present iff the
 *    active role may see cost at that level for that store;
 *  - Staff never receive any cost figure, so never another cashier's (P11);
 *  - every route in the app's own route table obeys the same policy, so routes
 *    added later are covered too.
 *
 * The probe router uses the production enforcer and response shaping; only
 * its route is test-only, because no feature endpoint serves ₱ figures yet.
 */
import {
  ROLE_CODES,
  canSeeCost,
  costLevelsFor,
  type CostTarget,
  type MeResponse,
  type RoleCode,
  type Scope,
} from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import { createEnforcer } from '../../src/auth/enforcer.js';
import { authorize } from '../../src/auth/guards.js';
import { costFigure } from '../../src/http/cost.js';
import { Router } from '../../src/http/router.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { insertAppUser, makeClient, routerClient, seedOrg, setAssignments, uniq } from '../support/rbac.js';

let db: TestDatabase;
let org: Awaited<ReturnType<typeof seedOrg>>;
const RUNS = 60;

beforeAll(async () => {
  db = await createTestDatabase();
  org = await seedOrg(db.pool);
});

afterAll(async () => {
  await db?.dispose();
});

const storeOf = (id: string) => {
  const store = org.stores.find((s) => s.id === id);
  if (!store) throw new Error(`unknown store ${id}`);
  return store;
};

/** Every cost field the probe returns, by JSON path, with its target. */
function probeFields(): { path: string; target: CostTarget }[] {
  const fields: { path: string; target: CostTarget }[] = [{ path: 'network.totalCost', target: { level: 'network' } }];
  org.stores.forEach((s, i) => {
    const store = storeOf(s.id);
    fields.push({ path: `stores.${i}.storeCost`, target: { level: 'store', store } });
    fields.push({ path: `stores.${i}.departments.0.laborCost`, target: { level: 'department', store } });
    org.staff
      .filter((st) => st.storeId === s.id)
      .forEach((_, k) => fields.push({ path: `stores.${i}.staff.${k}.shiftCost`, target: { level: 'individual', store } }));
  });
  return fields;
}

/** A test-only route returning ₱ figures at every level, through the production pipeline. */
function probeClient(demoRoleSwitcher: boolean) {
  const deps = { db: () => db.pool, rbac: { ...DEFAULT_RBAC_CONFIG, demoRoleSwitcher } };
  const router = new Router({ enforcer: createEnforcer(deps) }).get('/probe/costs', authorize('home', 'view'), () => ({
    statusCode: 200,
    body: {
      network: { label: 'Network', totalCost: costFigure({ level: 'network' }, 322_000) },
      stores: org.stores.map((s, i) => {
        const store = storeOf(s.id);
        return {
          id: s.id,
          storeCost: costFigure({ level: 'store', store }, 10_000 + i),
          departments: [{ name: 'Main', laborCost: costFigure({ level: 'department', store }, 5_000 + i) }],
          staff: org.staff
            .filter((st) => st.storeId === s.id)
            .map((st, k) => ({ id: st.id, shiftCost: costFigure({ level: 'individual', store }, 700 + k) })),
        };
      }),
    },
  }));
  return routerClient(router.assertGuarded());
}

function get(body: unknown, path: string): { present: boolean } {
  let cur: unknown = body;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === null || !(part in cur)) return { present: false };
    cur = (cur as Record<string, unknown>)[part];
  }
  return { present: typeof cur === 'number' };
}

/** A non-staff scope over the seeded org. */
const orgScopeArb = (): fc.Arbitrary<Scope> =>
  fc.oneof(
    fc.constant<Scope>({ type: 'global' }),
    fc.subarray(org.regions, { minLength: 1 }).map((regionIds): Scope => ({ type: 'region', regionIds })),
    fc.subarray(org.stores.map((s) => s.id), { minLength: 1 }).map((storeIds): Scope => ({ type: 'store', storeIds })),
  );

const assignmentArb = (): fc.Arbitrary<{ role: RoleCode; scope: Scope }> =>
  fc.constantFrom(...ROLE_CODES).chain((role): fc.Arbitrary<{ role: RoleCode; scope: Scope }> =>
    role === 'STF'
      ? fc.constantFrom(...org.staff.map((s) => s.id)).map((staffId) => ({ role, scope: { type: 'self', staffId } as Scope }))
      : orgScopeArb().map((scope) => ({ role, scope })),
  );

/** The demo scope the server applies to a role the user does not hold. */
function demoScope(role: RoleCode): Scope {
  if (role === 'STM') return { type: 'store', storeIds: [org.demoStoreId] };
  if (role === 'STF') return { type: 'self', staffId: org.demoStaffId };
  return { type: 'global' };
}

describe('cost visibility (requirement 25)', () => {
  it('property: every cost field is present iff the active role may see it (assigned scopes)', async () => {
    const { call } = probeClient(false);
    const who = `cost.${uniq()}@smretail.com`;
    const userId = await insertAppUser(db.pool, who);
    const fields = probeFields();
    await fc.assert(
      fc.asyncProperty(assignmentArb(), async ({ role, scope }) => {
        await setAssignments(db.pool, userId, [{ role, scope }]);
        const res = await call({ path: '/probe/costs', email: who, role });
        expect(res.status).toBe(200);
        for (const { path, target } of fields) {
          expect({ path, ...get(res.body, path) }).toEqual({ path, present: canSeeCost({ role, scope }, target) });
        }
        if (costLevelsFor(role).length === 0) expect(res.raw).not.toMatch(/cost/i);
      }),
      { numRuns: RUNS },
    );
  });

  it('property: the same holds for every role taken through the demo role switcher', async () => {
    const { call } = probeClient(true);
    const fields = probeFields();
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ROLE_CODES), async (role) => {
        const who = `costdemo.${uniq()}@smretail.com`;
        await insertAppUser(db.pool, who);
        const res = await call({ path: '/probe/costs', email: who, role });
        expect(res.status).toBe(200);
        for (const { path, target } of fields) {
          expect({ path, ...get(res.body, path) }).toEqual({ path, present: canSeeCost({ role, scope: demoScope(role) }, target) });
        }
      }),
      { numRuns: 24 },
    );
  });

  it('property P11: a Staff response never carries a cost figure — own or another cashier’s', async () => {
    const { call } = probeClient(false);
    const who = `coststf.${uniq()}@smretail.com`;
    const userId = await insertAppUser(db.pool, who);
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...org.staff.map((s) => s.id)), async (staffId) => {
        await setAssignments(db.pool, userId, [{ role: 'STF', scope: { type: 'self', staffId } }]);
        const res = await call({ path: '/probe/costs', email: who, role: 'STF' });
        expect(res.status).toBe(200);
        expect(res.raw).not.toMatch(/cost/i);
        expect(res.raw).not.toMatch(/"\w*Cost":/);
      }),
      { numRuns: 20 },
    );
  });

  it('a Store Manager sees own-store figures only and never the network total', async () => {
    const { call } = probeClient(false);
    const who = `coststm.${uniq()}@smretail.com`;
    const userId = await insertAppUser(db.pool, who);
    const own = org.stores[1] as { id: string };
    await setAssignments(db.pool, userId, [{ role: 'STM', scope: { type: 'store', storeIds: [own.id] } }]);
    const res = await call({ path: '/probe/costs', email: who, role: 'STM' });
    const body = res.body as { network: object; stores: { id: string; storeCost?: number }[] };
    expect(body.network).toEqual({ label: 'Network' });
    expect(body.stores.filter((s) => s.storeCost !== undefined).map((s) => s.id)).toEqual([own.id]);
  });

  it('a raw number under a cost-named key fails closed (500) without leaking the value', async () => {
    const deps = { db: () => db.pool, rbac: { ...DEFAULT_RBAC_CONFIG, demoRoleSwitcher: true } };
    const router = new Router({ enforcer: createEnforcer(deps) }).get('/probe/untagged', authorize('home', 'view'), () => ({
      statusCode: 200,
      body: { seasonCost: 13_600_000 },
    }));
    const { call } = routerClient(router);
    const who = `costraw.${uniq()}@smretail.com`;
    await insertAppUser(db.pool, who);
    const res = await call({ path: '/probe/untagged', email: who, role: 'FIN' });
    expect(res.status).toBe(500);
    expect(res.raw).not.toContain('13600000');
  });
});

describe('app routes obey the cost policy', () => {
  it('property: no app route returns an untagged or unpermitted cost field, for any role', async () => {
    const { call, router } = makeClient(db.pool, true);
    const gets = router.routes().filter((r) => r.method === 'GET');
    const ids = [...org.stores.map((s) => s.id), ...org.staff.map((s) => s.id)];
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...gets), fc.constantFrom(...ROLE_CODES), fc.constantFrom(...ids), async (route, role, id) => {
        const who = `costapp.${uniq()}@smretail.com`;
        await insertAppUser(db.pool, who);
        const res = await call({ path: route.pattern.replace(/:[A-Za-z]+/g, id), email: who, role });
        expect(res.status).not.toBe(500);
        if (costLevelsFor(role).length === 0) expect(res.raw).not.toMatch(/"\w*cost\w*":\s*\d/i);
      }),
      { numRuns: RUNS },
    );
  });

  it('GET /me reports the active role’s cost levels', async () => {
    const { call } = makeClient(db.pool, true);
    for (const role of ROLE_CODES) {
      const who = `costme.${uniq()}@smretail.com`;
      await insertAppUser(db.pool, who);
      const res = await call({ path: '/me', email: who, role });
      expect((res.body as MeResponse).costLevels).toEqual(costLevelsFor(role));
    }
  });
});
