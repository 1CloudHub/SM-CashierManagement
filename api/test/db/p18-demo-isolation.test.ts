/**
 * Property 18 — Demo data isolation (Req 19.3, 19.5; task 23).
 *
 *   For any snapshot, scenario run or export, records are either all synthetic
 *   or all real; resetting demo data never changes real records.
 *
 * Against a real PostgreSQL with the demo network seeded:
 *   (a) for any random real world plus random demo activity, a demo reset
 *       leaves every real row byte-for-byte unchanged (timestamps included)
 *       and restores the demo rows to the seed;
 *   (b) for any assignment of provenances to a scenario, its run and their
 *       snapshot / rule-version pins (and to an ingestion run and the snapshot
 *       it loaded), the database accepts the rows iff they are all the same
 *       provenance;
 *   (c) whatever is stored, every scenario and run — with all its pins — is
 *       single-provenance;
 *   (d) an export's provenance is all-synthetic or all-real, never mixed.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { provenanceOf } from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDemoDataset, demoId, demoUserId } from '../../src/db/demo/dataset.js';
import { seedDemoData } from '../../src/db/demo/seed.js';
import { withTransaction, type Tx } from '../../src/db/pool.js';
import { exportSynthetic, MixedProvenanceError } from '../../src/db/repositories/exports.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { insertSnapshot, insertUser } from '../support/fixtures.js';
import { dumpRealRows, dumpSyntheticRows, maxAuditSeq } from '../support/provenance.js';

let db: TestDatabase;
let seededDemo: Awaited<ReturnType<typeof dumpSyntheticRows>>;
const data = buildDemoDataset();

beforeAll(async () => {
  db = await createTestDatabase();
  await seedDemoData(db.pool);
  seededDemo = await dumpSyntheticRows(db.pool);
});

afterAll(async () => {
  await db.dispose();
});

const uniq = (): string => randomBytes(4).toString('hex');

async function one<T>(tx: Tx, sql: string, values: unknown[]): Promise<T> {
  const { rows } = await tx.query(sql, values);
  const row = rows[0] as T | undefined;
  if (!row) throw new Error('insert returned no row');
  return row;
}

// ---------------------------------------------------------------------------
// (a) Reset never changes real records.
// ---------------------------------------------------------------------------

interface RealWorld {
  readonly stores: number;
  readonly deptsPerStore: number;
  readonly staffPerDept: number;
  readonly homeAreas: boolean;
  readonly ruleTypes: readonly string[];
  readonly snapshotTypes: readonly ('pos' | 'master' | 'staff')[];
  readonly scenario: 'none' | 'draft' | 'published';
  readonly withRun: boolean;
  readonly roster: boolean;
  readonly notification: boolean;
  readonly realUserScopedToDemoStore: boolean;
}

const realWorldArb: fc.Arbitrary<RealWorld> = fc.record({
  stores: fc.integer({ min: 1, max: 2 }),
  deptsPerStore: fc.integer({ min: 1, max: 2 }),
  staffPerDept: fc.integer({ min: 0, max: 3 }),
  homeAreas: fc.boolean(),
  ruleTypes: fc.subarray(['holidays', 'wages', 'labor', 'service_levels', 'transport_allowance']),
  snapshotTypes: fc.subarray(['pos', 'master', 'staff'] as const),
  scenario: fc.constantFrom('none', 'draft', 'published'),
  withRun: fc.boolean(),
  roster: fc.boolean(),
  notification: fc.boolean(),
  realUserScopedToDemoStore: fc.boolean(),
});

type DemoActivity = 'scenario' | 'notification' | 'edit_staff' | 'offer_roster' | 'snapshot' | 'switch_role';
const demoActivityArb = fc.subarray<DemoActivity>([
  'scenario',
  'notification',
  'edit_staff',
  'offer_roster',
  'snapshot',
  'switch_role',
]);

/** Inserts a random real world (all `synthetic = false`) through raw SQL. */
async function insertRealWorld(tx: Tx, w: RealWorld): Promise<void> {
  const u = uniq();
  const user = await one<{ id: string }>(
    tx,
    `INSERT INTO app_user (email, name) VALUES ($1, 'Real Planner') RETURNING id`,
    [`real.${u}@smretail.com`],
  );
  const region = await one<{ id: string }>(tx, `INSERT INTO region (code, name) VALUES ($1, 'Real') RETURNING id`, [
    `REAL-${u}`,
  ]);
  const barangay = `13740${String(parseInt(u.slice(0, 4), 16) % 10000).padStart(4, '0')}`;
  await tx.query(
    `INSERT INTO barangay (psgc_code, name, city, centroid_lat, centroid_lon) VALUES ($1, 'Real Brgy', 'QC', 14.65, 121.03)
     ON CONFLICT DO NOTHING`,
    [barangay],
  );
  const storeIds: string[] = [];
  const deptIds: string[] = [];
  const staffIds: string[] = [];
  for (let s = 0; s < w.stores; s += 1) {
    const store = await one<{ id: string }>(
      tx,
      `INSERT INTO store (code, name, format, region_id) VALUES ($1, 'Real Store', 'sm_store', $2) RETURNING id`,
      [`REAL-${u}-${s}`, region.id],
    );
    storeIds.push(store.id);
    await tx.query(`INSERT INTO store_location (store_id, lat, lon, source) VALUES ($1, 14.6, 121.0, 'manual')`, [
      store.id,
    ]);
    await tx.query(
      `INSERT INTO travel_time (barangay_code, store_id, mode, time_window, minutes, source)
       VALUES ($1, $2, 'car', 'am_peak', 17, 'straight_line')`,
      [barangay, store.id],
    );
    for (let d = 0; d < w.deptsPerStore; d += 1) {
      const dept = await one<{ id: string }>(
        tx,
        `INSERT INTO department (store_id, name, installed_lanes, default_handle_time_min, trading_open, trading_close)
         VALUES ($1, $2, 8, 2.2, '10:00', '21:00') RETURNING id`,
        [store.id, `Dept ${d}`],
      );
      deptIds.push(dept.id);
      for (let k = 0; k < w.staffPerDept; k += 1) {
        const staff = await one<{ id: string }>(
          tx,
          `INSERT INTO staff (store_id, department_id, employee_no, name, employment_type)
           VALUES ($1, $2, $3, 'Real Cashier', 'regular') RETURNING id`,
          [store.id, dept.id, `R-${u}-${d}-${k}`],
        );
        staffIds.push(staff.id);
        await tx.query('INSERT INTO staff_training (staff_id, department_id) VALUES ($1, $2)', [staff.id, dept.id]);
        await tx.query(
          `INSERT INTO staff_availability (staff_id, kind, starts_at, ends_at, source)
           VALUES ($1, 'unavailable', '2026-12-24T00:00:00+08', '2026-12-25T00:00:00+08', 'manual')`,
          [staff.id],
        );
        if (w.homeAreas) {
          await tx.query(
            `INSERT INTO staff_home_area (staff_id, barangay_code, consent_at, max_travel_min) VALUES ($1, $2, now(), 30)`,
            [staff.id, barangay],
          );
        }
      }
    }
  }
  if (w.realUserScopedToDemoStore) {
    // A real user whose store scope includes a demo store (e.g. demo mode on a real account).
    await tx.query(
      `INSERT INTO role_assignment (user_id, role, scope_type, scope_ids) VALUES ($1, 'STM', 'store', $2::uuid[])`,
      [user.id, [storeIds[0], demoId('store', 'smsm-qc')]],
    );
  }

  const versionIds: string[] = [];
  for (const type of w.ruleTypes) {
    // Settled history (superseded), so worlds can accumulate versions without
    // breaking the one-open-version rule (task 10, migration 0110).
    const v = await one<{ id: string }>(
      tx,
      `INSERT INTO rule_version (rule_set_id, is_cost_rule, version, effective_from, status, payload, created_by,
                                 finance_approved_by, finance_approved_at, published_by, published_at)
       SELECT rs.id, rs.is_cost_rule,
              coalesce((SELECT max(version) FROM rule_version WHERE rule_set_id = rs.id AND NOT synthetic), 0) + 1,
              '2026-01-01', 'superseded', '{"real":true}', $2,
              CASE WHEN rs.is_cost_rule THEN $2::uuid END, CASE WHEN rs.is_cost_rule THEN now() END, $2, now()
         FROM rule_set rs WHERE rs.rule_set_type = $1 RETURNING id`,
      [type, user.id],
    );
    versionIds.push(v.id);
  }
  const snapshotIds: string[] = [];
  for (const type of w.snapshotTypes) {
    const id = randomUUID();
    await tx.query(
      `UPDATE dataset_snapshot SET superseded_at = now(), superseded_by = $2
        WHERE dataset_type = $1 AND NOT synthetic AND superseded_at IS NULL`,
      [type, id],
    );
    await tx.query(
      `INSERT INTO dataset_snapshot (id, dataset_type, covers_from, covers_to, row_count, loaded_by)
       VALUES ($1, $2, '2025-08-01', '2025-12-31', 100, $3)`,
      [id, type, user.id],
    );
    await tx.query(
      `INSERT INTO ingestion_run (dataset_type, user_id, file_name, status, snapshot_id, row_count)
       VALUES ($1, $2, 'real.csv', 'loaded', $3, 100)`,
      [type, user.id, id],
    );
    snapshotIds.push(id);
  }

  let scenarioId: string | null = null;
  if (w.scenario !== 'none') {
    const scenario = await one<{ id: string }>(
      tx,
      `INSERT INTO scenario (name, season, owner_id, settings) VALUES ('Real plan', $1, $2, '{"growth":1.02}') RETURNING id`,
      [`real-${u}`, user.id],
    );
    scenarioId = scenario.id;
    await tx.query(
      `INSERT INTO scenario_snapshot (scenario_id, dataset_type, snapshot_id, synthetic)
       SELECT $1, dataset_type, id, false FROM dataset_snapshot WHERE id = ANY($2::uuid[])`,
      [scenarioId, snapshotIds],
    );
    await tx.query(
      `INSERT INTO scenario_rule_version (scenario_id, rule_set_id, rule_version_id, synthetic)
       SELECT $1, rule_set_id, id, false FROM rule_version WHERE id = ANY($2::uuid[])`,
      [scenarioId, versionIds],
    );
    if (w.scenario === 'published') {
      await tx.query(`UPDATE scenario SET status = 'submitted', current_submission_no = 1 WHERE id = $1`, [scenarioId]);
      await tx.query(
        `INSERT INTO approval_step (scenario_id, submission_no, step, status, decided_by, decided_as_role, decided_at, outside_reference)
         VALUES ($1, 1, 'headcount', 'secured_outside', $2, 'EXE', now(), 'REF-1'),
                ($1, 1, 'budget', 'secured_outside', $2, 'EXE', now(), 'REF-2')`,
        [scenarioId, user.id],
      );
      await tx.query(
        `INSERT INTO approval_step (scenario_id, submission_no, step, status, decided_by, decided_as_role, decided_at)
         VALUES ($1, 1, 'plan', 'approved', $2, 'EXE', now())`,
        [scenarioId, user.id],
      );
      await tx.query(`UPDATE scenario SET status = 'approved' WHERE id = $1`, [scenarioId]);
      await tx.query(`UPDATE scenario SET status = 'published', published_at = now() WHERE id = $1`, [scenarioId]);
    }
  }
  let runId: string | null = null;
  if (scenarioId && w.withRun) {
    const run = await one<{ id: string }>(
      tx,
      `INSERT INTO scenario_run (scenario_id, run_type, status, results_ref, requested_by, synthetic)
       VALUES ($1, 'network', 'succeeded', 's3://real/run', $2, false) RETURNING id`,
      [scenarioId, user.id],
    );
    runId = run.id;
    await tx.query(
      `INSERT INTO scenario_run_snapshot (run_id, dataset_type, snapshot_id, synthetic)
       SELECT $1, dataset_type, id, false FROM dataset_snapshot WHERE id = ANY($2::uuid[])`,
      [runId, snapshotIds],
    );
  }
  if (w.roster && deptIds[0] && storeIds[0]) {
    const roster = await one<{ id: string }>(
      tx,
      `INSERT INTO roster (scenario_id, scenario_run_id, store_id, department_id, period_start, period_end)
       VALUES ($1, $2, $3, $4, '2026-12-14', '2026-12-20') RETURNING id`,
      [scenarioId, runId, storeIds[0], deptIds[0]],
    );
    await tx.query(
      `INSERT INTO shift (roster_id, staff_id, department_id, starts_at, ends_at)
       VALUES ($1, $2, $3, '2026-12-19T02:00:00Z', '2026-12-19T11:00:00Z')`,
      [roster.id, staffIds[0] ?? null, deptIds[0]],
    );
  }
  if (w.notification) {
    await tx.query(
      `INSERT INTO notification (user_id, event, object_type, object_id) VALUES ($1, 'plan.published', 'scenario', 'x')`,
      [user.id],
    );
    await tx.query(`INSERT INTO saved_view (user_id, screen, name, query) VALUES ($1, 'SCR-020', 'Mine', 'q=1')`, [
      user.id,
    ]);
    await tx.query(
      `INSERT INTO notification_preference (user_id, event, channel, enabled) VALUES ($1, 'plan', 'email', false)`,
      [user.id],
    );
  }
  await tx.query(
    `INSERT INTO audit_event (user_id, active_role, action, event, object_type, object_id)
     VALUES ($1, 'PLN', 'create', 'scenario.created', 'scenario', $2)`,
    [user.id, scenarioId ?? 'none'],
  );
}

