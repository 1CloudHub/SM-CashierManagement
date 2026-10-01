/**
 * Shift offers (task 17.1; Req 13, 12.5; Q23, Q25; P7, P11, P14, P15, P16,
 * P17).
 *
 *   - `offerCandidates`: who may be offered an open shift — the
 *     `@lanewise/matching` ranking (consent, trained, available, within every
 *     labor rule with their hours at every store counted, travel limit).
 *   - `sendOffers`: re-runs that eligibility for the selection (P16), then
 *     records one offer per cashier with its terms (store, time, travel, pay,
 *     transport allowance by band) and a 30-minute expiry, notifies the
 *     cashiers and writes exactly one audit event.
 *   - `acceptOffer`: locks the shift row, so concurrent acceptances of the
 *     same shift run one after the other; the first finds the shift open and
 *     wins, the rest find it filled (P17). The labor rules are re-checked
 *     with the cashier's hours at every store (P14/P16), the shift is
 *     assigned (an `offer_fill` ShiftOverride), the other offers are
 *     withdrawn at that same moment (0170 trigger) and the sender notified.
 *     The 0004 partial unique index is the database backstop.
 *   - `declineOffer`, `expireDueOffers`: notify the sender. Expiry is a
 *     time-based state change, not a user action, so it writes no audit
 *     event; it runs from the jobs worker on a schedule and lazily before
 *     every offer read or write (the in-process fallback).
 */
import {
  OFFER_EXPIRY_MINUTES,
  costFigure,
  shiftLocalTimes,
  transportAllowanceFor,
  type CostDraft,
  type MapTravelMode,
  type MyOfferDto,
  type OfferCandidatesResponse,
  type ShiftOfferDto,
  type ShiftOfferStatus,
} from '@lanewise/shared';
import type { OpenShift } from '@lanewise/matching';
import type pg from 'pg';
import { ApiError, errors } from '../../http/errors.js';
import { rankForShift } from '../../network-map/service.js';
import { allowanceBands, payRules, shiftPay } from '../../offers/terms.js';
import { audit, type AuditedTx } from '../audit.js';
import { withTransaction, type Queryable } from '../pool.js';
import { queryMaybe } from '../rows.js';
import { departmentKey } from './network-map.js';
import { checkFill, loadShiftOnRoster, notifyInScope, recordFill, type ShiftOnRoster } from './rosters.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SHIFT_FILLED_MESSAGE = 'This shift has just been filled.';

// ---------------------------------------------------------------------------
// Open shifts
// ---------------------------------------------------------------------------

export interface OpenShiftRecord extends ShiftOnRoster {
  readonly departmentName: string;
}

/**
 * The open shift `shiftId` on a published roster of `storeId`, or null when
 * it does not exist or belongs to another store (the same 404, P1). Throws
 * 409 when the shift exists but can no longer be offered.
 */
export async function openShift(db: Queryable, storeId: string, shiftId: string, now: Date, lock = false): Promise<OpenShiftRecord> {
  const shift = await loadShiftOnRoster(db, shiftId, lock);
  if (!shift || shift.storeId !== storeId) throw errors.notFoundOrNoAccess();
  if (shift.rosterStatus !== 'published') throw errors.conflict('Offers go out only for shifts on a published roster.');
  if (shift.status !== 'scheduled') throw errors.conflict('This shift was removed.');
  if (shift.staffId !== null) throw errors.conflict(SHIFT_FILLED_MESSAGE);
  if (shift.startsAt.getTime() <= now.getTime()) throw errors.conflict('This shift has already started.');
  const dept = await queryMaybe<{ name: string }>(db, 'SELECT name FROM department WHERE id = $1', [shift.departmentId]);
  return { ...shift, departmentName: dept?.name ?? '' };
}

