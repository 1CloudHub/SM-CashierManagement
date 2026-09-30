/**
 * Task 20 — saved views (`/saved-views` CRUD; requirement 21.5; P7, P12):
 *  - a saved view is only ever visible to, and changeable by, its owner —
 *    another user gets the same 404 as for a missing view and nothing changes;
 *  - at most one default per user per screen;
 *  - every create / rename / edit / delete writes exactly one audit event
 *    with the acting user and active role; rejected requests write none.
 */
import { SAVED_VIEW_SCREENS, type RoleCode, type SavedView, type SavedViewListResponse } from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { insertAppUser, makeClient, one, uniq, writeCounts } from '../support/rbac.js';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.dispose();
});

const ROLES: readonly RoleCode[] = ['PLN', 'EXE', 'STM', 'HR', 'FIN', 'RST', 'ADM', 'STF'];

type Op =
  | { kind: 'create'; user: number; screen: string; name: string; query: string; isDefault: boolean }
  | { kind: 'rename'; user: number; target: number; name: string }
  | { kind: 'setDefault'; user: number; target: number; isDefault: boolean }
  | { kind: 'delete'; user: number; target: number }
  | { kind: 'list'; user: number; screen: string | null };

const nameArb = fc.constantFrom('Luzon hypermarkets', 'Over capacity', 'Dec 24', 'Mine', 'QC only');
const screenArb = fc.constantFrom(...SAVED_VIEW_SCREENS.slice(0, 2));
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant('create' as const),
    user: fc.nat(2),
    screen: screenArb,
    name: nameArb,
    query: fc.constantFrom('region=luzon&date=2026-12-24', 'sort=-gap', '', 'store=abc&junk=1'),
    isDefault: fc.boolean(),
  }),
  fc.record({ kind: fc.constant('rename' as const), user: fc.nat(2), target: fc.nat(20), name: nameArb }),
  fc.record({ kind: fc.constant('setDefault' as const), user: fc.nat(2), target: fc.nat(20), isDefault: fc.boolean() }),
  fc.record({ kind: fc.constant('delete' as const), user: fc.nat(2), target: fc.nat(20) }),
  fc.record({ kind: fc.constant('list' as const), user: fc.nat(2), screen: fc.option(screenArb, { nil: null }) }),
);

interface Model {
  id: string;
  owner: number;
  screen: string;
  name: string;
  query: string;
  isDefault: boolean;
}

