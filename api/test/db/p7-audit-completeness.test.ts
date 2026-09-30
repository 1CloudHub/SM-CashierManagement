/**
 * Property 7 — Audit completeness (Req 9.7, 16.6, 22.1; task 5.2).
 *
 *   Every create, edit, submit, decision, publish, ingestion, export and role
 *   change produces exactly one audit event.
 *
 * Random sequences of repository mutations — valid and invalid, by the right
 * or a wrong role — run against a real PostgreSQL. After each one:
 *   - committed  => exactly one new event, with the expected action class, the
 *                   acting user and the active role (P12);
 *   - failed     => no new event (the mutation and its event roll back
 *                   together), and the failure is a domain/constraint error,
 *                   never an audit-invariant breach.
 */
import { randomUUID } from 'node:crypto';
import { AUDIT_ACTIONS, ROLE_CODES, type AuditAction, type DatasetType, type RoleCode } from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditInvariantError, withAuditedTransaction, type Actor, type AuditedTx } from '../../src/db/audit.js';
import * as exportsRepo from '../../src/db/repositories/exports.js';
import * as ingestionRepo from '../../src/db/repositories/ingestion.js';
import * as orgRepo from '../../src/db/repositories/org.js';
import * as rulesRepo from '../../src/db/repositories/rules.js';
import * as scenariosRepo from '../../src/db/repositories/scenarios.js';
import * as usersRepo from '../../src/db/repositories/users.js';
import { insertRegion, insertUser } from '../support/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';

interface World {
  actors: Record<RoleCode, Actor>;
  userIds: string[];
  regionId: string;
  storeIds: string[];
  ruleSetIds: string[];
  ruleVersionIds: string[];
  scenarioIds: string[];
}

interface Op {
  readonly label: string;
  readonly role: RoleCode;
  readonly action: AuditAction;
  /** Runs the mutation; returns bookkeeping to apply once it has committed. */
  readonly run: (tx: AuditedTx, world: World) => Promise<((world: World) => void) | void>;
}

let db: TestDatabase;
let world: World;
const committedActions = new Set<AuditAction>();

const pick = (ids: readonly string[], i: number): string => ids[i % Math.max(ids.length, 1)] ?? randomUUID();
const SEASONS = ['christmas-2026', 'summer-2027'];
const DATASET_TYPES: readonly DatasetType[] = ['pos', 'master', 'staff'];