/** The open shift as `@lanewise/matching` reads it (local clock hours; department by key). */
export function toOpenShift(shift: OpenShiftRecord): OpenShift {
  const t = shiftLocalTimes(shift.startsAt, shift.endsAt);
  return {
    shiftId: shift.id,
    storeId: shift.storeId,
    departmentId: departmentKey(shift.departmentName),
    date: t.date,
    startHour: t.startMin / 60,
    endHour: t.endMin / 60,
  };
}

async function liveOfferStaff(db: Queryable, shiftId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ staff_id: string }>(`SELECT staff_id FROM shift_offer WHERE shift_id = $1 AND status = 'sent'`, [shiftId]);
  return new Set(rows.map((r) => r.staff_id));
}

/** `GET /stores/:storeId/shifts/:shiftId/offer-candidates` */
export async function offerCandidates(
  db: Queryable,
  storeId: string,
  shiftId: string,
  options: { readonly mode: MapTravelMode; readonly maxTravelMin: number; readonly now: Date },
): Promise<OfferCandidatesResponse> {
  const shift = await openShift(db, storeId, shiftId, options.now);
  const [{ result, names }, bands, live] = await Promise.all([
    rankForShift(db, { synthetic: shift.synthetic, shift: toOpenShift(shift), mode: options.mode, maxTravelMin: options.maxTravelMin }),
    allowanceBands(db, shift.synthetic),
    liveOfferStaff(db, shift.id),
  ]);
  return {
    shiftId: shift.id,
    storeId,
    ...shiftLocalTimes(shift.startsAt, shift.endsAt),
    mode: options.mode,
    maxTravelMin: options.maxTravelMin,
    candidates: result.ranked.map((c) => ({
      staffId: c.staffId,
      displayId: c.displayId,
      homeStoreId: c.homeStoreId,
      homeStoreName: names.get(c.homeStoreId) ?? '',
      homeArea: { barangay: c.homeArea.barangay, city: c.homeArea.city },
      travelMin: c.travelMin,
      allowance: transportAllowanceFor(c.travelMin, bands),
      weeklyHours: { withShift: Math.round(c.weeklyHours.withShift * 100) / 100, limit: c.weeklyHours.limit },
      offered: live.has(c.staffId),
    })),
    excludedWithoutConsent: result.excludedWithoutConsent,
  };
}

// ---------------------------------------------------------------------------
// Reading offers
// ---------------------------------------------------------------------------

interface OfferRow extends pg.QueryResultRow {
  id: string;
  shift_id: string;
  roster_id: string;
  store_id: string;
  store_name: string;
  region_id: string;
  department_name: string;
  starts_at: Date;
  ends_at: Date;
  staff_id: string;
  employee_no: string;
  staff_name: string;
  staff_store_id: string;
  home_store_name: string;
  status: ShiftOfferStatus;
  sent_by_name: string;
  sent_by: string;
  sent_at: Date;
  expires_at: Date;
  responded_at: Date | null;
  travel_min: string | null;
  allowance_php: string;
  pay_php: string;
  synthetic: boolean;
}

const OFFER_SELECT = `
  SELECT o.id, o.shift_id, sh.roster_id, r.store_id, st.name AS store_name, st.region_id, d.name AS department_name,
         sh.starts_at, sh.ends_at, o.staff_id, s.employee_no, s.name AS staff_name, s.store_id AS staff_store_id,
         hs.name AS home_store_name, o.status, u.name AS sent_by_name, o.sent_by, o.sent_at, o.expires_at, o.responded_at,
         o.travel_min::text AS travel_min, o.allowance_php::text AS allowance_php, o.pay_php::text AS pay_php, o.synthetic
    FROM shift_offer o
    JOIN shift sh ON sh.id = o.shift_id
    JOIN roster r ON r.id = sh.roster_id
    JOIN store st ON st.id = r.store_id
    JOIN department d ON d.id = sh.department_id
    JOIN staff s ON s.id = o.staff_id
    JOIN store hs ON hs.id = s.store_id
    JOIN app_user u ON u.id = o.sent_by`;

