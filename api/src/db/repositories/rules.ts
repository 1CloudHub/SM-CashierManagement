/**
 * Rule sets and versions (DOM-002 RuleSet/RuleVersion; Req 16, P6, P7).
 *
 * Lifecycle: draft -> submitted -> (cost rules) approved by Finance or
 * changes_requested -> published -> superseded. Non-cost rules publish
 * straight from draft/submitted (Q6). The DB freezes content once submitted
 * and refuses to publish a cost rule without Finance approval.
 */
import type { IsoDate } from '@lanewise/shared';
import type pg from 'pg';
import { audit, type AuditedTx } from '../audit.js';
import { queryOne } from '../rows.js';

export const RULE_SET_TYPES = [
  'holidays',
  'wages',
  'premiums',
  'lead_times',
  'labor',
  'service_levels',
  'transport_allowance',
] as const;
export type RuleSetType = (typeof RULE_SET_TYPES)[number];

export type RuleVersionStatus = 'draft' | 'submitted' | 'changes_requested' | 'approved' | 'published' | 'superseded';

export interface RuleSet {
  readonly id: string;
  readonly type: RuleSetType;
  readonly name: string;
  readonly isCostRule: boolean;
}

export interface RuleVersion {
  readonly id: string;
  readonly ruleSetId: string;
  readonly isCostRule: boolean;
  readonly version: number;
  readonly effectiveFrom: IsoDate;
  readonly status: RuleVersionStatus;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly changeNote: string;
  readonly financeApprovedBy: string | null;
  readonly synthetic: boolean;
}

interface RuleSetRow extends pg.QueryResultRow {
  id: string;
  rule_set_type: RuleSetType;
  name: string;
  is_cost_rule: boolean;
}

interface RuleVersionRow extends pg.QueryResultRow {
  id: string;
  rule_set_id: string;
  is_cost_rule: boolean;
  version: number;
  effective_from: string;
  status: RuleVersionStatus;
  payload: Record<string, unknown>;
  change_note: string;
  finance_approved_by: string | null;
  synthetic: boolean;
}

const VERSION_COLUMNS =
  'id, rule_set_id, is_cost_rule, version, effective_from, status, payload, change_note, finance_approved_by, synthetic';

function toVersion(row: RuleVersionRow): RuleVersion {
  return {
    id: row.id,
    ruleSetId: row.rule_set_id,
    isCostRule: row.is_cost_rule,
    version: row.version,
    effectiveFrom: row.effective_from,
    status: row.status,
    payload: row.payload,
    changeNote: row.change_note,
    financeApprovedBy: row.finance_approved_by,
    synthetic: row.synthetic,
  };
}

function snapshotOf(v: RuleVersion): Record<string, unknown> {
  return { version: v.version, status: v.status, effectiveFrom: v.effectiveFrom, payload: v.payload };
}

export async function createRuleSet(
  tx: AuditedTx,
  input: { type: RuleSetType; name: string; isCostRule: boolean },
): Promise<RuleSet> {
  const row = await queryOne<RuleSetRow>(
    tx,
    `INSERT INTO rule_set (rule_set_type, name, is_cost_rule) VALUES ($1, $2, $3)
     RETURNING id, rule_set_type, name, is_cost_rule`,
    [input.type, input.name, input.isCostRule],
  );
  const set: RuleSet = { id: row.id, type: row.rule_set_type, name: row.name, isCostRule: row.is_cost_rule };
  await audit.record(tx, {
    action: 'create',
    event: 'rule_set.created',
    objectType: 'rule_set',
    objectId: set.id,
    after: { ...set },
  });
  return set;
}

export async function createRuleVersion(
  tx: AuditedTx,
  input: {
    ruleSetId: string;
    effectiveFrom: IsoDate;
    payload: Readonly<Record<string, unknown>>;
    changeNote?: string;
    synthetic?: boolean;
  },
): Promise<RuleVersion> {
  const version = toVersion(
    await queryOne<RuleVersionRow>(
      tx,
      `INSERT INTO rule_version (rule_set_id, is_cost_rule, version, effective_from, payload, change_note, created_by, synthetic)
       SELECT rs.id, rs.is_cost_rule,
              coalesce((SELECT max(version) FROM rule_version WHERE rule_set_id = rs.id), 0) + 1,
              $2, $3, $4, $5, $6
         FROM rule_set rs WHERE rs.id = $1
       RETURNING ${VERSION_COLUMNS}`,
      [
        input.ruleSetId,
        input.effectiveFrom,
        JSON.stringify(input.payload),
        input.changeNote ?? '',
        tx.actor.userId,
        input.synthetic ?? false,
      ],
    ),
  );
  await audit.record(tx, {
    action: 'create',
    event: 'rule_version.created',
    objectType: 'rule_version',
    objectId: version.id,
    after: snapshotOf(version),
    synthetic: version.synthetic,
  });
  return version;
}