/** Mostly the role the action belongs to, sometimes any role. */
const roleFor = (preferred: RoleCode): fc.Arbitrary<RoleCode> =>
  fc.oneof({ weight: 4, arbitrary: fc.constant(preferred) }, { weight: 1, arbitrary: fc.constantFrom(...ROLE_CODES) });

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ role: roleFor('RST'), format: fc.constantFrom('sm_supermarket', 'savemore', 'sm_hypermarket') as fc.Arbitrary<'sm_supermarket' | 'savemore' | 'sm_hypermarket'> }).map(
    ({ role, format }): Op => ({
      label: 'store.create',
      role,
      action: 'create',
      run: async (tx, w) => {
        const store = await orgRepo.createStore(tx, {
          code: `S-${randomUUID().slice(0, 8)}`,
          name: 'SM Test',
          format,
          regionId: w.regionId,
        });
        return (next) => next.storeIds.push(store.id);
      },
    }),
  ),
  fc.record({ role: roleFor('RST'), i: fc.nat(), name: fc.string({ maxLength: 12 }), active: fc.boolean() }).map(
    ({ role, i, name, active }): Op => ({
      label: 'store.update',
      role,
      action: 'edit',
      run: async (tx, w) => {
        await orgRepo.updateStore(tx, pick(w.storeIds, i), { name, active });
      },
    }),
  ),
  fc.record({ role: roleFor('RST'), i: fc.nat(), lanes: fc.integer({ min: -1, max: 30 }) }).map(
    ({ role, i, lanes }): Op => ({
      label: 'department.create',
      role,
      action: 'create',
      run: async (tx, w) => {
        await orgRepo.createDepartment(tx, {
          storeId: pick(w.storeIds, i),
          name: `Dept ${randomUUID().slice(0, 6)}`,
          installedLanes: lanes,
          defaultHandleTimeMin: 2.5,
          tradingHours: { open: '10:00', close: '22:00' },
        });
      },
    }),
  ),
  fc.record({ role: fc.constantFrom(...ROLE_CODES), language: fc.constantFrom('en', 'fil', 'xx') }).map(
    ({ role, language }): Op => ({
      label: 'user.profile',
      role,
      action: 'edit',
      run: async (tx, w) => {
        await usersRepo.updateUserProfile(tx, w.actors[role].userId, { language: language as 'en' | 'fil' });
      },
    }),
  ),
  fc.record({ role: fc.constantFrom(...ROLE_CODES), i: fc.nat(), target: fc.constantFrom(...ROLE_CODES) }).map(
    ({ role, i, target }): Op => ({
      label: 'user.active_role',
      role,
      action: 'role_change',
      run: async (tx, w) => {
        await usersRepo.setActiveRole(tx, pick(w.userIds, i), target);
      },
    }),
  ),
  fc
    .record({
      role: roleFor('ADM'),
      i: fc.nat(),
      target: fc.constantFrom<RoleCode>('PLN', 'STM', 'HR', 'FIN', 'EXE', 'RST'),
      storeScoped: fc.boolean(),
    })
    .map(
      ({ role, i, target, storeScoped }): Op => ({
        label: 'role.grant',
        role,
        action: 'role_change',
        run: async (tx, w) => {
          await usersRepo.grantRole(tx, {
            userId: pick(w.userIds, i),
            role: target,
            scope: storeScoped ? { type: 'store', storeIds: w.storeIds.slice(0, 1) } : { type: 'global' },
          });
        },
      }),
    ),
  fc.record({ role: roleFor('ADM'), i: fc.nat(), target: fc.constantFrom(...ROLE_CODES) }).map(
    ({ role, i, target }): Op => ({
      label: 'role.revoke',
      role,
      action: 'role_change',
      run: async (tx, w) => {
        await usersRepo.revokeRole(tx, pick(w.userIds, i), target);
      },
    }),
  ),
  fc
    .record({
      role: roleFor('RST'),
      type: fc.constantFrom(...DATASET_TYPES),
      errors: fc.integer({ min: 0, max: 2 }),
      warnings: fc.integer({ min: 0, max: 2 }),
    })
    .map(
      ({ role, type, errors, warnings }): Op => ({
        label: 'dataset.ingest',
        role,
        action: 'ingestion',
        run: async (tx) => {
          await ingestionRepo.ingestDataset(tx, {
            datasetType: type,
            fileName: `${type}.csv`,
            coversFrom: '2025-12-01',
            coversTo: '2025-12-31',
            rowCount: 100,
            synthetic: false,
            issues: [
              ...Array.from({ length: errors }, (_, k) => ({ row: k + 2, severity: 'error' as const, message: 'bad' })),
              ...Array.from({ length: warnings }, (_, k) => ({ row: k + 9, severity: 'warning' as const, message: 'odd' })),
            ],
          });
        },
      }),
    ),
  fc.record({ role: roleFor('RST'), i: fc.nat() }).map(
    ({ role, i }): Op => ({
      label: 'rule_version.create',
      role,
      action: 'create',
      run: async (tx, w) => {
        const v = await rulesRepo.createRuleVersion(tx, {
          ruleSetId: pick(w.ruleSetIds, i),
          effectiveFrom: '2026-11-01',
          payload: { rate: i % 1000 },
        });
        return (next) => next.ruleVersionIds.push(v.id);
      },
    }),
  ),
  fc.record({ role: roleFor('RST'), i: fc.nat(), rate: fc.nat(2000) }).map(
    ({ role, i, rate }): Op => ({
      label: 'rule_version.edit',
      role,
      action: 'edit',
      run: async (tx, w) => {
        await rulesRepo.editRuleVersion(tx, pick(w.ruleVersionIds, i), { payload: { rate } });
      },
    }),
  ),
  fc.record({ role: roleFor('RST'), i: fc.nat() }).map(
    ({ role, i }): Op => ({
      label: 'rule_version.submit',
      role,
      action: 'submit',
      run: async (tx, w) => {
        await rulesRepo.submitRuleVersion(tx, pick(w.ruleVersionIds, i));
      },
    }),
  ),
  fc.record({ role: roleFor('FIN'), i: fc.nat(), approve: fc.boolean() }).map(
    ({ role, i, approve }): Op => ({
      label: 'rule_version.decide',
      role,
      action: 'decision',
      run: async (tx, w) => {
        await rulesRepo.decideRuleVersion(tx, pick(w.ruleVersionIds, i), approve ? 'approve' : 'request_changes', 'ok');
      },
    }),
  ),
  fc.record({ role: roleFor('RST'), i: fc.nat() }).map(
    ({ role, i }): Op => ({
      label: 'rule_version.publish',
      role,
      action: 'publish',
      run: async (tx, w) => {
        await rulesRepo.publishRuleVersion(tx, pick(w.ruleVersionIds, i));
      },
    }),
  ),
  fc.record({ role: roleFor('PLN'), season: fc.constantFrom(...SEASONS), pin: fc.boolean() }).map(
    ({ role, season, pin }): Op => ({
      label: 'scenario.create',
      role,
      action: 'create',
      run: async (tx) => {
        const snapshotIds: string[] = [];
        if (pin) {
          for (const type of DATASET_TYPES) {
            const s = await ingestionRepo.getCurrentSnapshot(tx, type, false);
            if (s) snapshotIds.push(s.id);
          }
        }
        const s = await scenariosRepo.createScenario(tx, {
          name: 'Plan',
          season,
          settings: { serviceLevel: 0.9 },
          snapshotIds,
        });
        return (next) => next.scenarioIds.push(s.id);
      },
    }),
  ),
  fc.record({ role: roleFor('PLN'), i: fc.nat(), sl: fc.double({ min: 0.5, max: 0.99, noNaN: true }) }).map(
    ({ role, i, sl }): Op => ({
      label: 'scenario.edit',
      role,
      action: 'edit',
      run: async (tx, w) => {
        await scenariosRepo.editScenarioSettings(tx, pick(w.scenarioIds, i), { serviceLevel: sl });
      },
    }),
  ),
  fc.record({ role: roleFor('PLN'), i: fc.nat() }).map(
    ({ role, i }): Op => ({
      label: 'scenario.submit',
      role,
      action: 'submit',
      run: async (tx, w) => {
        await scenariosRepo.submitScenario(tx, pick(w.scenarioIds, i));
      },
    }),
  ),
  fc
    .record({
      i: fc.nat(),
      step: fc.constantFrom('headcount', 'budget', 'plan') as fc.Arbitrary<'headcount' | 'budget' | 'plan'>,
      decision: fc.constantFrom('approved', 'changes_requested', 'rejected') as fc.Arbitrary<
        'approved' | 'changes_requested' | 'rejected'
      >,
      withComment: fc.boolean(),
      wrongRole: fc.option(fc.constantFrom(...ROLE_CODES), { freq: 5 }),
    })
    .map(({ i, step, decision, withComment, wrongRole }): Op => {
      const right: RoleCode = step === 'headcount' ? 'HR' : step === 'budget' ? 'FIN' : 'EXE';
      return {
        label: 'approval.decide',
        role: wrongRole ?? right,
        action: 'decision',
        run: async (tx, w) => {
          await scenariosRepo.decideApprovalStep(tx, {
            scenarioId: pick(w.scenarioIds, i),
            step,
            decision,
            ...(withComment ? { comment: 'Please revise' } : {}),
          });
        },
      };
    }),
  fc
    .record({
      role: roleFor('EXE'),
      i: fc.nat(),
      step: fc.constantFrom('headcount', 'budget') as fc.Arbitrary<'headcount' | 'budget'>,
      reference: fc.constantFrom('', 'Board minute 2026-11'),
    })
    .map(
      ({ role, i, step, reference }): Op => ({
        label: 'approval.secured_outside',
        role,
        action: 'decision',
        run: async (tx, w) => {
          await scenariosRepo.recordSecuredOutside(tx, { scenarioId: pick(w.scenarioIds, i), step, reference });
        },
      }),
    ),
  fc.record({ role: roleFor('EXE'), i: fc.nat() }).map(
    ({ role, i }): Op => ({
      label: 'scenario.publish',
      role,
      action: 'publish',
      run: async (tx, w) => {
        await scenariosRepo.approvePlanAndPublish(tx, pick(w.scenarioIds, i));
      },
    }),
  ),
  fc.record({ role: fc.constantFrom(...ROLE_CODES), rows: fc.nat(500) }).map(
    ({ role, rows }): Op => ({
      label: 'export',
      role,
      action: 'export',
      run: async (tx) => {
        await exportsRepo.recordExport(tx, {
          screen: 'SCR-020',
          format: 'csv',
          objectType: 'network_view',
          objectId: 'christmas-2026',
          rowCount: rows,
          query: 'season=christmas-2026',
          synthetic: false,
        });
      },
    }),
  ),
);

