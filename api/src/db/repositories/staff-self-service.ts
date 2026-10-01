/**
 * Staff self-service — My roster, time-off and swap requests (task 18;
 * Req 15, 7.3/7.4; P7, P11, P14, P19).
 *
 *  - `myRoster`: the cashier's own scheduled shifts on published rosters, the
 *    latest change to each (✎, with the previous times), shifts taken off
 *    them, rest days and unavailable days. Nothing about any other cashier is
 *    read into the payload — no names, shifts or costs (P11).
 *  - `createRequest` / `cancelRequest`: a Staff user raises or withdraws a
 *    time-off or swap request. It is routed to the store manager of the
 *    affected store and touches nothing on the roster (P19).
 *  - `decideRequest`: the store manager approves or declines. Approval
 *    applies the request — time off as unavailability with the cashier's
 *    shifts in the range left open (`time_off` overrides), a swap as `swap`
 *    overrides — after the same labor-rule check as a manager's edit: a new
 *    warning needs a reason, a block (missed 24-hour rest after 6 days,
 *    overlap) is never saved (Req 7.3/7.4, P14). Both cashiers of a swap are
 *    notified.
 *
 * Every mutation runs in the caller's audited transaction and records
 * exactly one audit event (P7).
 */
import { addDays } from '@lanewise/domain';
import {
  MY_ROSTER_MAX_DAYS,
  instantToLocal,
  localToInstant,
  offerWithinTravelLimit,
  overrideSaveDecision,
  shiftLocalTimes,
  type CreateStaffRequest,
  type IsoDate,
  type MyDayAbsence,
  type MyRemovedShift,
  type MyRosterDayDto,
  type MyRosterResponse,
  type MyShiftChange,
  type MyShiftDto,
  type MyStaffRequestDto,
  type MyTravelLimit,
  type OverrideCheck,
  type RequestShiftDto,
  type ShiftOverrideRecordType,
  type StaffRequestDecision,
  type StaffRequestStatus,
  type StaffRequestType,
  type StoreStaffRequestDto,
  type SwapOptionsResponse,
  type SwapTargetDto,
  type TimeOffReason,
} from '@lanewise/shared';
import type pg from 'pg';
import { ApiError, errors } from '../../http/errors.js';
import {
  notifyShiftChanged,
  notifyShiftsLeftOpen,
  notifyStaffRequestDecided,
  notifyStaffRequestSubmitted,
} from '../../notifications/events.js';
import { checkChanges, type ShiftChange, type StoredShift } from '../../rosters/overrides.js';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { queryMaybe } from '../rows.js';
import { contractOf, laborRulesFor, loadShiftOnRoster, loadStaff, staffShifts, toDomainStaff, type ShiftOnRoster, type StaffRow } from './rosters.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Days either side of a change whose shifts the labor rules look at (as for overrides). */
const WINDOW_DAYS = 14;
/** Open shifts offered as swap targets lie within this many days of one of the cashier's own shifts. */
const SWAP_WINDOW_DAYS = 14;
/** Decided requests stay listed this long. */
const HISTORY_DAYS = 60;

export const today = (now: Date): IsoDate => instantToLocal(now).date;

function inputError(path: string, message: string): ApiError {
  return errors.validationFailed('This request cannot be made.', [{ path: `body.${path}`, message }]);
}

// ---------------------------------------------------------------------------
// The cashier
// ---------------------------------------------------------------------------

interface OwnStaffRow extends pg.QueryResultRow {
  id: string;
  employee_no: string;
  name: string;
  store_id: string;
  store_name: string;
  department_id: string;
  department_name: string;
  employment_type: string;
  synthetic: boolean;
  max_travel_min: number | null;
  cross_store_offers: boolean | null;
}

async function ownStaff(db: Queryable, staffId: string): Promise<OwnStaffRow> {
  const row = await queryMaybe<OwnStaffRow>(
    db,
    `SELECT s.id, s.employee_no, s.name, s.store_id, st.name AS store_name, s.department_id, d.name AS department_name,
            s.employment_type, s.synthetic, h.max_travel_min, h.cross_store_offers
       FROM staff s
       JOIN store st ON st.id = s.store_id
       JOIN department d ON d.id = s.department_id
       LEFT JOIN staff_home_area h ON h.staff_id = s.id
      WHERE s.id = $1`,
    [staffId],
  );
  // A self scope always names an existing staff record; anything else is no access.
  if (!row) throw errors.forbidden();
  return row;
}

function travelLimitOf(s: OwnStaffRow): MyTravelLimit | null {
  return s.max_travel_min === null ? null : { maxTravelMin: s.max_travel_min, crossStoreOffers: s.cross_store_offers ?? false };
}

// ---------------------------------------------------------------------------
// My roster (SCR-025)
// ---------------------------------------------------------------------------

interface MyShiftRow extends pg.QueryResultRow {
  id: string;
  roster_id: string;
  store_id: string;
  store_name: string;
  department_id: string;
  department_name: string;
  starts_at: Date;
  ends_at: Date;
  activities: unknown;
}

interface ChangeRow extends pg.QueryResultRow {
  shift_id: string;
  override_type: ShiftOverrideRecordType;
  before_state: { startsAt?: string; endsAt?: string } | null;
  by_name: string;
  created_at: Date;
}

