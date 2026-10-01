/**
 * Approval workflow — headcount, budget and plan (task 12; Requirement 9;
 * P7, P10; design.md › Scenario and approval lifecycle, SCR-033).
 *
 * The rules shared by the API (which enforces them, with the database as the
 * backstop) and the SPA (which enables only the actions they allow):
 *  - submitting opens three steps — Headcount (HR), Budget (Finance) and
 *    Plan (Executive) — and a resubmission opens fresh ones (Req 9.1, 9.6);
 *  - Headcount and Budget are decided in either order (Req 9.2);
 *  - only the Executive records Headcount or Budget as secured outside the
 *    system, with a reference and a note (Req 9.3, Q19);
 *  - every Plan decision stays disabled until both are secured (Req 9.4),
 *    and approving the plan publishes it (Req 9.5, P10);
 *  - requesting changes (any step) or rejecting (plan only) needs a comment
 *    and returns the scenario to Draft (Req 9.6);
 *  - a stale Submitted scenario is paused: no step can be decided (Req 8.5).
 *
 * `applyApprovalCommand` is the reference model of the whole sequence; the
 * property tests drive it (and the API) with random command sequences.
 */
import type { IsoDateTime } from './entities.js';
import { can, type RbacResource } from './rbac.js';
import type { RoleCode } from './roles.js';
import type { ResultsComparison, ScenarioListItem, ScenarioRunResults } from './scenario-planning.js';
import {
  APPROVAL_STEP_KINDS,
  canPublishPlan,
  type ApprovalStepKind,
  type ApprovalStepStatus,
  type ApprovalStepSummary,
  type ScenarioStatus,
} from './scenario.js';

