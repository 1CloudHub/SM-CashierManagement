/**
 * Store-to-store borrowing (task 17.2; Req 14; Q24; P7, P14, P16).
 *
 *   - `createBorrowRequest`: the receiving store asks a lending store for one
 *     cashier per open shift (on its published rosters); the lending store's
 *     manager is notified for approval (Req 14.1).
 *   - `lendCandidates`: the lending store's cashiers who could take each of
 *     the shifts — trained on the department (matched by name across
 *     stores), available, and within every labor rule with their hours at
 *     every store counted (P16).
 *   - `decideBorrowRequest`: the lending Store Manager approves (picking who
 *     goes) or declines; a Planner may approve instead only with a recorded
 *     reason (`overridden`, Q24). Approval re-checks every pick, fills the
 *     shifts on the receiving roster (`borrow_fill` ShiftOverrides, P14),
 *     withdraws any live offers for them, notifies the requester, planners
 *     and the lent cashiers, and writes exactly one audit event (P7). The
 *     borrowed cashiers then show on the receiving roster with home store and
 *     travel time, and their hours count to their own limits because labor
 *     checks read their shifts on every published roster (Req 14.3).
 */
import {
  assignBorrowedCashiers,
  shiftLocalTimes,
  type BorrowRequestDto,
  type BorrowStatus,
  type LendCandidate,
  type RoleCode,
} from '@lanewise/shared';
import type pg from 'pg';
import { ApiError, errors } from '../../http/errors.js';
import { straightLineMinutes } from '../../network-map/service.js';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { queryMaybe } from '../rows.js';
import { departmentKey, storeStoreKm } from './network-map.js';
import { checkFill, loadShiftOnRoster, notifyInScope, recordFill, type ShiftOnRoster } from './rosters.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Most shifts one borrow request may cover. */
export const MAX_BORROW_SHIFTS = 20;

interface StoreRow {
  id: string;
  name: string;
  region_id: string;
  active: boolean;
  synthetic: boolean;
}

async function store(db: Queryable, id: string): Promise<StoreRow | null> {
  if (!UUID.test(id)) return null;
  return queryMaybe<StoreRow>(db, 'SELECT id, name, region_id, active, synthetic FROM store WHERE id = $1', [id]);
}

const storeRef = (s: StoreRow) => ({ storeId: s.id, regionId: s.region_id, synthetic: s.synthetic });

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface RequestRow extends pg.QueryResultRow {
  id: string;
  from_store_id: string;
  from_store_name: string;
  to_store_id: string;
  to_store_name: string;
  department_name: string | null;
  window_start: Date;
  window_end: Date;
  requested_count: number;
  shift_ids: string[];
  travel_min: string | null;
  status: BorrowStatus;
  note: string | null;
  requested_by: string;
  requested_by_name: string;
  created_at: Date;
  decided_by_name: string | null;
  decided_at: Date | null;
  override_reason: string | null;
  decline_reason: string | null;
  synthetic: boolean;
}

const REQUEST_SELECT = `
  SELECT t.id, t.from_store_id, fs.name AS from_store_name, t.to_store_id, ts.name AS to_store_name, d.name AS department_name,
         t.window_start, t.window_end, t.requested_count, t.shift_ids, t.travel_min::text AS travel_min, t.status, t.note,
         t.requested_by, ru.name AS requested_by_name, t.created_at, du.name AS decided_by_name, t.decided_at,
         t.override_reason, t.decline_reason, t.synthetic
    FROM transfer_request t
    JOIN store fs ON fs.id = t.from_store_id
    JOIN store ts ON ts.id = t.to_store_id
    LEFT JOIN department d ON d.id = t.department_id
    JOIN app_user ru ON ru.id = t.requested_by
    LEFT JOIN app_user du ON du.id = t.decided_by`;