async function lockVersion(tx: AuditedTx, id: string): Promise<RuleVersion> {
  return toVersion(
    await queryOne<RuleVersionRow>(tx, `SELECT ${VERSION_COLUMNS} FROM rule_version WHERE id = $1 FOR UPDATE`, [id]),
  );
}

async function transition(
  tx: AuditedTx,
  id: string,
  setSql: string,
  values: readonly unknown[],
  audited: { action: 'edit' | 'submit' | 'decision' | 'publish'; event: string; extra?: Record<string, unknown> },
  allowedFrom: readonly RuleVersionStatus[],
): Promise<RuleVersion> {
  const before = await lockVersion(tx, id);
  if (!allowedFrom.includes(before.status)) {
    throw new RuleVersionStateError(before.status, audited.event);
  }
  const after = toVersion(
    await queryOne<RuleVersionRow>(
      tx,
      `UPDATE rule_version SET ${setSql} WHERE id = $1 RETURNING ${VERSION_COLUMNS}`,
      [id, ...values],
    ),
  );
  await audit.record(tx, {
    action: audited.action,
    event: audited.event,
    objectType: 'rule_version',
    objectId: id,
    before: snapshotOf(before),
    after: { ...snapshotOf(after), ...audited.extra },
    synthetic: after.synthetic,
  });
  return after;
}

export class RuleVersionStateError extends Error {
  constructor(status: RuleVersionStatus, event: string) {
    super(`rule version in status ${status} does not allow ${event}`);
    this.name = 'RuleVersionStateError';
  }
}

export function editRuleVersion(
  tx: AuditedTx,
  id: string,
  input: { payload?: Readonly<Record<string, unknown>>; effectiveFrom?: IsoDate; changeNote?: string },
): Promise<RuleVersion> {
  return transition(
    tx,
    id,
    `payload = coalesce($2, payload), effective_from = coalesce($3, effective_from),
     change_note = coalesce($4, change_note), status = 'draft'`,
    [input.payload ? JSON.stringify(input.payload) : null, input.effectiveFrom ?? null, input.changeNote ?? null],
    { action: 'edit', event: 'rule_version.edited' },
    ['draft', 'changes_requested'],
  );
}

export function submitRuleVersion(tx: AuditedTx, id: string): Promise<RuleVersion> {
  return transition(
    tx,
    id,
    `status = 'submitted', submitted_at = now()`,
    [],
    { action: 'submit', event: 'rule_version.submitted' },
    ['draft', 'changes_requested'],
  );
}

/** Finance decision on a submitted cost rule (Req 16.3). */
export function decideRuleVersion(
  tx: AuditedTx,
  id: string,
  decision: 'approve' | 'request_changes',
  comment?: string,
): Promise<RuleVersion> {
  return decision === 'approve'
    ? transition(
        tx,
        id,
        `status = 'approved', finance_approved_by = $2, finance_approved_at = now()`,
        [tx.actor.userId],
        { action: 'decision', event: 'rule_version.approved', extra: { comment: comment ?? null } },
        ['submitted'],
      )
    : transition(
        tx,
        id,
        `status = 'changes_requested'`,
        [],
        { action: 'decision', event: 'rule_version.changes_requested', extra: { comment: comment ?? null } },
        ['submitted'],
      );
}

/**
 * Publishes a version and supersedes the previously published one of the same
 * rule set. Published versions are frozen, so existing results never change
 * (P6). Cost rules must be Finance-approved (enforced by the DB as well).
 */
export async function publishRuleVersion(tx: AuditedTx, id: string): Promise<RuleVersion> {
  const current = await lockVersion(tx, id);
  const allowed: readonly RuleVersionStatus[] = current.isCostRule ? ['approved'] : ['draft', 'submitted'];
  if (!allowed.includes(current.status)) throw new RuleVersionStateError(current.status, 'rule_version.published');
  const superseded = await tx.query<{ id: string }>(
    `UPDATE rule_version SET status = 'superseded'
      WHERE rule_set_id = $1 AND synthetic = $2 AND status = 'published' RETURNING id`,
    [current.ruleSetId, current.synthetic],
  );
  return transition(
    tx,
    id,
    `status = 'published', published_by = $2, published_at = now()`,
    [tx.actor.userId],
    {
      action: 'publish',
      event: 'rule_version.published',
      extra: { supersededVersionId: superseded.rows[0]?.id ?? null },
    },
    allowed,
  );
}
