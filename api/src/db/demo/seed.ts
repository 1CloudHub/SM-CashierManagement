/**
 * Demo-data seed and reset (task 23; Req 19.1, 19.2, 19.5, 19.6; P7, P18).
 *
 * `seedDemoData` is one idempotent operation: in a single transaction it
 * deletes every synthetic row, then loads the demo network from
 * `buildDemoDataset` (./dataset.ts). Running it on an empty database seeds;
 * running it again resets the demo data to the seed. Either way the result is
 * the same rows with the same ids.
 *
 * Isolation (P18):
 *   - Only rows with `synthetic = true` are deleted — or, for link tables with
 *     no flag of their own (approval steps, staff training, role assignments,
 *     travel times), rows that hang off a synthetic parent. No UPDATE touches
 *     a real row, and no cascade from a synthetic row reaches a real one: the
 *     provenance-matching composite FKs (migrations 0001–0005) keep children
 *     the same provenance as their parents.
 *   - If a real row nevertheless references a demo row through a plain FK
 *     (e.g. a real ingestion run pointing at a demo snapshot), the delete
 *     fails and the whole reset rolls back: reset fails loudly rather than
 *     change a real record.
 *   - Everything seeded is `synthetic = true`; the DB rejects any snapshot pin,
 *     run input or roster that mixes provenances.
 *
 * Audit decision (Req 19.5, 22.1; P7): each seed or reset writes exactly one
 * audit event — action `ingestion` (it loads the demo dataset), event
 * `demo_data.seeded` (nothing to remove) or `demo_data.reset`, object
 * `demo_dataset/<snapshot id>`, `synthetic = true`, with the removed row counts
 * as `before` and the seeded counts as `after`. Individual seeded rows are a
 * bulk load under that one event and are not audited one by one. Audit events
 * are append-only (migration 0005), so reset never deletes them: the demo
 * audit trail — including every earlier seed/reset event — is retained, and
 * because demo ids are deterministic it keeps pointing at the same objects.
 * For the same reason demo users are upserted (restored to their seeded
 * profile and roles), never deleted, since audit events reference them.
 *
 * Shared reference/catalog rows without a provenance flag are only ever
 * inserted when missing and are left in place on reset: the seven rule-set
 * rows (`rule_set` is one catalog per rule type; the demo versions are the
 * synthetic series inside it).
 */
import type { RoleCode } from '@lanewise/shared';
import type pg from 'pg';
import { audit, withAuditedTransaction, type Actor, type AuditedTx } from '../audit.js';
import type { Tx } from '../pool.js';
import { buildDemoDataset, DEMO_TIMES, DEMO_USER_EMAILS, demoId, demoUserId, type DemoDataset } from './dataset.js';

export interface DemoSeedOptions {
  /** POS-history generator seed (default: the DOM-001 Fixture B seed). */
  readonly seed?: number;
  /**
   * Administrator performing the reset. Must hold the ADM role. Defaults to
   * the seeded demo Administrator.
   */
  readonly actorUserId?: string;
  readonly requestId?: string | null;
}

export interface DemoSeedResult {
  readonly mode: 'seeded' | 'reset';
  readonly auditEventId: string;
  readonly removed: Readonly<Record<string, number>>;
  readonly seeded: Readonly<Record<string, number>>;
}

/** The seed would have to change a real (non-synthetic) record. Nothing was changed. */
export class DemoSeedConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoSeedConflictError';
  }
}

const LOCK_KEY = 'lanewise.demo_seed';

/**
 * Deletes, in FK-safe order, every synthetic row and the flag-less link rows
 * that belong to one. Returns the number of rows removed per table.
 */
