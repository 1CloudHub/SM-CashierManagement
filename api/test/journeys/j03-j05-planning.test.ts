/**
 * Journeys J3 (Planner investigates lane-capacity pressure: network view →
 * department day plan) and J5 (HR works the recruiting timeline: hiring plan
 * → export), read through the real routes on the seeded published Christmas
 * 2026 plan (Req 5, 10, 25; P1, P7, P12; cost visibility).
 *
 * The Store Manager sees only their own store (P1), Staff are refused, and
 * cost figures are absent for roles without cost visibility (the Rules
 * Steward entirely; network-level cost for the Store Manager).
 */
import type { DepartmentDayView, HiringPlanView, NetworkView, PlanningJob } from '@lanewise/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_SEASON, demoId, demoUserId } from '../../src/db/demo/dataset.js';
import { setupJourney, type Journey } from './support.js';

let j: Journey;
const SCENARIO = demoId('scenario', DEMO_SEASON);
const QC = demoId('store', 'smsm-qc');
const QC_MAIN = demoId('department', 'smsm-qc:main');
const CEB_MAIN = demoId('department', 'smsm-ceb:main');
const PEAK = { date: '2026-12-19' };

beforeAll(async () => {
  j = await setupJourney();
}, 120_000);

afterAll(async () => {
  await j?.dispose();
});

const network = async (role: 'PLN' | 'STM' | 'RST' | 'FIN') => {
  const res = await j.call(role, 'GET', `/scenarios/${SCENARIO}/network`, { query: PEAK });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.view as NetworkView;
};

describe('J3 — network view to the department day plan', () => {
  it('the Planner sees every store with cost; picks the most pressured department and opens its day plan', async () => {
    const view = await network('PLN');
    expect(view.stores).toHaveLength(8);
    expect(view.kpis.cost).toBeGreaterThan(0);
    const cells = view.stores.flatMap((s) => s.departments.map((d) => ({ d, max: Math.max(...d.hours.map((h) => h.pressurePct)) })));
    const hottest = cells.sort((a, b) => b.max - a.max)[0]?.d;
    expect(hottest).toBeDefined();
    const day = await j.call('PLN', 'GET', `/scenarios/${SCENARIO}/departments/${hottest?.departmentId}/day`, { query: PEAK });
    expect(day.status).toBe(200);
    // The same figures alone as in the network view (P2).
    expect((day.body.view as DepartmentDayView).figures).toEqual(hottest);
  });

  it('the Store Manager sees only their store, its ₱ but no network cost (P1); other departments are 404', async () => {
    const view = await network('STM');
    expect(view.stores.map((s) => s.storeId)).toEqual([QC]);
    expect(view.kpis.cost).toBeUndefined();
    expect(view.stores[0]?.cost).toBeGreaterThan(0);
    expect((await j.call('STM', 'GET', `/scenarios/${SCENARIO}/departments/${QC_MAIN}/day`, { query: PEAK })).status).toBe(200);
    const out = await j.call('STM', 'GET', `/scenarios/${SCENARIO}/departments/${CEB_MAIN}/day`, { query: PEAK });
    const missing = await j.call('STM', 'GET', `/scenarios/${SCENARIO}/departments/${demoId('department', 'nope')}/day`, { query: PEAK });
    expect(out.status).toBe(404);
    expect(out.body).toEqual(missing.body);
    // The demo role switcher gives another user acting as Store Manager the same QC scope.
    const switched = await j.as(j.emails.FIN, 'STM', 'GET', `/scenarios/${SCENARIO}/network`, { query: PEAK });
    expect((switched.body.view as NetworkView).stores.map((s) => s.storeId)).toEqual([QC]);
  });

  it('the Rules Steward views without any ₱; Staff and the Administrator are refused (P12)', async () => {
    const view = await network('RST');
    expect(view.stores).toHaveLength(8);
    expect(JSON.stringify(view)).not.toMatch(/"cost"/);
    for (const role of ['STF', 'ADM'] as const) {
      expect((await j.call(role, 'GET', `/scenarios/${SCENARIO}/network`)).status, role).toBe(403);
      expect((await j.call(role, 'GET', `/scenarios/${SCENARIO}/departments/${QC_MAIN}/day`)).status, role).toBe(403);
    }
    // The same Staff user can't reach it through the Store Manager role without the switcher.
    expect((await j.as(j.emails.STF, 'STM', 'GET', `/scenarios/${SCENARIO}/network`, { strict: true })).status).toBe(403);
  });

  it('exports are audited with the user and active role; the Store Manager may not export the network view', async () => {
    await j.audited({ status: 403 }, () => j.call('STM', 'GET', `/scenarios/${SCENARIO}/network/export`, { query: PEAK }));
    const { event } = await j.audited({ status: 200, userId: demoUserId('STM'), role: 'STM' }, () =>
      j.call('STM', 'GET', `/scenarios/${SCENARIO}/departments/${QC_MAIN}/day/export`, { query: PEAK }),
    );
    expect(event).toMatchObject({ action: 'export', object_id: SCENARIO });
  });
});

describe('J5 — HR works the recruiting timeline', () => {
  it('the Planner runs the hiring plan as a background job (one audit event); HR may not start it', async () => {
    await j.audited({ status: 403 }, () => j.call('HR', 'POST', `/scenarios/${SCENARIO}/hiring-plan/jobs`, { body: {} }));
    const { res } = await j.audited({ status: 202, userId: demoUserId('PLN'), role: 'PLN' }, () =>
      j.call('PLN', 'POST', `/scenarios/${SCENARIO}/hiring-plan/jobs`, { body: {} }),
    );
    expect((res.body.job as PlanningJob).status).toBe('succeeded'); // in-process queue
  }, 120_000);

  it('HR sees the network plan with cost and the “when to act” timeline; the Store Manager only their store, without network cost', async () => {
    const hr = await j.call('HR', 'GET', `/scenarios/${SCENARIO}/hiring-plan`);
    expect(hr.status).toBe(200);
    const plan = (hr.body.view as HiringPlanView).plan;
    expect(plan?.stores).toHaveLength(8);
    expect(plan?.kpis.seasonCost).toBeGreaterThan(0);
    expect(plan?.timeline.length).toBeGreaterThan(0);

    const stm = (await j.call('STM', 'GET', `/scenarios/${SCENARIO}/hiring-plan`)).body.view as HiringPlanView;
    expect(stm.plan?.stores.map((s) => s.storeId)).toEqual([QC]);
    expect(stm.plan?.kpis.seasonCost).toBeUndefined();
    for (const role of ['STF', 'RST', 'ADM'] as const) expect((await j.call(role, 'GET', `/scenarios/${SCENARIO}/hiring-plan`)).status, role).toBe(403);
  });

  it('HR exports hires by store and department: one export audit event as HR; the Store Manager may not export', async () => {
    const { res, event } = await j.audited({ status: 200, userId: demoUserId('HR'), role: 'HR' }, () =>
      j.call('HR', 'GET', `/scenarios/${SCENARIO}/hiring-plan/export`),
    );
    expect(event?.action).toBe('export');
    expect(res.body.content).toContain('Seasonal hires');
    await j.audited({ status: 403 }, () => j.call('STM', 'GET', `/scenarios/${SCENARIO}/hiring-plan/export`));
    // The leadership summary is not for Store Managers or Staff.
    expect((await j.call('EXE', 'GET', `/scenarios/${SCENARIO}/summary`)).status).toBe(200);
    for (const role of ['STM', 'STF'] as const) expect((await j.call(role, 'GET', `/scenarios/${SCENARIO}/summary`)).status, role).toBe(403);
  });
});
