/**
 * `/approvals` routes (task 12; Req 9.1–9.7; P7, P10, P12).
 *
 * Runs against a real PostgreSQL seeded with the task 23 demo network (one
 * user per role, synthetic inputs, a published Christmas scenario), through
 * the app router with the real RBAC enforcer and cost shaping. The property
 * test drives random approval command sequences through HTTP and checks the
 * API against the shared reference model (`applyApprovalCommand`).
 */
import {
  APPROVAL_DECISIONS,
  APPROVAL_STEP_KINDS,
  APPROVER_ROLE_BY_STEP,
  ROLE_CODES,
  STEP_DECISIONS,
  applyApprovalCommand,
  isStepSecured,
  type ApprovalCommand,
  type ApprovalDetail,
  type ApprovalQueueItem,
  type ApprovalState,
  type RoleCode,
  type ScenarioDetail,
} from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import { DEMO_SEASON, demoId, demoUserId } from '../../src/db/demo/dataset.js';
import { seedDemoData } from '../../src/db/demo/seed.js';
import type { Router } from '../../src/http/router.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { dispatch, identity, type TestResponse } from '../support/dispatch.js';
import { insertSnapshot } from '../support/fixtures.js';
import { MemoryStorage } from '../support/memory-storage.js';

let db: TestDatabase;
let app: Router;
const emails = {} as Record<RoleCode, string>;
const DEMO_PUBLISHED_ID = demoId('scenario', DEMO_SEASON);

async function call(role: RoleCode, method: string, path: string, body?: unknown): Promise<TestResponse> {
  return dispatch(app, method, path, { identity: identity(emails[role]), role, ...(body === undefined ? {} : { body }) });
}

async function count(sql: string, values: unknown[] = []): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values);
  return rows[0]?.n ?? 0;
}
const auditCount = () => count('audit_event');

/** A run, submitted scenario (Planner). */
async function submitted(name: string): Promise<string> {
  const created = await call('PLN', 'POST', '/scenarios', { name, season: DEMO_SEASON });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = (created.body.scenario as ScenarioDetail).id;
  expect((await call('PLN', 'POST', `/scenarios/${id}/run`, {})).status).toBe(201);
  const res = await call('PLN', 'POST', `/scenarios/${id}/submit`, {});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return id;
}

