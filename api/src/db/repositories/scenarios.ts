/**
 * Scenarios and approval steps (DOM-002 Scenario, ApprovalStep; Req 8, 9;
 * P3, P4, P5, P7, P10).
 *
 * This is the persistence layer only; authorisation (task 8) and staleness
 * computation (task 11.2) sit above it. The DB independently enforces the
 * lifecycle, read-only settings, single-published and approval sequencing.
 */
import type { ApprovalStep, ApprovalStepKind, ApprovalStepStatus, DatasetType, RoleCode, ScenarioStatus } from '@lanewise/shared';
import type pg from 'pg';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { isoOrNull, queryMaybe, queryOne } from '../rows.js';
import { notifyApprovalRequested } from './approval-notifications.js';

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly season: string;
  readonly status: ScenarioStatus;
  readonly stale: boolean;
  readonly ownerId: string;
  readonly settings: Readonly<Record<string, unknown>>;
  /** Pinned input snapshot per dataset type. */
  readonly snapshotIds: Readonly<Partial<Record<DatasetType, string>>>;
  /** Pinned rule version per rule set. */
  readonly ruleVersionIds: readonly string[];
  readonly parentScenarioId: string | null;
  readonly currentSubmissionNo: number;
  readonly synthetic: boolean;
  readonly publishedAt: string | null;
}

interface ScenarioRow extends pg.QueryResultRow {
  id: string;
  name: string;
  season: string;
  status: ScenarioStatus;
  stale: boolean;
  owner_id: string;
  settings: Record<string, unknown>;
  parent_scenario_id: string | null;
  current_submission_no: number;
  synthetic: boolean;
  published_at: Date | null;
  snapshots: { dataset_type: DatasetType; snapshot_id: string }[];
  rule_version_ids: string[];
}

const SELECT_SCENARIO = `
  SELECT s.id, s.name, s.season, s.status, s.stale, s.owner_id, s.settings, s.parent_scenario_id,
         s.current_submission_no, s.synthetic, s.published_at,
         coalesce((SELECT json_agg(json_build_object('dataset_type', p.dataset_type, 'snapshot_id', p.snapshot_id))
                     FROM scenario_snapshot p WHERE p.scenario_id = s.id), '[]') AS snapshots,
         coalesce((SELECT array_agg(r.rule_version_id ORDER BY r.rule_version_id)
                     FROM scenario_rule_version r WHERE r.scenario_id = s.id), '{}') AS rule_version_ids
    FROM scenario s`;

function toScenario(row: ScenarioRow): Scenario {
  const snapshotIds: Partial<Record<DatasetType, string>> = {};
  for (const p of row.snapshots) snapshotIds[p.dataset_type] = p.snapshot_id;
  return {
    id: row.id,
    name: row.name,
    season: row.season,
    status: row.status,
    stale: row.stale,
    ownerId: row.owner_id,
    settings: row.settings,
    snapshotIds,
    ruleVersionIds: row.rule_version_ids,
    parentScenarioId: row.parent_scenario_id,
    currentSubmissionNo: row.current_submission_no,
    synthetic: row.synthetic,
    publishedAt: isoOrNull(row.published_at),
  };
}

export async function getScenario(db: Queryable, id: string): Promise<Scenario | null> {
  const row = await queryMaybe<ScenarioRow>(db, `${SELECT_SCENARIO} WHERE s.id = $1`, [id]);
  return row && toScenario(row);
}

async function loadScenario(tx: AuditedTx, id: string): Promise<Scenario> {
  await queryOne(tx, 'SELECT id FROM scenario WHERE id = $1 FOR UPDATE', [id]);
  return toScenario(await queryOne<ScenarioRow>(tx, `${SELECT_SCENARIO} WHERE s.id = $1`, [id]));
}

function auditView(s: Scenario): Record<string, unknown> {
  return {
    name: s.name,
    season: s.season,
    status: s.status,
    stale: s.stale,
    settings: s.settings,
    snapshotIds: s.snapshotIds,
    ruleVersionIds: s.ruleVersionIds,
    submissionNo: s.currentSubmissionNo,
  };
}

export interface CreateScenarioInput {
  readonly name: string;
  readonly season: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly snapshotIds?: readonly string[];
  readonly ruleVersionIds?: readonly string[];
  readonly parentScenarioId?: string;
  readonly synthetic?: boolean;
}

