/**
 * Staff and availability (SCR-053; Req 6; P1, P7, P11, P12).
 *
 *   GET    /staff                                      staff in scope (filters: store, department, type, q)
 *   POST   /staff                                      add a staff record         (staff_records: manage)
 *   GET    /staff/:staffId                             one staff record           (staff_records: view)
 *   PATCH  /staff/:staffId                             edit a staff record        (staff_records: edit)
 *   PUT    /staff/:staffId/availability                replace the weekly grid    (staff_availability: edit)
 *   POST   /staff/:staffId/unavailable-dates           add an unavailable date    (staff_availability: edit)
 *   DELETE /staff/:staffId/unavailable-dates/:entryId  remove a manual date       (staff_availability: edit)
 *
 * RBAC rows "Staff records" (HR manage, Store Manager view + edit own store,
 * Planner and Rules Steward view) and "Staff availability" (HR manage,
 * Planner and Store Manager edit). Every per-record route carries the staff
 * scope target, so a record outside the active role's scope gets the same 404
 * as a missing one. Every mutation runs in `withAuditedTransaction` and
 * records exactly one audit event. Names are personal data (RA 10173).
 */
import {
  AVAILABILITY_WINDOWS,
  STAFF_LIMITS,
  STAFF_TYPES,
  WEEKDAYS,
  isIsoDate,
  isStoreInScope,
  type StaffListResponse,
  type Weekday,
  type WeeklyAvailability,
} from '@lanewise/shared';
import type pg from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/guards.js';
import { requirePrincipal, type RequestContext } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction } from '../db/audit.js';
import { getDepartment, getStore } from '../db/repositories/org.js';
import * as repo from '../db/repositories/staff.js';
import { PG_ERRORS, pgErrorCode } from '../db/rows.js';
import { errors } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { parseInput } from '../http/validation.js';

export interface StaffDeps {
  readonly db: () => pg.Pool;
}

const staffTarget = { kind: 'staff', param: 'staffId' } as const;

const name = z.string().trim().min(1).max(STAFF_LIMITS.nameMax);
const type = z.enum(STAFF_TYPES);
const weekday = z.enum(WEEKDAYS);

const listQuery = z.strictObject({
  storeId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  type: type.optional(),
  q: z.string().trim().max(STAFF_LIMITS.queryMax).optional(),
});

const createBody = z.strictObject({
  storeId: z.uuid(),
  departmentId: z.uuid(),
  employeeNo: z
    .string()
    .trim()
    .min(1)
    .max(STAFF_LIMITS.employeeNoMax)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use letters, numbers, hyphens or underscores.'),
  name,
  type,
  preferredRestDay: weekday.nullable().optional(),
});

