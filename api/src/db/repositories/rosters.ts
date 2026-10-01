/**
 * Published rosters and store-manager overrides (task 13.4; Req 6.6/6.7, 7;
 * P7, P14).
 *
 * Reads build the SCR-022 roster (shifts with ✎ markers, the roster's
 * cashiers, recorded overrides and the labor-rule checks). `recordOverride`
 * applies one change to a published roster inside the caller's audited
 * transaction: it locks the shift and the affected cashiers, re-runs the
 * labor rules (`checkOverride`), refuses a block and a reason-less warning
 * (`overrideSaveDecision`), changes the shift, writes the ShiftOverride,
 * notifies the affected cashiers (and Planners/HR on a rule override,
 * Store Managers/Planners when a shift is left open) and records exactly one
 * audit event.
 */
import {
  DEMO_LABOR_RULES,
  addDays,
  checkLaborRules,
  weekStart,
  type ContractType,
  type LaborRuleVersion,
  type StaffMember,
} from '@lanewise/domain';
import {
  SHIFT_ACTIVITY_KINDS,
  overrideSaveDecision,
  rankReplacements,
  shiftLocalTimes,
  type EmergencyOffReason,
  type LaborBreach,
  type OverrideCheck,
  type ReplacementCandidate,
  type RosterActivity,
  type RosterDetail,
  type RosterShiftDto,
  type RosterStaffMember,
  type RosterStatus,
  type RosterSummary,
  type ShiftOverrideDto,
  type ShiftOverrideRequest,
  type ShiftOverrideType,
} from '@lanewise/shared';
import type pg from 'pg';
import { ApiError, errors } from '../../http/errors.js';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { queryMaybe } from '../rows.js';
import {
  OverrideInputError,
  affectedStaff,
  checkOverride,
  planOverride,
  toAssignedShift,
  toBreach,
  type PlannedOverride,
  type StoredShift,
} from '../../rosters/overrides.js';

/** Days either side of a change whose shifts the labor rules look at (6-day runs + weekly hours). */
const WINDOW_DAYS = 14;

const CONTRACT_BY_EMPLOYMENT: Readonly<Record<string, ContractType>> = {
  regular: 'FT',
  part_time: 'PT',
  // Seasonal hires float across departments for the peak.
  seasonal: 'FLOAT',
};

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface RosterRow extends pg.QueryResultRow {
  id: string;
  store_id: string;
  store_name: string;
  region_id: string;
  department_id: string;
  department_name: string;
  period_start: string;
  period_end: string;
  status: RosterStatus;
  published_at: Date | null;
  synthetic: boolean;
  override_count: number;
}

const ROSTER_SELECT = `
  SELECT r.id, r.store_id, st.name AS store_name, st.region_id, r.department_id, d.name AS department_name,
         r.period_start, r.period_end, r.status, r.published_at, r.synthetic,
         (SELECT count(*) FROM shift_override o WHERE o.roster_id = r.id)::int AS override_count
    FROM roster r
    JOIN store st ON st.id = r.store_id
    JOIN department d ON d.id = r.department_id`;

export interface RosterRecord extends RosterSummary {
  readonly regionId: string;
}

function toRoster(r: RosterRow): RosterRecord {
  return {
    id: r.id,
    storeId: r.store_id,
    storeName: r.store_name,
    regionId: r.region_id,
    departmentId: r.department_id,
    departmentName: r.department_name,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status,
    publishedAt: r.published_at?.toISOString() ?? null,
    overrideCount: r.override_count,
    synthetic: r.synthetic,
  };
}

function summary(r: RosterRecord): RosterSummary {
  const { regionId, ...rest } = r;
  void regionId;
  return rest;
}

interface ShiftRow extends pg.QueryResultRow {
  id: string;
  roster_id: string;
  staff_id: string | null;
  department_id: string;
  starts_at: Date;
  ends_at: Date;
  activities: unknown;
  status: 'scheduled' | 'cancelled';
}

const SHIFT_COLUMNS = 'sh.id, sh.roster_id, sh.staff_id, sh.department_id, sh.starts_at, sh.ends_at, sh.activities, sh.status';

