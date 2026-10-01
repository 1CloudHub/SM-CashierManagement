/**
 * Shift offers and store-to-store borrowing routes (task 17; SCR-022,
 * SCR-025, SCR-026; Req 13, 14, 15.2; P1, P7, P11, P12, P14, P16, P17).
 *
 *   GET  /stores/:storeId/shifts/:shiftId/offer-candidates  eligible cashiers      shift_offers_send: edit (store)
 *   POST /stores/:storeId/shifts/:shiftId/offers            broadcast offers       shift_offers_send: edit (store)
 *   GET  /stores/:storeId/offers                            offer status           weekly_roster: view (store)
 *   GET  /me/offers                                         own offers (Staff)     shift_offers_respond: view
 *        (task 18: only offers within the cashier's own travel limit; one beyond it cannot be accepted)
 *   POST /me/offers/:offerId/accept                         first one wins (P17)   shift_offers_respond: edit
 *   POST /me/offers/:offerId/decline                                               shift_offers_respond: edit
 *   GET  /stores/:storeId/borrow-requests                   both directions        weekly_roster: view (store)
 *   POST /stores/:storeId/borrow-requests                   receiving store asks   shift_offers_send: edit (store)
 *   GET  /stores/:storeId/borrow-requests/:requestId/candidates   lending store    staff_lending: edit (store)
 *   POST /stores/:storeId/borrow-requests/:requestId/decision     lending store    staff_lending: edit (store)
 *
 * Every store route names the store in its path with a task 8.1 `store`
 * scope target, so another store's shifts, offers and requests are the same
 * 404 as missing ones (P1). The `/me/offers` routes act only on the Staff
 * user's own staff record (the `self` scope, P11): another cashier's offer is
 * a 404. Mutations run in one audited transaction (P7). Offers past their 30
 * minutes are expired before every offer read and write (the in-process
 * fallback of the scheduled sweep in the jobs worker).
 */
import { MAP_TRAVEL_MODES, MAX_OFFER_RECIPIENTS, MAX_TRAVEL_MIN_BOUNDS } from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize, type RouteGuard } from '../auth/guards.js';
import { requirePrincipal, type Principal, type RequestContext } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction } from '../db/audit.js';
import * as borrowing from '../db/repositories/borrowing.js';
import * as offers from '../db/repositories/offers.js';
import * as selfService from '../db/repositories/staff-self-service.js';
import { PG_ERRORS, pgErrorCode } from '../db/rows.js';
import { ApiError, errors } from '../http/errors.js';
import type { HttpMethod, Router } from '../http/router.js';
import type { ApiResponse, RoutedRequest } from '../http/types.js';
import { parseInput } from '../http/validation.js';

export interface OfferRouteDeps {
  readonly db: () => pg.Pool;
}

interface HandlerArgs {
  readonly request: RoutedRequest;
  readonly context: RequestContext;
  readonly principal: Principal;
  readonly pool: pg.Pool;
  readonly now: Date;
}

export interface OfferRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly guard: RouteGuard;
  readonly handler: (args: HandlerArgs) => Promise<ApiResponse>;
}

const STORE = { kind: 'store', param: 'storeId' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(request: RoutedRequest, name: string): string {
  const id = request.params[name] ?? '';
  if (!UUID.test(id)) throw errors.notFoundOrNoAccess();
  return id;
}

const travel = {
  mode: z.enum(MAP_TRAVEL_MODES).default('public_transport'),
  maxTravelMin: z.coerce.number().int().min(MAX_TRAVEL_MIN_BOUNDS.min).max(MAX_TRAVEL_MIN_BOUNDS.max).default(30),
};
const candidatesQuery = z.strictObject(travel);
const sendBody = z.strictObject({
  staffIds: z.array(z.uuid()).min(1, 'Pick at least one cashier.').max(MAX_OFFER_RECIPIENTS),
  ...travel,
});
const offersQuery = z.strictObject({ rosterId: z.uuid().optional(), shiftId: z.uuid().optional() });
const borrowBody = z.strictObject({
  fromStoreId: z.uuid(),
  shiftIds: z.array(z.uuid()).min(1, 'Pick at least one open shift.').max(borrowing.MAX_BORROW_SHIFTS),
  note: z.string().trim().max(500).optional(),
});
const decisionBody = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('approve'), staffIds: z.array(z.uuid()).min(1).max(borrowing.MAX_BORROW_SHIFTS), reason: z.string().trim().max(500).optional() }),
  z.strictObject({ decision: z.literal('decline'), reason: z.string().trim().max(500).optional() }),
]);

/** The Staff user's own staff id (self scope); anything else is refused (P11). */
function ownStaffId(principal: Principal): string {
  const scope = principal.scope;
  if (scope === null || scope.type !== 'self') throw errors.forbidden();
  return scope.staffId;
}

function mapDbError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  const code = pgErrorCode(error);
  // A concurrent acceptance that slipped past the shift lock still hits the P17 index / trigger.
  if (code === PG_ERRORS.uniqueViolation || code === PG_ERRORS.checkViolation) throw errors.conflict(offers.SHIFT_FILLED_MESSAGE);
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

