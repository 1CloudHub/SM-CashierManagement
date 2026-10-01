/**
 * Journey J1 — headcount, budget and plan approval (design.md › User
 * journeys; Req 9; P3, P7, P10, P12).
 *
 * On the seeded demo network: the Planner submits a new Christmas 2026
 * scenario; HR approves headcount, Finance approves budget and the Executive
 * approves the plan, which publishes it and supersedes the seeded published
 * plan. A second submission takes the off-system path (the Executive records
 * the budget as secured outside the system) and supersedes the first. The
 * plan is refused until both headcount and budget are secured (P10), the
 * season never has more than one published plan (P3), each action writes
 * exactly one audit event naming the user and the role they acted in (P7,
 * P12), and a user acting in a role without the permission is refused.
 */
import type { ApprovalDetail, ApprovalQueueItem, ScenarioDetail } from '@lanewise/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_SEASON, demoId, demoUserId } from '../../src/db/demo/dataset.js';
import { setupJourney, type Journey } from './support.js';

let j: Journey;
const SEEDED_PUBLISHED = demoId('scenario', DEMO_SEASON);

beforeAll(async () => {
  j = await setupJourney();
}, 120_000);

afterAll(async () => {
  await j?.dispose();
});

const publishedInSeason = () => j.count(`SELECT 1 FROM scenario WHERE season = $1 AND status = 'published'`, [DEMO_SEASON]);
const statuses = (d: ApprovalDetail) => d.steps.map((s) => s.status);

/** The Planner creates, runs and submits a scenario — one audit event per step. */
async function plannerSubmits(name: string): Promise<string> {
  const pln = { status: 201, userId: demoUserId('PLN'), role: 'PLN' as const };
  const { res: created } = await j.audited(pln, () => j.call('PLN', 'POST', '/scenarios', { body: { name, season: DEMO_SEASON } }));
  const id = (created.body.scenario as ScenarioDetail).id;
  expect((created.body.scenario as ScenarioDetail).synthetic).toBe(true); // demo inputs only (P18)
  await j.audited(pln, () => j.call('PLN', 'POST', `/scenarios/${id}/run`, { body: {} }));
  const { event } = await j.audited({ ...pln, status: 200 }, () => j.call('PLN', 'POST', `/scenarios/${id}/submit`, { body: {} }));
  expect(event?.action).toBe('submit');
  return id;
}

describe('J1 — HR, Finance, then the Executive (in-system decisions)', () => {
  let id: string;

  it('the Planner submits; HR, Finance and the Executive see it awaiting them; others cannot see the queue', async () => {
    expect(await publishedInSeason()).toBe(1);
    id = await plannerSubmits('Christmas 2026 v2');
    for (const role of ['HR', 'FIN', 'EXE'] as const) {
      const queue = await j.call(role, 'GET', '/approvals');
      expect(queue.status, role).toBe(200);
      const item = (queue.body.approvals as ApprovalQueueItem[]).find((x) => x.scenarioId === id);
      expect(item, role).toMatchObject({ status: 'submitted', submissionNo: 1, planReady: false, awaitingYou: true });
    }
    for (const role of ['PLN', 'STM', 'RST', 'STF', 'ADM'] as const) expect((await j.call(role, 'GET', '/approvals')).status, role).toBe(403);
  });

  it('refuses the plan while headcount and budget are pending (P10), writing nothing', async () => {
    const { res } = await j.audited({ status: 409 }, () => j.call('EXE', 'POST', `/approvals/${id}/plan`, { body: { decision: 'approve' } }));
    expect(res.body.error).toMatchObject({ code: 'conflict', details: [{ path: 'blocker', message: 'not_ready' }] });
  });

  it('P12: the same users acting in a role without the approval permission are refused', async () => {
    // Demo role switcher: the HR user may act as Planner, but a Planner can't approve headcount.
    await j.audited({ status: 403 }, () => j.as(j.emails.HR, 'PLN', 'POST', `/approvals/${id}/headcount`, { body: { decision: 'approve' } }));
    // Finance can't approve headcount, HR can't approve budget, the Planner can't publish.
    await j.audited({ status: 403 }, () => j.call('FIN', 'POST', `/approvals/${id}/headcount`, { body: { decision: 'approve' } }));
    await j.audited({ status: 403 }, () => j.call('HR', 'POST', `/approvals/${id}/budget`, { body: { decision: 'approve' } }));
    await j.audited({ status: 403 }, () => j.call('PLN', 'POST', `/approvals/${id}/plan`, { body: { decision: 'approve' } }));
    // Without the role switcher, a role the user doesn't hold can't be made active at all.
    await j.audited({ status: 403 }, () =>
      j.as(j.emails.EXE, 'HR', 'POST', `/approvals/${id}/headcount`, { body: { decision: 'approve' }, strict: true }),
    );
  });

  it('HR approves headcount; the plan stays blocked until Finance approves the budget (P10)', async () => {
    const { res } = await j.audited({ status: 200, userId: demoUserId('HR'), role: 'HR' }, () =>
      j.call('HR', 'POST', `/approvals/${id}/headcount`, { body: { decision: 'approve', comment: 'Seasonal waves OK', submissionNo: 1 } }),
    );
    expect(statuses(res.body.approval as ApprovalDetail)).toEqual(['approved', 'pending', 'pending']);
    await j.audited({ status: 409 }, () => j.call('EXE', 'POST', `/approvals/${id}/plan`, { body: { decision: 'approve' } }));

    const fin = await j.audited({ status: 200, userId: demoUserId('FIN'), role: 'FIN' }, () =>
      j.call('FIN', 'POST', `/approvals/${id}/budget`, { body: { decision: 'approve', comment: 'Within budget' } }),
    );
    const ready = fin.res.body.approval as ApprovalDetail;
    expect(statuses(ready)).toEqual(['approved', 'approved', 'pending']);
    expect((await j.call('EXE', 'GET', `/approvals/${id}`)).body.approval).toMatchObject({ planReady: true });
    // A decided step is final.
    await j.audited({ status: 409 }, () => j.call('HR', 'POST', `/approvals/${id}/headcount`, { body: { decision: 'approve' } }));
  });

  it('the Executive approves the plan: published, the seeded plan superseded, one published plan for the season (P3)', async () => {
    const { res, event } = await j.audited({ status: 200, userId: demoUserId('EXE'), role: 'EXE' }, () =>
      j.call('EXE', 'POST', `/approvals/${id}/plan`, { body: { decision: 'approve', comment: 'Go' } }),
    );
    expect(event).toMatchObject({ action: 'publish', event: 'scenario.published', object_id: id });
    const done = res.body.approval as ApprovalDetail;
    expect(done.scenario.status).toBe('published');
    expect(statuses(done)).toEqual(['approved', 'approved', 'approved']);
    expect((await j.one<{ status: string }>('SELECT status FROM scenario WHERE id = $1', [SEEDED_PUBLISHED])).status).toBe('superseded');
    expect(await publishedInSeason()).toBe(1);

    // Store Managers see published scenarios only: the new plan, not the superseded one.
    const stm = await j.call('STM', 'GET', '/scenarios', { query: { season: DEMO_SEASON } });
    expect(stm.status).toBe(200);
    expect(stm.body.scenarios.map((s: { id: string }) => s.id)).toEqual([id]);
    // Published settings are read-only (P4).
    await j.audited({ status: 409 }, () => j.call('PLN', 'PATCH', `/scenarios/${id}`, { body: { name: 'Renamed after publish' } }));
  });
});

