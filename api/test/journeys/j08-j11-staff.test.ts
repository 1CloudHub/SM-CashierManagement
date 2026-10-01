/**
 * Journeys J8 (Staff checks their roster) and J11 (Staff time-off and swap
 * requests), as the seeded Staff persona (demo.cashier@smretail.com, linked to
 * the first QC Main-lanes cashier) on the seeded demo network, through the
 * real routes (Req 7.3/7.4, 15; P1, P7, P11, P12, P19).
 *
 * The published weekly roster has no API route (rosters come out of the
 * planning pipeline), so it is inserted as test setup, as is a Staff account
 * for one colleague.
 */
import type { MyRosterResponse, MyStaffRequestDto, StoreStaffRequestDto } from '@lanewise/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoId, demoUserId } from '../../src/db/demo/dataset.js';
import { insertShift, publishedRoster, setupJourney, staffAccount, type Journey } from './support.js';

let j: Journey;
const QC = demoId('store', 'smsm-qc');
const LPC = demoId('store', 'svm-lpc');
const QC_MAIN = demoId('department', 'smsm-qc:main');
const PERSONA = demoId('staff', 'smsm-qc:main:ft-001');
const COLLEAGUE = demoId('staff', 'smsm-qc:main:ft-002');
const COLLEAGUE_EMAIL = 'j11.colleague@smretail.com';
const STF = { userId: demoUserId('STF'), role: 'STF' as const };
const STM = { userId: demoUserId('STM'), role: 'STM' as const };
// A week far ahead of the clock (requests can't start in the past), Mon–Sun.
const FROM = '2030-02-04';
const TO = '2030-02-10';

let rosterId: string;
const s = {} as Record<'tue' | 'thu' | 'sat' | 'colWed' | 'colFri' | 'openMon', string>;
let colleague: { name: string; employeeNo: string };

beforeAll(async () => {
  j = await setupJourney();
  rosterId = await publishedRoster(j.pool, QC, QC_MAIN, FROM, TO);
  s.tue = await insertShift(j.pool, rosterId, QC_MAIN, PERSONA, '2030-02-05', 15, 21);
  s.thu = await insertShift(j.pool, rosterId, QC_MAIN, PERSONA, '2030-02-07', 10, 18);
  s.sat = await insertShift(j.pool, rosterId, QC_MAIN, PERSONA, '2030-02-09', 13, 17);
  s.colWed = await insertShift(j.pool, rosterId, QC_MAIN, COLLEAGUE, '2030-02-06', 9, 17);
  s.colFri = await insertShift(j.pool, rosterId, QC_MAIN, COLLEAGUE, '2030-02-08', 9, 17);
  s.openMon = await insertShift(j.pool, rosterId, QC_MAIN, null, '2030-02-04', 15, 19);
  colleague = await j.one<{ name: string; employeeNo: string }>('SELECT name, employee_no AS "employeeNo" FROM staff WHERE id = $1', [COLLEAGUE]);
  await staffAccount(j.pool, COLLEAGUE, COLLEAGUE_EMAIL);
}, 120_000);

afterAll(async () => {
  await j?.dispose();
});

/** Everything P19 says must not move: the roster's shifts and the persona's availability. */
async function rosterState(): Promise<string> {
  const row = await j.one<{ shifts: string; avail: number }>(
    `SELECT (SELECT string_agg(id || ':' || coalesce(staff_id::text, '-') || ':' || starts_at || ':' || ends_at || ':' || status, ',' ORDER BY id)
               FROM shift WHERE roster_id = $1) AS shifts,
            (SELECT count(*)::int FROM staff_availability WHERE staff_id = $2) AS avail`,
    [rosterId, PERSONA],
  );
  return `${row.shifts}|${row.avail}`;
}

