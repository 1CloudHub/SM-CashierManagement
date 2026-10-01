/**
 * Property tests for task 8.1 (fast-check, real PostgreSQL):
 *  - P1  scope isolation: every store returned is in the active role's scope.
 *  - P12 active-role enforcement: every request is authorised against the
 *        active role; unauthorised combinations are always 403/404 and write
 *        nothing; role switches audit user + role exactly once.
 *  - P11 staff self-scope: a Staff response never contains another cashier.
 *
 * P12 and P11 walk the app's own route table, so routes added later are
 * covered by the same properties.
 */
import {
  ROLE_CODES,
  can,
  isStoreInScope,
  resolveActiveRole,
  selectableRoles,
  type RoleAssignment,
  type RoleCode,
  type Scope,
  type StoreListResponse,
} from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RouteGuard } from '../../src/auth/guards.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import {
  insertAppUser,
  makeClient,
  one,
  seedOrg,
  setAssignments,
  uniq,
  writeCounts,
  type CallResult,
} from '../support/rbac.js';

let db: TestDatabase;
let org: Awaited<ReturnType<typeof seedOrg>>;
const MISSING_ID = '6f1c7a52-0b8e-4d5e-9a41-5e2b1c9d7f00';
const RUNS = 60;
/** Feature resources whose handlers may answer 201/404/409 to random ids and bodies. */
const LENIENT_RESOURCES = new Set<string>(['data_ingestion', 'scenarios', 'scenario_settings', 'scenario_submit']);

beforeAll(async () => {
  db = await createTestDatabase();
  org = await seedOrg(db.pool);
});

afterAll(async () => {
  await db?.dispose();
});

/** `authenticated()` routes that act on the caller's own staff record (task 15). */
const OWN_STAFF_RECORD = /^\/me\/(consents|home-area)(\/|$)/;

const storeOf = (id: string) => org.stores.find((s) => s.id === id);

/** A non-staff scope over the seeded org. */
const orgScopeArb = (): fc.Arbitrary<Scope> =>
  fc.oneof(
    fc.constant<Scope>({ type: 'global' }),
    fc.subarray(org.regions, { minLength: 1 }).map((regionIds): Scope => ({ type: 'region', regionIds })),
    fc.subarray(org.stores.map((s) => s.id), { minLength: 1 }).map((storeIds): Scope => ({ type: 'store', storeIds })),
  );

const assignmentsArb = (): fc.Arbitrary<{ role: RoleCode; scope: Scope }[]> =>
  fc.uniqueArray(fc.constantFrom(...ROLE_CODES), { maxLength: 3 }).chain((roles) =>
    fc.tuple(
      ...roles.map((role) =>
        role === 'STF'
          ? fc.constantFrom(...org.staff.map((s) => s.id)).map((staffId) => ({ role, scope: { type: 'self', staffId } as Scope }))
          : orgScopeArb().map((scope) => ({ role, scope })),
      ),
    ),
  );

/** The scope the server should apply (assignment, else demo scope). */
function expectedScope(role: RoleCode, assignments: readonly { role: RoleCode; scope: Scope }[]): Scope {
  const held = assignments.find((a) => a.role === role);
  if (held) return held.scope;
  if (role === 'STM') return { type: 'store', storeIds: [org.demoStoreId] };
  if (role === 'STF') return { type: 'self', staffId: org.demoStaffId };
  return { type: 'global' };
}

function inScope(scope: Scope, guard: Extract<RouteGuard, { kind: 'authorize' }>, id: string): boolean {
  if (!guard.scopeTarget) return true;
  // No saved view is seeded here, so every id addresses someone else's or a missing one.
  if (guard.scopeTarget.kind === 'saved_view') return false;
  if (guard.scopeTarget.kind === 'store') {
    const store = storeOf(id);
    return store !== undefined && isStoreInScope(scope, store);
  }
  const staff = org.staff.find((s) => s.id === id);
  if (!staff) return false;
  if (scope.type === 'self') return staff.id === scope.staffId;
  const store = storeOf(staff.storeId);
  return store !== undefined && isStoreInScope(scope, store);
}

interface RouteCall {
  readonly method: string;
  readonly pattern: string;
  readonly guard: RouteGuard;
  readonly path: string;
  readonly targetId: string | null;
  readonly body: unknown;
}

