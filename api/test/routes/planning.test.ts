/**
 * Network view, department plan, hiring plan, long rosters and the
 * leadership summary (task 14; Req 5, 10, 18.3; P1, P2, P6, P7, P9, P11, P12).
 *
 * Real PostgreSQL seeded with the task 23 demo network (one user per role,
 * the published Christmas 2026 scenario with a succeeded run), through the
 * app router with the real RBAC enforcer, cost shaping and the in-process
 * job queue.
 */
import {
  SAMPLE_DATA_MARKER,
  type DepartmentDayView,
  type HiringPlanView,
  type LeadershipSummary,
  type LongRosterView,
  type NetworkView,
  type PlanningJob,
  type RoleCode,
} from '@lanewise/shared';
import { buildHiringPlan, CONTRACT_TYPES, dateRange, planDepartmentDay } from '@lanewise/domain';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import { actorFromPrincipal, withAuditedTransaction } from '../../src/db/audit.js';
import { DEMO_SEASON, demoId, demoUserId } from '../../src/db/demo/dataset.js';
import { seedDemoData } from '../../src/db/demo/seed.js';
import { getScenarioRecord } from '../../src/db/repositories/scenario-planning.js';
import * as jobs from '../../src/jobs/planning-jobs.js';
import { createWorkerHandler } from '../../src/jobs/worker.js';
import type { Router } from '../../src/http/router.js';
import { contextForRun, loadOrgRows, loadRunInputs, orgLookup } from '../../src/planning/basis.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { dispatch, identity, type TestResponse } from '../support/dispatch.js';
import { MemoryStorage } from '../support/memory-storage.js';

let db: TestDatabase;
let app: Router;
const emails = {} as Record<RoleCode, string>;
const SCENARIO = demoId('scenario', DEMO_SEASON);
const RUN = demoId('scenario_run', `${DEMO_SEASON}:network`);
const QC = demoId('store', 'smsm-qc');
let qcMain: string;
let otherDept: string;

async function call(role: RoleCode, method: string, path: string, query?: Record<string, string>, body?: unknown): Promise<TestResponse> {
  return dispatch(app, method, path, {
    identity: identity(emails[role]),
    role,
    ...(query ? { query } : {}),
    ...(body === undefined ? {} : { body }),
    now: () => new Date('2026-10-01T02:00:00Z'),
  });
}

async function count(sql: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(sql);
  return rows[0]?.n ?? 0;
}
const auditCount = () => count('SELECT count(*)::int AS n FROM audit_event');
const exportCount = () => count(`SELECT count(*)::int AS n FROM audit_event WHERE action = 'export'`);

beforeAll(async () => {
  db = await createTestDatabase();
  await seedDemoData(db.pool);
  const { rows } = await db.pool.query<{ id: string; email: string }>('SELECT id, email FROM app_user');
  for (const role of ['ADM', 'EXE', 'PLN', 'STM', 'HR', 'FIN', 'RST', 'STF'] as const) {
    const user = rows.find((r) => r.id === demoUserId(role));
    if (!user) throw new Error(`demo user for ${role} missing`);
    emails[role] = user.email;
  }
  const depts = await db.pool.query<{ id: string; store_id: string; name: string }>('SELECT id, store_id, name FROM department WHERE synthetic');
  qcMain = depts.rows.find((d) => d.store_id === QC && d.name === 'Main lanes')?.id ?? '';
  otherDept = depts.rows.find((d) => d.store_id !== QC)?.id ?? '';
  expect(qcMain).not.toBe('');
  app = createApp({ db: () => db.pool, rbac: DEFAULT_RBAC_CONFIG, storage: () => new MemoryStorage() });
}, 120_000);

afterAll(async () => {
  await db?.dispose();
});