async function toDtos(db: Queryable, rows: readonly RequestRow[]): Promise<BorrowRequestDto[]> {
  const ids = rows.map((r) => r.id);
  const { rows: staff } =
    ids.length === 0
      ? { rows: [] }
      : await db.query<{ transfer_request_id: string; staff_id: string; employee_no: string; name: string; shift_id: string | null }>(
          `SELECT x.transfer_request_id, x.staff_id, s.employee_no, s.name, x.shift_id
             FROM transfer_request_staff x JOIN staff s ON s.id = x.staff_id
            WHERE x.transfer_request_id = ANY($1::uuid[]) ORDER BY s.employee_no, s.id`,
          [ids],
        );
  return rows.map((r) => ({
    id: r.id,
    fromStoreId: r.from_store_id,
    fromStoreName: r.from_store_name,
    toStoreId: r.to_store_id,
    toStoreName: r.to_store_name,
    departmentName: r.department_name,
    date: shiftLocalTimes(r.window_start, r.window_end).date,
    windowStart: r.window_start.toISOString(),
    windowEnd: r.window_end.toISOString(),
    count: r.requested_count,
    shiftIds: r.shift_ids,
    travelMin: r.travel_min === null ? null : Number(r.travel_min),
    status: r.status,
    note: r.note,
    requestedBy: r.requested_by_name,
    requestedAt: r.created_at.toISOString(),
    decidedBy: r.decided_by_name,
    decidedAt: r.decided_at?.toISOString() ?? null,
    overrideReason: r.override_reason,
    declineReason: r.decline_reason,
    cashiers: staff
      .filter((s) => s.transfer_request_id === r.id)
      .map((s) => ({ staffId: s.staff_id, employeeNo: s.employee_no, name: s.name, shiftId: s.shift_id ?? '' })),
  }));
}

/** Requests where `storeId` borrows (outgoing) and where it is asked to lend (incoming), newest first. */
export async function listBorrowRequests(db: Queryable, storeId: string): Promise<{ outgoing: BorrowRequestDto[]; incoming: BorrowRequestDto[] }> {
  const { rows } = await db.query<RequestRow>(
    `${REQUEST_SELECT} WHERE t.to_store_id = $1 OR t.from_store_id = $1 ORDER BY t.created_at DESC, t.id LIMIT 200`,
    [storeId],
  );
  const dtos = await toDtos(db, rows);
  return { outgoing: dtos.filter((d) => d.toStoreId === storeId), incoming: dtos.filter((d) => d.fromStoreId === storeId) };
}