async function tracker(id: string, role: RoleCode = 'EXE'): Promise<ApprovalDetail> {
  const res = await call(role, 'GET', `/approvals/${id}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.approval as ApprovalDetail;
}

const statuses = (d: ApprovalDetail) => d.steps.map((s) => s.status);

beforeAll(async () => {
  db = await createTestDatabase();
  await seedDemoData(db.pool);
  const { rows } = await db.pool.query<{ id: string; email: string }>('SELECT id, email FROM app_user');
  for (const role of ROLE_CODES) {
    const user = rows.find((r) => r.id === demoUserId(role));
    if (!user) throw new Error(`demo user for ${role} missing`);
    emails[role] = user.email;
  }
  app = createApp({ db: () => db.pool, rbac: DEFAULT_RBAC_CONFIG, storage: () => new MemoryStorage() });
}, 120_000);

afterAll(async () => {
  await db?.dispose();
});

describe('submit opens the approval tracker (Req 9.1)', () => {
  it('creates three pending steps, stamps the submitter and asks HR and Finance', async () => {
    const notesBefore = await count(`notification WHERE event IN ('approval.headcount_requested', 'approval.budget_requested')`);
    const id = await submitted('Tracker check');
    const d = await tracker(id);
    expect(d.submissionNo).toBe(1);
    expect(d.submittedBy).toEqual({ id: demoUserId('PLN'), name: expect.any(String) });
    expect(d.submittedAt).not.toBeNull();
    expect(d.steps.map((s) => [s.step, s.status, s.approverRole])).toEqual([
      ['headcount', 'pending', 'HR'],
      ['budget', 'pending', 'FIN'],
      ['plan', 'pending', 'EXE'],
    ]);
    expect(d.planReady).toBe(false);
    expect(d.checks).toEqual({ runComplete: true, notStale: true });
    // The season's published plan is the comparison baseline.
    expect(d.published).toEqual({ id: DEMO_PUBLISHED_ID, name: expect.any(String) });
    expect(d.changes?.headcount.b).toBeGreaterThan(0);
    expect(await count(`notification WHERE event IN ('approval.headcount_requested', 'approval.budget_requested')`)).toBeGreaterThan(notesBefore);

    // Executive: plan disabled, may record headcount/budget outside the system.
    expect(d.actions.decide).toEqual({ headcount: [], budget: [], plan: [] });
    expect(d.actions.recordOutside).toEqual(['headcount', 'budget']);
    expect(d.actions.blockers.plan).toBe('not_ready');
    expect((await tracker(id, 'HR')).actions.decide.headcount).toEqual(['approve', 'request_changes']);
    expect((await tracker(id, 'FIN')).actions.decide.budget).toEqual(['approve', 'request_changes']);

    for (const role of ['EXE', 'HR', 'FIN'] as const) {
      const queue = await call(role, 'GET', '/approvals');
      expect(queue.status).toBe(200);
      const item = (queue.body.approvals as ApprovalQueueItem[]).find((x) => x.scenarioId === id);
      expect(item).toMatchObject({ status: 'submitted', submissionNo: 1, planReady: false, awaitingYou: true });
    }
  });

  it('shows the queue and tracker only to the Executive, HR and Finance (P12)', async () => {
    const id = await submitted('Visibility check');
    for (const role of ['PLN', 'STM', 'ADM', 'RST', 'STF'] as const) {
      expect((await call(role, 'GET', '/approvals')).status).toBe(403);
      expect((await call(role, 'GET', `/approvals/${id}`)).status).toBe(403);
    }
  });
});

describe('decisions (Req 9.2–9.6, P7, P10, P12)', () => {
  it('lets only the step approver decide; refusals write nothing', async () => {
    const id = await submitted('Role check');
    const before = await auditCount();
    const wrong: [RoleCode, string, unknown][] = [
      ['FIN', 'headcount', { decision: 'approve' }],
      ['EXE', 'headcount', { decision: 'approve' }],
      ['HR', 'budget', { decision: 'approve' }],
      ['PLN', 'plan', { decision: 'approve' }],
      ['HR', 'plan', { decision: 'reject', comment: 'no' }],
      ['HR', 'secured-outside', { step: 'budget', reference: 'email', note: 'ok' }],
      ['FIN', 'secured-outside', { step: 'headcount', reference: 'email', note: 'ok' }],
    ];
    for (const [role, path, body] of wrong) {
      expect((await call(role, 'POST', `/approvals/${id}/${path}`, body)).status, `${role} ${path}`).toBe(403);
    }
    expect(await auditCount()).toBe(before);
    expect(statuses(await tracker(id))).toEqual(['pending', 'pending', 'pending']);
  });

  it('requires a comment to request changes or reject, and a reference and note off-system', async () => {
    const id = await submitted('Comment check');
    const before = await auditCount();
    expect((await call('HR', 'POST', `/approvals/${id}/headcount`, { decision: 'request_changes' })).status).toBe(422);
    expect((await call('FIN', 'POST', `/approvals/${id}/budget`, { decision: 'request_changes', comment: '   ' })).status).toBe(422);
    expect((await call('HR', 'POST', `/approvals/${id}/headcount`, { decision: 'reject', comment: 'x' })).status).toBe(422);
    expect((await call('EXE', 'POST', `/approvals/${id}/secured-outside`, { step: 'budget', reference: 'email' })).status).toBe(422);
    expect((await call('EXE', 'POST', `/approvals/${id}/secured-outside`, { step: 'plan', reference: 'x', note: 'y' })).status).toBe(422);
    expect(await auditCount()).toBe(before);
  });

  it('keeps the plan disabled until both are secured, then publishes and supersedes (P10, Req 9.5)', async () => {
    const id = await submitted('Christmas 2026 v4');
    const before = await auditCount();
    const early = await call('EXE', 'POST', `/approvals/${id}/plan`, { decision: 'approve' });
    expect(early.status).toBe(409);
    expect(early.body.error).toMatchObject({ code: 'conflict', details: [{ path: 'blocker', message: 'not_ready' }] });

    const hr = await call('HR', 'POST', `/approvals/${id}/headcount`, { decision: 'approve', comment: '251 seasonal, OK', submissionNo: 1 });
    expect(hr.status, JSON.stringify(hr.body)).toBe(200);
    expect((await call('EXE', 'POST', `/approvals/${id}/plan`, { decision: 'approve' })).status).toBe(409);
    const outside = await call('EXE', 'POST', `/approvals/${id}/secured-outside`, {
      step: 'budget',
      reference: 'email 2 Oct',
      note: 'Agreed with the CFO',
    });
    expect(outside.status, JSON.stringify(outside.body)).toBe(200);
    expect(await auditCount()).toBe(before + 2);

    // The off-system record is visible to HR and Finance (Req 9.3).
    for (const role of ['HR', 'FIN'] as const) {
      const budget = (await tracker(id, role)).steps[1];
      expect(budget).toMatchObject({
        status: 'secured_outside',
        decidedAsRole: 'EXE',
        decidedBy: { id: demoUserId('EXE') },
        outside: { reference: 'email 2 Oct', note: 'Agreed with the CFO' },
      });
    }
    const ready = await tracker(id);
    expect(ready.planReady).toBe(true);
    expect(ready.actions.decide.plan).toEqual(['approve', 'request_changes', 'reject']);
    // The Executive secured the last step, so they are not notified of their own
    // action (task 19 excludes the actor); HR and Finance hear it was secured.
    expect(await count(`notification WHERE event = 'approval.secured' AND object_id = $1`, [id])).toBeGreaterThan(0);

    // A second decision on a decided step is refused.
    expect((await call('HR', 'POST', `/approvals/${id}/headcount`, { decision: 'approve' })).status).toBe(409);

    const publish = await call('EXE', 'POST', `/approvals/${id}/plan`, { decision: 'approve', comment: 'Go' });
    expect(publish.status, JSON.stringify(publish.body)).toBe(200);
    expect(await auditCount()).toBe(before + 3);
    const done = publish.body.approval as ApprovalDetail;
    expect(done.scenario.status).toBe('published');
    expect(statuses(done)).toEqual(['approved', 'secured_outside', 'approved']);
    expect(done.actions.recordOutside).toEqual([]);
    const { rows } = await db.pool.query<{ id: string; status: string }>(`SELECT id, status FROM scenario WHERE id = ANY($1::uuid[])`, [
      [id, DEMO_PUBLISHED_ID],
    ]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({ [id]: 'published', [DEMO_PUBLISHED_ID]: 'superseded' });
    const { rows: events } = await db.pool.query<{ action: string; event: string; active_role: string }>(
      `SELECT action, event, active_role FROM audit_event WHERE object_id = $1 ORDER BY at DESC, id DESC LIMIT 1`,
      [id],
    );
    expect(events[0]).toEqual({ action: 'publish', event: 'scenario.published', active_role: 'EXE' });
    expect(await count(`notification WHERE event = 'scenario.published' AND object_id = $1`, [id])).toBeGreaterThanOrEqual(5);
  });

  it('returns to Draft on request-changes / reject; resubmitting resets every step (Req 9.6)', async () => {
    const id = await submitted('Reset check');
    expect((await call('HR', 'POST', `/approvals/${id}/headcount`, { decision: 'approve' })).status).toBe(200);
    const back = await call('FIN', 'POST', `/approvals/${id}/budget`, { decision: 'request_changes', comment: 'Trim PT hours' });
    expect(back.status).toBe(200);
    const d = back.body.approval as ApprovalDetail;
    expect(d.scenario.status).toBe('draft');
    expect(statuses(d)).toEqual(['approved', 'changes_requested', 'pending']);
    expect(d.steps[1]?.comment).toBe('Trim PT hours');
    // A stale submission number is refused once the scenario moves on.
    expect((await call('PLN', 'POST', `/scenarios/${id}/submit`, {})).status).toBe(200);
    const stale = await call('HR', 'POST', `/approvals/${id}/headcount`, { decision: 'approve', submissionNo: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ details: [{ message: 'submission_changed' }] });

    const again = await tracker(id);
    expect(again.submissionNo).toBe(2);
    expect(statuses(again)).toEqual(['pending', 'pending', 'pending']);
    expect(again.history).toHaveLength(1);
    expect(again.history[0]?.steps.map((s) => s.status)).toEqual(['approved', 'changes_requested', 'pending']);

    // Executive rejection, once ready, also returns it to Draft with the comment.
    await call('EXE', 'POST', `/approvals/${id}/secured-outside`, { step: 'headcount', reference: 'minutes', note: 'ExCom' });
    await call('FIN', 'POST', `/approvals/${id}/budget`, { decision: 'approve' });
    const rejected = await call('EXE', 'POST', `/approvals/${id}/plan`, { decision: 'reject', comment: 'Not this season' });
    expect(rejected.status).toBe(200);
    expect((rejected.body.approval as ApprovalDetail).scenario.status).toBe('draft');
    expect(await count(`notification WHERE event = 'approval.decided' AND params->>'decision' = 'rejected' AND object_id = $1`, [id])).toBeGreaterThan(0);
  });

  it('keeps decided steps final and requires an approved plan in the database (P10 backstop)', async () => {
    const id = await submitted('DB backstop');
    await expect(db.pool.query(`UPDATE scenario SET status = 'approved' WHERE id = $1`, [id])).rejects.toThrow(/approved plan step/);
    await call('HR', 'POST', `/approvals/${id}/headcount`, { decision: 'approve' });
    await expect(
      db.pool.query(`UPDATE approval_step SET status = 'pending', decided_by = NULL, decided_as_role = NULL, decided_at = NULL
                      WHERE scenario_id = $1 AND step = 'headcount'`, [id]),
    ).rejects.toThrow(/cannot change/);
  });
});

describe('P10 + P7 property: random approval sequences through the API match the model', () => {
  const commandArb: fc.Arbitrary<ApprovalCommand> = fc.oneof(
    fc.constantFrom(...APPROVAL_STEP_KINDS).chain((step) =>
      fc.record({
        kind: fc.constant('decide' as const),
        role: fc.oneof(fc.constant(APPROVER_ROLE_BY_STEP[step]), fc.constantFrom(...ROLE_CODES)),
        step: fc.constant(step),
        decision: fc.oneof(fc.constantFrom(...STEP_DECISIONS[step]), fc.constantFrom(...APPROVAL_DECISIONS)),
        comment: fc.constantFrom('', 'Please revisit'),
      }),
    ),
    fc.record({
      kind: fc.constant('record_outside' as const),
      role: fc.oneof(fc.constant('EXE' as const), fc.constantFrom(...ROLE_CODES)),
      step: fc.constantFrom(...APPROVAL_STEP_KINDS),
      reference: fc.constant('email 2 Oct'),
      note: fc.constantFrom('', 'Agreed in ExCom'),
    }),
    fc.constant<ApprovalCommand>({ kind: 'submit' }),
  );

  function request(id: string, c: ApprovalCommand): [RoleCode, string, unknown] {
    if (c.kind === 'submit') return ['PLN', `/scenarios/${id}/submit`, {}];
    if (c.kind === 'record_outside') {
      return [c.role, `/approvals/${id}/secured-outside`, { step: c.step, reference: c.reference, ...(c.note ? { note: c.note } : {}) }];
    }
    return [c.role, `/approvals/${id}/${c.step}`, { decision: c.decision, ...(c.comment ? { comment: c.comment } : {}) }];
  }

  it('accepts exactly what the model accepts, with one audit event each, and publishes only when secured', async () => {
    let n = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(commandArb, { minLength: 1, maxLength: 10 }), async (commands) => {
        n += 1;
        const id = await submitted(`Property ${n}`);
        let model: ApprovalState = {
          scenarioStatus: 'submitted',
          stale: false,
          submissionNo: 1,
          steps: APPROVAL_STEP_KINDS.map((step) => ({ step, submissionNo: 1, status: 'pending' as const })),
        };
        for (const command of commands) {
          if (model.scenarioStatus === 'published') break;
          const expected = applyApprovalCommand(model, command);
          const before = await auditCount();
          const [role, path, body] = request(id, command);
          const res = await call(role, 'POST', path, body);
          expect(res.status < 300, `${role} ${path} ${JSON.stringify(body)} -> ${res.status} ${JSON.stringify(res.body)}`).toBe(expected.ok);
          expect(await auditCount()).toBe(before + (expected.ok ? 1 : 0));
          if (expected.ok) {
            if (expected.published) {
              expect(isStepSecured(model.steps.find((s) => s.submissionNo === model.submissionNo && s.step === 'headcount')!.status)).toBe(true);
              expect(isStepSecured(model.steps.find((s) => s.submissionNo === model.submissionNo && s.step === 'budget')!.status)).toBe(true);
            }
            model = expected.state;
          }
        }
        const d = await tracker(id);
        expect(d.scenario.status).toBe(model.scenarioStatus);
        expect(d.submissionNo).toBe(model.submissionNo);
        expect(statuses(d)).toEqual(
          APPROVAL_STEP_KINDS.map((k) => model.steps.find((s) => s.submissionNo === model.submissionNo && s.step === k)?.status),
        );
      }),
      { numRuns: 15 },
    );
  }, 180_000);
});

describe('pause on stale (Req 8.5)', () => {
  it('refuses decisions on a submitted scenario whose inputs were superseded, and notifies the approvers', async () => {
    const id = await submitted('Pause check');
    await insertSnapshot(db.pool, { type: 'pos', synthetic: true });
    const before = await auditCount();
    const res = await call('HR', 'POST', `/approvals/${id}/headcount`, { decision: 'approve' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ details: [{ message: 'paused' }] });
    expect(await auditCount()).toBe(before);
    const d = await tracker(id, 'HR');
    expect(d.checks.notStale).toBe(false);
    expect(d.actions.blockers.headcount).toBe('paused');
    // The pause sticks (stored flag) and approvers were told.
    expect(await count(`scenario WHERE id = $1 AND stale`, [id])).toBe(1);
    expect(await count(`notification WHERE event = 'scenario.paused' AND object_id = $1`, [id])).toBeGreaterThan(0);
  });
});
