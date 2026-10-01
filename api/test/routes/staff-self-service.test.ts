/**
 * Staff self-service (task 18; Req 15, 7.3/7.4; P1, P7, P11, P14, P19)
 * against a real PostgreSQL through the task 8.1 enforcer.
 *
 *   - P11: whatever the roster around them holds (colleagues' shifts,
 *     reassignments, swaps, offers, requests), every `/me/*` response for a
 *     Staff user names only themselves — no other cashier's name, staff id,
 *     employee number, shift or cost (fast-check over random rosters).
 *   - P19: random sequences of raise / cancel / decline / approve — the
 *     published roster (shifts and availability) is unchanged by everything
 *     except a successful approval, and every committed request or decision
 *     writes exactly one audit event (fast-check).
 *   - My roster: own shifts with the previous times of a change, shifts taken
 *     off them, rest days and unavailable days; offers only within their own
 *     travel limit.
 *   - Approval: time off marks the cashier unavailable and leaves their shifts
 *     open (flagged to the store); a swap is applied as ShiftOverrides and
 *     both cashiers are notified; a labor-rule warning needs a reason and a
 *     missed 24-hour rest is never saved; a stale request cannot be approved.
 */
import type { MyOfferDto, MyRosterResponse, MyStaffRequestDto, StoreStaffRequestDto, SwapOptionsResponse } from '@lanewise/shared';
import fc from 'fast-check';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import { createEnforcer } from '../../src/auth/enforcer.js';
import { Router } from '../../src/http/router.js';
import { registerOfferRoutes } from '../../src/routes/offers.js';
import { registerRosterRoutes } from '../../src/routes/rosters.js';
import { registerStaffSelfServiceRoutes } from '../../src/routes/staff-self-service.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { insertUser } from '../support/fixtures.js';
import { BARANGAYS, callRoute, callerAs, seedBarangays, type Caller } from '../support/location.js';

let db: TestDatabase;
let router: Router;

interface World {
  region: string;
  stores: { qc: string; mega: string };
  depts: { qcMain: string; qcExpress: string; megaMain: string };
  rosters: { qcMain: string; qcExpress: string; megaMain: string };
}
let w: World;
const stm = {} as Record<'QC' | 'MEGA', Caller>;
let pln: Caller;
let hr: Caller;

interface Cashier {
  readonly id: string;
  readonly userId: string;
  readonly employeeNo: string;
  readonly name: string;
  readonly caller: Caller;
}

let seq = 0;
const uniq = () => `${++seq}`.padStart(4, '0');

async function one<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T> {
  const { rows } = await db.pool.query<T>(sql, values);
  return rows[0] as T;
}
async function count(sql: string, values: unknown[] = []): Promise<number> {
  return (await one<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) x`, values)).n;
}

async function dept(storeId: string, name: string): Promise<string> {
  return (
    await one<{ id: string }>(
      `INSERT INTO department (store_id, name, installed_lanes, default_handle_time_min, trading_open, trading_close)
       VALUES ($1, $2, 10, 2.5, '10:00', '22:00') RETURNING id`,
      [storeId, name],
    )
  ).id;
}

async function roster(storeId: string, departmentId: string): Promise<string> {
  return (
    await one<{ id: string }>(
      `INSERT INTO roster (store_id, department_id, period_start, period_end, status, published_at)
       VALUES ($1, $2, '2030-01-01', '2030-12-31', 'published', now()) RETURNING id`,
      [storeId, departmentId],
    )
  ).id;
}

async function shift(rosterId: string, departmentId: string, staffId: string | null, date: string, start: number, end: number): Promise<string> {
  const at = (h: number) => new Date(Date.parse(`${date}T00:00:00+08:00`) + h * 3_600_000).toISOString();
  return (
    await one<{ id: string }>(
      `INSERT INTO shift (roster_id, staff_id, department_id, starts_at, ends_at, activities) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
      [rosterId, staffId, departmentId, at(start), at(end), JSON.stringify([{ kind: 'meal', startMin: (start + 3) * 60, endMin: (start + 4) * 60 }])],
    )
  ).id;
}

