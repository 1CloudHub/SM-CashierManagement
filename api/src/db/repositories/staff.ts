/**
 * Staff records and availability (DOM-002 Staff, Availability; SCR-053).
 *
 * Lists are filtered to the active role's scope in SQL (P1). Staff names are
 * personal data (RA 10173): audit snapshots carry the staff ID and the
 * changed attributes, never the person's name or email. The weekly
 * availability grid lives in `staff.weekly_pattern.availability`; dated
 * exceptions are `staff_availability` rows of kind `unavailable`.
 */
import {
  CONTRACT_TYPE_BY_STAFF_TYPE,
  EMPLOYMENT_TYPE_BY_STAFF_TYPE,
  STAFF_LIST_LIMIT,
  dowToWeekday,
  normalizeAvailability,
  staffTypeOf,
  weekdayToDow,
  type EmploymentType,
  type IsoDate,
  type Scope,
  type StaffListQuery,
  type StaffRecord,
  type StaffType,
  type StaffUnavailableDate,
  type UnavailableSource,
  type WeeklyAvailability,
  type Weekday,
} from '@lanewise/shared';
import type pg from 'pg';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { queryMaybe, queryOne } from '../rows.js';
import { likePattern } from './search.js';

/** Store time zone: unavailable dates are whole local days. */
const STORE_TZ = 'Asia/Manila';

interface StaffRow extends pg.QueryResultRow {
  id: string;
  employee_no: string;
  name: string;
  employment_type: EmploymentType;
  weekly_pattern: Record<string, unknown>;
  store_id: string;
  store_name: string;
  department_id: string;
  department_name: string;
  preferred_rest_day: number | null;
  active: boolean;
  synthetic: boolean;
  unavailable: { id: string; date: string; reason: string | null; source: UnavailableSource }[] | null;
}

const STAFF_SELECT = `
  SELECT st.id, st.employee_no, st.name, st.employment_type, st.weekly_pattern, st.store_id, s.name AS store_name,
         st.department_id, d.name AS department_name, st.preferred_rest_day, st.active, st.synthetic,
         (SELECT json_agg(json_build_object(
                    'id', a.id,
                    'date', to_char((a.starts_at AT TIME ZONE '${STORE_TZ}')::date, 'YYYY-MM-DD'),
                    'reason', a.reason,
                    'source', a.source)
                  ORDER BY a.starts_at)
            FROM staff_availability a
           WHERE a.staff_id = st.id AND a.kind = 'unavailable' AND a.ends_at > now()) AS unavailable
    FROM staff st
    JOIN store s ON s.id = st.store_id
    JOIN department d ON d.id = st.department_id`;

function toRecord(row: StaffRow): StaffRecord {
  return {
    id: row.id,
    employeeNo: row.employee_no,
    name: row.name,
    type: staffTypeOf(row.employment_type, row.weekly_pattern.contractType),
    storeId: row.store_id,
    storeName: row.store_name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    preferredRestDay: row.preferred_rest_day === null ? null : dowToWeekday(row.preferred_rest_day),
    availability: normalizeAvailability(row.weekly_pattern.availability),
    unavailableDates: (row.unavailable ?? []).map((u) => ({ id: u.id, date: u.date, reason: u.reason, source: u.source })),
    active: row.active,
    synthetic: row.synthetic,
  };
}

/** Staff in `scope` matching `filter`, by name; at most `STAFF_LIST_LIMIT` (+ whether more matched). */
export async function listStaffInScope(
  db: Queryable,
  scope: Scope,
  filter: StaffListQuery,
): Promise<{ staff: StaffRecord[]; truncated: boolean }> {
  const values: unknown[] = [];
  const param = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const where: string[] = [];
  switch (scope.type) {
    case 'global':
      break;
    case 'region':
      where.push(`s.region_id = ANY(${param(scope.regionIds)}::uuid[])`);
      break;
    case 'store':
      where.push(`s.id = ANY(${param(scope.storeIds)}::uuid[])`);
      break;
    case 'self':
      return { staff: [], truncated: false };
  }
  if (filter.storeId !== undefined) where.push(`st.store_id = ${param(filter.storeId)}::uuid`);
  if (filter.departmentId !== undefined) where.push(`st.department_id = ${param(filter.departmentId)}::uuid`);
  if (filter.type !== undefined) {
    const employment = EMPLOYMENT_TYPE_BY_STAFF_TYPE[filter.type];
    where.push(`st.employment_type = ${param(employment)}`);
    if (employment === 'seasonal') {
      // Float vs seasonal: the contract type kept in the weekly pattern.
      const contract = param(CONTRACT_TYPE_BY_STAFF_TYPE.float);
      where.push(
        filter.type === 'float'
          ? `st.weekly_pattern->>'contractType' = ${contract}`
          : `coalesce(st.weekly_pattern->>'contractType', '') <> ${contract}`,
      );
    }
  }
  if (filter.q !== undefined && filter.q.length > 0) {
    const like = param(likePattern(filter.q));
    where.push(`(st.name ILIKE ${like} OR st.employee_no ILIKE ${like})`);
  }
  const { rows } = await db.query<StaffRow>(
    `${STAFF_SELECT}
      WHERE ${where.length > 0 ? where.join(' AND ') : 'true'}
      ORDER BY s.name, st.name, st.employee_no
      LIMIT ${param(STAFF_LIST_LIMIT + 1)}`,
    values,
  );
  return { staff: rows.slice(0, STAFF_LIST_LIMIT).map(toRecord), truncated: rows.length > STAFF_LIST_LIMIT };
}

