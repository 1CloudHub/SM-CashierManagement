/**
 * Demo-data seed and reset (task 23; Req 19.1, 19.2, 19.5, 19.6).
 *
 * Runs the real seeder against a real PostgreSQL: the full demo network is
 * loaded from @lanewise/domain's demo dataset, flagged synthetic, audited with
 * exactly one event per seed/reset, deterministic, and a reset restores the
 * seed without touching real rows (the randomised version of that guarantee is
 * the P18 property in p18-demo-isolation.test.ts).
 */
import { demo } from '@lanewise/domain';
import { ROLE_CODES } from '@lanewise/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildDemoDataset,
  DEMO_SEASON,
  demoId,
  demoUserId,
} from '../../src/db/demo/dataset.js';
import { DemoSeedConflictError, seedDemoData } from '../../src/db/demo/seed.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { insertDepartment, insertStaff, insertStore, insertUser } from '../support/fixtures.js';
import { dumpRealRows, dumpSyntheticRows, maxAuditSeq } from '../support/provenance.js';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.dispose();
});

async function count(sql: string, values: unknown[] = []): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(sql, values);
  return rows[0]?.n ?? -1;
}

describe('buildDemoDataset', () => {
  it('is deterministic and reuses the domain demo network', () => {
    const a = buildDemoDataset();
    const b = buildDemoDataset();
    expect(b).toEqual(a);
    expect(a.stores.map((s) => s.domainId)).toEqual(demo.DEMO_STORES.map((s) => s.id));
    expect(a.departments).toHaveLength(24);
    expect(a.snapshots.find((s) => s.datasetType === 'pos')?.rowCount).toBe(47_548);
    expect(new Set(a.staff.map((s) => s.id)).size).toBe(a.staff.length);
    expect(a.users.map((u) => u.role).sort()).toEqual([...ROLE_CODES].sort());
    for (const u of a.users) expect(u.email).toMatch(/^[^@\s]+@(smretail\.com|1cloudhub\.com)$/);
  });

  it('derives ids by name, so the same entity always has the same id', () => {
    expect(demoId('store', 'smsm-qc')).toBe(demoId('store', 'smsm-qc'));
    expect(demoId('store', 'smsm-qc')).not.toBe(demoId('store', 'smsm-ceb'));
    expect(demoId('store', 'x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('seedDemoData', () => {
  it('seeds the full demo network, every row synthetic, under one audit event', async () => {
    const before = await maxAuditSeq(db.pool);
    const result = await seedDemoData(db.pool);
    expect(result.mode).toBe('seeded');

    expect(await count('SELECT count(*)::int AS n FROM region WHERE synthetic')).toBe(5);
    expect(await count('SELECT count(*)::int AS n FROM store WHERE synthetic')).toBe(8);
    expect(await count('SELECT count(*)::int AS n FROM store_location WHERE synthetic')).toBe(8);
    expect(await count('SELECT count(*)::int AS n FROM department WHERE synthetic')).toBe(24);
    expect(await count('SELECT sum(installed_lanes)::int AS n FROM department WHERE synthetic')).toBe(
      demo.DEMO_DEPARTMENTS.reduce((n, d) => n + d.installedLanes, 0),
    );
    const data = buildDemoDataset();
    expect(await count('SELECT count(*)::int AS n FROM staff WHERE synthetic')).toBe(data.staff.length);
    expect(data.staff.length).toBeGreaterThan(200);
    // Every store has cashiers; every cashier is trained on their home department.
    expect(
      await count(`SELECT count(*)::int AS n FROM store s WHERE s.synthetic
                     AND NOT EXISTS (SELECT 1 FROM staff f WHERE f.store_id = s.id)`),
    ).toBe(0);
    expect(
      await count(`SELECT count(*)::int AS n FROM staff s WHERE s.synthetic AND NOT EXISTS (
                     SELECT 1 FROM staff_training t WHERE t.staff_id = s.id AND t.department_id = s.department_id)`),
    ).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM staff_availability WHERE synthetic')).toBe(
      data.availability.length,
    );
    // Home areas: barangay-level, consented, most (not all) cashiers (P15).
    const homeAreas = await count('SELECT count(*)::int AS n FROM staff_home_area WHERE synthetic');
    expect(homeAreas).toBe(data.homeAreas.length);
    expect(homeAreas).toBeGreaterThan(data.staff.length * 0.8);
    expect(homeAreas).toBeLessThan(data.staff.length);
    expect(
      await count(`SELECT count(*)::int AS n FROM staff_home_area h JOIN barangay b ON b.psgc_code = h.barangay_code
                    WHERE h.synthetic AND (h.consent_at IS NULL OR NOT b.synthetic)`),
    ).toBe(0);

    // One demo user per role, on the allowlist, each with one role assignment.
    const { rows: roles } = await db.pool.query<{ role: string; email: string; scope_type: string }>(
      `SELECT r.role, u.email, r.scope_type FROM app_user u JOIN role_assignment r ON r.user_id = u.id
        WHERE u.synthetic ORDER BY r.role`,
    );
    expect(roles.map((r) => r.role).sort()).toEqual([...ROLE_CODES].sort());
    expect(roles.find((r) => r.role === 'STF')?.scope_type).toBe('self');
    expect(
      await count('SELECT count(*)::int AS n FROM staff WHERE user_id = $1 AND synthetic', [demoUserId('STF')]),
    ).toBe(1);

    // Rule versions: one published demo v1 per rule set; cost rules Finance-approved.
    expect(
      await count(`SELECT count(*)::int AS n FROM rule_version WHERE synthetic AND status = 'published' AND version = 1`),
    ).toBe(7);
    expect(
      await count(`SELECT count(*)::int AS n FROM rule_version WHERE synthetic AND is_cost_rule AND finance_approved_by IS NULL`),
    ).toBe(0);

    // Current synthetic snapshots for pos/master/staff; POS matches Fixture B.
    const { rows: snaps } = await db.pool.query<{ dataset_type: string; row_count: number }>(
      'SELECT dataset_type, row_count FROM dataset_snapshot WHERE synthetic AND superseded_at IS NULL ORDER BY 1',
    );
    expect(snaps.map((s) => s.dataset_type)).toEqual(['master', 'pos', 'staff']);
    expect(snaps.find((s) => s.dataset_type === 'pos')?.row_count).toBe(47_548);

    // Published Christmas scenario with secured headcount + budget and a pinned run.
    const { rows: scen } = await db.pool.query<{ id: string; status: string; published_at: Date | null }>(
      'SELECT id, status, published_at FROM scenario WHERE synthetic AND season = $1',
      [DEMO_SEASON],
    );
    expect(scen).toHaveLength(1);
    expect(scen[0]?.status).toBe('published');
    expect(scen[0]?.published_at).not.toBeNull();
    expect(
      await count(`SELECT count(*)::int AS n FROM approval_step WHERE scenario_id = $1 AND status = 'approved'`, [
        scen[0]?.id,
      ]),
    ).toBe(3);
    expect(await count('SELECT count(*)::int AS n FROM scenario_snapshot WHERE synthetic')).toBe(3);
    expect(await count('SELECT count(*)::int AS n FROM scenario_rule_version WHERE synthetic')).toBe(7);
    expect(await count(`SELECT count(*)::int AS n FROM scenario_run WHERE synthetic AND status = 'succeeded'`)).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM scenario_run_snapshot WHERE synthetic')).toBe(3);
    expect(await count('SELECT count(*)::int AS n FROM scenario_run_rule_version WHERE synthetic')).toBe(7);

    // Nothing real was created, apart from the missing rule-set catalog rows.
    const real = await dumpRealRows(db.pool, before);
    for (const [table, rows] of Object.entries(real)) {
      if (table === 'linked:rule_set') expect(rows).toHaveLength(7);
      else expect(rows, table).toEqual([]);
    }

    // Exactly one audit event, by the demo Administrator as ADM.
    const { rows: events } = await db.pool.query(
      'SELECT user_id, active_role, action, event, object_type, synthetic, before FROM audit_event WHERE seq > $1',
      [before],
    );
    expect(events).toEqual([
      {
        user_id: demoUserId('ADM'),
        active_role: 'ADM',
        action: 'ingestion',
        event: 'demo_data.seeded',
        object_type: 'demo_dataset',
        synthetic: true,
        before: null,
      },
    ]);
  });

  it('resets to exactly the same rows, discarding demo activity, under one audit event', async () => {
    const seeded = await dumpSyntheticRows(db.pool);
    // Demo activity since the seed: a new draft, an edited cashier, a notification.
    await db.pool.query(
      `INSERT INTO scenario (name, season, owner_id, settings, synthetic) VALUES ('Scratch', 'christmas-2026', $1, '{}', true)`,
      [demoUserId('PLN')],
    );
    await db.pool.query(`UPDATE staff SET name = 'Renamed' WHERE id = $1`, [demoId('staff', 'smsm-qc:main:ft-001')]);
    await db.pool.query(`UPDATE app_user SET active_role = 'FIN' WHERE id = $1`, [demoUserId('ADM')]);
    await db.pool.query(
      `INSERT INTO notification (user_id, event, object_type, object_id, synthetic)
       VALUES ($1, 'scenario.submitted', 'scenario', 'x', true)`,
      [demoUserId('HR')],
    );
    expect(await dumpSyntheticRows(db.pool)).not.toEqual(seeded);

    const before = await maxAuditSeq(db.pool);
    const result = await seedDemoData(db.pool);
    expect(result.mode).toBe('reset');
    expect(result.removed.scenario).toBe(2);
    expect(result.removed.notification).toBe(1);
    expect(await dumpSyntheticRows(db.pool)).toEqual(seeded);

    const { rows: events } = await db.pool.query<{ event: string; before: { removed: Record<string, number> } }>(
      'SELECT event, before FROM audit_event WHERE seq > $1',
      [before],
    );
    expect(events.map((e) => e.event)).toEqual(['demo_data.reset']);
    expect(events[0]?.before.removed.staff).toBe(buildDemoDataset().staff.length);
  });

  it('keeps earlier demo audit events (append-only) across resets', async () => {
    expect(
      await count(`SELECT count(*)::int AS n FROM audit_event WHERE event IN ('demo_data.seeded', 'demo_data.reset')`),
    ).toBe(2);
  });

  it('records a real Administrator as the actor, and refuses anyone else', async () => {
    const adminId = await insertUser(db.pool, { email: 'real.admin@smretail.com' });
    await db.pool.query(`INSERT INTO role_assignment (user_id, role, scope_type) VALUES ($1, 'ADM', 'global')`, [
      adminId,
    ]);
    const plannerId = await insertUser(db.pool, { email: 'real.planner@smretail.com' });
    await db.pool.query(`INSERT INTO role_assignment (user_id, role, scope_type) VALUES ($1, 'EXE', 'global')`, [
      plannerId,
    ]);

    const before = await maxAuditSeq(db.pool);
    await expect(seedDemoData(db.pool, { actorUserId: plannerId })).rejects.toBeInstanceOf(DemoSeedConflictError);
    expect(await maxAuditSeq(db.pool)).toBe(before);

    const result = await seedDemoData(db.pool, { actorUserId: adminId, requestId: 'req-1' });
    const { rows } = await db.pool.query('SELECT user_id, active_role, request_id FROM audit_event WHERE id = $1', [
      result.auditEventId,
    ]);
    expect(rows).toEqual([{ user_id: adminId, active_role: 'ADM', request_id: 'req-1' }]);
  });

  it('refuses to take over a real account that holds a demo email, changing nothing', async () => {
    const other = await createTestDatabase();
    try {
      await insertUser(other.pool, { email: 'demo.finance@smretail.com' });
      await expect(seedDemoData(other.pool)).rejects.toThrow(/demo\.finance@smretail\.com/);
      expect(await maxAuditSeq(other.pool)).toBe(0);
      const { rows } = await other.pool.query('SELECT count(*)::int AS n FROM store');
      expect(rows[0]).toEqual({ n: 0 });
    } finally {
      await other.dispose();
    }
  });

  it('rolls back the whole reset if a real row references demo data', async () => {
    // A real cashier trained on a demo department: a P18 breach through a plain
    // FK that the reset must not paper over (or cascade into).
    const storeId = await insertStore(db.pool);
    const departmentId = await insertDepartment(db.pool, storeId);
    const staffId = await insertStaff(db.pool, storeId, departmentId);
    await db.pool.query('INSERT INTO staff_training (staff_id, department_id) VALUES ($1, $2)', [
      staffId,
      demoId('department', 'smsm-qc:main'),
    ]);

    const auditBefore = await maxAuditSeq(db.pool);
    const realBefore = await dumpRealRows(db.pool, auditBefore);
    const syntheticBefore = await dumpSyntheticRows(db.pool);
    await expect(seedDemoData(db.pool)).rejects.toThrow(/foreign key/);
    expect(await maxAuditSeq(db.pool)).toBe(auditBefore);
    expect(await dumpRealRows(db.pool, auditBefore)).toEqual(realBefore);
    expect(await dumpSyntheticRows(db.pool)).toEqual(syntheticBefore);

    // Once the offending real row is gone, the reset goes through.
    await db.pool.query('DELETE FROM staff_training WHERE staff_id = $1 AND department_id <> $2', [staffId, departmentId]);
    await expect(seedDemoData(db.pool)).resolves.toMatchObject({ mode: 'reset' });
  });
});