export async function getBorrowRequest(db: Queryable, requestId: string): Promise<BorrowRequestDto | null> {
  if (!UUID.test(requestId)) return null;
  const row = await queryMaybe<RequestRow>(db, `${REQUEST_SELECT} WHERE t.id = $1`, [requestId]);
  return row ? ((await toDtos(db, [row]))[0] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Creating (Req 14.1)
// ---------------------------------------------------------------------------

function invalid(path: string, message: string): ApiError {
  return errors.validationFailed('This borrow request cannot be made.', [{ path: `body.${path}`, message }]);
}

/** Records a borrow request from the receiving store `toStoreId`. Run in an audited transaction. */
export async function createBorrowRequest(
  tx: AuditedTx,
  toStoreId: string,
  request: { readonly fromStoreId: string; readonly shiftIds: readonly string[]; readonly note?: string | undefined },
  now: Date,
): Promise<string> {
  const to = await store(tx, toStoreId);
  if (!to) throw errors.notFoundOrNoAccess();
  const from = await store(tx, request.fromStoreId);
  if (!from || !from.active || from.synthetic !== to.synthetic) throw invalid('fromStoreId', 'Pick an active store to borrow from.');
  if (from.id === to.id) throw invalid('fromStoreId', 'Pick another store to borrow from.');

  const shiftIds = [...new Set(request.shiftIds)];
  const shifts: ShiftOnRoster[] = [];
  for (const [i, id] of shiftIds.entries()) {
    const s = await loadShiftOnRoster(tx, id, true);
    if (!s || s.storeId !== to.id) throw invalid(`shiftIds.${i}`, 'Pick an open shift of this store.');
    if (s.rosterStatus !== 'published' || s.status !== 'scheduled' || s.staffId !== null) throw invalid(`shiftIds.${i}`, 'This shift is no longer open.');
    if (s.startsAt.getTime() <= now.getTime()) throw invalid(`shiftIds.${i}`, 'This shift has already started.');
    shifts.push(s);
  }
  const departmentId = shifts[0]?.departmentId ?? null;
  if (shifts.some((s) => s.departmentId !== departmentId)) throw invalid('shiftIds', 'Borrow for one department at a time.');
  const pending = await queryMaybe<{ id: string }>(
    tx,
    `SELECT id FROM transfer_request WHERE status = 'pending' AND shift_ids && $1::uuid[] LIMIT 1`,
    [shiftIds],
  );
  if (pending) throw errors.conflict('One of these shifts already has a pending borrow request.');

  const km = (await storeStoreKm(tx, [from.id, to.id])).get(`${from.id}|${to.id}`);
  const travelMin = km === undefined ? null : straightLineMinutes(km, 'public_transport');
  const windowStart = new Date(Math.min(...shifts.map((s) => s.startsAt.getTime())));
  const windowEnd = new Date(Math.max(...shifts.map((s) => s.endsAt.getTime())));
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO transfer_request (from_store_id, to_store_id, department_id, window_start, window_end, requested_count, shift_ids,
                                   travel_min, note, requested_by, synthetic)
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9, $10, $11) RETURNING id`,
    [from.id, to.id, departmentId, windowStart, windowEnd, shiftIds.length, shiftIds, travelMin, request.note?.trim() || null, tx.actor.userId, to.synthetic],
  );
  const id = rows[0]?.id ?? '';
  const notified = await notifyInScope(tx, storeRef(from), ['STM'], 'borrow.requested', id, 'warning', {
    toStoreId: to.id,
    toStoreName: to.name,
    count: shiftIds.length,
    windowStart: windowStart.toISOString(),
  });
  await audit.record(tx, {
    action: 'create',
    event: 'transfer_request.created',
    objectType: 'transfer_request',
    objectId: id,
    after: { fromStoreId: from.id, toStoreId: to.id, shiftIds, count: shiftIds.length, travelMin, notifiedUserIds: notified.sort() },
    synthetic: to.synthetic,
  });
  return id;
}

// ---------------------------------------------------------------------------
// Eligibility of lending-store cashiers (P16)
// ---------------------------------------------------------------------------

interface LockedRequest {
  readonly id: string;
  readonly fromStoreId: string;
  readonly toStoreId: string;
  readonly shiftIds: readonly string[];
  readonly requestedBy: string;
  readonly status: BorrowStatus;
  readonly synthetic: boolean;
}

async function loadRequest(db: Queryable, fromStoreId: string, requestId: string, lock: boolean): Promise<LockedRequest> {
  if (!UUID.test(requestId)) throw errors.notFoundOrNoAccess();
  const row = await queryMaybe<{ id: string; from_store_id: string; to_store_id: string; shift_ids: string[]; requested_by: string; status: BorrowStatus; synthetic: boolean }>(
    db,
    `SELECT id, from_store_id, to_store_id, shift_ids, requested_by, status, synthetic FROM transfer_request WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [requestId],
  );
  // A request addressed to another lending store is the same 404 as a missing one (P1).
  if (!row || row.from_store_id !== fromStoreId) throw errors.notFoundOrNoAccess();
  return {
    id: row.id,
    fromStoreId: row.from_store_id,
    toStoreId: row.to_store_id,
    shiftIds: row.shift_ids,
    requestedBy: row.requested_by,
    status: row.status,
    synthetic: row.synthetic,
  };
}

interface Lender {
  readonly id: string;
  readonly employeeNo: string;
  readonly name: string;
  readonly departmentKeys: readonly string[];
  readonly userId: string | null;
}