export async function getStaff(db: Queryable, id: string): Promise<StaffRecord | null> {
  const row = await queryMaybe<StaffRow>(db, `${STAFF_SELECT} WHERE st.id = $1`, [id]);
  return row && toRecord(row);
}

/** What an audit snapshot may hold about a staff record: no name, no email (RA 10173). */
function snapshot(record: StaffRecord): Record<string, unknown> {
  return {
    employeeNo: record.employeeNo,
    type: record.type,
    storeId: record.storeId,
    departmentId: record.departmentId,
    preferredRestDay: record.preferredRestDay,
    active: record.active,
  };
}

export interface CreateStaffInput {
  readonly storeId: string;
  readonly departmentId: string;
  readonly employeeNo: string;
  readonly name: string;
  readonly type: StaffType;
  readonly preferredRestDay: Weekday | null;
}

/** Creates a staff record; its provenance is its store's (P18). One `staff.created` event. */
export async function createStaff(tx: AuditedTx, input: CreateStaffInput): Promise<StaffRecord> {
  const { id } = await queryOne<{ id: string } & pg.QueryResultRow>(
    tx,
    `INSERT INTO staff (store_id, department_id, employee_no, name, employment_type, preferred_rest_day, weekly_pattern, synthetic)
     SELECT $1, $2, $3, $4, $5, $6, jsonb_build_object('contractType', $7::text), s.synthetic FROM store s WHERE s.id = $1
     RETURNING id`,
    [
      input.storeId,
      input.departmentId,
      input.employeeNo,
      input.name,
      EMPLOYMENT_TYPE_BY_STAFF_TYPE[input.type],
      input.preferredRestDay === null ? null : weekdayToDow(input.preferredRestDay),
      CONTRACT_TYPE_BY_STAFF_TYPE[input.type],
    ],
  );
  const record = (await getStaff(tx, id)) as StaffRecord;
  await audit.record(tx, {
    action: 'create',
    event: 'staff.created',
    objectType: 'staff',
    objectId: id,
    after: snapshot(record),
    synthetic: record.synthetic,
  });
  return record;
}

export interface UpdateStaffInput {
  readonly name?: string;
  readonly type?: StaffType;
  readonly departmentId?: string;
  readonly preferredRestDay?: Weekday | null;
  readonly active?: boolean;
}

async function lockStaff(tx: AuditedTx, id: string): Promise<StaffRecord> {
  await queryOne(tx, 'SELECT id FROM staff WHERE id = $1 FOR UPDATE', [id]);
  return (await getStaff(tx, id)) as StaffRecord;
}

/** Edits a staff record; one `staff.updated` event (a name change is flagged, not copied). */
export async function updateStaff(tx: AuditedTx, id: string, input: UpdateStaffInput): Promise<StaffRecord> {
  const before = await lockStaff(tx, id);
  const restChange = input.preferredRestDay !== undefined;
  await tx.query(
    `UPDATE staff
        SET name = coalesce($2, name),
            employment_type = coalesce($3, employment_type),
            weekly_pattern = CASE WHEN $4::text IS NULL THEN weekly_pattern
                                  ELSE weekly_pattern || jsonb_build_object('contractType', $4::text) END,
            department_id = coalesce($5::uuid, department_id),
            preferred_rest_day = CASE WHEN $6 THEN $7::smallint ELSE preferred_rest_day END,
            active = coalesce($8, active)
      WHERE id = $1`,
    [
      id,
      input.name ?? null,
      input.type === undefined ? null : EMPLOYMENT_TYPE_BY_STAFF_TYPE[input.type],
      input.type === undefined ? null : CONTRACT_TYPE_BY_STAFF_TYPE[input.type],
      input.departmentId ?? null,
      restChange,
      restChange && input.preferredRestDay !== null && input.preferredRestDay !== undefined
        ? weekdayToDow(input.preferredRestDay)
        : null,
      input.active ?? null,
    ],
  );
  const after = (await getStaff(tx, id)) as StaffRecord;
  await audit.record(tx, {
    action: 'edit',
    event: 'staff.updated',
    objectType: 'staff',
    objectId: id,
    before: snapshot(before),
    after: { ...snapshot(after), nameChanged: before.name !== after.name },
    synthetic: after.synthetic,
  });
  return after;
}