const updateBody = z
  .strictObject({
    name: name.optional(),
    type: type.optional(),
    departmentId: z.uuid().optional(),
    preferredRestDay: weekday.nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Change at least one field.');

const windows = z.array(z.enum(AVAILABILITY_WINDOWS)).max(AVAILABILITY_WINDOWS.length);
const availabilityBody = z.strictObject({
  availability: z.strictObject(
    Object.fromEntries(WEEKDAYS.map((d) => [d, windows])) as Record<Weekday, typeof windows>,
  ),
});

const isoDate = z.string().refine((v) => isIsoDate(v), 'Use a date like 2026-12-14.');
const unavailableBody = z.strictObject({
  date: isoDate,
  reason: z.string().trim().max(STAFF_LIMITS.reasonMax).optional(),
});

const staffParams = z.strictObject({ staffId: z.uuid() });
const entryParams = z.strictObject({ staffId: z.uuid(), entryId: z.uuid() });

function actor(context: RequestContext) {
  return actorFromPrincipal(requirePrincipal(context), context.requestId);
}

/** Constraint violations of a staff edit → 409/422 (never a 500). */
function rethrow(error: unknown): never {
  const code = pgErrorCode(error);
  if (code === PG_ERRORS.uniqueViolation) throw errors.conflict('That staff ID is already used in this store.');
  if (code === PG_ERRORS.foreignKeyViolation) throw errors.validationFailed('Choose a department of the staff member’s store.');
  if (code === PG_ERRORS.checkViolation) throw errors.validationFailed('Some fields are missing or invalid.');
  throw error;
}

async function staffOr404(pool: pg.Pool, staffId: string) {
  const staff = await repo.getStaff(pool, staffId);
  if (staff === null) throw errors.notFoundOrNoAccess();
  return staff;
}

export function registerStaffRoutes(router: Router, deps: StaffDeps): Router {
  return router
    .get('/staff', authorize('staff_records', 'view'), async (request, context) => {
      const { scope } = requirePrincipal(context);
      if (scope === null) throw errors.forbidden();
      const query = parseInput(listQuery, request.query, 'query');
      const result = await repo.listStaffInScope(deps.db(), scope, {
        ...(query.storeId !== undefined ? { storeId: query.storeId } : {}),
        ...(query.departmentId !== undefined ? { departmentId: query.departmentId } : {}),
        ...(query.type !== undefined ? { type: query.type } : {}),
        ...(query.q !== undefined ? { q: query.q } : {}),
      });
      const body: StaffListResponse = result;
      return { statusCode: 200, body };
    })
    .post('/staff', authorize('staff_records', 'manage'), async (request, context) => {
      const { scope } = requirePrincipal(context);
      const input = parseInput(createBody, request.body, 'body');
      const pool = deps.db();
      // The store (and its department) must be inside the caller's scope: otherwise the same 404 as missing.
      const [store, department] = await Promise.all([getStore(pool, input.storeId), getDepartment(pool, input.departmentId)]);
      if (scope === null || store === null || !isStoreInScope(scope, store)) throw errors.notFoundOrNoAccess();
      if (department === null || department.storeId !== store.id) {
        throw errors.validationFailed('Choose a department of this store.', [
          { path: 'body.departmentId', message: 'Choose a department of this store.' },
        ]);
      }
      const record = await withAuditedTransaction(pool, actor(context), (tx) =>
        repo.createStaff(tx, {
          storeId: input.storeId,
          departmentId: input.departmentId,
          employeeNo: input.employeeNo,
          name: input.name,
          type: input.type,
          preferredRestDay: input.preferredRestDay ?? null,
        }),
      ).catch(rethrow);
      return { statusCode: 201, body: record };
    })
    .get('/staff/:staffId', authorize('staff_records', 'view', staffTarget), async (request) => {
      const { staffId } = parseInput(staffParams, request.params, 'params');
      return { statusCode: 200, body: await staffOr404(deps.db(), staffId) };
    })
    .patch('/staff/:staffId', authorize('staff_records', 'edit', staffTarget), async (request, context) => {
      const { staffId } = parseInput(staffParams, request.params, 'params');
      const input = parseInput(updateBody, request.body, 'body');
      const pool = deps.db();
      await staffOr404(pool, staffId);
      const record = await withAuditedTransaction(pool, actor(context), (tx) =>
        repo.updateStaff(tx, staffId, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
          ...(input.preferredRestDay !== undefined ? { preferredRestDay: input.preferredRestDay } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        }),
      ).catch(rethrow);
      return { statusCode: 200, body: record };
    })
    .put(
      '/staff/:staffId/availability',
      authorize('staff_availability', 'edit', staffTarget),
      async (request, context) => {
        const { staffId } = parseInput(staffParams, request.params, 'params');
        const input = parseInput(availabilityBody, request.body, 'body');
        const availability = Object.fromEntries(
          WEEKDAYS.map((d) => [d, AVAILABILITY_WINDOWS.filter((w) => input.availability[d].includes(w))]),
        ) as unknown as WeeklyAvailability;
        const pool = deps.db();
        await staffOr404(pool, staffId);
        const record = await withAuditedTransaction(pool, actor(context), (tx) =>
          repo.setAvailability(tx, staffId, availability),
        );
        return { statusCode: 200, body: record };
      },
    )
    .post(
      '/staff/:staffId/unavailable-dates',
      authorize('staff_availability', 'edit', staffTarget),
      async (request, context) => {
        const { staffId } = parseInput(staffParams, request.params, 'params');
        const input = parseInput(unavailableBody, request.body, 'body');
        const pool = deps.db();
        await staffOr404(pool, staffId);
        if (await repo.hasUnavailableDate(pool, staffId, input.date)) {
          throw errors.conflict('This date is already marked unavailable.');
        }
        await withAuditedTransaction(pool, actor(context), (tx) =>
          repo.addUnavailableDate(tx, staffId, { date: input.date, reason: input.reason || null }),
        );
        return { statusCode: 201, body: await staffOr404(pool, staffId) };
      },
    )
    .delete(
      '/staff/:staffId/unavailable-dates/:entryId',
      authorize('staff_availability', 'edit', staffTarget),
      async (request, context) => {
        const { staffId, entryId } = parseInput(entryParams, request.params, 'params');
        const pool = deps.db();
        const entry = await repo.getUnavailableEntry(pool, staffId, entryId);
        if (entry === null) throw errors.notFoundOrNoAccess();
        if (entry.source !== 'manual') {
          throw errors.conflict('Only dates added here can be removed. Change approved requests or imports at their source.');
        }
        await withAuditedTransaction(pool, actor(context), (tx) => repo.removeUnavailableDate(tx, staffId, entryId));
        return { statusCode: 200, body: await staffOr404(pool, staffId) };
      },
    );
}
