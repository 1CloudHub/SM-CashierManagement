/**
 * Notifications and notification preferences (task 19; requirement 20; P1,
 * P11). Every read and write here is bound to one user id — the caller's —
 * so a user only ever sees, or marks read, notifications addressed to them.
 * Preference changes record exactly one audit event (P7); marking read is
 * the reader's own bookkeeping and is not audited.
 */
import {
  LANGUAGES,
  NOTIFICATION_FILTER_CATEGORIES,
  eventsInCategories,
  isMandatoryCategory,
  isNotificationCategory,
  notificationCategory,
  notificationLink,
  resolvePreferences,
  type Language,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationFilter,
  type NotificationItem,
  type NotificationListResponse,
  type NotificationPreference,
  type NotificationPreferenceOverrides,
  type NotificationSeverity,
} from '@lanewise/shared';
import type pg from 'pg';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';

/**
 * The display name of a notification's object, resolved at read time so a
 * renamed scenario shows its current name. `n` is the notification alias.
 */
export const OBJECT_NAME_SQL = `CASE n.object_type
    WHEN 'scenario' THEN (SELECT s.name FROM scenario s WHERE s.id::text = n.object_id)
    WHEN 'rule_version' THEN (
      SELECT rs.name || ' v' || rv.version FROM rule_version rv JOIN rule_set rs ON rs.id = rv.rule_set_id
       WHERE rv.id::text = n.object_id)
    WHEN 'ingestion_run' THEN (SELECT ir.file_name FROM ingestion_run ir WHERE ir.id::text = n.object_id)
    ELSE NULL
  END`;

interface NotificationRow extends pg.QueryResultRow {
  id: string;
  event: string;
  severity: NotificationSeverity;
  object_type: string;
  object_id: string;
  object_name: string | null;
  params: Record<string, unknown>;
  synthetic: boolean;
  created_at: Date;
  read_at: Date | null;
}

function toItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    event: row.event,
    category: notificationCategory(row.event),
    severity: row.severity,
    objectType: row.object_type,
    objectId: row.object_id,
    objectName: row.object_name,
    params: row.params,
    link: notificationLink({ event: row.event, objectType: row.object_type, objectId: row.object_id, params: row.params }),
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at?.toISOString() ?? null,
    synthetic: row.synthetic,
  };
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/** The user's stored preference overrides. */
export async function loadPreferenceOverrides(db: Queryable, userId: string): Promise<NotificationPreferenceOverrides> {
  const { rows } = await db.query<{ event: string; channel: NotificationChannel; enabled: boolean } & pg.QueryResultRow>(
    'SELECT event, channel, enabled FROM notification_preference WHERE user_id = $1',
    [userId],
  );
  const overrides: Record<string, Partial<Record<NotificationChannel, boolean>>> = {};
  for (const row of rows) {
    if (!isNotificationCategory(row.event)) continue;
    overrides[row.event] = { ...overrides[row.event], [row.channel]: row.enabled };
  }
  return overrides as NotificationPreferenceOverrides;
}

/**
 * Events hidden from the user's bell and list by their in-app preferences
 * (critical items still show — the query keeps those).
 */
function hiddenEvents(overrides: NotificationPreferenceOverrides): NotificationEvent[] {
  const hidden = (Object.keys(overrides) as NotificationCategory[]).filter(
    (c) => overrides[c]?.in_app === false && !isMandatoryCategory(c),
  );
  return eventsInCategories(hidden);
}

export async function getPreferences(
  db: Queryable,
  userId: string,
): Promise<{ language: Language; preferences: NotificationPreference[] }> {
  const { rows } = await db.query<{ language: Language } & pg.QueryResultRow>('SELECT language FROM app_user WHERE id = $1', [
    userId,
  ]);
  const language = rows[0]?.language;
  return {
    language: language && (LANGUAGES as readonly string[]).includes(language) ? language : 'en',
    preferences: resolvePreferences(await loadPreferenceOverrides(db, userId)),
  };
}

export class MandatoryPreferenceError extends Error {
  constructor(readonly category: NotificationCategory) {
    super(`${category} notifications cannot be turned off`);
  }
}

export interface PreferenceChange {
  readonly category: NotificationCategory;
  readonly inApp?: boolean | undefined;
  readonly email?: boolean | undefined;
}

/**
 * Applies the acting user's preference changes. Turning a mandatory category
 * off is refused (`MandatoryPreferenceError`). Returns `null` — writing
 * nothing, so no audit event — when nothing actually changes; otherwise one
 * `edit` audit event with the before/after settings of the changed categories.
 */
