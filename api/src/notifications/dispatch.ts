/**
 * Email dispatch for notifications (task 19; requirement 20.2, 20.3, 20.5).
 *
 * Every notification row starts with `email_status = 'pending'` (migration
 * 0190). `dispatchPendingEmails` claims a batch of pending rows (row locks
 * with SKIP LOCKED, so concurrent dispatchers never pick the same row),
 * decides each one from the catalogue and the recipient's preferences
 * (`shouldEmail`), renders it in the recipient's language and sends it
 * through the injected `EmailSender`:
 *
 *  - `skipped` — the preference is off, the event is in-app only, the
 *    recipient is disabled, or is a seeded demo persona (P18: demo accounts
 *    are not real mailboxes);
 *  - `sent`    — SES accepted it;
 *  - a send error leaves the row `pending` for the next dispatch, and after
 *    `maxAttempts` errors marks it `failed`.
 *
 * The API runs it right after each successful write request (api/src/app.ts),
 * so email goes out as each event happens — never as a digest (Q7).
 */
import { LANGUAGES, shouldEmail, type Language, type NotificationSeverity } from '@lanewise/shared';
import type pg from 'pg';
import { withTransaction } from '../db/pool.js';
import { OBJECT_NAME_SQL, loadPreferenceOverrides } from '../db/repositories/notifications.js';
import type { Logger } from '../logger.js';
import { renderEmail, type EmailSender } from './email.js';

export interface DispatchOptions {
  /** SPA origin for deep links, e.g. `https://lanewise.example`. */
  readonly appBaseUrl: string;
  /** Rows claimed per call. */
  readonly limit?: number;
  /** Send errors before a row is marked `failed`. */
  readonly maxAttempts?: number;
  readonly logger?: Logger;
}

export interface DispatchResult {
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
  readonly retrying: number;
}

interface PendingRow extends pg.QueryResultRow {
  id: string;
  user_id: string;
  event: string;
  severity: NotificationSeverity;
  object_type: string;
  object_id: string;
  object_name: string | null;
  params: Record<string, unknown>;
  synthetic: boolean;
  email_attempts: number;
  email: string;
  name: string;
  language: string;
  user_status: string;
  user_synthetic: boolean;
}

export const DEFAULT_DISPATCH_LIMIT = 25;
export const DEFAULT_MAX_ATTEMPTS = 3;

export async function dispatchPendingEmails(
  pool: pg.Pool,
  sender: EmailSender,
  options: DispatchOptions,
): Promise<DispatchResult> {
  const limit = options.limit ?? DEFAULT_DISPATCH_LIMIT;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  return withTransaction(pool, async (tx) => {
    const { rows } = await tx.query<PendingRow>(
      `SELECT n.id, n.user_id, n.event, n.severity, n.object_type, n.object_id, ${OBJECT_NAME_SQL} AS object_name,
              n.params, n.synthetic, n.email_attempts,
              u.email, u.name, u.language, u.status AS user_status, u.synthetic AS user_synthetic
         FROM notification n
         JOIN app_user u ON u.id = n.user_id
        WHERE n.email_status = 'pending'
        ORDER BY n.created_at, n.id
        LIMIT $1
          FOR UPDATE OF n SKIP LOCKED`,
      [limit],
    );
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let retrying = 0;
    const overrides = new Map<string, Awaited<ReturnType<typeof loadPreferenceOverrides>>>();
    const mark = (id: string, status: 'sent' | 'skipped' | 'failed' | 'pending', attempts: number) =>
      tx.query(`UPDATE notification SET email_status = $2, email_attempts = $3, email_updated_at = now() WHERE id = $1`, [
        id,
        status,
        attempts,
      ]);

    for (const row of rows) {
      if (!overrides.has(row.user_id)) overrides.set(row.user_id, await loadPreferenceOverrides(tx, row.user_id));
      const wanted =
        row.user_status === 'active' &&
        !row.user_synthetic &&
        shouldEmail(row.event, row.severity, overrides.get(row.user_id) ?? {});
      if (!wanted) {
        await mark(row.id, 'skipped', row.email_attempts);
        skipped += 1;
        continue;
      }
      const language: Language = (LANGUAGES as readonly string[]).includes(row.language) ? (row.language as Language) : 'en';
      const message = renderEmail(
        {
          event: row.event,
          severity: row.severity,
          objectType: row.object_type,
          objectId: row.object_id,
          objectName: row.object_name,
          params: row.params,
          synthetic: row.synthetic,
        },
        { email: row.email, name: row.name, language },
        options.appBaseUrl,
      );
      try {
        await sender.send(message);
        await mark(row.id, 'sent', row.email_attempts + 1);
        sent += 1;
      } catch (err) {
        const attempts = row.email_attempts + 1;
        const giveUp = attempts >= maxAttempts;
        await mark(row.id, giveUp ? 'failed' : 'pending', attempts);
        if (giveUp) failed += 1;
        else retrying += 1;
        // Never log the address or the message (PII); the row id is enough to trace.
        options.logger?.warn('notification email failed', { notificationId: row.id, attempts, giveUp, err });
      }
    }
    return { sent, skipped, failed, retrying };
  });
}
