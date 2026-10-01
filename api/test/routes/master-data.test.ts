/**
 * SCR-052 stores/departments/lanes and SCR-053 staff and availability
 * routes (P1 scope, P7 one audit event per mutation, P12 guards).
 *
 * Handlers run against a real PostgreSQL through the Lambda handler, with
 * verified Cognito claims for one user per role (Store Manager scoped to the
 * demo store, a second Rules Steward scoped to one region, the rest global).
 */
import {
  FULL_AVAILABILITY,
  NOT_FOUND_OR_NO_ACCESS_MESSAGE,
  ROLE_CODES,
  type DepartmentSummary,
  type RoleCode,
  type StaffListResponse,
  type StaffRecord,
  type StoreListResponse,
  type StoreWithDepartments,
} from '@lanewise/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { insertAppUser, makeClient, one, seedOrg, setAssignments, uniq, type CallResult } from '../support/rbac.js';

let db: TestDatabase;
let org: Awaited<ReturnType<typeof seedOrg>>;
let call: ReturnType<typeof makeClient>['call'];
const emails = {} as Record<RoleCode, string>;
let regionalRstEmail: string;

beforeAll(async () => {
  db = await createTestDatabase();
  org = await seedOrg(db.pool);
  call = makeClient(db.pool, false).call;
  for (const role of ROLE_CODES) {
    emails[role] = `${role.toLowerCase()}.${uniq()}@smretail.com`;
    const userId = await insertAppUser(db.pool, emails[role]);
    const scope =
      role === 'STF'
        ? { type: 'self' as const, staffId: org.demoStaffId }
        : role === 'STM'
          ? { type: 'store' as const, storeIds: [org.demoStoreId] }
          : { type: 'global' as const };
    await setAssignments(db.pool, userId, [{ role, scope }]);
  }
  regionalRstEmail = `rst.region.${uniq()}@smretail.com`;
  const regional = await insertAppUser(db.pool, regionalRstEmail);
  await setAssignments(db.pool, regional, [{ role: 'RST', scope: { type: 'region', regionIds: [org.regions[1] as string] } }]);
});

afterAll(async () => {
  await db?.dispose();
});

const as = (role: RoleCode, method: string, path: string, body?: unknown): Promise<CallResult> =>
  call({ method, path, email: emails[role], role, ...(body !== undefined ? { body } : {}) });

async function auditCount(): Promise<number> {
  return (await one<{ n: number }>(db.pool, 'SELECT count(*)::int AS n FROM audit_event')).n;
}

async function lastAudit(): Promise<{ event: string; active_role: string; before: unknown; after: unknown }> {
  return one(db.pool, 'SELECT event, active_role, before, after FROM audit_event ORDER BY seq DESC LIMIT 1');
}

/** Runs `fn` and asserts it recorded exactly `n` audit events. */
async function expectAudits<T>(n: number, fn: () => Promise<T>): Promise<T> {
  const before = await auditCount();
  const result = await fn();
  expect(await auditCount()).toBe(before + n);
  return result;
}

const errorCode = (res: CallResult) => (res.body as { error: { code: string } }).error.code;

function staffOf(storeId: string) {
  const s = org.staff.find((x) => x.storeId === storeId && x.id !== org.demoStaffId);
  if (!s) throw new Error('no staff');
  return s;
}

const otherStoreId = () => org.stores.find((s) => s.id !== org.demoStoreId)?.id as string;

async function departmentOf(storeId: string): Promise<string> {
  return (await one<{ id: string }>(db.pool, 'SELECT id FROM department WHERE store_id = $1 ORDER BY name LIMIT 1', [storeId])).id;
}

// ---------------------------------------------------------------------------
// SCR-052
// ---------------------------------------------------------------------------

