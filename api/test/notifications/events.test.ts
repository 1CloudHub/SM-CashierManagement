/**
 * Task 19 — notifications raised by domain events (requirement 20.1, 20.4;
 * P1, P11): role recipients are filtered by scope, Staff are only notified by
 * name about their own shifts and offers, the actor never notifies themself,
 * and the approval flow notifies HR, Finance, the Executive and the owner.
 */
import type { RoleCode, Scope } from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit, withAuditedTransaction, type Actor, type AuditedTx } from '../../src/db/audit.js';
import { decideApprovalStep, recordSecuredOutside, submitScenario } from '../../src/db/repositories/scenarios.js';
import { notifyOfferResolved, notifyOfferSent, notifyShiftChanged } from '../../src/notifications/events.js';
import { notify } from '../../src/notifications/notify.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { insertPublishedRosterWithShift, insertScenario } from '../support/fixtures.js';
import { insertAppUser, one, setAssignments, uniq } from '../support/rbac.js';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.dispose();
});

/** Runs `fn` as `actor` in an audited transaction (records the one audit event itself). */
async function asActor<T>(actor: Actor, fn: (tx: AuditedTx) => Promise<T>, recordAudit = true): Promise<T> {
  return withAuditedTransaction(db.pool, actor, async (tx) => {
    const out = await fn(tx);
    if (recordAudit) {
      await audit.record(tx, { action: 'edit', event: 'test.event', objectType: 'test', objectId: 'x' });
    }
    return out;
  });
}

async function newUser(role: RoleCode, scope: Scope): Promise<string> {
  const id = await insertAppUser(db.pool, `ev.${uniq()}@smretail.com`);
  await setAssignments(db.pool, id, [{ role, scope }]);
  return id;
}

async function notifiedFor(objectId: string, event: string): Promise<string[]> {
  const { rows } = await db.pool.query<{ user_id: string }>(
    'SELECT user_id FROM notification WHERE object_id = $1 AND event = $2 ORDER BY user_id',
    [objectId, event],
  );
  return rows.map((r) => r.user_id);
}