/** Replaces the weekly availability grid; one `staff.availability_updated` event. */
export async function setAvailability(
  tx: AuditedTx,
  id: string,
  availability: WeeklyAvailability,
): Promise<StaffRecord> {
  const before = await lockStaff(tx, id);
  await tx.query(
    `UPDATE staff SET weekly_pattern = weekly_pattern || jsonb_build_object('availability', $2::jsonb) WHERE id = $1`,
    [id, JSON.stringify(availability)],
  );
  const after = (await getStaff(tx, id)) as StaffRecord;
  await audit.record(tx, {
    action: 'edit',
    event: 'staff.availability_updated',
    objectType: 'staff',
    objectId: id,
    before: { availability: before.availability },
    after: { availability: after.availability },
    synthetic: after.synthetic,
  });
  return after;
}

/** Adds a whole-day unavailable date (store local time); one `staff.unavailable_date_added` event. */
export async function addUnavailableDate(
  tx: AuditedTx,
  staffId: string,
  input: { date: IsoDate; reason: string | null },
): Promise<StaffUnavailableDate> {
  const row = await queryOne<{ id: string; date: string; reason: string | null; source: UnavailableSource; synthetic: boolean } & pg.QueryResultRow>(
    tx,
    `INSERT INTO staff_availability (staff_id, kind, starts_at, ends_at, reason, source, created_by, synthetic)
     SELECT st.id, 'unavailable',
            ($2::date)::timestamp AT TIME ZONE '${STORE_TZ}',
            ($2::date + 1)::timestamp AT TIME ZONE '${STORE_TZ}',
            $3, 'manual', $4, st.synthetic
       FROM staff st WHERE st.id = $1
     RETURNING id, to_char((starts_at AT TIME ZONE '${STORE_TZ}')::date, 'YYYY-MM-DD') AS date, reason, source, synthetic`,
    [staffId, input.date, input.reason, tx.actor.userId],
  );
  const entry: StaffUnavailableDate = { id: row.id, date: row.date, reason: row.reason, source: row.source };
  await audit.record(tx, {
    action: 'edit',
    event: 'staff.unavailable_date_added',
    objectType: 'staff',
    objectId: staffId,
    after: { unavailableDate: entry.date, entryId: entry.id },
    synthetic: row.synthetic,
  });
  return entry;
}

/** Whether the staff record already has an unavailable entry on `date`. */
export async function hasUnavailableDate(db: Queryable, staffId: string, date: IsoDate): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM staff_availability
      WHERE staff_id = $1 AND kind = 'unavailable'
        AND starts_at < ($2::date + 1)::timestamp AT TIME ZONE '${STORE_TZ}'
        AND ends_at > ($2::date)::timestamp AT TIME ZONE '${STORE_TZ}'`,
    [staffId, date],
  );
  return rows.length > 0;
}

export async function getUnavailableEntry(
  db: Queryable,
  staffId: string,
  entryId: string,
): Promise<{ source: UnavailableSource } | null> {
  return queryMaybe<{ source: UnavailableSource } & pg.QueryResultRow>(
    db,
    `SELECT source FROM staff_availability WHERE id = $1 AND staff_id = $2 AND kind = 'unavailable'`,
    [entryId, staffId],
  );
}

/** Removes a manually added unavailable date; one `staff.unavailable_date_removed` event. */
export async function removeUnavailableDate(tx: AuditedTx, staffId: string, entryId: string): Promise<void> {
  const row = await queryOne<{ date: string; synthetic: boolean } & pg.QueryResultRow>(
    tx,
    `DELETE FROM staff_availability
      WHERE id = $1 AND staff_id = $2 AND kind = 'unavailable' AND source = 'manual'
      RETURNING to_char((starts_at AT TIME ZONE '${STORE_TZ}')::date, 'YYYY-MM-DD') AS date, synthetic`,
    [entryId, staffId],
  );
  await audit.record(tx, {
    action: 'edit',
    event: 'staff.unavailable_date_removed',
    objectType: 'staff',
    objectId: staffId,
    before: { unavailableDate: row.date, entryId },
    synthetic: row.synthetic,
  });
}
