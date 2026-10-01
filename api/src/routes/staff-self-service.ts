/**
 * Staff self-service routes (task 18; SCR-025, SCR-022; Req 15, 7.3/7.4;
 * P1, P7, P11, P12, P14, P19).
 *
 *   GET  /me/roster                                 own shifts, changes, rest days   my_roster: view (self)
 *   GET  /me/requests                               own requests                     staff_requests_raise: view (self)
 *   GET  /me/requests/swap-options                  own shifts + open slots          staff_requests_raise: view (self)
 *   POST /me/requests                               raise time off / swap            staff_requests_raise: edit (self)
 *   POST /me/requests/:requestId/cancel             withdraw a pending request       staff_requests_raise: edit (self)
 *   GET  /stores/:storeId/staff-requests            the store's requests             weekly_roster: view (store)
 *   POST /stores/:storeId/staff-requests/:requestId/decision   approve / decline     staff_requests_approve: manage (store)
 *
 * The `/me/*` routes act only on the Staff user's own staff record (the
 * `self` scope, P11): another cashier's request is a 404. The store routes
 * name the store in the path with a task 8.1 `store` scope target, so another
 * store's requests are the same 404 as missing ones (P1). Each mutation runs
 * in one audited transaction (P7); raising or cancelling a request never
 * touches the roster — only an approval applies it (P19).
 */
import {
  isCalendarDate,
  validateCreateStaffRequest,
  validateStaffRequestDecision,
  type ValidationIssue,
} from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize, type RouteGuard } from '../auth/guards.js';
import { requirePrincipal, type Principal, type RequestContext } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction } from '../db/audit.js';
import * as self from '../db/repositories/staff-self-service.js';
import { PG_ERRORS, pgErrorCode } from '../db/rows.js';
import { ApiError, errors } from '../http/errors.js';
import type { HttpMethod, Router } from '../http/router.js';
import type { ApiResponse, RoutedRequest } from '../http/types.js';
import { parseInput } from '../http/validation.js';

export interface StaffSelfServiceRouteDeps {
  readonly db: () => pg.Pool;
}

interface HandlerArgs {
  readonly request: RoutedRequest;
  readonly context: RequestContext;
  readonly principal: Principal;
  readonly pool: pg.Pool;
  readonly now: Date;
}

export interface StaffSelfServiceRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly guard: RouteGuard;
  readonly handler: (args: HandlerArgs) => Promise<ApiResponse>;
}

const STORE = { kind: 'store', param: 'storeId' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const date = z.string().refine(isCalendarDate, 'Use a calendar date, e.g. 2026-12-19.');
const rosterQuery = z.strictObject({ from: date.optional(), to: date.optional() });

function param(request: RoutedRequest, name: string): string {
  const id = request.params[name] ?? '';
  if (!UUID.test(id)) throw errors.notFoundOrNoAccess();
  return id;
}

/** The Staff user's own staff id (self scope); anything else is refused (P11). */
export function ownStaffId(principal: Principal): string {
  const scope = principal.scope;
  if (scope === null || scope.type !== 'self') throw errors.forbidden();
  return scope.staffId;
}

function invalid(issues: readonly ValidationIssue[]): never {
  throw errors.validationFailed(
    'Some fields are missing or invalid.',
    issues.map((i) => ({ path: i.path ? `body.${i.path}` : 'body', message: i.message })),
  );
}

function mapDbError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  const code = pgErrorCode(error);
  if (code === PG_ERRORS.uniqueViolation) throw errors.conflict('That shift is already offered in a pending swap.');
  if (code === PG_ERRORS.checkViolation) throw errors.conflict('This request cannot change in its current state.');
  if (code === PG_ERRORS.foreignKeyViolation) throw errors.notFound();
  throw error;
}

async function audited<T>(args: HandlerArgs, fn: Parameters<typeof withAuditedTransaction<T>>[2]): Promise<T> {
  try {
    return await withAuditedTransaction(args.pool, actorFromPrincipal(args.principal, args.context.requestId), fn);
  } catch (error) {
    return mapDbError(error);
  }
}

export const STAFF_SELF_SERVICE_ROUTES: readonly StaffSelfServiceRoute[] = [
  // --- My roster (18.1) ----------------------------------------------------
  {
    method: 'GET',
    path: '/me/roster',
    guard: authorize('my_roster', 'view'),
    handler: async ({ request, principal, pool, now }) => {
      const staffId = ownStaffId(principal);
      const q = parseInput(rosterQuery, request.query, 'query');
      const window = self.rosterWindow(now, q.from, q.to);
      return { statusCode: 200, body: await self.myRoster(pool, staffId, window.from, window.to) };
    },
  },

  // --- Requests (18.2) -----------------------------------------------------
  {
    method: 'GET',
    path: '/me/requests',
    guard: authorize('staff_requests_raise', 'view'),
    handler: async ({ principal, pool, now }) => ({
      statusCode: 200,
      body: { requests: await self.listMyRequests(pool, ownStaffId(principal), now) },
    }),
  },
  {
    method: 'GET',
    path: '/me/requests/swap-options',
    guard: authorize('staff_requests_raise', 'view'),
    handler: async ({ principal, pool, now }) => ({ statusCode: 200, body: await self.swapOptions(pool, ownStaffId(principal), now) }),
  },
  {
    method: 'POST',
    path: '/me/requests',
    guard: authorize('staff_requests_raise', 'edit'),
    handler: async (args) => {
      const staffId = ownStaffId(args.principal);
      const result = validateCreateStaffRequest(args.request.body ?? {}, self.today(args.now));
      if (!result.ok) invalid(result.issues);
      const id = await audited(args, (tx) => self.createRequest(tx, staffId, result.value, args.now));
      return { statusCode: 201, body: { request: await self.myRequest(args.pool, staffId, id) } };
    },
  },
  {
    method: 'POST',
    path: '/me/requests/:requestId/cancel',
    guard: authorize('staff_requests_raise', 'edit'),
    handler: async (args) => {
      const staffId = ownStaffId(args.principal);
      const id = param(args.request, 'requestId');
      await audited(args, (tx) => self.cancelRequest(tx, staffId, id));
      return { statusCode: 200, body: { request: await self.myRequest(args.pool, staffId, id) } };
    },
  },
  {
    method: 'GET',
    path: '/stores/:storeId/staff-requests',
    guard: authorize('weekly_roster', 'view', STORE),
    handler: async ({ request, pool, now }) => ({
      statusCode: 200,
      body: { requests: await self.listStoreRequests(pool, param(request, 'storeId'), now) },
    }),
  },
  {
    method: 'POST',
    path: '/stores/:storeId/staff-requests/:requestId/decision',
    guard: authorize('staff_requests_approve', 'manage', STORE),
    handler: async (args) => {
      const storeId = param(args.request, 'storeId');
      const id = param(args.request, 'requestId');
      const result = validateStaffRequestDecision(args.request.body ?? {});
      if (!result.ok) invalid(result.issues);
      await audited(args, (tx) => self.decideRequest(tx, storeId, id, result.value, args.now));
      return { statusCode: 200, body: { request: await self.storeRequest(args.pool, storeId, id, args.now) } };
    },
  },
];

/** Registers every staff self-service route behind its declared guard. */
export function registerStaffSelfServiceRoutes(router: Router, deps: StaffSelfServiceRouteDeps): Router {
  for (const route of STAFF_SELF_SERVICE_ROUTES) {
    router.add(route.method, route.path, route.guard, async (request, context) =>
      route.handler({ request, context, principal: requirePrincipal(context), pool: deps.db(), now: context.now() }),
    );
  }
  return router;
}
