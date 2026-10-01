/**
 * Journeys J4 (store manager handles an emergency off on the published
 * roster) and J10 (cover an open shift from nearby stores: offers with
 * first-acceptance-wins, and a store-to-store borrow request), on the seeded
 * demo network through the real routes (Req 7, 13, 14; P1, P7, P11, P12, P14,
 * P16, P17).
 *
 * Publishing a weekly roster has no API route (rosters come out of the
 * planning pipeline), so the week's published roster for the demo Store
 * Manager's store (SM Supermarket – Quezon City, Main lanes) is inserted as
 * test setup, as are Staff accounts for the cashiers who answer offers.
 */
import type { BorrowRequestDto, MyOfferDto, OfferCandidatesResponse, RosterDetail, ShiftOfferDto } from '@lanewise/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoId, demoUserId } from '../../src/db/demo/dataset.js';
import { insertShift, publishedRoster, setupJourney, staffAccount, type Journey } from './support.js';

let j: Journey;
const QC = demoId('store', 'smsm-qc');
const QC_MAIN = demoId('department', 'smsm-qc:main');
const LPC = demoId('store', 'svm-lpc'); // SaveMore – Las Piñas (NCR), also has Main lanes
const LPC_MAIN = demoId('department', 'svm-lpc:main');
const STM = { userId: demoUserId('STM'), role: 'STM' as const };
// A week far ahead of the clock (offers need a shift that hasn't started), Mon–Sun.
const WEEK = ['2030-12-16', '2030-12-17', '2030-12-18', '2030-12-19', '2030-12-20', '2030-12-21', '2030-12-22'] as const;
const day = (i: number) => WEEK[i] as string;

let rosterId: string;
let lpcRoster: string;
/** Four QC Main-lanes cashiers with no availability exception in the week. */
let cashiers: string[];
let c0: string[]; // cashier 0: Mon–Sat 09–18
let c1: string[]; // cashier 1: Mon–Wed 09–18
let openSunday: string;

const base = () => `/stores/${QC}/rosters/${rosterId}`;

beforeAll(async () => {
  j = await setupJourney();
  const { rows } = await j.pool.query<{ id: string }>(
    `SELECT s.id FROM staff s WHERE s.department_id = $1 AND s.active
        AND NOT EXISTS (SELECT 1 FROM staff_availability a WHERE a.staff_id = s.id
                         AND a.starts_at < '2030-12-23T00:00:00+08:00' AND a.ends_at > '2030-12-16T00:00:00+08:00')
      ORDER BY s.employee_no LIMIT 4`,
    [QC_MAIN],
  );
  cashiers = rows.map((r) => r.id);
  expect(cashiers).toHaveLength(4);
  rosterId = await publishedRoster(j.pool, QC, QC_MAIN, day(0), day(6));
  c0 = [];
  for (let d = 0; d < 6; d += 1) c0.push(await insertShift(j.pool, rosterId, QC_MAIN, cashiers[0] ?? null, day(d), 9, 18));
  c1 = [];
  for (let d = 0; d < 3; d += 1) c1.push(await insertShift(j.pool, rosterId, QC_MAIN, cashiers[1] ?? null, day(d), 9, 18));
  openSunday = await insertShift(j.pool, rosterId, QC_MAIN, null, day(6), 9, 18);
  lpcRoster = await publishedRoster(j.pool, LPC, LPC_MAIN, day(0), day(6));
}, 120_000);

afterAll(async () => {
  await j?.dispose();
});

const shiftStaff = async (id: string) => (await j.one<{ staff_id: string | null }>('SELECT staff_id FROM shift WHERE id = $1', [id])).staff_id;

