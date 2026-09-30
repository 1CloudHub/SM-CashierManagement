/**
 * Cost visibility in responses (task 21; requirement 25; P1, P11).
 *
 * The router passes every response body through `shapeResponseCost` after the
 * handler runs, with the principal the route guard resolved: each
 * `costFigure(...)` the handler put in the body is kept (as its number) only
 * if the active role may see cost at that level and for that store, and is
 * otherwise removed with its key. Handlers therefore never check cost
 * permissions themselves — they tag every ₱ field:
 *
 *     kpis: { seasonCost: costFigure({ level: 'network' }, total) }
 *     stores: rows.map((r) => ({ id: r.id, cost: costFigure({ level: 'store', store: r }, r.cost) }))
 *
 * and type optional cost fields as optional in the shared DTO. A raw number
 * under a cost-named key makes the request fail (500) rather than leak.
 * Network-level figures must still be computed from in-scope stores only (P1).
 */
import { shapeCost, type CostViewer } from '@lanewise/shared';
import type { Principal } from '../context.js';
import type { ApiResponse } from './types.js';

export { costFigure, type CostDraft } from '@lanewise/shared';

/** The cost viewer for a request: nobody (sees no cost) when there is no principal. */
export function costViewer(principal: Principal | null): CostViewer {
  return principal === null ? { role: null, scope: null } : { role: principal.activeRole, scope: principal.scope };
}

/** Removes every cost figure the principal's active role may not see (see module doc). */
export function shapeResponseCost(response: ApiResponse, principal: Principal | null): ApiResponse {
  return { ...response, body: shapeCost<unknown>(response.body, costViewer(principal)) };
}
