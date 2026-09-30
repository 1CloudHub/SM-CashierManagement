/**
 * Rule sets and versions (DOM-002 RuleSet/RuleVersion; Req 16, P6, P7).
 *
 * Lifecycle (`ruleVersionTransition` in @lanewise/shared): draft -> submitted
 * -> (cost rules) approved by Finance or changes_requested -> published ->
 * superseded. Non-cost rules publish straight from draft/submitted (Q6). The
 * DB freezes content once submitted, guards every status change, refuses to
 * publish a cost rule without Finance approval and keeps effective dates in
 * publish order (migrations 0002, 0110).
 *
 * Authorisation sits above this layer (routes/rules.ts + task 8.1).
 */
import {
  OPEN_RULE_VERSION_STATUSES,
  RULE_SET_TYPES as SHARED_RULE_SET_TYPES,
  isCostRuleSetType,
  ruleVersionTransition,
  type IsoDate,
  type RuleSetSummary,
  type RuleSetType as SharedRuleSetType,
  type RuleVersionAction,
  type RuleVersionDetail,
  type RuleVersionStatus as SharedRuleVersionStatus,
  type RuleVersionSummary,
} from '@lanewise/shared';
import type pg from 'pg';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { isoOrNull, queryMaybe, queryOne } from '../rows.js';

export const RULE_SET_TYPES = SHARED_RULE_SET_TYPES;
export type RuleSetType = SharedRuleSetType;
export type RuleVersionStatus = SharedRuleVersionStatus;

/** Roles notified when a rule version is published (design.md notifications; Req 16.5). */
export const RULE_PUBLISHED_NOTIFY_ROLES = ['PLN', 'FIN', 'HR'] as const;

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
  readonly reviewComment: string | null;
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
  review_comment: string | null;
  synthetic: boolean;
}

const VERSION_COLUMNS =
  'id, rule_set_id, is_cost_rule, version, effective_from, status, payload, change_note, finance_approved_by, review_comment, synthetic';

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
    reviewComment: row.review_comment,
    synthetic: row.synthetic,
  };
}

function toSet(row: RuleSetRow): RuleSet {
  return { id: row.id, type: row.rule_set_type, name: row.name, isCostRule: row.is_cost_rule };
}

function snapshotOf(v: RuleVersion): Record<string, unknown> {
  return { version: v.version, status: v.status, effectiveFrom: v.effectiveFrom, payload: v.payload, changeNote: v.changeNote };
}

export class RuleVersionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleVersionStateError';
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ProvenanceFilter {
  /** Seeded demo (true) or real (false) versions — never mixed (P18). Default false. */
  readonly synthetic?: boolean;
}

interface SummaryRow extends pg.QueryResultRow {
  id: string;
  rule_set_id: string;
  version: number;
  effective_from: string;
  status: RuleVersionStatus;
  is_cost_rule: boolean;
  updated_at: Date;
}

const SUMMARY_COLUMNS = 'id, rule_set_id, version, effective_from, status, is_cost_rule, updated_at';

