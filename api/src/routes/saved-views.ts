/**
 * `/saved-views` — named views of a planning screen (task 20; requirement
 * 21.5). A saved view is personal: the list returns only the caller's own
 * views, and a deep link to someone else's view gets the same 404 as a
 * missing one (the `saved_view` scope target checks ownership before the
 * handler runs). Every change writes exactly one audit event (P7); a no-op
 * change writes none. The query is stored in its canonical form, so unknown
 * or malformed parameters are dropped.
 */
import {
  SAVED_VIEW_NAME_MAX,
  SAVED_VIEW_SCREENS,
  VIEW_QUERY_MAX,
  normalizeViewQuery,
  type SavedViewListResponse,
} from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/guards.js';
import { requirePrincipal } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction } from '../db/audit.js';
import { pgErrorCode } from '../db/rows.js';
import {
  SavedViewNotFound,
  SavedViewUnchanged,
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
} from '../db/repositories/saved-views.js';
import { ApiError, errors } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { parseInput } from '../http/validation.js';

export interface SavedViewDeps {
  readonly db: () => pg.Pool;
}

const screen = z.enum(SAVED_VIEW_SCREENS);
const name = z
  .string()
  .trim()
  .min(1, 'Give the view a name.')
  .max(SAVED_VIEW_NAME_MAX, `Use at most ${SAVED_VIEW_NAME_MAX} characters.`);
const query = z
  .string()
  .max(VIEW_QUERY_MAX, 'These filters are too long to save.')
  .transform((q) => normalizeViewQuery(q));

const listQuery = z.object({ screen: screen.optional() });
const createBody = z.object({ screen, name, query, isDefault: z.boolean().default(false) }).strict();
const updateBody = z
  .object({ name: name.optional(), query: query.optional(), isDefault: z.boolean().optional() })
  .strict()
  .refine((b) => b.name !== undefined || b.query !== undefined || b.isDefault !== undefined, 'Nothing to change.');

const VIEW_TARGET = { kind: 'saved_view', param: 'viewId' } as const;

function conflictOnDuplicate(err: unknown): never {
  if (pgErrorCode(err) === '23505') {
    throw new ApiError('conflict', 'You already have a view with that name on this screen. Choose another name.');
  }
  throw err;
}

export function registerSavedViewRoutes(router: Router, deps: SavedViewDeps): Router {
  return router
    .get('/saved-views', authorize('own_profile', 'view'), async (request, context) => {
      const principal = requirePrincipal(context);
      const filter = parseInput(listQuery, request.query, 'query');
      const body: SavedViewListResponse = { views: await listSavedViews(deps.db(), principal.userId, filter.screen) };
      return { statusCode: 200, body };
    })
    .post('/saved-views', authorize('own_profile', 'edit'), async (request, context) => {
      const principal = requirePrincipal(context);
      const input = parseInput(createBody, request.body, 'body');
      const view = await withAuditedTransaction(deps.db(), actorFromPrincipal(principal, context.requestId), (tx) =>
        createSavedView(tx, input),
      ).catch(conflictOnDuplicate);
      return { statusCode: 201, body: view };
    })
    .patch('/saved-views/:viewId', authorize('own_profile', 'edit', VIEW_TARGET), async (request, context) => {
      const principal = requirePrincipal(context);
      const input = parseInput(updateBody, request.body, 'body');
      try {
        const view = await withAuditedTransaction(deps.db(), actorFromPrincipal(principal, context.requestId), (tx) =>
          updateSavedView(tx, request.params.viewId ?? '', input),
        );
        return { statusCode: 200, body: view };
      } catch (err) {
        if (err instanceof SavedViewUnchanged) return { statusCode: 200, body: err.view };
        if (err instanceof SavedViewNotFound) throw errors.notFoundOrNoAccess();
        return conflictOnDuplicate(err);
      }
    })
    .delete('/saved-views/:viewId', authorize('own_profile', 'edit', VIEW_TARGET), async (request, context) => {
      const principal = requirePrincipal(context);
      try {
        const view = await withAuditedTransaction(deps.db(), actorFromPrincipal(principal, context.requestId), (tx) =>
          deleteSavedView(tx, request.params.viewId ?? ''),
        );
        return { statusCode: 200, body: view };
      } catch (err) {
        if (err instanceof SavedViewNotFound) throw errors.notFoundOrNoAccess();
        throw err;
      }
    });
}
