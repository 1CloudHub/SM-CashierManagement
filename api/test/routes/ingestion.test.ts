/**
 * Task 9 routes end to end against a real PostgreSQL (embedded) and an
 * in-memory object store: upload URL -> validate -> load/cancel, blocked
 * loads keep the prior dataset (Req 17.3), staleness + notifications on load
 * (Req 17.4, P5), history (Req 17.5), synthetic flag (Req 17.6), provenance
 * (Req 18, P9), one audit event per mutation (P7) and provenance isolation
 * (P18).
 */
import { randomUUID } from 'node:crypto';
import { DATASET_COLUMNS, SAMPLE_DATA_MARKER, type DatasetType, type RoleCode } from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, depsFromEnv, type AppDeps } from '../../src/app.js';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import { authorize } from '../../src/auth/guards.js';
import type { Router } from '../../src/http/router.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { dispatch, identity } from '../support/dispatch.js';
import { insertRegion, insertScenario, insertUser } from '../support/fixtures.js';
import { uniq } from '../support/rbac.js';
import { MemoryStorage } from '../support/memory-storage.js';

let db: TestDatabase;
let storage: MemoryStorage;
let app: Router;
let steward: string;
let planner: string;
let admin: string;

// Requests run through the real RBAC enforcer (task 8.1) with the demo role
// switcher on, so each test user can act in any role (demo scopes).
const emails = new Map<string, string>();
async function createUser(pool: TestDatabase['pool']): Promise<string> {
  const email = `ingest.${uniq()}@smretail.com`;
  const id = await insertUser(pool, { email });
  emails.set(id, email);
  return id;
}
const signedIn = (userId: string) => identity(emails.get(userId) ?? 'unknown@smretail.com');
const as = (userId: string, role: RoleCode) => ({ identity: signedIn(userId), role });
const deps = (pool: TestDatabase['pool'], mem: MemoryStorage): AppDeps => ({
  db: () => pool,
  rbac: DEFAULT_RBAC_CONFIG,
  storage: () => mem,
});

const POS_HEADER = DATASET_COLUMNS.pos.map((c) => c.field).join(',');
const MASTER_HEADER = DATASET_COLUMNS.master.map((c) => c.field).join(',');
const STAFF_HEADER = 'employee_no,name,store_code,department,employment_type';
const masterCsv = (lanes = 12): string => `${MASTER_HEADER}\nSMQC,SM QC,NCR,SM Supermarket,Main lanes,${lanes},2.5,10:00,22:00\n`;

async function auditCount(pool = db.pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_event');
  return rows[0]?.n ?? 0;
}

/** Presigns, "uploads" to the fake bucket and validates. */
async function upload(
  type: DatasetType,
  csv: string,
  opts: { synthetic?: boolean; mapping?: Record<string, string>; router?: Router; mem?: MemoryStorage; userId?: string } = {},
) {
  const router = opts.router ?? app;
  const who = as(opts.userId ?? steward, 'RST');
  const url = await dispatch(router, 'POST', '/ingestions/uploads', {
    ...who,
    body: { datasetType: type, fileName: `${type}.csv`, contentType: 'text/csv', sizeBytes: Buffer.byteLength(csv) },
  });
  expect(url.status).toBe(201);
  (opts.mem ?? storage).objects.set(url.body.fileKey, csv);
  return dispatch(router, 'POST', '/ingestions', {
    ...who,
    body: {
      datasetType: type,
      fileKey: url.body.fileKey,
      fileName: `${type}.csv`,
      synthetic: opts.synthetic ?? false,
      ...(opts.mapping ? { columnMapping: opts.mapping } : {}),
    },
  });
}

async function loadCsv(type: DatasetType, csv: string, synthetic = false) {
  const validated = await upload(type, csv, { synthetic });
  expect(validated.status).toBe(201);
  const loaded = await dispatch(app, 'POST', `/ingestions/${validated.body.run.id}/load`, {
    ...as(steward, 'RST'),
    body: { confirmWarnings: true },
  });
  expect(loaded.status).toBe(200);
  return loaded.body;
}

