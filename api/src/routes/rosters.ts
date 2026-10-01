/**
 * Published rosters and store-manager overrides — `/stores/:storeId/rosters`
 * (task 13.4; Req 6.6/6.7, 7; SCR-022; P1, P7, P12, P14).
 *
 * Every route names the store in its path and declares a task 8.1 guard with
 * a `store` scope target, so a roster of a store outside the active role's
 * scope is the same 404 as a missing one (P1). Reading uses the matrix
 * "Weekly roster" row (`weekly_roster: view`); changing a published roster
 * uses "Edit shifts" (`shift_edit: manage` — the Store Manager, own store).
 * Planners edit draft scenarios' rosters elsewhere, never through overrides.
 *
 * `POST …/overrides` validates the change through the `@lanewise/domain`
 * labor rules: a block (missed 24-hour rest after 6 consecutive days,
 * overlap) is a 409, a new warning without a reason is a 422 on
 * `body.reason`; a saved change writes one ShiftOverride, its notifications
 * and exactly one audit event (P7, P14). `POST …/overrides/check` runs the
 * same check without writing (the shift editor's live rule check).
 */
import { ROSTER_STATUSES, can, validateShiftOverrideRequest, type RosterStatus, type ShiftOverrideRequest } from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize, type RouteGuard } from '../auth/guards.js';
import { requirePrincipal, type Principal, type RequestContext } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction } from '../db/audit.js';
import * as rosters from '../db/repositories/rosters.js';
import { PG_ERRORS, pgErrorCode } from '../db/rows.js';
import { ApiError, errors } from '../http/errors.js';
import type { HttpMethod, Router } from '../http/router.js';
import type { ApiResponse, RoutedRequest } from '../http/types.js';
import { parseInput } from '../http/validation.js';

export interface RosterRouteDeps {
  readonly db: () => pg.Pool;
}

interface HandlerArgs {
  readonly request: RoutedRequest;
  readonly context: RequestContext;
  readonly principal: Principal;
  readonly pool: pg.Pool;
}

export interface RosterRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly guard: RouteGuard;
  readonly handler: (args: HandlerArgs) => Promise<ApiResponse>;
}

const STORE = { kind: 'store', param: 'storeId' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const listQuery = z.object({ status: z.enum(ROSTER_STATUSES).optional() }).passthrough();

function param(request: RoutedRequest, name: string): string {
  const id = request.params[name] ?? '';
  if (!UUID.test(id)) throw errors.notFoundOrNoAccess();
  return id;
}

async function loadRoster(pool: pg.Pool, request: RoutedRequest) {
  const roster = await rosters.getRoster(pool, param(request, 'storeId'), param(request, 'rosterId'));
  if (!roster) throw errors.notFoundOrNoAccess();
  return roster;
}

function overrideBody(request: RoutedRequest): ShiftOverrideRequest {
  const result = validateShiftOverrideRequest(request.body ?? {});
  if (!result.ok) {
    throw errors.validationFailed(
      'Some fields are missing or invalid.',
      result.issues.map((i) => ({ path: i.path ? `body.${i.path}` : 'body', message: i.message })),
    );
  }
  return result.request;
}

const canOverride = (principal: Principal) => can(principal.activeRole, 'shift_edit', 'manage');

function mapStateError(error: unknown): never {
  if (error instanceof rosters.RosterStateError) throw errors.conflict(error.message);
  if (error instanceof ApiError) throw error;
  const code = pgErrorCode(error);
  if (code === PG_ERRORS.checkViolation) throw errors.conflict('This change is not allowed for the roster in its current state.');
  if (code === PG_ERRORS.foreignKeyViolation) throw errors.notFound();
  throw error;
}

export const ROSTER_ROUTES: readonly RosterRoute[] = [
  {
    method: 'GET',
    path: '/stores/:storeId/rosters',
    guard: authorize('weekly_roster', 'view', STORE),
    handler: async ({ request, pool }) => {
      const q = parseInput(listQuery, request.query, 'query');
      const statuses: RosterStatus[] = q.status ? [q.status] : ['published'];
      return { statusCode: 200, body: { rosters: await rosters.listRosters(pool, param(request, 'storeId'), statuses) } };
    },
  },
  {
    method: 'GET',
    path: '/stores/:storeId/rosters/:rosterId',
    guard: authorize('weekly_roster', 'view', STORE),
    handler: async ({ request, principal, pool }) => {
      const roster = await loadRoster(pool, request);
      return { statusCode: 200, body: await rosters.rosterDetail(pool, roster, canOverride(principal)) };
    },
  },
  {
    method: 'GET',
    path: '/stores/:storeId/rosters/:rosterId/shifts/:shiftId/replacements',
    guard: authorize('shift_edit', 'manage', STORE),
    handler: async ({ request, pool }) => {
      const roster = await loadRoster(pool, request);
      const shiftId = param(request, 'shiftId');
      return { statusCode: 200, body: { shiftId, candidates: await rosters.replacementCandidates(pool, roster, shiftId) } };
    },
  },
  {
    method: 'POST',
    path: '/stores/:storeId/rosters/:rosterId/overrides/check',
    guard: authorize('shift_edit', 'manage', STORE),
    handler: async ({ request, pool }) => {
      const roster = await loadRoster(pool, request);
      const body = overrideBody(request);
      try {
        return { statusCode: 200, body: { check: await rosters.checkRosterOverride(pool, roster, body) } };
      } catch (error) {
        return mapStateError(error);
      }
    },
  },
  {
    method: 'POST',
    path: '/stores/:storeId/rosters/:rosterId/overrides',
    guard: authorize('shift_edit', 'manage', STORE),
    handler: async ({ request, context, principal, pool }) => {
      const storeId = param(request, 'storeId');
      const rosterId = param(request, 'rosterId');
      const body = overrideBody(request);
      let recorded: rosters.RecordedOverride;
      try {
        recorded = await withAuditedTransaction(pool, actorFromPrincipal(principal, context.requestId), (tx) =>
          rosters.recordOverride(tx, storeId, rosterId, body),
        );
      } catch (error) {
        return mapStateError(error);
      }
      const roster = await rosters.getRoster(pool, storeId, rosterId);
      if (!roster) throw errors.notFoundOrNoAccess();
      const detail = await rosters.rosterDetail(pool, roster, canOverride(principal));
      const override = detail.overrides.find((o) => o.id === recorded.overrideId);
      return { statusCode: 201, body: { override, check: recorded.check, roster: detail } };
    },
  },
];

/** Registers every roster route behind its declared guard. */
export function registerRosterRoutes(router: Router, deps: RosterRouteDeps): Router {
  for (const route of ROSTER_ROUTES) {
    router.add(route.method, route.path, route.guard, async (request, context) =>
      route.handler({ request, context, principal: requirePrincipal(context), pool: deps.db() }),
    );
  }
  return router;
}