describe('14.1 network view (SCR-020)', () => {
  it('plans every in-scope store and department for a date from the run’s pinned inputs (Req 5.1, P6; DOM-001 Fixture C)', async () => {
    const res = await call('PLN', 'GET', `/scenarios/${SCENARIO}/network`, { date: '2026-12-19' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const view = res.body.view as NetworkView;
    expect(view.kpis.stores).toBe(8);
    expect(view.kpis.departments).toBe(24);
    expect(view.kpis.peakLanes).toBe(254);
    expect(view.kpis.peakHour).toBe(17);
    expect(view.kpis.cashiers).toBe(555);
    expect(view.kpis.cashiersByType).toEqual({ FT: 314, PT: 188, FLOAT: 53 });
    expect(view.kpis.paidHours).toBe(3688);
    expect(Math.abs((view.kpis.cost ?? 0) - 322_000) / 322_000).toBeLessThan(0.02);
    expect(view.provenance.runId).toBe(RUN);
    expect(view.provenance.synthetic).toBe(true);
    const inputs = await loadRunInputs(db.pool, RUN);
    expect(view.provenance.snapshotIds).toEqual(Object.fromEntries(inputs.snapshots.map((s) => [s.datasetType, s.snapshotId])));
    expect(view.provenance.ruleVersionIds).toEqual(inputs.ruleVersions.map((r) => r.ruleVersionId).sort());
    // Every heatmap cell carries its value (never colour alone, Req 5.4).
    for (const s of view.stores) for (const d of s.departments) for (const h of d.hours) expect(typeof h.pressurePct).toBe('number');
  });

  it('defaults to the scenario’s peak day and applies region/store filters', async () => {
    const all = (await call('PLN', 'GET', `/scenarios/${SCENARIO}/network`)).body.view as NetworkView;
    expect(all.date).toBe('2026-12-19');
    const one = (await call('PLN', 'GET', `/scenarios/${SCENARIO}/network`, { store: QC })).body.view as NetworkView;
    expect(one.stores.map((s) => s.storeId)).toEqual([QC]);
    expect(one.kpis.cashiers).toBe(all.stores.find((s) => s.storeId === QC)?.cashiers);
  });

  it('a Store Manager sees only their store and its ₱, never network cost (P1, Req 25.1)', async () => {
    const res = await call('STM', 'GET', `/scenarios/${SCENARIO}/network`, { date: '2026-12-19' });
    expect(res.status).toBe(200);
    const view = res.body.view as NetworkView;
    expect(view.stores.map((s) => s.storeId)).toEqual([QC]);
    expect(view.kpis.cost).toBeUndefined();
    expect(view.stores[0]?.cost).toBeGreaterThan(0);
    expect(view.stores[0]?.departments.every((d) => typeof d.cost === 'number')).toBe(true);
  });

  it('the Rules Steward views without any ₱; Staff and Admin are refused (matrix)', async () => {
    const rst = (await call('RST', 'GET', `/scenarios/${SCENARIO}/network`)).body.view as NetworkView;
    expect(rst.kpis.cost).toBeUndefined();
    expect(JSON.stringify(rst)).not.toMatch(/"cost"/);
    expect((await call('STF', 'GET', `/scenarios/${SCENARIO}/network`)).status).toBe(403);
    expect((await call('ADM', 'GET', `/scenarios/${SCENARIO}/network`)).status).toBe(403);
  });

  it('refuses dates outside the planning window (422) and unrun drafts (409)', async () => {
    expect((await call('PLN', 'GET', `/scenarios/${SCENARIO}/network`, { date: '2027-03-01' })).status).toBe(422);
    const draft = await call('PLN', 'POST', '/scenarios', { }, { name: 'Unrun draft', season: DEMO_SEASON });
    expect(draft.status).toBe(201);
    expect((await call('PLN', 'GET', `/scenarios/${draft.body.scenario.id}/network`)).status).toBe(409);
  });

  it('exports CSV for the filtered, scoped view with the sample-data marker and one export audit event (Req 5.3, P7, P9)', async () => {
    const before = await exportCount();
    const res = await call('STM', 'GET', `/scenarios/${SCENARIO}/network/export`, { date: '2026-12-19' });
    expect(res.status).toBe(403); // Store Manager: view only on the network view.
    const ok = await call('FIN', 'GET', `/scenarios/${SCENARIO}/network/export`, { date: '2026-12-19', store: QC });
    expect(ok.status).toBe(200);
    const csv = ok.body.content as string;
    expect(csv.split('\r\n')[0]).toBe(SAMPLE_DATA_MARKER);
    expect(csv).toContain(`Run,${RUN}`);
    expect(csv).toContain('Cost PHP');
    expect(csv).not.toContain('Cebu');
    expect(await exportCount()).toBe(before + 1);
  });
});

describe('14.1 department day plan (SCR-021)', () => {
  it('shows hourly demand, Erlang lanes, shrinkage and the shift builder (Req 5.2; Fixture C: QC main 19 @ 1 PM)', async () => {
    const res = await call('PLN', 'GET', `/scenarios/${SCENARIO}/departments/${qcMain}/day`, { date: '2026-12-19' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const view = res.body.view as DepartmentDayView;
    expect(view.figures.peakLanes).toBe(19);
    expect(view.figures.peakHour).toBe(13);
    expect(Math.round(view.figures.forecastTransactions)).toBe(3863);
    expect(view.shrinkage).toBeGreaterThan(0);
    expect(view.shifts.length).toBe(view.figures.cashiers);
    for (const h of view.hours) {
      expect(h.scheduled).toBeGreaterThanOrEqual(h.cashiersRequired); // no hour left short
      expect(h.serviceLevel).toBeGreaterThanOrEqual(0);
      expect(h.serviceLevel).toBeLessThanOrEqual(1);
    }
  });

  it('P2: a department shows identical figures alone and in the all-stores view', async () => {
    const days = dateRange('2026-12-01', '2026-12-31');
    const { rows } = await db.pool.query<{ id: string }>('SELECT id FROM department WHERE synthetic ORDER BY id');
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...days), fc.constantFrom(...rows.map((r) => r.id)), fc.constantFrom<RoleCode>('PLN', 'EXE', 'HR', 'FIN'), async (date, deptId, role) => {
        const net = (await call(role, 'GET', `/scenarios/${SCENARIO}/network`, { date })).body.view as NetworkView;
        const row = net.stores.flatMap((s) => s.departments).find((d) => d.departmentId === deptId);
        const single = await call(role, 'GET', `/scenarios/${SCENARIO}/departments/${deptId}/day`, { date });
        expect(single.status).toBe(200);
        expect((single.body.view as DepartmentDayView).figures).toEqual(row);
      }),
      { numRuns: 20 },
    );
  }, 120_000);

  it('a department outside the scope is the same 404 as a missing one (P1)', async () => {
    const out = await call('STM', 'GET', `/scenarios/${SCENARIO}/departments/${otherDept}/day`);
    const missing = await call('STM', 'GET', `/scenarios/${SCENARIO}/departments/${demoId('department', 'nope')}/day`);
    expect(out.status).toBe(404);
    expect(out.body).toEqual(missing.body);
    expect((await call('STM', 'GET', `/scenarios/${SCENARIO}/departments/${qcMain}/day`)).status).toBe(200);
  });

  it('exports the hour-by-hour plan as CSV (Store Manager may export, Req 5.3)', async () => {
    const before = await exportCount();
    const res = await call('STM', 'GET', `/scenarios/${SCENARIO}/departments/${qcMain}/day/export`, { date: '2026-12-19' });
    expect(res.status).toBe(200);
    expect(res.body.content).toContain('Hour,Transactions,Erlangs');
    expect(res.body.content.startsWith(SAMPLE_DATA_MARKER)).toBe(true);
    expect(await exportCount()).toBe(before + 1);
    expect((await call('HR', 'GET', `/scenarios/${SCENARIO}/departments/${qcMain}/day/export`)).status).toBe(403);
  });
});

describe('14.2 background jobs — hiring plan', () => {
  let job: PlanningJob;

  it('runs as a job with progress over departments, audited once, and notifies the requester (Req 10.2, P7)', async () => {
    const audits = await auditCount();
    const res = await call('PLN', 'POST', `/scenarios/${SCENARIO}/hiring-plan/jobs`, undefined, {});
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    job = res.body.job as PlanningJob;
    expect(job.status).toBe('succeeded'); // in-process queue
    expect(job.unitsTotal).toBe(24);
    expect(job.unitsDone).toBe(24);
    expect(job.progress).toBe(1);
    expect(await auditCount()).toBe(audits + 1);
    const notes = await count(`SELECT count(*)::int AS n FROM notification WHERE event = 'planning_job.succeeded' AND user_id = '${demoUserId('PLN')}'`);
    expect(notes).toBe(1);
    const status = await call('HR', 'GET', `/scenarios/${SCENARIO}/hiring-plan/jobs/${job.id}`);
    expect(status.body.job).toMatchObject({ id: job.id, status: 'succeeded', type: 'hiring_plan' });
  }, 120_000);

  it('caches results per scenario version: a repeat request returns the same job, with no new audit event (NFR-REL-002)', async () => {
    const audits = await auditCount();
    const again = await call('PLN', 'POST', `/scenarios/${SCENARIO}/hiring-plan/jobs`, undefined, {});
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ cached: true, job: { id: job.id } });
    expect(await auditCount()).toBe(audits);
    expect((await call('HR', 'POST', `/scenarios/${SCENARIO}/hiring-plan/jobs`, undefined, {})).status).toBe(403);
  });

  it('matches the engine’s network hiring plan (P2 parity) and records its inputs (P6)', async () => {
    const view = (await call('PLN', 'GET', `/scenarios/${SCENARIO}/hiring-plan`)).body.view as HiringPlanView;
    expect(view.plan).not.toBeNull();
    expect(view.provenance.runId).toBe(job.id);
    expect(view.provenance.stale).toBe(false);

    const scenario = await getScenarioRecord(db.pool, SCENARIO);
    const inputs = await loadRunInputs(db.pool, job.id);
    const ctx = contextForRun(inputs, scenario?.settings ?? { growth: 1, allowPartTime: true });
    const org = orgLookup(await loadOrgRows(db.pool, true), ctx);
    const staff = await db.pool.query<{ department_id: string; t: string; n: number }>(
      `SELECT department_id, weekly_pattern->>'contractType' AS t, count(*)::int AS n FROM staff WHERE synthetic AND active GROUP BY 1, 2`,
    );
    const current = ctx.departments.flatMap((d) =>
      CONTRACT_TYPES.map((t) => ({
        departmentId: d.id,
        contractType: t,
        count: staff.rows.find((r) => r.department_id === org.departmentFor(d.id)?.id && r.t === t)?.n ?? 0,
      })),
    );
    const plans = dateRange('2026-12-01', '2026-12-31').flatMap((date) => ctx.departments.map((d) => planDepartmentDay(ctx, d.id, date)));
    const expected = buildHiringPlan(plans, current, ctx.rules.hiring);
    expect(view.plan?.kpis.seasonalHires).toBe(expected.totalHires);
    expect(view.plan?.kpis.peakTeam).toBe(expected.teamSizes.reduce((n, t) => n + t.headcount, 0));
    expect(view.plan?.kpis.firstNeededBy).toBe(expected.waves[0]?.needBy ?? null);
    expect(view.plan?.timeline.length).toBe(expected.waves.reduce((n, w) => n + w.milestones.length, 0));
  }, 120_000);

  it('limits the plan to the scope: a Store Manager sees their store only, without network cost (P1)', async () => {
    const view = (await call('STM', 'GET', `/scenarios/${SCENARIO}/hiring-plan`)).body.view as HiringPlanView;
    expect(view.plan?.stores.map((s) => s.storeId)).toEqual([QC]);
    expect(view.plan?.kpis.seasonCost).toBeUndefined();
    expect(view.plan?.kpis.seasonalHires).toBe(view.plan?.stores[0]?.hires);
  });

  it('exports the hiring plan as CSV with provenance (audited)', async () => {
    const before = await exportCount();
    const res = await call('HR', 'GET', `/scenarios/${SCENARIO}/hiring-plan/export`);
    expect(res.status).toBe(200);
    expect(res.body.content).toContain(`Run,${job.id}`);
    expect(res.body.content).toContain('Seasonal hires');
    expect(await exportCount()).toBe(before + 1);
    expect((await call('STM', 'GET', `/scenarios/${SCENARIO}/hiring-plan/export`)).status).toBe(403);
  });
});

