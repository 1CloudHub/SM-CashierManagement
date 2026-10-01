/**
 * `/stores/:storeId/rosters` routes and store-manager overrides (task 13.4;
 * Req 6.6/6.7, 7; P1, P7, P12, P14).
 *
 * Real PostgreSQL seeded with the task 23 demo network (one user per role),
 * plus a published roster for the Store Manager's store, called through the
 * app router with the real RBAC enforcer.
 */
import { localToInstant, type RoleCode, type RosterDetail, type ShiftOverrideRequest } from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkLaborRules, DEMO_LABOR_RULES } from '@lanewise/domain';
import { createApp } from '../../src/app.js';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import { demoUserId } from '../../src/db/demo/dataset.js';
import { seedDemoData } from '../../src/db/demo/seed.js';
import { laborRulesFor } from '../../src/db/repositories/rosters.js';
import type { Router } from '../../src/http/router.js';
import { toAssignedShift } from '../../src/rosters/overrides.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { dispatch, identity, type TestResponse } from '../support/dispatch.js';
import { MemoryStorage } from '../support/memory-storage.js';

let db: TestDatabase;
let app: Router;
const emails = {} as Record<RoleCode, string>;
let storeId: string;
let otherStoreId: string;
let departmentId: string;
let cashiers: string[];
let cashierUserId: string;
let rosterId: string;

const PERIOD_START = '2026-12-14';
const day = (d: number) => `2026-12-${String(14 + d).padStart(2, '0')}`;

async function call(role: RoleCode, method: string, path: string, body?: unknown): Promise<TestResponse> {
  return dispatch(app, method, path, { identity: identity(emails[role]), role, ...(body === undefined ? {} : { body }) });
}

const base = () => `/stores/${storeId}/rosters/${rosterId}`;

async function counts() {
  const { rows } = await db.pool.query<{ audit: number; overrides: number; notifications: number; shifts: string }>(
    `SELECT (SELECT count(*) FROM audit_event)::int AS audit,
            (SELECT count(*) FROM shift_override)::int AS overrides,
            (SELECT count(*) FROM notification)::int AS notifications,
            (SELECT string_agg(id || coalesce(staff_id::text, '-') || starts_at || ends_at || status, ',' ORDER BY id)
               FROM shift WHERE roster_id = $1) AS shifts`,
    [rosterId],
  );
  return rows[0];
}