/** Creates a Draft scenario owned by the actor, pinned to its inputs (Req 8.1). */
export async function createScenario(tx: AuditedTx, input: CreateScenarioInput): Promise<Scenario> {
  const synthetic = input.synthetic ?? false;
  const { id } = await queryOne<{ id: string }>(
    tx,
    `INSERT INTO scenario (name, season, owner_id, settings, parent_scenario_id, synthetic)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.name, input.season, tx.actor.userId, JSON.stringify(input.settings), input.parentScenarioId ?? null, synthetic],
  );
  if (input.snapshotIds && input.snapshotIds.length > 0) {
    await tx.query(
      `INSERT INTO scenario_snapshot (scenario_id, dataset_type, snapshot_id, synthetic)
       SELECT $1, d.dataset_type, d.id, $3 FROM dataset_snapshot d WHERE d.id = ANY($2::uuid[])`,
      [id, input.snapshotIds, synthetic],
    );
  }
  if (input.ruleVersionIds && input.ruleVersionIds.length > 0) {
    await tx.query(
      `INSERT INTO scenario_rule_version (scenario_id, rule_set_id, rule_version_id, synthetic)
       SELECT $1, v.rule_set_id, v.id, $3 FROM rule_version v WHERE v.id = ANY($2::uuid[])`,
      [id, input.ruleVersionIds, synthetic],
    );
  }
  const scenario = toScenario(await queryOne<ScenarioRow>(tx, `${SELECT_SCENARIO} WHERE s.id = $1`, [id]));
  const pinned = Object.keys(scenario.snapshotIds).length;
  if (pinned !== (input.snapshotIds?.length ?? 0) || scenario.ruleVersionIds.length !== (input.ruleVersionIds?.length ?? 0)) {
    throw new ScenarioStateError('a pinned snapshot or rule version does not exist or repeats a type');
  }
  await audit.record(tx, {
    action: 'create',
    event: 'scenario.created',
    objectType: 'scenario',
    objectId: id,
    after: auditView(scenario),
    synthetic,
  });
  return scenario;
}

export class ScenarioStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioStateError';
  }
}

/** Edits Draft settings (Req 8.3/P4: the DB rejects edits outside Draft). */
export async function editScenarioSettings(
  tx: AuditedTx,
  id: string,
  settings: Readonly<Record<string, unknown>>,
): Promise<Scenario> {
  const before = await loadScenario(tx, id);
  await tx.query('UPDATE scenario SET settings = $2 WHERE id = $1', [id, JSON.stringify(settings)]);
  const after = await loadScenario(tx, id);
  await audit.record(tx, {
    action: 'edit',
    event: 'scenario.settings_edited',
    objectType: 'scenario',
    objectId: id,
    before: auditView(before),
    after: auditView(after),
    synthetic: after.synthetic,
  });
  return after;
}

/**
 * Submits a Draft, stamps the submitter and opens the three approval steps of
 * a new submission; HR and Finance are asked for headcount and budget (Req 9.1).
 */
export async function submitScenario(tx: AuditedTx, id: string): Promise<Scenario> {
  const before = await loadScenario(tx, id);
  await tx.query(
    `UPDATE scenario
        SET status = 'submitted', current_submission_no = current_submission_no + 1, submitted_by = $2, submitted_at = now()
      WHERE id = $1`,
    [id, tx.actor.userId],
  );
  const after = await loadScenario(tx, id);
  await tx.query(
    `INSERT INTO approval_step (scenario_id, submission_no, step)
     SELECT $1, $2, step FROM unnest(ARRAY['headcount', 'budget', 'plan']) AS step`,
    [id, after.currentSubmissionNo],
  );
  await notifyApprovalRequested(tx, { id, name: after.name, synthetic: after.synthetic, submissionNo: after.currentSubmissionNo });
  await audit.record(tx, {
    action: 'submit',
    event: 'scenario.submitted',
    objectType: 'scenario',
    objectId: id,
    before: auditView(before),
    after: auditView(after),
    synthetic: after.synthetic,
  });
  return after;
}

interface StepRow extends pg.QueryResultRow {
  scenario_id: string;
  submission_no: number;
  step: ApprovalStepKind;
  status: ApprovalStepStatus;
  decided_by: string | null;
  decided_as_role: RoleCode | null;
  comment: string | null;
  outside_reference: string | null;
  decided_at: Date | null;
}

const STEP_COLUMNS =
  'scenario_id, submission_no, step, status, decided_by, decided_as_role, comment, outside_reference, decided_at';

function toStep(row: StepRow): ApprovalStep {
  return {
    scenarioId: row.scenario_id,
    submissionNo: row.submission_no,
    step: row.step,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAsRole: row.decided_as_role,
    comment: row.comment,
    reference: row.outside_reference,
    decidedAt: isoOrNull(row.decided_at),
  };
}

export async function listApprovalSteps(db: Queryable, scenarioId: string, submissionNo: number): Promise<ApprovalStep[]> {
  const { rows } = await db.query<StepRow>(
    `SELECT ${STEP_COLUMNS} FROM approval_step WHERE scenario_id = $1 AND submission_no = $2 ORDER BY step`,
    [scenarioId, submissionNo],
  );
  return rows.map(toStep);
}

async function setStep(
  tx: AuditedTx,
  scenario: Scenario,
  step: ApprovalStepKind,
  status: ApprovalStepStatus,
  fields: { comment?: string | undefined; reference?: string | undefined; note?: string | undefined },
): Promise<{ before: ApprovalStep; after: ApprovalStep }> {
  if (scenario.status !== 'submitted') {
    throw new ScenarioStateError(`scenario is ${scenario.status}, not submitted`);
  }
  const before = toStep(
    await queryOne<StepRow>(
      tx,
      `SELECT ${STEP_COLUMNS} FROM approval_step WHERE scenario_id = $1 AND submission_no = $2 AND step = $3 FOR UPDATE`,
      [scenario.id, scenario.currentSubmissionNo, step],
    ),
  );
  if (before.status !== 'pending') throw new ScenarioStateError(`${step} step is already ${before.status}`);
  const after = toStep(
    await queryOne<StepRow>(
      tx,
      `UPDATE approval_step
          SET status = $4, decided_by = $5, decided_as_role = $6, decided_at = now(),
              comment = $7, outside_reference = $8, outside_note = $9
        WHERE scenario_id = $1 AND submission_no = $2 AND step = $3
        RETURNING ${STEP_COLUMNS}`,
      [
        scenario.id,
        scenario.currentSubmissionNo,
        step,
        status,
        tx.actor.userId,
        tx.actor.activeRole,
        fields.comment ?? null,
        fields.reference ?? null,
        fields.note ?? null,
      ],
    ),
  );
  return { before, after };
}

export type StepDecision = 'approved' | 'changes_requested' | 'rejected';

/**
 * Records an in-system decision on a step by the acting role. Requesting
 * changes (any step) or rejecting (plan) returns the scenario to Draft; a new
 * submission opens fresh steps (Req 9.6). Approving the plan step goes
 * through `approvePlanAndPublish`.
 */
export async function decideApprovalStep(
  tx: AuditedTx,
  input: { scenarioId: string; step: ApprovalStepKind; decision: StepDecision; comment?: string },
): Promise<ApprovalStep> {
  if (input.step === 'plan' && input.decision === 'approved') {
    throw new ScenarioStateError('approve the plan with approvePlanAndPublish');
  }
  const scenario = await loadScenario(tx, input.scenarioId);
  const { before, after } = await setStep(tx, scenario, input.step, input.decision, { comment: input.comment });
  if (input.decision !== 'approved') {
    await tx.query(`UPDATE scenario SET status = 'draft' WHERE id = $1`, [scenario.id]);
  }
  await audit.record(tx, {
    action: 'decision',
    event: `approval.${input.step}_${input.decision}`,
    objectType: 'scenario',
    objectId: scenario.id,
    before: { ...before },
    after: { ...after },
    synthetic: scenario.synthetic,
  });
  return after;
}

/** Executive records headcount or budget as secured outside the system (Q19). */
export async function recordSecuredOutside(
  tx: AuditedTx,
  input: { scenarioId: string; step: 'headcount' | 'budget'; reference: string; note?: string },
): Promise<ApprovalStep> {
  const scenario = await loadScenario(tx, input.scenarioId);
  const { before, after } = await setStep(tx, scenario, input.step, 'secured_outside', {
    reference: input.reference,
    note: input.note,
  });
  await audit.record(tx, {
    action: 'decision',
    event: `approval.${input.step}_secured_outside`,
    objectType: 'scenario',
    objectId: scenario.id,
    before: { ...before },
    after: { ...after, note: input.note ?? null },
    synthetic: scenario.synthetic,
  });
  return after;
}

/**
 * Executive approves the plan: the plan step is approved (the DB requires
 * headcount and budget secured — P10), the scenario is published and the
 * season's previously published scenario is superseded (Req 9.5, P3). One
 * user action, one `publish` audit event.
 */
export async function approvePlanAndPublish(tx: AuditedTx, scenarioId: string, comment?: string): Promise<Scenario> {
  const before = await loadScenario(tx, scenarioId);
  await setStep(tx, before, 'plan', 'approved', { comment });
  await tx.query(`UPDATE scenario SET status = 'approved' WHERE id = $1`, [scenarioId]);
  const superseded = await tx.query<{ id: string }>(
    `UPDATE scenario SET status = 'superseded'
      WHERE season = $1 AND synthetic = $2 AND status = 'published' AND id <> $3 RETURNING id`,
    [before.season, before.synthetic, scenarioId],
  );
  await tx.query(`UPDATE scenario SET status = 'published', published_at = now() WHERE id = $1`, [scenarioId]);
  const after = await loadScenario(tx, scenarioId);
  await audit.record(tx, {
    action: 'publish',
    event: 'scenario.published',
    objectType: 'scenario',
    objectId: scenarioId,
    before: auditView(before),
    after: { ...auditView(after), supersededScenarioId: superseded.rows[0]?.id ?? null },
    synthetic: after.synthetic,
  });
  return after;
}
