/**
 * Location privacy and home-area consent routes (task 15; Req 12, P15, P11,
 * P7; SEC-001).
 *
 *   GET    /me/consents                  own consent status, current text, history
 *   POST   /me/consents                  opt in (to the current text version)
 *   DELETE /me/consents/:purpose         withdraw — deletes the home area at once
 *   GET    /me/home-area                 own home area (barangay level)
 *   PUT    /me/home-area                 set / change own home area
 *   DELETE /me/home-area                 remove own home area, keep consent
 *   GET    /me/home-area/barangays       search the barangay reference list
 *   GET    /staff/:staffId/home-area     own-store manager / HR view (SCR-053)
 *
 * Each route declares its task 8.1 guard. The `/me` routes use
 * `authenticated()` and act only on the caller's own staff record — the
 * active role's `self` scope (P11; RBAC matrix "Share home area and travel
 * limit (consent)": Staff, own). The manager/HR view uses
 * `authorize('staff_home_area', 'view', staff)`: Store Manager for their own
 * store, HR in their scope; anything else gets the enforcer's 404.
 *
 * Every response body passes the P15 guard (`assertNoFineLocation`) before it
 * leaves the handler.
 */
import {
  BARANGAY_CODE_PATTERN,
  CONSENT_LOCALES,
  CONSENT_PURPOSES,
  MAX_TRAVEL_MIN_BOUNDS,
  assertNoFineLocation,
  type BarangaySearchResponse,
  type ConsentLocale,
  type ConsentPurpose,
  type MyConsentsResponse,
  type MyHomeAreaResponse,
} from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authenticated, authorize } from '../auth/guards.js';
import { requirePrincipal, type RequestContext } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction } from '../db/audit.js';
import * as repo from '../db/repositories/location-privacy.js';
import { errors } from '../http/errors.js';
import type { Router } from '../http/router.js';
import type { ApiResponse, RoutedRequest } from '../http/types.js';
import { parseInput } from '../http/validation.js';

// ---------------------------------------------------------------------------
// Input schemas — strict: any extra field (lat, lon, address, street, ...) is
// rejected, so nothing finer than a barangay code can be submitted.
// ---------------------------------------------------------------------------

const purposeSchema = z.enum(CONSENT_PURPOSES);
const localeSchema = z.enum(CONSENT_LOCALES);

const consentsQuery = z.strictObject({ locale: localeSchema.optional() });

const grantBody = z.strictObject({
  purpose: purposeSchema,
  version: z.int().positive(),
  locale: localeSchema,
});

const purposeParams = z.strictObject({ purpose: purposeSchema });

const setHomeAreaBody = z.strictObject({
  barangayCode: z.string().regex(BARANGAY_CODE_PATTERN, 'Choose a barangay from the list.'),
  maxTravelMin: z.int().min(MAX_TRAVEL_MIN_BOUNDS.min).max(MAX_TRAVEL_MIN_BOUNDS.max),
  crossStoreOffers: z.boolean(),
});

