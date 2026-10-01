/**
 * `/scenarios` routes (task 11; Req 8.1–8.6; P3, P4, P5, P6, P7, P12).
 *
 * Runs against a real PostgreSQL seeded with the task 23 demo network (one
 * user per role, synthetic snapshots and published rule versions, a
 * published Christmas scenario), through the app router with the real RBAC
 * enforcer and cost shaping.
 */
import {
  DEFAULT_SCENARIO_SETTINGS,
  ENGINE_SETTING_DEFAULTS,
  type RoleCode,
  type ScenarioComparison,
  type ScenarioDetail,
  type ScenarioListItem,
} from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import { withAuditedTransaction } from '../../src/db/audit.js';
import { DEMO_SEASON, demoId, demoUserId } from '../../src/db/demo/dataset.js';
import { seedDemoData } from '../../src/db/demo/seed.js';
import * as scenariosRepo from '../../src/db/repositories/scenarios.js';
import type { Router } from '../../src/http/router.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { dispatch, identity, type TestResponse } from '../support/dispatch.js';
import { insertSnapshot } from '../support/fixtures.js';
import { MemoryStorage } from '../support/memory-storage.js';

let db: TestDatabase;
let app: Router;
const emails = {} as Record<RoleCode, string>;
const PUBLISHED_ID = demoId('scenario', DEMO_SEASON);

async function call(role: RoleCode, method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<TestResponse> {
  return dispatch(app, method, path, {
    identity: identity(emails[role]),
    role,
    ...(body === undefined ? {} : { body }),
    ...(query === undefined ? {} : { query }),
  });
}

async function auditCount(): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_event');
  return rows[0]?.n ?? 0;
}

async function createDraft(name = 'Christmas 2026 v4'): Promise<ScenarioDetail> {
  const res = await call('PLN', 'POST', '/scenarios', { name, season: DEMO_SEASON });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.scenario as ScenarioDetail;
}

async function run(id: string): Promise<ScenarioDetail> {
  const res = await call('PLN', 'POST', `/scenarios/${id}/run`, {});
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.scenario as ScenarioDetail;
}

beforeAll(async () => {
  db = await createTestDatabase();
  await seedDemoData(db.pool);
  const { rows } = await db.pool.query<{ id: string; email: string }>('SELECT id, email FROM app_user');
  for (const role of ['ADM', 'EXE', 'PLN', 'STM', 'HR', 'FIN', 'RST', 'STF'] as const) {
    const user = rows.find((r) => r.id === demoUserId(role));
    if (!user) throw new Error(`demo user for ${role} missing`);
    emails[role] = user.email;
  }
  app = createApp({ db: () => db.pool, rbac: DEFAULT_RBAC_CONFIG, storage: () => new MemoryStorage() });
}, 120_000);

afterAll(async () => {
  await db?.dispose();
});

