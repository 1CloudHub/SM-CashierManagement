/**
 * Domain events → notifications (design.md › Notifications; requirement 20.1).
 *
 * Each function raises the notifications for one domain event inside the
 * transaction that records it, with the recipients from the design's table:
 *
 *  - submitted for approval      → HR (headcount), Finance (budget)
 *  - headcount / budget secured  → Executives, HR, Finance, submitter;
 *                                  both secured → Executives: plan ready
 *  - step decided                → submitter, other approvers, planners
 *  - plan published              → every non-Staff role
 *  - shift changed (override)    → the affected cashier(s) (own shifts, P11);
 *                                  with a rule override also planners and HR
 *                                  of that store
 *  - open-shift offer sent       → the selected cashier
 *  - offer accepted / declined / expired → the sender
 *  - borrow requested / decided  → lending store manager / requester + planners
 *
 * Staleness, ingestion outcomes and rule publication are raised where those
 * changes happen (ingestion workflow, rules repository, migration 0120).
 * The actor never notifies themselves.
 */
import type { ApprovalStepKind } from '@lanewise/shared';
import type pg from 'pg';
import type { AuditedTx } from '../db/audit.js';
import { queryMaybe } from '../db/rows.js';
import { notify } from './notify.js';

export interface ScenarioRef {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly synthetic: boolean;
}

function exceptActor(tx: AuditedTx): string[] {
  return [tx.actor.userId];
}

/** A scenario was submitted: HR approves headcount, Finance approves budget (Req 9.1). */
export async function notifyApprovalRequested(tx: AuditedTx, scenario: ScenarioRef): Promise<void> {
  const base = { objectType: 'scenario', objectId: scenario.id, synthetic: scenario.synthetic };
  const params = { name: scenario.name };
  await notify(tx, {
    ...base,
    event: 'approval.headcount_requested',
    params,
    recipients: { roles: ['HR'], excludeUserIds: exceptActor(tx) },
  });
  await notify(tx, {
    ...base,
    event: 'approval.budget_requested',
    params,
    recipients: { roles: ['FIN'], excludeUserIds: exceptActor(tx) },
  });
}

/**
 * Headcount or budget was secured (in the system or recorded outside it).
 * Once both are secured the Executives are told the plan is ready.
 */
export async function notifyApprovalSecured(
  tx: AuditedTx,
  scenario: ScenarioRef,
  step: 'headcount' | 'budget',
  outside: boolean,
  submissionNo: number,
): Promise<void> {
  const base = { objectType: 'scenario', objectId: scenario.id, synthetic: scenario.synthetic };
  await notify(tx, {
    ...base,
    event: 'approval.secured',
    params: { name: scenario.name, step, outside },
    recipients: { roles: ['EXE', 'HR', 'FIN'], userIds: [scenario.ownerId], excludeUserIds: exceptActor(tx) },
  });
  const row = await queryMaybe<{ pending: number } & pg.QueryResultRow>(
    tx,
    `SELECT count(*)::int AS pending FROM approval_step
      WHERE scenario_id = $1 AND submission_no = $2 AND step IN ('headcount', 'budget')
        AND status NOT IN ('approved', 'secured_outside')`,
    [scenario.id, submissionNo],
  );
  if ((row?.pending ?? 1) === 0) {
    await notify(tx, {
      ...base,
      event: 'approval.plan_ready',
      params: { name: scenario.name },
      recipients: { roles: ['EXE'], excludeUserIds: exceptActor(tx) },
    });
  }
}

/** A step was approved, sent back for changes or rejected. */
export async function notifyApprovalDecided(
  tx: AuditedTx,
  scenario: ScenarioRef,
  step: ApprovalStepKind,
  decision: 'approved' | 'changes_requested' | 'rejected',
): Promise<void> {
  await notify(tx, {
    event: 'approval.decided',
    objectType: 'scenario',
    objectId: scenario.id,
    // Sent back or rejected asks the submitter to act.
    severity: decision === 'approved' ? 'info' : 'warning',
    params: { name: scenario.name, step, decision },
    synthetic: scenario.synthetic,
    recipients: {
      userIds: [scenario.ownerId],
      roles: ['EXE', 'HR', 'FIN', 'PLN'],
      excludeUserIds: exceptActor(tx),
    },
  });
}