/** Random activity by demo users on demo data between resets (all synthetic). */
async function insertDemoActivity(tx: Tx, activity: readonly DemoActivity[]): Promise<void> {
  const qcMain = demoId('department', 'smsm-qc:main');
  const qcStore = demoId('store', 'smsm-qc');
  const cashier = demoId('staff', 'smsm-qc:main:ft-001');
  for (const a of activity) {
    switch (a) {
      case 'scenario':
        await tx.query(
          `INSERT INTO scenario (name, season, owner_id, settings, synthetic) VALUES ('Demo draft', 'easter-2027', $1, '{}', true)`,
          [demoUserId('PLN')],
        );
        break;
      case 'notification':
        await tx.query(
          `INSERT INTO notification (user_id, event, object_type, object_id, synthetic)
           VALUES ($1, 'offer.sent', 'shift_offer', 'x', true)`,
          [demoUserId('STF')],
        );
        break;
      case 'edit_staff':
        await tx.query(`UPDATE staff SET name = 'Edited in demo', preferred_rest_day = 3 WHERE id = $1`, [cashier]);
        await tx.query('DELETE FROM staff_home_area WHERE staff_id = $1', [cashier]);
        break;
      case 'offer_roster': {
        const roster = await one<{ id: string }>(
          tx,
          `INSERT INTO roster (scenario_id, scenario_run_id, store_id, department_id, period_start, period_end, status, published_at, synthetic)
           VALUES ($1, $2, $3, $4, '2026-12-14', '2026-12-20', 'published', now(), true) RETURNING id`,
          [data.scenario.id, data.scenario.runId, qcStore, qcMain],
        );
        const shift = await one<{ id: string }>(
          tx,
          `INSERT INTO shift (roster_id, staff_id, department_id, starts_at, ends_at, synthetic)
           VALUES ($1, $2, $3, '2026-12-19T02:00:00Z', '2026-12-19T11:00:00Z', true) RETURNING id`,
          [roster.id, cashier, qcMain],
        );
        await tx.query(
          `INSERT INTO shift_offer (shift_id, staff_id, sent_by, expires_at, synthetic)
           VALUES ($1, $2, $3, now() + interval '1 hour', true)`,
          [shift.id, demoId('staff', 'smsm-qc:main:ft-002'), demoUserId('STM')],
        );
        await tx.query(
          `INSERT INTO shift_override (roster_id, shift_id, override_type, from_staff_id, reason, created_by, synthetic)
           VALUES ($1, $2, 'emergency_off', $3, 'sick', $4, true)`,
          [roster.id, shift.id, cashier, demoUserId('STM')],
        );
        const transfer = await one<{ id: string }>(
          tx,
          `INSERT INTO transfer_request (from_store_id, to_store_id, window_start, window_end, requested_count, requested_by, synthetic)
           VALUES ($1, $2, '2026-12-19T05:00:00Z', '2026-12-19T09:00:00Z', 1, $3, true) RETURNING id`,
          [demoId('store', 'sms-mkt'), qcStore, demoUserId('STM')],
        );
        await tx.query(
          `INSERT INTO transfer_request_staff (transfer_request_id, staff_id, synthetic) VALUES ($1, $2, true)`,
          [transfer.id, demoId('staff', 'sms-mkt:fashion:ft-001')],
        );
        break;
      }
      case 'snapshot': {
        // A demo upload: supersedes the seeded POS snapshot.
        const id = randomUUID();
        await tx.query(
          `UPDATE dataset_snapshot SET superseded_at = now(), superseded_by = $1
            WHERE dataset_type = 'pos' AND synthetic AND superseded_at IS NULL`,
          [id],
        );
        await tx.query(
          `INSERT INTO dataset_snapshot (id, dataset_type, covers_from, covers_to, row_count, synthetic)
           VALUES ($1, 'pos', '2025-08-01', '2025-12-31', 5, true)`,
          [id],
        );
        await tx.query(
          `INSERT INTO ingestion_run (dataset_type, user_id, file_name, status, snapshot_id, row_count, synthetic)
           VALUES ('pos', $1, 'demo.csv', 'loaded', $2, 5, true)`,
          [demoUserId('RST'), id],
        );
        break;
      }
      case 'switch_role':
        await tx.query(`UPDATE app_user SET active_role = 'EXE', language = 'fil' WHERE id = $1`, [demoUserId('PLN')]);
        break;
    }
  }
}