describe('J4 — the Store Manager handles an emergency off', () => {
  it('opens the week’s published roster of their own store; other stores are 404 (P1)', async () => {
    const list = await j.call('STM', 'GET', `/stores/${QC}/rosters`);
    expect(list.status).toBe(200);
    expect(list.body.rosters.map((r: { id: string }) => r.id)).toContain(rosterId);
    const res = await j.call('STM', 'GET', base());
    expect(res.status).toBe(200);
    const detail = res.body as RosterDetail;
    expect(detail.canOverride).toBe(true);
    expect(detail.shifts).toHaveLength(10);
    expect(detail.shifts.find((x) => x.id === openSunday)).toMatchObject({ staffId: null, date: day(6) });

    // Another store's roster — by its own path or under the QC path — is the same 404 as a missing one.
    expect((await j.call('STM', 'GET', `/stores/${LPC}/rosters`)).status).toBe(404);
    expect((await j.call('STM', 'GET', `/stores/${LPC}/rosters/${lpcRoster}`)).status).toBe(404);
    expect((await j.call('STM', 'GET', `/stores/${QC}/rosters/${lpcRoster}`)).status).toBe(404);
    await j.audited({ status: 404 }, () => j.call('STM', 'POST', `/stores/${LPC}/rosters/${lpcRoster}/overrides`, { body: { type: 'remove', shiftId: c1[0] } }));
    // Staff never reach the store roster.
    expect((await j.call('STF', 'GET', base())).status).toBe(403);
  });

  it('demo role switcher: another user acting as Store Manager gets the demo store (QC) scope', async () => {
    const res = await j.as(j.emails.PLN, 'STM', 'GET', base());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as RosterDetail).canOverride).toBe(true);
    expect((await j.as(j.emails.PLN, 'STM', 'GET', `/stores/${LPC}/rosters`)).status).toBe(404);
  });

  it('P12: roles without "Edit shifts" are refused and nothing is written', async () => {
    const body = { type: 'emergency_off', shiftId: c0[2], replacementStaffId: cashiers[2], offReason: 'sickCall' };
    for (const role of ['PLN', 'EXE', 'HR', 'FIN', 'ADM', 'STF'] as const) {
      await j.audited({ status: 403 }, () => j.call(role, 'POST', `${base()}/overrides`, { body }));
    }
    // The Store Manager user acting as Planner is refused too (the Planner edits draft scenarios only).
    await j.audited({ status: 403 }, () => j.as(j.emails.STM, 'PLN', 'POST', `${base()}/overrides`, { body }));
    expect(await shiftStaff(c0[2] ?? '')).toBe(cashiers[0]);
  });

  it('marks an emergency off with a ranked replacement: reassigned, ✎, one override + one audit event (P7, P14)', async () => {
    const ranked = await j.call('STM', 'GET', `${base()}/shifts/${c0[2]}/replacements`);
    expect(ranked.status).toBe(200);
    const candidates = ranked.body.candidates as { staffId: string; check: { status: string } }[];
    expect(candidates.map((c) => c.staffId)).not.toContain(cashiers[0]);
    // Cashier 3 is kept for the 24-hour-rest step below.
    const replacement = candidates.find((c) => c.check.status === 'ok' && c.staffId !== cashiers[3])?.staffId;
    expect(replacement).toBeDefined();

    const { res, event } = await j.audited({ status: 201, ...STM, event: 'shift_override.emergency_off' }, () =>
      j.call('STM', 'POST', `${base()}/overrides`, {
        body: { type: 'emergency_off', shiftId: c0[2], replacementStaffId: replacement, offReason: 'sickCall' },
      }),
    );
    expect(res.body.override).toMatchObject({ type: 'emergency_off', fromStaffId: cashiers[0], toStaffId: replacement, offReason: 'sickCall' });
    expect(event?.object_id).toBe(res.body.override.id);
    const shift = (res.body.roster as RosterDetail).shifts.find((s) => s.id === c0[2]);
    expect(shift).toMatchObject({ staffId: replacement, edited: { type: 'emergency_off', by: 'Demo Store Manager' } });
    expect(await shiftStaff(c0[2] ?? '')).toBe(replacement);
  });

  it('with no cover the shift stays open and the planner is notified', async () => {
    await j.audited({ status: 201, ...STM }, () =>
      j.call('STM', 'POST', `${base()}/overrides`, { body: { type: 'emergency_off', shiftId: c1[2], replacementStaffId: null, offReason: 'family' } }),
    );
    expect(await shiftStaff(c1[2] ?? '')).toBeNull();
    expect(await j.count(`SELECT 1 FROM notification WHERE event = 'roster.unfilled_shift' AND user_id = $1`, [demoUserId('PLN')])).toBeGreaterThan(0);
  });

  it('a labor-rule breach needs a reason, recorded with the breach (P14)', async () => {
    // Cashier 1 ends Monday at midnight and starts 09:00 Tuesday: under the minimum rest.
    const change = { type: 'time_change', shiftId: c1[0], date: day(0), startMin: 14 * 60, endMin: 24 * 60 };
    const { res: refused } = await j.audited({ status: 422 }, () => j.call('STM', 'POST', `${base()}/overrides`, { body: change }));
    expect(JSON.stringify(refused.body)).toContain('body.reason');
    const { res } = await j.audited({ status: 201, ...STM }, () =>
      j.call('STM', 'POST', `${base()}/overrides`, { body: { ...change, reason: 'Inventory count overnight' } }),
    );
    expect(res.body.override.reason).toBe('Inventory count overnight');
    expect(res.body.override.ruleBreaches.map((b: { rule: string }) => b.rule)).toContain('MIN_REST');
  });

  it('a missed 24-hour rest after six days in a row is refused even with a reason (P14)', async () => {
    // Cashier 3 works Mon–Sat (morning cover shifts), then a Sunday shift would be a 7th day in a row.
    const c3 = cashiers[3] ?? '';
    for (let d = 0; d < 6; d += 1) {
      const add = { type: 'add', staffId: c3, departmentId: QC_MAIN, date: day(d), startMin: 7 * 60, endMin: 12 * 60 };
      const r = await j.call('STM', 'POST', `${base()}/overrides`, { body: { ...add, reason: 'Peak week cover' } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    for (const reason of [undefined, 'Short-staffed']) {
      await j.audited({ status: 409 }, () =>
        j.call('STM', 'POST', `${base()}/overrides`, {
          body: { type: 'add', staffId: c3, departmentId: QC_MAIN, date: day(6), startMin: 7 * 60, endMin: 12 * 60, ...(reason ? { reason } : {}) },
        }),
      );
    }
    const check = await j.call('STM', 'POST', `${base()}/overrides/check`, {
      body: { type: 'add', staffId: c3, departmentId: QC_MAIN, date: day(6), startMin: 7 * 60, endMin: 12 * 60 },
    });
    expect(check.body.check.status).toBe('blocked');
    expect(check.body.check.blocking.map((b: { rule: string }) => b.rule)).toContain('MANDATORY_REST');
  });
});

describe('J10 — cover an open shift: offers (P16, P17) and borrowing', () => {
  let shiftId: string;
  let picked: string[];
  const staffEmail = (i: number) => `j10.cashier${i}@smretail.com`;

  it('ranks only eligible cashiers for the open shift; an ineligible pick is refused and writes nothing (P16)', async () => {
    shiftId = await insertShift(j.pool, rosterId, QC_MAIN, null, day(5), 13, 17); // Saturday 1–5 PM
    const q = { mode: 'car', maxTravelMin: '60' };
    await j.audited({ status: 403 }, () => j.call('HR', 'POST', `/stores/${QC}/shifts/${shiftId}/offers`, { body: { staffIds: [cashiers[1]] } }));
    expect((await j.call('STM', 'GET', `/stores/${LPC}/shifts/${shiftId}/offer-candidates`, { query: q })).status).toBe(404);

    const res = await j.call('STM', 'GET', `/stores/${QC}/shifts/${shiftId}/offer-candidates`, { query: q });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as OfferCandidatesResponse;
    const ids = body.candidates.map((c) => c.staffId);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    // Cashier 0 already works 09–18 that Saturday: never a candidate.
    expect(ids).not.toContain(cashiers[0]);
    // Candidates are pseudonymised: no names.
    const { rows: names } = await j.pool.query<{ name: string }>('SELECT name FROM staff WHERE id = ANY($1::uuid[])', [ids]);
    for (const n of names) expect(JSON.stringify(body)).not.toContain(n.name);

    await j.audited({ status: 422 }, () =>
      j.call('STM', 'POST', `/stores/${QC}/shifts/${shiftId}/offers`, { body: { staffIds: [ids[0], cashiers[0]], mode: 'car', maxTravelMin: 60 } }),
    );
    expect(await j.count('SELECT 1 FROM shift_offer WHERE shift_id = $1', [shiftId])).toBe(0);

    // Prefer the store's own cashiers (their offers are never hidden by a travel limit).
    const own = body.candidates.filter((c) => c.homeStoreId === QC).map((c) => c.staffId);
    picked = (own.length >= 2 ? own : ids).slice(0, 2);
    for (const [i, id] of picked.entries()) await staffAccount(j.pool, id, staffEmail(i));
  });

  it('sends offers to two cashiers: one audit event; each sees only their own offer (P11)', async () => {
    const { res } = await j.audited({ status: 201, ...STM, event: 'shift_offer.sent' }, () =>
      j.call('STM', 'POST', `/stores/${QC}/shifts/${shiftId}/offers`, { body: { staffIds: picked, mode: 'car', maxTravelMin: 60 } }),
    );
    const offers = res.body.offers as ShiftOfferDto[];
    expect(offers.map((o) => o.staffId).sort()).toEqual([...picked].sort());
    for (const [i, id] of picked.entries()) {
      const mine = await j.as(staffEmail(i), 'STF', 'GET', '/me/offers');
      expect(mine.status).toBe(200);
      const list = mine.body.offers as MyOfferDto[];
      const own = offers.find((o) => o.staffId === id);
      const other = offers.find((o) => o.staffId !== id);
      expect(list.map((o) => o.id)).toContain(own?.id);
      expect(list.map((o) => o.id)).not.toContain(other?.id);
      // Another cashier's offer can't be answered (P11: the same 404 as a missing one).
      await j.audited({ status: 404 }, () => j.as(staffEmail(i), 'STF', 'POST', `/me/offers/${other?.id}/accept`));
    }
  });

  it('two cashiers accept: the first wins, the second is told the shift was just filled (P17)', async () => {
    const offers = (await j.call('STM', 'GET', `/stores/${QC}/offers`, { query: { shiftId } })).body.offers as ShiftOfferDto[];
    const offerOf = (i: number) => offers.find((o) => o.staffId === picked[i])?.id ?? '';
    // P12: the cashier's user acting as Store Manager has no "respond" permission.
    await j.audited({ status: 403 }, () => j.as(staffEmail(0), 'STM', 'POST', `/me/offers/${offerOf(0)}/accept`));

    const { res } = await j.audited({ status: 200, role: 'STF', event: 'shift_offer.accepted' }, () =>
      j.as(staffEmail(0), 'STF', 'POST', `/me/offers/${offerOf(0)}/accept`),
    );
    expect((res.body.offer as MyOfferDto).status).toBe('accepted');
    const { res: late } = await j.audited({ status: 409 }, () => j.as(staffEmail(1), 'STF', 'POST', `/me/offers/${offerOf(1)}/accept`));
    expect(late.body.error.message).toBe('This shift has just been filled.');

    expect(await shiftStaff(shiftId)).toBe(picked[0]);
    const { rows } = await j.pool.query<{ staff_id: string; status: string }>('SELECT staff_id, status FROM shift_offer WHERE shift_id = $1', [shiftId]);
    expect(Object.fromEntries(rows.map((r) => [r.staff_id, r.status]))).toEqual({ [picked[0] ?? '']: 'accepted', [picked[1] ?? '']: 'withdrawn' });
    expect(await j.count(`SELECT 1 FROM shift_override WHERE shift_id = $1 AND override_type = 'offer_fill'`, [shiftId])).toBe(1);
  });

  it('borrowing: QC asks Las Piñas; only the lending store decides; approval fills the shift', async () => {
    const open = await insertShift(j.pool, rosterId, QC_MAIN, null, day(4), 13, 17); // Friday 1–5 PM
    const { res } = await j.audited({ status: 201, ...STM, event: 'transfer_request.created' }, () =>
      j.call('STM', 'POST', `/stores/${QC}/borrow-requests`, { body: { fromStoreId: LPC, shiftIds: [open], note: 'Payday rush' } }),
    );
    const request = res.body.request as BorrowRequestDto;
    expect(request).toMatchObject({ status: 'pending', count: 1, toStoreName: 'SM Supermarket – Quezon City', fromStoreName: 'SaveMore – Las Piñas' });

    // The borrowing manager can't decide for the lending store (P1).
    await j.audited({ status: 404 }, () =>
      j.call('STM', 'POST', `/stores/${LPC}/borrow-requests/${request.id}/decision`, { body: { decision: 'decline' } }),
    );

    // The Administrator provisions the Las Piñas store manager (fake Cognito directory).
    const lending = 'j10.lpc.manager@smretail.com';
    const invite = await j.call('ADM', 'POST', '/admin/users', { body: { email: lending, name: 'LPC Manager', roles: ['STM'], scope: { type: 'store', storeIds: [LPC] } } });
    expect(invite.status, JSON.stringify(invite.body)).toBe(201);
    const lendingUserId = invite.body.user.id as string;

    const incoming = await j.as(lending, 'STM', 'GET', `/stores/${LPC}/borrow-requests`, { strict: true });
    expect(incoming.status).toBe(200);
    expect(incoming.body.incoming.map((r: { id: string }) => r.id)).toContain(request.id);
    // …and cannot see QC's rosters (P1).
    expect((await j.as(lending, 'STM', 'GET', `/stores/${QC}/rosters`, { strict: true })).status).toBe(404);

    const cands = await j.as(lending, 'STM', 'GET', `/stores/${LPC}/borrow-requests/${request.id}/candidates`, { strict: true });
    expect(cands.status, JSON.stringify(cands.body)).toBe(200);
    const lent = (cands.body.candidates as { staffId: string }[])[0]?.staffId;
    expect(lent).toBeDefined();
    const { res: decided } = await j.audited({ status: 200, userId: lendingUserId, role: 'STM', event: 'transfer_request.approved' }, () =>
      j.as(lending, 'STM', 'POST', `/stores/${LPC}/borrow-requests/${request.id}/decision`, { body: { decision: 'approve', staffIds: [lent] }, strict: true }),
    );
    expect((decided.body.request as BorrowRequestDto).status).toBe('approved');
    expect(await shiftStaff(open)).toBe(lent);

    // The receiving roster shows the borrowed cashier with home store and travel time.
    const detail = (await j.call('STM', 'GET', base())).body as RosterDetail;
    const borrowed = detail.staff.find((s) => s.id === lent);
    expect(borrowed?.borrowedFrom).toBe('SaveMore – Las Piñas');
    expect(detail.overrides.some((o) => o.shiftId === open && o.type === 'borrow_fill')).toBe(true);
  });
});
