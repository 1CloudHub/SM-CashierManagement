/**
 * Stores, departments and lanes (SCR-052 master data).
 *
 *   GET   /stores                       stores in scope, with departments and regions
 *   GET   /stores/:storeId              one store (deep link) with its departments
 *   POST  /stores                       create a store            (master_data: manage)
 *   PATCH /stores/:storeId              edit name, format, active (master_data: manage)
 *   PATCH /departments/:departmentId    edit lanes, handle time, trading hours, active
 *                                                                  (master_data: manage)
 *
 * The first scoped routes, proving the pattern every list and deep link
 * follows (P1): lists are filtered to the active role's scope in SQL (and
 * re-checked), and a deep link outside scope gets the same 404 as a missing
 * store. Every edit runs in `withAuditedTransaction` and records exactly one
 * audit event (P7). RBAC row "Stores / departments / lanes": Rules Steward
 * manages, Executive, Planner, HR view, Store Manager views their own store.
 */
import {
  CLOCK_TIME_PATTERN,
  MASTER_DATA_LIMITS,
  STORE_FORMATS,
  isStoreInScope,
  type DepartmentSummary,
  type StoreListResponse,
  type StoreWithDepartments,
} from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/guards.js';
import { requirePrincipal, type RequestContext } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction } from '../db/audit.js';
import {
  createStore,
  getDepartment,
  getRegionName,
  getStore,
  listDepartmentsOfStores,
  listRegionsInScope,
  listStoresInScope,
  updateDepartment,
  updateStore,
  type StoreRecord,
} from '../db/repositories/org.js';
import { PG_ERRORS, pgErrorCode } from '../db/rows.js';
import { errors } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { parseInput } from '../http/validation.js';

export interface StoreDeps {
  readonly db: () => pg.Pool;
}

const name = z.string().trim().min(1).max(MASTER_DATA_LIMITS.nameMax);
const format = z.enum(STORE_FORMATS);

const createStoreBody = z.strictObject({
  code: z
    .string()
    .trim()
    .min(1)
    .max(MASTER_DATA_LIMITS.codeMax)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use letters, numbers, hyphens or underscores.'),
  name,
  format,
  regionId: z.uuid(),
});

const updateStoreBody = z
  .strictObject({ name: name.optional(), format: format.optional(), active: z.boolean().optional() })
  .refine((b) => Object.keys(b).length > 0, 'Change at least one field.');

const clock = z.string().regex(CLOCK_TIME_PATTERN, 'Use a 24-hour time, e.g. 09:00.');