function toSummary(row: SummaryRow): RuleVersionSummary {
  return {
    id: row.id,
    ruleSetId: row.rule_set_id,
    version: row.version,
    effectiveFrom: row.effective_from,
    status: row.status,
    isCostRule: row.is_cost_rule,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getRuleSet(db: Queryable, id: string): Promise<RuleSet | null> {
  const row = await queryMaybe<RuleSetRow>(db, 'SELECT id, rule_set_type, name, is_cost_rule FROM rule_set WHERE id = $1', [id]);
  return row && toSet(row);
}

/** SCR-060: every rule set with its in-force version, its open draft and how many scenarios use it. */
export async function listRuleSets(db: Queryable, filter: ProvenanceFilter = {}): Promise<RuleSetSummary[]> {
  const synthetic = filter.synthetic ?? false;
  const { rows: sets } = await db.query<RuleSetRow & { scenario_count: number }>(
    `SELECT rs.id, rs.rule_set_type, rs.name, rs.is_cost_rule,
            (SELECT count(DISTINCT p.scenario_id)::int
               FROM scenario_rule_version p JOIN scenario s ON s.id = p.scenario_id
              WHERE p.rule_set_id = rs.id AND p.synthetic = $1
                AND s.status NOT IN ('archived', 'superseded')) AS scenario_count
       FROM rule_set rs
      ORDER BY array_position($2::text[], rs.rule_set_type)`,
    [synthetic, RULE_SET_TYPES],
  );
  const { rows: versions } = await db.query<SummaryRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM rule_version
      WHERE synthetic = $1 AND status = ANY($2::text[])`,
    [synthetic, ['published', ...OPEN_RULE_VERSION_STATUSES]],
  );
  return sets.map((s) => {
    const mine = versions.filter((v) => v.rule_set_id === s.id);
    const current = mine.find((v) => v.status === 'published');
    const open = mine.find((v) => v.status !== 'published');
    return {
      ...toSet(s),
      currentVersion: current ? toSummary(current) : null,
      openVersion: open ? toSummary(open) : null,
      scenarioCount: s.scenario_count,
    };
  });
}

/** Version history of a rule set, newest first. */
export async function listRuleVersions(
  db: Queryable,
  ruleSetId: string,
  filter: ProvenanceFilter = {},
): Promise<RuleVersionSummary[]> {
  const { rows } = await db.query<SummaryRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM rule_version WHERE rule_set_id = $1 AND synthetic = $2 ORDER BY version DESC`,
    [ruleSetId, filter.synthetic ?? false],
  );
  return rows.map(toSummary);
}

interface DetailRow extends SummaryRow {
  rule_set_type: RuleSetType;
  rule_set_name: string;
  payload: Record<string, unknown>;
  change_note: string;
  created_by: string;
  created_by_name: string | null;
  submitted_at: Date | null;
  finance_approved_by: string | null;
  finance_approved_by_name: string | null;
  finance_approved_at: Date | null;
  review_comment: string | null;
  published_by: string | null;
  published_by_name: string | null;
  published_at: Date | null;
  synthetic: boolean;
}

export async function getRuleVersion(db: Queryable, id: string): Promise<RuleVersionDetail | null> {
  const row = await queryMaybe<DetailRow>(
    db,
    `SELECT v.id, v.rule_set_id, v.version, v.effective_from, v.status, v.is_cost_rule, v.updated_at,
            rs.rule_set_type, rs.name AS rule_set_name, v.payload, v.change_note,
            v.created_by, cu.name AS created_by_name, v.submitted_at,
            v.finance_approved_by, fu.name AS finance_approved_by_name, v.finance_approved_at,
            v.review_comment, v.published_by, pu.name AS published_by_name, v.published_at, v.synthetic
       FROM rule_version v
       JOIN rule_set rs ON rs.id = v.rule_set_id
       LEFT JOIN app_user cu ON cu.id = v.created_by
       LEFT JOIN app_user fu ON fu.id = v.finance_approved_by
       LEFT JOIN app_user pu ON pu.id = v.published_by
      WHERE v.id = $1`,
    [id],
  );
  if (!row) return null;
  return {
    ...toSummary(row),
    ruleSetType: row.rule_set_type,
    ruleSetName: row.rule_set_name,
    payload: row.payload,
    changeNote: row.change_note,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    submittedAt: isoOrNull(row.submitted_at),
    financeApprovedBy: row.finance_approved_by,
    financeApprovedByName: row.finance_approved_by_name,
    financeApprovedAt: isoOrNull(row.finance_approved_at),
    reviewComment: row.review_comment,
    publishedBy: row.published_by,
    publishedByName: row.published_by_name,
    publishedAt: isoOrNull(row.published_at),
    synthetic: row.synthetic,
  };
}

/** The version that `id` follows in its series (the next lower version number), if any. */
export async function getPreviousRuleVersion(db: Queryable, id: string): Promise<RuleVersionDetail | null> {
  const row = await queryMaybe<{ id: string }>(
    db,
    `SELECT p.id FROM rule_version v
       JOIN rule_version p ON p.rule_set_id = v.rule_set_id AND p.synthetic = v.synthetic AND p.version < v.version
      WHERE v.id = $1 ORDER BY p.version DESC LIMIT 1`,
    [id],
  );
  return row ? getRuleVersion(db, row.id) : null;
}

const AFFECTED_SCENARIOS_SQL = `
  SELECT DISTINCT s.id, s.owner_id
    FROM scenario_rule_version p
    JOIN scenario s ON s.id = p.scenario_id
   WHERE p.rule_set_id = $1 AND p.synthetic = $2 AND p.rule_version_id <> $3
     AND s.status NOT IN ('archived', 'superseded')`;

/**
 * Scenarios that publishing `id` would flag stale: live scenarios of the same
 * provenance pinned to another version of the same rule set (Req 16.5, P5).
 */
export async function getRuleVersionImpact(db: Queryable, id: string): Promise<{ scenarioIds: string[] }> {
  const v = await queryOne<RuleVersionRow>(db, `SELECT ${VERSION_COLUMNS} FROM rule_version WHERE id = $1`, [id]);
  const { rows } = await db.query<{ id: string }>(`${AFFECTED_SCENARIOS_SQL} ORDER BY s.id`, [v.rule_set_id, v.synthetic, v.id]);
  return { scenarioIds: rows.map((r) => r.id) };
}

// ---------------------------------------------------------------------------
// Mutations — each records exactly one audit event (P7).
// ---------------------------------------------------------------------------

export async function createRuleSet(
  tx: AuditedTx,
  input: { type: RuleSetType; name: string; isCostRule?: boolean },
): Promise<RuleSet> {
  const row = await queryOne<RuleSetRow>(
    tx,
    `INSERT INTO rule_set (rule_set_type, name, is_cost_rule) VALUES ($1, $2, $3)
     RETURNING id, rule_set_type, name, is_cost_rule`,
    [input.type, input.name, input.isCostRule ?? isCostRuleSetType(input.type)],
  );
  const set = toSet(row);
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

const AUDIT_BY_ACTION: Readonly<Record<RuleVersionAction, { action: 'edit' | 'submit' | 'decision' | 'publish'; event: string }>> = {
  edit: { action: 'edit', event: 'rule_version.edited' },
  submit: { action: 'submit', event: 'rule_version.submitted' },
  approve: { action: 'decision', event: 'rule_version.approved' },
  request_changes: { action: 'decision', event: 'rule_version.changes_requested' },
  publish: { action: 'publish', event: 'rule_version.published' },
};

/** Applies a lifecycle action, refusing it unless `ruleVersionTransition` allows it. */
async function transition(
  tx: AuditedTx,
  id: string,
  action: RuleVersionAction,
  setSql: string,
  values: readonly unknown[],
  extra: Record<string, unknown> = {},
  before?: RuleVersion,
): Promise<RuleVersion> {
  const current = before ?? (await lockVersion(tx, id));
  const next = ruleVersionTransition(current.status, current.isCostRule, action);
  if (next === null) {
    throw new RuleVersionStateError(
      `a ${current.isCostRule ? 'cost' : 'non-cost'} rule version in status ${current.status} does not allow ${action}`,
    );
  }
  const after = toVersion(
    await queryOne<RuleVersionRow>(
      tx,
      `UPDATE rule_version SET status = '${next}', ${setSql} WHERE id = $1 RETURNING ${VERSION_COLUMNS}`,
      [id, ...values],
    ),
  );
  await audit.record(tx, {
    ...AUDIT_BY_ACTION[action],
    objectType: 'rule_version',
    objectId: id,
    before: snapshotOf(current),
    after: { ...snapshotOf(after), ...extra },
    synthetic: after.synthetic,
  });
  return after;
}

export function editRuleVersion(
  tx: AuditedTx,
  id: string,
  input: { payload?: Readonly<Record<string, unknown>>; effectiveFrom?: IsoDate; changeNote?: string },
): Promise<RuleVersion> {
  return transition(
    tx,
    id,
    'edit',
    `payload = coalesce($2, payload), effective_from = coalesce($3, effective_from),
     change_note = coalesce($4, change_note)`,
    [input.payload ? JSON.stringify(input.payload) : null, input.effectiveFrom ?? null, input.changeNote ?? null],
  );
}

export function submitRuleVersion(tx: AuditedTx, id: string): Promise<RuleVersion> {
  return transition(tx, id, 'submit', 'submitted_at = now()', []);
}

/**
 * Finance decision on a submitted cost rule (Req 16.3). Requesting changes
 * needs a comment, which is kept on the version for the author.
 */
export function decideRuleVersion(
  tx: AuditedTx,
  id: string,
  decision: 'approve' | 'request_changes',
  comment?: string,
): Promise<RuleVersion> {
  const note = comment?.trim() ? comment.trim() : null;
  if (decision === 'approve') {
    return transition(
      tx,
      id,
      'approve',
      'finance_approved_by = $2, finance_approved_at = now()',
      [tx.actor.userId],
      { comment: note },
    );
  }
  if (note === null) throw new RuleVersionStateError('a comment is required to request changes');
  return transition(tx, id, 'request_changes', 'review_comment = $2', [note], { comment: note });
}

export interface PublishResult {
  readonly version: RuleVersion;
  readonly supersededVersionId: string | null;
  /** Scenarios flagged stale by this publish (Req 16.5). */
  readonly staleScenarioIds: readonly string[];
  readonly notifiedUserIds: readonly string[];
}

/**
 * Publishes a version and supersedes the previously published one of the same
 * rule set and provenance. Published versions are frozen and results pin the
 * version they used, so existing results never change (P6). Scenarios pinned
 * to an older version are flagged stale; their owners and the Planner,
 * Finance and HR roles are notified (Req 16.5) — all in the publish's own
 * transaction, under its single audit event.
 */
export async function publishRuleVersion(tx: AuditedTx, id: string): Promise<PublishResult> {
  const current = await lockVersion(tx, id);
  if (ruleVersionTransition(current.status, current.isCostRule, 'publish') === null) {
    throw new RuleVersionStateError(
      current.isCostRule && current.status !== 'approved'
        ? 'a cost rule needs Finance approval before it can be published'
        : `a rule version in status ${current.status} cannot be published`,
    );
  }
  const prior = await queryMaybe<{ id: string; effective_from: string }>(
    tx,
    `SELECT id, effective_from FROM rule_version
      WHERE rule_set_id = $1 AND synthetic = $2 AND status = 'published' FOR UPDATE`,
    [current.ruleSetId, current.synthetic],
  );
  if (prior && prior.effective_from > current.effectiveFrom) {
    throw new RuleVersionStateError('the version would take effect before the version it replaces');
  }
  if (prior) await tx.query(`UPDATE rule_version SET status = 'superseded' WHERE id = $1`, [prior.id]);

  const { rows: affected } = await tx.query<{ id: string; owner_id: string }>(
    `${AFFECTED_SCENARIOS_SQL} ORDER BY s.id`,
    [current.ruleSetId, current.synthetic, current.id],
  );
  const staleScenarioIds = affected.map((s) => s.id);
  if (staleScenarioIds.length > 0) {
    await tx.query(
      `UPDATE scenario SET stale = true, stale_reason = 'rules version superseded' WHERE id = ANY($1::uuid[])`,
      [staleScenarioIds],
    );
    await tx.query(
      `INSERT INTO notification (user_id, event, object_type, object_id, severity, params, synthetic)
       SELECT s.owner_id, 'scenario.stale', 'scenario', s.id::text, 'warning',
              jsonb_build_object('reason', 'rules_version', 'ruleVersionId', $2::text), $3::boolean
         FROM scenario s WHERE s.id = ANY($1::uuid[])`,
      [staleScenarioIds, current.id, current.synthetic],
    );
  }
  const { rows: recipients } = await tx.query<{ user_id: string }>(
    `INSERT INTO notification (user_id, event, object_type, object_id, severity, params, synthetic)
     SELECT DISTINCT ra.user_id, 'rule_version.published', 'rule_version', $1::text, 'info',
            jsonb_build_object('ruleSetId', $2::text, 'version', $3::int, 'staleScenarios', $4::int), $5::boolean
       FROM role_assignment ra JOIN app_user u ON u.id = ra.user_id
      WHERE ra.role = ANY($6::text[]) AND u.status = 'active'
     RETURNING user_id`,
    [current.id, current.ruleSetId, current.version, staleScenarioIds.length, current.synthetic, RULE_PUBLISHED_NOTIFY_ROLES],
  );
  const notifiedUserIds = [...new Set([...recipients.map((r) => r.user_id), ...affected.map((s) => s.owner_id)])].sort();

  const version = await transition(
    tx,
    id,
    'publish',
    'published_by = $2, published_at = now()',
    [tx.actor.userId],
    { supersededVersionId: prior?.id ?? null, staleScenarioIds, notifiedUserIds },
    current,
  );
  return { version, supersededVersionId: prior?.id ?? null, staleScenarioIds, notifiedUserIds };
}