async function insertShift(staffId: string | null, d: number, startH = 9, hours = 9): Promise<string> {
  const { rows } = await db.pool.query<{ id: string }>(
    `INSERT INTO shift (roster_id, staff_id, department_id, starts_at, ends_at, synthetic)
     VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
    [rosterId, staffId, departmentId, localToInstant(day(d), startH * 60), localToInstant(day(d), (startH + hours) * 60)],
  );
  return rows[0]?.id ?? '';
}

/** A fresh published roster for the week: cashier 0 works Mon–Sat, cashier 1 Mon–Wed, one open Sunday shift. */
async function freshRoster(): Promise<{ sunday: string; c0: string[]; c1: string[] }> {
  await db.pool.query(`UPDATE roster SET status = 'superseded' WHERE store_id = $1 AND status = 'published'`, [storeId]);
  const { rows } = await db.pool.query<{ id: string }>(
    `INSERT INTO roster (store_id, department_id, period_start, period_end, status, published_at, synthetic)
     VALUES ($1, $2, $3, '2026-12-20', 'published', now(), true) RETURNING id`,
    [storeId, departmentId, PERIOD_START],
  );
  rosterId = rows[0]?.id ?? '';
  const c0 = [];
  for (let d = 0; d < 6; d += 1) c0.push(await insertShift(cashiers[0] ?? null, d));
  const c1 = [];
  for (let d = 0; d < 3; d += 1) c1.push(await insertShift(cashiers[1] ?? null, d));
  return { sunday: await insertShift(null, 6), c0, c1 };
}

beforeAll(async () => {
  db = await createTestDatabase();
  await seedDemoData(db.pool);
  const { rows } = await db.pool.query<{ id: string; email: string }>('SELECT id, email FROM app_user');
  for (const role of ['ADM', 'EXE', 'PLN', 'STM', 'HR', 'FIN', 'RST', 'STF'] as const) {
    const user = rows.find((r) => r.id === demoUserId(role));
    if (!user) throw new Error(`demo user for ${role} missing`);
    emails[role] = user.email;
  }
  const stm = await db.pool.query<{ scope_ids: string[] }>(`SELECT scope_ids FROM role_assignment WHERE user_id = $1 AND role = 'STM'`, [
    demoUserId('STM'),
  ]);
  storeId = stm.rows[0]?.scope_ids[0] ?? '';
  const other = await db.pool.query<{ id: string }>(`SELECT id FROM store WHERE id <> $1 AND synthetic LIMIT 1`, [storeId]);
  otherStoreId = other.rows[0]?.id ?? '';
  const dept = await db.pool.query<{ department_id: string }>(
    `SELECT department_id FROM staff WHERE store_id = $1 AND active GROUP BY department_id HAVING count(*) >= 4
      ORDER BY count(*) DESC, department_id LIMIT 1`,
    [storeId],
  );
  departmentId = dept.rows[0]?.department_id ?? '';
  const staff = await db.pool.query<{ id: string; user_id: string | null }>(
    `SELECT id, user_id FROM staff WHERE store_id = $1 AND department_id = $2 AND active ORDER BY employee_no LIMIT 4`,
    [storeId, departmentId],
  );
  cashiers = staff.rows.map((s) => s.id);
  // Give cashier 0 an account so the change notification can be checked (P11: their own shift only).
  const user = await db.pool.query<{ id: string }>(
    `INSERT INTO app_user (email, name) VALUES ('roster.cashier@smretail.com', 'Roster Cashier') RETURNING id`,
  );
  cashierUserId = user.rows[0]?.id ?? '';
  await db.pool.query(`UPDATE staff SET user_id = NULL WHERE user_id = $1`, [cashierUserId]);
  if (staff.rows[0]?.user_id === null) await db.pool.query(`UPDATE staff SET user_id = $2 WHERE id = $1`, [cashiers[0], cashierUserId]);
  else cashierUserId = staff.rows[0]?.user_id ?? '';
  app = createApp({ db: () => db.pool, rbac: DEFAULT_RBAC_CONFIG, storage: () => new MemoryStorage() });
}, 120_000);

afterAll(async () => {
  await db?.dispose();
});

let roster: Awaited<ReturnType<typeof freshRoster>>;
beforeEach(async () => {
  roster = await freshRoster();
});

describe('reading a published roster (Req 6.6/6.7; P1, P12)', () => {
  it('lists and returns the roster to roles with the Weekly roster row, scoped to the store', async () => {
    for (const role of ['STM', 'PLN', 'EXE', 'HR', 'FIN'] as const) {
      const list = await call(role, 'GET', `/stores/${storeId}/rosters`);
      expect(list.status, role).toBe(200);
      expect(list.body.rosters.map((r: { id: string }) => r.id)).toContain(rosterId);
    }
    const res = await call('STM', 'GET', base());
    expect(res.status).toBe(200);
    const detail = res.body as RosterDetail;
    expect(detail.canOverride).toBe(true);
    expect(detail.shifts).toHaveLength(10);
    expect(detail.shifts.find((s) => s.id === roster.sunday)).toMatchObject({ staffId: null, date: day(6), startMin: 540, endMin: 1080 });
    expect(detail.staff.map((s) => s.id)).toEqual(expect.arrayContaining(cashiers));
    // The roster starts clean of blocks; warnings (e.g. a seasonal cashier's weekly cap) are listed for the roster's cashiers.
    expect(detail.laborChecks.filter((c) => c.severity === 'block')).toEqual([]);
    for (const c of detail.laborChecks) expect(cashiers).toContain(c.staffId);
    expect((await call('PLN', 'GET', base())).body.canOverride).toBe(false);
  });

  it('answers 404 for a store outside scope or a roster of another store, 403 without the matrix row', async () => {
    expect((await call('STM', 'GET', `/stores/${otherStoreId}/rosters`)).status).toBe(404);
    expect((await call('PLN', 'GET', `/stores/${otherStoreId}/rosters/${rosterId}`)).status).toBe(404);
    expect((await call('STF', 'GET', base())).status).toBe(403);
    expect((await call('RST', 'GET', base())).status).toBe(403);
  });
});

describe('store-manager overrides (Req 7; P7, P14)', () => {
  it('only the Store Manager records overrides; others are refused and nothing is written', async () => {
    const before = await counts();
    for (const role of ['PLN', 'EXE', 'HR', 'FIN', 'ADM', 'STF'] as const) {
      const res = await call(role, 'POST', `${base()}/overrides`, { type: 'remove', shiftId: roster.c1[0] });
      expect(res.status, role).toBe(403);
    }
    expect(await counts()).toEqual(before);
  });

  it('emergency off with a replacement: one override, one audit event, ✎ marker, cashier notified, unavailable', async () => {
    const before = await counts();
    const replacement = cashiers[2] ?? '';
    const res = await call('STM', 'POST', `${base()}/overrides`, {
      type: 'emergency_off',
      shiftId: roster.c0[2],
      replacementStaffId: replacement,
      offReason: 'sickCall',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const after = await counts();
    expect(after?.audit).toBe((before?.audit ?? 0) + 1);
    expect(after?.overrides).toBe((before?.overrides ?? 0) + 1);
    expect(res.body.override).toMatchObject({ type: 'emergency_off', fromStaffId: cashiers[0], toStaffId: replacement, offReason: 'sickCall', reason: null });
    const shift = (res.body.roster as RosterDetail).shifts.find((s) => s.id === roster.c0[2]);
    expect(shift?.staffId).toBe(replacement);
    expect(shift?.edited).toMatchObject({ type: 'emergency_off', by: 'Demo Store Manager' });

    const ev = await db.pool.query(`SELECT event, object_id, active_role FROM audit_event ORDER BY at DESC, id DESC LIMIT 1`);
    expect(ev.rows[0]).toMatchObject({ event: 'shift_override.emergency_off', object_id: res.body.override.id, active_role: 'STM' });
    const note = await db.pool.query(`SELECT event FROM notification WHERE user_id = $1 AND object_id = $2`, [cashierUserId, roster.c0[2]]);
    expect(note.rows.map((r) => r.event)).toEqual(['shift.changed']);
    const off = await db.pool.query(`SELECT count(*)::int AS n FROM staff_availability WHERE staff_id = $1 AND reason = 'emergency_off:sickCall'`, [
      cashiers[0],
    ]);
    expect(off.rows[0]?.n).toBeGreaterThan(0);
  });

  it('an emergency off without cover leaves the shift open and notifies planners', async () => {
    const res = await call('STM', 'POST', `${base()}/overrides`, {
      type: 'emergency_off',
      shiftId: roster.c1[0],
      replacementStaffId: null,
      offReason: 'family',
    });
    expect(res.status).toBe(201);
    const n = await db.pool.query(`SELECT count(*)::int AS n FROM notification WHERE event = 'roster.unfilled_shift' AND user_id = $1`, [
      demoUserId('PLN'),
    ]);
    expect(n.rows[0]?.n).toBeGreaterThan(0);
  });

  it('hard-blocks a missed 24-hour rest after 6 consecutive days, with or without a reason (P14)', async () => {
    const before = await counts();
    for (const reason of [undefined, 'Short-staffed']) {
      // A Sunday shift for cashier 0 would be a 7th working day in a row.
      const res = await call('STM', 'POST', `${base()}/overrides`, {
        type: 'add',
        staffId: cashiers[0],
        departmentId,
        date: day(6),
        startMin: 540,
        endMin: 1080,
        ...(reason ? { reason } : {}),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
    }
    const check = await call('STM', 'POST', `${base()}/overrides/check`, {
      type: 'add',
      staffId: cashiers[0],
      departmentId,
      date: day(6),
      startMin: 540,
      endMin: 1080,
    });
    expect(check.status).toBe(200);
    expect(check.body.check.status).toBe('blocked');
    expect(check.body.check.blocking.map((b: { rule: string }) => b.rule)).toContain('MANDATORY_REST');
    expect(await counts()).toEqual(before);
  });

  it('a labor-rule warning needs a reason, which is recorded with the breach and notifies Planner and HR', async () => {
    // Cashier 1 ends at midnight on Monday and starts 09:00 Tuesday: 9 h rest < 10 h minimum.
    const change = { type: 'time_change', shiftId: roster.c1[0], date: day(0), startMin: 14 * 60, endMin: 24 * 60 };
    const before = await counts();
    const refused = await call('STM', 'POST', `${base()}/overrides`, change);
    expect(refused.status).toBe(422);
    expect(await counts()).toEqual(before);

    const ok = await call('STM', 'POST', `${base()}/overrides`, { ...change, reason: 'Inventory count overnight' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.override.reason).toBe('Inventory count overnight');
    expect(ok.body.override.ruleBreaches.map((b: { rule: string }) => b.rule)).toEqual(['MIN_REST']);
    const n = await db.pool.query(
      `SELECT DISTINCT user_id FROM notification WHERE event = 'roster.rule_override' AND user_id = ANY($1::uuid[])`,
      [[demoUserId('PLN'), demoUserId('HR')]],
    );
    expect(n.rows).toHaveLength(2);
  });

  it('suggests ranked replacements with their rule check (Req 7.5)', async () => {
    const res = await call('STM', 'GET', `${base()}/shifts/${roster.c0[3]}/replacements`);
    expect(res.status).toBe(200);
    const ids = res.body.candidates.map((c: { staffId: string }) => c.staffId);
    expect(ids).not.toContain(cashiers[0]);
    expect(ids).toEqual(expect.arrayContaining([cashiers[2], cashiers[3]]));
    // Saveable candidates always come first.
    const order = { ok: 0, needsReason: 1, blocked: 2 } as const;
    const statuses = res.body.candidates.map((c: { check: { status: keyof typeof order } }) => order[c.check.status]);
    expect(statuses).toEqual([...statuses].sort((a: number, b: number) => a - b));
  });

  it('refuses a cashier from another store, an unknown shift and a draft roster', async () => {
    const foreign = await db.pool.query<{ id: string }>(`SELECT id FROM staff WHERE store_id = $1 LIMIT 1`, [otherStoreId]);
    expect(
      (await call('STM', 'POST', `${base()}/overrides`, { type: 'reassign', shiftId: roster.c1[0], toStaffId: foreign.rows[0]?.id })).status,
    ).toBe(422);
    expect(
      (await call('STM', 'POST', `${base()}/overrides`, { type: 'remove', shiftId: '6f1c7a52-0b8e-4d5e-9a41-5e2b1c9d7f00' })).status,
    ).toBe(422);
    await db.pool.query(`UPDATE roster SET status = 'draft', published_at = NULL WHERE id = $1`, [rosterId]);
    expect((await call('STM', 'POST', `${base()}/overrides`, { type: 'remove', shiftId: roster.c1[0] })).status).toBe(409);
  });

  it('overrides are append-only', async () => {
    const res = await call('STM', 'POST', `${base()}/overrides`, { type: 'remove', shiftId: roster.c1[2] });
    expect(res.status).toBe(201);
    await expect(db.pool.query(`UPDATE shift_override SET reason = 'x' WHERE id = $1`, [res.body.override.id])).rejects.toThrow(/append-only/);
  });
});

describe('P14 override traceability (property)', () => {
  /** A change addressing shifts by position (0–5 cashier 0, 6–8 cashier 1, 9 the open Sunday shift). */
  type Change = { readonly shift: number; readonly staff: number | null; readonly reason?: string } & (
    | { readonly type: 'reassign' | 'emergency_off' | 'remove' }
    | { readonly type: 'time_change' | 'add'; readonly day: number; readonly startH: number; readonly hours: number }
  );

  const changeArb: fc.Arbitrary<Change> = fc
    .record({
      type: fc.constantFrom('reassign', 'emergency_off', 'remove', 'time_change', 'add'),
      shift: fc.integer({ min: 0, max: 9 }),
      staff: fc.option(fc.integer({ min: 0, max: 3 }), { nil: null }),
      day: fc.integer({ min: 0, max: 6 }),
      startH: fc.integer({ min: 0, max: 16 }),
      hours: fc.integer({ min: 4, max: 10 }),
      reason: fc.option(fc.constantFrom('Cover for peak', '  '), { nil: undefined }),
    })
    .map((c) => (c.reason === undefined ? { ...c, reason: undefined } : c) as Change);

  function toRequest(c: Change, shifts: readonly string[]): ShiftOverrideRequest {
    const shiftId = shifts[c.shift] ?? '';
    const staffId = c.staff === null ? null : (cashiers[c.staff] ?? null);
    const reason = c.reason === undefined ? {} : { reason: c.reason };
    switch (c.type) {
      case 'reassign':
        return { type: 'reassign', shiftId, toStaffId: staffId ?? cashiers[3] ?? '', ...reason };
      case 'emergency_off':
        return { type: 'emergency_off', shiftId, replacementStaffId: staffId, offReason: 'sickCall', ...reason };
      case 'remove':
        return { type: 'remove', shiftId, ...reason };
      case 'time_change':
        return { type: 'time_change', shiftId, date: day(c.day), startMin: c.startH * 60, endMin: (c.startH + c.hours) * 60, ...reason };
      case 'add':
        return { type: 'add', staffId, departmentId, date: day(c.day), startMin: c.startH * 60, endMin: (c.startH + c.hours) * 60, ...reason };
    }
  }

  it('every saved change has one override + one audit event, breaches carry a reason, and no missed 24-hour rest is ever saved', async () => {
    const rules = await laborRulesFor(db.pool, true);
    expect(rules.restAfterConsecutiveDays).toBe(DEMO_LABOR_RULES.restAfterConsecutiveDays);
    await fc.assert(
      fc.asyncProperty(fc.array(changeArb, { minLength: 1, maxLength: 6 }), async (changes) => {
        const fresh = await freshRoster();
        const shifts = [...fresh.c0, ...fresh.c1, fresh.sunday];
        for (const c of changes) {
          const before = await counts();
          const res = await call('STM', 'POST', `${base()}/overrides`, toRequest(c, shifts));
          const after = await counts();
          if (res.status === 201) {
            expect(after?.audit).toBe((before?.audit ?? 0) + 1);
            expect(after?.overrides).toBe((before?.overrides ?? 0) + 1);
            const o = res.body.override;
            if (o.ruleBreaches.length > 0) expect(String(o.reason ?? '').trim().length).toBeGreaterThan(0);
            expect(o.ruleBreaches.every((b: { severity: string }) => b.severity === 'warning')).toBe(true);
          } else {
            expect([409, 422], JSON.stringify(res.body)).toContain(res.status);
            expect(after).toEqual(before);
          }
        }
        // No cashier is ever left without a 24-hour rest after 6 consecutive days (nor double-booked).
        const { rows } = await db.pool.query<{ id: string; staff_id: string; department_id: string; starts_at: Date; ends_at: Date }>(
          `SELECT sh.id, sh.staff_id, sh.department_id, sh.starts_at, sh.ends_at FROM shift sh JOIN roster r ON r.id = sh.roster_id
            WHERE r.status = 'published' AND sh.status = 'scheduled' AND sh.staff_id IS NOT NULL AND r.store_id = $1`,
          [storeId],
        );
        const assigned = rows.map((r) =>
          toAssignedShift({ id: r.id, staffId: r.staff_id, departmentId: r.department_id, startsAt: r.starts_at, endsAt: r.ends_at, activities: [] }, 'FT'),
        );
        expect(checkLaborRules(assigned, rules).filter((v) => v.severity === 'block')).toEqual([]);
      }),
      { numRuns: 15 },
    );
  }, 300_000);
});
