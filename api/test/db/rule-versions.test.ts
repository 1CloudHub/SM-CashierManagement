/**
 * Rule sets and versions (task 10; Req 16; P6, P7).
 *
 * P6: results always record the rules version and data snapshot used;
 *     publishing a rule version never changes existing results.
 * P7: every rule create/edit/submit/decision/publish writes exactly one audit
 *     event (and a refused one writes none).
 */
import { OPEN_RULE_VERSION_STATUSES, type RoleCode, type RuleSetType } from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withAuditedTransaction, type Actor, type AuditedTx } from '../../src/db/audit.js';
import * as rulesRepo from '../../src/db/repositories/rules.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { insertScenario, insertUser } from '../support/fixtures.js';

let db: TestDatabase;
const actors = {} as Record<'RST' | 'FIN' | 'PLN' | 'HR', Actor>;

async function grant(userId: string, role: RoleCode): Promise<void> {
  await db.pool.query(`INSERT INTO role_assignment (user_id, role, scope_type) VALUES ($1, $2, 'global')`, [userId, role]);
}

beforeAll(async () => {
  db = await createTestDatabase();
  for (const role of ['RST', 'FIN', 'PLN', 'HR'] as const) {
    const userId = await insertUser(db.pool);
    await grant(userId, role);
    actors[role] = { userId, activeRole: role, requestId: null };
  }
});

afterAll(async () => {
  await db.dispose();
});

const as = <T>(role: keyof typeof actors, fn: (tx: AuditedTx) => Promise<T>): Promise<T> =>
  withAuditedTransaction(db.pool, actors[role], fn);

async function auditCount(): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_event');
  return rows[0]?.n ?? 0;
}

function freshRuleSet(type: RuleSetType): Promise<rulesRepo.RuleSet> {
  return as('RST', (tx) => rulesRepo.createRuleSet(tx, { type, name: type }));
}

/** A scenario and a finished run pinned to `versionId` — the "existing result". */
async function pinnedRun(versionId: string, ruleSetId: string, synthetic: boolean): Promise<{ scenarioId: string; runId: string }> {
  const scenarioId = await insertScenario(db.pool, actors.PLN.userId, { synthetic });
  await db.pool.query(
    `INSERT INTO scenario_rule_version (scenario_id, rule_set_id, rule_version_id, synthetic) VALUES ($1, $2, $3, $4)`,
    [scenarioId, ruleSetId, versionId, synthetic],
  );
  const {
    rows: [run],
  } = await db.pool.query<{ id: string }>(
    `INSERT INTO scenario_run (scenario_id, run_type, status, results_ref, requested_by, synthetic, progress)
     VALUES ($1, 'network', 'succeeded', 's3://results/run.json', $2, $3, 1) RETURNING id`,
    [scenarioId, actors.PLN.userId, synthetic],
  );
  await db.pool.query(
    `INSERT INTO scenario_run_rule_version (run_id, rule_set_id, rule_version_id, synthetic) VALUES ($1, $2, $3, $4)`,
    [run?.id, ruleSetId, versionId, synthetic],
  );
  return { scenarioId, runId: run?.id ?? '' };
}

const WAGES = (rate: number) => ({ hourlyRateByRegion: { NCR: rate }, defaultHourlyRate: 80, employerLoading: 0.14 });