/** Stored activities, keeping only well-formed segments. */
function readActivities(value: unknown): RosterActivity[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a: unknown) => {
    if (typeof a !== 'object' || a === null) return [];
    const { kind, startMin, endMin } = a as Record<string, unknown>;
    return (SHIFT_ACTIVITY_KINDS as readonly unknown[]).includes(kind) && typeof startMin === 'number' && typeof endMin === 'number'
      ? [{ kind: kind as RosterActivity['kind'], startMin, endMin }]
      : [];
  });
}

function toStoredShift(r: ShiftRow): StoredShift {
  return {
    id: r.id,
    rosterId: r.roster_id,
    staffId: r.staff_id,
    departmentId: r.department_id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    activities: readActivities(r.activities),
    status: r.status,
  };
}

export interface StaffRow extends pg.QueryResultRow {
  id: string;
  store_id: string;
  department_id: string;
  employee_no: string;
  name: string;
  employment_type: string;
  preferred_rest_day: number | null;
  user_id: string | null;
  active: boolean;
  synthetic: boolean;
  trained: string[];
}

const STAFF_SELECT = `
  SELECT s.id, s.store_id, s.department_id, s.employee_no, s.name, s.employment_type, s.preferred_rest_day,
         s.user_id, s.active, s.synthetic,
         coalesce(array(SELECT t.department_id::text FROM staff_training t WHERE t.staff_id = s.id ORDER BY 1), '{}') AS trained
    FROM staff s`;

export const contractOf = (s: StaffRow): ContractType => CONTRACT_BY_EMPLOYMENT[s.employment_type] ?? 'FT';