async function seedReference(pool: TestDatabase['pool']): Promise<void> {
  const regionId = await insertRegion(pool);
  const store = await pool.query<{ id: string }>(
    `INSERT INTO store (code, name, format, region_id) VALUES ('SMQC', 'SM QC', 'sm_supermarket', $1) RETURNING id`,
    [regionId],
  );
  await pool.query(
    `INSERT INTO department (store_id, name, installed_lanes, default_handle_time_min, trading_open, trading_close)
     VALUES ($1, 'Main lanes', 12, 2.5, '10:00', '22:00')`,
    [store.rows[0]?.id],
  );
}

beforeAll(async () => {
  db = await createTestDatabase();
  steward = await createUser(db.pool);
  planner = await createUser(db.pool);
  admin = await createUser(db.pool);
  await db.pool.query(
    `INSERT INTO role_assignment (user_id, role, scope_type) VALUES ($1, 'RST', 'global'), ($2, 'PLN', 'global')`,
    [steward, planner],
  );
  // Real reference master data: store SMQC, department "Main lanes" (12 installed lanes).
  await seedReference(db.pool);
});

afterAll(async () => {
  await db?.dispose();
});

beforeEach(() => {
  storage = new MemoryStorage();
  app = createApp(deps(db.pool, storage));
});

describe('upload URL (task 9.1)', () => {
  it('issues a presigned PUT for an uploads/ key of the dataset', async () => {
    const res = await dispatch(app, 'POST', '/ingestions/uploads', {
      ...as(steward, 'RST'),
      body: { datasetType: 'pos', fileName: 'POS hourly 2025.csv', contentType: 'text/csv', sizeBytes: 1000 },
    });
    expect(res.status).toBe(201);
    expect(res.body.fileKey).toMatch(/^uploads\/pos\/[0-9a-f-]{36}\/POS_hourly_2025\.csv$/);
    expect(res.body.headers).toEqual({ 'Content-Type': 'text/csv' });
    expect(storage.presigned[0]).toMatchObject({ key: res.body.fileKey, expiresInSeconds: 900 });
  });

  it('rejects non-CSV names and oversized files', async () => {
    const bad = await dispatch(app, 'POST', '/ingestions/uploads', {
      ...as(steward, 'RST'),
      body: { datasetType: 'pos', fileName: 'x.exe', contentType: 'text/csv', sizeBytes: 50 * 1024 * 1024 },
    });
    expect(bad.status).toBe(422);
  });
});