const times = (state: { startsAt?: string; endsAt?: string } | null) =>
  state?.startsAt && state.endsAt ? shiftLocalTimes(state.startsAt, state.endsAt) : null;

function readActivities(value: unknown): MyShiftDto['activities'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a: unknown) => {
    if (typeof a !== 'object' || a === null) return [];
    const { kind, startMin, endMin } = a as Record<string, unknown>;
    return (kind === 'meal' || kind === 'training' || kind === 'huddle') && typeof startMin === 'number' && typeof endMin === 'number'
      ? [{ kind, startMin, endMin }]
      : [];
  });
}

/**
 * The cashier's own roster between two local dates (inclusive). P11: every
 * query is keyed by the cashier's own staff id; other cashiers' shifts are
 * never read, and a previous state contributes only its times.
 */
export async function myRoster(db: Queryable, staffId: string, from: IsoDate, to: IsoDate): Promise<MyRosterResponse> {
  const me = await ownStaff(db, staffId);
  const range = [from, to] as const;
  const [{ rows: shifts }, { rows: removedRows }, { rows: unavailable }, { rows: rostered }, { rows: pending }] = await Promise.all([
    db.query<MyShiftRow>(
      `SELECT sh.id, sh.roster_id, r.store_id, st.name AS store_name, sh.department_id, d.name AS department_name,
              sh.starts_at, sh.ends_at, sh.activities
         FROM shift sh
         JOIN roster r ON r.id = sh.roster_id
         JOIN store st ON st.id = r.store_id
         JOIN department d ON d.id = sh.department_id
        WHERE sh.staff_id = $1 AND sh.status = 'scheduled' AND r.status = 'published'
          AND sh.starts_at >= $2::date::timestamp AT TIME ZONE 'Asia/Manila'
          AND sh.starts_at < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'
        ORDER BY sh.starts_at, sh.id`,
      [staffId, ...range],
    ),
    // Shifts taken off them: the latest change of each shift they lost, where the shift is no longer theirs.
    db.query<ChangeRow>(
      `SELECT DISTINCT ON (o.shift_id) o.shift_id, o.override_type, o.before_state, u.name AS by_name, o.created_at
         FROM shift_override o
         JOIN app_user u ON u.id = o.created_by
         JOIN shift sh ON sh.id = o.shift_id
         JOIN roster r ON r.id = o.roster_id
        WHERE o.from_staff_id = $1 AND o.to_staff_id IS DISTINCT FROM $1 AND r.status = 'published'
          AND (sh.staff_id IS DISTINCT FROM $1 OR sh.status <> 'scheduled')
          AND (o.before_state ->> 'startsAt')::timestamptz >= $2::date::timestamp AT TIME ZONE 'Asia/Manila'
          AND (o.before_state ->> 'startsAt')::timestamptz < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'
        ORDER BY o.shift_id, o.created_at DESC, o.id DESC`,
      [staffId, ...range],
    ),
    db.query<{ starts_at: Date; ends_at: Date }>(
      `SELECT starts_at, ends_at FROM staff_availability
        WHERE staff_id = $1 AND kind = 'unavailable'
          AND ends_at > $2::date::timestamp AT TIME ZONE 'Asia/Manila'
          AND starts_at < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'`,
      [staffId, ...range],
    ),
    // Days a published roster of their home department covers: a day there without a shift is a rest day.
    db.query<{ period_start: string; period_end: string }>(
      `SELECT period_start::text, period_end::text FROM roster
        WHERE department_id = $1 AND status = 'published' AND period_end >= $2::date AND period_start <= $3::date`,
      [me.department_id, ...range],
    ),
    db.query<{ id: string; offered_shift_id: string | null; date_from: string | null; date_to: string | null }>(
      `SELECT id, offered_shift_id, date_from::text, date_to::text FROM staff_request WHERE staff_id = $1 AND status = 'pending'`,
      [staffId],
    ),
  ]);

  const ids = shifts.map((s) => s.id);
  const { rows: changes } = ids.length
    ? await db.query<ChangeRow>(
        `SELECT DISTINCT ON (o.shift_id) o.shift_id, o.override_type, o.before_state, u.name AS by_name, o.created_at
           FROM shift_override o JOIN app_user u ON u.id = o.created_by
          WHERE o.shift_id = ANY($1::uuid[])
          ORDER BY o.shift_id, o.created_at DESC, o.id DESC`,
        [ids],
      )
    : { rows: [] as ChangeRow[] };
  const latest = new Map(changes.map((c) => [c.shift_id, c]));

  const pendingFor = (shiftId: string, date: IsoDate) =>
    pending.find((p) => p.offered_shift_id === shiftId || (p.date_from !== null && p.date_to !== null && p.date_from <= date && date <= p.date_to))?.id ??
    null;

  const days = new Map<IsoDate, { shifts: MyShiftDto[]; removed: MyRemovedShift[] }>();
  const day = (d: IsoDate) => {
    let v = days.get(d);
    if (!v) days.set(d, (v = { shifts: [], removed: [] }));
    return v;
  };
  for (const s of shifts) {
    const t = shiftLocalTimes(s.starts_at, s.ends_at);
    const c = latest.get(s.id);
    const previous = c ? times(c.before_state) : null;
    const changed: MyShiftChange | null = c
      ? {
          type: c.override_type,
          by: c.by_name,
          at: c.created_at.toISOString(),
          previous: previous && (previous.date !== t.date || previous.startMin !== t.startMin || previous.endMin !== t.endMin) ? previous : null,
        }
      : null;
    day(t.date).shifts.push({
      id: s.id,
      storeId: s.store_id,
      storeName: s.store_name,
      departmentId: s.department_id,
      departmentName: s.department_name,
      ...t,
      activities: readActivities(s.activities),
      changed,
      pendingRequestId: pendingFor(s.id, t.date),
    });
  }
  for (const r of removedRows) {
    const t = times(r.before_state);
    if (!t) continue;
    day(t.date).removed.push({ shiftId: r.shift_id, ...t, type: r.override_type, by: r.by_name, at: r.created_at.toISOString() });
  }

  const out: MyRosterDayDto[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = days.get(d) ?? { shifts: [], removed: [] };
    const dayStart = Date.parse(localToInstant(d, 0));
    const dayEnd = dayStart + 86_400_000;
    let absence: MyDayAbsence | null = null;
    if (v.shifts.length === 0) {
      if (unavailable.some((u) => u.starts_at.getTime() < dayEnd && u.ends_at.getTime() > dayStart)) absence = 'unavailable';
      else if (rostered.some((r) => r.period_start <= d && d <= r.period_end)) absence = 'rest';
    }
    out.push({ date: d, shifts: v.shifts, absence, removed: v.removed.sort((a, b) => a.startMin - b.startMin) });
  }

  return {
    staff: {
      id: me.id,
      employeeNo: me.employee_no,
      name: me.name,
      storeName: me.store_name,
      departmentName: me.department_name,
      contract: contractOf(me as unknown as StaffRow),
    },
    from,
    to,
    days: out,
    travelLimit: travelLimitOf(me),
    synthetic: me.synthetic,
  };
}