describe('GET /stores (SCR-052)', () => {
  it('lists stores in scope with their departments and regions', async () => {
    const res = await as('RST', 'GET', '/stores');
    expect(res.status).toBe(200);
    const body = res.body as StoreListResponse;
    expect(body.stores.length).toBeGreaterThanOrEqual(org.stores.length);
    const demo = body.stores.find((s) => s.id === org.demoStoreId) as StoreWithDepartments;
    expect(demo.departments.length).toBeGreaterThan(0);
    expect(demo.departments[0]).toMatchObject({ storeId: org.demoStoreId, installedLanes: 10, defaultHandleTimeMin: 2.5, active: true });
    expect(demo.departments[0]?.tradingHours).toEqual({ open: '10:00', close: '22:00' });
    expect(demo.regionName.length).toBeGreaterThan(0);
    expect(body.regions.map((r) => r.id)).toEqual(expect.arrayContaining(org.regions));
  });

  it('gives the Store Manager only their own store, and Staff nothing (403)', async () => {
    const body = (await as('STM', 'GET', '/stores')).body as StoreListResponse;
    expect(body.stores.map((s) => s.id)).toEqual([org.demoStoreId]);
    expect(body.regions.map((r) => r.id)).toEqual([org.regions[0]]);
    expect((await as('STF', 'GET', '/stores')).status).toBe(403);
    expect((await as('FIN', 'GET', '/stores')).status).toBe(403);
  });
});