export function toDomainStaff(s: StaffRow): StaffMember {
  return {
    id: s.id,
    name: s.name,
    storeId: s.store_id,
    departmentId: s.department_id,
    contractType: contractOf(s),
    preferredRestDay: s.preferred_rest_day ?? 0,
    unavailableDates: [],
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function listRosters(db: Queryable, storeId: string, statuses: readonly RosterStatus[]): Promise<RosterSummary[]> {
  const { rows } = await db.query<RosterRow>(
    `${ROSTER_SELECT} WHERE r.store_id = $1 AND r.status = ANY($2::text[])
      ORDER BY r.period_start DESC, d.name, r.id`,
    [storeId, statuses],
  );
  return rows.map((r) => summary(toRoster(r)));
}

/** The roster if it belongs to `storeId` (a roster of another store is the same 404 as a missing one). */
export async function getRoster(db: Queryable, storeId: string, rosterId: string, lock = false): Promise<RosterRecord | null> {
  const row = await queryMaybe<RosterRow>(
    db,
    `${ROSTER_SELECT} WHERE r.id = $1 AND r.store_id = $2${lock ? ' FOR UPDATE OF r' : ''}`,
    [rosterId, storeId],
  );
  return row ? toRoster(row) : null;
}

/** Labor rules for a provenance: the published `labor` rule version, else the documented demo defaults. */
export async function laborRulesFor(db: Queryable, synthetic: boolean): Promise<LaborRuleVersion> {
  const row = await queryMaybe<{ id: string; effective_from: string; payload: Record<string, unknown> }>(
    db,
    `SELECT v.id, v.effective_from, v.payload FROM rule_version v JOIN rule_set rs ON rs.id = v.rule_set_id
      WHERE rs.rule_set_type = 'labor' AND v.synthetic = $1 AND v.status = 'published'
      ORDER BY v.effective_from DESC, v.version DESC LIMIT 1`,
    [synthetic],
  );
  return row ? { ...DEMO_LABOR_RULES, ...row.payload, id: row.id, effectiveFrom: row.effective_from } : DEMO_LABOR_RULES;
}

/** Scheduled shifts on published rosters for `staffIds` between two local dates (inclusive, ±1 day for overnight). */
export async function staffShifts(db: Queryable, staffIds: readonly string[], from: string, to: string): Promise<StoredShift[]> {
  if (staffIds.length === 0) return [];
  const { rows } = await db.query<ShiftRow>(
    `SELECT ${SHIFT_COLUMNS} FROM shift sh JOIN roster r ON r.id = sh.roster_id
      WHERE sh.staff_id = ANY($1::uuid[]) AND sh.status = 'scheduled' AND r.status = 'published'
        AND sh.starts_at >= ($2::date - 1)::timestamp AT TIME ZONE 'Asia/Manila'
        AND sh.starts_at < ($3::date + 2)::timestamp AT TIME ZONE 'Asia/Manila'
      ORDER BY sh.starts_at, sh.id`,
    [staffIds, from, to],
  );
  return rows.map(toStoredShift);
}

export async function loadStaff(db: Queryable, ids: readonly string[], lock = false): Promise<StaffRow[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<StaffRow>(
    `${STAFF_SELECT} WHERE s.id = ANY($1::uuid[]) ORDER BY s.id${lock ? ' FOR UPDATE OF s' : ''}`,
    [ids],
  );
  return rows;
}

async function overridesOf(db: Queryable, rosterId: string): Promise<ShiftOverrideDto[]> {
  const { rows } = await db.query<{
    id: string;
    shift_id: string;
    override_type: ShiftOverrideType;
    from_staff_id: string | null;
    to_staff_id: string | null;
    reason: string | null;
    off_reason: EmergencyOffReason | null;
    rule_breaches: LaborBreach[];
    by_name: string;
    created_at: Date;
  }>(
    `SELECT o.id, o.shift_id, o.override_type, o.from_staff_id, o.to_staff_id, o.reason, o.off_reason, o.rule_breaches,
            u.name AS by_name, o.created_at
       FROM shift_override o JOIN app_user u ON u.id = o.created_by
      WHERE o.roster_id = $1 ORDER BY o.created_at, o.id`,
    [rosterId],
  );
  return rows.map((r) => ({
    id: r.id,
    shiftId: r.shift_id,
    type: r.override_type,
    fromStaffId: r.from_staff_id,
    toStaffId: r.to_staff_id,
    reason: r.reason,
    offReason: r.off_reason,
    ruleBreaches: r.rule_breaches,
    by: r.by_name,
    at: r.created_at.toISOString(),
  }));
}

function toStaffMember(
  s: StaffRow,
  rosterStoreId: string,
  storeNames: ReadonlyMap<string, string>,
  travel: ReadonlyMap<string, number>,
): RosterStaffMember {
  const borrowed = s.store_id !== rosterStoreId;
  return {
    id: s.id,
    employeeNo: s.employee_no,
    name: s.name,
    contract: contractOf(s),
    departmentId: s.department_id,
    trainedDepartmentIds: s.trained,
    borrowedFrom: borrowed ? (storeNames.get(s.store_id) ?? s.store_id) : null,
    ...(borrowed ? { borrowedTravelMin: travel.get(s.id) ?? null } : {}),
  };
}

/**
 * Travel minutes of cashiers who came to this roster through an accepted
 * offer (home barangay → store) or an applied borrow (store → store), latest
 * first (task 17; Req 14.3).
 */
async function borrowedTravel(db: Queryable, roster: RosterRecord): Promise<Map<string, number>> {
  const { rows } = await db.query<{ staff_id: string; travel_min: string | null }>(
    `SELECT staff_id, travel_min::text AS travel_min FROM (
        SELECT o.staff_id, o.travel_min, o.responded_at AS at
          FROM shift_offer o JOIN shift sh ON sh.id = o.shift_id
         WHERE sh.roster_id = $1 AND o.status = 'accepted'
        UNION ALL
        SELECT ts.staff_id, t.travel_min, t.decided_at AS at
          FROM transfer_request_staff ts JOIN transfer_request t ON t.id = ts.transfer_request_id
          JOIN shift sh ON sh.id = ts.shift_id
         WHERE sh.roster_id = $1 AND t.status IN ('approved', 'overridden')
      ) x WHERE travel_min IS NOT NULL ORDER BY at DESC`,
    [roster.id],
  );
  const out = new Map<string, number>();
  for (const r of rows) if (!out.has(r.staff_id) && r.travel_min !== null) out.set(r.staff_id, Number(r.travel_min));
  return out;
}

/** The SCR-022 roster: shifts with ✎ markers, cashiers, overrides and the labor-rule checks for the period. */
export async function rosterDetail(db: Queryable, roster: RosterRecord, canOverride: boolean): Promise<RosterDetail> {
  const [{ rows: shiftRows }, { rows: departments }, overrides] = await Promise.all([
    db.query<ShiftRow>(`SELECT ${SHIFT_COLUMNS} FROM shift sh WHERE sh.roster_id = $1 ORDER BY sh.starts_at, sh.id`, [roster.id]),
    db.query<{ id: string; name: string }>(
      `SELECT id, name FROM department WHERE store_id = $1 AND active ORDER BY name, id`,
      [roster.storeId],
    ),
    overridesOf(db, roster.id),
  ]);
  const shifts = shiftRows.map(toStoredShift);
  const { rows: homeStaff } = await db.query<{ id: string }>(
    `SELECT id FROM staff WHERE store_id = $1 AND department_id = $2 AND active AND synthetic = $3`,
    [roster.storeId, roster.departmentId, roster.synthetic],
  );
  const staffIds = [...new Set([...homeStaff.map((s) => s.id), ...shifts.flatMap((s) => (s.staffId ? [s.staffId] : []))])];
  const staffRows = await loadStaff(db, staffIds);
  const { rows: stores } = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM store WHERE id = ANY($1::uuid[])`,
    [[...new Set(staffRows.map((s) => s.store_id))]],
  );
  const storeNames = new Map(stores.map((s) => [s.id, s.name]));
  const travel = staffRows.some((s) => s.store_id !== roster.storeId) ? await borrowedTravel(db, roster) : new Map<string, number>();

  const latest = new Map<string, ShiftOverrideDto>();
  for (const o of overrides) latest.set(o.shiftId, o);

  // Labor checks (Req 6.7) over the period, with the cashiers' shifts on other rosters around it.
  const rules = await laborRulesFor(db, roster.synthetic);
  const around = await staffShifts(db, staffIds, addDays(roster.periodStart, -WINDOW_DAYS), addDays(roster.periodEnd, WINDOW_DAYS));
  const contract = new Map(staffRows.map((s) => [s.id, contractOf(s)]));
  const laborChecks = checkLaborRules(
    around.flatMap((s) => (s.staffId ? [toAssignedShift({ ...s, staffId: s.staffId }, contract.get(s.staffId) ?? 'FT')] : [])),
    rules,
    staffRows.map(toDomainStaff),
  )
    .filter((v) => v.date >= addDays(roster.periodStart, -6) && v.date <= roster.periodEnd)
    .map(toBreach);

  return {
    roster: summary(roster),
    departments,
    staff: staffRows
      .map((s) => toStaffMember(s, roster.storeId, storeNames, travel))
      .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo) || a.id.localeCompare(b.id)),
    shifts: shifts.map((s): RosterShiftDto => {
      const edit = latest.get(s.id);
      return {
        id: s.id,
        staffId: s.staffId,
        departmentId: s.departmentId,
        ...shiftLocalTimes(s.startsAt, s.endsAt),
        activities: s.activities,
        status: s.status,
        edited: edit ? { type: edit.type, by: edit.by, at: edit.at } : null,
      };
    }),
    overrides,
    laborChecks,
    canOverride: canOverride && roster.status === 'published',
  };
}

// ---------------------------------------------------------------------------
// Checking and recording overrides
// ---------------------------------------------------------------------------

export class RosterStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RosterStateError';
  }
}

interface PreparedChange {
  readonly plan: PlannedOverride;
  readonly check: OverrideCheck;
  readonly staff: readonly StaffRow[];
}

function inputError(path: string, message: string): ApiError {
  return errors.validationFailed('This change cannot be made.', [{ path: `body.${path}`, message }]);
}

/**
 * Loads what a change needs, validates the cashiers and runs the labor
 * rules. With `lock`, the shift and the affected cashiers are locked so two
 * concurrent changes to the same people are checked one after the other.
 */
async function prepare(db: Queryable, roster: RosterRecord, request: ShiftOverrideRequest, lock: boolean): Promise<PreparedChange> {
  if (roster.status !== 'published') throw new RosterStateError('Only a published roster takes store-manager overrides.');
  let shift: StoredShift | null = null;
  if (request.type !== 'add') {
    const row = await queryMaybe<ShiftRow>(
      db,
      `SELECT ${SHIFT_COLUMNS} FROM shift sh WHERE sh.id = $1 AND sh.roster_id = $2${lock ? ' FOR UPDATE' : ''}`,
      [UUID.test(request.shiftId) ? request.shiftId : '00000000-0000-0000-0000-000000000000', roster.id],
    );
    if (!row) throw inputError('shiftId', 'Pick a shift on this roster.');
    shift = toStoredShift(row);
    if (shift.status !== 'scheduled') throw new RosterStateError('This shift was removed.');
  } else {
    const dept = await queryMaybe(db, `SELECT id FROM department WHERE id = $1 AND store_id = $2`, [
      UUID.test(request.departmentId) ? request.departmentId : '00000000-0000-0000-0000-000000000000',
      roster.storeId,
    ]);
    if (!dept) throw inputError('departmentId', 'Pick a department of this store.');
  }

  let plan: PlannedOverride;
  try {
    plan = planOverride(request, shift);
  } catch (error) {
    if (error instanceof OverrideInputError) throw inputError(error.path, error.message);
    throw error;
  }
  const after = plan.after;
  if (after) {
    const local = shiftLocalTimes(after.startsAt, after.endsAt);
    if (local.date < roster.periodStart || local.date > roster.periodEnd) {
      throw inputError('date', `Keep the shift inside the roster period (${roster.periodStart} – ${roster.periodEnd}).`);
    }
  }

  const ids = affectedStaff(plan);
  for (const id of ids) if (!UUID.test(id)) throw inputError(newStaffPath(request), 'Pick a cashier of this store.');
  const staff = await loadStaff(db, ids, lock);
  const incoming = plan.toStaffId !== null && plan.toStaffId !== plan.fromStaffId ? plan.toStaffId : null;
  if (incoming) {
    const s = staff.find((x) => x.id === incoming);
    const departmentId = after?.departmentId ?? '';
    // Cross-store borrowing has its own approval flow (Req 14); overrides stay inside the store.
    if (!s || !s.active || s.store_id !== roster.storeId || s.synthetic !== roster.synthetic) {
      throw inputError(newStaffPath(request), 'Pick an active cashier of this store.');
    }
    if (s.department_id !== departmentId && !s.trained.includes(departmentId)) {
      throw inputError(newStaffPath(request), 'This cashier is not trained for the shift’s department.');
    }
  }

  const anchor = after ?? shift;
  if (!anchor) throw errors.notFound();
  const window = shiftLocalTimes(anchor.startsAt, anchor.endsAt).date;
  const shifts = await staffShifts(db, ids, addDays(window, -WINDOW_DAYS), addDays(window, WINDOW_DAYS));
  const rules = await laborRulesFor(db, roster.synthetic);
  const check = checkOverride(plan, { shifts, staff: staff.map(toDomainStaff), rules });
  return { plan, check, staff };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function newStaffPath(request: ShiftOverrideRequest): string {
  switch (request.type) {
    case 'emergency_off':
      return 'replacementStaffId';
    case 'reassign':
      return 'toStaffId';
    case 'add':
      return 'staffId';
    default:
      return 'shiftId';
  }
}

/** The live rule check for a proposed change; writes nothing. */
export async function checkRosterOverride(db: Queryable, roster: RosterRecord, request: ShiftOverrideRequest): Promise<OverrideCheck> {
  return (await prepare(db, roster, request, false)).check;
}

/** Ranked replacements for a shift (Req 7.5): trained cashiers of the store, each with its rule check. */
export async function replacementCandidates(db: Queryable, roster: RosterRecord, shiftId: string): Promise<ReplacementCandidate[]> {
  const row = await queryMaybe<ShiftRow>(db, `SELECT ${SHIFT_COLUMNS} FROM shift sh WHERE sh.id = $1 AND sh.roster_id = $2`, [
    shiftId,
    roster.id,
  ]);
  if (!row) throw errors.notFound();
  const shift = toStoredShift(row);
  const { rows: pool } = await db.query<StaffRow>(
    `${STAFF_SELECT}
      WHERE s.store_id = $1 AND s.active AND s.synthetic = $2 AND s.id IS DISTINCT FROM $3::uuid
        AND (s.department_id = $4 OR EXISTS (SELECT 1 FROM staff_training t WHERE t.staff_id = s.id AND t.department_id = $4))
      ORDER BY s.employee_no, s.id`,
    [roster.storeId, roster.synthetic, shift.staffId, shift.departmentId],
  );
  const date = shiftLocalTimes(shift.startsAt, shift.endsAt).date;
  const ids = pool.map((s) => s.id);
  const shifts = await staffShifts(db, ids, addDays(date, -WINDOW_DAYS), addDays(date, WINDOW_DAYS));
  const rules = await laborRulesFor(db, roster.synthetic);
  const staff = pool.map(toDomainStaff);
  const week = weekStart(date);
  return rankReplacements(
    pool.map((s) => {
      const plan: PlannedOverride = { fromStaffId: null, toStaffId: s.id, before: null, after: { ...shift, staffId: s.id } };
      const mine = shifts.filter((x) => x.staffId === s.id);
      const weekHours = mine
        .map((x) => toAssignedShift({ ...x, staffId: s.id }, contractOf(s)))
        .filter((x) => weekStart(x.date) === week)
        .reduce((h, x) => h + x.paidHours, 0);
      return {
        staffId: s.id,
        employeeNo: s.employee_no,
        name: s.name,
        contract: contractOf(s),
        sameDepartment: s.department_id === shift.departmentId,
        weekHours,
        check: checkOverride(plan, { shifts: mine, staff, rules }),
      };
    }),
  );
}

export interface RecordedOverride {
  readonly overrideId: string;
  readonly shiftId: string;
  readonly check: OverrideCheck;
}

/** Roles notified when a change overrides a labor rule, and when a shift is left open (design.md › Notifications). */
const RULE_OVERRIDE_NOTIFY_ROLES = ['PLN', 'HR'] as const;
const UNFILLED_NOTIFY_ROLES = ['STM', 'PLN'] as const;

export async function notifyInScope(
  tx: AuditedTx,
  roster: Pick<RosterRecord, 'storeId' | 'regionId' | 'synthetic'>,
  roles: readonly string[],
  event: string,
  objectId: string,
  severity: 'info' | 'warning',
  params: Record<string, unknown>,
): Promise<string[]> {
  const { rows } = await tx.query<{ user_id: string }>(
    `INSERT INTO notification (user_id, event, object_type, object_id, severity, params, synthetic)
     SELECT DISTINCT ra.user_id, $1, 'roster', $2, $3, $4::jsonb, $5::boolean
       FROM role_assignment ra JOIN app_user u ON u.id = ra.user_id
      WHERE u.status = 'active' AND ra.role = ANY($6::text[]) AND ra.user_id <> $9
        AND (ra.scope_type = 'global'
             OR (ra.scope_type = 'region' AND $7::uuid = ANY(ra.scope_ids))
             OR (ra.scope_type = 'store' AND $8::uuid = ANY(ra.scope_ids)))
     RETURNING user_id`,
    [event, objectId, severity, JSON.stringify(params), roster.synthetic, roles, roster.regionId, roster.storeId, tx.actor.userId],
  );
  return rows.map((r) => r.user_id);
}

function shiftState(s: { staffId: string | null; departmentId: string; startsAt: Date; endsAt: Date; activities: readonly RosterActivity[] }) {
  return {
    staffId: s.staffId,
    departmentId: s.departmentId,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    activities: s.activities,
  };
}

/**
 * Records one store-manager change on a published roster (P14). Must run in
 * an audited transaction: exactly one audit event is written, and any refusal
 * rolls everything back.
 */
export async function recordOverride(tx: AuditedTx, storeId: string, rosterId: string, request: ShiftOverrideRequest): Promise<RecordedOverride> {
  const roster = await getRoster(tx, storeId, rosterId, true);
  if (!roster) throw errors.notFound();
  const { plan, check, staff } = await prepare(tx, roster, request, true);
  const decision = overrideSaveDecision(check, request.reason);
  if (!decision.ok) {
    const breaches = decision.code === 'blocked' ? (check.blocking.length > 0 ? check.blocking : check.breaches) : check.breaches;
    const details = breaches.map((b) => ({ path: `breaches.${b.rule}`, message: b.message }));
    if (decision.code === 'blocked') {
      throw new ApiError('conflict', 'This change can’t be saved: it breaks a labor rule that cannot be overridden.', { details });
    }
    throw errors.validationFailed('This change breaks a labor rule. Give a reason to override it.', [
      { path: 'body.reason', message: 'A reason is required to override a labor rule.' },
      ...details,
    ]);
  }

  // Apply the change to the shift.
  let shiftId: string;
  const after = plan.after;
  if (request.type === 'add' && after) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO shift (roster_id, staff_id, department_id, starts_at, ends_at, activities, synthetic)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id`,
      [roster.id, after.staffId, after.departmentId, after.startsAt, after.endsAt, JSON.stringify(after.activities), roster.synthetic],
    );
    shiftId = rows[0]?.id ?? '';
  } else {
    const before = plan.before;
    if (!before) throw errors.notFound();
    shiftId = before.id;
    if (after) {
      await tx.query(`UPDATE shift SET staff_id = $2, starts_at = $3, ends_at = $4, activities = $5::jsonb WHERE id = $1`, [
        shiftId,
        after.staffId,
        after.startsAt,
        after.endsAt,
        JSON.stringify(after.activities),
      ]);
    } else {
      await tx.query(`UPDATE shift SET status = 'cancelled' WHERE id = $1`, [shiftId]);
    }
  }

  // An emergency off also marks the cashier unavailable for the shift (no re-offer of the same hours).
  if (request.type === 'emergency_off' && plan.before && plan.fromStaffId) {
    await tx.query(
      `INSERT INTO staff_availability (staff_id, kind, starts_at, ends_at, reason, source, created_by, synthetic)
       VALUES ($1, 'unavailable', $2, $3, $4, 'manual', $5, $6)`,
      [plan.fromStaffId, plan.before.startsAt, plan.before.endsAt, `emergency_off:${request.offReason}`, tx.actor.userId, roster.synthetic],
    );
  }

  const beforeState = plan.before ? shiftState(plan.before) : null;
  const afterState = after ? shiftState(after) : null;
  const { rows: inserted } = await tx.query<{ id: string }>(
    `INSERT INTO shift_override (roster_id, shift_id, override_type, from_staff_id, to_staff_id, before_state, after_state,
                                 reason, rule_breaches, off_reason, created_by, synthetic)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11, $12) RETURNING id`,
    [
      roster.id,
      shiftId,
      request.type,
      plan.fromStaffId,
      plan.toStaffId,
      beforeState && JSON.stringify(beforeState),
      afterState && JSON.stringify(afterState),
      decision.reason,
      JSON.stringify(decision.ruleBreaches),
      request.type === 'emergency_off' ? request.offReason : null,
      tx.actor.userId,
      roster.synthetic,
    ],
  );
  const overrideId = inserted[0]?.id ?? '';

  // Notify the affected cashiers who have an account (their own shift only, P11).
  const cashierUsers = staff.filter((s) => s.user_id !== null);
  for (const s of cashierUsers) {
    await tx.query(
      `INSERT INTO notification (user_id, event, object_type, object_id, severity, params, synthetic)
       VALUES ($1, 'shift.changed', 'shift', $2, 'info', $3::jsonb, $4)`,
      [
        s.user_id,
        shiftId,
        JSON.stringify({ change: request.type, role: s.id === plan.fromStaffId && s.id !== plan.toStaffId ? 'removed' : 'assigned' }),
        roster.synthetic,
      ],
    );
  }
  const notified = cashierUsers.map((s) => s.user_id as string);
  if (decision.ruleBreaches.length > 0) {
    notified.push(
      ...(await notifyInScope(tx, roster, RULE_OVERRIDE_NOTIFY_ROLES, 'roster.rule_override', roster.id, 'warning', {
        overrideId,
        rules: [...new Set(decision.ruleBreaches.map((b) => b.rule))],
      })),
    );
  }
  const leftOpen = after !== null && after.staffId === null;
  if (leftOpen) {
    notified.push(
      ...(await notifyInScope(tx, roster, UNFILLED_NOTIFY_ROLES, 'roster.unfilled_shift', roster.id, 'warning', { overrideId, shiftId })),
    );
  }

  await audit.record(tx, {
    action: 'edit',
    event: `shift_override.${request.type}`,
    objectType: 'shift_override',
    objectId: overrideId,
    before: beforeState,
    after: {
      rosterId: roster.id,
      storeId: roster.storeId,
      shiftId,
      type: request.type,
      fromStaffId: plan.fromStaffId,
      toStaffId: plan.toStaffId,
      shift: afterState,
      reason: decision.reason,
      ruleBreaches: decision.ruleBreaches.map((b) => ({ rule: b.rule, staffId: b.staffId, date: b.date })),
      notifiedUserIds: [...new Set(notified)].sort(),
    },
    synthetic: roster.synthetic,
  });
  return { overrideId, shiftId, check };
}

