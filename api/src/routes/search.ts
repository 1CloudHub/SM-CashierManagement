/**
 * `GET /search?q=…&limit=…` — global search (task 20; requirement 21.1;
 * SCR-041 and the top-bar dropdown).
 *
 * Every role with a Home dashboard may search, but each group only returns
 * what the active role may view (SEARCH_GROUP_RESOURCES) and only inside its
 * scope (P1): the scope filter runs in SQL and every hit is re-checked here.
 * A Staff user gets no store-wide hits and never another cashier (P11).
 * Read-only: nothing is written.
 */
import {
  SEARCH_DROPDOWN_LIMIT,
  SEARCH_PAGE_LIMIT,
  SEARCH_QUERY_MAX,
  isStoreInScope,
  searchableGroups,
  seesPublishedScenariosOnly,
  type SearchGroup,
  type SearchResponse,
} from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/guards.js';
import { requirePrincipal } from '../context.js';
import { searchDepartments, searchScenarios, searchStaff, searchStores } from '../db/repositories/search.js';
import { errors } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { parseInput } from '../http/validation.js';

export interface SearchDeps {
  readonly db: () => pg.Pool;
}

const searchQuery = z.object({
  q: z
    .string()
    .trim()
    .min(1, 'Enter something to search for.')
    .max(SEARCH_QUERY_MAX, `Use at most ${SEARCH_QUERY_MAX} characters.`),
  limit: z.coerce.number().int().min(1).max(SEARCH_PAGE_LIMIT).default(SEARCH_DROPDOWN_LIMIT),
});

const EMPTY: SearchGroup<never> = { total: 0, items: [] };

/** Drops any item the predicate rejects (defence in depth), keeping `total` honest. */
function keep<T>(group: SearchGroup<T>, ok: (item: T) => boolean): SearchGroup<T> {
  const items = group.items.filter(ok);
  return items.length === group.items.length ? group : { total: group.total - (group.items.length - items.length), items };
}

export function registerSearchRoutes(router: Router, deps: SearchDeps): Router {
  return router.get('/search', authorize('home', 'view'), async (request, context) => {
    const { activeRole, scope } = requirePrincipal(context);
    if (activeRole === null || scope === null) throw errors.forbidden();
    const { q, limit } = parseInput(searchQuery, request.query, 'query');
    const groups = searchableGroups(activeRole);
    const db = deps.db();
    const options = { query: q, limit };

    const [stores, departments, scenarios, staff] = await Promise.all([
      groups.includes('stores') ? searchStores(db, scope, options) : EMPTY,
      groups.includes('departments') ? searchDepartments(db, scope, options) : EMPTY,
      groups.includes('scenarios')
        ? searchScenarios(db, scope, { ...options, publishedOnly: seesPublishedScenariosOnly(activeRole) })
        : EMPTY,
      groups.includes('staff') ? searchStaff(db, scope, options) : EMPTY,
    ]);

    const body: SearchResponse = {
      query: q,
      groups: {
        stores: keep(stores, (s) => isStoreInScope(scope, { id: s.id, regionId: s.regionId })),
        // Department and staff rows were scope-filtered by their store in SQL;
        // a self scope never sees another cashier (P11).
        departments: scope.type === 'self' ? EMPTY : departments,
        scenarios: scope.type === 'self' ? EMPTY : scenarios,
        staff: scope.type === 'self' ? keep(staff, (s) => s.id === scope.staffId) : staff,
      },
    };
    return { statusCode: 200, body };
  });
}