describe('store and department edits (master_data: manage)', () => {
  it('creates a store with one audit event; other roles get 403 and nothing is written', async () => {
    const code = `S-${uniq()}`;
    const res = await expectAudits(1, () =>
      as('RST', 'POST', '/stores', { code, name: 'SM Test Store', format: 'savemore', regionId: org.regions[0] }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code, name: 'SM Test Store', format: 'savemore', departments: [] });
    expect(await lastAudit()).toMatchObject({ event: 'store.created', active_role: 'RST' });

    for (const role of ['EXE', 'PLN', 'STM', 'HR', 'ADM'] as const) {
      await expectAudits(0, async () => {
        const denied = await as(role, 'POST', '/stores', { code: `S-${uniq()}`, name: 'X', format: 'savemore', regionId: org.regions[0] });
        expect(denied.status).toBe(403);
      });
    }
    // Duplicate code → 409; bad body → 422; neither is audited.
    await expectAudits(0, async () => {
      expect((await as('RST', 'POST', '/stores', { code, name: 'Again', format: 'savemore', regionId: org.regions[0] })).status).toBe(409);
      expect((await as('RST', 'POST', '/stores', { code: 'x y', name: '', format: 'mall', regionId: 'r' })).status).toBe(422);
    });
  });

  it('edits a store; out of scope and missing stores get the same 404', async () => {
    const res = await expectAudits(1, () => as('RST', 'PATCH', `/stores/${org.demoStoreId}`, { name: 'SM Supermarket QC' }));
    expect(res.status).toBe(200);
    expect((res.body as StoreWithDepartments).name).toBe('SM Supermarket QC');
    expect(await lastAudit()).toMatchObject({ event: 'store.updated' });

    await expectAudits(0, async () => {
      const outside = await call({ method: 'PATCH', path: `/stores/${org.demoStoreId}`, email: regionalRstEmail, role: 'RST', body: { active: false } });
      const missing = await call({
        method: 'PATCH',
        path: '/stores/00000000-0000-4000-8000-000000000000',
        email: regionalRstEmail,
        role: 'RST',
        body: { active: false },
      });
      expect(outside.status).toBe(404);
      expect(missing.status).toBe(404);
      expect((outside.body as { error: { message: string } }).error.message).toBe(NOT_FOUND_OR_NO_ACCESS_MESSAGE);
      expect((missing.body as { error: { message: string } }).error.message).toBe(NOT_FOUND_OR_NO_ACCESS_MESSAGE);
      expect((await as('STM', 'PATCH', `/stores/${org.demoStoreId}`, { name: 'Mine' })).status).toBe(403);
    });
  });

  it('a region-scoped steward cannot create a store outside their regions', async () => {
    const res = await call({
      method: 'POST',
      path: '/stores',
      email: regionalRstEmail,
      role: 'RST',
      body: { code: `S-${uniq()}`, name: 'Elsewhere', format: 'savemore', regionId: org.regions[0] },
    });
    expect(res.status).toBe(422);
  });

  it('edits a department (lanes, handle time, trading hours) with one audit event', async () => {
    const departmentId = await departmentOf(org.demoStoreId);
    const res = await expectAudits(1, () =>
      as('RST', 'PATCH', `/departments/${departmentId}`, {
        installedLanes: 30,
        defaultHandleTimeMin: 2.25,
        tradingHours: { open: '09:00', close: '22:00' },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body as DepartmentSummary).toMatchObject({ installedLanes: 30, defaultHandleTimeMin: 2.25, tradingHours: { open: '09:00', close: '22:00' } });
    expect(await lastAudit()).toMatchObject({ event: 'department.updated', active_role: 'RST' });

    await expectAudits(0, async () => {
      const bad = await as('RST', 'PATCH', `/departments/${departmentId}`, { tradingHours: { open: '22:00', close: '09:00' } });
      expect(bad.status).toBe(422);
      expect((await as('RST', 'PATCH', `/departments/${departmentId}`, {})).status).toBe(422);
      expect((await as('STM', 'PATCH', `/departments/${departmentId}`, { installedLanes: 1 })).status).toBe(403);
      const outside = await call({ method: 'PATCH', path: `/departments/${departmentId}`, email: regionalRstEmail, role: 'RST', body: { installedLanes: 1 } });
      expect(outside.status).toBe(404);
      expect((await as('RST', 'PATCH', '/departments/00000000-0000-4000-8000-000000000000', { installedLanes: 1 })).status).toBe(404);
    });
  });
});

// ---------------------------------------------------------------------------
// SCR-053
// ---------------------------------------------------------------------------

describe('GET /staff (SCR-053)', () => {
  it('lists staff in scope; HR sees every store, the Store Manager only their own', async () => {
    const hr = (await as('HR', 'GET', '/staff')).body as StaffListResponse;
    expect(hr.truncated).toBe(false);
    expect(hr.staff.map((s) => s.id)).toEqual(expect.arrayContaining(org.staff.map((s) => s.id)));
    const record = hr.staff.find((s) => s.id === org.demoStaffId) as StaffRecord;
    expect(record).toMatchObject({ type: 'full_time', storeId: org.demoStoreId, active: true, availability: FULL_AVAILABILITY, unavailableDates: [] });

    const stm = (await as('STM', 'GET', '/staff')).body as StaffListResponse;
    expect(stm.staff.length).toBeGreaterThan(0);
    expect(new Set(stm.staff.map((s) => s.storeId))).toEqual(new Set([org.demoStoreId]));
    // A filter for another store can't widen the scope.
    const widened = (await as('STM', 'GET', `/staff?storeId=${otherStoreId()}`)).body as StaffListResponse;
    expect(widened.staff).toEqual([]);
  });

  it('filters by name or ID, store and type, and validates the query', async () => {
    const target = staffOf(otherStoreId());
    const byName = (await as('PLN', 'GET', `/staff?q=${encodeURIComponent(target.name.slice(-6))}`)).body as StaffListResponse;
    expect(byName.staff.map((s) => s.id)).toEqual([target.id]);
    const byStore = (await as('PLN', 'GET', `/staff?storeId=${target.storeId}&type=full_time`)).body as StaffListResponse;
    expect(byStore.staff.every((s) => s.storeId === target.storeId && s.type === 'full_time')).toBe(true);
    expect((await as('PLN', 'GET', `/staff?storeId=${target.storeId}&type=float`)).body).toEqual({ staff: [], truncated: false });
    expect((await as('PLN', 'GET', '/staff?type=contractor')).status).toBe(422);
  });

  it('refuses roles without the staff records row (403)', async () => {
    for (const role of ['ADM', 'EXE', 'FIN', 'STF'] as const) {
      expect((await as(role, 'GET', '/staff')).status).toBe(403);
    }
  });

  it('a deep link outside scope gets the same 404 as a missing record', async () => {
    const outside = await as('STM', 'GET', `/staff/${staffOf(otherStoreId()).id}`);
    const missing = await as('STM', 'GET', '/staff/00000000-0000-4000-8000-000000000000');
    expect(outside.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(errorCode(outside)).toBe(errorCode(missing));
    expect((outside.body as { error: { message: string } }).error.message).toBe(
      (missing.body as { error: { message: string } }).error.message,
    );
    expect((await as('STM', 'GET', `/staff/${org.demoStaffId}`)).status).toBe(200);
  });
});

describe('staff edits (staff_records)', () => {
  it('HR adds a staff record with one audit event that holds no name', async () => {
    const departmentId = await departmentOf(org.demoStoreId);
    const employeeNo = `PT-${uniq()}`;
    const res = await expectAudits(1, () =>
      as('HR', 'POST', '/staff', {
        storeId: org.demoStoreId,
        departmentId,
        employeeNo,
        name: 'Maria Clara',
        type: 'float',
        preferredRestDay: 'wed',
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ employeeNo, name: 'Maria Clara', type: 'float', preferredRestDay: 'wed', synthetic: true });
    const event = await lastAudit();
    expect(event).toMatchObject({ event: 'staff.created', active_role: 'HR' });
    expect(JSON.stringify(event.after)).not.toContain('Maria');

    await expectAudits(0, async () => {
      const dup = await as('HR', 'POST', '/staff', { storeId: org.demoStoreId, departmentId, employeeNo, name: 'Dup', type: 'part_time' });
      expect(dup.status).toBe(409);
      const wrongDept = await as('HR', 'POST', '/staff', {
        storeId: org.demoStoreId,
        departmentId: await departmentOf(otherStoreId()),
        employeeNo: `X-${uniq()}`,
        name: 'Wrong',
        type: 'part_time',
      });
      expect(wrongDept.status).toBe(422);
      // Store Managers may edit but not add staff; Planners only view.
      for (const role of ['STM', 'PLN', 'RST'] as const) {
        const denied = await as(role, 'POST', '/staff', { storeId: org.demoStoreId, departmentId, employeeNo: `Y-${uniq()}`, name: 'N', type: 'part_time' });
        expect(denied.status).toBe(403);
      }
    });
  });

  it('the Store Manager edits their own store’s staff; other stores get 404, view-only roles 403', async () => {
    const own = staffOf(org.demoStoreId);
    const res = await expectAudits(1, () => as('STM', 'PATCH', `/staff/${own.id}`, { preferredRestDay: 'mon', type: 'part_time', name: 'Renamed Person' }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ preferredRestDay: 'mon', type: 'part_time', name: 'Renamed Person' });
    const event = await lastAudit();
    expect(event).toMatchObject({ event: 'staff.updated', active_role: 'STM' });
    expect(JSON.stringify(event)).not.toContain('Renamed');
    expect(event.after).toMatchObject({ nameChanged: true });

    await expectAudits(0, async () => {
      expect((await as('STM', 'PATCH', `/staff/${staffOf(otherStoreId()).id}`, { active: false })).status).toBe(404);
      expect((await as('PLN', 'PATCH', `/staff/${own.id}`, { active: false })).status).toBe(403);
      expect((await as('RST', 'PATCH', `/staff/${own.id}`, { active: false })).status).toBe(403);
      expect((await as('HR', 'PATCH', `/staff/${own.id}`, { departmentId: await departmentOf(otherStoreId()) })).status).toBe(422);
      expect((await as('HR', 'PATCH', `/staff/${own.id}`, { email: 'x@y.z' })).status).toBe(422);
    });
    expect((await expectAudits(1, () => as('HR', 'PATCH', `/staff/${own.id}`, { preferredRestDay: null }))).body).toMatchObject({
      preferredRestDay: null,
    });
  });
});

describe('availability (staff_availability)', () => {
  it('replaces the weekly grid with one audit event (Planner, Store Manager, HR); others 403', async () => {
    const own = staffOf(org.demoStoreId);
    const availability = { ...FULL_AVAILABILITY, mon: ['evening', 'morning'], sun: [] };
    const res = await expectAudits(1, () => as('PLN', 'PUT', `/staff/${own.id}/availability`, { availability }));
    expect(res.status).toBe(200);
    expect((res.body as StaffRecord).availability).toMatchObject({ mon: ['morning', 'evening'], sun: [], tue: ['morning', 'afternoon', 'evening'] });
    expect(await lastAudit()).toMatchObject({ event: 'staff.availability_updated', active_role: 'PLN' });

    await expectAudits(0, async () => {
      expect((await as('RST', 'PUT', `/staff/${own.id}/availability`, { availability })).status).toBe(403);
      expect((await as('STM', 'PUT', `/staff/${staffOf(otherStoreId()).id}/availability`, { availability })).status).toBe(404);
      const missingDay = { ...availability } as Record<string, unknown>;
      delete missingDay.sat;
      expect((await as('HR', 'PUT', `/staff/${own.id}/availability`, { availability: missingDay })).status).toBe(422);
      expect((await as('HR', 'PUT', `/staff/${own.id}/availability`, { availability: { ...availability, mon: ['night'] } })).status).toBe(422);
    });
    const list = (await as('STM', 'GET', '/staff')).body as StaffListResponse;
    expect(list.staff.find((s) => s.id === own.id)?.availability.sun).toEqual([]);
  });

  it('adds and removes an unavailable date, one audit event each', async () => {
    const own = staffOf(org.demoStoreId);
    const added = await expectAudits(1, () => as('STM', 'POST', `/staff/${own.id}/unavailable-dates`, { date: '2099-12-14', reason: 'Exam' }));
    expect(added.status).toBe(201);
    const entry = (added.body as StaffRecord).unavailableDates.find((d) => d.date === '2099-12-14');
    expect(entry).toMatchObject({ reason: 'Exam', source: 'manual' });
    expect(await lastAudit()).toMatchObject({ event: 'staff.unavailable_date_added' });

    await expectAudits(0, async () => {
      expect((await as('STM', 'POST', `/staff/${own.id}/unavailable-dates`, { date: '2099-12-14' })).status).toBe(409);
      expect((await as('STM', 'POST', `/staff/${own.id}/unavailable-dates`, { date: '2099-02-30' })).status).toBe(422);
      expect((await as('FIN', 'POST', `/staff/${own.id}/unavailable-dates`, { date: '2099-12-15' })).status).toBe(403);
      const other = staffOf(otherStoreId());
      expect((await as('STM', 'POST', `/staff/${other.id}/unavailable-dates`, { date: '2099-12-15' })).status).toBe(404);
      // An entry of another staff record is not reachable through this one.
      expect((await as('HR', 'DELETE', `/staff/${other.id}/unavailable-dates/${entry?.id}`)).status).toBe(404);
    });

    const removed = await expectAudits(1, () => as('STM', 'DELETE', `/staff/${own.id}/unavailable-dates/${entry?.id}`));
    expect(removed.status).toBe(200);
    expect((removed.body as StaffRecord).unavailableDates.some((d) => d.id === entry?.id)).toBe(false);
    expect(await lastAudit()).toMatchObject({ event: 'staff.unavailable_date_removed' });
    expect((await as('STM', 'DELETE', `/staff/${own.id}/unavailable-dates/${entry?.id}`)).status).toBe(404);
  });

  it('refuses to remove a date that came from an approved request or import (409)', async () => {
    const own = staffOf(org.demoStoreId);
    const { id } = await one<{ id: string }>(
      db.pool,
      `INSERT INTO staff_availability (staff_id, kind, starts_at, ends_at, source, synthetic)
       VALUES ($1, 'unavailable', '2099-11-01T00:00:00+08', '2099-11-02T00:00:00+08', 'import', true) RETURNING id`,
      [own.id],
    );
    await expectAudits(0, async () => {
      expect((await as('HR', 'DELETE', `/staff/${own.id}/unavailable-dates/${id}`)).status).toBe(409);
    });
  });
});