describe('saved views are private to their owner and audited (P7)', () => {
  it('random CRUD sequences by several users keep ownership, one default per screen and one audit event per change', async () => {
    const { call } = makeClient(db.pool, true);
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 25 }), fc.array(fc.constantFrom(...ROLES), { minLength: 3, maxLength: 3 }), async (ops, roles) => {
        const users = await Promise.all(
          [0, 1, 2].map(async (i) => {
            const email = `sv${i}.${uniq()}@smretail.com`;
            return { email, id: await insertAppUser(db.pool, email), role: roles[i] as RoleCode };
          }),
        );
        let model: Model[] = [];
        const known: string[] = [];

        for (const op of ops) {
          const user = users[op.user]!;
          const before = await writeCounts(db.pool);
          const as = { email: user.email, role: user.role };
          const targetId = op.kind === 'create' || op.kind === 'list' ? null : (known[op.target % Math.max(known.length, 1)] ?? '6f1c7a52-0b8e-4d5e-9a41-5e2b1c9d7f00');
          const target = targetId ? model.find((m) => m.id === targetId) : undefined;
          const owns = target !== undefined && target.owner === op.user;
          let changed = false;

          if (op.kind === 'list') {
            const res = await call({ ...as, path: `/saved-views${op.screen ? `?screen=${op.screen}` : ''}` });
            expect(res.status).toBe(200);
            const views = (res.body as SavedViewListResponse).views;
            const mine = model.filter((m) => m.owner === op.user && (op.screen === null || m.screen === op.screen));
            expect(views.map((v) => v.id).sort()).toEqual(mine.map((m) => m.id).sort());
            for (const v of views) {
              const m = mine.find((x) => x.id === v.id)!;
              expect({ name: v.name, query: v.query, isDefault: v.isDefault, screen: v.screen }).toEqual({
                name: m.name,
                query: m.query,
                isDefault: m.isDefault,
                screen: m.screen,
              });
            }
            // Nobody else's view (by id or name) ever appears.
            for (const other of model.filter((m) => m.owner !== op.user)) expect(res.raw).not.toContain(other.id);
          } else if (op.kind === 'create') {
            const res = await call({ ...as, method: 'POST', path: '/saved-views', body: { screen: op.screen, name: op.name, query: op.query, isDefault: op.isDefault } });
            const clash = model.some((m) => m.owner === op.user && m.screen === op.screen && m.name === op.name);
            if (clash) {
              expect(res.status, res.raw).toBe(409);
            } else {
              expect(res.status, res.raw).toBe(201);
              const view = res.body as SavedView;
              if (op.isDefault) for (const m of model) if (m.owner === op.user && m.screen === op.screen) m.isDefault = false;
              model.push({ id: view.id, owner: op.user, screen: op.screen, name: op.name, query: view.query, isDefault: op.isDefault });
              known.push(view.id);
              expect(view.query).not.toContain('junk');
              changed = true;
            }
          } else if (op.kind === 'delete') {
            const res = await call({ ...as, method: 'DELETE', path: `/saved-views/${targetId}` });
            if (!owns) {
              expect(res.status, res.raw).toBe(404);
            } else {
              expect(res.status, res.raw).toBe(200);
              model = model.filter((m) => m.id !== targetId);
              changed = true;
            }
          } else {
            const body = op.kind === 'rename' ? { name: op.name } : { isDefault: op.isDefault };
            const res = await call({ ...as, method: 'PATCH', path: `/saved-views/${targetId}`, body });
            if (!owns) {
              expect(res.status, res.raw).toBe(404);
            } else if (op.kind === 'rename' && model.some((m) => m.id !== target.id && m.owner === op.user && m.screen === target.screen && m.name === op.name)) {
              expect(res.status, res.raw).toBe(409);
            } else {
              expect(res.status, res.raw).toBe(200);
              const noop = op.kind === 'rename' ? target.name === op.name : target.isDefault === op.isDefault;
              if (op.kind === 'rename') target.name = op.name;
              else {
                if (op.isDefault) for (const m of model) if (m.owner === op.user && m.screen === target.screen) m.isDefault = false;
                target.isDefault = op.isDefault;
              }
              changed = !noop;
            }
          }

          const after = await writeCounts(db.pool);
          expect(after.audit, `${op.kind} audit count`).toBe(before.audit + (changed ? 1 : 0));
          if (changed) {
            const event = await one<{ user_id: string; active_role: string; object_type: string }>(
              db.pool,
              'SELECT user_id, active_role, object_type FROM audit_event ORDER BY seq DESC LIMIT 1',
            );
            expect(event).toEqual({ user_id: user.id, active_role: user.role, object_type: 'saved_view' });
          }
          // One default per user per screen, always.
          const { rows } = await db.pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM saved_view WHERE is_default GROUP BY user_id, screen HAVING count(*) > 1',
          );
          expect(rows).toEqual([]);
        }
      }),
      { numRuns: 30 },
    );
  });

  it('validates input (422) and writes nothing', async () => {
    const { call } = makeClient(db.pool, true);
    const email = `svv.${uniq()}@smretail.com`;
    await insertAppUser(db.pool, email);
    const before = await writeCounts(db.pool);
    const bad = [
      { screen: 'SCR-999', name: 'x', query: '' },
      { screen: 'SCR-020', name: '   ', query: '' },
      { screen: 'SCR-020', name: 'x'.repeat(81), query: '' },
      { screen: 'SCR-020', name: 'x', query: 'a'.repeat(2001) },
      { screen: 'SCR-020', name: 'x', query: '', userId: 'someone-else' },
    ];
    for (const body of bad) {
      expect((await call({ email, role: 'PLN', method: 'POST', path: '/saved-views', body })).status).toBe(422);
    }
    expect((await call({ email, role: 'PLN', path: '/saved-views?screen=nope' })).status).toBe(422);
    expect(await writeCounts(db.pool)).toEqual(before);
  });

  it('records the rename with before/after so the audit trail shows what changed', async () => {
    const { call } = makeClient(db.pool, true);
    const email = `sva.${uniq()}@smretail.com`;
    await insertAppUser(db.pool, email);
    const created = (await call({ email, role: 'PLN', method: 'POST', path: '/saved-views', body: { screen: 'SCR-020', name: 'Old', query: 'region=r1' } })).body as SavedView;
    await call({ email, role: 'PLN', method: 'PATCH', path: `/saved-views/${created.id}`, body: { name: 'New' } });
    const event = await one<{ action: string; event: string; before: { name: string }; after: { name: string } }>(
      db.pool,
      'SELECT action, event, before, after FROM audit_event ORDER BY seq DESC LIMIT 1',
    );
    expect(event).toMatchObject({ action: 'edit', event: 'saved_view.updated', before: { name: 'Old' }, after: { name: 'New' } });
    await call({ email, role: 'PLN', method: 'DELETE', path: `/saved-views/${created.id}` });
    const deleted = await one<{ action: string; event: string; after: unknown }>(
      db.pool,
      'SELECT action, event, after FROM audit_event ORDER BY seq DESC LIMIT 1',
    );
    expect(deleted).toEqual({ action: 'edit', event: 'saved_view.deleted', after: null });
  });
});
