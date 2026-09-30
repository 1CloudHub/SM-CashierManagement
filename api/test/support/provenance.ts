/**
 * Row dumps by provenance, for the demo-seed and P18 tests.
 *
 * - `dumpRealRows` captures every real (non-synthetic) row — including rows of
 *   flag-less tables that belong to a real parent — exactly as stored
 *   (timestamps included), so a before/after comparison proves a reset changed
 *   nothing real.
 * - `dumpSyntheticRows` captures every synthetic row minus row-maintenance
 *   timestamps, so two seeds can be compared for determinism.
 */
import type { Queryable } from '../../src/db/pool.js';

export type RowDump = Record<string, string[]>;

async function flaggedTables(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema = 'public' AND c.column_name = 'synthetic' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name`,
  );
  return rows.map((r) => r.table_name);
}

async function dumpQuery(db: Queryable, sql: string): Promise<string[]> {
  const { rows } = await db.query<{ r: unknown }>(sql);
  return rows.map((row) => JSON.stringify(row.r)).sort();
}

/** Every real row, verbatim. Audit events are limited to `seq <= maxAuditSeq` (later ones are appended). */
export async function dumpRealRows(db: Queryable, maxAuditSeq: number): Promise<RowDump> {
  const dump: RowDump = {};
  for (const table of await flaggedTables(db)) {
    const extra = table === 'audit_event' ? ` AND seq <= ${maxAuditSeq}` : '';
    dump[table] = await dumpQuery(db, `SELECT to_jsonb(t) AS r FROM ${table} t WHERE NOT synthetic${extra}`);
  }
  const linked: Record<string, string> = {
    rule_set: 'SELECT to_jsonb(t) AS r FROM rule_set t',
    role_assignment:
      'SELECT to_jsonb(t) AS r FROM role_assignment t JOIN app_user u ON u.id = t.user_id WHERE NOT u.synthetic',
    staff_training: 'SELECT to_jsonb(t) AS r FROM staff_training t JOIN staff s ON s.id = t.staff_id WHERE NOT s.synthetic',
    approval_step:
      'SELECT to_jsonb(t) AS r FROM approval_step t JOIN scenario s ON s.id = t.scenario_id WHERE NOT s.synthetic',
    travel_time: `SELECT to_jsonb(t) AS r FROM travel_time t
                    JOIN store s ON s.id = t.store_id JOIN barangay b ON b.psgc_code = t.barangay_code
                   WHERE NOT s.synthetic AND NOT b.synthetic`,
    passkey: 'SELECT to_jsonb(t) AS r FROM passkey t JOIN app_user u ON u.id = t.user_id WHERE NOT u.synthetic',
    notification_preference:
      'SELECT to_jsonb(t) AS r FROM notification_preference t JOIN app_user u ON u.id = t.user_id WHERE NOT u.synthetic',
    saved_view: 'SELECT to_jsonb(t) AS r FROM saved_view t JOIN app_user u ON u.id = t.user_id WHERE NOT u.synthetic',
  };
  for (const [name, sql] of Object.entries(linked)) dump[`linked:${name}`] = await dumpQuery(db, sql);
  return dump;
}

/** Every synthetic row (audit events excluded: they are append-only), without created_at/updated_at. */
export async function dumpSyntheticRows(db: Queryable): Promise<RowDump> {
  const dump: RowDump = {};
  for (const table of await flaggedTables(db)) {
    if (table === 'audit_event') continue;
    dump[table] = await dumpQuery(
      db,
      `SELECT to_jsonb(t) - 'created_at' - 'updated_at' AS r FROM ${table} t WHERE synthetic`,
    );
  }
  dump['linked:role_assignment'] = await dumpQuery(
    db,
    `SELECT to_jsonb(t) - 'id' - 'created_at' - 'updated_at' AS r
       FROM role_assignment t JOIN app_user u ON u.id = t.user_id WHERE u.synthetic`,
  );
  dump['linked:staff_training'] = await dumpQuery(
    db,
    'SELECT to_jsonb(t) AS r FROM staff_training t JOIN staff s ON s.id = t.staff_id WHERE s.synthetic',
  );
  dump['linked:approval_step'] = await dumpQuery(
    db,
    `SELECT to_jsonb(t) - 'created_at' AS r FROM approval_step t JOIN scenario s ON s.id = t.scenario_id WHERE s.synthetic`,
  );
  return dump;
}

export async function maxAuditSeq(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ n: number }>('SELECT coalesce(max(seq), 0)::int AS n FROM audit_event');
  return rows[0]?.n ?? 0;
}