describe('rule-set catalogue', () => {
  it('derives the cost flag from the type and refuses an inconsistent one', async () => {
    const set = await as('RST', (tx) => rulesRepo.createRuleSet(tx, { type: 'premiums', name: 'Premium pay' }));
    expect(set.isCostRule).toBe(true);
    await expect(
      db.pool.query(`INSERT INTO rule_set (rule_set_type, name, is_cost_rule) VALUES ('holidays', 'Holidays', true)`),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('Finance gate and publishing (Req 16.3–16.6)', () => {
  let wages: rulesRepo.RuleSet;
  let leadTimes: rulesRepo.RuleSet;

  beforeAll(async () => {
    wages = await freshRuleSet('wages');
    leadTimes = await freshRuleSet('lead_times');
  });

  it('publishes a cost rule only after Finance approval, with a required comment on request-changes', async () => {
    const v1 = await as('RST', (tx) =>
      rulesRepo.createRuleVersion(tx, { ruleSetId: wages.id, effectiveFrom: '2026-01-01', payload: WAGES(80), changeNote: 'Initial' }),
    );
    await as('RST', (tx) => rulesRepo.submitRuleVersion(tx, v1.id));
    await expect(as('RST', (tx) => rulesRepo.publishRuleVersion(tx, v1.id))).rejects.toBeInstanceOf(rulesRepo.RuleVersionStateError);
    await expect(as('FIN', (tx) => rulesRepo.decideRuleVersion(tx, v1.id, 'request_changes', '  '))).rejects.toBeInstanceOf(
      rulesRepo.RuleVersionStateError,
    );

    const before = await auditCount();
    const changes = await as('FIN', (tx) => rulesRepo.decideRuleVersion(tx, v1.id, 'request_changes', 'Cite the wage order'));
    expect(changes.status).toBe('changes_requested');
    expect(changes.reviewComment).toBe('Cite the wage order');
    expect(await auditCount()).toBe(before + 1);

    await as('RST', (tx) => rulesRepo.editRuleVersion(tx, v1.id, { changeNote: 'Initial — WO NCR-25' }));
    await as('RST', (tx) => rulesRepo.submitRuleVersion(tx, v1.id));
    const approved = await as('FIN', (tx) => rulesRepo.decideRuleVersion(tx, v1.id, 'approve', 'OK'));
    expect(approved.financeApprovedBy).toBe(actors.FIN.userId);
    const published = await as('FIN', (tx) => rulesRepo.publishRuleVersion(tx, v1.id));
    expect(published.version.status).toBe('published');
  });

  it('lets non-cost rules publish directly and never routes them to Finance', async () => {
    const v = await as('RST', (tx) =>
      rulesRepo.createRuleVersion(tx, { ruleSetId: leadTimes.id, effectiveFrom: '2026-01-01', payload: { any: 1 } }),
    );
    await expect(as('FIN', (tx) => rulesRepo.decideRuleVersion(tx, v.id, 'approve'))).rejects.toBeInstanceOf(
      rulesRepo.RuleVersionStateError,
    );
    const { version } = await as('RST', (tx) => rulesRepo.publishRuleVersion(tx, v.id));
    expect(version.status).toBe('published');
    expect(version.financeApprovedBy).toBeNull();
  });

  it('keeps one open version per rule set and refuses to publish a version effective before the current one', async () => {
    const draft = await as('RST', (tx) =>
      rulesRepo.createRuleVersion(tx, { ruleSetId: leadTimes.id, effectiveFrom: '2025-06-01', payload: { any: 2 } }),
    );
    await expect(
      as('RST', (tx) => rulesRepo.createRuleVersion(tx, { ruleSetId: leadTimes.id, effectiveFrom: '2026-06-01', payload: {} })),
    ).rejects.toMatchObject({ code: '23505' });
    const before = await auditCount();
    await expect(as('RST', (tx) => rulesRepo.publishRuleVersion(tx, draft.id))).rejects.toBeInstanceOf(
      rulesRepo.RuleVersionStateError,
    );
    expect(await auditCount()).toBe(before);
    await as('RST', (tx) => rulesRepo.editRuleVersion(tx, draft.id, { effectiveFrom: '2026-06-01' }));
    const { version } = await as('RST', (tx) => rulesRepo.publishRuleVersion(tx, draft.id));
    expect(version.version).toBe(2);
  });

  it('flags pinned scenarios stale and notifies their owners, Finance and HR (Req 16.5)', async () => {
    const current = (await rulesRepo.listRuleVersions(db.pool, wages.id)).find((v) => v.status === 'published');
    expect(current).toBeDefined();
    const { scenarioId } = await pinnedRun(current?.id ?? '', wages.id, false);
    const archived = await insertScenario(db.pool, actors.PLN.userId);
    await db.pool.query(
      `INSERT INTO scenario_rule_version (scenario_id, rule_set_id, rule_version_id, synthetic) VALUES ($1, $2, $3, false)`,
      [archived, wages.id, current?.id],
    );
    await db.pool.query(`UPDATE scenario SET status = 'archived' WHERE id = $1`, [archived]);

    const next = await as('RST', (tx) =>
      rulesRepo.createRuleVersion(tx, { ruleSetId: wages.id, effectiveFrom: '2026-10-01', payload: WAGES(90), changeNote: 'WO 2026' }),
    );
    expect(await rulesRepo.getRuleVersionImpact(db.pool, next.id)).toEqual({ scenarioIds: [scenarioId] });
    await as('RST', (tx) => rulesRepo.submitRuleVersion(tx, next.id));
    await as('FIN', (tx) => rulesRepo.decideRuleVersion(tx, next.id, 'approve'));
    const before = await auditCount();
    const result = await as('RST', (tx) => rulesRepo.publishRuleVersion(tx, next.id));
    expect(await auditCount()).toBe(before + 1);
    expect(result.staleScenarioIds).toEqual([scenarioId]);

    const { rows: scenarios } = await db.pool.query<{ id: string; stale: boolean }>(
      'SELECT id, stale FROM scenario WHERE id = ANY($1::uuid[])',
      [[scenarioId, archived]],
    );
    expect(Object.fromEntries(scenarios.map((s) => [s.id, s.stale]))).toEqual({ [scenarioId]: true, [archived]: false });

    const { rows: notes } = await db.pool.query<{ user_id: string; event: string }>(
      `SELECT user_id, event FROM notification WHERE object_id = $1 OR object_id = $2 ORDER BY event, user_id`,
      [next.id, scenarioId],
    );
    const recipients = (event: string) => notes.filter((n) => n.event === event).map((n) => n.user_id).sort();
    expect(recipients('scenario.stale')).toEqual([actors.PLN.userId]);
    expect(recipients('rule_version.published')).toEqual(
      [actors.FIN.userId, actors.HR.userId, actors.PLN.userId].sort(),
    );

    const { rows: prior } = await db.pool.query<{ status: string }>('SELECT status FROM rule_version WHERE id = $1', [current?.id]);
    expect(prior[0]?.status).toBe('superseded');
  });

  it('keeps every submitted version: only an unsubmitted draft can be deleted', async () => {
    const versions = await rulesRepo.listRuleVersions(db.pool, wages.id);
    const kept = versions.find((v) => v.status === 'superseded');
    await expect(db.pool.query('DELETE FROM rule_version WHERE id = $1', [kept?.id])).rejects.toMatchObject({ code: '23514' });
  });
});

// ---------------------------------------------------------------------------
// Property 6 + 7 over random operation sequences.
// ---------------------------------------------------------------------------

type Op =
  | { kind: 'create'; set: number; day: number; rate: number }
  | { kind: 'edit'; set: number; rate: number; day: number }
  | { kind: 'submit'; set: number }
  | { kind: 'approve'; set: number }
  | { kind: 'request_changes'; set: number; comment: string }
  | { kind: 'publish'; set: number; role: 'RST' | 'FIN' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('create' as const), set: fc.nat(3), day: fc.integer({ min: 0, max: 400 }), rate: fc.integer({ min: 1, max: 500 }) }),
  fc.record({ kind: fc.constant('edit' as const), set: fc.nat(3), rate: fc.integer({ min: 1, max: 500 }), day: fc.integer({ min: 0, max: 400 }) }),
  fc.record({ kind: fc.constant('submit' as const), set: fc.nat(3) }),
  fc.record({ kind: fc.constant('approve' as const), set: fc.nat(3) }),
  fc.record({ kind: fc.constant('request_changes' as const), set: fc.nat(3), comment: fc.constantFrom('', 'Fix NCR rate') }),
  fc.record({ kind: fc.constant('publish' as const), set: fc.nat(3), role: fc.constantFrom('RST' as const, 'FIN' as const) }),
);

const dayOf = (n: number): string => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);

interface VersionContent {
  version: number;
  effective_from: string;
  payload: unknown;
  change_note: string;
}


describe('P6 rule versioning and P7 audit completeness', () => {
  it('publishing never changes existing results; each committed mutation writes exactly one audit event', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 30 }), fc.boolean(), async (ops, synthetic) => {
        // Rule-set types are unique per database, so each run gets its own.
        const run = await createTestDatabase();
        try {
          await checkSequence(run, ops, synthetic);
        } finally {
          await run.dispose();
        }
      }),
      { numRuns: 15 },
    );
  });
});