describe('14.2 background jobs — resumable and idempotent (NFR-REL-001)', () => {
  async function newJob(departmentId: string): Promise<PlanningJob> {
    const scenario = await getScenarioRecord(db.pool, SCENARIO);
    if (!scenario) throw new Error('missing scenario');
    const params = { settings: scenario.settings, from: '2026-12-01', to: '2026-12-29', departmentId };
    const actor = actorFromPrincipal(
      { userId: demoUserId('PLN'), email: emails.PLN, name: 'PLN', activeRole: 'PLN', assignments: [], scope: { type: 'global' }, demoMode: false },
      null,
    );
    const key = `test:${departmentId}:${Math.random()}`;
    return withAuditedTransaction(db.pool, actor, (tx) => jobs.createJob(tx, { type: 'long_roster', scenario, params, key }));
  }

  it('resumes after the last checkpoint instead of redoing finished units', async () => {
    const job = await newJob(qcMain);
    // A previous delivery finished the only unit, then the worker died.
    const sentinel = { departmentId: qcMain, departmentName: 'resumed', storeId: QC, storeName: 'QC', regionId: 'r', weeks: [] };
    await db.pool.query(`UPDATE scenario_run SET status = 'running' WHERE id = $1`, [job.id]);
    await db.pool.query(`INSERT INTO scenario_run_checkpoint (run_id, unit_key, synthetic, result) VALUES ($1, $2, true, $3)`, [
      job.id,
      qcMain,
      JSON.stringify(sentinel),
    ]);
    expect(await jobs.processPlanningJob(db.pool, job.id)).toBe('succeeded');
    const { rows } = await db.pool.query<{ results: { departments: { departmentName: string }[] } }>(
      'SELECT results FROM scenario_run_result WHERE run_id = $1',
      [job.id],
    );
    expect(rows[0]?.results.departments.map((d) => d.departmentName)).toEqual(['resumed']);
    // A duplicate delivery of a finished job does nothing.
    expect(await jobs.processPlanningJob(db.pool, job.id)).toBe('skipped');
  });

  it('a job lost for over an hour no longer blocks a new request for the same version', async () => {
    const job = await newJob(qcMain);
    await db.pool.query(`UPDATE scenario_run SET status = 'running', created_at = now() - interval '2 hours' WHERE id = $1`, [job.id]);
    const stuck = await jobs.getJob(db.pool, SCENARIO, job.id, 'long_roster');
    expect(stuck && jobs.isStuck(stuck, new Date())).toBe(true);
    expect(jobs.isStuck({ status: 'running', createdAt: new Date().toISOString() }, new Date())).toBe(false);
    expect(jobs.isStuck({ status: 'succeeded', createdAt: '2020-01-01T00:00:00Z' }, new Date())).toBe(false);
  });

  it('the worker reports malformed messages for retry and processes valid ones', async () => {
    const job = await newJob(qcMain);
    const handler = createWorkerHandler(() => db.pool, () => undefined);
    const out = await handler({
      Records: [
        { messageId: 'm1', body: 'not json' },
        { messageId: 'm2', body: JSON.stringify({ type: 'long_roster', jobId: job.id }) },
      ],
    } as never);
    expect(out.batchItemFailures).toEqual([{ itemIdentifier: 'm1' }]);
    const done = await jobs.getJob(db.pool, SCENARIO, job.id, 'long_roster');
    expect(done?.status).toBe('succeeded');
  });
});