// ---------------------------------------------------------------------------
// Filling an open shift (task 17: accepted offers and borrowed cashiers)
// ---------------------------------------------------------------------------

/** A scheduled shift with its roster's store, status and provenance. */
export interface ShiftOnRoster extends StoredShift {
  readonly storeId: string;
  readonly regionId: string;
  readonly rosterStatus: RosterStatus;
  readonly synthetic: boolean;
}

/** One shift with its roster; `lock` locks the shift row (serialises fills of the same shift, P17). */
export async function loadShiftOnRoster(db: Queryable, shiftId: string, lock = false): Promise<ShiftOnRoster | null> {
  if (!UUID.test(shiftId)) return null;
  const row = await queryMaybe<ShiftRow & { store_id: string; region_id: string; roster_status: RosterStatus; synthetic: boolean }>(
    db,
    `SELECT ${SHIFT_COLUMNS}, r.store_id, st.region_id, r.status AS roster_status, sh.synthetic
       FROM shift sh JOIN roster r ON r.id = sh.roster_id JOIN store st ON st.id = r.store_id
      WHERE sh.id = $1${lock ? ' FOR UPDATE OF sh' : ''}`,
    [shiftId],
  );
  return row
    ? { ...toStoredShift(row), storeId: row.store_id, regionId: row.region_id, rosterStatus: row.roster_status, synthetic: row.synthetic }
    : null;
}