async function lenders(db: Queryable, fromStoreId: string, synthetic: boolean, ids?: readonly string[]): Promise<Lender[]> {
  const { rows } = await db.query<{ id: string; employee_no: string; name: string; user_id: string | null; departments: string[] }>(
    `SELECT s.id, s.employee_no, s.name, s.user_id,
            array(SELECT d.name FROM department d WHERE d.id = s.department_id
                  UNION SELECT d.name FROM staff_training t JOIN department d ON d.id = t.department_id WHERE t.staff_id = s.id) AS departments
       FROM staff s
      WHERE s.store_id = $1 AND s.active AND s.synthetic = $2 AND ($3::uuid[] IS NULL OR s.id = ANY($3::uuid[]))
      ORDER BY s.employee_no, s.id`,
    [fromStoreId, synthetic, ids ?? null],
  );
  return rows.map((r) => ({ id: r.id, employeeNo: r.employee_no, name: r.name, userId: r.user_id, departmentKeys: r.departments.map(departmentKey) }));
}

async function unavailableDuring(db: Queryable, staffId: string, shift: ShiftOnRoster): Promise<boolean> {
  const row = await queryMaybe(
    db,
    `SELECT 1 FROM staff_availability WHERE staff_id = $1 AND kind = 'unavailable' AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
    [staffId, shift.startsAt, shift.endsAt],
  );
  return row !== null;
}

/** Whether `lender` may take `shift`: trained, available, within every labor rule counting all stores (P16). */
async function canTake(db: Queryable, lender: Lender, shift: ShiftOnRoster, deptKey: string, lock: boolean): Promise<boolean> {
  if (!lender.departmentKeys.includes(deptKey)) return false;
  if (await unavailableDuring(db, lender.id, shift)) return false;
  const { check } = await checkFill(db, shift, lender.id, lock);
  return check.status === 'ok';
}

async function deptKeyOf(db: Queryable, departmentId: string): Promise<string> {
  const row = await queryMaybe<{ name: string }>(db, 'SELECT name FROM department WHERE id = $1', [departmentId]);
  return departmentKey(row?.name ?? '');
}

async function weekHours(db: Queryable, staffId: string, anchor: Date): Promise<number> {
  const row = await queryMaybe<{ h: string }>(
    db,
    `SELECT coalesce(sum(extract(epoch FROM sh.ends_at - sh.starts_at)) / 3600.0, 0)::text AS h
       FROM shift sh JOIN roster r ON r.id = sh.roster_id
      WHERE sh.staff_id = $1 AND sh.status = 'scheduled' AND r.status = 'published'
        AND date_trunc('week', sh.starts_at AT TIME ZONE 'Asia/Manila') = date_trunc('week', $2::timestamptz AT TIME ZONE 'Asia/Manila')`,
    [staffId, anchor],
  );
  return Math.round(Number(row?.h ?? 0) * 100) / 100;
}

/** `GET /stores/:storeId/borrow-requests/:requestId/candidates` — `storeId` is the lending store. */
export async function lendCandidates(db: Queryable, fromStoreId: string, requestId: string): Promise<LendCandidate[]> {
  const request = await loadRequest(db, fromStoreId, requestId, false);
  const shifts = (await Promise.all(request.shiftIds.map((id) => loadShiftOnRoster(db, id)))).filter(
    (s): s is ShiftOnRoster => s !== null && s.status === 'scheduled' && s.staffId === null,
  );
  if (shifts.length === 0) return [];
  const deptKey = await deptKeyOf(db, shifts[0]?.departmentId ?? '');
  const out: LendCandidate[] = [];
  for (const lender of await lenders(db, fromStoreId, request.synthetic)) {
    const eligibleShiftIds: string[] = [];
    for (const s of shifts) if (await canTake(db, lender, s, deptKey, false)) eligibleShiftIds.push(s.id);
    if (eligibleShiftIds.length === 0) continue;
    out.push({ staffId: lender.id, employeeNo: lender.employeeNo, name: lender.name, weekHours: await weekHours(db, lender.id, shifts[0]?.startsAt ?? new Date()), eligibleShiftIds });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deciding (Req 14.2, 14.3; Q24)
// ---------------------------------------------------------------------------

export type BorrowDecision =
  | { readonly decision: 'approve'; readonly staffIds: readonly string[]; readonly reason?: string | undefined }
  | { readonly decision: 'decline'; readonly reason?: string | undefined };

/**
 * Approves or declines a borrow request addressed to `fromStoreId`. The
 * lending Store Manager approves; any other permitted role (a Planner)
 * approves only with a reason, recorded as an override. Run in an audited
 * transaction.
 */
export async function decideBorrowRequest(
  tx: AuditedTx,
  fromStoreId: string,
  requestId: string,
  decision: BorrowDecision,
  role: RoleCode,
  now: Date,
): Promise<BorrowStatus> {
  const request = await loadRequest(tx, fromStoreId, requestId, true);
  if (request.status !== 'pending') throw errors.conflict(`This request is already ${request.status}.`);
  const [from, to] = await Promise.all([store(tx, request.fromStoreId), store(tx, request.toStoreId)]);
  if (!from || !to) throw errors.notFound();
  const reason = decision.reason?.trim() || null;

  if (decision.decision === 'decline') {
    await tx.query(`UPDATE transfer_request SET status = 'declined', decided_by = $2, decided_at = $3, decline_reason = $4 WHERE id = $1`, [
      request.id,
      tx.actor.userId,
      now,
      reason,
    ]);
    const notified = await notifyInScope(tx, storeRef(to), ['PLN'], 'borrow.declined', request.id, 'info', { fromStoreName: from.name });
    if (request.requestedBy !== tx.actor.userId && !notified.includes(request.requestedBy)) {
      await tx.query(
        `INSERT INTO notification (user_id, event, object_type, object_id, severity, params, synthetic)
         VALUES ($1, 'borrow.declined', 'transfer_request', $2, 'info', $3::jsonb, $4)`,
        [request.requestedBy, request.id, JSON.stringify({ fromStoreName: from.name }), request.synthetic],
      );
      notified.push(request.requestedBy);
    }
    await audit.record(tx, {
      action: 'decision',
      event: 'transfer_request.declined',
      objectType: 'transfer_request',
      objectId: request.id,
      before: { status: 'pending' },
      after: { status: 'declined', reason, notifiedUserIds: [...new Set(notified)].sort() },
      synthetic: request.synthetic,
    });
    return 'declined';
  }

  // Approve: the lending manager, or a Planner override with a reason (Q24).
  const status: BorrowStatus = role === 'STM' ? 'approved' : 'overridden';
  if (status === 'overridden' && !reason) {
    throw errors.validationFailed('Give a reason to approve instead of the lending store manager.', [
      { path: 'body.reason', message: 'A reason is required to override the lending store manager.' },
    ]);
  }
  const staffIds = [...new Set(decision.staffIds)];
  if (staffIds.length === 0 || staffIds.length > request.shiftIds.length) {
    throw errors.validationFailed('Pick who goes.', [{ path: 'body.staffIds', message: `Pick 1 to ${request.shiftIds.length} cashiers.` }]);
  }
  const shifts: ShiftOnRoster[] = [];
  for (const id of request.shiftIds) {
    const s = await loadShiftOnRoster(tx, id, true);
    if (s && s.status === 'scheduled' && s.staffId === null && s.rosterStatus === 'published') shifts.push(s);
  }
  if (shifts.length < staffIds.length) throw errors.conflict('Some of the requested shifts have been filled meanwhile.');
  const deptKey = await deptKeyOf(tx, shifts[0]?.departmentId ?? '');
  const picked = await lenders(tx, request.fromStoreId, request.synthetic, staffIds);
  const picks: { staffId: string; eligibleShiftIds: string[] }[] = [];
  const issues: { path: string; message: string }[] = [];
  for (const [i, id] of staffIds.entries()) {
    const lender = picked.find((l) => l.id === id);
    if (!lender) {
      issues.push({ path: `body.staffIds.${i}`, message: 'Pick an active cashier of the lending store.' });
      continue;
    }
    const eligibleShiftIds: string[] = [];
    for (const s of shifts) if (await canTake(tx, lender, s, deptKey, true)) eligibleShiftIds.push(s.id);
    if (eligibleShiftIds.length === 0) issues.push({ path: `body.staffIds.${i}`, message: 'This cashier can’t take any of the shifts within the labor rules.' });
    picks.push({ staffId: id, eligibleShiftIds });
  }
  if (issues.length > 0) throw errors.validationFailed('Only eligible cashiers can be lent.', issues);
  const assignment = assignBorrowedCashiers(
    shifts.map((s) => s.id),
    picks,
  );
  if (!assignment) throw errors.validationFailed('These cashiers can’t all be placed on the shifts.', [{ path: 'body.staffIds', message: 'Pick cashiers who can take different shifts.' }]);

  await tx.query(`UPDATE transfer_request SET status = $2, decided_by = $3, decided_at = $4, override_reason = $5 WHERE id = $1`, [
    request.id,
    status,
    tx.actor.userId,
    now,
    status === 'overridden' ? reason : null,
  ]);
  const overrideIds: string[] = [];
  const notified: string[] = [];
  for (const a of assignment) {
    const shift = shifts.find((s) => s.id === a.shiftId) as ShiftOnRoster;
    overrideIds.push(await recordFill(tx, shift, a.staffId, { type: 'borrow_fill', transferRequestId: request.id }, status === 'overridden' ? reason : null));
    await tx.query(`INSERT INTO transfer_request_staff (transfer_request_id, staff_id, shift_id, synthetic) VALUES ($1, $2, $3, $4)`, [
      request.id,
      a.staffId,
      a.shiftId,
      request.synthetic,
    ]);
    const lender = picked.find((l) => l.id === a.staffId) as Lender;
    if (lender.userId) {
      await tx.query(
        `INSERT INTO notification (user_id, event, object_type, object_id, severity, params, synthetic)
         VALUES ($1, 'shift.changed', 'shift', $2, 'info', $3::jsonb, $4)`,
        [lender.userId, a.shiftId, JSON.stringify({ change: 'borrow_fill', role: 'assigned', storeName: to.name }), request.synthetic],
      );
      notified.push(lender.userId);
    }
  }
  // Offers still out for the filled shifts are withdrawn now.
  const { rows: withdrawn } = await tx.query<{ id: string }>(
    `UPDATE shift_offer SET status = 'withdrawn', responded_at = $2 WHERE shift_id = ANY($1::uuid[]) AND status = 'sent' RETURNING id`,
    [assignment.map((a) => a.shiftId), now],
  );
  const event = status === 'overridden' ? 'borrow.overridden' : 'borrow.approved';
  const planners = await notifyInScope(tx, storeRef(to), ['PLN'], event, request.id, 'info', { fromStoreName: from.name, count: assignment.length });
  notified.push(...planners);
  if (request.requestedBy !== tx.actor.userId && !planners.includes(request.requestedBy)) {
    await tx.query(
      `INSERT INTO notification (user_id, event, object_type, object_id, severity, params, synthetic)
       VALUES ($1, $2, 'transfer_request', $3, 'info', $4::jsonb, $5)`,
      [request.requestedBy, event, request.id, JSON.stringify({ fromStoreName: from.name, count: assignment.length }), request.synthetic],
    );
    notified.push(request.requestedBy);
  }
  if (status === 'overridden') {
    // The lending manager learns that a Planner decided for their store.
    notified.push(...(await notifyInScope(tx, storeRef(from), ['STM'], 'borrow.overridden', request.id, 'warning', { toStoreName: to.name, reason })));
  }

  await audit.record(tx, {
    action: 'decision',
    event: `transfer_request.${status}`,
    objectType: 'transfer_request',
    objectId: request.id,
    before: { status: 'pending' },
    after: {
      status,
      reason: status === 'overridden' ? reason : null,
      assignments: assignment,
      overrideIds,
      withdrawnOfferIds: withdrawn.map((w) => w.id),
      notifiedUserIds: [...new Set(notified)].sort(),
    },
    synthetic: request.synthetic,
  });
  return status;
}