describe('validate -> load (Req 17.1-17.5)', () => {
  it('validates, loads, supersedes, marks pinned scenarios stale and notifies (one audit event per mutation)', async () => {
    const first = await loadCsv('master', masterCsv());
    const owner = await insertUser(db.pool);
    const scenarioId = await insertScenario(db.pool, owner);
    await db.pool.query(
      `INSERT INTO scenario_snapshot (scenario_id, dataset_type, snapshot_id, synthetic) VALUES ($1, 'master', $2, false)`,
      [scenarioId, first.snapshot.id],
    );
    const before = await auditCount();

    const validated = await upload('master', masterCsv(14));
    expect(validated.status).toBe(201);
    expect(validated.body.run).toMatchObject({ status: 'validated', rowCount: 1, validRowCount: 1, errorCount: 0 });
    expect(validated.body.impact).toEqual([expect.objectContaining({ id: scenarioId, ownerId: owner, alreadyStale: false })]);
    expect(await auditCount()).toBe(before + 1);

    const loaded = await dispatch(app, 'POST', `/ingestions/${validated.body.run.id}/load`, {
      ...as(steward, 'RST'),
      body: { confirmWarnings: false },
    });
    expect(loaded.status).toBe(200);
    expect(await auditCount()).toBe(before + 2);
    expect(loaded.body.run.status).toBe('loaded');
    expect(loaded.body.snapshot).toMatchObject({ type: 'master', rowCount: 1, synthetic: false });
    expect(loaded.body.staleScenarios.map((s: { id: string }) => s.id)).toEqual([scenarioId]);

    const scenario = await db.pool.query('SELECT stale FROM scenario WHERE id = $1', [scenarioId]);
    expect(scenario.rows[0]).toEqual({ stale: true });
    const notes = await db.pool.query('SELECT user_id, event, severity FROM notification WHERE object_id = ANY($1)', [
      [scenarioId, validated.body.run.id],
    ]);
    expect(notes.rows).toEqual(
      expect.arrayContaining([
        { user_id: owner, event: 'scenario.stale', severity: 'warning' },
        { user_id: steward, event: 'ingestion.succeeded', severity: 'info' },
        { user_id: planner, event: 'ingestion.succeeded', severity: 'info' },
      ]),
    );

    // Snapshot data is pinned: stored once, hash recorded, row immutable.
    const snap = await db.pool.query('SELECT storage_key, content_sha256 FROM dataset_snapshot WHERE id = $1', [
      loaded.body.snapshot.id,
    ]);
    expect(snap.rows[0].storage_key).toBe(`snapshots/master/run-${validated.body.run.id}.json`);
    expect(snap.rows[0].content_sha256).toMatch(/^[0-9a-f]{64}$/);
    const data = JSON.parse(storage.objects.get(snap.rows[0].storage_key) as string);
    expect(data.records[0]).toMatchObject({ storeCode: 'SMQC', installedLanes: 14 });
    await expect(
      db.pool.query('UPDATE dataset_snapshot SET row_count = 99 WHERE id = $1', [loaded.body.snapshot.id]),
    ).rejects.toThrow(/immutable/);
    const old = await db.pool.query('SELECT superseded_by FROM dataset_snapshot WHERE id = $1', [first.snapshot.id]);
    expect(old.rows[0].superseded_by).toBe(loaded.body.snapshot.id);

    // History and detail.
    const history = await dispatch(app, 'GET', '/ingestions', { ...as(admin, 'ADM'), query: { datasetType: 'master' } });
    expect(history.body.runs[0]).toMatchObject({ id: validated.body.run.id, status: 'loaded', staleScenarioCount: 1 });
    const one = await dispatch(app, 'GET', `/ingestions/${validated.body.run.id}`, as(planner, 'PLN'));
    expect(one.body.impact[0]).toMatchObject({ id: scenarioId, alreadyStale: true });
    // The validation outcome of a run is immutable.
    await expect(
      db.pool.query('UPDATE ingestion_run SET error_count = 5 WHERE id = $1', [validated.body.run.id]),
    ).rejects.toThrow(/immutable/);
  });

  it('blocks a file with errors, keeps the prior dataset and offers a row-numbered report', async () => {
    await loadCsv('pos', `${POS_HEADER}\nSMQC,Main lanes,2025-12-18,10,100,,\n`);
    const current = await dispatch(app, 'GET', '/snapshots', { ...as(steward, 'RST'), query: { datasetType: 'pos', current: 'true' } });
    const before = await auditCount();

    const blocked = await upload('pos', `${POS_HEADER}\nSMQC,Main lanes,2025-12-19,10,100,,\nSMQC,Main lanes,2025-12-19,25,100,,\n`);
    expect(blocked.status).toBe(201);
    expect(blocked.body.run).toMatchObject({ status: 'blocked', rowCount: 2, validRowCount: 1, errorCount: 1 });
    expect(blocked.body.issues).toEqual([expect.objectContaining({ row: 3, column: 'hour', severity: 'error' })]);
    expect(blocked.body.impact).toEqual([]);
    expect(await auditCount()).toBe(before + 1);
    // Nothing is written to snapshots/ for a blocked file.
    expect([...storage.objects.keys()].filter((k) => k.includes(blocked.body.run.id))).toEqual([]);

    const load = await dispatch(app, 'POST', `/ingestions/${blocked.body.run.id}/load`, {
      ...as(steward, 'RST'),
      body: { confirmWarnings: true },
    });
    expect(load.status).toBe(409);
    expect(await auditCount()).toBe(before + 1);
    const after = await dispatch(app, 'GET', '/snapshots', { ...as(steward, 'RST'), query: { datasetType: 'pos', current: 'true' } });
    expect(after.body.snapshots).toEqual(current.body.snapshots);

    const failed = await db.pool.query(
      `SELECT count(*)::int AS n FROM notification WHERE object_id = $1 AND event = 'ingestion.failed' AND severity = 'critical'`,
      [blocked.body.run.id],
    );
    expect(failed.rows[0].n).toBe(2); // rules steward + planner

    const report = await dispatch(app, 'GET', `/ingestions/${blocked.body.run.id}/report`, as(steward, 'RST'));
    expect(report.status).toBe(200);
    expect(report.body.fileName).toBe('pos-validation-report.csv');
    expect(report.body.content).toContain('Row,Column,Severity,Code,Message');
    expect(report.body.content).toMatch(/\r\n3,hour,error,invalid_number,/);
    expect(await auditCount()).toBe(before + 2); // the export is audited
  });

  it('requires explicit confirmation to load a file with warnings', async () => {
    const warned = await upload('pos', `${POS_HEADER}\nSMQC,Main lanes,2025-12-20,14,600,13,\n`);
    expect(warned.body.run).toMatchObject({ status: 'validated', warningCount: 1 });
    const refused = await dispatch(app, 'POST', `/ingestions/${warned.body.run.id}/load`, {
      ...as(steward, 'RST'),
      body: { confirmWarnings: false },
    });
    expect(refused.status).toBe(422);
    const ok = await dispatch(app, 'POST', `/ingestions/${warned.body.run.id}/load`, {
      ...as(steward, 'RST'),
      body: { confirmWarnings: true },
    });
    expect(ok.status).toBe(200);
  });

  it('refuses to load a validation that another load has overtaken; cancel is one-shot', async () => {
    const a = await upload('staff', `${STAFF_HEADER}\nE-1,Ana,SMQC,Main lanes,regular\n`);
    const b = await upload('staff', `${STAFF_HEADER}\nE-2,Ben,SMQC,Main lanes,regular\n`);
    const first = await dispatch(app, 'POST', `/ingestions/${a.body.run.id}/load`, { ...as(steward, 'RST'), body: { confirmWarnings: true } });
    expect(first.status).toBe(200);
    const late = await dispatch(app, 'POST', `/ingestions/${b.body.run.id}/load`, { ...as(steward, 'RST'), body: { confirmWarnings: true } });
    expect(late.status).toBe(409);
    const cancelled = await dispatch(app, 'POST', `/ingestions/${b.body.run.id}/cancel`, as(steward, 'RST'));
    expect(cancelled.body.run.status).toBe('cancelled');
    const again = await dispatch(app, 'POST', `/ingestions/${b.body.run.id}/cancel`, as(steward, 'RST'));
    expect(again.status).toBe(409);
  });

  it('honours an explicit column mapping', async () => {
    const res = await upload('pos', 'Branch,Dept,Day,Hr,Tx\nSMQC,Main lanes,2025-12-21,9,50\n', {
      mapping: { store_code: 'Branch', department: 'Dept', date: 'Day', hour: 'Hr', transactions: 'Tx' },
    });
    expect(res.body.run).toMatchObject({ status: 'validated', validRowCount: 1, coversFrom: '2025-12-21', coversTo: '2025-12-21' });
  });

  it('only reads upload keys of the requested dataset', async () => {
    storage.objects.set('snapshots/pos/secret.json', 'x');
    for (const fileKey of ['snapshots/pos/secret.json', `uploads/master/${randomUUID()}/a.csv`, `uploads/pos/${randomUUID()}/a.csv`]) {
      const res = await dispatch(app, 'POST', '/ingestions', {
        ...as(steward, 'RST'),
        body: { datasetType: 'pos', fileKey, fileName: 'a.csv', synthetic: false },
      });
      expect(res.status).toBe(422);
    }
  });

  it('checks POS/staff files only against master data of the same provenance (P18)', async () => {
    // The reference store exists only as real data, so a synthetic POS file can't check it.
    const res = await upload('pos', `${POS_HEADER}\nSMQC,Main lanes,2025-12-22,9,50,,\n`, { synthetic: true });
    expect(res.body.issues).toEqual([expect.objectContaining({ row: 0, code: 'no_master_reference' })]);
  });
});