describe('J1 — the Executive records the budget as secured outside the system', () => {
  let id: string;
  let first: string;

  it('a second submission: HR approves (acting via the role switcher), the Executive records the budget off-system', async () => {
    first = (await j.one<{ id: string }>(`SELECT id FROM scenario WHERE season = $1 AND status = 'published'`, [DEMO_SEASON])).id;
    id = await plannerSubmits('Christmas 2026 v3');

    // P12: the audit row records the user and the role they acted in — here the
    // Executive user acting as HR (demo role switcher) approves headcount.
    await j.audited({ status: 200, userId: demoUserId('EXE'), role: 'HR' }, () =>
      j.as(j.emails.EXE, 'HR', 'POST', `/approvals/${id}/headcount`, { body: { decision: 'approve' } }),
    );
    // Off-system needs a reference and a note; Finance can't record it.
    await j.audited({ status: 422 }, () => j.call('EXE', 'POST', `/approvals/${id}/secured-outside`, { body: { step: 'budget', reference: 'email' } }));
    await j.audited({ status: 403 }, () =>
      j.call('FIN', 'POST', `/approvals/${id}/secured-outside`, { body: { step: 'budget', reference: 'email', note: 'ok' } }),
    );
    const { res } = await j.audited({ status: 200, userId: demoUserId('EXE'), role: 'EXE' }, () =>
      j.call('EXE', 'POST', `/approvals/${id}/secured-outside`, {
        body: { step: 'budget', reference: 'CFO email, 2 Oct', note: 'Agreed with the CFO' },
      }),
    );
    expect(statuses(res.body.approval as ApprovalDetail)).toEqual(['approved', 'secured_outside', 'pending']);
    // HR and Finance see the off-system record.
    for (const role of ['HR', 'FIN'] as const) {
      const d = (await j.call(role, 'GET', `/approvals/${id}`)).body.approval as ApprovalDetail;
      expect(d.steps[1]).toMatchObject({ status: 'secured_outside', decidedAsRole: 'EXE', outside: { reference: 'CFO email, 2 Oct' } });
    }
  });

  it('publishing supersedes the previous published plan; still exactly one published per season (P3)', async () => {
    await j.audited({ status: 200, userId: demoUserId('EXE'), role: 'EXE', event: 'scenario.published' }, () =>
      j.call('EXE', 'POST', `/approvals/${id}/plan`, { body: { decision: 'approve' } }),
    );
    const { rows } = await j.pool.query<{ id: string; status: string }>(`SELECT id, status FROM scenario WHERE id = ANY($1::uuid[])`, [[id, first]]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({ [id]: 'published', [first]: 'superseded' });
    expect(await publishedInSeason()).toBe(1);
    // The database backstop: a second published plan for the season is refused.
    await expect(j.pool.query(`UPDATE scenario SET status = 'published', published_at = now() WHERE id = $1`, [first])).rejects.toThrow();
  });
});