/** Concrete requests for every guarded route in the app's route table. */
function routeCallArb(guarded: readonly { method: string; pattern: string; guard: RouteGuard | null }[]): fc.Arbitrary<RouteCall> {
  const ids = fc.constantFrom(...org.stores.map((s) => s.id), ...org.staff.map((s) => s.id), MISSING_ID, 'not-a-uuid');
  return fc.constantFrom(...guarded).chain((route) =>
    fc.tuple(ids, fc.constantFrom(...ROLE_CODES)).map(([id, role]): RouteCall => {
      const hasParam = route.pattern.includes(':');
      return {
        method: route.method,
        pattern: route.pattern,
        guard: route.guard as RouteGuard,
        path: route.pattern.replace(/:[A-Za-z]+/g, id),
        targetId: hasParam ? id : null,
        body: route.method === 'GET' ? undefined : { role },
      };
    }),
  );
}

describe('P1 scope isolation', () => {
  it('every store listed is in the active role scope, and every in-scope store is listed', async () => {
    const { call } = makeClient(db.pool, false);
    const who = `p1.${uniq()}@smretail.com`;
    const userId = await insertAppUser(db.pool, who);
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<RoleCode>('EXE', 'PLN', 'STM', 'HR', 'RST'), orgScopeArb(), async (role, scope) => {
        await setAssignments(db.pool, userId, [{ role, scope }]);
        const res = await call({ path: '/stores', email: who, role });
        expect(res.status).toBe(200);
        const listed = (res.body as StoreListResponse).stores;
        for (const store of listed) expect(isStoreInScope(scope, store)).toBe(true);
        expect(listed.map((s) => s.id).sort()).toEqual(
          org.stores.filter((s) => isStoreInScope(scope, s)).map((s) => s.id).sort(),
        );
      }),
      { numRuns: RUNS },
    );
  });

  it('a deep link succeeds only for an in-scope store; otherwise the same 404 as a missing one', async () => {
    const { call } = makeClient(db.pool, false);
    const who = `p1d.${uniq()}@smretail.com`;
    const userId = await insertAppUser(db.pool, who);
    await fc.assert(
      fc.asyncProperty(orgScopeArb(), fc.constantFrom(...org.stores), async (scope, store) => {
        await setAssignments(db.pool, userId, [{ role: 'PLN', scope }]);
        const res = await call({ path: `/stores/${store.id}`, email: who });
        const missing = await call({ path: `/stores/${MISSING_ID}`, email: who });
        expect(missing.status).toBe(404);
        if (isStoreInScope(scope, store)) {
          expect(res.status).toBe(200);
        } else {
          expect(res.status).toBe(404);
          expect((res.body as { error: object }).error).toEqual({
            ...(missing.body as { error: object }).error,
            requestId: expect.any(String),
          });
        }
      }),
      { numRuns: RUNS },
    );
  });
});