export async function updatePreferences(
  tx: AuditedTx,
  changes: readonly PreferenceChange[],
): Promise<NotificationPreference[] | null> {
  const userId = tx.actor.userId;
  for (const c of changes) {
    if (isMandatoryCategory(c.category) && (c.inApp === false || c.email === false)) {
      throw new MandatoryPreferenceError(c.category);
    }
  }
  const before = resolvePreferences(await loadPreferenceOverrides(tx, userId));
  const byCategory = new Map(before.map((p) => [p.category, p]));
  const writes: { category: NotificationCategory; channel: NotificationChannel; enabled: boolean }[] = [];
  for (const c of changes) {
    if (isMandatoryCategory(c.category)) continue;
    const current = byCategory.get(c.category);
    if (!current) continue;
    if (c.inApp !== undefined && c.inApp !== current.inApp) writes.push({ category: c.category, channel: 'in_app', enabled: c.inApp });
    if (c.email !== undefined && c.email !== current.email) writes.push({ category: c.category, channel: 'email', enabled: c.email });
  }
  // The last change per category+channel wins.
  const unique = [...new Map(writes.map((w) => [`${w.category}:${w.channel}`, w])).values()];
  if (unique.length === 0) return null;
  for (const w of unique) {
    await tx.query(
      `INSERT INTO notification_preference (user_id, event, channel, enabled) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, event, channel) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [userId, w.category, w.channel, w.enabled],
    );
  }
  const after = resolvePreferences(await loadPreferenceOverrides(tx, userId));
  const changed = new Set(unique.map((w) => w.category));
  const snapshot = (prefs: NotificationPreference[]) =>
    Object.fromEntries(prefs.filter((p) => changed.has(p.category)).map((p) => [p.category, { inApp: p.inApp, email: p.email }]));
  await audit.record(tx, {
    action: 'edit',
    event: 'notification_preference.updated',
    objectType: 'notification_preference',
    objectId: userId,
    before: snapshot(before),
    after: snapshot(after),
  });
  return after;
}

// ---------------------------------------------------------------------------
// List and read state
// ---------------------------------------------------------------------------

export interface ListOptions {
  readonly filter: NotificationFilter;
  readonly limit: number;
  /** Only notifications created before this instant (paging). */
  readonly before?: string | undefined;
}

/** The filters the list and the unread count share: own rows, visible in-app. */
function visibleWhere(alias: string): string {
  return `${alias}.user_id = $1 AND NOT (${alias}.event = ANY($2::text[]) AND ${alias}.severity <> 'critical')`;
}

/** The user's own notifications, newest first, with the unread count (P11). */
export async function listNotifications(db: Queryable, userId: string, options: ListOptions): Promise<NotificationListResponse> {
  const hidden = hiddenEvents(await loadPreferenceOverrides(db, userId));
  const categoryEvents =
    options.filter === 'all' || options.filter === 'unread'
      ? null
      : eventsInCategories(NOTIFICATION_FILTER_CATEGORIES[options.filter]);
  const { rows } = await db.query<NotificationRow>(
    `SELECT n.id, n.event, n.severity, n.object_type, n.object_id, ${OBJECT_NAME_SQL} AS object_name,
            n.params, n.synthetic, n.created_at, n.read_at
       FROM notification n
      WHERE ${visibleWhere('n')}
        AND ($3::text[] IS NULL OR n.event = ANY($3::text[]))
        AND (NOT $4::boolean OR n.read_at IS NULL)
        AND ($5::timestamptz IS NULL OR n.created_at < $5::timestamptz)
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT $6`,
    [userId, hidden, categoryEvents, options.filter === 'unread', options.before ?? null, options.limit + 1],
  );
  const page = rows.slice(0, options.limit);
  return {
    items: page.map(toItem),
    unreadCount: await unreadCount(db, userId, hidden),
    nextBefore: rows.length > options.limit ? (page.at(-1)?.created_at.toISOString() ?? null) : null,
  };
}

async function unreadCount(db: Queryable, userId: string, hidden?: readonly string[]): Promise<number> {
  const hide = hidden ?? hiddenEvents(await loadPreferenceOverrides(db, userId));
  const { rows } = await db.query<{ n: number } & pg.QueryResultRow>(
    `SELECT count(*)::int AS n FROM notification n WHERE ${visibleWhere('n')} AND n.read_at IS NULL`,
    [userId, hide],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Marks one of the user's notifications read and returns it; `null` when the
 * user has no such notification (someone else's is the same as a missing one).
 * Marking an already-read notification again keeps its first read time.
 */
export async function markRead(db: Queryable, userId: string, id: string): Promise<NotificationItem | null> {
  const { rows } = await db.query<NotificationRow>(
    `WITH upd AS (
       UPDATE notification SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL RETURNING id
     )
     SELECT n.id, n.event, n.severity, n.object_type, n.object_id, ${OBJECT_NAME_SQL} AS object_name,
            n.params, n.synthetic, n.created_at, coalesce(n.read_at, now()) AS read_at
       FROM notification n WHERE n.id = $1 AND n.user_id = $2`,
    [id, userId],
  );
  return rows[0] ? toItem(rows[0]) : null;
}

/** Marks all of the user's unread notifications (optionally one filter's) read. */
export async function markAllRead(
  db: Queryable,
  userId: string,
  filter: NotificationFilter,
): Promise<{ updated: number; unreadCount: number }> {
  const categoryEvents =
    filter === 'all' || filter === 'unread' ? null : eventsInCategories(NOTIFICATION_FILTER_CATEGORIES[filter]);
  const result = await db.query(
    `UPDATE notification SET read_at = now()
      WHERE user_id = $1 AND read_at IS NULL AND ($2::text[] IS NULL OR event = ANY($2::text[]))`,
    [userId, categoryEvents],
  );
  return { updated: result.rowCount ?? 0, unreadCount: await unreadCount(db, userId) };
}