describe('synthetic flag (Req 17.6) and provenance (Req 18, P9)', () => {
  it('only a Rules Steward may clear the flag; pinned or clashing snapshots cannot change', async () => {
    const synthetic = await loadCsv('pos', `${POS_HEADER}\nSMQC,Main lanes,2025-12-01,10,100,,\n`, true);
    for (const role of ['ADM', 'PLN', 'EXE', 'HR', 'FIN', 'STM', 'STF'] as const) {
      const denied = await dispatch(app, 'PATCH', `/snapshots/${synthetic.snapshot.id}`, { ...as(admin, role), body: { synthetic: false } });
      expect(denied.status).toBe(403);
    }
    // A real POS snapshot is already current, so clearing would clash.
    const before = await auditCount();
    const clash = await dispatch(app, 'PATCH', `/snapshots/${synthetic.snapshot.id}`, { ...as(steward, 'RST'), body: { synthetic: false } });
    expect(clash.status).toBe(409);
    expect(await auditCount()).toBe(before);
  });

  it('clears an unpinned flag for RST with one audit event; a pinned one is refused (P18)', async () => {
    const fresh = await createTestDatabase();
    try {
      const user = await createUser(fresh.pool);
      const mem = new MemoryStorage();
      const local = createApp(deps(fresh.pool, mem));
      const v = await upload('master', masterCsv(), { synthetic: true, router: local, mem, userId: user });
      const l = await dispatch(local, 'POST', `/ingestions/${v.body.run.id}/load`, { ...as(user, 'RST'), body: { confirmWarnings: true } });
      const snapshotId = l.body.snapshot.id as string;

      const owner = await insertUser(fresh.pool, { synthetic: true });
      const scenarioId = await insertScenario(fresh.pool, owner, { synthetic: true });
      await fresh.pool.query(
        `INSERT INTO scenario_snapshot (scenario_id, dataset_type, snapshot_id, synthetic) VALUES ($1, 'master', $2, true)`,
        [scenarioId, snapshotId],
      );
      const beforePinned = await auditCount(fresh.pool);
      const pinned = await dispatch(local, 'PATCH', `/snapshots/${snapshotId}`, { ...as(user, 'RST'), body: { synthetic: false } });
      expect(pinned.status).toBe(409);
      expect(await auditCount(fresh.pool)).toBe(beforePinned);

      await fresh.pool.query('DELETE FROM scenario WHERE id = $1', [scenarioId]);
      const prov = await dispatch(local, 'GET', '/datasets/provenance', as(user, 'STF'));
      expect(prov.body).toEqual({ sampleData: true, syntheticDatasetTypes: ['master'] });

      const ok = await dispatch(local, 'PATCH', `/snapshots/${snapshotId}`, { ...as(user, 'RST'), body: { synthetic: false } });
      expect(ok.status).toBe(200);
      expect(ok.body.synthetic).toBe(false);
      expect(await auditCount(fresh.pool)).toBe(beforePinned + 1);
      const ev = await fresh.pool.query('SELECT event, active_role FROM audit_event ORDER BY seq DESC LIMIT 1');
      expect(ev.rows[0]).toEqual({ event: 'snapshot.synthetic_cleared', active_role: 'RST' });
      const stamp = await fresh.pool.query('SELECT synthetic_changed_by FROM dataset_snapshot WHERE id = $1', [snapshotId]);
      expect(stamp.rows[0].synthetic_changed_by).toBe(user);
      // The run that loaded it shares its provenance (P18, FK from 0230).
      const source = await fresh.pool.query('SELECT synthetic FROM ingestion_run WHERE id = $1', [v.body.run.id]);
      expect(source.rows[0].synthetic).toBe(false);

      const after = await dispatch(local, 'GET', '/datasets/provenance', as(user, 'STF'));
      expect(after.body).toEqual({ sampleData: false, syntheticDatasetTypes: [] });
      const same = await dispatch(local, 'PATCH', `/snapshots/${snapshotId}`, { ...as(user, 'RST'), body: { synthetic: false } });
      expect(same.status).toBe(409);
    } finally {
      await fresh.dispose();
    }
  });

  it('GET /datasets lists every dataset type with the provenance', async () => {
    const prov = await dispatch(app, 'GET', '/datasets/provenance', as(admin, 'ADM'));
    const datasets = await dispatch(app, 'GET', '/datasets', as(admin, 'ADM'));
    expect(datasets.body.provenance).toEqual(prov.body);
    expect(datasets.body.datasets.map((d: { type: string }) => d.type)).toEqual(['pos', 'master', 'staff']);
    const exported = await dispatch(app, 'GET', '/ingestions/export', as(admin, 'ADM'));
    expect(exported.body.content.startsWith(`${SAMPLE_DATA_MARKER}\r\n`)).toBe(prov.body.sampleData);
  });
});