const num = (v: string | null) => (v === null ? null : Number(v));

/** A sender / roster view of an offer: the name only once accepted or for the store's own cashier (Req 12.5); pay as a cost figure. */
function toOfferDto(r: OfferRow): CostDraft<ShiftOfferDto> {
  return {
    id: r.id,
    shiftId: r.shift_id,
    rosterId: r.roster_id,
    storeId: r.store_id,
    departmentName: r.department_name,
    ...shiftLocalTimes(r.starts_at, r.ends_at),
    staffId: r.staff_id,
    displayId: r.employee_no,
    name: r.status === 'accepted' || r.staff_store_id === r.store_id ? r.staff_name : null,
    homeStoreName: r.home_store_name,
    status: r.status,
    sentBy: r.sent_by_name,
    sentAt: r.sent_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    respondedAt: r.responded_at?.toISOString() ?? null,
    travelMin: num(r.travel_min),
    allowance: Number(r.allowance_php),
    pay: costFigure({ level: 'individual', store: { id: r.store_id, regionId: r.region_id } }, Number(r.pay_php)),
  };
}

function toMyOffer(r: OfferRow): MyOfferDto {
  return {
    id: r.id,
    storeName: r.store_name,
    departmentName: r.department_name,
    ...shiftLocalTimes(r.starts_at, r.ends_at),
    status: r.status,
    sentAt: r.sent_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    respondedAt: r.responded_at?.toISOString() ?? null,
    travelMin: num(r.travel_min),
    allowance: Number(r.allowance_php),
    pay: Number(r.pay_php),
  };
}

/** Offers for shifts of `storeId` (optionally one roster or one shift), newest first. */
export async function listStoreOffers(
  db: Queryable,
  storeId: string,
  filter: { readonly rosterId?: string | undefined; readonly shiftId?: string | undefined },
): Promise<CostDraft<ShiftOfferDto>[]> {
  const { rows } = await db.query<OfferRow>(
    `${OFFER_SELECT}
      WHERE r.store_id = $1 AND ($2::uuid IS NULL OR sh.roster_id = $2) AND ($3::uuid IS NULL OR o.shift_id = $3)
      ORDER BY o.sent_at DESC, s.employee_no, o.id
      LIMIT 500`,
    [storeId, filter.rosterId ?? null, filter.shiftId ?? null],
  );
  return rows.map(toOfferDto);
}

/** The cashier's own offers (P11): live ones first, then the last 14 days. */
export async function listMyOffers(db: Queryable, staffId: string, now: Date): Promise<MyOfferDto[]> {
  const { rows } = await db.query<OfferRow>(
    `${OFFER_SELECT}
      WHERE o.staff_id = $1 AND (o.status = 'sent' OR o.sent_at >= $2::timestamptz - interval '14 days')
      ORDER BY (o.status = 'sent') DESC, o.sent_at DESC, o.id
      LIMIT 100`,
    [staffId, now.toISOString()],
  );
  return rows.map(toMyOffer);
}

// ---------------------------------------------------------------------------
// Notifications (task 19 hook: rows in `notification`; delivery is task 19)
// ---------------------------------------------------------------------------

