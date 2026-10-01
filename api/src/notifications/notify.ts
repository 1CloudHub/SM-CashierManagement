/**
 * Raising notifications from domain events (task 19; requirement 20.1, 20.4;
 * P1, P11).
 *
 * `notify` writes one row per recipient in the caller's transaction, so a
 * notification exists exactly when the change that raised it commits. The
 * email for each row is sent afterwards by the dispatcher (./dispatch.ts).
 *
 * Recipients are named explicitly (`userIds` — e.g. a scenario owner, the
 * cashier whose shift changed) or by role. Role recipients are filtered by
 * scope (requirement 20.4): when the event concerns particular stores, only
 * users whose assignment for that role covers at least one of them are
 * notified; Staff (self scope) are only ever notified by name, about their own
 * shifts and offers (P11).
 */
import { NOTIFICATION_EVENTS, type NotificationEvent, type NotificationSeverity, type RoleCode } from '@lanewise/shared';
import type pg from 'pg';
import type { Queryable } from '../db/pool.js';

export interface NotificationRecipients {
  /** Users notified by name (only if active). */
  readonly userIds?: readonly string[];
  /** Roles whose holders are notified (only if active; never Staff). */
  readonly roles?: readonly RoleCode[];
  /**
   * The stores the event concerns. Set => role recipients must hold the role
   * with a scope covering one of them; unset => the event is network-wide.
   */
  readonly storeIds?: readonly string[];
  /** Never notify these users (typically the actor who caused the event). */
  readonly excludeUserIds?: readonly string[];
}

export interface NotificationInput {
  readonly event: NotificationEvent;
  readonly objectType: string;
  readonly objectId: string;
  /** Defaults to the catalogue severity. */
  readonly severity?: NotificationSeverity;
  readonly params?: Readonly<Record<string, unknown>>;
  /** Provenance of the object (P18). */
  readonly synthetic: boolean;
  readonly recipients: NotificationRecipients;
}

/**
 * Inserts the notification for every resolved recipient and returns their
 * user ids (sorted, distinct).
 */
export async function notify(db: Queryable, input: NotificationInput): Promise<string[]> {
  const r = input.recipients;
  const roles = (r.roles ?? []).filter((role) => role !== 'STF');
  const { rows } = await db.query<{ user_id: string } & pg.QueryResultRow>(
    `WITH recipients AS (
       SELECT u.id
         FROM app_user u
        WHERE u.status = 'active' AND u.id = ANY($1::uuid[])
       UNION
       SELECT u.id
         FROM app_user u
         JOIN role_assignment ra ON ra.user_id = u.id
        WHERE u.status = 'active'
          AND ra.role = ANY($2::text[])
          AND ra.scope_type <> 'self'
          AND (
            $3::uuid[] IS NULL
            OR ra.scope_type = 'global'
            OR (ra.scope_type = 'store' AND ra.scope_ids && $3::uuid[])
            OR (ra.scope_type = 'region' AND EXISTS (
                  SELECT 1 FROM store s WHERE s.id = ANY($3::uuid[]) AND s.region_id = ANY(ra.scope_ids)))
          )
     )
     INSERT INTO notification (user_id, event, object_type, object_id, severity, params, synthetic)
     SELECT id, $4, $5, $6, $7, $8::jsonb, $9
       FROM recipients
      WHERE NOT (id = ANY($10::uuid[]))
     RETURNING user_id`,
    [
      [...(r.userIds ?? [])],
      roles,
      r.storeIds ? [...r.storeIds] : null,
      input.event,
      input.objectType,
      input.objectId,
      input.severity ?? NOTIFICATION_EVENTS[input.event].severity,
      JSON.stringify(input.params ?? {}),
      input.synthetic,
      [...(r.excludeUserIds ?? [])],
    ],
  );
  return [...new Set(rows.map((row) => row.user_id))].sort();
}