describe('P18 — a demo reset never changes real records', () => {
  it('holds for any real world and any demo activity', async () => {
    await fc.assert(
      fc.asyncProperty(realWorldArb, demoActivityArb, async (world, activity) => {
        await withTransaction(db.pool, async (tx) => {
          await insertRealWorld(tx, world);
          await insertDemoActivity(tx, activity);
        });
        const seq = await maxAuditSeq(db.pool);
        const realBefore = await dumpRealRows(db.pool, seq);

        const result = await seedDemoData(db.pool);

        expect(result.mode).toBe('reset');
        expect(await dumpRealRows(db.pool, seq)).toEqual(realBefore);
        expect(await dumpSyntheticRows(db.pool)).toEqual(seededDemo);
        // The reset appended exactly its own audit event.
        expect(await maxAuditSeq(db.pool)).toBe(seq + 1);
      }),
      { numRuns: 12 },
    );
  });
});

// ---------------------------------------------------------------------------
// (b) The database accepts a snapshot / run / pin set only if single-provenance.
// ---------------------------------------------------------------------------

describe('P18 — mixed provenance is rejected by the database', () => {
  let realSnapshots: Record<'pos' | 'master' | 'staff', string>;
  let realVersionId: string;
  let realUserId: string;

  beforeAll(async () => {
    realUserId = await insertUser(db.pool);
    realSnapshots = {
      pos: await insertSnapshot(db.pool, { type: 'pos' }),
      master: await insertSnapshot(db.pool, { type: 'master' }),
      staff: await insertSnapshot(db.pool, { type: 'staff' }),
    };
    const { rows } = await db.pool.query<{ id: string }>(
      `INSERT INTO rule_version (rule_set_id, is_cost_rule, version, effective_from, payload, created_by)
       SELECT id, is_cost_rule, 1000, '2026-01-01', '{}', $1 FROM rule_set WHERE rule_set_type = 'labor' RETURNING id`,
      [realUserId],
    );
    realVersionId = rows[0]?.id ?? '';
  });

  const demoSnapshot = (type: 'pos' | 'master' | 'staff'): string =>
    data.snapshots.find((s) => s.datasetType === type)?.id ?? '';
  const demoLabor = (): string => data.ruleVersions.find((v) => v.ruleSetType === 'labor')?.id ?? '';

  /** Runs `sql` under a savepoint; true when the DB accepted it. */
  async function accepted(tx: Tx, sql: string, values: unknown[]): Promise<boolean> {
    await tx.query('SAVEPOINT p');
    try {
      await tx.query(sql, values);
      await tx.query('RELEASE SAVEPOINT p');
      return true;
    } catch {
      await tx.query('ROLLBACK TO SAVEPOINT p');
      return false;
    }
  }

  it('accepts scenario/run inputs iff scenario, run, pin rows and pinned inputs share provenance', async () => {
    const pinArb = fc.record({ target: fc.boolean(), row: fc.boolean() });
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        fc.record({ pos: pinArb, master: pinArb, staff: pinArb }),
        pinArb,
        fc.record({ runPin: pinArb, runVersionPin: pinArb }),
        async (scenarioSynthetic, runSynthetic, snapshotPins, versionPin, runPins) => {
          const outcome = { ok: true };
          await withTransaction(db.pool, async (tx) => {
            const owner = scenarioSynthetic ? demoUserId('PLN') : realUserId;
            const scenario = await one<{ id: string }>(
              tx,
              `INSERT INTO scenario (name, season, owner_id, settings, synthetic) VALUES ('P18', $1, $2, '{}', $3) RETURNING id`,
              [`p18-${uniq()}`, owner, scenarioSynthetic],
            );
            for (const type of ['pos', 'master', 'staff'] as const) {
              const pin = snapshotPins[type];
              const ok = await accepted(
                tx,
                `INSERT INTO scenario_snapshot (scenario_id, dataset_type, snapshot_id, synthetic) VALUES ($1, $2, $3, $4)`,
                [scenario.id, type, pin.target ? demoSnapshot(type) : realSnapshots[type], pin.row],
              );
              expect(ok).toBe(pin.target === scenarioSynthetic && pin.row === scenarioSynthetic);
            }
            const vOk = await accepted(
              tx,
              `INSERT INTO scenario_rule_version (scenario_id, rule_set_id, rule_version_id, synthetic)
               SELECT $1, rule_set_id, id, $3 FROM rule_version WHERE id = $2`,
              [scenario.id, versionPin.target ? demoLabor() : realVersionId, versionPin.row],
            );
            expect(vOk).toBe(versionPin.target === scenarioSynthetic && versionPin.row === scenarioSynthetic);

            const runId = randomUUID();
            const runOk = await accepted(
              tx,
              `INSERT INTO scenario_run (id, scenario_id, run_type, requested_by, synthetic) VALUES ($1, $2, 'network', $3, $4)`,
              [runId, scenario.id, owner, runSynthetic],
            );
            expect(runOk).toBe(runSynthetic === scenarioSynthetic);
            if (runOk) {
              const p = runPins.runPin;
              const ok = await accepted(
                tx,
                `INSERT INTO scenario_run_snapshot (run_id, dataset_type, snapshot_id, synthetic) VALUES ($1, 'pos', $2, $3)`,
                [runId, p.target ? demoSnapshot('pos') : realSnapshots.pos, p.row],
              );
              expect(ok).toBe(p.target === runSynthetic && p.row === runSynthetic);
              const q = runPins.runVersionPin;
              const vok = await accepted(
                tx,
                `INSERT INTO scenario_run_rule_version (run_id, rule_set_id, rule_version_id, synthetic)
                 SELECT $1, rule_set_id, id, $3 FROM rule_version WHERE id = $2`,
                [runId, q.target ? demoLabor() : realVersionId, q.row],
              );
              expect(vok).toBe(q.target === runSynthetic && q.row === runSynthetic);
            }
            // Never keep anything: roll back the whole attempt.
            throw Object.assign(new Error('rollback'), { rollback: true });
          }).catch((e: unknown) => {
            if (!(e instanceof Error && 'rollback' in e)) {
              outcome.ok = false;
              throw e;
            }
          });
          return outcome.ok;
        },
      ),
      { numRuns: 60 },
    );
  });

  it('accepts an ingestion run only with a snapshot of the same provenance', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.boolean(), fc.constantFrom('pos', 'master', 'staff'), async (runSyn, snapSyn, type) => {
        const t = type as 'pos' | 'master' | 'staff';
        let ok = false;
        await withTransaction(db.pool, async (tx) => {
          ok = await accepted(
            tx,
            `INSERT INTO ingestion_run (dataset_type, user_id, file_name, status, snapshot_id, synthetic)
             VALUES ($1, $2, 'f.csv', 'loaded', $3, $4)`,
            [t, runSyn ? demoUserId('RST') : realUserId, snapSyn ? demoSnapshot(t) : realSnapshots[t], runSyn],
          );
          throw Object.assign(new Error('rollback'), { rollback: true });
        }).catch((e: unknown) => {
          if (!(e instanceof Error && 'rollback' in e)) throw e;
        });
        expect(ok).toBe(runSyn === snapSyn);
      }),
      { numRuns: 30 },
    );
  });

  // (c) Whatever made it into the database is single-provenance.
  it('stores every scenario and run with single-provenance inputs', async () => {
    const { rows } = await db.pool.query<{ kind: string; id: string; provenances: boolean[] }>(
      `SELECT 'scenario' AS kind, s.id, array_agg(DISTINCT x.synthetic) AS provenances
         FROM scenario s
         CROSS JOIN LATERAL (
           SELECT s.synthetic
           UNION ALL SELECT d.synthetic FROM scenario_snapshot p JOIN dataset_snapshot d ON d.id = p.snapshot_id WHERE p.scenario_id = s.id
           UNION ALL SELECT v.synthetic FROM scenario_rule_version p JOIN rule_version v ON v.id = p.rule_version_id WHERE p.scenario_id = s.id
         ) x GROUP BY s.id
       UNION ALL
       SELECT 'run', r.id, array_agg(DISTINCT x.synthetic)
         FROM scenario_run r
         CROSS JOIN LATERAL (
           SELECT r.synthetic
           UNION ALL SELECT s.synthetic FROM scenario s WHERE s.id = r.scenario_id
           UNION ALL SELECT d.synthetic FROM scenario_run_snapshot p JOIN dataset_snapshot d ON d.id = p.snapshot_id WHERE p.run_id = r.id
           UNION ALL SELECT v.synthetic FROM scenario_run_rule_version p JOIN rule_version v ON v.id = p.rule_version_id WHERE p.run_id = r.id
         ) x GROUP BY r.id
       UNION ALL
       SELECT 'ingestion_run', i.id, array_agg(DISTINCT x.synthetic)
         FROM ingestion_run i
         CROSS JOIN LATERAL (
           SELECT i.synthetic UNION ALL SELECT d.synthetic FROM dataset_snapshot d WHERE d.id = i.snapshot_id
         ) x GROUP BY i.id`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.provenances[0] === true)).toBe(true);
    for (const r of rows) expect(r.provenances, `${r.kind} ${r.id}`).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (d) Exports are all-synthetic or all-real.
// ---------------------------------------------------------------------------

describe('P18 — export provenance', () => {
  it('is synthetic iff every record is, real iff none is, and a mix is refused', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ synthetic: fc.boolean(), id: fc.uuid() }), { maxLength: 30 }), (records) => {
        const provenance = provenanceOf(records);
        if (provenance === 'mixed') {
          expect(() => exportSynthetic(records)).toThrow(MixedProvenanceError);
        } else {
          expect(exportSynthetic(records)).toBe(provenance === 'synthetic');
        }
      }),
    );
  });
});