describe('P12 active-role enforcement', () => {
  it('authorises every request against the active role and scope; denials write nothing', async () => {
    const clients = { true: makeClient(db.pool, true), false: makeClient(db.pool, false) };
    const guarded = clients.true.router.routes().filter((r) => r.guard?.kind !== 'public');
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        assignmentsArb(),
        fc.option(fc.constantFrom(...ROLE_CODES), { nil: null }),
        fc.option(fc.oneof(fc.constantFrom<string>(...ROLE_CODES), fc.constantFrom('root', 'adm', '', 'PLN ')), {
          nil: undefined,
        }),
        routeCallArb(guarded),
        async (demoMode, assigned, persisted, header, request) => {
          const who = `p12.${uniq()}@smretail.com`;
          const userId = await insertAppUser(db.pool, who, persisted ? { activeRole: persisted } : {});
          await setAssignments(db.pool, userId, assigned);
          const assignments: RoleAssignment[] = assigned.map((a) => ({ userId, ...a }));

          const before = await writeCounts(db.pool);
          const res: CallResult = await clients[`${demoMode}`].call({
            method: request.method,
            path: request.path,
            email: who,
            ...(header === undefined ? {} : { role: header }),
            ...(request.body === undefined ? {} : { body: request.body }),
          });
          const after = await writeCounts(db.pool);

          const active = resolveActiveRole({ header, persisted, assignments, demoMode });
          let allowed: boolean;
          let denial: number | null = null;
          if (!active.ok) {
            allowed = false;
            denial = 403;
          } else if (request.guard.kind === 'authenticated' && OWN_STAFF_RECORD.test(request.pattern)) {
            // Task 15: only the active role's own staff record (Staff self scope).
            allowed = active.role !== null && expectedScope(active.role, assigned).type === 'self';
            if (!allowed) denial = 403;
          } else if (request.guard.kind === 'authenticated') {
            const bodyRole = (request.body as { role?: RoleCode } | undefined)?.role;
            allowed = request.method === 'GET' || selectableRoles(assignments, demoMode).includes(bodyRole as RoleCode);
            if (!allowed) denial = 403;
          } else if (request.guard.kind === 'authorize') {
            const role = active.role;
            if (role === null || !can(role, request.guard.resource, request.guard.action)) {
              allowed = false;
              denial = 403;
            } else {
              allowed = request.targetId === null || inScope(expectedScope(role, assigned), request.guard, request.targetId);
              if (!allowed) denial = 404;
            }
          } else {
            throw new Error('unexpected public route');
          }

          if (!allowed) {
            expect(res.status, `${request.method} ${request.path}`).toBe(denial);
            expect(after).toEqual(before);
            return;
          }
          // Authorised: the handler ran. Feature routes addressed with random
          // ids/bodies legitimately answer 201/404/409 too — never 401/403/5xx.
          // Past the guard, a handler may still answer 404 for an unknown object on a
          // route whose path parameter is not a scope target (e.g. a rule version id),
          // or 409 when removing a home area the Staff user never shared (task 15).
          const unscopedParam = request.targetId !== null && request.guard.kind === 'authorize' && !request.guard.scopeTarget;
          const lenient =
            request.guard.kind === 'authorize' && LENIENT_RESOURCES.has(request.guard.resource);
          const featureOutcome = lenient
            ? res.status < 500 && res.status !== 401 && res.status !== 403
            : [200, 422, ...(unscopedParam ? [404] : []), ...(OWN_STAFF_RECORD.test(request.pattern) ? [409] : [])].includes(res.status);
          expect(featureOutcome, `${request.method} ${request.path}: ${res.raw}`).toBe(true);
          if (res.status === 404 && !lenient) expect(after).toEqual(before);
          // CSV downloads record one export audit event (P7), so only they may write on GET.
          const isExport = /\/(export|report)$/.test(request.pattern);
          if (request.method === 'GET' && !isExport) {
            expect(after).toEqual(before);
          } else if (request.pattern === '/me/active-role') {
            const role = (request.body as { role: RoleCode }).role;
            expect(after.audit).toBe(before.audit + (role === persisted ? 0 : 1));
            if (role !== persisted) {
              const event = await one<{ user_id: string; active_role: string }>(
                db.pool,
                'SELECT user_id, active_role FROM audit_event ORDER BY seq DESC LIMIT 1',
              );
              expect(event).toEqual({ user_id: userId, active_role: role });
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe('P11 staff self-scope', () => {
  it('no response to a Staff user ever contains another cashier', async () => {
    const clients = { true: makeClient(db.pool, true), false: makeClient(db.pool, false) };
    const readable = clients.true.router.routes().filter((r) => r.method === 'GET' && r.guard?.kind !== 'public');
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.constantFrom(...org.staff), routeCallArb(readable), async (demoMode, self, request) => {
        const who = `p11.${uniq()}@smretail.com`;
        const userId = await insertAppUser(db.pool, who, { activeRole: 'STF' });
        // Real Staff users are linked to their own record; demo Staff see the demo cashier.
        const ownId = demoMode ? org.demoStaffId : self.id;
        if (!demoMode) await setAssignments(db.pool, userId, [{ role: 'STF', scope: { type: 'self', staffId: self.id } }]);

        const res = await clients[`${demoMode}`].call({ path: request.path, email: who, role: 'STF' });
        for (const other of org.staff.filter((s) => s.id !== ownId)) {
          expect(res.raw).not.toContain(other.name);
          if (request.targetId !== other.id) expect(res.raw).not.toContain(other.id);
        }
        if (request.pattern === '/me') {
          expect(res.status).toBe(200);
          expect(res.raw).toContain(org.staff.find((s) => s.id === ownId)?.name);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
