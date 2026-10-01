/**
 * Network map and cross-store matching routes (task 16.1, 16.4; SCR-026;
 * Req 11, 12; P1, P12, P15, P16).
 *
 *   GET /network-map                             pins, staff layer, rings     authorize('network_map', 'view')
 *   GET /network-map/stores/:storeId/candidates  ranked candidates            authorize('network_map', 'view', store)
 *   GET /network-map/auto-match                  network-wide proposal        authorize('shift_offers_send', 'edit')
 *
 * Scope (P1): stores and gaps are those in the active role's scope — a Store
 * Manager sees their own store's gaps; candidates come from every store,
 * pseudonymised (ID, home store, barangay — Req 12.5). Auto-match is offered
 * to the roles that may send offers (Planner; Store Manager for their own
 * store) and only PROPOSES: it creates nothing, sends nothing and so writes
 * no audit event. Sending is task 17.
 *
 * Every body passes the P15 guard in the service.
 */
import { MAP_DAY_PARTS, MAP_TRAVEL_MODES, MAX_TRAVEL_MIN_BOUNDS, STORE_FORMATS, type NetworkMapQuery } from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/guards.js';
import { requirePrincipal, type RequestContext } from '../context.js';
import { errors } from '../http/errors.js';
import type { Router } from '../http/router.js';
import type { RoutedRequest } from '../http/types.js';
import { parseInput } from '../http/validation.js';
import type { NetworkGapsSource } from '../network-map/gaps.js';
import { networkViewGaps } from '../network-map/network-view-gaps.js';
import { autoMatchProposal, networkMap, storeCandidates } from '../network-map/service.js';

export interface NetworkMapDeps {
  readonly db: () => pg.Pool;
  /** Gap/surplus source; defaults to the task 14 network view (falling back to published rosters). */
  readonly gapsSource?: NetworkGapsSource;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-19.')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'Use a real calendar date.');

const mapQuery = z.strictObject({
  date: isoDate,
  dayPart: z.enum(MAP_DAY_PARTS).default('midday'),
  mode: z.enum(MAP_TRAVEL_MODES).default('public_transport'),
  maxTravelMin: z.coerce.number().int().min(MAX_TRAVEL_MIN_BOUNDS.min).max(MAX_TRAVEL_MIN_BOUNDS.max).default(30),
  department: z.string().trim().min(1).max(80).toLowerCase().optional(),
  /** Comma-separated store formats. */
  formats: z
    .string()
    .max(200)
    .transform((s) => s.split(',').map((x) => x.trim()).filter((x) => x.length > 0))
    .pipe(z.array(z.enum(STORE_FORMATS)))
    .optional(),
});

const storeParams = z.strictObject({ storeId: z.uuid() });

function query(request: RoutedRequest): NetworkMapQuery {
  const q = parseInput(mapQuery, request.query, 'query');
  return {
    date: q.date,
    dayPart: q.dayPart,
    mode: q.mode,
    maxTravelMin: q.maxTravelMin,
    ...(q.department !== undefined ? { department: q.department.replace(/\s+/g, ' ') } : {}),
    ...(q.formats !== undefined && q.formats.length > 0 ? { formats: [...new Set(q.formats)] } : {}),
  };
}

function scopeOf(context: RequestContext) {
  const { scope } = requirePrincipal(context);
  if (scope === null || scope.type === 'self') throw errors.forbidden();
  return scope;
}

export function registerNetworkMapRoutes(router: Router, deps: NetworkMapDeps): Router {
  const source = deps.gapsSource ?? networkViewGaps;
  return router
    .get('/network-map', authorize('network_map', 'view'), async (request, context) => {
      const scope = scopeOf(context);
      const q = query(request);
      return { statusCode: 200, body: await networkMap(deps.db(), scope, q, source) };
    })
    .get(
      '/network-map/stores/:storeId/candidates',
      authorize('network_map', 'view', { kind: 'store', param: 'storeId' }),
      async (request, context) => {
        const scope = scopeOf(context);
        const { storeId } = parseInput(storeParams, request.params, 'params');
        const q = query(request);
        const body = await storeCandidates(deps.db(), scope, storeId, q, source);
        if (body === null) throw errors.notFoundOrNoAccess();
        return { statusCode: 200, body };
      },
    )
    .get('/network-map/auto-match', authorize('shift_offers_send', 'edit'), async (request, context) => {
      const scope = scopeOf(context);
      const q = query(request);
      return { statusCode: 200, body: await autoMatchProposal(deps.db(), scope, q, source) };
    });
}