async function auditCount(): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_event');
  return rows[0]?.n ?? 0;
}

async function latestEvent(): Promise<{ user_id: string; active_role: string; action: string }> {
  const { rows } = await db.pool.query<{ user_id: string; active_role: string; action: string }>(
    'SELECT user_id, active_role, action FROM audit_event ORDER BY seq DESC LIMIT 1',
  );
  const row = rows[0];
  if (!row) throw new Error('no audit events');
  return row;
}

/** Runs one op and checks P7 for it. Returns whether it committed. */
async function runAndCheck(op: Op): Promise<boolean> {
  const actor = world.actors[op.role];
  const before = await auditCount();
  let effect: ((w: World) => void) | void = undefined;
  let failure: unknown = null;
  try {
    effect = await withAuditedTransaction(db.pool, actor, (tx) => op.run(tx, world));
  } catch (error) {
    failure = error;
  }
  const after = await auditCount();

  if (failure === null) {
    expect(after - before, `${op.label} committed`).toBe(1);
    const event = await latestEvent();
    expect(event).toEqual({ user_id: actor.userId, active_role: op.role, action: op.action });
    committedActions.add(op.action);
    if (effect) effect(world);
    return true;
  }
  expect(failure, `${op.label} failed with an audit-invariant breach`).not.toBeInstanceOf(AuditInvariantError);
  expect(after - before, `${op.label} failed (${String(failure)})`).toBe(0);
  return false;
}