async function notifyUser(
  db: Queryable,
  userId: string,
  event: string,
  objectType: string,
  objectId: string,
  params: Record<string, unknown>,
  synthetic: boolean,
  severity: 'info' | 'warning' = 'info',
): Promise<void> {
  await db.query(
    `INSERT INTO notification (user_id, event, object_type, object_id, severity, params, synthetic)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [userId, event, objectType, objectId, severity, JSON.stringify(params), synthetic],
  );
}

// ---------------------------------------------------------------------------
// Expiry (Req 13.2, 13.5)
// ---------------------------------------------------------------------------

/**
 * Moves every sent offer whose 30 minutes are up to `expired` and notifies
 * each sender once per shift. Idempotent; safe to run concurrently.
 */
export async function expireDueOffers(pool: pg.Pool, now: Date): Promise<number> {
  return withTransaction(pool, async (tx) => {
    const { rows } = await tx.query<{ shift_id: string; sent_by: string; synthetic: boolean; n: number }>(
      `WITH due AS (
         SELECT id FROM shift_offer WHERE status = 'sent' AND expires_at <= $1::timestamptz
          ORDER BY id FOR UPDATE SKIP LOCKED
       ), expired AS (
         UPDATE shift_offer o SET status = 'expired' FROM due WHERE o.id = due.id AND o.status = 'sent'
         RETURNING o.shift_id, o.sent_by, o.synthetic
       )
       SELECT shift_id, sent_by, synthetic, count(*)::int AS n FROM expired GROUP BY shift_id, sent_by, synthetic`,
      [now.toISOString()],
    );
    for (const r of rows) {
      await notifyUser(tx, r.sent_by, 'shift_offer.expired', 'shift', r.shift_id, { count: r.n }, r.synthetic);
    }
    return rows.reduce((a, r) => a + r.n, 0);
  });
}

// ---------------------------------------------------------------------------
// Sending (Req 13.1; P16)
// ---------------------------------------------------------------------------

export interface SentOffers {
  readonly shiftId: string;
  readonly offerIds: readonly string[];
}

/** Records and broadcasts offers for an open shift to the selected eligible cashiers. Run in an audited transaction. */
export async function sendOffers(
  tx: AuditedTx,
  storeId: string,
  shiftId: string,
  request: { readonly staffIds: readonly string[]; readonly mode: MapTravelMode; readonly maxTravelMin: number },
  now: Date,
): Promise<SentOffers> {
  const shift = await openShift(tx, storeId, shiftId, now, true);
  const staffIds = [...new Set(request.staffIds)];
  const { result } = await rankForShift(tx, {
    synthetic: shift.synthetic,
    shift: toOpenShift(shift),
    mode: request.mode,
    maxTravelMin: request.maxTravelMin,
  });
  const eligible = new Map(result.ranked.map((c) => [c.staffId, c]));
  const excluded = new Map(result.excluded.map((c) => [c.staffId, c]));
  const live = await liveOfferStaff(tx, shift.id);
  const issues = staffIds.flatMap((id, i) => {
    if (live.has(id)) return [{ path: `body.staffIds.${i}`, message: 'This cashier already has a live offer for this shift.' }];
    if (eligible.has(id)) return [];
    const reasons = excluded.get(id)?.reasons.map((r) => r.code).join(', ');
    return [{ path: `body.staffIds.${i}`, message: reasons ? `Not eligible for this shift (${reasons}).` : 'Not eligible for this shift.' }];
  });
  if (issues.length > 0) throw errors.validationFailed('Offers go only to eligible cashiers.', issues);

  const [bands, rules] = await Promise.all([allowanceBands(tx, shift.synthetic), payRules(tx, shift.synthetic)]);
  const pay = shiftPay(shift, rules);
  const expiresAt = new Date(now.getTime() + OFFER_EXPIRY_MINUTES * 60_000);
  const times = shiftLocalTimes(shift.startsAt, shift.endsAt);
  const offerIds: string[] = [];
  const notified: string[] = [];
  for (const staffId of staffIds) {
    const c = eligible.get(staffId);
    if (!c) continue;
    const allowance = transportAllowanceFor(c.travelMin, bands);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO shift_offer (shift_id, staff_id, sent_by, sent_at, expires_at, travel_min, allowance_php, pay_php, travel_mode, synthetic)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [shift.id, staffId, tx.actor.userId, now.toISOString(), expiresAt.toISOString(), c.travelMin, allowance, pay, request.mode, shift.synthetic],
    );
    const offerId = rows[0]?.id ?? '';
    offerIds.push(offerId);
    const user = await queryMaybe<{ user_id: string }>(tx, 'SELECT user_id FROM staff WHERE id = $1 AND user_id IS NOT NULL', [staffId]);
    if (user) {
      await notifyUser(
        tx,
        user.user_id,
        'shift_offer.received',
        'shift_offer',
        offerId,
        { date: times.date, startMin: times.startMin, endMin: times.endMin, travelMin: c.travelMin, allowance, pay, expiresAt: expiresAt.toISOString() },
        shift.synthetic,
        'warning',
      );
      notified.push(user.user_id);
    }
  }

  await audit.record(tx, {
    action: 'create',
    event: 'shift_offer.sent',
    objectType: 'shift',
    objectId: shift.id,
    after: {
      storeId,
      rosterId: shift.rosterId,
      offerIds,
      staffIds,
      mode: request.mode,
      maxTravelMin: request.maxTravelMin,
      expiresAt: expiresAt.toISOString(),
      notifiedUserIds: notified.sort(),
    },
    synthetic: shift.synthetic,
  });
  return { shiftId: shift.id, offerIds };
}

// ---------------------------------------------------------------------------
// Responding (Req 13.3–13.5, 15.2; P17)
// ---------------------------------------------------------------------------

interface OwnOffer {
  readonly id: string;
  readonly shiftId: string;
  readonly staffId: string;
  readonly sentBy: string;
  readonly status: ShiftOfferStatus;
  readonly expiresAt: Date;
  readonly synthetic: boolean;
}

async function ownOffer(db: Queryable, staffId: string, offerId: string, lock: boolean): Promise<OwnOffer> {
  if (!UUID.test(offerId)) throw errors.notFoundOrNoAccess();
  const row = await queryMaybe<{ id: string; shift_id: string; staff_id: string; sent_by: string; status: ShiftOfferStatus; expires_at: Date; synthetic: boolean }>(
    db,
    `SELECT id, shift_id, staff_id, sent_by, status, expires_at, synthetic FROM shift_offer WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [offerId],
  );
  // Another cashier's offer is the same 404 as a missing one (P11).
  if (!row || row.staff_id !== staffId) throw errors.notFoundOrNoAccess();
  return { id: row.id, shiftId: row.shift_id, staffId: row.staff_id, sentBy: row.sent_by, status: row.status, expiresAt: row.expires_at, synthetic: row.synthetic };
}

