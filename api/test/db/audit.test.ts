/**
 * audit.record / withAuditedTransaction (task 5.2; Req 22, P7, P12).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  actorFromPrincipal,
  audit,
  AuditInvariantError,
  withAuditedTransaction,
  type Actor,
} from '../../src/db/audit.js';
import { ApiError } from '../../src/http/errors.js';
import { insertUser } from '../support/fixtures.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';

let db: TestDatabase;
let actor: Actor;

beforeAll(async () => {
  db = await createTestDatabase();
  actor = { userId: await insertUser(db.pool), activeRole: 'RST', requestId: 'req-1' };
});
afterAll(async () => {
  await db.dispose();
});

async function countEvents(): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_event');
  return rows[0]?.n ?? 0;
}

async function regionCount(code: string): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM region WHERE code = $1', [code]);
  return rows[0]?.n ?? 0;
}

describe('withAuditedTransaction', () => {
  it('commits the mutation together with exactly one audit event carrying user, active role and before/after', async () => {
    const before = await countEvents();
    const event = await withAuditedTransaction(db.pool, actor, async (tx) => {
      await tx.query(`INSERT INTO region (code, name) VALUES ('NCR-A', 'NCR A')`);
      return audit.record(tx, {
        action: 'create',
        event: 'region.created',
        objectType: 'region',
        objectId: 'NCR-A',
        after: { code: 'NCR-A' },
      });
    });
    expect(await countEvents()).toBe(before + 1);
    expect(await regionCount('NCR-A')).toBe(1);
    expect(event).toMatchObject({
      userId: actor.userId,
      activeRole: 'RST',
      action: 'create',
      event: 'region.created',
      objectType: 'region',
      objectId: 'NCR-A',
      before: null,
      after: { code: 'NCR-A' },
      requestId: 'req-1',
    });
    expect(Number.isNaN(Date.parse(event.at))).toBe(false);

    const [listed] = await audit.list(db.pool, { objectType: 'region', objectId: 'NCR-A' });
    expect(listed).toEqual(event);
  });

  it('rolls back a mutation that records no audit event', async () => {
    const before = await countEvents();
    await expect(
      withAuditedTransaction(db.pool, actor, async (tx) => {
        await tx.query(`INSERT INTO region (code, name) VALUES ('NCR-B', 'NCR B')`);
      }),
    ).rejects.toBeInstanceOf(AuditInvariantError);
    expect(await regionCount('NCR-B')).toBe(0);
    expect(await countEvents()).toBe(before);
  });

  it('rolls back a mutation that tries to record a second audit event', async () => {
    const before = await countEvents();
    const input = { action: 'edit', event: 'region.updated', objectType: 'region', objectId: 'x' } as const;
    await expect(
      withAuditedTransaction(db.pool, actor, async (tx) => {
        await tx.query(`INSERT INTO region (code, name) VALUES ('NCR-C', 'NCR C')`);
        await audit.record(tx, input);
        await audit.record(tx, input);
      }),
    ).rejects.toBeInstanceOf(AuditInvariantError);
    expect(await regionCount('NCR-C')).toBe(0);
    expect(await countEvents()).toBe(before);
  });

  it('writes no audit event when the mutation fails after recording', async () => {
    const before = await countEvents();
    await expect(
      withAuditedTransaction(db.pool, actor, async (tx) => {
        await audit.record(tx, { action: 'create', event: 'region.created', objectType: 'region', objectId: 'y' });
        await tx.query(`INSERT INTO region (code, name) VALUES ('NCR-A', 'duplicate')`);
      }),
    ).rejects.toMatchObject({ code: '23505' });
    expect(await countEvents()).toBe(before);
  });

  it('rejects malformed event names and a create with a before image', async () => {
    await expect(
      withAuditedTransaction(db.pool, actor, (tx) =>
        audit.record(tx, { action: 'create', event: 'Bad Name', objectType: 'region', objectId: 'z' }),
      ),
    ).rejects.toThrow();
    await expect(
      withAuditedTransaction(db.pool, actor, (tx) =>
        audit.record(tx, {
          action: 'create',
          event: 'region.created',
          objectType: 'region',
          objectId: 'z',
          before: { a: 1 },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('actorFromPrincipal (P12)', () => {
  it('requires an active role', () => {
    expect(() =>
      actorFromPrincipal({ userId: 'u', email: 'a@smretail.com', activeRole: null, assignments: [] }, 'r'),
    ).toThrowError(ApiError);
    expect(
      actorFromPrincipal({ userId: 'u', email: 'a@smretail.com', activeRole: 'PLN', assignments: [] }, 'r'),
    ).toEqual({ userId: 'u', activeRole: 'PLN', requestId: 'r' });
  });
});
