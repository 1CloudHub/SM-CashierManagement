/**
 * Task 20 — `GET /search` (fast-check, real PostgreSQL):
 *  - P1  every hit is inside the active role's scope, and every in-scope match
 *        is counted (the SQL filter is neither too loose nor too tight);
 *  - P11 a Staff user never gets another cashier (nor any store-wide hit);
 *  - groups the active role has no permission for are always empty.
 */
import {
  ROLE_CODES,
  SEARCH_GROUPS,
  isStoreInScope,
  searchableGroups,
  seesPublishedScenariosOnly,
  type RoleCode,
  type Scope,
  type SearchResponse,
} from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { insertAppUser, makeClient, seedOrg, setAssignments, uniq, writeCounts } from '../support/rbac.js';

let db: TestDatabase;
let org: Awaited<ReturnType<typeof seedOrg>>;

interface Row {
  id: string;
  text: string[];
  storeId: string | null;
  regionId: string | null;
  status?: string;
}
let world: Record<(typeof SEARCH_GROUPS)[number], Row[]>;

const STATUSES = ['draft', 'submitted', 'approved', 'published', 'superseded', 'archived'] as const;

beforeAll(async () => {
  db = await createTestDatabase();
  org = await seedOrg(db.pool);
  const owner = await insertAppUser(db.pool, `owner.${uniq()}@smretail.com`);
  for (const [i, status] of STATUSES.entries()) {
    const published = status === 'published' || status === 'superseded';
    await db.pool.query(
      `INSERT INTO scenario (name, season, status, owner_id, settings, published_at, synthetic)
       VALUES ($1, $2, $3, $4, '{}', $5, true)`,
      [`Christmas 2026 v${i + 1} ${uniq()}`, i % 2 === 0 ? 'christmas-2026' : 'summer-2027', status, owner, published ? new Date() : null],
    );
  }
  // A name with LIKE wildcards: searching "%" or "_" must match literally.
  await db.pool.query(
    `INSERT INTO scenario (name, season, owner_id, settings, synthetic) VALUES ('100%_peak test', 'christmas-2026', $1, '{}', true)`,
    [owner],
  );

  const q = async (sql: string) => (await db.pool.query(sql)).rows as Record<string, string>[];
  world = {
    stores: (await q(`SELECT s.id, s.name, s.code, r.name AS region, s.region_id FROM store s JOIN region r ON r.id = s.region_id`)).map(
      (r) => ({ id: r.id!, text: [r.name!, r.code!, r.region!], storeId: r.id!, regionId: r.region_id! }),
    ),
    departments: (await q(`SELECT d.id, d.name, s.name AS store, s.id AS store_id, s.region_id FROM department d JOIN store s ON s.id = d.store_id`)).map(
      (r) => ({ id: r.id!, text: [r.name!, r.store!], storeId: r.store_id!, regionId: r.region_id! }),
    ),
    scenarios: (await q(`SELECT id, name, season, status FROM scenario`)).map((r) => ({
      id: r.id!,
      text: [r.name!, r.season!],
      storeId: null,
      regionId: null,
      status: r.status!,
    })),
    staff: (await q(`SELECT st.id, st.name, st.employee_no, s.name AS store, s.id AS store_id, s.region_id FROM staff st JOIN store s ON s.id = st.store_id`)).map(
      (r) => ({ id: r.id!, text: [r.name!, r.employee_no!, r.store!], storeId: r.store_id!, regionId: r.region_id! }),
    ),
  };
});

afterAll(async () => {
  await db?.dispose();
});

const orgScopeArb = (): fc.Arbitrary<Scope> =>
  fc.oneof(
    fc.constant<Scope>({ type: 'global' }),
    fc.subarray(org.regions, { minLength: 1 }).map((regionIds): Scope => ({ type: 'region', regionIds })),
    fc.subarray(org.stores.map((s) => s.id), { minLength: 1 }).map((storeIds): Scope => ({ type: 'store', storeIds })),
  );

/** Fragments of real names/codes (so hits are common), plus noise and wildcards. */
const queryArb = (): fc.Arbitrary<string> =>
  fc.oneof(
    fc.constantFrom('SM', 'sm ', 'Cashier', 'dept', 'christmas', 'SUMMER', 'v3', 'R-', 'E-', '%', '_', '100%_', 'zzz-no-match'),
    fc
      .constantFrom(...Object.values(world).flat().flatMap((r) => r.text))
      .chain((t) => fc.nat({ max: Math.max(t.length - 1, 0) }).map((start) => t.slice(start, start + 4))),
    fc.string({ minLength: 1, maxLength: 6 }),
  ).filter((s) => s.trim().length > 0);

