/**
 * Invariants enforced by the database itself (task 5.1), independent of the
 * data-access layer: provenance isolation (P18), single published plan (P3),
 * read-only non-draft scenarios (P4), stale submission block (P5), approval
 * sequencing (P10), override traceability (P14), location privacy (P15),
 * single acceptance (P17) and rule-version/ingestion rules (Req 16, 17).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  insertDepartment,
  insertPublishedRosterWithShift,
  insertScenario,
  insertSnapshot,
  insertStaff,
  insertStore,
  insertUser,
} from '../support/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';

const CHECK = '23514';
const UNIQUE = '23505';
const FK = '23503';
const PRIVILEGE = '42501';

async function expectPgError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.dispose();
});

describe('identity', () => {
  it('accepts only lower-case emails on the smretail.com / 1cloudhub.com allowlist (P13)', async () => {
    await insertUser(db.pool, { email: 'ana@smretail.com' });
    await insertUser(db.pool, { email: 'ben@1cloudhub.com' });
    await expectPgError(insertUser(db.pool, { email: 'eve@gmail.com' }), CHECK);
    await expectPgError(insertUser(db.pool, { email: 'eve@smretail.com.evil.io' }), CHECK);
    await expectPgError(insertUser(db.pool, { email: 'Cara@smretail.com' }), CHECK);
    await expectPgError(insertUser(db.pool, { email: 'ana@smretail.com' }), UNIQUE);
  });

  it('defaults language to en and allows only en/fil', async () => {
    const id = await insertUser(db.pool);
    const { rows } = await db.pool.query('SELECT language FROM app_user WHERE id = $1', [id]);
    expect(rows[0]).toEqual({ language: 'en' });
    await expectPgError(db.pool.query(`UPDATE app_user SET language = 'es' WHERE id = $1`, [id]), CHECK);
  });

  it('shapes role-assignment scope by scope type; Staff is always self-scoped', async () => {
    const userId = await insertUser(db.pool);
    const q = (role: string, scopeType: string, ids: string[]): Promise<unknown> =>
      db.pool.query('INSERT INTO role_assignment (user_id, role, scope_type, scope_ids) VALUES ($1, $2, $3, $4)', [
        userId,
        role,
        scopeType,
        ids,
      ]);
    const storeId = await insertStore(db.pool);
    await q('PLN', 'global', []);
    await q('STM', 'store', [storeId]);
    await expectPgError(q('HR', 'global', [storeId]), CHECK);
    await expectPgError(q('FIN', 'region', []), CHECK);
    await expectPgError(q('EXE', 'self', [storeId]), CHECK);
    await expectPgError(q('STF', 'global', []), CHECK);
    await expectPgError(q('PLN', 'region', [storeId]), UNIQUE);
  });
});

describe('demo-data isolation (P18)', () => {
  it('rejects a department whose provenance differs from its store', async () => {
    const real = await insertStore(db.pool, false);
    await insertDepartment(db.pool, real, false);
    await expectPgError(insertDepartment(db.pool, real, true), FK);
  });

  it('rejects staff whose provenance differs from their store', async () => {
    const demo = await insertStore(db.pool, true);
    const dept = await insertDepartment(db.pool, demo, true);
    await insertStaff(db.pool, demo, dept, true);
    await expectPgError(insertStaff(db.pool, demo, dept, false), FK);
  });

  it('never lets a scenario pin a snapshot of the other provenance', async () => {
    const owner = await insertUser(db.pool);
    const realScenario = await insertScenario(db.pool, owner, { synthetic: false });
    const demoSnapshot = await insertSnapshot(db.pool, { type: 'master', synthetic: true });
    const realSnapshot = await insertSnapshot(db.pool, { type: 'master', synthetic: false });
    const pin = (snapshotId: string, synthetic: boolean): Promise<unknown> =>
      db.pool.query(
        `INSERT INTO scenario_snapshot (scenario_id, dataset_type, snapshot_id, synthetic) VALUES ($1, 'master', $2, $3)`,
        [realScenario, snapshotId, synthetic],
      );
    await expectPgError(pin(demoSnapshot, true), FK); // scenario is real
    await expectPgError(pin(demoSnapshot, false), FK); // snapshot is synthetic
    await pin(realSnapshot, false);
  });

  it('keeps one current snapshot per dataset type and provenance', async () => {
    const a = await insertSnapshot(db.pool, { type: 'staff' });
    const b = await insertSnapshot(db.pool, { type: 'staff' });
    const { rows } = await db.pool.query<{ id: string; superseded_by: string | null }>(
      `SELECT id, superseded_by FROM dataset_snapshot WHERE id = ANY($1)`,
      [[a, b]],
    );
    expect(rows.find((r) => r.id === a)?.superseded_by).toBe(b);
    expect(rows.find((r) => r.id === b)?.superseded_by).toBeNull();
    await expectPgError(
      db.pool.query(
        `INSERT INTO dataset_snapshot (dataset_type, covers_from, covers_to, row_count) VALUES ('staff', '2026-01-01', '2026-01-02', 1)`,
      ),
      UNIQUE,
    );
    await expectPgError(db.pool.query('UPDATE dataset_snapshot SET row_count = 99 WHERE id = $1', [b]), CHECK);
  });
});

describe('scenarios (P3, P4, P5)', () => {
  it('allows at most one Published scenario per season (per provenance)', async () => {
    const owner = await insertUser(db.pool);
    const season = 'christmas-2026';
    const publish = async (id: string): Promise<void> => {
      await db.pool.query(`UPDATE scenario SET status = 'submitted' WHERE id = $1`, [id]);
      await db.pool.query(`UPDATE scenario SET status = 'approved' WHERE id = $1`, [id]);
      await db.pool.query(`UPDATE scenario SET status = 'published', published_at = now() WHERE id = $1`, [id]);
    };
    const first = await insertScenario(db.pool, owner, { season });
    const second = await insertScenario(db.pool, owner, { season });
    const demo = await insertScenario(db.pool, owner, { season, synthetic: true });
    await publish(first);
    await expectPgError(publish(second), UNIQUE);
    await publish(demo); // demo plans never collide with real ones
  });

  it('rejects lifecycle transitions not in SCENARIO_TRANSITIONS', async () => {
    const owner = await insertUser(db.pool);
    const id = await insertScenario(db.pool, owner);
    await expectPgError(
      db.pool.query(`UPDATE scenario SET status = 'published', published_at = now() WHERE id = $1`, [id]),
      CHECK,
    );
  });

  it('freezes settings and input pins once a scenario leaves Draft (P4)', async () => {
    const owner = await insertUser(db.pool);
    const id = await insertScenario(db.pool, owner);
    await db.pool.query(`UPDATE scenario SET settings = '{"serviceLevel":0.8}' WHERE id = $1`, [id]);
    await db.pool.query(`UPDATE scenario SET status = 'submitted' WHERE id = $1`, [id]);
    await expectPgError(
      db.pool.query(`UPDATE scenario SET settings = '{"serviceLevel":0.7}' WHERE id = $1`, [id]),
      CHECK,
    );
    const snapshot = await insertSnapshot(db.pool, { type: 'pos' });
    await expectPgError(
      db.pool.query(
        `INSERT INTO scenario_snapshot (scenario_id, dataset_type, snapshot_id, synthetic) VALUES ($1, 'pos', $2, false)`,
        [id, snapshot],
      ),
      CHECK,
    );
  });

  it('blocks submission of a stale scenario (P5)', async () => {
    const owner = await insertUser(db.pool);
    const id = await insertScenario(db.pool, owner, { stale: true });
    await expectPgError(db.pool.query(`UPDATE scenario SET status = 'submitted' WHERE id = $1`, [id]), CHECK);
  });
});

describe('approval steps (P10, Q3, Q19)', () => {
  async function submitted(): Promise<{ scenarioId: string; approver: string }> {
    const approver = await insertUser(db.pool);
    const scenarioId = await insertScenario(db.pool, approver);
    await db.pool.query(
      `INSERT INTO approval_step (scenario_id, submission_no, step)
       VALUES ($1, 1, 'headcount'), ($1, 1, 'budget'), ($1, 1, 'plan')`,
      [scenarioId],
    );
    return { scenarioId, approver };
  }
  const decide = (
    scenarioId: string,
    step: string,
    status: string,
    role: string,
    by: string,
    extra: { comment?: string; reference?: string } = {},
  ): Promise<unknown> =>
    db.pool.query(
      `UPDATE approval_step
          SET status = $3, decided_as_role = $4, decided_by = $5, decided_at = now(),
              comment = $6, outside_reference = $7
        WHERE scenario_id = $1 AND submission_no = 1 AND step = $2`,
      [scenarioId, step, status, role, by, extra.comment ?? null, extra.reference ?? null],
    );

  it('keeps plan approval blocked until headcount and budget are secured', async () => {
    const { scenarioId, approver } = await submitted();
    await expectPgError(decide(scenarioId, 'plan', 'approved', 'EXE', approver), CHECK);
    await decide(scenarioId, 'headcount', 'approved', 'HR', approver);
    await expectPgError(decide(scenarioId, 'plan', 'approved', 'EXE', approver), CHECK);
    await decide(scenarioId, 'budget', 'secured_outside', 'EXE', approver, { reference: 'Board minute 12' });
    await decide(scenarioId, 'plan', 'approved', 'EXE', approver);
  });

  it('requires the step approver role, a comment for changes, and EXE + reference for off-system records', async () => {
    const { scenarioId, approver } = await submitted();
    await expectPgError(decide(scenarioId, 'headcount', 'approved', 'FIN', approver), CHECK);
    await expectPgError(decide(scenarioId, 'budget', 'changes_requested', 'FIN', approver), CHECK);
    await expectPgError(decide(scenarioId, 'budget', 'rejected', 'FIN', approver, { comment: 'no' }), CHECK);
    await expectPgError(decide(scenarioId, 'budget', 'secured_outside', 'FIN', approver, { reference: 'x' }), CHECK);
    await expectPgError(decide(scenarioId, 'budget', 'secured_outside', 'EXE', approver), CHECK);
    await expectPgError(decide(scenarioId, 'plan', 'secured_outside', 'EXE', approver, { reference: 'x' }), CHECK);
    await decide(scenarioId, 'budget', 'changes_requested', 'FIN', approver, { comment: 'Trim Dec overtime' });
  });
});

describe('rule versions (Req 16, P6)', () => {
  it('never publishes a cost rule without Finance approval and freezes submitted content', async () => {
    const author = await insertUser(db.pool);
    const {
      rows: [set],
    } = await db.pool.query<{ id: string }>(
      `INSERT INTO rule_set (rule_set_type, name, is_cost_rule) VALUES ('wages', 'Wages', true) RETURNING id`,
    );
    const {
      rows: [version],
    } = await db.pool.query<{ id: string }>(
      `INSERT INTO rule_version (rule_set_id, is_cost_rule, version, effective_from, payload, created_by)
       VALUES ($1, true, 1, '2026-11-01', '{"dailyRate":645}', $2) RETURNING id`,
      [set?.id, author],
    );
    await db.pool.query(`UPDATE rule_version SET status = 'submitted' WHERE id = $1`, [version?.id]);
    await expectPgError(
      db.pool.query(`UPDATE rule_version SET payload = '{"dailyRate":700}' WHERE id = $1`, [version?.id]),
      CHECK,
    );
    await expectPgError(
      db.pool.query(
        `UPDATE rule_version SET status = 'published', published_by = $2, published_at = now() WHERE id = $1`,
        [version?.id, author],
      ),
      CHECK,
    );
    await expectPgError(
      db.pool.query(
        // Other provenance, so the one-open-version index (0110) doesn't fire first.
        `INSERT INTO rule_version (rule_set_id, is_cost_rule, version, effective_from, payload, created_by, synthetic)
         VALUES ($1, false, 2, '2026-11-01', '{}', $2, true)`,
        [set?.id, author],
      ),
      FK,
    );
  });
});

describe('ingestion (Req 17.3)', () => {
  it('cannot mark a run with errors as loaded', async () => {
    const user = await insertUser(db.pool);
    const snapshot = await insertSnapshot(db.pool, { type: 'pos', synthetic: true });
    await expectPgError(
      db.pool.query(
        `INSERT INTO ingestion_run (dataset_type, user_id, file_name, error_count, status, snapshot_id)
         VALUES ('pos', $1, 'pos.csv', 3, 'loaded', $2)`,
        [user, snapshot],
      ),
      CHECK,
    );
  });
});

describe('roster overrides and offers (P14, P17)', () => {
  it('requires a reason for any labor-rule breach and a published roster', async () => {
    const { rosterId, shiftId, staffId } = await insertPublishedRosterWithShift(db.pool);
    const by = await insertUser(db.pool);
    const override = (breaches: string, reason: string | null): Promise<unknown> =>
      db.pool.query(
        `INSERT INTO shift_override (roster_id, shift_id, override_type, from_staff_id, rule_breaches, reason, created_by)
         VALUES ($1, $2, 'emergency_off', $3, $4, $5, $6)`,
        [rosterId, shiftId, staffId, breaches, reason, by],
      );
    await expectPgError(override('[{"rule":"max_weekly_hours"}]', null), CHECK);
    await override('[{"rule":"max_weekly_hours"}]', 'Typhoon cover');
    await override('[]', null);

    await db.pool.query(`UPDATE roster SET status = 'draft' WHERE id = $1`, [rosterId]);
    await expectPgError(override('[]', null), CHECK);
  });

  it('accepts at most one offer per shift (P17)', async () => {
    const { shiftId, storeId, departmentId } = await insertPublishedRosterWithShift(db.pool);
    const sender = await insertUser(db.pool);
    const a = await insertStaff(db.pool, storeId, departmentId);
    const b = await insertStaff(db.pool, storeId, departmentId);
    const offer = async (staffId: string): Promise<string> => {
      const { rows } = await db.pool.query<{ id: string }>(
        `INSERT INTO shift_offer (shift_id, staff_id, sent_by, expires_at) VALUES ($1, $2, $3, now() + interval '30 minutes') RETURNING id`,
        [shiftId, staffId, sender],
      );
      return rows[0]?.id ?? '';
    };
    const [oa, ob] = [await offer(a), await offer(b)];
    const accept = (id: string): Promise<unknown> =>
      db.pool.query(`UPDATE shift_offer SET status = 'accepted', responded_at = now() WHERE id = $1`, [id]);
    await accept(oa);
    await expectPgError(accept(ob), UNIQUE);
  });
});

describe('location privacy (P15)', () => {
  it('stores home areas only as a barangay reference', async () => {
    const { rows } = await db.pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name ~ '(address|street|gps|lat|lon|geo|coord|house|postal|zip)'`,
    );
    // Coordinates exist only on stores and on the public barangay reference list.
    for (const r of rows) expect(['store_location', 'barangay']).toContain(r.table_name);

    const { rows: cols } = await db.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'staff_home_area' ORDER BY column_name`,
    );
    expect(cols.map((c) => c.column_name)).toEqual([
      'barangay_code',
      'consent_at',
      'cross_store_offers',
      'max_travel_min',
      'staff_id',
      'synthetic',
      'updated_at',
    ]);
  });

  it('requires consent to store a home area', async () => {
    const store = await insertStore(db.pool);
    const dept = await insertDepartment(db.pool, store);
    const staff = await insertStaff(db.pool, store, dept);
    await db.pool.query(
      `INSERT INTO barangay (psgc_code, name, city, centroid_lat, centroid_lon) VALUES ('137404001', 'Bagong Pag-asa', 'Quezon City', 14.6581, 121.0345)`,
    );
    await expect(
      db.pool.query(
        `INSERT INTO staff_home_area (staff_id, barangay_code, consent_at, max_travel_min) VALUES ($1, '137404001', NULL, 30)`,
        [staff],
      ),
    ).rejects.toMatchObject({ code: '23502' });
  });
});

describe('saved views', () => {
  it('keeps one default view per user and screen', async () => {
    const user = await insertUser(db.pool);
    const add = (name: string): Promise<unknown> =>
      db.pool.query(
        `INSERT INTO saved_view (user_id, screen, name, query, is_default) VALUES ($1, 'SCR-020', $2, 'region=ncr', true)`,
        [user, name],
      );
    await add('Mine');
    await expectPgError(add('Other'), UNIQUE);
  });
});

describe('audit_event is append-only (Req 22.1)', () => {
  async function anEvent(at = 'now()'): Promise<string> {
    const user = await insertUser(db.pool);
    const { rows } = await db.pool.query<{ id: string }>(
      `INSERT INTO audit_event (at, user_id, active_role, action, event, object_type, object_id, after)
       VALUES (${at}, $1, 'PLN', 'create', 'scenario.created', 'scenario', 'x', '{}') RETURNING id`,
      [user],
    );
    return rows[0]?.id ?? '';
  }

  it('rejects UPDATE, DELETE and TRUNCATE even for the owner', async () => {
    const id = await anEvent();
    await expectPgError(db.pool.query(`UPDATE audit_event SET event = 'x.y' WHERE id = $1`, [id]), PRIVILEGE);
    await expectPgError(db.pool.query('DELETE FROM audit_event WHERE id = $1', [id]), PRIVILEGE);
    await expectPgError(db.pool.query('TRUNCATE audit_event'), PRIVILEGE);
  });

  it('grants the application role only SELECT and INSERT', async () => {
    const { rows } = await db.pool.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'audit_event' AND grantee = 'lanewise_app' ORDER BY privilege_type`,
    );
    expect(rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });

  it('allows only the opt-in retention purge of events older than 5 years', async () => {
    const recent = await anEvent();
    const old = await anEvent(`now() - interval '6 years'`);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lanewise.audit_retention_purge = 'on'`);
      const res = await client.query('DELETE FROM audit_event WHERE id = $1', [old]);
      expect(res.rowCount).toBe(1);
      await expectPgError(client.query('DELETE FROM audit_event WHERE id = $1', [recent]), PRIVILEGE);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    // Without the opt-in even an old event stays.
    await expectPgError(db.pool.query('DELETE FROM audit_event WHERE id = $1', [old]), PRIVILEGE);
  });
});
