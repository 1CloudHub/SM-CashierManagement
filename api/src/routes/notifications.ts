/**
 * `/notifications` and `/notification-preferences` (task 19; requirement 20;
 * SCR-040 and the top-bar bell).
 *
 * Every route works on the caller's own records only (P11): the list and the
 * unread count are filtered by the caller's user id in SQL, and a deep link to
 * someone else's notification gets the same 404 as a missing one (the
 * `notification` scope target checks ownership before the handler runs). All
 * roles hold `own_profile` (RBAC matrix: "Own profile, passkeys, language,
 * notification preferences"), so every role reads its own notifications under
 * whichever role is active. Preference changes are audited (P7).
 */
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_FILTERS,
  NOTIFICATION_PAGE_MAX,
  type MarkNotificationsReadResponse,
  type NotificationPreferencesResponse,
} from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/guards.js';
import { requirePrincipal } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction } from '../db/audit.js';
import {
  MandatoryPreferenceError,
  getPreferences,
  listNotifications,
  markAllRead,
  markRead,
  updatePreferences,
} from '../db/repositories/notifications.js';
import { ApiError, errors } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { parseInput } from '../http/validation.js';

export interface NotificationDeps {
  readonly db: () => pg.Pool;
}

const filter = z.enum(NOTIFICATION_FILTERS);
const listQuery = z
  .object({
    filter: filter.default('all'),
    limit: z.coerce.number().int().min(1).max(NOTIFICATION_PAGE_MAX).default(20),
    before: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
const readAllBody = z.object({ filter: filter.default('all') }).strict();
const preferencesBody = z
  .object({
    preferences: z
      .array(
        z
          .object({
            category: z.enum(NOTIFICATION_CATEGORIES),
            inApp: z.boolean().optional(),
            email: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1, 'Nothing to change.')
      .max(NOTIFICATION_CATEGORIES.length * 2),
  })
  .strict();

const NOTIFICATION_TARGET = { kind: 'notification', param: 'notificationId' } as const;

export function registerNotificationRoutes(router: Router, deps: NotificationDeps): Router {
  return router
    .get('/notifications', authorize('own_profile', 'view'), async (request, context) => {
      const principal = requirePrincipal(context);
      const q = parseInput(listQuery, request.query, 'query');
      return { statusCode: 200, body: await listNotifications(deps.db(), principal.userId, q) };
    })
    .post('/notifications/read-all', authorize('own_profile', 'edit'), async (request, context) => {
      const principal = requirePrincipal(context);
      const input = parseInput(readAllBody, request.body ?? {}, 'body');
      const body: MarkNotificationsReadResponse = await markAllRead(deps.db(), principal.userId, input.filter);
      return { statusCode: 200, body };
    })
    .post(
      '/notifications/:notificationId/read',
      authorize('own_profile', 'edit', NOTIFICATION_TARGET),
      async (request, context) => {
        const principal = requirePrincipal(context);
        const item = await markRead(deps.db(), principal.userId, request.params.notificationId ?? '');
        if (!item) throw errors.notFoundOrNoAccess();
        return { statusCode: 200, body: item };
      },
    )
    .get('/notification-preferences', authorize('own_profile', 'view'), async (_request, context) => {
      const principal = requirePrincipal(context);
      const body: NotificationPreferencesResponse = await getPreferences(deps.db(), principal.userId);
      return { statusCode: 200, body };
    })
    .put('/notification-preferences', authorize('own_profile', 'edit'), async (request, context) => {
      const principal = requirePrincipal(context);
      const input = parseInput(preferencesBody, request.body, 'body');
      try {
        await withAuditedTransaction(deps.db(), actorFromPrincipal(principal, context.requestId), async (tx) => {
          const updated = await updatePreferences(tx, input.preferences);
          // Nothing changed: roll back without an audit event.
          if (updated === null) throw new NoChange();
        });
      } catch (err) {
        if (err instanceof MandatoryPreferenceError) {
          throw new ApiError('validation_failed', 'Approvals and security notifications can’t be turned off.', {
            details: [{ path: 'body.preferences', message: `${err.category} notifications stay on.` }],
          });
        }
        if (!(err instanceof NoChange)) throw err;
      }
      const body: NotificationPreferencesResponse = await getPreferences(deps.db(), principal.userId);
      return { statusCode: 200, body };
    });
}

class NoChange extends Error {}