describe('scope filtering of role recipients (requirement 20.4)', () => {
  it('a store-bound event reaches only role holders whose scope covers one of its stores', async () => {
    const regions = [];
    for (let i = 0; i < 2; i += 1) {
      regions.push((await one<{ id: string }>(db.pool, `INSERT INTO region (code, name) VALUES ($1, 'R') RETURNING id`, [`R-${uniq()}`])).id);
    }
    const stores: { id: string; regionId: string }[] = [];
    for (const regionId of regions) {
      for (let k = 0; k < 2; k += 1) {
        const { id } = await one<{ id: string }>(
          db.pool,
          `INSERT INTO store (code, name, format, region_id) VALUES ($1, 'SM', 'sm_supermarket', $2) RETURNING id`,
          [`S-${uniq()}`, regionId],
        );
        stores.push({ id, regionId });
      }
    }
    const actor: Actor = { userId: await insertAppUser(db.pool, `actor.${uniq()}@smretail.com`), activeRole: 'PLN', requestId: null };
    const scopeArb: fc.Arbitrary<Scope> = fc.oneof(
      fc.constant<Scope>({ type: 'global' }),
      fc.subarray(regions, { minLength: 1 }).map((regionIds): Scope => ({ type: 'region', regionIds })),
      fc.subarray(stores.map((s) => s.id), { minLength: 1 }).map((storeIds): Scope => ({ type: 'store', storeIds })),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.constantFrom<RoleCode>('PLN', 'STM', 'HR', 'FIN'), scopeArb), { minLength: 1, maxLength: 4 }),
        fc.subarray(stores, { minLength: 1 }),
        fc.subarray<RoleCode>(['PLN', 'STM', 'HR', 'STF'], { minLength: 1 }),
        async (holders, eventStores, roles) => {
          const users = await Promise.all(holders.map(([role, scope]) => newUser(role, scope)));
          const objectId = `obj-${uniq()}`;
          const notified = await asActor(actor, (tx) =>
            notify(tx, {
              event: 'roster.unfilled_shifts',
              objectType: 'roster',
              objectId,
              synthetic: false,
              recipients: { roles, storeIds: eventStores.map((s) => s.id) },
            }),
          );
          const covers = (scope: Scope) =>
            eventStores.some((s) =>
              scope.type === 'global' ? true : scope.type === 'region' ? scope.regionIds.includes(s.regionId) : scope.type === 'store' ? scope.storeIds.includes(s.id) : false,
            );
          const expected = users.filter((_, i) => roles.includes(holders[i]![0]) && covers(holders[i]![1])).sort();
          // Other test users may hold these roles globally; only check ours.
          expect(notified.filter((u) => users.includes(u))).toEqual(expected);
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('domain events', () => {
  it('submit → HR and Finance; secured outside → EXE/HR/FIN/owner, then plan ready; send back → owner, not the actor', async () => {
    const owner = await newUser('PLN', { type: 'global' });
    const hr = await newUser('HR', { type: 'global' });
    const fin = await newUser('FIN', { type: 'global' });
    const exe = await newUser('EXE', { type: 'global' });
    const staffUser = await newUser('STF', { type: 'self', staffId: '6f1c7a52-0b8e-4d5e-9a41-5e2b1c9d7f00' });
    const scenarioId = await insertScenario(db.pool, owner);
    await db.pool.query('UPDATE scenario SET last_run_at = now() WHERE id = $1', [scenarioId]);

    await asActor({ userId: owner, activeRole: 'PLN', requestId: null }, (tx) => submitScenario(tx, scenarioId), false);
    expect(await notifiedFor(scenarioId, 'approval.headcount_requested')).toContain(hr);
    expect(await notifiedFor(scenarioId, 'approval.headcount_requested')).not.toContain(fin);
    expect(await notifiedFor(scenarioId, 'approval.budget_requested')).toContain(fin);
    expect(await notifiedFor(scenarioId, 'approval.budget_requested')).not.toContain(staffUser);

    const exeActor: Actor = { userId: exe, activeRole: 'EXE', requestId: null };
    await asActor(exeActor, (tx) => recordSecuredOutside(tx, { scenarioId, step: 'headcount', reference: 'email Oct 3' }), false);
    const secured = await notifiedFor(scenarioId, 'approval.secured');
    expect(secured).toEqual(expect.arrayContaining([owner, hr, fin]));
    expect(secured).not.toContain(exe);
    expect(await notifiedFor(scenarioId, 'approval.plan_ready')).toEqual([]);

    // Both secured: the other Executives are told the plan is ready (not the actor).
    const otherExe = await newUser('EXE', { type: 'global' });
    await asActor(exeActor, (tx) => recordSecuredOutside(tx, { scenarioId, step: 'budget', reference: 'email Oct 4' }), false);
    const ready = await notifiedFor(scenarioId, 'approval.plan_ready');
    expect(ready).toContain(otherExe);
    expect(ready).not.toContain(exe);
    expect(ready).not.toContain(hr);

    await asActor(exeActor, (tx) => decideApprovalStep(tx, { scenarioId, step: 'plan', decision: 'changes_requested', comment: 'Fix Dec 24' }), false);
    const decided = await one<{ n: number; severity: string }>(
      db.pool,
      `SELECT count(*)::int AS n, min(severity) AS severity FROM notification WHERE object_id = $1 AND event = 'approval.decided' AND user_id = $2`,
      [scenarioId, owner],
    );
    expect(decided).toEqual({ n: 1, severity: 'warning' });
    expect(await notifiedFor(scenarioId, 'approval.decided')).not.toContain(exe);
  });

  it('a shift change notifies the affected cashier only (P11), plus planners/HR of that store on a rule override', async () => {
    const { storeId, rosterId, shiftId, staffId } = await insertPublishedRosterWithShift(db.pool);
    const cashierUser = await insertAppUser(db.pool, `cashier.${uniq()}@smretail.com`);
    await db.pool.query('UPDATE staff SET user_id = $1 WHERE id = $2', [cashierUser, staffId]);
    const otherStaffUser = await newUser('STF', { type: 'self', staffId });
    const manager = await newUser('STM', { type: 'store', storeIds: [storeId] });
    const plannerHere = await newUser('PLN', { type: 'store', storeIds: [storeId] });
    const plannerElsewhere = await newUser('PLN', { type: 'store', storeIds: ['6f1c7a52-0b8e-4d5e-9a41-5e2b1c9d7f00'] });
    const { id: overrideId } = await one<{ id: string }>(
      db.pool,
      `INSERT INTO shift_override (roster_id, shift_id, override_type, from_staff_id, reason, rule_breaches, created_by)
       VALUES ($1, $2, 'emergency_off', $3, 'sick', '[{"rule":"rest_24h"}]', $4) RETURNING id`,
      [rosterId, shiftId, staffId, manager],
    );
    const notified = await asActor({ userId: manager, activeRole: 'STM', requestId: null }, (tx) => notifyShiftChanged(tx, overrideId));
    expect(await notifiedFor(overrideId, 'shift.changed')).toEqual([cashierUser]);
    const breach = await notifiedFor(overrideId, 'roster.override_rule_breach');
    expect(breach).toContain(plannerHere);
    expect(breach).not.toContain(plannerElsewhere);
    expect(breach).not.toContain(otherStaffUser);
    expect(notified).not.toContain(manager);
  });

  it('an offer notifies the selected cashier; its outcome notifies the sender', async () => {
    const { shiftId, staffId } = await insertPublishedRosterWithShift(db.pool);
    const cashierUser = await insertAppUser(db.pool, `offer.${uniq()}@smretail.com`);
    await db.pool.query('UPDATE staff SET user_id = $1 WHERE id = $2', [cashierUser, staffId]);
    const sender = await newUser('PLN', { type: 'global' });
    const { id: offerId } = await one<{ id: string }>(
      db.pool,
      `INSERT INTO shift_offer (shift_id, staff_id, sent_by, expires_at, travel_min) VALUES ($1, $2, $3, now() + interval '1 day', 25) RETURNING id`,
      [shiftId, staffId, sender],
    );
    await asActor({ userId: sender, activeRole: 'PLN', requestId: null }, (tx) => notifyOfferSent(tx, offerId));
    const sent = await one<{ user_id: string; params: Record<string, unknown> }>(
      db.pool,
      `SELECT user_id, params FROM notification WHERE object_id = $1 AND event = 'offer.sent'`,
      [offerId],
    );
    expect(sent.user_id).toBe(cashierUser);
    expect(sent.params).toMatchObject({ storeName: 'SM Test', travelMinutes: 25 });

    await db.pool.query(`UPDATE shift_offer SET status = 'accepted', responded_at = now() WHERE id = $1`, [offerId]);
    await asActor({ userId: cashierUser, activeRole: 'STF', requestId: null }, (tx) => notifyOfferResolved(tx, offerId));
    expect(await notifiedFor(offerId, 'offer.resolved')).toEqual([sender]);
  });
});
