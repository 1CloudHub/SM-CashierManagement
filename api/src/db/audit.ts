/**
 * Append-only audit log (task 5.2; Req 22, P7 audit completeness, P12
 * active-role enforcement).
 *
 * Every mutation runs through `withAuditedTransaction`, which opens one
 * transaction, hands the mutation an `AuditedTx`, and requires the mutation to
 * call `audit.record(tx, ...)` exactly once. Zero or more than one record —
 * or any error — rolls back both the mutation and its audit event, so a
 * committed change always has exactly one event and a failed one has none.
 *
 * The `audit_event` table itself rejects UPDATE/DELETE/TRUNCATE (migration
 * 0005), so recorded events are immutable.
 */
import {
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditEvent,
  type AuditSnapshot,
  type RoleCode,
} from '@lanewise/shared';
import type pg from 'pg';
import type { Principal } from '../context.js';
import { errors } from '../http/errors.js';
import { withTransaction, type Queryable, type Tx } from './pool.js';

/** Who performed a mutation: the user and the role active at the time (P12). */
export interface Actor {
  readonly userId: string;
  readonly activeRole: RoleCode;
  readonly requestId: string | null;
}

/**
 * Builds the actor for a request. Refuses a principal without a resolved
 * active role — nothing is mutated without one (P12).
 */
export function actorFromPrincipal(principal: Principal, requestId: string | null): Actor {
  if (principal.activeRole === null) throw errors.forbidden();
  return { userId: principal.userId, activeRole: principal.activeRole, requestId };
}

export interface AuditRecordInput {
  readonly action: AuditAction;
  /** Specific event name, `object.verb` in snake_case, e.g. `scenario.submitted`. */
  readonly event: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly before?: AuditSnapshot;
  readonly after?: AuditSnapshot;
  /** True when the object is seeded demo data (P18 labelling). */
  readonly synthetic?: boolean;
}

/** A transaction bound to an actor, in which exactly one audit event must be recorded. */
export interface AuditedTx extends Tx {
  readonly actor: Actor;
}

/** Raised when a mutation records zero or more than one audit event. */
export class AuditInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditInvariantError';
  }
}

const EVENT_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const recordedCount = new WeakMap<AuditedTx, number>();

interface AuditEventRow extends pg.QueryResultRow {
  id: string;
  at: Date;
  user_id: string;
  active_role: RoleCode;
  action: AuditAction;
  event: string;
  object_type: string;
  object_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  request_id: string | null;
}

const COLUMNS =
  'id, at, user_id, active_role, action, event, object_type, object_id, before, after, request_id';

function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    at: row.at.toISOString(),
    userId: row.user_id,
    activeRole: row.active_role,
    action: row.action,
    event: row.event,
    objectType: row.object_type,
    objectId: row.object_id,
    before: row.before,
    after: row.after,
    requestId: row.request_id,
  };
}

/**
 * Appends the audit event for the current mutation, in the mutation's own
 * transaction. Must be called exactly once per `withAuditedTransaction`.
 */
async function record(tx: AuditedTx, input: AuditRecordInput): Promise<AuditEvent> {
  const count = recordedCount.get(tx);
  if (count === undefined) {
    throw new AuditInvariantError('audit.record must be called inside withAuditedTransaction');
  }
  if (count >= 1) {
    throw new AuditInvariantError(
      `a mutation must record exactly one audit event (second event: ${input.event})`,
    );
  }
  if (!(AUDIT_ACTIONS as readonly string[]).includes(input.action)) {
    throw new AuditInvariantError(`unknown audit action: ${String(input.action)}`);
  }
  if (!EVENT_PATTERN.test(input.event)) {
    throw new AuditInvariantError(`audit event name must look like object.verb: ${input.event}`);
  }
  recordedCount.set(tx, count + 1);
  const { rows } = await tx.query<AuditEventRow>(
    `INSERT INTO audit_event
       (user_id, active_role, action, event, object_type, object_id, before, after, request_id, synthetic)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${COLUMNS}`,
    [
      tx.actor.userId,
      tx.actor.activeRole,
      input.action,
      input.event,
      input.objectType,
      input.objectId,
      input.before ?? null,
      input.after ?? null,
      tx.actor.requestId,
      input.synthetic ?? false,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('audit insert returned no row');
  return toAuditEvent(row);
}

export interface AuditListFilter {
  readonly objectType?: string;
  readonly objectId?: string;
  readonly userId?: string;
  readonly action?: AuditAction;
  readonly from?: Date;
  readonly to?: Date;
  /** Default 100, max 1000. */
  readonly limit?: number;
}

/** Lists events newest first (SCR-073 filters build on this; scope is applied by the caller). */
async function list(db: Queryable, filter: AuditListFilter = {}): Promise<AuditEvent[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length}`));
  };
  if (filter.objectType !== undefined) add('object_type = ?', filter.objectType);
  if (filter.objectId !== undefined) add('object_id = ?', filter.objectId);
  if (filter.userId !== undefined) add('user_id = ?', filter.userId);
  if (filter.action !== undefined) add('action = ?', filter.action);
  if (filter.from !== undefined) add('at >= ?', filter.from);
  if (filter.to !== undefined) add('at < ?', filter.to);
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
  values.push(limit);
  const { rows } = await db.query<AuditEventRow>(
    `SELECT ${COLUMNS} FROM audit_event
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY seq DESC LIMIT $${values.length}`,
    values,
  );
  return rows.map(toAuditEvent);
}

export const audit = { record, list } as const;

/**
 * Runs a mutation and its single audit event atomically (P7). Use for every
 * create, edit, submit, decision, publish, ingestion, export and role change.
 */
export async function withAuditedTransaction<T>(
  pool: pg.Pool,
  actor: Actor,
  fn: (tx: AuditedTx) => Promise<T>,
): Promise<T> {
  return withTransaction(pool, async (tx) => {
    const audited: AuditedTx = Object.assign(Object.create(null) as object, tx, { actor });
    recordedCount.set(audited, 0);
    const result = await fn(audited);
    const count = recordedCount.get(audited) ?? 0;
    if (count !== 1) {
      throw new AuditInvariantError(`a mutation must record exactly one audit event (recorded ${count})`);
    }
    return result;
  });
}