async function wipeSyntheticData(tx: Tx): Promise<Record<string, number>> {
  const steps: readonly (readonly [string, string])[] = [
    // Overrides first: an offer / borrow fill references its offer or request (0170).
    ['shift_override', 'DELETE FROM shift_override WHERE synthetic'],
    ['shift_offer', 'DELETE FROM shift_offer WHERE synthetic'],
    ['transfer_request', 'DELETE FROM transfer_request WHERE synthetic'],
    ['staff_availability', 'DELETE FROM staff_availability WHERE synthetic'],
    ['staff_request', 'DELETE FROM staff_request WHERE synthetic'],
    ['shift', 'DELETE FROM shift WHERE synthetic'],
    ['roster', 'DELETE FROM roster WHERE synthetic'],
    ['notification', 'DELETE FROM notification WHERE synthetic'],
    ['approval_step', 'DELETE FROM approval_step WHERE scenario_id IN (SELECT id FROM scenario WHERE synthetic)'],
    ['scenario_run', 'DELETE FROM scenario_run WHERE synthetic'],
    ['scenario', 'DELETE FROM scenario WHERE synthetic'],
    ['ingestion_run', 'DELETE FROM ingestion_run WHERE synthetic'],
    ['dataset_snapshot', 'DELETE FROM dataset_snapshot WHERE synthetic'],
    ['rule_version', 'DELETE FROM rule_version WHERE synthetic'],
    ['staff_home_area', 'DELETE FROM staff_home_area WHERE synthetic'],
    ['staff_consent', 'DELETE FROM staff_consent WHERE synthetic'],
    ['staff_training', 'DELETE FROM staff_training WHERE staff_id IN (SELECT id FROM staff WHERE synthetic)'],
    ['staff', 'DELETE FROM staff WHERE synthetic'],
    [
      'travel_time',
      `DELETE FROM travel_time
        WHERE store_id IN (SELECT id FROM store WHERE synthetic)
           OR barangay_code IN (SELECT psgc_code FROM barangay WHERE synthetic)`,
    ],
    ['store_location', 'DELETE FROM store_location WHERE synthetic'],
    ['department', 'DELETE FROM department WHERE synthetic'],
    ['store', 'DELETE FROM store WHERE synthetic'],
    ['region', 'DELETE FROM region WHERE synthetic'],
    ['barangay', 'DELETE FROM barangay WHERE synthetic'],
    ['role_assignment', 'DELETE FROM role_assignment WHERE user_id IN (SELECT id FROM app_user WHERE synthetic)'],
  ];
  const removed: Record<string, number> = {};
  for (const [table, sql] of steps) {
    const result = await tx.query(sql);
    removed[table] = result.rowCount ?? 0;
  }
  return removed;
}