const updateDepartmentBody = z
  .strictObject({
    name: name.optional(),
    installedLanes: z.int().min(0).max(MASTER_DATA_LIMITS.installedLanesMax).optional(),
    defaultHandleTimeMin: z.number().positive().max(MASTER_DATA_LIMITS.handleTimeMinMax).optional(),
    tradingHours: z
      .strictObject({ open: clock, close: clock })
      .refine((h) => h.close > h.open, { message: 'Closing time must be after opening time.', path: ['close'] })
      .optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change at least one field.');

const storeParams = z.strictObject({ storeId: z.uuid() });
const departmentParams = z.strictObject({ departmentId: z.uuid() });

function withDepartments(
  store: StoreRecord,
  regionName: string,
  departments: readonly DepartmentSummary[],
): StoreWithDepartments {
  return {
    id: store.id,
    code: store.code,
    name: store.name,
    format: store.format,
    regionId: store.regionId,
    regionName,
    active: store.active,
    synthetic: store.synthetic,
    departments: departments.filter((d) => d.storeId === store.id),
  };
}

async function storeDetail(pool: pg.Pool, store: StoreRecord): Promise<StoreWithDepartments> {
  const [regionName, departments] = await Promise.all([
    getRegionName(pool, store.regionId),
    listDepartmentsOfStores(pool, [store.id]),
  ]);
  return withDepartments(store, regionName ?? '', departments);
}

function actor(context: RequestContext) {
  return actorFromPrincipal(requirePrincipal(context), context.requestId);
}

/** Maps constraint violations of a store/department edit to 409/422. */
function rethrow(error: unknown): never {
  const code = pgErrorCode(error);
  if (code === PG_ERRORS.uniqueViolation) throw errors.conflict('That code or name is already in use.');
  if (code === PG_ERRORS.foreignKeyViolation) throw errors.validationFailed('The region does not exist.');
  if (code === PG_ERRORS.checkViolation) throw errors.validationFailed('Some fields are missing or invalid.');
  throw error;
}

export function registerStoreRoutes(router: Router, deps: StoreDeps): Router {
  return router
    .get('/stores', authorize('master_data', 'view'), async (_request, context) => {
      const { scope } = requirePrincipal(context);
      if (scope === null) throw errors.forbidden();
      const pool = deps.db();
      // Defence in depth: never return a store outside scope, whatever the query did.
      const stores = (await listStoresInScope(pool, scope)).filter((s) => isStoreInScope(scope, s));
      const [regions, departments] = await Promise.all([
        listRegionsInScope(pool, scope),
        listDepartmentsOfStores(
          pool,
          stores.map((s) => s.id),
        ),
      ]);
      const regionNames = new Map(regions.map((r) => [r.id, r.name]));
      const body: StoreListResponse = {
        stores: stores.map((s) => withDepartments(s, regionNames.get(s.regionId) ?? '', departments)),
        regions,
      };
      return { statusCode: 200, body };
    })
    .get(
      '/stores/:storeId',
      authorize('master_data', 'view', { kind: 'store', param: 'storeId' }),
      async (request, context) => {
        const { scope } = requirePrincipal(context);
        const pool = deps.db();
        const store = await getStore(pool, request.params.storeId ?? '');
        if (scope === null || store === null || !isStoreInScope(scope, store)) throw errors.notFoundOrNoAccess();
        return { statusCode: 200, body: await storeDetail(pool, store) };
      },
    )
    .post('/stores', authorize('master_data', 'manage'), async (request, context) => {
      const { scope } = requirePrincipal(context);
      const input = parseInput(createStoreBody, request.body, 'body');
      // A new store must land inside the caller's scope (a store scope can't add stores).
      if (scope === null || scope.type === 'store' || scope.type === 'self') throw errors.forbidden();
      if (scope.type === 'region' && !scope.regionIds.includes(input.regionId)) {
        throw errors.validationFailed('Choose a region in your scope.');
      }
      const pool = deps.db();
      const store = await withAuditedTransaction(pool, actor(context), (tx) => createStore(tx, input)).catch(rethrow);
      return { statusCode: 201, body: await storeDetail(pool, store) };
    })
    .patch(
      '/stores/:storeId',
      authorize('master_data', 'manage', { kind: 'store', param: 'storeId' }),
      async (request, context) => {
        const { storeId } = parseInput(storeParams, request.params, 'params');
        const input = parseInput(updateStoreBody, request.body, 'body');
        const pool = deps.db();
        const store = await withAuditedTransaction(pool, actor(context), (tx) =>
          updateStore(tx, storeId, {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.format !== undefined ? { format: input.format } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
          }),
        ).catch(rethrow);
        return { statusCode: 200, body: await storeDetail(pool, store) };
      },
    )
    .patch(
      '/departments/:departmentId',
      authorize('master_data', 'manage', { kind: 'department', param: 'departmentId' }),
      async (request, context) => {
        const { departmentId } = parseInput(departmentParams, request.params, 'params');
        const input = parseInput(updateDepartmentBody, request.body, 'body');
        const pool = deps.db();
        const before = await getDepartment(pool, departmentId);
        if (before === null) throw errors.notFoundOrNoAccess();
        const department = await withAuditedTransaction(pool, actor(context), (tx) =>
          updateDepartment(tx, departmentId, {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.installedLanes !== undefined ? { installedLanes: input.installedLanes } : {}),
            ...(input.defaultHandleTimeMin !== undefined ? { defaultHandleTimeMin: input.defaultHandleTimeMin } : {}),
            ...(input.tradingHours !== undefined ? { tradingHours: input.tradingHours } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
          }),
        ).catch(rethrow);
        return { statusCode: 200, body: department };
      },
    );
}