/**
 * P14/P16: the labor-rule check of `staffId` taking the open `shift`, with
 * their shifts on every published roster (any store) counted. With `lock`
 * the cashier is locked, so two fills for the same person are checked one
 * after the other.
 */
export async function checkFill(db: Queryable, shift: StoredShift, staffId: string, lock = false): Promise<{ check: OverrideCheck; staff: StaffRow | null }> {
  const [staff] = await loadStaff(db, [staffId], lock);
  const plan: PlannedOverride = { fromStaffId: null, toStaffId: staffId, before: shift, after: { ...shift, staffId } };
  const date = shiftLocalTimes(shift.startsAt, shift.endsAt).date;
  const shifts = await staffShifts(db, [staffId], addDays(date, -WINDOW_DAYS), addDays(date, WINDOW_DAYS));
  const rules = await laborRulesFor(db, staff?.synthetic ?? false);
  const check = checkOverride(plan, { shifts, staff: staff ? [toDomainStaff(staff)] : [], rules });
  return { check, staff: staff ?? null };
}

/** Records the ShiftOverride for an open shift filled by an offer or a borrow (P14); call inside the audited transaction. */
export async function recordFill(
  tx: AuditedTx,
  shift: ShiftOnRoster,
  staffId: string,
  source: { readonly type: 'offer_fill'; readonly offerId: string } | { readonly type: 'borrow_fill'; readonly transferRequestId: string },
  reason: string | null,
): Promise<string> {
  await tx.query(`UPDATE shift SET staff_id = $2 WHERE id = $1`, [shift.id, staffId]);
  const before = shiftState(shift);
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO shift_override (roster_id, shift_id, override_type, from_staff_id, to_staff_id, before_state, after_state,
                                 reason, shift_offer_id, transfer_request_id, created_by, synthetic)
     VALUES ($1, $2, $3, NULL, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11) RETURNING id`,
    [
      shift.rosterId,
      shift.id,
      source.type,
      staffId,
      JSON.stringify(before),
      JSON.stringify({ ...before, staffId }),
      reason,
      source.type === 'offer_fill' ? source.offerId : null,
      source.type === 'borrow_fill' ? source.transferRequestId : null,
      tx.actor.userId,
      shift.synthetic,
    ],
  );
  return rows[0]?.id ?? '';
}