beforeAll(async () => {
  db = await createTestDatabase();
  const actors = {} as Record<RoleCode, Actor>;
  const userIds: string[] = [];
  for (const role of ROLE_CODES) {
    const userId = await insertUser(db.pool);
    userIds.push(userId);
    actors[role] = { userId, activeRole: role, requestId: `req-${role}` };
  }
  world = {
    actors,
    userIds,
    regionId: await insertRegion(db.pool),
    storeIds: [],
    ruleSetIds: [],
    ruleVersionIds: [],
    scenarioIds: [],
  };
  // Rule sets are fixed reference data; create them through the audited path.
  for (const [type, isCostRule] of [
    ['wages', true],
    ['lead_times', false],
  ] as const) {
    const set = await withAuditedTransaction(db.pool, actors.RST, (tx) =>
      rulesRepo.createRuleSet(tx, { type, name: type, isCostRule }),
    );
    world.ruleSetIds.push(set.id);
  }
});

afterAll(async () => {
  await db.dispose();
});

describe('P7 audit completeness', () => {
  it('a full approval journey writes exactly one event per mutation and covers every action class', async () => {
    const S = scenariosRepo;
    const journey: Op[] = [
      { label: 'role.grant', role: 'ADM', action: 'role_change', run: async (tx, w) => void (await usersRepo.grantRole(tx, { userId: w.actors.PLN.userId, role: 'PLN', scope: { type: 'global' } })) },
      { label: 'store.create', role: 'RST', action: 'create', run: async (tx, w) => { const s = await orgRepo.createStore(tx, { code: 'QC-MAIN', name: 'SM Quezon City', format: 'sm_supermarket', regionId: w.regionId }); return (n) => n.storeIds.push(s.id); } },
      { label: 'dataset.ingest', role: 'RST', action: 'ingestion', run: async (tx) => void (await ingestionRepo.ingestDataset(tx, { datasetType: 'pos', fileName: 'pos.csv', coversFrom: '2025-12-01', coversTo: '2025-12-31', rowCount: 10, issues: [], synthetic: false })) },
      { label: 'rule_version.create', role: 'RST', action: 'create', run: async (tx, w) => { const v = await rulesRepo.createRuleVersion(tx, { ruleSetId: pick(w.ruleSetIds, 0), effectiveFrom: '2026-11-01', payload: { dailyRate: 645 } }); return (n) => n.ruleVersionIds.push(v.id); } },
      { label: 'rule_version.submit', role: 'RST', action: 'submit', run: async (tx, w) => void (await rulesRepo.submitRuleVersion(tx, w.ruleVersionIds.at(-1) ?? '')) },
      { label: 'rule_version.decide', role: 'FIN', action: 'decision', run: async (tx, w) => void (await rulesRepo.decideRuleVersion(tx, w.ruleVersionIds.at(-1) ?? '', 'approve')) },
      { label: 'rule_version.publish', role: 'RST', action: 'publish', run: async (tx, w) => void (await rulesRepo.publishRuleVersion(tx, w.ruleVersionIds.at(-1) ?? '')) },
      { label: 'scenario.create', role: 'PLN', action: 'create', run: async (tx, w) => { const s = await S.createScenario(tx, { name: 'Dec peak', season: 'christmas-2026', settings: { serviceLevel: 0.9 }, ruleVersionIds: w.ruleVersionIds.slice(-1) }); return (n) => n.scenarioIds.push(s.id); } },
      { label: 'scenario.edit', role: 'PLN', action: 'edit', run: async (tx, w) => void (await S.editScenarioSettings(tx, w.scenarioIds.at(-1) ?? '', { serviceLevel: 0.92 })) },
      { label: 'scenario.submit', role: 'PLN', action: 'submit', run: async (tx, w) => void (await S.submitScenario(tx, w.scenarioIds.at(-1) ?? '')) },
      { label: 'approval.headcount', role: 'HR', action: 'decision', run: async (tx, w) => void (await S.decideApprovalStep(tx, { scenarioId: w.scenarioIds.at(-1) ?? '', step: 'headcount', decision: 'approved' })) },
      { label: 'approval.budget_outside', role: 'EXE', action: 'decision', run: async (tx, w) => void (await S.recordSecuredOutside(tx, { scenarioId: w.scenarioIds.at(-1) ?? '', step: 'budget', reference: 'Board minute 12' })) },
      { label: 'scenario.publish', role: 'EXE', action: 'publish', run: async (tx, w) => void (await S.approvePlanAndPublish(tx, w.scenarioIds.at(-1) ?? '')) },
      { label: 'export', role: 'EXE', action: 'export', run: async (tx) => void (await exportsRepo.recordExport(tx, { screen: 'SCR-024', format: 'pdf', objectType: 'scenario', objectId: 'summary', rowCount: 1, query: '', synthetic: false })) },
      { label: 'user.active_role', role: 'EXE', action: 'role_change', run: async (tx, w) => void (await usersRepo.setActiveRole(tx, w.actors.EXE.userId, 'FIN')) },
      { label: 'user.profile', role: 'EXE', action: 'edit', run: async (tx, w) => void (await usersRepo.updateUserProfile(tx, w.actors.EXE.userId, { language: 'fil' })) },
    ];
    const actions = new Set<AuditAction>();
    for (const op of journey) {
      expect(await runAndCheck(op), `${op.label} should commit`).toBe(true);
      actions.add(op.action);
    }
    expect([...actions].sort()).toEqual([...AUDIT_ACTIONS].sort());

    const published = await scenariosRepo.getScenario(db.pool, world.scenarioIds.at(-1) ?? '');
    expect(published?.status).toBe('published');
  });

  it('holds for random sequences of valid and invalid mutations', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 25 }), async (ops) => {
        for (const op of ops) await runAndCheck(op);
      }),
      { numRuns: 40 },
    );
    // The random run exercised committed events of several action classes.
    expect(committedActions.size).toBeGreaterThanOrEqual(6);
  });
});