const myRoster = async (from = FROM, to = TO) => {
  const res = await j.call('STF', 'GET', '/me/roster', { query: { from, to } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as MyRosterResponse;
};

describe('J8 — the Staff persona checks their roster', () => {
  it('the Store Manager moves the Saturday shift; the cashier sees the new time and the previous one', async () => {
    await j.audited({ status: 201, ...STM }, () =>
      j.call('STM', 'POST', `/stores/${QC}/rosters/${rosterId}/overrides`, {
        body: { type: 'time_change', shiftId: s.sat, date: '2030-02-09', startMin: 12 * 60, endMin: 18 * 60, reason: 'Peak cover' },
      }),
    );
    const roster = await myRoster();
    expect(roster.staff.id).toBe(PERSONA);
    const sat = roster.days.find((d) => d.date === '2030-02-09')?.shifts[0];
    expect(sat).toMatchObject({ id: s.sat, startMin: 720, endMin: 1080, changed: { type: 'time_change', previous: { startMin: 780, endMin: 1020 } } });
    expect(await j.count(`SELECT 1 FROM notification WHERE user_id = $1 AND event = 'shift.changed'`, [demoUserId('STF')])).toBeGreaterThan(0);
  });

  it('P11: only their own shifts — no colleague’s name, id, employee number, shift or cost', async () => {
    const roster = await myRoster();
    const shiftIds = roster.days.flatMap((d) => d.shifts.map((x) => x.id)).sort();
    expect(shiftIds).toEqual([s.tue, s.thu, s.sat].sort());
    const text = JSON.stringify(roster);
    for (const leak of [colleague.name, colleague.employeeNo, COLLEAGUE, s.colWed, s.colFri, s.openMon]) expect(text).not.toContain(leak);
    expect(text).not.toMatch(/"cost"|"pay"|"wage"/i);
    expect(roster.days.find((d) => d.date === '2030-02-04')).toMatchObject({ shifts: [], absence: 'rest' });
  });

  it('P12: My roster is for the Staff role only; another role of the same user is refused', async () => {
    expect((await j.as(j.emails.STF, 'STM', 'GET', '/me/roster')).status).toBe(403);
    for (const role of ['STM', 'PLN', 'HR', 'ADM'] as const) expect((await j.call(role, 'GET', '/me/roster')).status, role).toBe(403);
    // Without the role switcher, the cashier can't make a manager role active at all.
    expect((await j.as(j.emails.STF, 'STM', 'GET', `/stores/${QC}/rosters`, { strict: true })).status).toBe(403);
    // And the cashier can't open the store roster as Staff.
    expect((await j.call('STF', 'GET', `/stores/${QC}/rosters/${rosterId}`)).status).toBe(403);
  });

  it('demo role switcher: another user switching to Staff sees the seeded demo cashier', async () => {
    const res = await j.as(j.emails.PLN, 'STF', 'GET', '/me/roster', { query: { from: FROM, to: TO } });
    expect(res.status).toBe(200);
    expect((res.body as MyRosterResponse).staff.id).toBe(PERSONA);
  });
});

describe('J11 — time-off and swap requests', () => {
  it('time off: pending leaves the roster unchanged (P19); a colleague can’t touch it; a decline changes nothing', async () => {
    const before = await rosterState();
    const { res } = await j.audited({ status: 201, ...STF }, () =>
      j.call('STF', 'POST', '/me/requests', { body: { type: 'time_off', dateFrom: '2030-02-07', dateTo: '2030-02-07', reason: 'family', note: 'Wedding' } }),
    );
    const req = res.body.request as MyStaffRequestDto;
    expect(req).toMatchObject({ type: 'time_off', status: 'pending' });
    expect(await rosterState()).toBe(before);
    expect((await myRoster('2030-02-07', '2030-02-07')).days[0]?.shifts[0]?.pendingRequestId).toBe(req.id);

    // Another cashier's request is a 404 (P11); other roles can't decide; another store's path is a 404 (P1).
    await j.audited({ status: 404 }, () => j.as(COLLEAGUE_EMAIL, 'STF', 'POST', `/me/requests/${req.id}/cancel`));
    expect(((await j.as(COLLEAGUE_EMAIL, 'STF', 'GET', '/me/requests')).body.requests as unknown[]).length).toBe(0);
    await j.audited({ status: 403 }, () => j.call('STF', 'POST', `/stores/${QC}/staff-requests/${req.id}/decision`, { body: { decision: 'approve' } }));
    await j.audited({ status: 403 }, () => j.call('PLN', 'POST', `/stores/${QC}/staff-requests/${req.id}/decision`, { body: { decision: 'approve' } }));
    await j.audited({ status: 404 }, () => j.call('STM', 'POST', `/stores/${LPC}/staff-requests/${req.id}/decision`, { body: { decision: 'approve' } }));

    const panel = (await j.call('STM', 'GET', `/stores/${QC}/staff-requests`)).body.requests as StoreStaffRequestDto[];
    expect(panel.find((r) => r.id === req.id)).toMatchObject({ staff: { id: PERSONA }, status: 'pending', shiftsLeftOpen: 1 });

    const { res: declined } = await j.audited({ status: 200, ...STM }, () =>
      j.call('STM', 'POST', `/stores/${QC}/staff-requests/${req.id}/decision`, { body: { decision: 'decline', note: 'Need cover that day' } }),
    );
    expect(declined.body.request).toMatchObject({ status: 'declined', decisionNote: 'Need cover that day' });
    expect(await rosterState()).toBe(before);
    const mine = (await j.call('STF', 'GET', '/me/requests')).body.requests as MyStaffRequestDto[];
    expect(mine.find((r) => r.id === req.id)?.status).toBe('declined');
  });

  it('time off approved: the cashier is unavailable and the shift is left open, flagged to the store', async () => {
    const { res } = await j.audited({ status: 201, ...STF }, () =>
      j.call('STF', 'POST', '/me/requests', { body: { type: 'time_off', dateFrom: '2030-02-07', dateTo: '2030-02-07', reason: 'family' } }),
    );
    const id = (res.body.request as MyStaffRequestDto).id;
    await j.audited({ status: 200, ...STM, event: 'staff_request.approved' }, () =>
      j.call('STM', 'POST', `/stores/${QC}/staff-requests/${id}/decision`, { body: { decision: 'approve' } }),
    );
    expect((await j.one<{ staff_id: string | null }>('SELECT staff_id FROM shift WHERE id = $1', [s.thu])).staff_id).toBeNull();
    const thu = (await myRoster('2030-02-07', '2030-02-07')).days[0];
    expect(thu).toMatchObject({ shifts: [], absence: 'unavailable', removed: [{ shiftId: s.thu, type: 'time_off' }] });
  });

  it('swap into an open shift: unchanged while pending (P19), applied on approval', async () => {
    const options = (await j.call('STF', 'GET', '/me/requests/swap-options')).body;
    expect(options.mine.map((x: { shiftId: string }) => x.shiftId)).toContain(s.tue);
    expect(options.open.map((x: { shiftId: string }) => x.shiftId)).toContain(s.openMon);
    expect(JSON.stringify(options)).not.toContain(colleague.name);

    const before = await rosterState();
    const { res } = await j.audited({ status: 201, ...STF }, () =>
      j.call('STF', 'POST', '/me/requests', { body: { type: 'swap', offeredShiftId: s.tue, targetShiftId: s.openMon, note: 'Exam on Tuesday' } }),
    );
    const req = res.body.request as MyStaffRequestDto;
    expect(req).toMatchObject({ type: 'swap', status: 'pending', target: { shiftId: s.openMon, kind: 'open' } });
    expect(await rosterState()).toBe(before);

    await j.audited({ status: 200, ...STM }, () => j.call('STM', 'POST', `/stores/${QC}/staff-requests/${req.id}/decision`, { body: { decision: 'approve' } }));
    expect((await j.one<{ staff_id: string | null }>('SELECT staff_id FROM shift WHERE id = $1', [s.tue])).staff_id).toBeNull();
    expect((await j.one<{ staff_id: string | null }>('SELECT staff_id FROM shift WHERE id = $1', [s.openMon])).staff_id).toBe(PERSONA);
    expect(await j.count(`SELECT 1 FROM shift_override WHERE staff_request_id = $1 AND override_type = 'swap'`, [req.id])).toBe(2);
    const shiftIds = (await myRoster()).days.flatMap((d) => d.shifts.map((x) => x.id));
    expect(shiftIds).toContain(s.openMon);
    expect(shiftIds).not.toContain(s.tue);
  });

  it('a swap with a colleague never names them to the requester; cancelling changes nothing', async () => {
    const before = await rosterState();
    const { res } = await j.audited({ status: 201, ...STF }, () =>
      j.call('STF', 'POST', '/me/requests', { body: { type: 'swap', offeredShiftId: s.sat, targetShiftId: s.colFri } }),
    );
    const req = res.body.request as MyStaffRequestDto;
    expect(req.target?.kind).toBe('colleague');
    expect(JSON.stringify(res.body)).not.toContain(colleague.name);
    await j.audited({ status: 200, ...STF }, () => j.call('STF', 'POST', `/me/requests/${req.id}/cancel`));
    expect(await rosterState()).toBe(before);
    await j.audited({ status: 409 }, () => j.call('STM', 'POST', `/stores/${QC}/staff-requests/${req.id}/decision`, { body: { decision: 'approve' } }));
  });
});