describe('P9 / P18 over random load sequences', () => {
  it('provenance.sampleData == some in-use snapshot is synthetic; exports carry the marker; loads never cross provenance', async () => {
    const fresh = await createTestDatabase();
    try {
      const user = await createUser(fresh.pool);
      const mem = new MemoryStorage();
      const local = createApp(deps(fresh.pool, mem));
      const csvFor: Record<DatasetType, string> = {
        pos: `${POS_HEADER}\nSMQC,Main lanes,2025-12-01,10,100,,\n`,
        master: masterCsv(),
        staff: `${STAFF_HEADER}\nE-1,Ana,SMQC,Main lanes,regular\n`,
      };
      const currentOf = async (type: DatasetType, synthetic: boolean) =>
        (
          await fresh.pool.query('SELECT id FROM dataset_snapshot WHERE dataset_type = $1 AND synthetic = $2 AND superseded_at IS NULL', [
            type,
            synthetic,
          ])
        ).rows;
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.record({ type: fc.constantFrom<DatasetType>('pos', 'master', 'staff'), synthetic: fc.boolean() }), {
            minLength: 1,
            maxLength: 4,
          }),
          async (loads) => {
            for (const l of loads) {
              const otherBefore = await currentOf(l.type, !l.synthetic);
              const v = await upload(l.type, csvFor[l.type], { synthetic: l.synthetic, router: local, mem, userId: user });
              const loaded = await dispatch(local, 'POST', `/ingestions/${v.body.run.id}/load`, {
                ...as(user, 'RST'),
                body: { confirmWarnings: true },
              });
              expect(loaded.status).toBe(200);
              expect(loaded.body.snapshot.synthetic).toBe(l.synthetic);
              expect(await currentOf(l.type, !l.synthetic)).toEqual(otherBefore);
            }
            const { rows } = await fresh.pool.query<{ dataset_type: DatasetType; synthetic: boolean }>(
              'SELECT dataset_type, synthetic FROM dataset_snapshot WHERE superseded_at IS NULL',
            );
            const inUse = (['pos', 'master', 'staff'] as const).flatMap((t) => {
              const cur = rows.filter((r) => r.dataset_type === t);
              const chosen = cur.find((r) => !r.synthetic) ?? cur[0];
              return chosen ? [chosen] : [];
            });
            const prov = await dispatch(local, 'GET', '/datasets/provenance', as(user, 'STF'));
            expect(prov.body.sampleData).toBe(inUse.some((r) => r.synthetic));
            const exported = await dispatch(local, 'GET', '/ingestions/export', as(user, 'ADM'));
            expect(exported.body.content.startsWith(SAMPLE_DATA_MARKER)).toBe(prov.body.sampleData);
          },
        ),
        { numRuns: 12 },
      );
    } finally {
      await fresh.dispose();
    }
  });
});