/** The Executive approved the plan and it was published (Req 9.5). */
export async function notifyPlanPublished(tx: AuditedTx, scenario: ScenarioRef): Promise<void> {
  await notify(tx, {
    event: 'scenario.published',
    objectType: 'scenario',
    objectId: scenario.id,
    params: { name: scenario.name },
    synthetic: scenario.synthetic,
    recipients: {
      userIds: [scenario.ownerId],
      roles: ['ADM', 'EXE', 'PLN', 'STM', 'HR', 'FIN', 'RST'],
      excludeUserIds: exceptActor(tx),
    },
  });
}

interface OverrideRow extends pg.QueryResultRow {
  id: string;
  override_type: string;
  store_id: string;
  starts_at: Date;
  ends_at: Date;
  breaches: number;
  synthetic: boolean;
  from_user: string | null;
  to_user: string | null;
}

/**
 * A store manager changed a published roster (Req 6.2, 7): each affected
 * cashier hears about their own shift only (P11); a change that overrides a
 * labor rule also goes to the planners and HR of that store.
 */
export async function notifyShiftChanged(tx: AuditedTx, overrideId: string): Promise<string[]> {
  const o = await queryMaybe<OverrideRow>(
    tx,
    `SELECT so.id, so.override_type, r.store_id, sh.starts_at, sh.ends_at,
            jsonb_array_length(so.rule_breaches) AS breaches, so.synthetic,
            fs.user_id AS from_user, ts.user_id AS to_user
       FROM shift_override so
       JOIN roster r ON r.id = so.roster_id
       JOIN shift sh ON sh.id = so.shift_id
       LEFT JOIN staff fs ON fs.id = so.from_staff_id
       LEFT JOIN staff ts ON ts.id = so.to_staff_id
      WHERE so.id = $1`,
    [overrideId],
  );
  if (!o) return [];
  const cashiers = [o.from_user, o.to_user].filter((u): u is string => u !== null);
  const notified = await notify(tx, {
    event: 'shift.changed',
    objectType: 'shift_override',
    objectId: o.id,
    params: { change: o.override_type, startsAt: o.starts_at.toISOString(), endsAt: o.ends_at.toISOString() },
    synthetic: o.synthetic,
    recipients: { userIds: cashiers, excludeUserIds: exceptActor(tx) },
  });
  if (o.breaches > 0) {
    notified.push(
      ...(await notify(tx, {
        event: 'roster.override_rule_breach',
        objectType: 'shift_override',
        objectId: o.id,
        params: { change: o.override_type, breaches: o.breaches, startsAt: o.starts_at.toISOString() },
        synthetic: o.synthetic,
        recipients: { roles: ['PLN', 'HR'], storeIds: [o.store_id], excludeUserIds: exceptActor(tx) },
      })),
    );
  }
  return [...new Set(notified)].sort();
}

interface OfferRow extends pg.QueryResultRow {
  id: string;
  status: string;
  sent_by: string;
  staff_user: string | null;
  store_name: string;
  starts_at: Date;
  ends_at: Date;
  expires_at: Date;
  travel_min: string | null;
  synthetic: boolean;
}

async function loadOffer(tx: AuditedTx, offerId: string): Promise<OfferRow | null> {
  return queryMaybe<OfferRow>(
    tx,
    `SELECT o.id, o.status, o.sent_by, st.user_id AS staff_user, s.name AS store_name,
            sh.starts_at, sh.ends_at, o.expires_at, o.travel_min::text AS travel_min, o.synthetic
       FROM shift_offer o
       JOIN staff st ON st.id = o.staff_id
       JOIN shift sh ON sh.id = o.shift_id
       JOIN roster r ON r.id = sh.roster_id
       JOIN store s ON s.id = r.store_id
      WHERE o.id = $1`,
    [offerId],
  );
}

