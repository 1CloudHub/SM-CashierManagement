/**
 * Scenario lifecycle and approval steps (Requirements 8 and 9; P3, P4, P5, P10).
 *
 * Lifecycle: Draft -> Submitted -> Approved -> Published -> Superseded, with
 * Archived as the terminal state. A Submitted scenario returns to Draft when an
 * approver requests changes or the Executive rejects (Req 9.6). Approving the
 * plan publishes it (Req 9.5); the previous Published scenario for the season
 * becomes Superseded (P3). Enforcement lives in the API (task 11/12); these are
 * the shared rules and helpers.
 */
import type { IsoDateTime } from './entities.js';
import type { RoleCode } from './roles.js';

export const SCENARIO_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'published',
  'superseded',
  'archived',
] as const;

export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

/** Allowed lifecycle transitions, keyed by the current status. */
export const SCENARIO_TRANSITIONS: Readonly<Record<ScenarioStatus, readonly ScenarioStatus[]>> = {
  draft: ['submitted', 'archived'],
  submitted: ['draft', 'approved'],
  approved: ['published', 'draft'],
  published: ['superseded'],
  superseded: ['archived'],
  archived: [],
};

export function canTransitionScenario(from: ScenarioStatus, to: ScenarioStatus): boolean {
  return SCENARIO_TRANSITIONS[from].includes(to);
}

/** Settings are editable only in Draft; any other state requires "Duplicate as draft" (P4). */
export function isScenarioSettingsEditable(status: ScenarioStatus): boolean {
  return status === 'draft';
}

export interface ScenarioSummary {
  readonly id: string;
  readonly name: string;
  readonly season: string;
  readonly status: ScenarioStatus;
  /** True when the snapshot or rules version is superseded or settings changed after the last run (P5). */
  readonly stale: boolean;
  readonly ownerId: string;
  readonly rulesVersionId: string;
  readonly snapshotId: string;
  readonly parentScenarioId: string | null;
  readonly updatedAt: IsoDateTime;
}

export const APPROVAL_STEP_KINDS = ['headcount', 'budget', 'plan'] as const;
export type ApprovalStepKind = (typeof APPROVAL_STEP_KINDS)[number];

/** Role that decides each approval step (Q3). */
export const APPROVER_ROLE_BY_STEP: Readonly<Record<ApprovalStepKind, RoleCode>> = {
  headcount: 'HR',
  budget: 'FIN',
  plan: 'EXE',
};

export const APPROVAL_STEP_STATUSES = [
  'pending',
  'approved',
  'changes_requested',
  'rejected',
  /** Recorded as secured outside the system by the Executive (Q19). */
  'secured_outside',
] as const;

export type ApprovalStepStatus = (typeof APPROVAL_STEP_STATUSES)[number];

export interface ApprovalStepSummary {
  readonly step: ApprovalStepKind;
  readonly submissionNo: number;
  readonly status: ApprovalStepStatus;
}

export interface ApprovalStep extends ApprovalStepSummary {
  readonly scenarioId: string;
  readonly decidedBy: string | null;
  readonly decidedAsRole: RoleCode | null;
  readonly comment: string | null;
  /** Free-text reference for an outside-system record (e.g. a board minute). */
  readonly reference: string | null;
  readonly decidedAt: IsoDateTime | null;
}

export function isStepSecured(status: ApprovalStepStatus): boolean {
  return status === 'approved' || status === 'secured_outside';
}

/**
 * A plan can be approved/published only when both the headcount and budget
 * steps of the current submission are secured, in system or outside it (P10).
 */
export function canPublishPlan(
  currentSubmissionNo: number,
  steps: readonly ApprovalStepSummary[],
): boolean {
  const secured = (kind: ApprovalStepKind): boolean =>
    steps.some(
      (s) => s.submissionNo === currentSubmissionNo && s.step === kind && isStepSecured(s.status),
    );
  return secured('headcount') && secured('budget');
}
