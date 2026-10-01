/**
 * The network map on the task 14 network view (task 16.1): with the task 23
 * demo network (published Christmas 2026 scenario with a succeeded run), gaps
 * and surplus come from the scenario's Erlang C requirement — the same engine
 * the network view uses — through the default `networkViewGaps` source.
 */
import { findNetworkMapFineLocation, type AutoMatchResponse, type NetworkMapResponse, type RoleCode } from '@lanewise/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import { demoUserId } from '../../src/db/demo/dataset.js';
import { seedDemoData } from '../../src/db/demo/seed.js';
import type { Router } from '../../src/http/router.js';
import { contextForRun, loadPlanningBasis, networkDayFor, orgLookup } from '../../src/planning/basis.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { dispatch, identity } from '../support/dispatch.js';
import { MemoryStorage } from '../support/memory-storage.js';

let db: TestDatabase;
let app: Router;
const emails = {} as Record<RoleCode, string>;
const Q = { date: '2026-12-19', dayPart: 'evening', mode: 'car', maxTravelMin: '60' };

beforeAll(async () => {
  db = await createTestDatabase();
  await seedDemoData(db.pool);
  const { rows } = await db.pool.query<{ id: string; email: string }>('SELECT id, email FROM app_user');
  for (const role of ['PLN', 'STM'] as const) emails[role] = rows.find((r) => r.id === demoUserId(role))!.email;
  app = createApp({ db: () => db.pool, rbac: DEFAULT_RBAC_CONFIG, storage: () => new MemoryStorage() });
}, 120_000);

afterAll(async () => {
  await db?.dispose();
});

const call = (role: RoleCode, path: string, query: Record<string, string> = Q) => dispatch(app, 'GET', path, { identity: identity(emails[role]), role, query });

describe('network map on the network view (demo network)', () => {
  it('reports each store’s required cashiers from the published scenario’s plan', async () => {
    const res = await call('PLN', '/network-map');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as NetworkMapResponse;
    expect(body.gapsSource).toBe('network_view');
    expect(body.stores).toHaveLength(8);
    expect(findNetworkMapFineLocation(body)).toEqual([]);

    // Independently: sum of each store's departments' peak requirement in 16:00–24:00.
    const { rows } = await db.pool.query<{ id: string }>(`SELECT id FROM scenario WHERE status = 'published' AND synthetic`);
    const basis = (await loadPlanningBasis(db.pool, rows[0]!.id))!;
    const org = orgLookup(basis.orgRows, contextForRun(basis.run!, basis.scenario.settings));
    const expected = new Map<string, number>();
    for (const plan of networkDayFor(basis.run!, basis.scenario.settings, Q.date).departments) {
      const dept = org.departmentFor(plan.departmentId);
      const hours = plan.hours.filter((h) => h.hour >= 16 && h.hour < 24);
      if (!dept || hours.length === 0) continue;
      expected.set(dept.store.id, (expected.get(dept.store.id) ?? 0) + Math.max(...hours.map((h) => h.cashiersRequired)));
    }
    for (const pin of body.stores) {
      expect(pin.required, pin.name).toBe(expected.get(pin.storeId) ?? 0);
      expect(pin.delta).toBe(pin.status === 'surplus' && pin.rostered <= pin.required ? pin.delta : pin.rostered - pin.required);
    }
  });

  it('falls back to published-roster gaps outside the scenario’s planning window', async () => {
    const res = await call('PLN', '/network-map', { ...Q, date: '2027-06-01' });
    expect((res.body as NetworkMapResponse).gapsSource).toBe('published_roster');
  });

  it('auto-match runs on the demo network without exposing anything finer than barangay', async () => {
    const res = await call('PLN', '/network-map/auto-match');
    expect(res.status).toBe(200);
    const body = res.body as AutoMatchResponse;
    expect(body.gapsSource).toBe('network_view');
    expect(findNetworkMapFineLocation(body)).toEqual([]);
    expect(body.summary.covered + body.unfilled.length).toBe(body.summary.openShifts);
  });
});