describe('authorisation (task 8.1 guards)', () => {
  it('fails closed without an active role (403) or a verified identity (401)', async () => {
    expect((await dispatch(app, 'GET', '/datasets', { identity: signedIn(admin) })).status).toBe(403);
    expect((await dispatch(app, 'GET', '/datasets')).status).toBe(401);
    expect((await dispatch(app, 'GET', '/datasets/provenance')).status).toBe(401);
  });

  it('enforces the matrix row: ADM/PLN view, only RST manages, other roles are refused', async () => {
    for (const role of ['ADM', 'PLN', 'RST'] as const) {
      expect((await dispatch(app, 'GET', '/datasets', as(admin, role))).status).toBe(200);
    }
    for (const role of ['EXE', 'HR', 'FIN', 'STM'] as const) {
      expect((await dispatch(app, 'GET', '/datasets', as(admin, role))).status).toBe(403);
    }
    const body = { datasetType: 'pos', fileName: 'a.csv', contentType: 'text/csv', sizeBytes: 10 };
    for (const role of ['ADM', 'PLN'] as const) {
      expect((await dispatch(app, 'POST', '/ingestions/uploads', { ...as(admin, role), body })).status).toBe(403);
    }
  });

  it('every task-9 route declares a data_ingestion guard except the banner (authenticated)', () => {
    const expected: [string, string, 'view' | 'manage'][] = [
      ['GET', '/datasets', 'view'],
      ['POST', '/ingestions/uploads', 'manage'],
      ['POST', '/ingestions', 'manage'],
      ['GET', '/ingestions', 'view'],
      ['GET', '/ingestions/export', 'view'],
      ['GET', '/ingestions/:ingestionId', 'view'],
      ['GET', '/ingestions/:ingestionId/report', 'view'],
      ['POST', '/ingestions/:ingestionId/load', 'manage'],
      ['POST', '/ingestions/:ingestionId/cancel', 'manage'],
      ['GET', '/snapshots', 'view'],
      ['GET', '/snapshots/:snapshotId', 'view'],
      ['PATCH', '/snapshots/:snapshotId', 'manage'],
    ];
    const routes = app.routes();
    for (const [method, pattern, action] of expected) {
      const route = routes.find((r) => r.method === method && r.pattern === pattern);
      expect(route?.guard).toEqual(authorize('data_ingestion', action));
    }
    expect(routes.find((r) => r.pattern === '/datasets/provenance')?.guard).toEqual({ kind: 'authenticated' });
  });

  it('answers 503 when the database or bucket is not configured', async () => {
    const unconfigured = createApp(depsFromEnv({}));
    expect((await dispatch(unconfigured, 'GET', '/datasets', as(admin, 'ADM'))).status).toBe(503);
    const up = await dispatch(unconfigured, 'POST', '/ingestions/uploads', {
      ...as(steward, 'RST'),
      body: { datasetType: 'pos', fileName: 'a.csv', contentType: 'text/csv', sizeBytes: 10 },
    });
    expect(up.status).toBe(503);
  });
});