/** The window a My roster read covers: `from` (default: this week's Monday) for up to four weeks. */
export function rosterWindow(now: Date, from?: IsoDate, to?: IsoDate): { from: IsoDate; to: IsoDate } {
  const t = today(now);
  const weekday = (new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const start = from ?? addDays(t, -weekday);
  const end = to ?? addDays(start, 20);
  if (end < start) throw inputErrorQuery('to', 'The window must end on or after it starts.');
  if (addDays(start, MY_ROSTER_MAX_DAYS - 1) < end) throw inputErrorQuery('to', `Ask for at most ${MY_ROSTER_MAX_DAYS} days.`);
  return { from: start, to: end };
}

function inputErrorQuery(path: string, message: string): ApiError {
  return errors.validationFailed('Some fields are missing or invalid.', [{ path: `query.${path}`, message }]);
}

// ---------------------------------------------------------------------------
// Offers within the cashier's own travel limit (Req 15.2)
// ---------------------------------------------------------------------------

/**
 * Ids of the cashier's offers that fall outside their own travel limit (an
 * offer from another store with cross-store offers off, or beyond their
 * maximum travel time). They are hidden from My roster and cannot be accepted.
 */
export async function offersOutsideTravelLimit(db: Queryable, staffId: string): Promise<Set<string>> {
  const me = await ownStaff(db, staffId);
  const limit = travelLimitOf(me);
  const { rows } = await db.query<{ id: string; own_store: boolean; travel_min: string | null }>(
    `SELECT o.id, r.store_id = $2 AS own_store, o.travel_min::text AS travel_min
       FROM shift_offer o JOIN shift sh ON sh.id = o.shift_id JOIN roster r ON r.id = sh.roster_id
      WHERE o.staff_id = $1`,
    [staffId, me.store_id],
  );
  return new Set(
    rows
      .filter((r) => !offerWithinTravelLimit({ ownStore: r.own_store, travelMin: r.travel_min === null ? null : Number(r.travel_min) }, limit))
      .map((r) => r.id),
  );
}

// ---------------------------------------------------------------------------
// Requests: reading
// ---------------------------------------------------------------------------

interface RequestRow extends pg.QueryResultRow {
  id: string;
  staff_id: string;
  store_id: string;
  store_name: string;
  request_type: StaffRequestType;
  status: StaffRequestStatus;
  date_from: string | null;
  date_to: string | null;
  time_off_reason: TimeOffReason | null;
  note: string | null;
  offered_shift_id: string | null;
  target_shift_id: string | null;
  target_staff_id: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  decided_by_name: string | null;
  created_at: Date;
  synthetic: boolean;
}

const REQUEST_SELECT = `
  SELECT r.id, r.staff_id, r.store_id, st.name AS store_name, r.request_type, r.status, r.date_from::text AS date_from,
         r.date_to::text AS date_to, r.time_off_reason, r.note, r.offered_shift_id, r.target_shift_id, r.target_staff_id,
         r.decided_at, r.decision_note, u.name AS decided_by_name, r.created_at, r.synthetic
    FROM staff_request r
    JOIN store st ON st.id = r.store_id
    LEFT JOIN app_user u ON u.id = r.decided_by`;

interface RequestShiftRow extends pg.QueryResultRow {
  id: string;
  store_id: string;
  staff_id: string | null;
  department_name: string;
  starts_at: Date;
  ends_at: Date;
}

async function requestShifts(db: Queryable, ids: readonly string[]): Promise<Map<string, RequestShiftRow>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<RequestShiftRow>(
    `SELECT sh.id, r.store_id, sh.staff_id, d.name AS department_name, sh.starts_at, sh.ends_at
       FROM shift sh JOIN roster r ON r.id = sh.roster_id JOIN department d ON d.id = sh.department_id
      WHERE sh.id = ANY($1::uuid[])`,
    [[...new Set(ids)]],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

const shiftDto = (s: RequestShiftRow): RequestShiftDto => ({
  shiftId: s.id,
  storeId: s.store_id,
  departmentName: s.department_name,
  ...shiftLocalTimes(s.starts_at, s.ends_at),
});

function baseDto(r: RequestRow, shifts: ReadonlyMap<string, RequestShiftRow>): MyStaffRequestDto {
  const offered = r.offered_shift_id ? shifts.get(r.offered_shift_id) : undefined;
  const target = r.target_shift_id ? shifts.get(r.target_shift_id) : undefined;
  return {
    id: r.id,
    type: r.request_type,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    storeName: r.store_name,
    dateFrom: r.date_from,
    dateTo: r.date_to,
    reason: r.time_off_reason,
    note: r.note,
    offered: offered ? shiftDto(offered) : null,
    // P11: the cashier sees whether they take an open shift or a colleague's, never whose.
    target: target ? { ...shiftDto(target), kind: r.target_staff_id === null ? 'open' : 'colleague' } : null,
    decidedAt: r.decided_at?.toISOString() ?? null,
    decisionNote: r.decision_note,
  };
}

/** The cashier's own requests: pending first, then the last 60 days. */
export async function listMyRequests(db: Queryable, staffId: string, now: Date): Promise<MyStaffRequestDto[]> {
  const { rows } = await db.query<RequestRow>(
    `${REQUEST_SELECT}
      WHERE r.staff_id = $1 AND (r.status = 'pending' OR r.created_at >= $2::timestamptz - make_interval(days => $3))
      ORDER BY (r.status = 'pending') DESC, r.created_at DESC, r.id
      LIMIT 100`,
    [staffId, now.toISOString(), HISTORY_DAYS],
  );
  const shifts = await requestShifts(db, rows.flatMap((r) => [r.offered_shift_id, r.target_shift_id].filter((x): x is string => x !== null)));
  return rows.map((r) => baseDto(r, shifts));
}

export async function myRequest(db: Queryable, staffId: string, id: string): Promise<MyStaffRequestDto> {
  const row = await queryMaybe<RequestRow>(db, `${REQUEST_SELECT} WHERE r.id = $1 AND r.staff_id = $2`, [id, staffId]);
  if (!row) throw errors.notFoundOrNoAccess();
  const shifts = await requestShifts(db, [row.offered_shift_id, row.target_shift_id].filter((x): x is string => x !== null));
  return baseDto(row, shifts);
}

/** Departments a cashier may work: home department plus trained ones. */
const canWork = (s: StaffRow, departmentId: string) => s.department_id === departmentId || s.trained.includes(departmentId);

/**
 * Swap options: the cashier's own upcoming shifts that are not already
 * offered in a pending swap, and open shifts they are trained for at the
 * stores of those shifts, within two weeks of one of them (P11: open slots
 * only — no colleague's shift is listed).
 */
export async function swapOptions(db: Queryable, staffId: string, now: Date): Promise<SwapOptionsResponse> {
  const [me] = await loadStaff(db, [staffId]);
  if (!me) throw errors.forbidden();
  const { rows: mine } = await db.query<RequestShiftRow>(
    `SELECT sh.id, r.store_id, sh.staff_id, d.name AS department_name, sh.starts_at, sh.ends_at
       FROM shift sh JOIN roster r ON r.id = sh.roster_id JOIN department d ON d.id = sh.department_id
      WHERE sh.staff_id = $1 AND sh.status = 'scheduled' AND r.status = 'published'
        AND sh.starts_at > $2
        AND NOT EXISTS (SELECT 1 FROM staff_request q WHERE q.offered_shift_id = sh.id AND q.status = 'pending')
      ORDER BY sh.starts_at, sh.id
      LIMIT 100`,
    [staffId, now],
  );
  const stores = [...new Set(mine.map((s) => s.store_id))];
  const departments = [me.department_id, ...me.trained];
  const { rows: open } = stores.length
    ? await db.query<RequestShiftRow>(
        `SELECT sh.id, r.store_id, sh.staff_id, d.name AS department_name, sh.starts_at, sh.ends_at
           FROM shift sh JOIN roster r ON r.id = sh.roster_id JOIN department d ON d.id = sh.department_id
          WHERE sh.staff_id IS NULL AND sh.status = 'scheduled' AND r.status = 'published' AND r.synthetic = $5
            AND r.store_id = ANY($1::uuid[]) AND sh.department_id = ANY($2::uuid[])
            AND sh.starts_at > $3
            AND EXISTS (SELECT 1 FROM unnest($4::timestamptz[]) m(at)
                         WHERE sh.starts_at BETWEEN m.at - make_interval(days => $6) AND m.at + make_interval(days => $6))
          ORDER BY sh.starts_at, sh.id
          LIMIT 100`,
        [stores, departments, now, mine.map((m) => m.starts_at), me.synthetic, SWAP_WINDOW_DAYS],
      )
    : { rows: [] as RequestShiftRow[] };
  return { mine: mine.map(shiftDto), open: open.map((s): SwapTargetDto => ({ ...shiftDto(s), kind: 'open' })) };
}

// ---------------------------------------------------------------------------
// Requests: raising and cancelling (Staff)
// ---------------------------------------------------------------------------

function requestAuditState(r: {
  type: StaffRequestType;
  storeId: string;
  staffId: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  offeredShiftId?: string | null;
  targetShiftId?: string | null;
  targetStaffId?: string | null;
}) {
  return {
    type: r.type,
    storeId: r.storeId,
    staffId: r.staffId,
    dateFrom: r.dateFrom ?? null,
    dateTo: r.dateTo ?? null,
    offeredShiftId: r.offeredShiftId ?? null,
    targetShiftId: r.targetShiftId ?? null,
    targetStaffId: r.targetStaffId ?? null,
  };
}

/**
 * Raises a request (Req 15.3/15.4). P19: only the request row is written —
 * the roster, the shifts and availability are untouched until a manager
 * approves.
 */
export async function createRequest(tx: AuditedTx, staffId: string, body: CreateStaffRequest, now: Date): Promise<string> {
  const [me] = await loadStaff(tx, [staffId], true);
  if (!me || !me.active) throw errors.forbidden();

  let storeId: string;
  let offered: ShiftOnRoster | null = null;
  let target: ShiftOnRoster | null = null;
  if (body.type === 'time_off') {
    storeId = me.store_id;
    const overlap = await queryMaybe(
      tx,
      `SELECT 1 FROM staff_request WHERE staff_id = $1 AND request_type = 'time_off' AND status = 'pending'
          AND date_from <= $3::date AND date_to >= $2::date`,
      [staffId, body.dateFrom, body.dateTo],
    );
    if (overlap) throw errors.conflict('You already asked for time off on some of these days.');
  } else {
    // Lock both shifts in a stable order so concurrent requests over the same shifts serialise.
    const [a, b] = [body.offeredShiftId, body.targetShiftId].sort();
    const locked = new Map<string, ShiftOnRoster | null>();
    for (const id of [a, b] as string[]) locked.set(id, UUID.test(id) ? await loadShiftOnRoster(tx, id, true) : null);
    offered = locked.get(body.offeredShiftId) ?? null;
    target = locked.get(body.targetShiftId) ?? null;
    if (!offered || offered.staffId !== staffId || offered.status !== 'scheduled' || offered.rosterStatus !== 'published' || offered.startsAt <= now) {
      throw inputError('offeredShiftId', 'Pick one of your upcoming shifts.');
    }
    // Another store's (or a missing) shift reads the same as any other wrong pick (no probing, P1/P11).
    if (
      !target ||
      target.storeId !== offered.storeId ||
      target.synthetic !== offered.synthetic ||
      target.status !== 'scheduled' ||
      target.rosterStatus !== 'published' ||
      target.startsAt <= now ||
      target.staffId === staffId
    ) {
      throw inputError('targetShiftId', 'Pick an upcoming open shift at the same store.');
    }
    if (!canWork(me, target.departmentId)) throw inputError('targetShiftId', 'You are not trained for that shift’s department.');
    if (target.staffId !== null) {
      const [colleague] = await loadStaff(tx, [target.staffId]);
      if (!colleague || !canWork(colleague, offered.departmentId)) {
        throw inputError('targetShiftId', 'Pick an upcoming open shift at the same store.');
      }
    }
    storeId = offered.storeId;
  }

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO staff_request (staff_id, store_id, request_type, date_from, date_to, time_off_reason, offered_shift_id,
                                target_shift_id, target_staff_id, note, synthetic)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      staffId,
      storeId,
      body.type,
      body.type === 'time_off' ? body.dateFrom : null,
      body.type === 'time_off' ? body.dateTo : null,
      body.type === 'time_off' ? (body.reason ?? null) : null,
      offered?.id ?? null,
      target?.id ?? null,
      target?.staffId ?? null,
      body.note?.trim() || null,
      me.synthetic,
    ],
  );
  const id = rows[0]?.id ?? '';
  const notified = await notifyStaffRequestSubmitted(tx, id);
  await audit.record(tx, {
    action: 'create',
    event: 'staff_request.created',
    objectType: 'staff_request',
    objectId: id,
    before: null,
    after: {
      ...requestAuditState({
        type: body.type,
        storeId,
        staffId,
        dateFrom: body.type === 'time_off' ? body.dateFrom : null,
        dateTo: body.type === 'time_off' ? body.dateTo : null,
        offeredShiftId: offered?.id ?? null,
        targetShiftId: target?.id ?? null,
        targetStaffId: target?.staffId ?? null,
      }),
      status: 'pending',
      notifiedUserIds: notified,
    },
    synthetic: me.synthetic,
  });
  return id;
}

