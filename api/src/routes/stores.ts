/**
 * `GET /stores` and `GET /stores/:storeId` (SCR-052 master data) — the first
 * scoped routes, proving the pattern every list and deep link follows (P1):
 * lists are filtered to the active role's scope in SQL (and re-checked), and
 * a deep link outside scope gets the same 404 as a missing store.
 */
import { isStoreInScope, type StoreListResponse, type StoreSummary } from '@lanewise/shared';
import type pg from 'pg';
import { authorize } from '../auth/guards.js';
import { requirePrincipal } from '../context.js';
import { getStore, listStoresInScope, type StoreRecord } from '../db/repositories/org.js';
import { errors } from '../http/errors.js';
import type { Router } from '../http/router.js';

export interface StoreDeps {
  readonly db: () => pg.Pool;
}

function toSummary(store: StoreRecord): StoreSummary {
  return {
    id: store.id,
    code: store.code,
    name: store.name,
    format: store.format,
    regionId: store.regionId,
    active: store.active,
    synthetic: store.synthetic,
  };
}

export function registerStoreRoutes(router: Router, deps: StoreDeps): Router {
  return router
    .get('/stores', authorize('master_data', 'view'), async (_request, context) => {
      const { scope } = requirePrincipal(context);
      if (scope === null) throw errors.forbidden();
      const stores = await listStoresInScope(deps.db(), scope);
      // Defence in depth: never return a store outside scope, whatever the query did.
      const body: StoreListResponse = {
        stores: stores.filter((s) => isStoreInScope(scope, s)).map(toSummary),
      };
      return { statusCode: 200, body };
    })
    .get(
      '/stores/:storeId',
      authorize('master_data', 'view', { kind: 'store', param: 'storeId' }),
      async (request, context) => {
        const { scope } = requirePrincipal(context);
        const store = await getStore(deps.db(), request.params.storeId ?? '');
        if (scope === null || store === null || !isStoreInScope(scope, store)) throw errors.notFoundOrNoAccess();
        return { statusCode: 200, body: toSummary(store) };
      },
    );
}