export const APPROVAL_DECISIONS = ['approve', 'request_changes', 'reject'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** Decisions each step offers: only the Executive rejects, and only the plan (Req 9.6). */
export const STEP_DECISIONS: Readonly<Record<ApprovalStepKind, readonly ApprovalDecision[]>> = {
  headcount: ['approve', 'request_changes'],
  budget: ['approve', 'request_changes'],
  plan: ['approve', 'request_changes', 'reject'],
};

/** The step status a decision records. */
export const DECISION_STATUS: Readonly<Record<ApprovalDecision, ApprovalStepStatus>> = {
  approve: 'approved',
  request_changes: 'changes_requested',
  reject: 'rejected',
};

/** The RBAC matrix row that grants each step's decision (`approve`). */
export const APPROVAL_RESOURCE_BY_STEP: Readonly<Record<ApprovalStepKind, RbacResource>> = {
  headcount: 'approval_headcount',
  budget: 'approval_budget',
  plan: 'approval_plan',
};

/** Steps the Executive may record as secured outside the system (Q19). */
export const OUTSIDE_STEPS = ['headcount', 'budget'] as const;
export type OutsideStep = (typeof OUTSIDE_STEPS)[number];

export const APPROVAL_COMMENT_MAX = 2000;
export const APPROVAL_REFERENCE_MAX = 200;

/** Requesting changes and rejecting always need a comment (Req 9.6). */
export function decisionNeedsComment(decision: ApprovalDecision): boolean {
  return decision !== 'approve';
}

export function isOutsideStep(step: ApprovalStepKind): step is OutsideStep {
  return (OUTSIDE_STEPS as readonly string[]).includes(step);
}

// ---------------------------------------------------------------------------
// Who may do what, now
// ---------------------------------------------------------------------------

/** The approval state of a scenario: its lifecycle status and current submission's steps. */
export interface ApprovalState {
  readonly scenarioStatus: ScenarioStatus;
  /** A stale Submitted scenario is paused (Req 8.5). */
  readonly stale: boolean;
  readonly submissionNo: number;
  readonly steps: readonly ApprovalStepSummary[];
}

/** Why an approval action is unavailable. */
export type ApprovalBlocker =
  /** The active role may not take this action (P12). */
  | 'not_permitted'
  /** The scenario is not awaiting approval. */
  | 'not_submitted'
  /** The scenario became stale; approvals wait for a recalculated resubmission. */
  | 'paused'
  /** The step was already decided or recorded in this submission. */
  | 'step_decided'
  /** The plan waits for headcount and budget to be secured (P10). */
  | 'not_ready';

export function stepStatusOf(state: ApprovalState, step: ApprovalStepKind): ApprovalStepStatus | null {
  return state.steps.find((s) => s.submissionNo === state.submissionNo && s.step === step)?.status ?? null;
}

/** Headcount and budget of the current submission are both secured (P10). */
export function isPlanReady(state: ApprovalState): boolean {
  return state.submissionNo > 0 && canPublishPlan(state.submissionNo, state.steps);
}

function stateBlocker(state: ApprovalState, step: ApprovalStepKind): ApprovalBlocker | null {
  if (state.scenarioStatus !== 'submitted' || state.submissionNo < 1) return 'not_submitted';
  if (state.stale) return 'paused';
  if (stepStatusOf(state, step) !== 'pending') return 'step_decided';
  return null;
}

/** Why `role` cannot decide `step` now, or null when it can. */
export function decisionBlocker(role: RoleCode | null, state: ApprovalState, step: ApprovalStepKind): ApprovalBlocker | null {
  if (!can(role, APPROVAL_RESOURCE_BY_STEP[step], 'approve')) return 'not_permitted';
  const blocker = stateBlocker(state, step);
  if (blocker) return blocker;
  if (step === 'plan' && !isPlanReady(state)) return 'not_ready';
  return null;
}

/** Why `role` cannot record `step` as secured outside the system now, or null when it can. */
export function outsideRecordBlocker(role: RoleCode | null, state: ApprovalState, step: ApprovalStepKind): ApprovalBlocker | null {
  if (!isOutsideStep(step) || !can(role, 'approval_offsystem', 'edit')) return 'not_permitted';
  return stateBlocker(state, step);
}

/** What the active role can do on SCR-033 right now. */
export interface ApprovalActions {
  /** Decisions available per step (empty when blocked). */
  readonly decide: Readonly<Record<ApprovalStepKind, readonly ApprovalDecision[]>>;
  /** Steps the role can record as secured outside the system. */
  readonly recordOutside: readonly OutsideStep[];
  /** Why each step cannot be decided by this role now (null when it can). */
  readonly blockers: Readonly<Record<ApprovalStepKind, ApprovalBlocker | null>>;
}

export function approvalActionsFor(role: RoleCode | null, state: ApprovalState): ApprovalActions {
  const blockers = Object.fromEntries(APPROVAL_STEP_KINDS.map((k) => [k, decisionBlocker(role, state, k)])) as Record<
    ApprovalStepKind,
    ApprovalBlocker | null
  >;
  const decide = Object.fromEntries(APPROVAL_STEP_KINDS.map((k) => [k, blockers[k] ? [] : STEP_DECISIONS[k]])) as Record<
    ApprovalStepKind,
    readonly ApprovalDecision[]
  >;
  return {
    decide,
    recordOutside: OUTSIDE_STEPS.filter((k) => outsideRecordBlocker(role, state, k) === null),
    blockers,
  };
}

/** Whether the role has anything to act on (the "awaiting you" queue badge). */
export function awaitsRole(role: RoleCode | null, state: ApprovalState): boolean {
  const actions = approvalActionsFor(role, state);
  return APPROVAL_STEP_KINDS.some((k) => actions.decide[k].length > 0) || actions.recordOutside.length > 0;
}

// ---------------------------------------------------------------------------
// Reference model
// ---------------------------------------------------------------------------

export type ApprovalCommand =
  | { readonly kind: 'submit' }
  | {
      readonly kind: 'decide';
      readonly role: RoleCode;
      readonly step: ApprovalStepKind;
      readonly decision: ApprovalDecision;
      readonly comment?: string;
    }
  | { readonly kind: 'record_outside'; readonly role: RoleCode; readonly step: ApprovalStepKind; readonly reference?: string; readonly note?: string };

export type ApprovalRefusal = ApprovalBlocker | 'comment_required' | 'reference_required' | 'invalid_decision' | 'not_draft';

export type ApprovalOutcome =
  | { readonly ok: true; readonly state: ApprovalState; readonly published: boolean }
  | { readonly ok: false; readonly reason: ApprovalRefusal };

const blank = (s: string | undefined): boolean => (s ?? '').trim().length === 0;

function withStep(state: ApprovalState, step: ApprovalStepKind, status: ApprovalStepStatus): ApprovalStepSummary[] {
  return state.steps.map((s) => (s.submissionNo === state.submissionNo && s.step === step ? { ...s, status } : s));
}

/**
 * Applies one command to the approval state (the API's behaviour, without
 * persistence). Every accepted command is one audited mutation (P7); a
 * refused one changes nothing.
 */
export function applyApprovalCommand(state: ApprovalState, command: ApprovalCommand): ApprovalOutcome {
  if (command.kind === 'submit') {
    if (state.scenarioStatus !== 'draft') return { ok: false, reason: 'not_draft' };
    if (state.stale) return { ok: false, reason: 'paused' };
    const submissionNo = state.submissionNo + 1;
    return {
      ok: true,
      published: false,
      state: {
        scenarioStatus: 'submitted',
        stale: false,
        submissionNo,
        steps: [...state.steps, ...APPROVAL_STEP_KINDS.map((step) => ({ step, submissionNo, status: 'pending' as const }))],
      },
    };
  }
  if (command.kind === 'record_outside') {
    const blocker = outsideRecordBlocker(command.role, state, command.step);
    if (blocker) return { ok: false, reason: blocker };
    if (blank(command.reference) || blank(command.note)) return { ok: false, reason: 'reference_required' };
    return { ok: true, published: false, state: { ...state, steps: withStep(state, command.step, 'secured_outside') } };
  }
  const blocker = decisionBlocker(command.role, state, command.step);
  if (blocker) return { ok: false, reason: blocker };
  if (!STEP_DECISIONS[command.step].includes(command.decision)) return { ok: false, reason: 'invalid_decision' };
  if (decisionNeedsComment(command.decision) && blank(command.comment)) return { ok: false, reason: 'comment_required' };
  const steps = withStep(state, command.step, DECISION_STATUS[command.decision]);
  if (command.decision !== 'approve') return { ok: true, published: false, state: { ...state, scenarioStatus: 'draft', steps } };
  if (command.step === 'plan') return { ok: true, published: true, state: { ...state, scenarioStatus: 'published', steps } };
  return { ok: true, published: false, state: { ...state, steps } };
}

/** The step statuses of a submission, in tracker order (headcount, budget, plan). */
export function submissionStatuses(state: ApprovalState, submissionNo = state.submissionNo): ApprovalStepStatus[] {
  return APPROVAL_STEP_KINDS.map(
    (k) => state.steps.find((s) => s.submissionNo === submissionNo && s.step === k)?.status ?? 'pending',
  );
}

// ---------------------------------------------------------------------------
// API DTOs (`/approvals`)
// ---------------------------------------------------------------------------

export interface ApprovalPerson {
  readonly id: string;
  readonly name: string;
}

export interface ApprovalStepView {
  readonly step: ApprovalStepKind;
  readonly submissionNo: number;
  readonly status: ApprovalStepStatus;
  /** The role that decides this step in the system (Q3). */
  readonly approverRole: RoleCode;
  readonly decidedBy: ApprovalPerson | null;
  readonly decidedAsRole: RoleCode | null;
  readonly decidedAt: IsoDateTime | null;
  readonly comment: string | null;
  /** The Executive's off-system record, visible to HR and Finance (Req 9.3). */
  readonly outside: { readonly reference: string; readonly note: string | null } | null;
}

export interface ApprovalQueueItem {
  readonly scenarioId: string;
  readonly name: string;
  readonly season: string;
  readonly status: ScenarioStatus;
  readonly stale: boolean;
  readonly submissionNo: number;
  readonly submittedBy: ApprovalPerson | null;
  readonly submittedAt: IsoDateTime | null;
  readonly steps: readonly ApprovalStepSummary[];
  readonly planReady: boolean;
  /** The active role has an action on this scenario now. */
  readonly awaitingYou: boolean;
  readonly synthetic: boolean;
}

export interface ApprovalChecks {
  readonly runComplete: boolean;
  readonly notStale: boolean;
}

export interface ApprovalDetail {
  readonly scenario: ScenarioListItem & { readonly notes: string };
  readonly submissionNo: number;
  readonly submittedBy: ApprovalPerson | null;
  readonly submittedAt: IsoDateTime | null;
  /** The current submission's steps, in tracker order. */
  readonly steps: readonly ApprovalStepView[];
  /** Earlier submissions, newest first (reset on resubmission, Req 9.6). */
  readonly history: readonly { readonly submissionNo: number; readonly steps: readonly ApprovalStepView[] }[];
  readonly planReady: boolean;
  readonly checks: ApprovalChecks;
  readonly actions: ApprovalActions;
  /** Latest run results, limited to the viewer's scope; ₱ shaped for the role. */
  readonly results: ScenarioRunResults | null;
  /** The season's currently published plan, if another scenario holds it. */
  readonly published: { readonly id: string; readonly name: string } | null;
  /** Deltas vs the published plan (a = published, b = this scenario). */
  readonly changes: ResultsComparison | null;
}