describe('14.2 background jobs — long rosters', () => {
  it('runs rosters longer than four weeks as a job; results summarise weeks without naming anyone (Req 10.2, P11)', async () => {
    const res = await call('PLN', 'POST', `/scenarios/${SCENARIO}/rosters/jobs`, undefined, { from: '2026-12-01', to: '2026-12-31', departmentId: qcMain });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const job = res.body.job as PlanningJob;
    expect(job.status).toBe('succeeded');
    const got = await call('STM', 'GET', `/scenarios/${SCENARIO}/rosters/jobs/${job.id}`);
    expect(got.status).toBe(200);
    const view = got.body.view as LongRosterView;
    expect(view.weeks?.length).toBeGreaterThanOrEqual(5);
    expect(view.weeks?.every((w) => w.shifts === w.assigned + w.openShifts)).toBe(true);
    const names = await db.pool.query<{ name: string }>('SELECT name FROM staff WHERE department_id = $1', [qcMain]);
    const raw = JSON.stringify(got.body);
    for (const n of names.rows) expect(raw).not.toContain(n.name);
  }, 120_000);

  it('refuses short periods, and scopes Store Managers to their own departments', async () => {
    expect((await call('PLN', 'POST', `/scenarios/${SCENARIO}/rosters/jobs`, undefined, { from: '2026-12-01', to: '2026-12-10', departmentId: qcMain })).status).toBe(422);
    expect((await call('STM', 'POST', `/scenarios/${SCENARIO}/rosters/jobs`, undefined, { from: '2026-12-01', to: '2026-12-31' })).status).toBe(422);
    expect((await call('STM', 'POST', `/scenarios/${SCENARIO}/rosters/jobs`, undefined, { from: '2026-12-01', to: '2026-12-31', departmentId: otherDept })).status).toBe(404);
    expect((await call('HR', 'POST', `/scenarios/${SCENARIO}/rosters/jobs`, undefined, { from: '2026-12-01', to: '2026-12-31', departmentId: qcMain })).status).toBe(403);
  });
});

