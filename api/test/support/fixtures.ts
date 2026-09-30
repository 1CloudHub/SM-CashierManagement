/**
 * Raw-SQL fixtures for schema tests. They bypass the data-access layer on
 * purpose, so constraint tests exercise the database itself.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { withTransaction, type Queryable } from '../../src/db/pool.js';

const uniq = (): string => randomBytes(4).toString('hex');

async function one<T extends Record<string, unknown>>(db: Queryable, sql: string, values: unknown[]): Promise<T> {
  const { rows } = await db.query<T>(sql, values);
  const row = rows[0];
  if (!row) throw new Error('fixture insert returned no row');
  return row;
}

export async function insertUser(db: Queryable, overrides: { email?: string; synthetic?: boolean } = {}): Promise<string> {
  const email = overrides.email ?? `user.${uniq()}@smretail.com`;
  const row = await one<{ id: string }>(
    db,
    'INSERT INTO app_user (email, name, synthetic) VALUES ($1, $2, $3) RETURNING id',
    [email, 'Test User', overrides.synthetic ?? false],
  );
  return row.id;
}

export async function insertRegion(db: Queryable, synthetic = false): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    'INSERT INTO region (code, name, synthetic) VALUES ($1, $2, $3) RETURNING id',
    [`R-${uniq()}`, 'Metro Manila', synthetic],
  );
  return row.id;
}

export async function insertStore(db: Queryable, synthetic = false): Promise<string> {
  const regionId = await insertRegion(db, synthetic);
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO store (code, name, format, region_id, synthetic)
     VALUES ($1, 'SM Test', 'sm_supermarket', $2, $3) RETURNING id`,
    [`S-${uniq()}`, regionId, synthetic],
  );
  return row.id;
}

export async function insertDepartment(db: Queryable, storeId: string, synthetic = false): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO department (store_id, name, installed_lanes, default_handle_time_min, trading_open, trading_close, synthetic)
     VALUES ($1, $2, 12, 2.5, '10:00', '22:00', $3) RETURNING id`,
    [storeId, `Dept ${uniq()}`, synthetic],
  );
  return row.id;
}

export async function insertStaff(
  db: Queryable,
  storeId: string,
  departmentId: string,
  synthetic = false,
): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO staff (store_id, department_id, employee_no, name, employment_type, synthetic)
     VALUES ($1, $2, $3, 'Ana Reyes', 'regular', $4) RETURNING id`,
    [storeId, departmentId, `E-${uniq()}`, synthetic],
  );
  return row.id;
}

/** Inserts a new current snapshot, superseding the previous current one of the same type/provenance. */
export async function insertSnapshot(
  pool: pg.Pool,
  options: { type?: 'pos' | 'master' | 'staff'; synthetic?: boolean } = {},
): Promise<string> {
  const type = options.type ?? 'pos';
  const synthetic = options.synthetic ?? false;
  const id = randomUUID();
  await withTransaction(pool, async (tx) => {
    // superseded_by is a deferred FK, so the successor can be inserted after.
    await tx.query(
      `UPDATE dataset_snapshot SET superseded_at = now(), superseded_by = $3
        WHERE dataset_type = $1 AND synthetic = $2 AND superseded_at IS NULL`,
      [type, synthetic, id],
    );
    await tx.query(
      `INSERT INTO dataset_snapshot (id, dataset_type, covers_from, covers_to, row_count, synthetic)
       VALUES ($1, $2, '2025-12-01', '2025-12-31', 10, $3)`,
      [id, type, synthetic],
    );
  });
  return id;
}

export async function insertScenario(
  db: Queryable,
  ownerId: string,
  options: { season?: string; synthetic?: boolean; stale?: boolean } = {},
): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO scenario (name, season, owner_id, settings, synthetic, stale, stale_reason)
     VALUES ('Plan', $1, $2, '{"serviceLevel":0.9}', $3, $4, CASE WHEN $4 THEN 'snapshot superseded' END)
     RETURNING id`,
    [options.season ?? `season-${uniq()}`, ownerId, options.synthetic ?? false, options.stale ?? false],
  );
  return row.id;
}

/** A published roster with one shift assigned to a staff member. */
export async function insertPublishedRosterWithShift(
  db: Queryable,
): Promise<{ storeId: string; departmentId: string; staffId: string; rosterId: string; shiftId: string }> {
  const storeId = await insertStore(db);
  const departmentId = await insertDepartment(db, storeId);
  const staffId = await insertStaff(db, storeId, departmentId);
  const roster = await one<{ id: string }>(
    db,
    `INSERT INTO roster (store_id, department_id, period_start, period_end, status, published_at)
     VALUES ($1, $2, '2026-12-14', '2026-12-20', 'published', now()) RETURNING id`,
    [storeId, departmentId],
  );
  const shift = await one<{ id: string }>(
    db,
    `INSERT INTO shift (roster_id, staff_id, department_id, starts_at, ends_at)
     VALUES ($1, $2, $3, '2026-12-19T02:00:00Z', '2026-12-19T11:00:00Z') RETURNING id`,
    [roster.id, staffId, departmentId],
  );
  return { storeId, departmentId, staffId, rosterId: roster.id, shiftId: shift.id };
}
