/**
 * Task 19 — `/notifications` and `/notification-preferences` (requirement 20;
 * P1, P7, P11, P12):
 *  - a user only ever sees, counts and marks read the notifications addressed
 *    to them, whatever role is active; someone else's notification is the same
 *    404 as a missing one and nothing changes;
 *  - the list honours the in-app preferences (critical items always show) and
 *    the category filters;
 *  - preference changes write exactly one audit event; a no-op or a refused
 *    change (approvals / security off) writes none.
 */
import {
  NOTIFICATION_EVENT_NAMES,
  NOTIFICATION_FILTERS,
  NOTIFICATION_FILTER_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  ROLE_CODES,
  notificationCategory,
  showsInApp,
  type NotificationFilter,
  type NotificationItem,
  type NotificationListResponse,
  type NotificationPreferenceOverrides,
  type NotificationPreferencesResponse,
  type NotificationSeverity,
  type RoleCode,
} from '@lanewise/shared';
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

const MISSING_ID = '6f1c7a52-0b8e-4d5e-9a41-5e2b1c9d7f00';

interface Seeded {
  readonly id: string;
  readonly owner: number;
  readonly event: string;
  readonly severity: NotificationSeverity;
  read: boolean;
}

const notificationArb = fc.record({
  owner: fc.nat(2),
  event: fc.oneof(fc.constantFrom(...NOTIFICATION_EVENT_NAMES), fc.constant('legacy.event')),
  severity: fc.constantFrom(...NOTIFICATION_SEVERITIES),
  read: fc.boolean(),
});

const hiddenArb = fc.uniqueArray(fc.constantFrom('plans', 'scenarios', 'data', 'rules', 'roster', 'offers'), { maxLength: 3 });

function expectedVisible(n: Seeded, hidden: readonly string[], filter: NotificationFilter): boolean {
  const overrides = Object.fromEntries(hidden.map((c) => [c, { in_app: false }])) as NotificationPreferenceOverrides;
  if (!showsInApp(n.event, n.severity, overrides)) return false;
  if (filter === 'all') return true;
  if (filter === 'unread') return !n.read;
  const category = notificationCategory(n.event);
  return category !== null && NOTIFICATION_FILTER_CATEGORIES[filter].includes(category);
}