/** An open-shift offer went to a cashier (store, time, travel, expiry — Req 13). */
export async function notifyOfferSent(tx: AuditedTx, offerId: string): Promise<string[]> {
  const o = await loadOffer(tx, offerId);
  if (!o || o.staff_user === null) return [];
  return notify(tx, {
    event: 'offer.sent',
    objectType: 'shift_offer',
    objectId: o.id,
    params: {
      storeName: o.store_name,
      startsAt: o.starts_at.toISOString(),
      endsAt: o.ends_at.toISOString(),
      expiresAt: o.expires_at.toISOString(),
      travelMinutes: o.travel_min === null ? null : Number(o.travel_min),
    },
    synthetic: o.synthetic,
    recipients: { userIds: [o.staff_user], excludeUserIds: exceptActor(tx) },
  });
}

/** An offer was accepted, declined or expired: the sender is told (Req 13.5). */
export async function notifyOfferResolved(tx: AuditedTx, offerId: string): Promise<string[]> {
  const o = await loadOffer(tx, offerId);
  if (!o || !['accepted', 'declined', 'expired'].includes(o.status)) return [];
  return notify(tx, {
    event: 'offer.resolved',
    objectType: 'shift_offer',
    objectId: o.id,
    params: { outcome: o.status, storeName: o.store_name, startsAt: o.starts_at.toISOString() },
    synthetic: o.synthetic,
    recipients: { userIds: [o.sent_by], excludeUserIds: exceptActor(tx) },
  });
}

interface TransferRow extends pg.QueryResultRow {
  id: string;
  status: string;
  from_store_id: string;
  to_store_id: string;
  from_store: string;
  to_store: string;
  requested_by: string;
  synthetic: boolean;
}

async function loadTransfer(tx: AuditedTx, id: string): Promise<TransferRow | null> {
  return queryMaybe<TransferRow>(
    tx,
    `SELECT t.id, t.status, t.from_store_id, t.to_store_id, fs.name AS from_store, ts.name AS to_store,
            t.requested_by, t.synthetic
       FROM transfer_request t
       JOIN store fs ON fs.id = t.from_store_id
       JOIN store ts ON ts.id = t.to_store_id
      WHERE t.id = $1`,
    [id],
  );
}

/** A store asked to borrow cashiers: the lending store's manager approves (Req 14.1). */
export async function notifyBorrowRequested(tx: AuditedTx, transferId: string): Promise<string[]> {
  const t = await loadTransfer(tx, transferId);
  if (!t) return [];
  return notify(tx, {
    event: 'borrow.requested',
    objectType: 'transfer_request',
    objectId: t.id,
    params: { fromStore: t.from_store, toStore: t.to_store },
    synthetic: t.synthetic,
    recipients: { roles: ['STM'], storeIds: [t.from_store_id], excludeUserIds: exceptActor(tx) },
  });
}

/** A borrow request was approved or declined: the requester and the borrowing store's planners. */
export async function notifyBorrowDecided(tx: AuditedTx, transferId: string): Promise<string[]> {
  const t = await loadTransfer(tx, transferId);
  if (!t || !['approved', 'declined', 'overridden'].includes(t.status)) return [];
  return notify(tx, {
    event: 'borrow.decided',
    objectType: 'transfer_request',
    objectId: t.id,
    params: { outcome: t.status, fromStore: t.from_store, toStore: t.to_store },
    synthetic: t.synthetic,
    recipients: {
      userIds: [t.requested_by],
      roles: ['PLN'],
      storeIds: [t.to_store_id],
      excludeUserIds: exceptActor(tx),
    },
  });
}