describe('14.3 leadership summary (SCR-024)', () => {
  it('summarises the hiring plan with the sample-data badge and provenance (Req 10.3, 18.3)', async () => {
    const res = await call('EXE', 'GET', `/scenarios/${SCENARIO}/summary`);
    expect(res.status).toBe(200);
    const s = res.body.summary as LeadershipSummary;
    expect(s.sampleData).toBe(true);
    expect(s.hiring?.kpis.seasonalHires).toBeGreaterThan(0);
    expect(s.storeCount).toBe(8);
    expect(s.peak).toEqual({ date: '2026-12-19', hour: 17, lanesOpen: 254 });
    expect(s.offersDue).not.toBeNull();
    expect(s.provenance.runId).not.toBeNull();
    expect((await call('STM', 'GET', `/scenarios/${SCENARIO}/summary`)).status).toBe(403);
  });

  it('exports a print-ready A4 page and a CSV, each audited once and marked SAMPLE DATA (P7, P9)', async () => {
    const before = await exportCount();
    const html = await call('FIN', 'GET', `/scenarios/${SCENARIO}/summary/export`, { format: 'html' });
    expect(html.status).toBe(200);
    expect(html.body.contentType).toBe('text/html');
    expect(html.body.content).toContain('size: A4');
    expect(html.body.content).toContain('SAMPLE DATA');
    const csv = await call('FIN', 'GET', `/scenarios/${SCENARIO}/summary/export`, { format: 'csv' });
    expect(csv.body.content.startsWith(SAMPLE_DATA_MARKER)).toBe(true);
    expect(await exportCount()).toBe(before + 2);
    const { rows } = await db.pool.query<{ after: { format: string } }>(
      `SELECT after FROM audit_event WHERE action = 'export' ORDER BY seq DESC LIMIT 2`,
    );
    expect(rows.map((r) => r.after.format).sort()).toEqual(['csv', 'pdf']);
  });
});
