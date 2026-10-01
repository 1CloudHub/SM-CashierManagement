/**
 * Audit log — `/audit-events` (SCR-073; requirement 22.4; P1, P7, P12).
 *
 * Guards on the RBAC row "Audit log": `audit_log: view` to list (System
 * Admin; Rules Steward limited to data and rules events), `audit_log:
 * export` to export (System Admin). Both are narrowed server-side to the
 * categories the active role may read (`auditCategoriesFor`) and, for a
 * scoped role, to events by users inside that scope (P1). An export records
 * one `export.generated` event (P7) and carries the sample-data marker when
 * any exported event is seeded demo data (P9).
 */
import {
  AUDIT_EVENT_CATEGORIES,
  AUDIT_EXPORT_MAX,
  AUDIT_PAGE_SIZE,
  auditCategoriesFor,
  auditChanges,
  buildCsvExport,
  isIsoDate,
  type AuditEventCategory,
  type AuditLogResponse,
  type FileDownload,
} from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/guards.js';
import { isUuid } from '../auth/scope.js';
import { requirePrincipal, type Principal } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction } from '../db/audit.js';
import { AUDIT_TIME_ZONE, listAuditActors, listAuditLog, type AuditLogFilter } from '../db/repositories/audit-log.js';
import { recordExport } from '../db/repositories/exports.js';
import { errors } from '../http/errors.js';
import type { Router } from '../http/router.js';
import type { RoutedRequest } from '../http/types.js';
import { parseInput } from '../http/validation.js';
import { usersInScope } from './admin-users.js';

export interface AuditLogRouteDeps {
  readonly db: () => pg.Pool;
}

const date = z.string().refine(isIsoDate, { message: 'Use a date like 2026-10-01.' });
const query = z
  .object({
    from: date.optional(),
    to: date.optional(),
    userId: z.string().refine(isUuid, { message: 'Not a valid id.' }).optional(),
    category: z.enum(AUDIT_EVENT_CATEGORIES).optional(),
    object: z.string().max(200).optional(),
  })
  .passthrough()
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    path: ['to'],
    message: 'The To date is before the From date.',
  });

type AuditQuery = z.output<typeof query>;

/** The filter the role may run: its categories (∩ the requested one) and, when scoped, its users (P1). */
async function scopedFilter(db: pg.Pool, principal: Principal, q: AuditQuery) {
  const allowed = auditCategoriesFor(principal.activeRole);
  if (allowed === null || principal.scope === null) throw errors.forbidden();
  const categories: readonly AuditEventCategory[] = q.category === undefined ? allowed : allowed.filter((c) => c === q.category);
  const actorIds = principal.scope.type === 'global' ? null : (await usersInScope(db, principal)).users.map((u) => u.row.id);
  const filter: AuditLogFilter = {
    categories,
    actorIds,
    ...(q.from !== undefined ? { from: q.from } : {}),
    ...(q.to !== undefined ? { to: q.to } : {}),
    ...(q.userId !== undefined ? { userId: q.userId } : {}),
    ...(q.object !== undefined && q.object.trim().length > 0 ? { object: q.object.trim() } : {}),
  };
  return { filter, allowed };
}

function parseQuery(request: RoutedRequest): AuditQuery {
  return parseInput(query, request.query, 'query');
}

export function registerAuditLogRoutes(router: Router, deps: AuditLogRouteDeps): Router {
  return router
    .get('/audit-events', authorize('audit_log', 'view'), async (request, context) => {
      const principal = requirePrincipal(context);
      const db = deps.db();
      const { filter, allowed } = await scopedFilter(db, principal, parseQuery(request));
      const [page, actors] = await Promise.all([
        listAuditLog(db, filter, AUDIT_PAGE_SIZE),
        listAuditActors(db, { categories: allowed, actorIds: filter.actorIds }),
      ]);
      const body: AuditLogResponse = { events: page.events, truncated: page.truncated, actors, categories: allowed };
      return { statusCode: 200, body };
    })
    .get('/audit-events/export', authorize('audit_log', 'export'), async (request, context) => {
      const principal = requirePrincipal(context);
      const db = deps.db();
      const q = parseQuery(request);
      const { filter } = await scopedFilter(db, principal, q);
      const page = await listAuditLog(db, filter, AUDIT_EXPORT_MAX);
      const content = buildCsvExport({
        title: 'Audit log',
        generatedAt: context.now().toISOString(),
        generatedBy: principal.email,
        sampleData: page.synthetic,
        meta: [
          ['From', q.from ?? 'any'],
          ['To', q.to ?? 'any'],
          ['Time zone', AUDIT_TIME_ZONE],
          ['Event type', q.category ?? 'all'],
          ['Object', q.object ?? ''],
          ...(page.truncated ? ([['Note', `First ${AUDIT_EXPORT_MAX} events only; narrow the filters for the rest.`]] as const) : []),
        ],
        columns: ['Time', 'User', 'Active role', 'Event', 'Event type', 'Object type', 'Object id', 'Object', 'Detail'],
        rows: page.events.map((e) => [
          e.at,
          e.user.name,
          e.activeRole,
          e.event,
          e.category,
          e.objectType,
          e.objectId,
          e.objectName ?? '',
          auditChanges(e.before, e.after)
            .map((c) => `${c.field}: ${c.before ?? '—'} → ${c.after ?? '—'}`)
            .join('; '),
        ]),
      });
      await withAuditedTransaction(db, actorFromPrincipal(principal, context.requestId), (tx) =>
        recordExport(tx, {
          screen: 'SCR-073',
          format: 'csv',
          objectType: 'audit_log',
          objectId: 'events',
          rowCount: page.events.length,
          query: new URLSearchParams(request.query).toString(),
          synthetic: page.synthetic,
        }),
      );
      const body: FileDownload = { fileName: 'audit-log.csv', contentType: 'text/csv', content };
      return { statusCode: 200, body };
    });
}