function refuseClosed(offer: OwnOffer, now: Date): void {
  if (offer.status === 'accepted') throw errors.conflict('You have already accepted this shift.');
  if (offer.status === 'withdrawn') throw errors.conflict(SHIFT_FILLED_MESSAGE);
  if (offer.status === 'expired' || (offer.status === 'sent' && offer.expiresAt.getTime() <= now.getTime())) {
    throw errors.conflict('This offer has expired.');
  }
  if (offer.status !== 'sent') throw errors.conflict('You have already answered this offer.');
}

export interface Responded {
  readonly offerId: string;
}

/** The cashier `staffId` accepts `offerId`. Run in an audited transaction. */
export async function acceptOffer(tx: AuditedTx, staffId: string, offerId: string, now: Date): Promise<Responded> {
  const peek = await ownOffer(tx, staffId, offerId, false);
  // Lock the shift first: every acceptance of this shift queues here (P17).
  const shift = await loadShiftOnRoster(tx, peek.shiftId, true);
  if (!shift) throw errors.notFoundOrNoAccess();
  const offer = await ownOffer(tx, staffId, offerId, true);
  if (offer.status === 'withdrawn' || shift.staffId !== null) throw errors.conflict(SHIFT_FILLED_MESSAGE);
  refuseClosed(offer, now);
  if (shift.status !== 'scheduled' || shift.rosterStatus !== 'published') throw errors.conflict('This shift is no longer open.');

  // P14/P16 at the moment of acceptance: their hours at every store, incl. shifts taken since the offer.
  const { check } = await checkFill(tx, shift, staffId, true);
  if (check.status !== 'ok') {
    throw new ApiError('conflict', 'You can’t take this shift: it would break a labor rule.', {
      details: [...check.breaches, ...check.blocking].map((b) => ({ path: `breaches.${b.rule}`, message: b.message })),
    });
  }

  const respondedAt = now.toISOString();
  await tx.query(`UPDATE shift_offer SET status = 'accepted', responded_at = $2 WHERE id = $1`, [offer.id, respondedAt]);
  const { rows: withdrawn } = await tx.query<{ id: string; staff_id: string; user_id: string | null }>(
    `SELECT o.id, o.staff_id, s.user_id FROM shift_offer o JOIN staff s ON s.id = o.staff_id
      WHERE o.shift_id = $1 AND o.status = 'withdrawn' AND o.responded_at = $2 ORDER BY o.id`,
    [shift.id, respondedAt],
  );
  const overrideId = await recordFill(tx, shift, staffId, { type: 'offer_fill', offerId: offer.id }, null);

  const notified: string[] = [offer.sentBy];
  await notifyUser(tx, offer.sentBy, 'shift_offer.accepted', 'shift', shift.id, { offerId: offer.id, rosterId: shift.rosterId }, shift.synthetic);
  for (const w of withdrawn) {
    if (!w.user_id) continue;
    await notifyUser(tx, w.user_id, 'shift_offer.withdrawn', 'shift_offer', w.id, { reason: 'filled' }, shift.synthetic);
    notified.push(w.user_id);
  }
  const managers = await notifyInScope(
    tx,
    shift,
    ['STM'],
    'roster.shift_filled',
    shift.rosterId,
    'info',
    { shiftId: shift.id, offerId: offer.id },
  );
  notified.push(...managers);

  await audit.record(tx, {
    action: 'decision',
    event: 'shift_offer.accepted',
    objectType: 'shift_offer',
    objectId: offer.id,
    before: { status: 'sent' },
    after: {
      status: 'accepted',
      shiftId: shift.id,
      rosterId: shift.rosterId,
      storeId: shift.storeId,
      staffId,
      overrideId,
      withdrawnOfferIds: withdrawn.map((w) => w.id),
      notifiedUserIds: [...new Set(notified)].sort(),
    },
    synthetic: shift.synthetic,
  });
  return { offerId: offer.id };
}