/** Withdraws a pending request of the cashier's own (another cashier's is a 404, P11). */
export async function cancelRequest(tx: AuditedTx, staffId: string, id: string): Promise<void> {
  const row = await queryMaybe<RequestRow>(tx, `${REQUEST_SELECT} WHERE r.id = $1 AND r.staff_id = $2 FOR UPDATE OF r`, [id, staffId]);
  if (!row) throw errors.notFoundOrNoAccess();
  if (row.status !== 'pending') throw errors.conflict(`This request is already ${row.status}.`);
  await tx.query(`UPDATE staff_request SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [id]);
  await audit.record(tx, {
    action: 'edit',
    event: 'staff_request.cancelled',
    objectType: 'staff_request',
    objectId: id,
    before: { status: 'pending' },
    after: { ...requestAuditState({ ...rowState(row) }), status: 'cancelled' },
    synthetic: row.synthetic,
  });
}

const rowState = (r: RequestRow) => ({
  type: r.request_type,
  storeId: r.store_id,
  staffId: r.staff_id,
  dateFrom: r.date_from,
  dateTo: r.date_to,
  offeredShiftId: r.offered_shift_id,
  targetShiftId: r.target_shift_id,
  targetStaffId: r.target_staff_id,
});

// ---------------------------------------------------------------------------
// Requests: the store manager's panel and decision
// ---------------------------------------------------------------------------

interface ShiftLock {
  readonly offered: ShiftOnRoster | null;
  readonly target: ShiftOnRoster | null;
}

/** Whether a pending swap still applies to the roster as it is now. */
function swapStale(r: RequestRow, s: ShiftLock, now: Date): boolean {
  const { offered, target } = s;
  return (
    !offered ||
    !target ||
    offered.status !== 'scheduled' ||
    target.status !== 'scheduled' ||
    offered.rosterStatus !== 'published' ||
    target.rosterStatus !== 'published' ||
    offered.staffId !== r.staff_id ||
    target.staffId !== r.target_staff_id ||
    offered.startsAt <= now
  );
}

function swapChanges(r: RequestRow, s: Required<{ [K in keyof ShiftLock]: NonNullable<ShiftLock[K]> }>): ShiftChange[] {
  const keep = (x: StoredShift) => ({ departmentId: x.departmentId, startsAt: x.startsAt, endsAt: x.endsAt, activities: x.activities });
  return [
    { before: s.offered, after: { ...keep(s.offered), staffId: r.target_staff_id } },
    { before: s.target, after: { ...keep(s.target), staffId: r.staff_id } },
  ];
}

async function checkSwap(db: Queryable, r: RequestRow, s: { offered: ShiftOnRoster; target: ShiftOnRoster }, lock: boolean): Promise<OverrideCheck> {
  const who = [r.staff_id, ...(r.target_staff_id ? [r.target_staff_id] : [])];
  const staff = await loadStaff(db, who, lock);
  const dates = [s.offered, s.target].map((x) => shiftLocalTimes(x.startsAt, x.endsAt).date).sort();
  const shifts = await staffShifts(db, who, addDays(dates[0] as string, -WINDOW_DAYS), addDays(dates[1] as string, WINDOW_DAYS));
  const rules = await laborRulesFor(db, r.synthetic);
  return checkChanges(swapChanges(r, s), { shifts, staff: staff.map(toDomainStaff), rules });
}

/** The cashier's scheduled shifts on published rosters within a local date range (time off). */
async function shiftsInRange(db: Queryable, staffId: string, from: IsoDate, to: IsoDate, lock: boolean) {
  const { rows } = await db.query<{ id: string; roster_id: string; store_id: string; store_name: string; region_id: string; department_id: string; starts_at: Date; ends_at: Date; activities: unknown; synthetic: boolean }>(
    `SELECT sh.id, sh.roster_id, r.store_id, st.name AS store_name, st.region_id, sh.department_id, sh.starts_at, sh.ends_at,
            sh.activities, sh.synthetic
       FROM shift sh JOIN roster r ON r.id = sh.roster_id JOIN store st ON st.id = r.store_id
      WHERE sh.staff_id = $1 AND sh.status = 'scheduled' AND r.status = 'published'
        AND sh.starts_at >= $2::date::timestamp AT TIME ZONE 'Asia/Manila'
        AND sh.starts_at < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'
      ORDER BY sh.starts_at, sh.id${lock ? ' FOR UPDATE OF sh' : ''}`,
    [staffId, from, to],
  );
  return rows;
}

async function storeDto(db: Queryable, r: RequestRow, now: Date): Promise<StoreStaffRequestDto> {
  const ids = [r.offered_shift_id, r.target_shift_id].filter((x): x is string => x !== null);
  const shifts = await requestShifts(db, ids);
  const base = baseDto(r, shifts);
  const people = await loadStaff(db, [r.staff_id, ...(r.target_staff_id ? [r.target_staff_id] : [])]);
  const staff = people.find((p) => p.id === r.staff_id);
  const colleague = r.target_staff_id ? people.find((p) => p.id === r.target_staff_id) : undefined;
  let check: OverrideCheck | null = null;
  let shiftsLeftOpen: number | null = null;
  let stale = false;
  if (r.status === 'pending') {
    if (r.request_type === 'swap') {
      const s = {
        offered: r.offered_shift_id ? await loadShiftOnRoster(db, r.offered_shift_id) : null,
        target: r.target_shift_id ? await loadShiftOnRoster(db, r.target_shift_id) : null,
      };
      stale = swapStale(r, s, now);
      if (!stale && s.offered && s.target) check = await checkSwap(db, r, { offered: s.offered, target: s.target }, false);
    } else if (r.date_from && r.date_to) {
      shiftsLeftOpen = (await shiftsInRange(db, r.staff_id, r.date_from, r.date_to, false)).length;
    }
  }
  return {
    ...base,
    staff: { id: r.staff_id, employeeNo: staff?.employee_no ?? '', name: staff?.name ?? '' },
    target: base.target ? { ...base.target, staffName: colleague ? `${colleague.employee_no} ${colleague.name}` : null } : null,
    decidedBy: r.decided_by_name,
    check,
    shiftsLeftOpen,
    stale,
  };
}

/** The store's requests for its manager: pending first, then the last 60 days. */
export async function listStoreRequests(db: Queryable, storeId: string, now: Date): Promise<StoreStaffRequestDto[]> {
  const { rows } = await db.query<RequestRow>(
    `${REQUEST_SELECT}
      WHERE r.store_id = $1 AND (r.status = 'pending' OR r.created_at >= $2::timestamptz - make_interval(days => $3))
      ORDER BY (r.status = 'pending') DESC, r.created_at, r.id
      LIMIT 200`,
    [storeId, now.toISOString(), HISTORY_DAYS],
  );
  const out: StoreStaffRequestDto[] = [];
  for (const r of rows) out.push(await storeDto(db, r, now));
  return out;
}

export async function storeRequest(db: Queryable, storeId: string, id: string, now: Date): Promise<StoreStaffRequestDto> {
  const row = await queryMaybe<RequestRow>(db, `${REQUEST_SELECT} WHERE r.id = $1 AND r.store_id = $2`, [id, storeId]);
  if (!row) throw errors.notFoundOrNoAccess();
  return storeDto(db, row, now);
}

const shiftState = (s: { staffId: string | null; departmentId: string; startsAt: Date; endsAt: Date; activities: readonly unknown[] }) => ({
  staffId: s.staffId,
  departmentId: s.departmentId,
  startsAt: s.startsAt.toISOString(),
  endsAt: s.endsAt.toISOString(),
  activities: s.activities,
});

function refuse(check: OverrideCheck, code: 'blocked' | 'reason_required'): never {
  const breaches = code === 'blocked' ? (check.blocking.length > 0 ? check.blocking : check.breaches) : check.breaches;
  const details = breaches.map((b) => ({ path: `breaches.${b.rule}`, message: b.message }));
  if (code === 'blocked') {
    throw new ApiError('conflict', 'This swap can’t be approved: it breaks a labor rule that cannot be overridden.', { details });
  }
  throw errors.validationFailed('This swap breaks a labor rule. Give a reason to approve it anyway.', [
    { path: 'body.reason', message: 'A reason is required to override a labor rule.' },
    ...details,
  ]);
}

/**
 * The store manager's decision (Req 15.5–15.7). Declining changes nothing on
 * the roster. Approving applies the request in this transaction — and only
 * then (P19; the database refuses a request-driven change of a request that
 * is not approved).
 */
export async function decideRequest(tx: AuditedTx, storeId: string, id: string, body: StaffRequestDecision, now: Date): Promise<void> {
  const r = await queryMaybe<RequestRow>(tx, `${REQUEST_SELECT} WHERE r.id = $1 AND r.store_id = $2 FOR UPDATE OF r`, [id, storeId]);
  if (!r) throw errors.notFoundOrNoAccess();
  if (r.status !== 'pending') throw errors.conflict(`This request is already ${r.status}.`);
  const note = body.note?.trim() || null;

  if (body.decision === 'decline') {
    await tx.query(`UPDATE staff_request SET status = 'declined', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1`, [
      id,
      tx.actor.userId,
      note,
    ]);
    const notified = await notifyStaffRequestDecided(tx, id);
    await audit.record(tx, {
      action: 'decision',
      event: 'staff_request.declined',
      objectType: 'staff_request',
      objectId: id,
      before: { status: 'pending' },
      after: { ...requestAuditState(rowState(r)), status: 'declined', note, notifiedUserIds: notified },
      synthetic: r.synthetic,
    });
    return;
  }

  const approve = () =>
    tx.query(`UPDATE staff_request SET status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1`, [
      id,
      tx.actor.userId,
      note,
    ]);
  const insertOverride = (
    shift: { id: string; rosterId: string },
    type: 'swap' | 'time_off',
    from: string | null,
    to: string | null,
    before: ReturnType<typeof shiftState>,
    after: ReturnType<typeof shiftState>,
    reason: string | null,
    breaches: unknown[],
  ) =>
    tx
      .query<{ id: string }>(
        `INSERT INTO shift_override (roster_id, shift_id, override_type, from_staff_id, to_staff_id, before_state, after_state,
                                     reason, rule_breaches, staff_request_id, created_by, synthetic)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11, $12) RETURNING id`,
        [shift.rosterId, shift.id, type, from, to, JSON.stringify(before), JSON.stringify(after), reason, JSON.stringify(breaches), id, tx.actor.userId, r.synthetic],
      )
      .then((res) => res.rows[0]?.id ?? '');

  if (r.request_type === 'time_off') {
    if (!r.date_from || !r.date_to) throw errors.conflict('This request has no dates.');
    await loadStaff(tx, [r.staff_id], true);
    await approve();
    const { rows: avail } = await tx.query<{ id: string }>(
      `INSERT INTO staff_availability (staff_id, kind, starts_at, ends_at, reason, source, staff_request_id, created_by, synthetic)
       VALUES ($1, 'unavailable', $2, $3, $4, 'staff_request', $5, $6, $7) RETURNING id`,
      [
        r.staff_id,
        localToInstant(r.date_from, 0),
        localToInstant(addDays(r.date_to, 1), 0),
        `time_off${r.time_off_reason ? `:${r.time_off_reason}` : ''}`,
        id,
        tx.actor.userId,
        r.synthetic,
      ],
    );
    // Flag the shifts this leaves open: each loses its cashier through a `time_off` override (P14).
    const open = await shiftsInRange(tx, r.staff_id, r.date_from, r.date_to, true);
    const overrideIds: string[] = [];
    for (const s of open) {
      const before = shiftState({ staffId: r.staff_id, departmentId: s.department_id, startsAt: s.starts_at, endsAt: s.ends_at, activities: readActivities(s.activities) });
      await tx.query(`UPDATE shift SET staff_id = NULL WHERE id = $1`, [s.id]);
      overrideIds.push(await insertOverride({ id: s.id, rosterId: s.roster_id }, 'time_off', r.staff_id, null, before, { ...before, staffId: null }, null, []));
    }
    const notified = await notifyStaffRequestDecided(tx, id);
    const byStore = new Map<string, { name: string; ids: string[] }>();
    for (const s of open) {
      const g = byStore.get(s.store_id) ?? { name: s.store_name, ids: [] };
      g.ids.push(s.id);
      byStore.set(s.store_id, g);
    }
    for (const [sid, g] of byStore) notified.push(...(await notifyShiftsLeftOpen(tx, { id: sid, name: g.name }, g.ids, r.synthetic)));
    await audit.record(tx, {
      action: 'decision',
      event: 'staff_request.approved',
      objectType: 'staff_request',
      objectId: id,
      before: { status: 'pending' },
      after: {
        ...requestAuditState(rowState(r)),
        status: 'approved',
        note,
        availabilityId: avail[0]?.id ?? null,
        overrideIds,
        shiftsLeftOpen: open.map((s) => s.id),
        notifiedUserIds: [...new Set(notified)].sort(),
      },
      synthetic: r.synthetic,
    });
    return;
  }

  // Swap: lock both shifts (stable order), confirm the roster has not moved, re-check the labor rules.
  const ids = [r.offered_shift_id, r.target_shift_id].filter((x): x is string => x !== null).sort();
  const locked = new Map<string, ShiftOnRoster | null>();
  for (const sid of ids) locked.set(sid, await loadShiftOnRoster(tx, sid, true));
  const s = { offered: locked.get(r.offered_shift_id ?? '') ?? null, target: locked.get(r.target_shift_id ?? '') ?? null };
  if (swapStale(r, s, now) || !s.offered || !s.target) {
    throw errors.conflict('The roster changed since this swap was requested, so it can no longer be applied. Decline it instead.');
  }
  const pair = { offered: s.offered, target: s.target };
  const check = await checkSwap(tx, r, pair, true);
  const decision = overrideSaveDecision(check, body.reason);
  if (!decision.ok) refuse(check, decision.code);
  await approve();
  const overrideIds: string[] = [];
  const notified: string[] = [];
  for (const c of swapChanges(r, pair)) {
    if (!c.after) continue;
    await tx.query(`UPDATE shift SET staff_id = $2 WHERE id = $1`, [c.before.id, c.after.staffId]);
    const oid = await insertOverride(
      { id: c.before.id, rosterId: c.before.rosterId },
      'swap',
      c.before.staffId,
      c.after.staffId,
      shiftState(c.before),
      shiftState(c.after),
      decision.reason,
      [...decision.ruleBreaches],
    );
    overrideIds.push(oid);
    // Both cashiers hear about their own shift (P11); a rule override also reaches planners and HR.
    notified.push(...(await notifyShiftChanged(tx, oid)));
  }
  notified.push(...(await notifyStaffRequestDecided(tx, id)));
  if (r.target_staff_id === null) {
    const store = await queryMaybe<{ name: string }>(tx, `SELECT name FROM store WHERE id = $1`, [pair.offered.storeId]);
    notified.push(...(await notifyShiftsLeftOpen(tx, { id: pair.offered.storeId, name: store?.name ?? '' }, [pair.offered.id], r.synthetic)));
  }
  await audit.record(tx, {
    action: 'decision',
    event: 'staff_request.approved',
    objectType: 'staff_request',
    objectId: id,
    before: { status: 'pending', offered: shiftState(pair.offered), target: shiftState(pair.target) },
    after: {
      ...requestAuditState(rowState(r)),
      status: 'approved',
      note,
      reason: decision.reason,
      ruleBreaches: decision.ruleBreaches.map((b) => ({ rule: b.rule, staffId: b.staffId, date: b.date })),
      overrideIds,
      notifiedUserIds: [...new Set(notified)].sort(),
    },
    synthetic: r.synthetic,
  });
}