const barangayQuery = z.strictObject({
  q: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const staffParams = z.strictObject({ staffId: z.uuid() });

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export interface LocationPrivacyDeps {
  /** The database pool (created lazily); throws `service_unavailable` when unconfigured. */
  readonly db: () => pg.Pool;
}

type Handler = (request: RoutedRequest, context: RequestContext, pool: pg.Pool) => Promise<unknown>;

/**
 * The caller's own staff record: the `self` scope of their active role — their
 * Staff assignment, or the demo cashier in demo mode (task 8.1). Any other
 * active role, or no provisioned user, is refused (P11). Handlers call it
 * before reading any input, so a refused caller learns nothing from validation.
 */
async function ownStaff(context: RequestContext, pool: pg.Pool): Promise<repo.StaffRef> {
  const { scope } = requirePrincipal(context);
  if (scope?.type !== 'self') throw errors.forbidden();
  const staff = await repo.getStaffRef(pool, scope.staffId);
  if (!staff) throw errors.forbidden();
  return staff;
}

function actor(context: RequestContext) {
  return actorFromPrincipal(requirePrincipal(context), context.requestId);
}

async function myHomeArea(pool: pg.Pool, staffId: string): Promise<MyHomeAreaResponse> {
  const [consent, homeArea] = await Promise.all([
    repo.getConsentStatus(pool, staffId, 'home_area'),
    repo.getOwnHomeArea(pool, staffId),
  ]);
  return { consent, homeArea: consent.active ? homeArea : null };
}

const getConsents: Handler = async (request, context, pool) => {
  const staff = await ownStaff(context, pool);
  const { locale } = parseInput(consentsQuery, request.query, 'query');
  const body: MyConsentsResponse = {
    consents: await Promise.all(
      CONSENT_PURPOSES.map(async (purpose) => ({
        status: await repo.getConsentStatus(pool, staff.id, purpose),
        text: await repo.getCurrentConsentText(pool, purpose, (locale ?? 'en') as ConsentLocale),
        history: await repo.listConsentHistory(pool, staff.id, purpose),
      })),
    ),
  };
  return body;
};

const grantConsent: Handler = async (request, context, pool) => {
  const staff = await ownStaff(context, pool);
  const input = parseInput(grantBody, request.body, 'body');
  await withAuditedTransaction(pool, actor(context), (tx) =>
    repo.grantConsent(tx, { staff, purpose: input.purpose, version: input.version, locale: input.locale }),
  );
  return repo.getConsentStatus(pool, staff.id, input.purpose);
};

const withdrawConsent: Handler = async (request, context, pool) => {
  const staff = await ownStaff(context, pool);
  const { purpose } = parseInput(purposeParams, request.params, 'params');
  await withAuditedTransaction(pool, actor(context), (tx) => repo.withdrawConsent(tx, staff, purpose as ConsentPurpose));
  return repo.getConsentStatus(pool, staff.id, purpose);
};

const getHomeArea: Handler = async (_request, context, pool) => myHomeArea(pool, (await ownStaff(context, pool)).id);

const setHomeArea: Handler = async (request, context, pool) => {
  const staff = await ownStaff(context, pool);
  const input = parseInput(setHomeAreaBody, request.body, 'body');
  await withAuditedTransaction(pool, actor(context), (tx) => repo.setHomeArea(tx, staff, input));
  return myHomeArea(pool, staff.id);
};

const clearHomeArea: Handler = async (_request, context, pool) => {
  const staff = await ownStaff(context, pool);
  await withAuditedTransaction(pool, actor(context), (tx) => repo.clearHomeArea(tx, staff));
  return myHomeArea(pool, staff.id);
};

const searchBarangays: Handler = async (request, context, pool) => {
  await ownStaff(context, pool);
  const query = parseInput(barangayQuery, request.query, 'query');
  const body: BarangaySearchResponse = {
    barangays: await repo.searchBarangays(pool, {
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.city !== undefined ? { city: query.city } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    }),
  };
  return body;
};

/** The enforcer has already checked the staff record exists and is in scope. */
const getStaffHomeArea: Handler = async (request, _context, pool) => {
  const { staffId } = parseInput(staffParams, request.params, 'params');
  return repo.getStaffHomeArea(pool, staffId);
};

/** Every body leaves through the P15 guard: nothing finer than barangay. */
function respond(handler: Handler, deps: LocationPrivacyDeps, statusCode = 200) {
  return async (request: RoutedRequest, context: RequestContext): Promise<ApiResponse> => ({
    statusCode,
    body: assertNoFineLocation(await handler(request, context, deps.db())),
  });
}

const staffTarget = { kind: 'staff', param: 'staffId' } as const;

export function registerLocationPrivacyRoutes(router: Router, deps: LocationPrivacyDeps): Router {
  return router
    .get('/me/consents', authenticated(), respond(getConsents, deps))
    .post('/me/consents', authenticated(), respond(grantConsent, deps, 201))
    .delete('/me/consents/:purpose', authenticated(), respond(withdrawConsent, deps))
    .get('/me/home-area', authenticated(), respond(getHomeArea, deps))
    .put('/me/home-area', authenticated(), respond(setHomeArea, deps))
    .delete('/me/home-area', authenticated(), respond(clearHomeArea, deps))
    .get('/me/home-area/barangays', authenticated(), respond(searchBarangays, deps))
    .get('/staff/:staffId/home-area', authorize('staff_home_area', 'view', staffTarget), respond(getStaffHomeArea, deps));
}