/** A cashier with a Staff account whose user name equals the staff name (so a leak would show). */
async function cashier(storeId: string, departmentId: string, options: { type?: string; trained?: string[]; limit?: { max: number; cross: boolean } } = {}): Promise<Cashier> {
  const n = uniq();
  const employeeNo = `EMP-${n}`;
  const name = `Cashier-${n}-Secret`;
  const userId = await insertUser(db.pool);
  await db.pool.query('UPDATE app_user SET name = $2 WHERE id = $1', [userId, name]);
  const { id } = await one<{ id: string }>(
    `INSERT INTO staff (store_id, department_id, employee_no, name, employment_type, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [storeId, departmentId, employeeNo, name, options.type ?? 'regular', userId],
  );
  for (const d of [departmentId, ...(options.trained ?? [])]) {
    await db.pool.query('INSERT INTO staff_training (staff_id, department_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, d]);
  }
  if (options.limit) {
    await db.pool.query(`INSERT INTO staff_consent (staff_id, purpose, text_version, text_locale) VALUES ($1, 'home_area', 1, 'en')`, [id]);
    await db.pool.query(
      `INSERT INTO staff_home_area (staff_id, barangay_code, consent_at, max_travel_min, cross_store_offers) VALUES ($1, $2, now(), $3, $4)`,
      [id, BARANGAYS[0]!.code, options.limit.max, options.limit.cross],
    );
  }
  const caller = await callerAs(db.pool, userId, 'STF', { type: 'self', staffId: id });
  return { id, userId, employeeNo, name, caller };
}

const call = (c: Caller, method: string, path: string, options: { body?: unknown; query?: Record<string, string> } = {}) =>
  callRoute(router, c, method, path, options);

const auditCount = () => count(`SELECT 1 FROM audit_event`);

beforeAll(async () => {
  db = await createTestDatabase();
  await seedBarangays(db.pool);
  const deps = { db: () => db.pool, rbac: { ...DEFAULT_RBAC_CONFIG, demoRoleSwitcher: false } };
  router = new Router({ enforcer: createEnforcer(deps) });
  registerStaffSelfServiceRoutes(router, deps);
  registerOfferRoutes(router, deps);
  registerRosterRoutes(router, deps);
  router.assertGuarded();

  const region = (await one<{ id: string }>(`INSERT INTO region (code, name) VALUES ('MM', 'Metro Manila') RETURNING id`)).id;
  const store = async (code: string, name: string) =>
    (await one<{ id: string }>(`INSERT INTO store (code, name, format, region_id) VALUES ($1, $2, 'sm_supermarket', $3) RETURNING id`, [code, name, region])).id;
  const stores = { qc: await store('QC', 'SM Supermarket – Quezon City'), mega: await store('MEGA', 'SM Megamall') };
  const depts = { qcMain: await dept(stores.qc, 'Main checkout lanes'), qcExpress: await dept(stores.qc, 'Express lanes'), megaMain: await dept(stores.mega, 'Main checkout lanes') };
  const rosters = {
    qcMain: await roster(stores.qc, depts.qcMain),
    qcExpress: await roster(stores.qc, depts.qcExpress),
    megaMain: await roster(stores.mega, depts.megaMain),
  };
  w = { region, stores, depts, rosters };
  stm.QC = await callerAs(db.pool, await insertUser(db.pool), 'STM', { type: 'store', storeIds: [stores.qc] });
  stm.MEGA = await callerAs(db.pool, await insertUser(db.pool), 'STM', { type: 'store', storeIds: [stores.mega] });
  pln = await callerAs(db.pool, await insertUser(db.pool), 'PLN', { type: 'global' });
  hr = await callerAs(db.pool, await insertUser(db.pool), 'HR', { type: 'global' });
});

afterAll(async () => {
  await db.dispose();
});

const qcShift = (staffId: string | null, date: string, start = 15, end = 21) => shift(w.rosters.qcMain, w.depts.qcMain, staffId, date, start, end);

async function raise(c: Cashier, body: unknown) {
  return call(c.caller, 'POST', '/me/requests', { body });
}
async function decide(storeCaller: Caller, storeId: string, id: string, body: unknown) {
  return call(storeCaller, 'POST', `/stores/${storeId}/staff-requests/${id}/decision`, { body });
}

describe('GET /me/roster (18.1)', () => {
  it('shows the cashier’s own shifts, the previous times of a change, shifts taken off them, rest and unavailable days', async () => {
    const me = await cashier(w.stores.qc, w.depts.qcMain);
    const colleague = await cashier(w.stores.qc, w.depts.qcMain);
    const mon = '2030-02-04';
    await qcShift(me.id, '2030-02-05', 15, 19); // Tue
    const sat = await qcShift(me.id, '2030-02-09', 13, 17); // Sat, then moved to 12–21
    const lost = await qcShift(me.id, '2030-02-07', 10, 18); // Thu, reassigned to the colleague
    await qcShift(colleague.id, '2030-02-06', 9, 17); // a colleague's shift — never visible
    await db.pool.query(
      `INSERT INTO staff_availability (staff_id, kind, starts_at, ends_at, source) VALUES ($1, 'unavailable', '2030-02-06T00:00:00+08:00', '2030-02-07T00:00:00+08:00', 'manual')`,
      [me.id],
    );
    const timeChange = await call(stm.QC, 'POST', `/stores/${w.stores.qc}/rosters/${w.rosters.qcMain}/overrides`, {
      body: { type: 'time_change', shiftId: sat, date: '2030-02-09', startMin: 12 * 60, endMin: 21 * 60, reason: 'Peak cover' },
    });
    expect(timeChange.status).toBe(201);
    expect(
      (await call(stm.QC, 'POST', `/stores/${w.stores.qc}/rosters/${w.rosters.qcMain}/overrides`, { body: { type: 'reassign', shiftId: lost, toStaffId: colleague.id } }))
        .status,
    ).toBe(201);

    const res = await call(me.caller, 'GET', '/me/roster', { query: { from: mon, to: '2030-02-10' } });
    expect(res.status).toBe(200);
    const body = res.body as unknown as MyRosterResponse;
    expect(body.staff).toMatchObject({ id: me.id, employeeNo: me.employeeNo, name: me.name, storeName: 'SM Supermarket – Quezon City' });
    expect(body.days.map((d) => d.date)).toEqual(['2030-02-04', '2030-02-05', '2030-02-06', '2030-02-07', '2030-02-08', '2030-02-09', '2030-02-10']);
    const byDate = new Map(body.days.map((d) => [d.date, d]));
    expect(byDate.get('2030-02-04')).toMatchObject({ shifts: [], absence: 'rest' });
    expect(byDate.get('2030-02-05')?.shifts[0]).toMatchObject({ startMin: 900, endMin: 1140, changed: null, departmentName: 'Main checkout lanes' });
    expect(byDate.get('2030-02-06')).toMatchObject({ shifts: [], absence: 'unavailable' });
    expect(byDate.get('2030-02-07')).toMatchObject({ shifts: [], absence: 'rest', removed: [{ shiftId: lost, type: 'reassign', startMin: 600, endMin: 1080 }] });
    expect(byDate.get('2030-02-09')?.shifts[0]).toMatchObject({
      id: sat,
      startMin: 720,
      endMin: 1260,
      changed: { type: 'time_change', previous: { date: '2030-02-09', startMin: 780, endMin: 1020 } },
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain(colleague.name);
    expect(text).not.toContain(colleague.id);
    expect(text).not.toContain(colleague.employeeNo);
  });

  it('is for Staff only, on their own record; the window is at most four weeks', async () => {
    const me = await cashier(w.stores.qc, w.depts.qcMain);
    expect((await call(stm.QC, 'GET', '/me/roster')).status).toBe(403);
    expect((await call(pln, 'GET', '/me/roster')).status).toBe(403);
    expect((await call(me.caller, 'GET', '/me/roster')).status).toBe(200);
    expect((await call(me.caller, 'GET', '/me/roster', { query: { from: '2030-01-01', to: '2030-02-15' } })).status).toBe(422);
    expect((await call(me.caller, 'GET', '/me/roster', { query: { from: '2030-02-30' } })).status).toBe(422);
  });
});

describe('offers within the cashier’s own travel limit (Req 15.2)', () => {
  it('hides and refuses another store’s offer beyond their limit, keeps own-store and in-limit offers', async () => {
    const me = await cashier(w.stores.qc, w.depts.qcMain, { trained: [], limit: { max: 30, cross: true } });
    const sender = (await one<{ id: string }>(`SELECT id FROM app_user ORDER BY created_at LIMIT 1`)).id;
    const offer = async (rosterId: string, deptId: string, travelMin: number) => {
      const shiftId = await shift(rosterId, deptId, null, '2030-03-02', 13, 17);
      return (
        await one<{ id: string }>(
          `INSERT INTO shift_offer (shift_id, staff_id, sent_by, expires_at, travel_min) VALUES ($1, $2, $3, now() + interval '20 minutes', $4) RETURNING id`,
          [shiftId, me.id, sender, travelMin],
        )
      ).id;
    };
    const far = await offer(w.rosters.megaMain, w.depts.megaMain, 45);
    const near = await offer(w.rosters.megaMain, w.depts.megaMain, 20);
    const own = await offer(w.rosters.qcMain, w.depts.qcMain, 70);
    const listed = ((await call(me.caller, 'GET', '/me/offers')).body as { offers: MyOfferDto[] }).offers.map((o) => o.id);
    expect(listed).toEqual(expect.arrayContaining([near, own]));
    expect(listed).not.toContain(far);
    expect((await call(me.caller, 'POST', `/me/offers/${far}/accept`)).status).toBe(404);
    // Cross-store offers off: only their own store's.
    await db.pool.query(`UPDATE staff_home_area SET cross_store_offers = false WHERE staff_id = $1`, [me.id]);
    const after = ((await call(me.caller, 'GET', '/me/offers')).body as { offers: MyOfferDto[] }).offers.map((o) => o.id);
    expect(after).toContain(own);
    expect(after).not.toContain(near);
  });
});

describe('time-off requests (18.2)', () => {
  it('routes to the store manager without touching the roster; approval marks unavailable and leaves the shifts open', async () => {
    const me = await cashier(w.stores.qc, w.depts.qcMain);
    const s1 = await qcShift(me.id, '2030-04-10');
    const s2 = await qcShift(me.id, '2030-04-11');
    const keep = await qcShift(me.id, '2030-04-13');
    const before = await auditCount();
    const res = await raise(me, { type: 'time_off', dateFrom: '2030-04-10', dateTo: '2030-04-12', reason: 'family', note: 'Wedding' });
    expect(res.status).toBe(201);
    const req = (res.body as { request: MyStaffRequestDto }).request;
    expect(req).toMatchObject({ type: 'time_off', status: 'pending', dateFrom: '2030-04-10', dateTo: '2030-04-12', reason: 'family' });
    expect(await auditCount()).toBe(before + 1);
    expect(await count(`SELECT 1 FROM shift WHERE id = ANY($1::uuid[]) AND staff_id = $2`, [[s1, s2, keep], me.id])).toBe(3);
    expect(await count(`SELECT 1 FROM notification WHERE event = 'staff_request.submitted' AND object_id = $1`, [req.id])).toBe(1);
    // My roster flags the pending request on the affected shifts.
    const mine = (await call(me.caller, 'GET', '/me/roster', { query: { from: '2030-04-10', to: '2030-04-13' } })).body as unknown as MyRosterResponse;
    expect(mine.days[0]?.shifts[0]?.pendingRequestId).toBe(req.id);
    expect(mine.days[3]?.shifts[0]?.pendingRequestId).toBeNull();
    // An overlapping second request is refused.
    expect((await raise(me, { type: 'time_off', dateFrom: '2030-04-12', dateTo: '2030-04-14' })).status).toBe(409);

    // The manager's panel: the cashier by name, two shifts would be left open.
    const panel = ((await call(stm.QC, 'GET', `/stores/${w.stores.qc}/staff-requests`)).body as { requests: StoreStaffRequestDto[] }).requests;
    expect(panel.find((r) => r.id === req.id)).toMatchObject({ staff: { id: me.id, name: me.name }, shiftsLeftOpen: 2, stale: false });
    // Another store's manager, a Planner (no approve) and the cashier cannot decide.
    expect((await decide(stm.MEGA, w.stores.qc, req.id, { decision: 'approve' })).status).toBe(404);
    expect((await decide(stm.MEGA, w.stores.mega, req.id, { decision: 'approve' })).status).toBe(404);
    expect((await decide(pln, w.stores.qc, req.id, { decision: 'approve' })).status).toBe(403);
    expect((await decide(me.caller, w.stores.qc, req.id, { decision: 'approve' })).status).toBe(403);

    const ok = await decide(stm.QC, w.stores.qc, req.id, { decision: 'approve' });
    expect(ok.status).toBe(200);
    expect((ok.body as { request: StoreStaffRequestDto }).request.status).toBe('approved');
    expect(await count(`SELECT 1 FROM shift WHERE id = ANY($1::uuid[]) AND staff_id IS NULL`, [[s1, s2]])).toBe(2);
    expect(await count(`SELECT 1 FROM shift WHERE id = $1 AND staff_id = $2`, [keep, me.id])).toBe(1);
    expect(await count(`SELECT 1 FROM shift_override WHERE staff_request_id = $1 AND override_type = 'time_off'`, [req.id])).toBe(2);
    expect(
      await count(`SELECT 1 FROM staff_availability WHERE staff_request_id = $1 AND kind = 'unavailable' AND starts_at = '2030-04-10T00:00:00+08:00' AND ends_at = '2030-04-13T00:00:00+08:00'`, [req.id]),
    ).toBe(1);
    expect(await count(`SELECT 1 FROM notification WHERE event = 'staff_request.decided' AND object_id = $1 AND user_id = $2`, [req.id, me.userId])).toBe(1);
    expect(await count(`SELECT 1 FROM notification WHERE event = 'roster.unfilled_shifts' AND params -> 'shiftIds' ? $1`, [s1])).toBeGreaterThan(0);
    expect(await count(`SELECT 1 FROM audit_event WHERE object_id = $1 AND event = 'staff_request.approved' AND action = 'decision'`, [req.id])).toBe(1);
    // Decided once.
    expect((await decide(stm.QC, w.stores.qc, req.id, { decision: 'decline' })).status).toBe(409);
    const day = ((await call(me.caller, 'GET', '/me/roster', { query: { from: '2030-04-10', to: '2030-04-10' } })).body as unknown as MyRosterResponse).days[0];
    expect(day).toMatchObject({ shifts: [], absence: 'unavailable', removed: [{ shiftId: s1, type: 'time_off' }] });
  });

  it('declines with a comment and cancels, changing nothing; another cashier’s request is a 404', async () => {
    const me = await cashier(w.stores.qc, w.depts.qcMain);
    const other = await cashier(w.stores.qc, w.depts.qcMain);
    const a = ((await raise(me, { type: 'time_off', dateFrom: '2030-05-01', dateTo: '2030-05-01' })).body as { request: MyStaffRequestDto }).request;
    const b = ((await raise(me, { type: 'time_off', dateFrom: '2030-05-03', dateTo: '2030-05-03' })).body as { request: MyStaffRequestDto }).request;
    expect((await call(other.caller, 'POST', `/me/requests/${a.id}/cancel`)).status).toBe(404);
    const d = await decide(stm.QC, w.stores.qc, a.id, { decision: 'decline', note: 'Need cover that day' });
    expect((d.body as { request: StoreStaffRequestDto }).request).toMatchObject({ status: 'declined', decisionNote: 'Need cover that day' });
    expect((await call(me.caller, 'POST', `/me/requests/${b.id}/cancel`)).body).toMatchObject({ request: { status: 'cancelled' } });
    expect((await call(me.caller, 'POST', `/me/requests/${b.id}/cancel`)).status).toBe(409);
    expect(await count(`SELECT 1 FROM staff_availability WHERE staff_id = $1`, [me.id])).toBe(0);
    const list = ((await call(me.caller, 'GET', '/me/requests')).body as { requests: MyStaffRequestDto[] }).requests;
    expect(list.map((r) => r.status).sort()).toEqual(['cancelled', 'declined']);
    expect(((await call(other.caller, 'GET', '/me/requests')).body as { requests: unknown[] }).requests).toEqual([]);
    expect((await raise(me, { type: 'time_off', dateFrom: '2020-01-01', dateTo: '2020-01-02' })).status).toBe(422);
  });
});

describe('swap requests (18.2)', () => {
  it('swaps into an open shift: options list only open slots, approval applies ShiftOverrides', async () => {
    const me = await cashier(w.stores.qc, w.depts.qcMain);
    const mine = await qcShift(me.id, '2030-06-06', 12, 21);
    const open = await qcShift(null, '2030-06-04', 15, 19);
    const colleague = await cashier(w.stores.qc, w.depts.qcMain);
    const theirs = await qcShift(colleague.id, '2030-06-05', 15, 19);
    const opts = (await call(me.caller, 'GET', '/me/requests/swap-options')).body as unknown as SwapOptionsResponse;
    expect(opts.mine.map((s) => s.shiftId)).toContain(mine);
    expect(opts.open.map((s) => s.shiftId)).toContain(open);
    expect(opts.open.map((s) => s.shiftId)).not.toContain(theirs);
    expect(JSON.stringify(opts)).not.toContain(colleague.name);

    const res = await raise(me, { type: 'swap', offeredShiftId: mine, targetShiftId: open, note: 'Exam on Thursday' });
    expect(res.status).toBe(201);
    const req = (res.body as { request: MyStaffRequestDto }).request;
    expect(req).toMatchObject({ type: 'swap', status: 'pending', offered: { shiftId: mine }, target: { shiftId: open, kind: 'open' } });
    // The same shift can't be offered twice while pending.
    expect((await raise(me, { type: 'swap', offeredShiftId: mine, targetShiftId: open })).status).toBe(409);
    expect(await count(`SELECT 1 FROM shift WHERE id = $1 AND staff_id = $2`, [mine, me.id])).toBe(1);

    const ok = await decide(stm.QC, w.stores.qc, req.id, { decision: 'approve' });
    expect(ok.status).toBe(200);
    expect(await count(`SELECT 1 FROM shift WHERE id = $1 AND staff_id IS NULL`, [mine])).toBe(1);
    expect(await count(`SELECT 1 FROM shift WHERE id = $1 AND staff_id = $2`, [open, me.id])).toBe(1);
    expect(await count(`SELECT 1 FROM shift_override WHERE staff_request_id = $1 AND override_type = 'swap'`, [req.id])).toBe(2);
    expect(await count(`SELECT 1 FROM notification WHERE event = 'shift.changed' AND user_id = $1`, [me.userId])).toBeGreaterThan(0);
  });

  it('swaps with a colleague: both cashiers are notified; the Staff view never names the colleague', async () => {
    const me = await cashier(w.stores.qc, w.depts.qcMain);
    const colleague = await cashier(w.stores.qc, w.depts.qcMain);
    const mine = await qcShift(me.id, '2030-06-12', 9, 17);
    const theirs = await qcShift(colleague.id, '2030-06-13', 9, 17);
    const res = await raise(me, { type: 'swap', offeredShiftId: mine, targetShiftId: theirs });
    expect(res.status).toBe(201);
    const req = (res.body as { request: MyStaffRequestDto }).request;
    expect(req.target?.kind).toBe('colleague');
    expect(JSON.stringify(res.body)).not.toContain(colleague.name);
    expect(JSON.stringify((await call(me.caller, 'GET', '/me/requests')).body)).not.toContain(colleague.id);
    const panel = ((await call(stm.QC, 'GET', `/stores/${w.stores.qc}/staff-requests`)).body as { requests: StoreStaffRequestDto[] }).requests;
    expect(panel.find((r) => r.id === req.id)?.target?.staffName).toBe(`${colleague.employeeNo} ${colleague.name}`);

    expect((await decide(stm.QC, w.stores.qc, req.id, { decision: 'approve' })).status).toBe(200);
    expect(await count(`SELECT 1 FROM shift WHERE id = $1 AND staff_id = $2`, [mine, colleague.id])).toBe(1);
    expect(await count(`SELECT 1 FROM shift WHERE id = $1 AND staff_id = $2`, [theirs, me.id])).toBe(1);
    for (const u of [me.userId, colleague.userId]) {
      expect(await count(`SELECT 1 FROM notification n JOIN shift_override o ON o.id::text = n.object_id WHERE n.event = 'shift.changed' AND n.user_id = $1 AND o.staff_request_id = $2`, [u, req.id])).toBeGreaterThan(0);
    }
    // The colleague's own roster shows the swap, without the requester's name.
    const theirRoster = (await call(colleague.caller, 'GET', '/me/roster', { query: { from: '2030-06-12', to: '2030-06-13' } })).body as unknown as MyRosterResponse;
    expect(theirRoster.days[0]?.shifts[0]).toMatchObject({ id: mine, changed: { type: 'swap' } });
    expect(JSON.stringify(theirRoster)).not.toContain(me.name);
  });

  it('applies Req 7.3/7.4: a new warning needs a reason, a missed 24-hour rest is never saved', async () => {
    // Warning: the target starts 7 h after their Monday shift ends (MIN_REST < 10 h).
    const me = await cashier(w.stores.qc, w.depts.qcMain);
    await qcShift(me.id, '2030-07-01', 14, 23);
    const give = await qcShift(me.id, '2030-07-10', 9, 17);
    const early = await qcShift(null, '2030-07-02', 6, 12);
    const warn = ((await raise(me, { type: 'swap', offeredShiftId: give, targetShiftId: early })).body as { request: MyStaffRequestDto }).request;
    const pendingView = ((await call(stm.QC, 'GET', `/stores/${w.stores.qc}/staff-requests`)).body as { requests: StoreStaffRequestDto[] }).requests.find((r) => r.id === warn.id);
    expect(pendingView?.check?.status).toBe('needsReason');
    const noReason = await decide(stm.QC, w.stores.qc, warn.id, { decision: 'approve' });
    expect(noReason.status).toBe(422);
    expect(await count(`SELECT 1 FROM shift WHERE id = $1 AND staff_id IS NULL`, [early])).toBe(1);
    expect((await decide(stm.QC, w.stores.qc, warn.id, { decision: 'approve', reason: 'Cashier asked; short turnaround agreed' })).status).toBe(200);
    expect(
      (await one<{ reason: string; n: number }>(`SELECT reason, jsonb_array_length(rule_breaches)::int AS n FROM shift_override WHERE staff_request_id = $1 LIMIT 1`, [warn.id])),
    ).toMatchObject({ reason: 'Cashier asked; short turnaround agreed' });

    // Block: six working days in a row, then the seventh.
    const busy = await cashier(w.stores.qc, w.depts.qcMain);
    for (const d of ['2030-08-05', '2030-08-06', '2030-08-07', '2030-08-08', '2030-08-09', '2030-08-10']) await qcShift(busy.id, d, 9, 15);
    const give2 = await qcShift(busy.id, '2030-08-20', 9, 15);
    const seventh = await qcShift(null, '2030-08-11', 9, 15);
    const block = ((await raise(busy, { type: 'swap', offeredShiftId: give2, targetShiftId: seventh })).body as { request: MyStaffRequestDto }).request;
    const blocked = await decide(stm.QC, w.stores.qc, block.id, { decision: 'approve', reason: 'Please' });
    expect(blocked.status).toBe(409);
    expect(await count(`SELECT 1 FROM staff_request WHERE id = $1 AND status = 'pending'`, [block.id])).toBe(1);
    expect(await count(`SELECT 1 FROM shift_override WHERE staff_request_id = $1`, [block.id])).toBe(0);
  });

  it('refuses a stale swap after the roster moved, and wrong shifts at request time', async () => {
    const me = await cashier(w.stores.qc, w.depts.qcMain);
    const someone = await cashier(w.stores.qc, w.depts.qcMain);
    const mine = await qcShift(me.id, '2030-09-03', 9, 17);
    const open = await qcShift(null, '2030-09-04', 9, 17);
    const req = ((await raise(me, { type: 'swap', offeredShiftId: mine, targetShiftId: open })).body as { request: MyStaffRequestDto }).request;
    // The manager fills the open shift directly meanwhile.
    await call(stm.QC, 'POST', `/stores/${w.stores.qc}/rosters/${w.rosters.qcMain}/overrides`, { body: { type: 'reassign', shiftId: mine, toStaffId: someone.id } });
    const panel = ((await call(stm.QC, 'GET', `/stores/${w.stores.qc}/staff-requests`)).body as { requests: StoreStaffRequestDto[] }).requests;
    expect(panel.find((r) => r.id === req.id)?.stale).toBe(true);
    expect((await decide(stm.QC, w.stores.qc, req.id, { decision: 'approve' })).status).toBe(409);
    expect((await decide(stm.QC, w.stores.qc, req.id, { decision: 'decline' })).status).toBe(200);

    const megaOpen = await shift(w.rosters.megaMain, w.depts.megaMain, null, '2030-09-05', 9, 17);
    const mine2 = await qcShift(me.id, '2030-09-06', 9, 17);
    const expressOpen = await shift(w.rosters.qcExpress, w.depts.qcExpress, null, '2030-09-07', 9, 17);
    const notMine = await qcShift(someone.id, '2030-09-08', 9, 17);
    const err = async (body: unknown) => ((await raise(me, body)).body as { code: string; details?: { path: string }[] });
    expect((await raise(me, { type: 'swap', offeredShiftId: mine2, targetShiftId: megaOpen })).status).toBe(422); // other store
    expect((await raise(me, { type: 'swap', offeredShiftId: mine2, targetShiftId: expressOpen })).status).toBe(422); // not trained
    expect((await raise(me, { type: 'swap', offeredShiftId: notMine, targetShiftId: open })).status).toBe(422); // not their shift
    expect((await err({ type: 'swap', offeredShiftId: mine2, targetShiftId: '00000000-0000-0000-0000-000000000000' })).code).toBe('validation_failed');
  });
});

describe('the database keeps P19', () => {
  it('refuses a request-driven change of a request that is not approved, and a second decision', async () => {
    const me = await cashier(w.stores.qc, w.depts.qcMain);
    const s = await qcShift(me.id, '2030-10-01');
    const user = (await one<{ id: string }>(`SELECT id FROM app_user LIMIT 1`)).id;
    const { id } = await one<{ id: string }>(
      `INSERT INTO staff_request (staff_id, store_id, request_type, date_from, date_to) VALUES ($1, $2, 'time_off', '2030-10-01', '2030-10-01') RETURNING id`,
      [me.id, w.stores.qc],
    );
    await expect(
      db.pool.query(
        `INSERT INTO shift_override (roster_id, shift_id, override_type, from_staff_id, staff_request_id, created_by) VALUES ($1, $2, 'time_off', $3, $4, $5)`,
        [w.rosters.qcMain, s, me.id, id, user],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.pool.query(
        `INSERT INTO staff_availability (staff_id, kind, starts_at, ends_at, source, staff_request_id) VALUES ($1, 'unavailable', now(), now() + interval '1 day', 'staff_request', $2)`,
        [me.id, id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await db.pool.query(`UPDATE staff_request SET status = 'declined', decided_by = $2, decided_at = now() WHERE id = $1`, [id, user]);
    await expect(db.pool.query(`UPDATE staff_request SET status = 'approved' WHERE id = $1`, [id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query(`UPDATE staff_request SET note = 'x' WHERE id = $1`, [id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.pool.query(`DELETE FROM staff_request WHERE id = $1`, [id])).rejects.toMatchObject({ code: '23514' });
  });
});

// ---------------------------------------------------------------------------
// Property 11 — Staff self-scope
// ---------------------------------------------------------------------------

describe('Property 11: a Staff user never sees another cashier’s name, shift or cost', () => {
  it('holds for every /me response over random rosters, changes, swaps and requests', async () => {
    let round = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 4 }),
        fc.array(fc.record({ who: fc.nat(), day: fc.integer({ min: 0, max: 13 }), start: fc.integer({ min: 6, max: 14 }), len: fc.integer({ min: 4, max: 8 }) }), {
          minLength: 3,
          maxLength: 12,
        }),
        fc.array(fc.record({ kind: fc.constantFrom('reassign', 'swap', 'time_off', 'offer'), a: fc.nat(), b: fc.nat() }), { maxLength: 6 }),
        async (n, shiftSpecs, actions) => {
          round += 1;
          const base = new Date(Date.UTC(2031, 0, 6 + round * 14)).toISOString().slice(0, 10);
          const day = (i: number) => new Date(Date.parse(`${base}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
          const people: Cashier[] = [];
          for (let i = 0; i < n; i += 1) people.push(await cashier(w.stores.qc, w.depts.qcMain, { limit: { max: 60, cross: true } }));
          const shifts: { id: string; owner: number | null }[] = [];
          for (const s of shiftSpecs) {
            const owner = s.who % (n + 1) === n ? null : s.who % (n + 1);
            shifts.push({ id: await qcShift(owner === null ? null : people[owner]!.id, day(s.day), s.start, s.start + s.len), owner });
          }
          for (const a of actions) {
            const p = people[a.a % n]!;
            const sh = shifts[a.b % shifts.length]!;
            if (a.kind === 'reassign' && sh.owner !== null) {
              const to = people[(sh.owner + 1) % n]!;
              const r = await call(stm.QC, 'POST', `/stores/${w.stores.qc}/rosters/${w.rosters.qcMain}/overrides`, {
                body: { type: 'reassign', shiftId: sh.id, toStaffId: to.id, reason: 'Property test' },
              });
              if (r.status === 201) sh.owner = (sh.owner + 1) % n;
            } else if (a.kind === 'swap') {
              const mine = shifts.find((x) => x.owner === a.a % n);
              if (mine && mine.id !== sh.id) {
                const r = await raise(p, { type: 'swap', offeredShiftId: mine.id, targetShiftId: sh.id });
                if (r.status === 201) {
                  const id = (r.body as { request: MyStaffRequestDto }).request.id;
                  await decide(stm.QC, w.stores.qc, id, { decision: 'approve', reason: 'Property test' });
                }
              }
            } else if (a.kind === 'time_off') {
              await raise(p, { type: 'time_off', dateFrom: day(a.b % 14), dateTo: day(a.b % 14) });
            } else if (a.kind === 'offer') {
              const sender = (await one<{ id: string }>(`SELECT id FROM app_user LIMIT 1`)).id;
              const open = await shift(w.rosters.megaMain, w.depts.megaMain, null, day(a.b % 14), 13, 17);
              await db.pool.query(
                `INSERT INTO shift_offer (shift_id, staff_id, sent_by, expires_at, travel_min, pay_php) VALUES ($1, $2, $3, now() + interval '20 minutes', 25, 400)`,
                [open, p.id, sender],
              );
            }
          }
          for (const [i, p] of people.entries()) {
            const responses = [
              await call(p.caller, 'GET', '/me/roster', { query: { from: base, to: day(13) } }),
              await call(p.caller, 'GET', '/me/requests'),
              await call(p.caller, 'GET', '/me/requests/swap-options'),
              await call(p.caller, 'GET', '/me/offers'),
            ];
            for (const r of responses) {
              expect(r.status).toBe(200);
              const text = JSON.stringify(r.body);
              for (const [j, other] of people.entries()) {
                if (j === i) continue;
                expect(text).not.toContain(other.name);
                expect(text).not.toContain(other.id);
                expect(text).not.toContain(other.employeeNo);
              }
              // No cost of any kind (an offer's own pay is the cashier's own term, not employer cost).
              expect(text).not.toMatch(/"(cost|costPhp|totalCost|wage|hourlyRate|loading)[A-Za-z]*"\s*:/i);
            }
            // Every shift in My roster is theirs right now.
            const roster = responses[0]!.body as unknown as MyRosterResponse;
            const shown = roster.days.flatMap((d) => d.shifts.map((s) => s.id));
            if (shown.length > 0) {
              expect(await count(`SELECT 1 FROM shift WHERE id = ANY($1::uuid[]) AND staff_id = $2`, [shown, p.id])).toBe(shown.length);
            }
          }
        },
      ),
      { numRuns: 8 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 19 — Requests do not change the roster until approved
// ---------------------------------------------------------------------------

describe('Property 19: requests do not change the roster until approved; every request and decision is audited', () => {
  it('holds over random sequences of raise / cancel / decline / approve', async () => {
    let round = 0;
    const tally = { approved: 0, swapsRaised: 0, refused: 0 };
    const fingerprint = async (staffIds: readonly string[]) => {
      const { rows } = await db.pool.query<{ f: string }>(
        `SELECT coalesce(string_agg(x, '|' ORDER BY x), '') AS f FROM (
           SELECT sh.id || ':' || coalesce(sh.staff_id::text, '-') || ':' || sh.status || ':' || sh.starts_at::text AS x
             FROM shift sh WHERE sh.roster_id = $2
           UNION ALL
           SELECT 'a:' || a.id FROM staff_availability a WHERE a.staff_id = ANY($1::uuid[])
           UNION ALL
           SELECT 'o:' || o.id FROM shift_override o WHERE o.roster_id = $2
         ) t`,
        [staffIds, w.rosters.qcMain],
      );
      return rows[0]?.f ?? '';
    };
    const opArb = fc.record({
      op: fc.constantFrom('raise_time_off', 'raise_swap', 'cancel', 'decline', 'approve'),
      who: fc.nat(),
      pick: fc.nat(),
      day: fc.integer({ min: 0, max: 9 }),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 4, maxLength: 14 }), async (ops) => {
        round += 1;
        const base = new Date(Date.UTC(2032, 0, 5 + round * 21)).toISOString().slice(0, 10);
        const day = (i: number) => new Date(Date.parse(`${base}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
        const people = [await cashier(w.stores.qc, w.depts.qcMain), await cashier(w.stores.qc, w.depts.qcMain)];
        for (const [i, p] of people.entries()) for (const d of [1, 3, 5, 7]) await qcShift(p.id, day(d + i), 9, 15);
        for (const d of [2, 6]) await qcShift(null, day(d), 10, 16);
        const ids = people.map((p) => p.id);
        const requests: string[] = [];
        for (const o of ops) {
          const p = people[o.who % people.length]!;
          const before = await fingerprint(ids);
          const audits = await auditCount();
          let res: { status: number; body: Record<string, unknown> | null };
          let isApproval = false;
          switch (o.op) {
            case 'raise_time_off':
              res = await raise(p, { type: 'time_off', dateFrom: day(o.day), dateTo: day(Math.min(9, o.day + (o.pick % 3))) });
              break;
            case 'raise_swap': {
              const opts = (await call(p.caller, 'GET', '/me/requests/swap-options')).body as unknown as SwapOptionsResponse;
              const mine = opts.mine[o.pick % Math.max(1, opts.mine.length)];
              const target = opts.open[o.day % Math.max(1, opts.open.length)];
              if (!mine || !target) continue;
              res = await raise(p, { type: 'swap', offeredShiftId: mine.shiftId, targetShiftId: target.shiftId });
              break;
            }
            case 'cancel': {
              const id = requests[o.pick % Math.max(1, requests.length)];
              if (!id) continue;
              res = await call(p.caller, 'POST', `/me/requests/${id}/cancel`);
              break;
            }
            case 'decline':
            case 'approve': {
              const id = requests[o.pick % Math.max(1, requests.length)];
              if (!id) continue;
              isApproval = o.op === 'approve';
              res = await decide(stm.QC, w.stores.qc, id, { decision: o.op, reason: 'Property test' });
              break;
            }
          }
          if (res.status === 201) requests.push((res.body as { request: MyStaffRequestDto }).request.id);
          const ok = res.status === 200 || res.status === 201;
          if (ok && isApproval) tally.approved += 1;
          if (res.status === 201 && o.op === 'raise_swap') tally.swapsRaised += 1;
          if (!ok) tally.refused += 1;
          expect([200, 201, 404, 409, 422]).toContain(res.status);
          // P7: exactly one audit event per committed request or decision, none for a refused one.
          expect(await auditCount()).toBe(audits + (ok ? 1 : 0));
          // P19: only a successful approval changes the roster.
          if (!(ok && isApproval)) expect(await fingerprint(ids)).toBe(before);
        }
        // Every approval left its trace: a request-driven change exists only for approved requests.
        expect(
          await count(
            `SELECT 1 FROM shift_override o JOIN staff_request r ON r.id = o.staff_request_id WHERE r.id = ANY($1::uuid[]) AND r.status <> 'approved'`,
            [requests],
          ),
        ).toBe(0);
      }),
      { numRuns: 10 },
    );
    // The property exercised real approvals, swaps and refusals, not only no-ops.
    expect(tally.approved).toBeGreaterThan(0);
    expect(tally.swapsRaised).toBeGreaterThan(0);
    expect(tally.refused).toBeGreaterThan(0);
  });
});

describe('scope and guards', () => {
  it('HR and Planners read the store panel; only the store’s manager decides', async () => {
    expect((await call(hr, 'GET', `/stores/${w.stores.qc}/staff-requests`)).status).toBe(200);
    expect((await call(stm.MEGA, 'GET', `/stores/${w.stores.qc}/staff-requests`)).status).toBe(404);
    expect((await call(pln, 'POST', '/me/requests', { body: { type: 'time_off', dateFrom: '2030-12-01', dateTo: '2030-12-01' } })).status).toBe(403);
  });
});