export const OFFER_ROUTES: readonly OfferRoute[] = [
  // --- Offers (17.1) -------------------------------------------------------
  {
    method: 'GET',
    path: '/stores/:storeId/shifts/:shiftId/offer-candidates',
    guard: authorize('shift_offers_send', 'edit', STORE),
    handler: async ({ request, pool, now }) => {
      const q = parseInput(candidatesQuery, request.query, 'query');
      await offers.expireDueOffers(pool, now);
      const body = await offers.offerCandidates(pool, param(request, 'storeId'), param(request, 'shiftId'), { ...q, now });
      return { statusCode: 200, body };
    },
  },
  {
    method: 'POST',
    path: '/stores/:storeId/shifts/:shiftId/offers',
    guard: authorize('shift_offers_send', 'edit', STORE),
    handler: async (args) => {
      const { request, pool, now } = args;
      const storeId = param(request, 'storeId');
      const shiftId = param(request, 'shiftId');
      const body = parseInput(sendBody, request.body ?? {}, 'body');
      await offers.expireDueOffers(pool, now);
      await audited(args, (tx) => offers.sendOffers(tx, storeId, shiftId, body, now));
      return { statusCode: 201, body: { offers: await offers.listStoreOffers(pool, storeId, { shiftId }) } };
    },
  },
  {
    method: 'GET',
    path: '/stores/:storeId/offers',
    guard: authorize('weekly_roster', 'view', STORE),
    handler: async ({ request, pool, now }) => {
      const q = parseInput(offersQuery, request.query, 'query');
      await offers.expireDueOffers(pool, now);
      return { statusCode: 200, body: { offers: await offers.listStoreOffers(pool, param(request, 'storeId'), q) } };
    },
  },
  {
    method: 'GET',
    path: '/me/offers',
    guard: authorize('shift_offers_respond', 'view'),
    handler: async ({ principal, pool, now }) => {
      const staffId = ownStaffId(principal);
      await offers.expireDueOffers(pool, now);
      // Task 18 (Req 15.2): only offers within the cashier's own travel limit.
      const outside = await selfService.offersOutsideTravelLimit(pool, staffId);
      return { statusCode: 200, body: { offers: (await offers.listMyOffers(pool, staffId, now)).filter((o) => !outside.has(o.id)) } };
    },
  },
  {
    method: 'POST',
    path: '/me/offers/:offerId/accept',
    guard: authorize('shift_offers_respond', 'edit'),
    handler: async (args) => {
      const staffId = ownStaffId(args.principal);
      const offerId = param(args.request, 'offerId');
      // Task 18 (Req 15.2): an offer beyond the cashier's own travel limit is not theirs to take.
      if ((await selfService.offersOutsideTravelLimit(args.pool, staffId)).has(offerId)) throw errors.notFoundOrNoAccess();
      await offers.expireDueOffers(args.pool, args.now);
      await audited(args, (tx) => offers.acceptOffer(tx, staffId, offerId, args.now));
      return { statusCode: 200, body: { offer: await offers.myOffer(args.pool, staffId, offerId) } };
    },
  },
  {
    method: 'POST',
    path: '/me/offers/:offerId/decline',
    guard: authorize('shift_offers_respond', 'edit'),
    handler: async (args) => {
      const staffId = ownStaffId(args.principal);
      const offerId = param(args.request, 'offerId');
      await offers.expireDueOffers(args.pool, args.now);
      await audited(args, (tx) => offers.declineOffer(tx, staffId, offerId, args.now));
      return { statusCode: 200, body: { offer: await offers.myOffer(args.pool, staffId, offerId) } };
    },
  },

  // --- Borrowing (17.2) ----------------------------------------------------
  {
    method: 'GET',
    path: '/stores/:storeId/borrow-requests',
    guard: authorize('weekly_roster', 'view', STORE),
    handler: async ({ request, pool }) => ({ statusCode: 200, body: await borrowing.listBorrowRequests(pool, param(request, 'storeId')) }),
  },
  {
    method: 'POST',
    path: '/stores/:storeId/borrow-requests',
    guard: authorize('shift_offers_send', 'edit', STORE),
    handler: async (args) => {
      const storeId = param(args.request, 'storeId');
      const body = parseInput(borrowBody, args.request.body ?? {}, 'body');
      const id = await audited(args, (tx) => borrowing.createBorrowRequest(tx, storeId, body, args.now));
      return { statusCode: 201, body: { request: await borrowing.getBorrowRequest(args.pool, id) } };
    },
  },
  {
    method: 'GET',
    path: '/stores/:storeId/borrow-requests/:requestId/candidates',
    guard: authorize('staff_lending', 'edit', STORE),
    handler: async ({ request, pool }) => {
      const requestId = param(request, 'requestId');
      return { statusCode: 200, body: { requestId, candidates: await borrowing.lendCandidates(pool, param(request, 'storeId'), requestId) } };
    },
  },
  {
    method: 'POST',
    path: '/stores/:storeId/borrow-requests/:requestId/decision',
    guard: authorize('staff_lending', 'edit', STORE),
    handler: async (args) => {
      const storeId = param(args.request, 'storeId');
      const requestId = param(args.request, 'requestId');
      const body = parseInput(decisionBody, args.request.body ?? {}, 'body');
      const role = args.principal.activeRole;
      if (role === null) throw errors.forbidden();
      await audited(args, (tx) => borrowing.decideBorrowRequest(tx, storeId, requestId, body, role, args.now));
      return { statusCode: 200, body: { request: await borrowing.getBorrowRequest(args.pool, requestId) } };
    },
  },
];

/** Registers every offer and borrowing route behind its declared guard. */
export function registerOfferRoutes(router: Router, deps: OfferRouteDeps): Router {
  for (const route of OFFER_ROUTES) {
    router.add(route.method, route.path, route.guard, async (request, context) =>
      route.handler({ request, context, principal: requirePrincipal(context), pool: deps.db(), now: context.now() }),
    );
  }
  return router;
}