describe('11.1 scenario CRUD, lifecycle and runs', () => {
  it('creates a Draft pinned to the current snapshots and rule versions, with one audit event (Req 8.1, P7)', async () => {
    const before = await auditCount();
    const s = await createDraft();
    expect(await auditCount()).toBe(before + 1);
    expect(s.status).toBe('draft');
    expect(s.synthetic).toBe(true);
    expect(s.settings).toEqual(DEFAULT_SCENARIO_SETTINGS);
    expect(s.snapshots.map((p) => p.datasetType).sort()).toEqual(['master', 'pos', 'staff']);
    expect(s.snapshots.every((p) => p.current)).toBe(true);
    expect(s.ruleVersions.length).toBeGreaterThanOrEqual(5);
    expect(s.ruleVersions.every((p) => p.current)).toBe(true);
    expect(s.stale).toBe(false);
    expect(s.editable).toBe(true);
    expect(s.submitBlocker).toBe('not_run');
    expect(s.latestRun).toBeNull();
  });

  it('returns the rule defaults, the base hourly rate, POS-learned departments and rule publish times', async () => {
    const s = await createDraft('Defaults check');
    // The demo rule versions carry the engine defaults.
    expect(s.defaults).toEqual(ENGINE_SETTING_DEFAULTS);
    expect(s.baseHourlyRate).toBe(80);
    expect(s.departments).toHaveLength(24);
    const qc = s.departments.find((d) => d.departmentId === demoId('department', 'smsm-qc:main'));
    expect(qc).toMatchObject({ storeId: demoId('store', 'smsm-qc'), departmentName: 'Main lanes', storeName: 'SM Supermarket – Quezon City' });
    expect(qc?.baselineTxPerDay).toBeGreaterThan(0);
    expect(qc?.handleTimeMin).toBeGreaterThan(0);
    expect(typeof qc?.upliftPct).toBe('number');
    expect(s.ruleVersions.every((p) => typeof p.publishedAt === 'string')).toBe(true);
    const latest = s.ruleVersions.map((p) => Date.parse(p.publishedAt ?? '')).reduce((a, b) => Math.max(a, b), 0);
    expect(Date.parse(s.rulesAsOf ?? '')).toBe(latest);
    const list = (await call('PLN', 'GET', '/scenarios', undefined, { q: 'Defaults check' })).body.scenarios as ScenarioListItem[];
    expect(list[0]?.rulesAsOf).toBe(s.rulesAsOf);
  });

  it('filters the list to the caller\'s own scenarios with owner=me', async () => {
    await createDraft('Owner check');
    const mine = (await call('PLN', 'GET', '/scenarios', undefined, { owner: 'me' })).body.scenarios as ScenarioListItem[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((x) => x.ownerId === demoUserId('PLN'))).toBe(true);
    const hr = await call('HR', 'GET', '/scenarios', undefined, { owner: 'me' });
    expect(hr.status).toBe(200);
    expect(hr.body.scenarios).toEqual([]);
    const bad = await call('PLN', 'GET', '/scenarios', undefined, { owner: 'someone' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('validation_failed');
  });

  it('validates overrides, with the department row and field in the path, and saves them', async () => {
    const s = await createDraft('Override check');
    const deptId = demoId('department', 'smsm-qc:main');
    const bad = await call('PLN', 'PATCH', `/scenarios/${s.id}`, {
      settings: {
        ...DEFAULT_SCENARIO_SETTINGS,
        waitSeconds: 5,
        departmentOverrides: [{ departmentId: deptId, baselineTxPerDay: null, handleTimeMin: 99, upliftPct: null }],
      },
    });
    expect(bad.status).toBe(422);
    const paths = (bad.body.error.details as { path: string }[]).map((d) => d.path).sort();
    expect(paths).toEqual(['body.settings.departmentOverrides.0.handleTimeMin', 'body.settings.waitSeconds']);

    const settings = {
      ...DEFAULT_SCENARIO_SETTINGS,
      waitSeconds: 45,
      ftShiftPattern: '7+1' as const,
      departmentOverrides: [{ departmentId: deptId, baselineTxPerDay: 2000, handleTimeMin: null, upliftPct: null }],
    };
    const ok = await call('PLN', 'PATCH', `/scenarios/${s.id}`, { settings });
    expect(ok.status).toBe(200);
    expect((ok.body.scenario as ScenarioDetail).settings).toEqual(settings);
    // Keys left out mean "rule default".
    const legacy: Record<string, unknown> = { ...settings };
    for (const k of ['waitSeconds', 'ftShiftPattern', 'departmentOverrides']) delete legacy[k];
    const old = await call('PLN', 'PATCH', `/scenarios/${s.id}`, { settings: legacy });
    expect(old.status).toBe(200);
    expect((old.body.scenario as ScenarioDetail).settings).toEqual(DEFAULT_SCENARIO_SETTINGS);
  });

  it('runs the engine and records exactly the pinned inputs on the run (P6)', async () => {
    const s = await run((await createDraft('Run check')).id);
    const r = s.latestRun;
    expect(r?.status).toBe('succeeded');
    expect(r?.snapshotIds).toEqual(Object.fromEntries(s.snapshots.map((p) => [p.datasetType, p.snapshotId])));
    expect([...(r?.ruleVersionIds ?? [])].sort()).toEqual(s.ruleVersions.map((p) => p.ruleVersionId).sort());
    const results = r?.results;
    expect(results?.stores.length).toBe(8);
    expect(results?.headcount).toBeGreaterThan(0);
    expect(results?.paidHours).toBeGreaterThan(0);
    expect(results?.cost).toBeGreaterThan(0);
    // DOM-001 Fixture C: the demo network peaks at 254 lanes at 17:00 on Dec 19.
    expect(results?.peak).toEqual({ date: '2026-12-19', hour: 17, lanesOpen: 254 });
    // Hires against the seeded active staff, per store and in total.
    expect(results?.stores.every((x) => typeof x.hires === 'number')).toBe(true);
    expect(results?.seasonalHires).toBe(results?.stores.reduce((sum, x) => sum + (x.hires ?? 0), 0));
    if ((results?.seasonalHires ?? 0) > 0) expect(results?.firstNeededBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    else expect(results?.firstNeededBy).toBeNull();
    expect(s.submitBlocker).toBeNull();
    expect(s.lastRunAt).not.toBeNull();
  });

  it('keeps settings read-only outside Draft and requires "Duplicate as draft" (P4)', async () => {
    const s = await run((await createDraft('Freeze check')).id);
    expect((await call('PLN', 'POST', `/scenarios/${s.id}/submit`, {})).status).toBe(200);
    await fc.assert(
      fc.asyncProperty(
        fc.record({ growth: fc.double({ min: 0.5, max: 2, noNaN: true }), allowPartTime: fc.boolean() }),
        async (patch) => {
          const before = await auditCount();
          const res = await call('PLN', 'PATCH', `/scenarios/${s.id}`, { settings: { ...DEFAULT_SCENARIO_SETTINGS, ...patch } });
          expect(res.status).toBe(409);
          expect(await auditCount()).toBe(before);
        },
      ),
      { numRuns: 15 },
    );
    expect((await call('PLN', 'POST', `/scenarios/${s.id}/run`, {})).status).toBe(409);
    // Overrides are settings too: frozen outside Draft.
    const override = await call('PLN', 'PATCH', `/scenarios/${s.id}`, { settings: { ...DEFAULT_SCENARIO_SETTINGS, waitSeconds: 30 } });
    expect(override.status).toBe(409);
    const after = (await call('PLN', 'GET', `/scenarios/${s.id}`)).body.scenario as ScenarioDetail;
    expect(after.settings).toEqual(s.settings);
    expect(after.editable).toBe(false);

    const copy = await call('PLN', 'POST', `/scenarios/${s.id}/duplicate`, { name: 'Freeze check v2' });
    expect(copy.status).toBe(201);
    const draft = copy.body.scenario as ScenarioDetail;
    expect(draft).toMatchObject({ status: 'draft', parentScenarioId: s.id, name: 'Freeze check v2', settings: s.settings });
    expect(draft.snapshots.map((p) => p.snapshotId)).toEqual(s.snapshots.map((p) => p.snapshotId));
  });

  it('validates settings and edits a Draft', async () => {
    const s = await createDraft('Edit check');
    const bad = await call('PLN', 'PATCH', `/scenarios/${s.id}`, { settings: { ...DEFAULT_SCENARIO_SETTINGS, growth: 9 } });
    expect(bad.status).toBe(422);
    const ok = await call('PLN', 'PATCH', `/scenarios/${s.id}`, {
      name: 'Edit check (5% growth)',
      settings: { ...DEFAULT_SCENARIO_SETTINGS, growth: 1.1, allowPartTime: false },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.scenario).toMatchObject({ name: 'Edit check (5% growth)', settings: { growth: 1.1, allowPartTime: false } });
  });

  it('archives a Draft and refuses to archive a Published scenario', async () => {
    const s = await createDraft('Archive check');
    const res = await call('PLN', 'POST', `/scenarios/${s.id}/archive`, {});
    expect(res.status).toBe(200);
    expect(res.body.scenario.status).toBe('archived');
    expect((await call('PLN', 'POST', `/scenarios/${PUBLISHED_ID}/archive`, {})).status).toBe(409);
  });

  it('lists with filters and marks the season\'s Published scenario ★', async () => {
    const res = await call('PLN', 'GET', '/scenarios', undefined, { status: 'published' });
    expect(res.status).toBe(200);
    expect(res.body.scenarios).toEqual([expect.objectContaining({ id: PUBLISHED_ID, isPublished: true })]);
    const q = await call('PLN', 'GET', '/scenarios', undefined, { q: 'Edit check' });
    expect(q.body.scenarios.map((s: { name: string }) => s.name)).toEqual(['Edit check (5% growth)']);
  });

  it('enforces the RBAC matrix: only the Planner mutates; Store Managers see Published only (P12)', async () => {
    for (const role of ['EXE', 'HR', 'FIN', 'RST', 'STM'] as const) {
      expect((await call(role, 'POST', '/scenarios', { name: 'x', season: DEMO_SEASON })).status).toBe(403);
    }
    expect((await call('STF', 'GET', '/scenarios')).status).toBe(403);
    expect((await call('ADM', 'GET', '/scenarios')).status).toBe(403);
    const stm = await call('STM', 'GET', '/scenarios');
    expect(stm.body.scenarios.map((s: { status: string }) => s.status)).toEqual(['published']);
    const draft = (await call('PLN', 'GET', '/scenarios', undefined, { status: 'draft' })).body.scenarios[0] as { id: string };
    expect((await call('STM', 'GET', `/scenarios/${draft.id}`)).status).toBe(404);
  });
});

describe('11.1 P3 single published scenario per season', () => {
  it('never has two Published scenarios in a season, whatever the order of publishes', async () => {
    const owner = demoUserId('PLN');
    const exec = { userId: demoUserId('EXE'), activeRole: 'EXE' as const, requestId: null };
    const planner = { userId: owner, activeRole: 'PLN' as const, requestId: null };
    const hr = { userId: demoUserId('HR'), activeRole: 'HR' as const, requestId: null };
    const fin = { userId: demoUserId('FIN'), activeRole: 'FIN' as const, requestId: null };
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom('p3-a', 'p3-b'), { minLength: 1, maxLength: 4 }), async (seasons) => {
        for (const season of seasons) {
          const s = await withAuditedTransaction(db.pool, planner, (tx) =>
            scenariosRepo.createScenario(tx, { name: 'P3', season, settings: {}, synthetic: true }),
          );
          await withAuditedTransaction(db.pool, planner, (tx) => scenariosRepo.submitScenario(tx, s.id));
          await withAuditedTransaction(db.pool, hr, (tx) =>
            scenariosRepo.decideApprovalStep(tx, { scenarioId: s.id, step: 'headcount', decision: 'approved' }),
          );
          await withAuditedTransaction(db.pool, fin, (tx) =>
            scenariosRepo.decideApprovalStep(tx, { scenarioId: s.id, step: 'budget', decision: 'approved' }),
          );
          await withAuditedTransaction(db.pool, exec, (tx) => scenariosRepo.approvePlanAndPublish(tx, s.id));
          const { rows } = await db.pool.query<{ season: string; n: number }>(
            `SELECT season, count(*)::int AS n FROM scenario WHERE status = 'published' GROUP BY season, synthetic`,
          );
          for (const r of rows) expect(r.n, r.season).toBe(1);
        }
        // A second Published row in the season is refused by the database too.
        await expect(
          db.pool.query(
            `INSERT INTO scenario (name, season, owner_id, settings, status, published_at, synthetic)
             VALUES ('P3 dup', $1, $2, '{}', 'published', now(), true)`,
            [seasons[0], owner],
          ),
        ).rejects.toThrow(/scenario_one_published_per_season/);
      }),
      { numRuns: 5 },
    );
  });
});

describe('11.2 staleness (P5)', () => {
  it('flags settings changed after the last run, blocks submit, and clears on recalculate', async () => {
    const s = await run((await createDraft('Settings stale')).id);
    const edited = await call('PLN', 'PATCH', `/scenarios/${s.id}`, { settings: { ...DEFAULT_SCENARIO_SETTINGS, growth: 1.2 } });
    expect(edited.body.scenario).toMatchObject({ stale: true, staleReasons: ['settings_changed'], submitBlocker: 'stale' });
    const blocked = await call('PLN', 'POST', `/scenarios/${s.id}/submit`, {});
    expect(blocked.status).toBe(409);
    const rerun = await run(s.id);
    expect(rerun).toMatchObject({ stale: false, submitBlocker: null });
  });

  it('flags a superseded snapshot, pauses a submitted scenario and notifies approvers; refresh re-pins a new draft', async () => {
    const draft = await run((await createDraft('Snapshot stale (draft)')).id);
    const submitted = await run((await createDraft('Snapshot stale (submitted)')).id);
    expect((await call('PLN', 'POST', `/scenarios/${submitted.id}/submit`, {})).status).toBe(200);
    const pausedBefore = await db.pool.query(`SELECT 1 FROM notification WHERE event = 'scenario.paused' AND object_id = $1`, [submitted.id]);
    expect(pausedBefore.rowCount).toBe(0);

    // A new POS load supersedes the pinned snapshot (task 9 marks the pinning scenarios stale).
    const newPos = await insertSnapshot(db.pool, { type: 'pos', synthetic: true });
    await db.pool.query(
      `UPDATE scenario SET stale = true, stale_reason = 'snapshot_superseded'
        WHERE id IN (SELECT scenario_id FROM scenario_snapshot WHERE dataset_type = 'pos' AND snapshot_id <> $1)
          AND status IN ('draft', 'submitted')`,
      [newPos],
    );

    const d = (await call('PLN', 'GET', `/scenarios/${draft.id}`)).body.scenario as ScenarioDetail;
    expect(d).toMatchObject({ stale: true, staleReasons: ['snapshot_superseded'], submitBlocker: 'stale' });
    expect(d.snapshots.find((p) => p.datasetType === 'pos')?.current).toBe(false);
    expect((await call('PLN', 'POST', `/scenarios/${draft.id}/submit`, {})).status).toBe(409);

    // Paused: approvers (HR, FIN, EXE) notified; no approval decision is accepted.
    const notified = await db.pool.query<{ user_id: string }>(
      `SELECT user_id FROM notification WHERE event = 'scenario.paused' AND object_id = $1`,
      [submitted.id],
    );
    expect(notified.rows.map((r) => r.user_id).sort()).toEqual([demoUserId('EXE'), demoUserId('HR'), demoUserId('FIN')].sort());
    const hr = { userId: demoUserId('HR'), activeRole: 'HR' as const, requestId: null };
    await expect(
      withAuditedTransaction(db.pool, hr, (tx) =>
        scenariosRepo.decideApprovalStep(tx, { scenarioId: submitted.id, step: 'headcount', decision: 'approved' }),
      ),
    ).rejects.toThrow(/paused/);

    // Refresh: a new Draft re-pinned to the current data.
    const refreshed = await call('PLN', 'POST', `/scenarios/${submitted.id}/refresh`, {});
    expect(refreshed.status).toBe(201);
    const fresh = refreshed.body.scenario as ScenarioDetail;
    expect(fresh).toMatchObject({ status: 'draft', parentScenarioId: submitted.id, stale: false });
    expect(fresh.snapshots.find((p) => p.datasetType === 'pos')?.snapshotId).toBe(newPos);

    // Recalculating a stale Draft re-pins it to the current data before the run.
    const recalculated = await run(draft.id);
    expect(recalculated.stale).toBe(false);
    expect(recalculated.latestRun?.snapshotIds.pos).toBe(newPos);
  });
});

describe('11.3 compare', () => {
  it('shows settings differences and result deltas (headcount, hours, cost, peak lanes)', async () => {
    const a = await run((await createDraft('Compare A')).id);
    const b0 = await createDraft('Compare B');
    await call('PLN', 'PATCH', `/scenarios/${b0.id}`, { settings: { ...DEFAULT_SCENARIO_SETTINGS, growth: 1.2 } });
    const b = await run(b0.id);
    const res = await call('PLN', 'GET', '/scenarios/compare', undefined, { a: a.id, b: b.id });
    expect(res.status).toBe(200);
    const c = res.body as ScenarioComparison;
    expect(c.settings).toEqual([{ key: 'growth', from: 1.05, to: 1.2 }]);
    expect(c.departmentSettings).toEqual([]);
    expect(c.results.seasonalHires.delta).toBe((b.latestRun?.results?.seasonalHires ?? 0) - (a.latestRun?.results?.seasonalHires ?? 0));
    expect(c.results.stores.every((x) => x.hires.a !== null && x.hires.b !== null)).toBe(true);
    expect(c.results.headcount.delta).toBe((b.latestRun?.results?.headcount ?? 0) - (a.latestRun?.results?.headcount ?? 0));
    expect(c.results.headcount.delta).toBeGreaterThan(0);
    expect(c.results.peakLanes.delta).toBeGreaterThan(0);
    expect(c.results.cost?.delta).toBeGreaterThan(0);
    expect(c.results.stores).toHaveLength(8);

    // HR sees cost; a Store Manager may only compare Published scenarios.
    const hr = await call('HR', 'GET', '/scenarios/compare', undefined, { a: a.id, b: b.id });
    expect(hr.body.results.cost).toBeDefined();
    expect((await call('STM', 'GET', '/scenarios/compare', undefined, { a: a.id, b: b.id })).status).toBe(404);
  });

  it('limits a Store Manager to their own store, without network cost (P1, task 21)', async () => {
    const s = await run((await createDraft('Scope check')).id);
    expect((await call('PLN', 'POST', `/scenarios/${s.id}/submit`, {})).status).toBe(200);
    const actor = (role: 'HR' | 'FIN' | 'EXE') => ({ userId: demoUserId(role), activeRole: role, requestId: null });
    await withAuditedTransaction(db.pool, actor('HR'), (tx) =>
      scenariosRepo.decideApprovalStep(tx, { scenarioId: s.id, step: 'headcount', decision: 'approved' }),
    );
    await withAuditedTransaction(db.pool, actor('FIN'), (tx) =>
      scenariosRepo.decideApprovalStep(tx, { scenarioId: s.id, step: 'budget', decision: 'approved' }),
    );
    await withAuditedTransaction(db.pool, actor('EXE'), (tx) => scenariosRepo.approvePlanAndPublish(tx, s.id));

    const res = await call('STM', 'GET', `/scenarios/${s.id}`);
    expect(res.status).toBe(200);
    const seen = res.body.scenario as ScenarioDetail;
    expect(seen.isPublished).toBe(true);
    const results = seen.latestRun?.results;
    expect(results?.cost).toBeUndefined();
    const stores = results?.stores ?? [];
    expect(stores.map((x) => x.storeId)).toEqual([demoId('store', 'smsm-qc')]);
    expect(stores.every((x) => (x.cost ?? 0) > 0)).toBe(true);
    expect(results?.headcount).toBe(stores.reduce((sum, x) => sum + x.headcount, 0));
    expect(results?.seasonalHires).toBe(stores.reduce((sum, x) => sum + (x.hires ?? 0), 0));
    // The base hourly rate is a network cost figure: hidden from a Store Manager; departments in scope only.
    expect(seen.baseHourlyRate).toBeUndefined();
    expect('baseHourlyRate' in seen).toBe(false);
    expect(new Set(seen.departments.map((d) => d.storeId))).toEqual(new Set([demoId('store', 'smsm-qc')]));
    expect(seen.departments).toHaveLength(2);
    // The seeded plan it superseded is no longer listed for the Store Manager.
    const list = await call('STM', 'GET', '/scenarios', undefined, { season: DEMO_SEASON });
    expect(list.body.scenarios.map((x: { id: string }) => x.id)).toEqual([s.id]);
  });
});

describe('11.3 compare department overrides and engine overrides', () => {
  it('lists department override changes and applies service and shift overrides to the run', async () => {
    const deptId = demoId('department', 'smsm-qc:express');
    const a = await run((await createDraft('Override A')).id);
    const b0 = await createDraft('Override B');
    const patched = await call('PLN', 'PATCH', `/scenarios/${b0.id}`, {
      settings: {
        ...DEFAULT_SCENARIO_SETTINGS,
        waitSeconds: 30,
        servedWithinPct: 95,
        departmentOverrides: [{ departmentId: deptId, baselineTxPerDay: null, handleTimeMin: 1.5, upliftPct: null }],
      },
    });
    expect(patched.status).toBe(200);
    const b = await run(b0.id);
    const c = (await call('PLN', 'GET', '/scenarios/compare', undefined, { a: a.id, b: b.id })).body as ScenarioComparison;
    expect(c.departmentSettings).toEqual([{ departmentId: deptId, field: 'handleTimeMin', from: null, to: 1.5 }]);
    expect(c.settings.map((x) => x.key)).toEqual(['servedWithinPct', 'waitSeconds']);
    expect(c.results.headcount.delta).toBeGreaterThanOrEqual(0);
    expect(c.results.peakLanes.delta).toBeGreaterThan(0);

    const p0 = await createDraft('Override pattern');
    await call('PLN', 'PATCH', `/scenarios/${p0.id}`, { settings: { ...DEFAULT_SCENARIO_SETTINGS, ftShiftPattern: '7+1' } });
    const p = await run(p0.id);
    expect(p.latestRun?.results?.paidHours).not.toBe(a.latestRun?.results?.paidHours);
  });
});