/** Bulk insert from a JSON array via jsonb_to_recordset. */
async function insertJson(tx: Tx, sql: string, rows: readonly unknown[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.query(sql, [JSON.stringify(rows)]);
}

async function assertActorIsAdmin(tx: Tx, actor: Actor): Promise<void> {
  if (actor.userId === demoUserId('ADM')) return;
  const { rows } = await tx.query(
    `SELECT 1 FROM app_user u JOIN role_assignment r ON r.user_id = u.id
      WHERE u.id = $1 AND u.status = 'active' AND r.role = 'ADM'`,
    [actor.userId],
  );
  if (rows.length === 0) throw new DemoSeedConflictError('only an Administrator can reset demo data');
}

async function upsertUsers(tx: Tx, data: DemoDataset): Promise<void> {
  const { rows } = await tx.query<{ email: string }>(
    `SELECT email FROM app_user
      WHERE email = ANY($1::text[]) AND (NOT synthetic OR NOT (id = ANY($2::uuid[])))`,
    [DEMO_USER_EMAILS, data.users.map((u) => u.id)],
  );
  if (rows.length > 0) {
    throw new DemoSeedConflictError(
      `demo user email(s) already belong to other accounts: ${rows.map((r) => r.email).join(', ')}`,
    );
  }
  await insertJson(
    tx,
    `INSERT INTO app_user (id, email, name, synthetic)
     SELECT x.id, x.email, x.name, true FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, email text, name text)
     ON CONFLICT (id) DO UPDATE
       SET email = EXCLUDED.email, name = EXCLUDED.name, status = 'active', active_role = NULL, language = 'en'
       WHERE app_user.synthetic`,
    data.users.map((u) => ({ id: u.id, email: u.email, name: u.name })),
  );
}

async function insertOrganisation(tx: Tx, data: DemoDataset): Promise<void> {
  await insertJson(
    tx,
    `INSERT INTO region (id, code, name, synthetic)
     SELECT x.id, x.code, x.name, true FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, code text, name text)`,
    data.regions,
  );
  await insertJson(
    tx,
    `INSERT INTO store (id, code, name, format, region_id, synthetic)
     SELECT x.id, x.code, x.name, x.format, x."regionId", true
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, code text, name text, format text, "regionId" uuid)`,
    data.stores,
  );
  await insertJson(
    tx,
    `INSERT INTO store_location (store_id, lat, lon, geocoded_at, source, synthetic)
     SELECT x.id, x.lat, x.lon, '${DEMO_TIMES.snapshotLoadedAt}'::timestamptz, 'demo_approximate', true
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, lat numeric, lon numeric)`,
    data.stores,
  );
  await insertJson(
    tx,
    `INSERT INTO department (id, store_id, name, installed_lanes, default_handle_time_min, trading_open, trading_close, synthetic)
     SELECT x.id, x."storeId", x.name, x."installedLanes", x."defaultHandleTimeMin", x."tradingOpen"::time, x."tradingClose"::time, true
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id uuid, "storeId" uuid, name text, "installedLanes" integer, "defaultHandleTimeMin" numeric,
         "tradingOpen" text, "tradingClose" text)`,
    data.departments,
  );
  await insertJson(
    tx,
    `INSERT INTO barangay (psgc_code, name, city, centroid_lat, centroid_lon, synthetic)
     SELECT x."psgcCode", x.name, x.city, x.lat, x.lon, true
       FROM jsonb_to_recordset($1::jsonb) AS x("psgcCode" text, name text, city text, lat numeric, lon numeric)`,
    data.barangays,
  );
}

async function insertStaff(tx: Tx, data: DemoDataset): Promise<void> {
  const personaStaffId = data.users.find((u) => u.role === 'STF')?.scopeIds[0];
  await insertJson(
    tx,
    `INSERT INTO staff (id, store_id, department_id, employee_no, name, email, user_id, employment_type,
                        preferred_rest_day, weekly_pattern, synthetic)
     SELECT x.id, x."storeId", x."departmentId", x."employeeNo", x.name, x.email, x."userId", x."employmentType",
            x."preferredRestDay", x."weeklyPattern", true
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id uuid, "storeId" uuid, "departmentId" uuid, "employeeNo" text, name text, email text, "userId" uuid,
         "employmentType" text, "preferredRestDay" smallint, "weeklyPattern" jsonb)`,
    data.staff.map((s) => ({ ...s, userId: s.id === personaStaffId ? demoUserId('STF') : null })),
  );
  await insertJson(
    tx,
    `INSERT INTO staff_training (staff_id, department_id)
     SELECT x."staffId", x."departmentId" FROM jsonb_to_recordset($1::jsonb) AS x("staffId" uuid, "departmentId" uuid)`,
    data.staff.flatMap((s) => s.trainedDepartmentIds.map((departmentId) => ({ staffId: s.id, departmentId }))),
  );
  await insertJson(
    tx,
    `INSERT INTO staff_availability (id, staff_id, kind, starts_at, ends_at, reason, source, synthetic)
     SELECT x.id, x."staffId", 'unavailable', x."startsAt", x."endsAt", x.reason, 'import', true
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id uuid, "staffId" uuid, "startsAt" timestamptz, "endsAt" timestamptz, reason text)`,
    data.availability,
  );
  // A home area may exist only under an active home-area consent (task 15);
  // seeded consents have no granting user.
  await insertJson(
    tx,
    `INSERT INTO staff_consent (id, staff_id, purpose, text_version, text_locale, granted_at, synthetic)
     SELECT x.id, x."staffId", 'home_area', 1, 'en', '${DEMO_TIMES.consentAt}'::timestamptz, true
       FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, "staffId" uuid)`,
    data.homeAreas.map((h) => ({ id: demoId('staff_consent', h.staffId), staffId: h.staffId })),
  );
  await insertJson(
    tx,
    `INSERT INTO staff_home_area (staff_id, barangay_code, consent_at, max_travel_min, cross_store_offers, synthetic)
     SELECT x."staffId", x."barangayCode", '${DEMO_TIMES.consentAt}'::timestamptz, x."maxTravelMin", x."crossStoreOffers", true
       FROM jsonb_to_recordset($1::jsonb) AS x(
         "staffId" uuid, "barangayCode" text, "maxTravelMin" integer, "crossStoreOffers" boolean)`,
    data.homeAreas,
  );
}

async function insertRoleAssignments(tx: Tx, data: DemoDataset): Promise<void> {
  await insertJson(
    tx,
    `INSERT INTO role_assignment (user_id, role, scope_type, scope_ids, granted_by)
     SELECT x."userId", x.role, x."scopeType", ARRAY(SELECT jsonb_array_elements_text(x."scopeIds"))::uuid[],
            '${demoUserId('ADM')}'::uuid
       FROM jsonb_to_recordset($1::jsonb) AS x("userId" uuid, role text, "scopeType" text, "scopeIds" jsonb)`,
    data.users.map((u) => ({ userId: u.id, role: u.role, scopeType: u.scopeType, scopeIds: u.scopeIds })),
  );
}

/** Ensures the rule-set catalog rows exist; returns rule-set id and cost flag per type. */
async function ensureRuleSets(tx: Tx, data: DemoDataset): Promise<Map<string, { id: string; isCostRule: boolean }>> {
  await insertJson(
    tx,
    `INSERT INTO rule_set (rule_set_type, name, is_cost_rule)
     SELECT x.type, x.name, x."isCostRule" FROM jsonb_to_recordset($1::jsonb) AS x(type text, name text, "isCostRule" boolean)
     ON CONFLICT (rule_set_type) DO NOTHING`,
    data.ruleVersions.map((v) => ({ type: v.ruleSetType, name: v.ruleSetName, isCostRule: v.isCostRule })),
  );
  const { rows } = await tx.query<{ id: string; rule_set_type: string; is_cost_rule: boolean }>(
    'SELECT id, rule_set_type, is_cost_rule FROM rule_set',
  );
  return new Map(rows.map((r) => [r.rule_set_type, { id: r.id, isCostRule: r.is_cost_rule }]));
}

async function insertRulesAndSnapshots(tx: Tx, data: DemoDataset): Promise<void> {
  const sets = await ensureRuleSets(tx, data);
  const rst = demoUserId('RST');
  const fin = demoUserId('FIN');
  await insertJson(
    tx,
    `INSERT INTO rule_version (id, rule_set_id, is_cost_rule, version, effective_from, status, payload, change_note,
                               created_by, submitted_at, finance_approved_by, finance_approved_at,
                               published_by, published_at, synthetic)
     SELECT x.id, x."ruleSetId", x."isCostRule", 1, x."effectiveFrom"::date, 'published', x.payload, x."changeNote",
            x."createdBy", x."submittedAt", x."financeApprovedBy", x."financeApprovedAt",
            x."createdBy", x."publishedAt", true
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id uuid, "ruleSetId" uuid, "isCostRule" boolean, "effectiveFrom" text, payload jsonb, "changeNote" text,
         "createdBy" uuid, "submittedAt" timestamptz, "financeApprovedBy" uuid, "financeApprovedAt" timestamptz,
         "publishedAt" timestamptz)`,
    data.ruleVersions.map((v) => {
      const set = sets.get(v.ruleSetType);
      if (!set) throw new Error(`rule set ${v.ruleSetType} missing`);
      return {
        id: v.id,
        ruleSetId: set.id,
        isCostRule: set.isCostRule,
        effectiveFrom: v.effectiveFrom,
        payload: v.payload,
        changeNote: v.changeNote,
        createdBy: rst,
        submittedAt: DEMO_TIMES.rulesSubmittedAt,
        financeApprovedBy: set.isCostRule ? fin : null,
        financeApprovedAt: set.isCostRule ? DEMO_TIMES.rulesApprovedAt : null,
        publishedAt: DEMO_TIMES.rulesPublishedAt,
      };
    }),
  );
  await insertJson(
    tx,
    `INSERT INTO dataset_snapshot (id, dataset_type, covers_from, covers_to, row_count, storage_key, synthetic, loaded_at, loaded_by)
     SELECT x.id, x."datasetType", x."coversFrom"::date, x."coversTo"::date, x."rowCount", x."storageKey", true,
            '${DEMO_TIMES.snapshotLoadedAt}'::timestamptz, '${rst}'::uuid
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id uuid, "datasetType" text, "coversFrom" text, "coversTo" text, "rowCount" integer, "storageKey" text)`,
    data.snapshots,
  );
}

/**
 * The published Christmas scenario: Draft with its input pins, then walked
 * through the lifecycle the DB enforces (submit -> headcount + budget approved
 * -> plan approved -> published), plus one succeeded network run pinned to the
 * same synthetic inputs.
 */
async function insertPublishedScenario(tx: Tx, data: DemoDataset): Promise<void> {
  const s = data.scenario;
  const pln = demoUserId('PLN');
  await tx.query(
    `INSERT INTO scenario (id, name, season, owner_id, settings, settings_changed_at, last_run_at, synthetic)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
    [s.id, s.name, s.season, pln, JSON.stringify(s.settings), DEMO_TIMES.snapshotLoadedAt, DEMO_TIMES.scenarioRunAt],
  );
  const snapshotIds = data.snapshots.map((x) => x.id);
  const versionIds = data.ruleVersions.map((v) => v.id);
  await tx.query(
    `INSERT INTO scenario_snapshot (scenario_id, dataset_type, snapshot_id, synthetic)
     SELECT $1, d.dataset_type, d.id, true FROM dataset_snapshot d WHERE d.id = ANY($2::uuid[])`,
    [s.id, snapshotIds],
  );
  await tx.query(
    `INSERT INTO scenario_rule_version (scenario_id, rule_set_id, rule_version_id, synthetic)
     SELECT $1, v.rule_set_id, v.id, true FROM rule_version v WHERE v.id = ANY($2::uuid[])`,
    [s.id, versionIds],
  );
  await tx.query(
    `INSERT INTO scenario_run (id, scenario_id, run_type, status, progress, results_ref, idempotency_key, requested_by,
                               synthetic, created_at, started_at, finished_at)
     VALUES ($1, $2, 'network', 'succeeded', 1, $3, $4, $5, true, $6, $6, $6)`,
    [s.runId, s.id, s.runResultsRef, s.runIdempotencyKey, pln, DEMO_TIMES.scenarioRunAt],
  );
  await tx.query(
    `INSERT INTO scenario_run_snapshot (run_id, dataset_type, snapshot_id, synthetic)
     SELECT $1, d.dataset_type, d.id, true FROM dataset_snapshot d WHERE d.id = ANY($2::uuid[])`,
    [s.runId, snapshotIds],
  );
  await tx.query(
    `INSERT INTO scenario_run_rule_version (run_id, rule_set_id, rule_version_id, synthetic)
     SELECT $1, v.rule_set_id, v.id, true FROM rule_version v WHERE v.id = ANY($2::uuid[])`,
    [s.runId, versionIds],
  );

  await tx.query(`UPDATE scenario SET status = 'submitted', current_submission_no = 1 WHERE id = $1`, [s.id]);
  const decide = async (step: string, role: RoleCode, at: string, comment: string): Promise<void> => {
    await tx.query(
      `INSERT INTO approval_step (id, scenario_id, submission_no, step, status, decided_by, decided_as_role, decided_at, comment, created_at)
       VALUES ($1, $2, 1, $3, 'approved', $4, $5, $6, $7, $6)`,
      [demoId('approval_step', `${s.id}:1:${step}`), s.id, step, demoUserId(role), role, at, comment],
    );
  };
  await decide('headcount', 'HR', DEMO_TIMES.headcountApprovedAt, 'Seasonal hiring waves agreed (demo).');
  await decide('budget', 'FIN', DEMO_TIMES.budgetApprovedAt, 'Within the Christmas labor budget (demo).');
  await decide('plan', 'EXE', DEMO_TIMES.planApprovedAt, 'Approved for publication (demo).');
  await tx.query(`UPDATE scenario SET status = 'approved' WHERE id = $1`, [s.id]);
  await tx.query(`UPDATE scenario SET status = 'published', published_at = $2 WHERE id = $1`, [
    s.id,
    DEMO_TIMES.planApprovedAt,
  ]);
}

function seededCounts(data: DemoDataset): Record<string, number> {
  return {
    regions: data.regions.length,
    stores: data.stores.length,
    departments: data.departments.length,
    lanes: data.departments.reduce((n, d) => n + d.installedLanes, 0),
    barangays: data.barangays.length,
    staff: data.staff.length,
    staffAvailability: data.availability.length,
    staffHomeAreas: data.homeAreas.length,
    users: data.users.length,
    roleAssignments: data.users.length,
    ruleVersions: data.ruleVersions.length,
    datasetSnapshots: data.snapshots.length,
    posHistoryRows: data.snapshots.find((x) => x.datasetType === 'pos')?.rowCount ?? 0,
    scenarios: 1,
    scenarioRuns: 1,
  };
}

/**
 * Seeds the demo network, or resets it to the seed if demo data exists.
 * One transaction, one audit event; real rows are never changed.
 */
export async function seedDemoData(pool: pg.Pool, options: DemoSeedOptions = {}): Promise<DemoSeedResult> {
  const data = buildDemoDataset(options.seed);
  const actor: Actor = {
    userId: options.actorUserId ?? demoUserId('ADM'),
    activeRole: 'ADM',
    requestId: options.requestId ?? null,
  };
  return withAuditedTransaction(pool, actor, async (tx: AuditedTx) => {
    // Serialise concurrent seeds/resets.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LOCK_KEY]);
    await assertActorIsAdmin(tx, actor);
    const { rows } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM app_user WHERE synthetic');
    const hadDemoUsers = (rows[0]?.n ?? 0) > 0;

    const removed = await wipeSyntheticData(tx);
    await upsertUsers(tx, data);
    await insertOrganisation(tx, data);
    await insertStaff(tx, data);
    await insertRoleAssignments(tx, data);
    await insertRulesAndSnapshots(tx, data);
    await insertPublishedScenario(tx, data);

    const removedTotal = Object.values(removed).reduce((a, b) => a + b, 0);
    const mode = hadDemoUsers || removedTotal > 0 ? 'reset' : 'seeded';
    const seeded = seededCounts(data);
    const event = await audit.record(tx, {
      action: 'ingestion',
      event: mode === 'reset' ? 'demo_data.reset' : 'demo_data.seeded',
      objectType: 'demo_dataset',
      objectId: data.snapshotKey,
      ...(mode === 'reset' ? { before: { removed } } : {}),
      after: { seed: data.seed, seeded },
      synthetic: true,
    });
    return { mode, auditEventId: event.id, removed, seeded };
  });
}