/** The oracle: what the server should return for a role/scope/query. */
function expected(role: RoleCode, scope: Scope, query: string): Record<(typeof SEARCH_GROUPS)[number], string[]> {
  const needle = query.trim().toLowerCase();
  const groups = searchableGroups(role);
  const match = (r: Row) => r.text.some((t) => t.toLowerCase().includes(needle));
  const out = { stores: [], departments: [], scenarios: [], staff: [] } as Record<(typeof SEARCH_GROUPS)[number], string[]>;
  for (const g of SEARCH_GROUPS) {
    if (!groups.includes(g)) continue;
    out[g] = world[g]
      .filter(match)
      .filter((r) => {
        if (g === 'scenarios') {
          if (scope.type === 'self') return false;
          return !seesPublishedScenariosOnly(role) || r.status === 'published';
        }
        if (g === 'staff' && scope.type === 'self') return r.id === scope.staffId;
        return isStoreInScope(scope, { id: r.storeId!, regionId: r.regionId! });
      })
      .map((r) => r.id)
      .sort();
  }
  return out;
}

const ids = (res: SearchResponse, g: (typeof SEARCH_GROUPS)[number]) => res.groups[g].items.map((i) => i.id).sort();

describe('GET /search — P1 scope isolation', () => {
  it('returns exactly the in-scope matches the active role may see, and writes nothing', async () => {
    const { call } = makeClient(db.pool, false);
    const who = `s1.${uniq()}@smretail.com`;
    const userId = await insertAppUser(db.pool, who);
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<RoleCode>(...ROLE_CODES.filter((r) => r !== 'STF')), orgScopeArb(), queryArb(), async (role, scope, query) => {
        await setAssignments(db.pool, userId, [{ role, scope }]);
        const before = await writeCounts(db.pool);
        const res = await call({ path: `/search?q=${encodeURIComponent(query)}&limit=50`, email: who, role });
        expect(await writeCounts(db.pool)).toEqual(before);
        expect(res.status, res.raw).toBe(200);
        const body = res.body as SearchResponse;
        expect(body.query).toBe(query.trim());
        const want = expected(role, scope, query);
        for (const g of SEARCH_GROUPS) {
          // Every hit is in scope and matches…
          for (const id of ids(body, g)) expect(want[g], `${g} ${id}`).toContain(id);
          // …and nothing in scope is missed.
          expect(body.groups[g].total, g).toBe(want[g].length);
          expect(body.groups[g].items.length).toBe(Math.min(want[g].length, 50));
        }
      }),
      { numRuns: 120 },
    );
  });

  it('caps each group at the requested limit but still reports the total', async () => {
    const { call } = makeClient(db.pool, false);
    const who = `s2.${uniq()}@smretail.com`;
    const userId = await insertAppUser(db.pool, who);
    await setAssignments(db.pool, userId, [{ role: 'PLN', scope: { type: 'global' } }]);
    const res = await call({ path: '/search?q=SM', email: who, role: 'PLN' });
    const body = res.body as SearchResponse;
    expect(body.groups.stores.items).toHaveLength(5);
    expect(body.groups.stores.total).toBe(org.stores.length);
  });

  it('validates the query (422) and needs a permitted role (403)', async () => {
    const { call } = makeClient(db.pool, false);
    const who = `s3.${uniq()}@smretail.com`;
    const userId = await insertAppUser(db.pool, who);
    await setAssignments(db.pool, userId, [{ role: 'PLN', scope: { type: 'global' } }]);
    expect((await call({ path: '/search', email: who })).status).toBe(422);
    expect((await call({ path: '/search?q=%20%20', email: who })).status).toBe(422);
    expect((await call({ path: `/search?q=${'a'.repeat(101)}`, email: who })).status).toBe(422);
    expect((await call({ path: '/search?q=sm&limit=0', email: who })).status).toBe(422);
    expect((await call({ path: '/search?q=sm&limit=51', email: who })).status).toBe(422);
    expect((await call({ path: '/search?q=sm' })).status).toBe(401);
    expect((await call({ path: '/search?q=sm', email: who, role: 'FIN' })).status).toBe(403);
  });
});

describe('GET /search — P11 staff self-scope', () => {
  it('a Staff user never gets another cashier or any store-wide hit', async () => {
    const clients = { true: makeClient(db.pool, true), false: makeClient(db.pool, false) };
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.constantFrom(...org.staff), queryArb(), async (demoMode, self, query) => {
        const who = `s11.${uniq()}@smretail.com`;
        const userId = await insertAppUser(db.pool, who, { activeRole: 'STF' });
        const ownId = demoMode ? org.demoStaffId : self.id;
        if (!demoMode) await setAssignments(db.pool, userId, [{ role: 'STF', scope: { type: 'self', staffId: self.id } }]);
        const res = await clients[`${demoMode}`].call({ path: `/search?q=${encodeURIComponent(query)}`, email: who, role: 'STF' });
        expect(res.status, res.raw).toBe(200);
        for (const g of SEARCH_GROUPS) expect((res.body as SearchResponse).groups[g].total).toBe(0);
        for (const other of org.staff.filter((s) => s.id !== ownId)) {
          expect(res.raw).not.toContain(other.name);
          expect(res.raw).not.toContain(other.id);
        }
      }),
      { numRuns: 40 },
    );
  });
});
