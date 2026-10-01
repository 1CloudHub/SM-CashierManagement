/**
 * The audit log read model (SCR-073; requirement 22.4; P1, P7).
 *
 * Reads only — the log is append-only (`db/audit.ts`). Every query is
 * restricted server-side to the categories the active role may read (a Rules
 * Steward sees data and rules events only) and, for a scoped role, to events
 * by users inside that scope.
 */
import {
  AUDIT_CATEGORY_PREFIXES,
  auditEventCategory,
  type AuditAction,
  type AuditEventCategory,
  type AuditLogEntry,
  type NamedRef,
  type RoleCode,
} from '@lanewise/shared';
import type pg from 'pg';
import type { Queryable } from '../pool.js';

/** The calendar used for the From/To dates of SCR-073. */
export const AUDIT_TIME_ZONE = 'Asia/Manila';

export interface AuditLogFilter {
  /** Inclusive `YYYY-MM-DD` dates in `AUDIT_TIME_ZONE`. */
  readonly from?: string;
  readonly to?: string;
  readonly userId?: string;
  /** Categories to include (already narrowed to what the role may read). */
  readonly categories: readonly AuditEventCategory[];
  readonly object?: string;
  /** Only events by these users (`null`: anyone). */
  readonly actorIds: readonly string[] | null;
}

interface AuditLogRow extends pg.QueryResultRow {
  id: string;
  at: Date;
  user_id: string;
  user_name: string;
  active_role: RoleCode;
  action: AuditAction;
  event: string;
  object_type: string;
  object_id: string;
  object_name: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  synthetic: boolean;
}

/** Escapes `%`, `_` and `\` for a literal ILIKE match. */
function likeContains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const OBJECT_NAME = `CASE e.object_type
    WHEN 'scenario' THEN (SELECT s.name FROM scenario s WHERE s.id::text = e.object_id)
    WHEN 'user' THEN (SELECT u2.name FROM app_user u2 WHERE u2.id::text = e.object_id)
    WHEN 'store' THEN (SELECT st.name FROM store st WHERE st.id::text = e.object_id)
    WHEN 'region' THEN (SELECT r.name FROM region r WHERE r.id::text = e.object_id)
    WHEN 'rule_set' THEN (SELECT rs.name FROM rule_set rs WHERE rs.id::text = e.object_id)
    WHEN 'rule_version' THEN (SELECT rs.name || ' v' || rv.version FROM rule_version rv
                                JOIN rule_set rs ON rs.id = rv.rule_set_id WHERE rv.id::text = e.object_id)
  END`;

class Where {
  readonly parts: string[] = [];
  readonly values: unknown[] = [];
  param(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
  add(sql: string): void {
    this.parts.push(sql);
  }
  toSql(): string {
    return this.parts.length > 0 ? `WHERE ${this.parts.join(' AND ')}` : '';
  }
}

/** SQL matching events in any of `categories` (mirrors the shared `auditEventCategory`). */
function categorySql(w: Where, categories: readonly AuditEventCategory[]): string {
  const set = new Set(categories);
  const prefix = 'split_part(e.event, \'.\', 1)';
  const or: string[] = [];
  if (set.has('export')) or.push(`e.action = 'export'`);
  const named = (Object.keys(AUDIT_CATEGORY_PREFIXES) as (keyof typeof AUDIT_CATEGORY_PREFIXES)[]).filter((c) => set.has(c));
  const prefixes = named.flatMap((c) => AUDIT_CATEGORY_PREFIXES[c]);
  if (prefixes.length > 0) or.push(`(e.action <> 'export' AND ${prefix} = ANY(${w.param(prefixes)}::text[]))`);
  if (set.has('other')) {
    const all = Object.values(AUDIT_CATEGORY_PREFIXES).flat();
    or.push(`(e.action <> 'export' AND NOT (${prefix} = ANY(${w.param(all)}::text[])))`);
  }
  return or.length > 0 ? `(${or.join(' OR ')})` : 'FALSE';
}

function baseWhere(filter: AuditLogFilter): Where {
  const w = new Where();
  w.add(categorySql(w, filter.categories));
  if (filter.actorIds !== null) w.add(`e.user_id = ANY(${w.param([...filter.actorIds])}::uuid[])`);
  if (filter.userId !== undefined) w.add(`e.user_id = ${w.param(filter.userId)}`);
  if (filter.from !== undefined || filter.to !== undefined) {
    const tz = w.param(AUDIT_TIME_ZONE);
    if (filter.from !== undefined) w.add(`e.at >= ((${w.param(filter.from)}::date)::timestamp AT TIME ZONE ${tz}::text)`);
    if (filter.to !== undefined) w.add(`e.at < ((${w.param(filter.to)}::date + 1)::timestamp AT TIME ZONE ${tz}::text)`);
  }
  return w;
}

export interface AuditLogPage {
  readonly events: AuditLogEntry[];
  readonly truncated: boolean;
  /** Whether any returned event is seeded demo data (the export's sample-data marker, P9). */
  readonly synthetic: boolean;
}

/** Events newest first, at most `limit` (`truncated` when more match). */
export async function listAuditLog(db: Queryable, filter: AuditLogFilter, limit: number): Promise<AuditLogPage> {
  const w = baseWhere(filter);
  const objectFilter =
    filter.object !== undefined && filter.object.length > 0
      ? (() => {
          const q = w.param(likeContains(filter.object));
          return `WHERE (x.object_type ILIKE ${q} OR x.object_id ILIKE ${q} OR x.object_name ILIKE ${q} OR x.event ILIKE ${q})`;
        })()
      : '';
  const lim = w.param(limit + 1);
  const { rows } = await db.query<AuditLogRow & { seq: string }>(
    `SELECT x.* FROM (
       SELECT e.seq, e.id, e.at, e.user_id, u.name AS user_name, e.active_role, e.action, e.event,
              e.object_type, e.object_id, ${OBJECT_NAME} AS object_name, e.before, e.after, e.synthetic
         FROM audit_event e JOIN app_user u ON u.id = e.user_id
         ${w.toSql()}
     ) x ${objectFilter}
     ORDER BY x.seq DESC LIMIT ${lim}`,
    w.values,
  );
  const page = rows.slice(0, limit);
  return {
    events: page.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      user: { id: r.user_id, name: r.user_name },
      activeRole: r.active_role,
      action: r.action,
      event: r.event,
      category: auditEventCategory({ event: r.event, action: r.action }),
      objectType: r.object_type,
      objectId: r.object_id,
      objectName: r.object_name,
      before: r.before,
      after: r.after,
    })),
    truncated: rows.length > limit,
    synthetic: page.some((r) => r.synthetic),
  };
}

/** People who appear in the events the role may read (the SCR-073 user filter). */
export async function listAuditActors(
  db: Queryable,
  filter: Pick<AuditLogFilter, 'categories' | 'actorIds'>,
): Promise<NamedRef[]> {
  const w = baseWhere({ categories: filter.categories, actorIds: filter.actorIds });
  const { rows } = await db.query<{ id: string; name: string } & pg.QueryResultRow>(
    `SELECT u.id, u.name FROM app_user u
      WHERE EXISTS (SELECT 1 FROM audit_event e ${w.toSql()} ${w.parts.length > 0 ? 'AND' : 'WHERE'} e.user_id = u.id)
      ORDER BY lower(u.name), u.id LIMIT 500`,
    w.values,
  );
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