/** The cashier `staffId` declines `offerId`. Run in an audited transaction. */
export async function declineOffer(tx: AuditedTx, staffId: string, offerId: string, now: Date): Promise<Responded> {
  const offer = await ownOffer(tx, staffId, offerId, true);
  refuseClosed(offer, now);
  await tx.query(`UPDATE shift_offer SET status = 'declined', responded_at = $2 WHERE id = $1`, [offer.id, now.toISOString()]);
  await notifyUser(tx, offer.sentBy, 'shift_offer.declined', 'shift', offer.shiftId, { offerId: offer.id }, offer.synthetic);
  await audit.record(tx, {
    action: 'decision',
    event: 'shift_offer.declined',
    objectType: 'shift_offer',
    objectId: offer.id,
    before: { status: 'sent' },
    after: { status: 'declined', shiftId: offer.shiftId, staffId, notifiedUserIds: [offer.sentBy] },
    synthetic: offer.synthetic,
  });
  return { offerId: offer.id };
}

/** One of the cashier's offers, as they see it. */
export async function myOffer(db: Queryable, staffId: string, offerId: string): Promise<MyOfferDto> {
  const row = await queryMaybe<OfferRow>(db, `${OFFER_SELECT} WHERE o.id = $1 AND o.staff_id = $2`, [offerId, staffId]);
  if (!row) throw errors.notFoundOrNoAccess();
  return toMyOffer(row);
}
