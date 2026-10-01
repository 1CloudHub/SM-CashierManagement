/**
 * Approval notifications (task 12; design.md › Notifications; Req 19.1).
 *
 * In-app notification rows for the approval workflow. They are derived
 * records written inside the action's transaction, not audit events (P7).
 */
import type { RoleCode } from '@lanewise/shared';
import type { Queryable } from '../pool.js';

interface NotifyInput {
  readonly event: string;
  readonly scenarioId: string;
  readonly severity: 'info' | 'warning';
  readonly params: Record<string, unknown>;
  readonly synthetic: boolean;
  readonly roles: readonly RoleCode[];
  /** Extra recipients (e.g. the submitter), regardless of role. */
  readonly userIds?: readonly (string | null)[];
}

/** One in-app notification per distinct active recipient (email delivery follows the preference, task 19). */
export async function notifyApproval(tx: Queryable, input: NotifyInput): Promise<void> {
  await tx.query(
    `INSERT INTO notification (user_id, event, object_type, object_id, severity, params, synthetic)
     SELECT DISTINCT u.id, $1::text, 'scenario', $2::text, $3::text, $4::jsonb, $5::boolean
       FROM app_user u
      WHERE u.status = 'active'
        AND (u.id = ANY($7::uuid[])
             OR EXISTS (SELECT 1 FROM role_assignment ra WHERE ra.user_id = u.id AND ra.role = ANY($6::text[])))`,
    [
      input.event,
      input.scenarioId,
      input.severity,
      JSON.stringify(input.params),
      input.synthetic,
      input.roles,
      (input.userIds ?? []).filter((x): x is string => x !== null),
    ],
  );
}

/** Req 9.1: HR and Finance are asked for headcount and budget when a scenario is submitted. */
export async function notifyApprovalRequested(tx: Queryable, scenario: { id: string; name: string; synthetic: boolean; submissionNo: number }): Promise<void> {
  const params = { name: scenario.name, submissionNo: scenario.submissionNo };
  await notifyApproval(tx, { event: 'approval.headcount_requested', scenarioId: scenario.id, severity: 'warning', params, synthetic: scenario.synthetic, roles: ['HR'] });
  await notifyApproval(tx, { event: 'approval.budget_requested', scenarioId: scenario.id, severity: 'warning', params, synthetic: scenario.synthetic, roles: ['FIN'] });
}
