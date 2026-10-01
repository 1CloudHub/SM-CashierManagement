/**
 * Approval workflow (task 12; Req 9.1–9.7; SCR-033; P7, P10, P12).
 *
 * Reads the approval tracker of a scenario and runs each approval action as
 * one audited mutation (P7) on top of the step primitives in `./scenarios`:
 *  - an in-system decision on headcount (HR) / budget (Finance) / plan
 *    (Executive), with a required comment to request changes or reject;
 *  - the Executive's off-system record for headcount or budget;
 *  - approving the plan publishes the scenario and supersedes the season's
 *    previous published plan.
 *
 * Every action is checked against the shared workflow model
 * (`decisionBlocker` / `outsideRecordBlocker`) before it is written, and the
 * database refuses the same states independently (migrations 0003, 0120,
 * 0130). Notifications follow design.md › Notifications; they are derived
 * records, not audit events.
 */
import {
  APPROVER_ROLE_BY_STEP,
  DECISION_STATUS,
  decisionBlocker,
  outsideRecordBlocker,
  type ApprovalBlocker,
  type ApprovalDecision,
  type ApprovalPerson,
  type ApprovalState,
  type ApprovalStepKind,
  type ApprovalStepStatus,
  type ApprovalStepView,
  type OutsideStep,
  type RoleCode,
  type ScenarioStatus,
} from '@lanewise/shared';
import type pg from 'pg';
import type { AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { isoOrNull, queryMaybe } from '../rows.js';
import { syncStaleFlag } from './scenario-planning.js';
import { approvePlanAndPublish, decideApprovalStep, recordSecuredOutside, ScenarioStateError } from './scenarios.js';

/** Refusal of an approval action, with the shared blocker (mapped to 409 by the route). */
export class ApprovalBlockedError extends ScenarioStateError {
  constructor(readonly blocker: ApprovalBlocker | 'submission_changed') {
    super(BLOCKER_MESSAGES[blocker]);
    this.name = 'ApprovalBlockedError';
  }
}

const BLOCKER_MESSAGES: Record<ApprovalBlocker | 'submission_changed', string> = {
  not_permitted: 'Your active role cannot take this approval action.',
  not_submitted: 'This scenario is not awaiting approval.',
  paused: 'This scenario became stale, so approvals are paused until it is recalculated and resubmitted.',
  step_decided: 'This step has already been decided for this submission.',
  not_ready: 'The plan can be decided only after headcount and budget are both secured.',
  submission_changed: 'This scenario was resubmitted since you opened it. Reload to see the current submission.',
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface HeaderRow extends pg.QueryResultRow {
  id: string;
  name: string;
  status: ScenarioStatus;
  stale: boolean;
  season: string;
  synthetic: boolean;
  owner_id: string;
  current_submission_no: number;
  submitted_by: string | null;
  submitted_by_name: string | null;
  submitted_at: Date | null;
}

export interface ApprovalHeader {
  readonly id: string;
  readonly name: string;
  readonly status: ScenarioStatus;
  readonly stale: boolean;
  readonly season: string;
  readonly synthetic: boolean;
  readonly ownerId: string;
  readonly submissionNo: number;
  readonly submittedBy: ApprovalPerson | null;
  readonly submittedAt: string | null;
}

const SELECT_HEADER = `
  SELECT s.id, s.name, s.status, s.stale, s.season, s.synthetic, s.owner_id, s.current_submission_no,
         s.submitted_by, sb.name AS submitted_by_name, s.submitted_at
    FROM scenario s LEFT JOIN app_user sb ON sb.id = s.submitted_by`;

function toHeader(row: HeaderRow): ApprovalHeader {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    stale: row.stale,
    season: row.season,
    synthetic: row.synthetic,
    ownerId: row.owner_id,
    submissionNo: row.current_submission_no,
    submittedBy: row.submitted_by && row.submitted_by_name ? { id: row.submitted_by, name: row.submitted_by_name } : null,
    submittedAt: isoOrNull(row.submitted_at),
  };
}

export async function getApprovalHeader(db: Queryable, scenarioId: string): Promise<ApprovalHeader | null> {
  const row = await queryMaybe<HeaderRow>(db, `${SELECT_HEADER} WHERE s.id = $1`, [scenarioId]);
  return row && toHeader(row);
}

/** Scenarios with at least one submission, current approvals first. */
export async function listApprovalHeaders(db: Queryable, options: { pendingOnly: boolean }): Promise<ApprovalHeader[]> {
  const { rows } = await db.query<HeaderRow>(
    `${SELECT_HEADER}
      WHERE s.current_submission_no > 0 ${options.pendingOnly ? `AND s.status = 'submitted'` : ''}
      ORDER BY (s.status = 'submitted') DESC, coalesce(s.submitted_at, s.updated_at) DESC, s.id
      LIMIT 200`,
  );
  return rows.map(toHeader);
}

interface StepViewRow extends pg.QueryResultRow {
  scenario_id: string;
  submission_no: number;
  step: ApprovalStepKind;
  status: ApprovalStepStatus;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_as_role: RoleCode | null;
  decided_at: Date | null;
  comment: string | null;
  outside_reference: string | null;
  outside_note: string | null;
}

const STEP_ORDER: Record<ApprovalStepKind, number> = { headcount: 0, budget: 1, plan: 2 };

function toStepView(row: StepViewRow): ApprovalStepView {
  return {
    step: row.step,
    submissionNo: row.submission_no,
    status: row.status,
    approverRole: APPROVER_ROLE_BY_STEP[row.step],
    decidedBy: row.decided_by && row.decided_by_name ? { id: row.decided_by, name: row.decided_by_name } : null,
    decidedAsRole: row.decided_as_role,
    decidedAt: isoOrNull(row.decided_at),
    comment: row.comment,
    outside: row.status === 'secured_outside' && row.outside_reference ? { reference: row.outside_reference, note: row.outside_note } : null,
  };
}

async function stepRows(db: Queryable, scenarioIds: readonly string[]): Promise<StepViewRow[]> {
  if (scenarioIds.length === 0) return [];
  const { rows } = await db.query<StepViewRow>(
    `SELECT a.scenario_id, a.submission_no, a.step, a.status, a.decided_by, u.name AS decided_by_name, a.decided_as_role,
            a.decided_at, a.comment, a.outside_reference, a.outside_note
       FROM approval_step a LEFT JOIN app_user u ON u.id = a.decided_by
      WHERE a.scenario_id = ANY($1::uuid[])`,
    [scenarioIds],
  );
  return rows.sort((x, y) => y.submission_no - x.submission_no || STEP_ORDER[x.step] - STEP_ORDER[y.step]);
}

/** Steps per scenario id (all submissions, newest submission first). */
export async function stepsByScenario(db: Queryable, scenarioIds: readonly string[]): Promise<Map<string, ApprovalStepView[]>> {
  const out = new Map<string, ApprovalStepView[]>();
  for (const row of await stepRows(db, scenarioIds)) {
    const list = out.get(row.scenario_id) ?? [];
    list.push(toStepView(row));
    out.set(row.scenario_id, list);
  }
  return out;
}

export function approvalState(header: ApprovalHeader, steps: readonly ApprovalStepView[]): ApprovalState {
  return {
    scenarioStatus: header.status,
    stale: header.stale,
    submissionNo: header.submissionNo,
    steps: steps.map((s) => ({ step: s.step, submissionNo: s.submissionNo, status: s.status })),
  };
}

/** The season's published scenario other than `exceptId`, if any (same provenance, P18). */
export async function publishedPeer(
  db: Queryable,
  season: string,
  synthetic: boolean,
  exceptId: string,
): Promise<{ id: string; name: string } | null> {
  return queryMaybe<{ id: string; name: string }>(
    db,
    `SELECT id, name FROM scenario WHERE season = $1 AND synthetic = $2 AND status = 'published' AND id <> $3`,
    [season, synthetic, exceptId],
  );
}

// ---------------------------------------------------------------------------
// Mutations — each runs inside `withAuditedTransaction` and records one event
// ---------------------------------------------------------------------------

/**
 * Locks the scenario, refreshes its stale flag (a stale Submitted scenario is
 * paused) and returns its current approval state.
 */
async function lockedState(tx: AuditedTx, scenarioId: string, expectedSubmissionNo: number | undefined) {
  const locked = await queryMaybe<{ id: string }>(tx, 'SELECT id FROM scenario WHERE id = $1 FOR UPDATE', [scenarioId]);
  if (!locked) throw new ScenarioStateError('scenario not found');
  const header = await getApprovalHeader(tx, scenarioId);
  if (!header) throw new ScenarioStateError('scenario not found');
  if (expectedSubmissionNo !== undefined && expectedSubmissionNo !== header.submissionNo) {
    throw new ApprovalBlockedError('submission_changed');
  }
  const steps = (await stepsByScenario(tx, [scenarioId])).get(scenarioId) ?? [];
  return { header, steps, state: approvalState(header, steps), name: header.name };
}

/**
 * The live stale flag of a Submitted scenario, written outside the decision's
 * transaction so a pause sticks even though the refused decision rolls back.
 */
export async function refreshPause(db: pg.Pool, scenarioId: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const row = await queryMaybe<{ status: ScenarioStatus }>(client, 'SELECT status FROM scenario WHERE id = $1 FOR UPDATE', [scenarioId]);
    if (row?.status === 'submitted') await syncStaleFlag(client, scenarioId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}


export interface DecideInput {
  readonly scenarioId: string;
  readonly step: ApprovalStepKind;
  readonly decision: ApprovalDecision;
  readonly comment?: string;
  readonly submissionNo?: number;
}

/**
 * Records an in-system decision by the acting role (Req 9.2, 9.4–9.6).
 * Approving the plan publishes the scenario (P10); requesting changes or
 * rejecting returns it to Draft. Exactly one audit event.
 */
export async function decide(tx: AuditedTx, input: DecideInput): Promise<{ published: boolean }> {
  const ctx = await lockedState(tx, input.scenarioId, input.submissionNo);
  const blocker = decisionBlocker(tx.actor.activeRole, ctx.state, input.step);
  if (blocker) throw new ApprovalBlockedError(blocker);
  const { header } = ctx;
  const comment = input.comment?.trim() || undefined;

  if (input.step === 'plan' && input.decision === 'approve') {
    // Notifications (scenario.published) come from approvePlanAndPublish (task 19 events).
    await approvePlanAndPublish(tx, header.id, comment);
    return { published: true };
  }

  const status = DECISION_STATUS[input.decision];
  await decideApprovalStep(tx, {
    scenarioId: header.id,
    step: input.step,
    decision: status as 'approved' | 'changes_requested' | 'rejected',
    ...(comment ? { comment } : {}),
  });
  // Secured / decided / plan-ready notifications come from decideApprovalStep (task 19 events).
  return { published: false };
}

export interface OutsideInput {
  readonly scenarioId: string;
  readonly step: OutsideStep;
  readonly reference: string;
  readonly note: string;
  readonly submissionNo?: number;
}

/** The Executive records headcount or budget as secured outside the system (Req 9.3). One audit event. */
export async function recordOutside(tx: AuditedTx, input: OutsideInput): Promise<void> {
  const ctx = await lockedState(tx, input.scenarioId, input.submissionNo);
  const blocker = outsideRecordBlocker(tx.actor.activeRole, ctx.state, input.step);
  if (blocker) throw new ApprovalBlockedError(blocker);
  await recordSecuredOutside(tx, { scenarioId: input.scenarioId, step: input.step, reference: input.reference.trim(), note: input.note.trim() });
  // The secured notification comes from recordSecuredOutside (task 19 events).
}