describe('P11 — a user only ever sees notifications addressed to them', () => {
  it('list, unread count, mark read and mark all read stay within the caller’s own notifications', async () => {
    const { call } = makeClient(db.pool, true);
    await fc.assert(
      fc.asyncProperty(
        fc.array(notificationArb, { minLength: 1, maxLength: 12 }),
        fc.array(hiddenArb, { minLength: 3, maxLength: 3 }),
        fc.constantFrom(...ROLE_CODES),
        fc.nat(2),
        fc.constantFrom(...NOTIFICATION_FILTERS),
        fc.nat(20),
        async (rows, hiddenPerUser, role, reader, filter, pick) => {
          const users = await Promise.all(
            [0, 1, 2].map(async () => {
              const email = `nt.${uniq()}@smretail.com`;
              return { email, id: await insertAppUser(db.pool, email) };
            }),
          );
          for (const [i, hidden] of hiddenPerUser.entries()) {
            for (const c of hidden) {
              await db.pool.query(
                `INSERT INTO notification_preference (user_id, event, channel, enabled) VALUES ($1, $2, 'in_app', false)`,
                [users[i]!.id, c],
              );
            }
          }
          const seeded: Seeded[] = [];
          for (const r of rows) {
            const row = await one<{ id: string }>(
              db.pool,
              `INSERT INTO notification (user_id, event, object_type, object_id, severity, read_at)
               VALUES ($1, $2, 'scenario', $3, $4, CASE WHEN $5 THEN now() END) RETURNING id`,
              [users[r.owner]!.id, r.event, MISSING_ID, r.severity, r.read],
            );
            seeded.push({ id: row.id, owner: r.owner, event: r.event, severity: r.severity, read: r.read });
          }
          const me = users[reader]!;
          const hidden = hiddenPerUser[reader]!;
          const as = { email: me.email, role };

          // List: exactly my visible notifications for the filter.
          const res = await call({ path: `/notifications?filter=${filter}&limit=100`, ...as });
          expect(res.status).toBe(200);
          const list = res.body as NotificationListResponse;
          const mine = seeded.filter((n) => n.owner === reader);
          expect(list.items.map((i) => i.id).sort()).toEqual(
            mine.filter((n) => expectedVisible(n, hidden, filter)).map((n) => n.id).sort(),
          );
          expect(list.unreadCount).toBe(mine.filter((n) => !n.read && expectedVisible(n, hidden, 'all')).length);

          // Mark one read: mine → 200 and read; anyone else's (or missing) → 404, nothing changes.
          const target = seeded[pick % seeded.length]!;
          const before = await writeCounts(db.pool);
          const readAtBefore = await one<{ read_at: Date | null }>(db.pool, 'SELECT read_at FROM notification WHERE id = $1', [target.id]);
          const marked = await call({ method: 'POST', path: `/notifications/${target.id}/read`, ...as });
          if (target.owner === reader) {
            expect(marked.status).toBe(200);
            expect((marked.body as NotificationItem).readAt).not.toBeNull();
          } else {
            expect(marked.status).toBe(404);
            const after = await one<{ read_at: Date | null }>(db.pool, 'SELECT read_at FROM notification WHERE id = $1', [target.id]);
            expect(after.read_at).toEqual(readAtBefore.read_at);
          }
          expect(await writeCounts(db.pool)).toEqual(before);

          // Mark all read never touches another user's notifications.
          const othersUnread = async () =>
            (
              await one<{ n: number }>(
                db.pool,
                'SELECT count(*)::int AS n FROM notification WHERE user_id <> $1 AND user_id = ANY($2::uuid[]) AND read_at IS NULL',
                [me.id, users.map((u) => u.id)],
              )
            ).n;
          const othersBefore = await othersUnread();
          const all = await call({ method: 'POST', path: '/notifications/read-all', body: {}, ...as });
          expect(all.status).toBe(200);
          expect(await othersUnread()).toBe(othersBefore);
          const left = await one<{ n: number }>(db.pool, 'SELECT count(*)::int AS n FROM notification WHERE user_id = $1 AND read_at IS NULL', [me.id]);
          expect(left.n).toBe(0);
        },
      ),
      { numRuns: 40 },
    );
  });

  it('a malformed or missing id is a 404 and an anonymous caller is a 401', async () => {
    const { call } = makeClient(db.pool, true);
    const email = `nt404.${uniq()}@smretail.com`;
    await insertAppUser(db.pool, email);
    expect((await call({ method: 'POST', path: '/notifications/not-a-uuid/read', email, role: 'STF' })).status).toBe(404);
    expect((await call({ method: 'POST', path: `/notifications/${MISSING_ID}/read`, email, role: 'PLN' })).status).toBe(404);
    expect((await call({ path: '/notifications', email: null })).status).toBe(401);
  });

  it('pages newest first with nextBefore', async () => {
    const { call } = makeClient(db.pool, true);
    const email = `ntp.${uniq()}@smretail.com`;
    const userId = await insertAppUser(db.pool, email);
    for (let i = 0; i < 5; i += 1) {
      await db.pool.query(
        `INSERT INTO notification (user_id, event, object_type, object_id, created_at)
         VALUES ($1, 'scenario.stale', 'scenario', $2, now() - make_interval(mins => $3))`,
        [userId, MISSING_ID, i],
      );
    }
    const first = (await call({ path: '/notifications?limit=3', email, role: 'PLN' })).body as NotificationListResponse;
    expect(first.items).toHaveLength(3);
    expect(first.nextBefore).not.toBeNull();
    const second = (await call({ path: `/notifications?limit=3&before=${encodeURIComponent(first.nextBefore!)}`, email, role: 'PLN' }))
      .body as NotificationListResponse;
    expect(second.items).toHaveLength(2);
    expect(second.nextBefore).toBeNull();
    const times = [...first.items, ...second.items].map((i) => i.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(first.items[0]!.link).toBe(`/scenarios/${MISSING_ID}/settings`);
  });
});

describe('notification preferences (requirement 20.3; P7)', () => {
  it('changes are audited once, no-ops and refused changes write nothing', async () => {
    const { call } = makeClient(db.pool, true);
    const email = `npref.${uniq()}@smretail.com`;
    const userId = await insertAppUser(db.pool, email);
    const role: RoleCode = 'HR';

    const initial = (await call({ path: '/notification-preferences', email, role })).body as NotificationPreferencesResponse;
    expect(initial.language).toBe('en');
    expect(initial.preferences.every((p) => p.inApp && p.email)).toBe(true);
    expect(initial.preferences.filter((p) => p.locked).map((p) => p.category)).toEqual(['approvals', 'security']);

    let before = await writeCounts(db.pool);
    const changed = await call({
      method: 'PUT',
      path: '/notification-preferences',
      email,
      role,
      body: { preferences: [{ category: 'scenarios', email: false }, { category: 'data', inApp: false }] },
    });
    expect(changed.status).toBe(200);
    const prefs = (changed.body as NotificationPreferencesResponse).preferences;
    expect(prefs.find((p) => p.category === 'scenarios')).toMatchObject({ inApp: true, email: false });
    expect(prefs.find((p) => p.category === 'data')).toMatchObject({ inApp: false, email: true });
    expect((await writeCounts(db.pool)).audit).toBe(before.audit + 1);
    const event = await one<Record<string, unknown>>(
      db.pool,
      'SELECT user_id, active_role, action, event, object_id, before, after FROM audit_event ORDER BY seq DESC LIMIT 1',
    );
    expect(event).toMatchObject({
      user_id: userId,
      active_role: role,
      action: 'edit',
      event: 'notification_preference.updated',
      object_id: userId,
      before: { scenarios: { inApp: true, email: true }, data: { inApp: true, email: true } },
      after: { scenarios: { inApp: true, email: false }, data: { inApp: false, email: true } },
    });

    before = await writeCounts(db.pool);
    const same = await call({ method: 'PUT', path: '/notification-preferences', email, role, body: { preferences: [{ category: 'scenarios', email: false }] } });
    expect(same.status).toBe(200);
    expect(await writeCounts(db.pool)).toEqual(before);

    const refused = await call({ method: 'PUT', path: '/notification-preferences', email, role, body: { preferences: [{ category: 'approvals', email: false }] } });
    expect(refused.status).toBe(422);
    expect(await writeCounts(db.pool)).toEqual(before);
    const rows = await one<{ n: number }>(db.pool, `SELECT count(*)::int AS n FROM notification_preference WHERE user_id = $1 AND event = 'approvals'`, [userId]);
    expect(rows.n).toBe(0);

    const invalid = await call({ method: 'PUT', path: '/notification-preferences', email, role, body: { preferences: [{ category: 'nope', email: false }] } });
    expect(invalid.status).toBe(422);
  });

  it('the database refuses turning a mandatory category off', async () => {
    const userId = await insertAppUser(db.pool, `npdb.${uniq()}@smretail.com`);
    await expect(
      db.pool.query(`INSERT INTO notification_preference (user_id, event, channel, enabled) VALUES ($1, 'security', 'email', false)`, [userId]),
    ).rejects.toThrow(/notification_preference_mandatory_on/);
  });

  it('notification content is immutable and a read notification stays read', async () => {
    const userId = await insertAppUser(db.pool, `nimm.${uniq()}@smretail.com`);
    const n = await one<{ id: string }>(
      db.pool,
      `INSERT INTO notification (user_id, event, object_type, object_id) VALUES ($1, 'scenario.stale', 'scenario', 'x') RETURNING id`,
      [userId],
    );
    await expect(db.pool.query(`UPDATE notification SET params = '{"a":1}' WHERE id = $1`, [n.id])).rejects.toThrow(/immutable/);
    await db.pool.query('UPDATE notification SET read_at = now() WHERE id = $1', [n.id]);
    await expect(db.pool.query('UPDATE notification SET read_at = NULL WHERE id = $1', [n.id])).rejects.toThrow(/stays read/);
    await db.pool.query(`UPDATE notification SET email_status = 'sent' WHERE id = $1`, [n.id]);
  });
});
