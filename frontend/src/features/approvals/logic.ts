/**
 * Pure helpers for SCR-033 (task 12): step status tones, the URL of a
 * review, and the comment rule shared with the API.
 */
import { decisionNeedsComment, type ApprovalDecision, type ApprovalStepStatus } from '@lanewise/shared'
import type { StatusTone } from '@/components/ui'

export const STEP_STATUS_TONE: Record<ApprovalStepStatus, StatusTone> = {
  pending: 'neutral',
  approved: 'success',
  secured_outside: 'success',
  changes_requested: 'warning',
  rejected: 'danger',
}

const BASE = '/approvals'

/** SCR-033 for one scenario (`/approvals?scenario=`), or the queue. */
export function approvalPath(scenarioId?: string | null): string {
  return scenarioId ? `${BASE}?scenario=${encodeURIComponent(scenarioId)}` : BASE
}

export function scenarioFromSearch(search: string): string | null {
  return new URLSearchParams(search).get('scenario') || null
}

/** Whether `decision` can be sent with this comment (Req 9.6: changes / reject need one). */
export function commentSatisfies(decision: ApprovalDecision, comment: string): boolean {
  return !decisionNeedsComment(decision) || comment.trim().length > 0
}