async function checkSequence(run: TestDatabase, ops: readonly Op[], synthetic: boolean): Promise<void> {
  const users = {} as Record<'RST' | 'FIN' | 'PLN', Actor>;
  for (const role of ['RST', 'FIN', 'PLN'] as const) {
    users[role] = { userId: await insertUser(run.pool), activeRole: role, requestId: null };
  }
  const act = <T>(role: 'RST' | 'FIN', fn: (tx: AuditedTx) => Promise<T>): Promise<T> =>
    withAuditedTransaction(run.pool, users[role], fn);
  const count = async (): Promise<number> =>
    (await run.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_event')).rows[0]?.n ?? 0;
  const contentOf = async (ids: readonly string[]): Promise<Map<string, VersionContent>> => {
    const { rows } = await run.pool.query<VersionContent & { id: string }>(
      `SELECT id, version, effective_from, payload, change_note FROM rule_version WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(rows.map(({ id, ...rest }) => [id, rest]));
  };

  // Two series — one cost, one non-cost — each seeded with a published version
  // and a finished run (an "existing result") pinned to it.
  const sets: rulesRepo.RuleSet[] = [];
  const pinned: string[] = [];
  for (const type of ['transport_allowance', 'labor'] as const) {
    const set = await act('RST', (tx) => rulesRepo.createRuleSet(tx, { type, name: type }));
    sets.push(set);
    const v = await act('RST', (tx) =>
      rulesRepo.createRuleVersion(tx, { ruleSetId: set.id, effectiveFrom: '2026-01-01', payload: { rate: 1 }, synthetic }),
    );
    if (set.isCostRule) {
      await act('RST', (tx) => rulesRepo.submitRuleVersion(tx, v.id));
      await act('FIN', (tx) => rulesRepo.decideRuleVersion(tx, v.id, 'approve'));
    }
    await act('RST', (tx) => rulesRepo.publishRuleVersion(tx, v.id));
    const scenarioId = await insertScenario(run.pool, users.PLN.userId, { synthetic });
    await run.pool.query(
      `INSERT INTO scenario_rule_version (scenario_id, rule_set_id, rule_version_id, synthetic) VALUES ($1, $2, $3, $4)`,
      [scenarioId, set.id, v.id, synthetic],
    );
    const {
      rows: [r],
    } = await run.pool.query<{ id: string }>(
      `INSERT INTO scenario_run (scenario_id, run_type, status, results_ref, requested_by, synthetic, progress)
       VALUES ($1, 'network', 'succeeded', 's3://results/run.json', $2, $3, 1) RETURNING id`,
      [scenarioId, users.PLN.userId, synthetic],
    );
    await run.pool.query(
      `INSERT INTO scenario_run_rule_version (run_id, rule_set_id, rule_version_id, synthetic) VALUES ($1, $2, $3, $4)`,
      [r?.id, set.id, v.id, synthetic],
    );
    pinned.push(v.id);
  }
  const pinnedBefore = await contentOf(pinned);
  const publishedAt = new Map<string, VersionContent>();

  for (const op of ops) {
    const set = sets[op.set % sets.length] as rulesRepo.RuleSet;
    const open = (await rulesRepo.listRuleVersions(run.pool, set.id, { synthetic })).find((v) =>
      (OPEN_RULE_VERSION_STATUSES as readonly string[]).includes(v.status),
    );
    const target = open?.id ?? '00000000-0000-4000-8000-000000000000';
    const before = await count();
    let committed = true;
    try {
      switch (op.kind) {
        case 'create':
          await act('RST', (tx) =>
            rulesRepo.createRuleVersion(tx, { ruleSetId: set.id, effectiveFrom: dayOf(op.day), payload: { rate: op.rate }, synthetic }),
          );
          break;
        case 'edit':
          await act('RST', (tx) => rulesRepo.editRuleVersion(tx, target, { payload: { rate: op.rate }, effectiveFrom: dayOf(op.day) }));
          break;
        case 'submit':
          await act('RST', (tx) => rulesRepo.submitRuleVersion(tx, target));
          break;
        case 'approve':
          await act('FIN', (tx) => rulesRepo.decideRuleVersion(tx, target, 'approve'));
          break;
        case 'request_changes':
          await act('FIN', (tx) => rulesRepo.decideRuleVersion(tx, target, 'request_changes', op.comment));
          break;
        case 'publish': {
          const { version } = await act(op.role, (tx) => rulesRepo.publishRuleVersion(tx, target));
          const content = (await contentOf([version.id])).get(version.id);
          if (content) publishedAt.set(version.id, content);
          // A cost rule is never published without Finance approval (Req 16.3).
          if (version.isCostRule) expect(version.financeApprovedBy).not.toBeNull();
          break;
        }
      }
    } catch (error) {
      committed = false;
      // Refusals are domain or constraint errors, never audit-invariant breaches.
      expect((error as Error).name).not.toBe('AuditInvariantError');
    }
    // P7: exactly one event per committed mutation, none for a refused one.
    expect(await count()).toBe(before + (committed ? 1 : 0));
  }

  // P6: existing results still carry the same versions, with identical content,
  // and no published version changed after it was published.
  expect(await contentOf(pinned)).toEqual(pinnedBefore);
  const { rows: runPins } = await run.pool.query<{ rule_version_id: string }>(
    'SELECT rule_version_id FROM scenario_run_rule_version ORDER BY rule_version_id',
  );
  expect(runPins.map((r) => r.rule_version_id)).toEqual([...pinned].sort());
  const now = await contentOf([...publishedAt.keys()]);
  for (const [id, content] of publishedAt) expect(now.get(id)).toEqual(content);
  const { rows: heads } = await run.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM rule_version WHERE status = 'published' GROUP BY rule_set_id, synthetic HAVING count(*) > 1`,
  );
  expect(heads).toEqual([]);
}
