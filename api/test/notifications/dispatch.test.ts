/**
 * Task 19 — notification email (requirement 20.2, 20.3, 20.5):
 *  - property: a notification is emailed exactly when the recipient's
 *    preference allows it (approvals, security and critical items always;
 *    in-app-only events never), never to a disabled user or a demo persona,
 *    and in the recipient's language;
 *  - SES errors are retried, then the row is marked failed;
 *  - the API dispatches right after a successful write.
 */
import {
  LANGUAGES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENT_NAMES,
  NOTIFICATION_SEVERITIES,
  shouldEmail,
  type Language,
  type NotificationPreferenceOverrides,
} from '@lanewise/shared';
import fc from 'fast-check';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import { createApp, type AppDeps } from '../../src/app.js';
import { dispatchPendingEmails } from '../../src/notifications/dispatch.js';
import { EMAIL_COPY, renderEmail, type EmailMessage, type EmailSender } from '../../src/notifications/email.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { MemoryStorage } from '../support/memory-storage.js';
import { insertAppUser, one, routerClient, uniq } from '../support/rbac.js';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.dispose();
});

// Each test starts with no pending email from an earlier one.
beforeEach(async () => {
  await db.pool.query(`UPDATE notification SET email_status = 'skipped' WHERE email_status = 'pending'`);
});

class FakeSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  failures = 0;
  async send(message: EmailMessage): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('SES throttled');
    }
    this.sent.push(message);
  }
}

const BASE = 'https://lanewise.example';

const prefArb: fc.Arbitrary<NotificationPreferenceOverrides> = fc.dictionary(
  fc.constantFrom(...NOTIFICATION_CATEGORIES.filter((c) => c !== 'approvals' && c !== 'security')),
  fc.record({ email: fc.boolean() }),
) as fc.Arbitrary<NotificationPreferenceOverrides>;

const recipientArb = fc.record({
  language: fc.constantFrom(...LANGUAGES),
  status: fc.constantFrom('active', 'active', 'active', 'disabled'),
  synthetic: fc.constantFrom(false, false, false, true),
  prefs: prefArb,
});

describe('email only when the preference allows (property)', () => {
  it('sends exactly the notifications shouldEmail allows, to active real users, in their language', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(recipientArb, { minLength: 1, maxLength: 3 }),
        fc.array(
          fc.record({
            to: fc.nat(2),
            event: fc.oneof(fc.constantFrom(...NOTIFICATION_EVENT_NAMES), fc.constant('legacy.event')),
            severity: fc.constantFrom(...NOTIFICATION_SEVERITIES),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (recipients, notifications) => {
          const users: { id: string; email: string; language: Language; status: string; synthetic: boolean; prefs: NotificationPreferenceOverrides }[] = [];
          for (const r of recipients) {
            const email = `nd.${uniq()}@1cloudhub.com`;
            const { id } = await one<{ id: string }>(
              db.pool,
              'INSERT INTO app_user (email, name, status, language, synthetic) VALUES ($1, $2, $3, $4, $5) RETURNING id',
              [email, 'Juan dela Cruz', r.status, r.language, r.synthetic],
            );
            for (const [category, channels] of Object.entries(r.prefs)) {
              await db.pool.query(
                `INSERT INTO notification_preference (user_id, event, channel, enabled) VALUES ($1, $2, 'email', $3)`,
                [id, category, channels?.email],
              );
            }
            users.push({ id, email, ...r });
          }
          const expected = new Map<string, { email: string; language: Language }>();
          const ids: string[] = [];
          for (const n of notifications) {
            const user = users[n.to % users.length]!;
            const { id } = await one<{ id: string }>(
              db.pool,
              `INSERT INTO notification (user_id, event, object_type, object_id, severity, params)
               VALUES ($1, $2, 'scenario', $3, $4, '{"name":"Christmas 2026 v4"}') RETURNING id`,
              [user.id, n.event, '6f1c7a52-0b8e-4d5e-9a41-5e2b1c9d7f00', n.severity],
            );
            ids.push(id);
            if (user.status === 'active' && !user.synthetic && shouldEmail(n.event, n.severity, user.prefs)) {
              expected.set(id, { email: user.email, language: user.language });
            }
          }

          const sender = new FakeSender();
          const result = await dispatchPendingEmails(db.pool, sender, { appBaseUrl: BASE, limit: 50 });
          expect(result.sent).toBe(expected.size);
          expect(result.sent + result.skipped).toBe(notifications.length);
          expect(sender.sent.map((m) => m.to).sort()).toEqual([...expected.values()].map((e) => e.email).sort());
          for (const m of sender.sent) {
            const lang = [...expected.values()].find((e) => e.email === m.to)!.language;
            expect(m.text.startsWith(EMAIL_COPY[lang].greeting('Juan dela Cruz'))).toBe(true);
            expect(m.text).toContain(`${EMAIL_COPY[lang].open}: ${BASE}/`);
          }
          const { rows } = await db.pool.query<{ id: string; email_status: string }>(
            'SELECT id, email_status FROM notification WHERE id = ANY($1::uuid[])',
            [ids],
          );
          for (const row of rows) expect(row.email_status).toBe(expected.has(row.id) ? 'sent' : 'skipped');

          // Nothing is ever emailed twice.
          const again = new FakeSender();
          await dispatchPendingEmails(db.pool, again, { appBaseUrl: BASE });
          expect(again.sent).toEqual([]);
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('delivery failures', () => {
  it('retries a failed send and marks the row failed after the last attempt', async () => {
    const userId = await insertAppUser(db.pool, `ndf.${uniq()}@smretail.com`);
    const { id } = await one<{ id: string }>(
      db.pool,
      `INSERT INTO notification (user_id, event, object_type, object_id) VALUES ($1, 'rule_version.published', 'rule_version', 'x') RETURNING id`,
      [userId],
    );
    const sender = new FakeSender();
    sender.failures = 5;
    expect(await dispatchPendingEmails(db.pool, sender, { appBaseUrl: BASE, maxAttempts: 2 })).toMatchObject({ retrying: 1, sent: 0 });
    expect(await dispatchPendingEmails(db.pool, sender, { appBaseUrl: BASE, maxAttempts: 2 })).toMatchObject({ failed: 1 });
    const row = await one<{ email_status: string; email_attempts: number }>(db.pool, 'SELECT email_status, email_attempts FROM notification WHERE id = $1', [id]);
    expect(row).toEqual({ email_status: 'failed', email_attempts: 2 });

    const ok = await one<{ id: string }>(
      db.pool,
      `INSERT INTO notification (user_id, event, object_type, object_id) VALUES ($1, 'rule_version.published', 'rule_version', 'y') RETURNING id`,
      [userId],
    );
    const flaky = new FakeSender();
    flaky.failures = 1;
    await dispatchPendingEmails(db.pool, flaky, { appBaseUrl: BASE });
    await dispatchPendingEmails(db.pool, flaky, { appBaseUrl: BASE });
    expect(flaky.sent).toHaveLength(1);
    expect((await one<{ email_status: string }>(db.pool, 'SELECT email_status FROM notification WHERE id = $1', [ok.id])).email_status).toBe('sent');
  });
});

describe('templates (requirement 20.5)', () => {
  it('renders every catalogue event in both languages with an escaped deep link', () => {
    for (const event of NOTIFICATION_EVENT_NAMES) {
      for (const language of LANGUAGES) {
        const m = renderEmail(
          {
            event,
            severity: 'info',
            objectType: 'scenario',
            objectId: 'abc',
            objectName: '<Plan & "v4">',
            params: { step: 'budget', decision: 'approved', outcome: 'accepted', storeName: 'SM QC', fromStore: 'SM QC', startsAt: '2026-12-19T04:00:00Z' },
            synthetic: true,
          },
          { email: 'a@smretail.com', name: 'Ana', language },
          `${BASE}/`,
        );
        expect(m.subject.startsWith('LaneWise: ')).toBe(true);
        expect(m.subject).not.toMatch(/undefined|null|—\s*$/);
        expect(m.html).not.toContain('<Plan');
        expect(m.text).toContain(EMAIL_COPY[language].demo);
        expect(m.text).toContain(`${BASE}/`);
        expect(m.text).not.toContain(`${BASE}//`);
      }
    }
  });
});

describe('the API emails right after a write', () => {
  it('a successful write request dispatches pending notifications; a GET does not', async () => {
    const sender = new FakeSender();
    const storage = new MemoryStorage();
    const deps: AppDeps = {
      db: () => db.pool,
      rbac: { ...DEFAULT_RBAC_CONFIG, demoRoleSwitcher: true },
      storage: () => storage,
      emailSender: () => sender,
      appBaseUrl: BASE,
    };
    const { call } = routerClient(createApp(deps));
    const email = `ndapi.${uniq()}@smretail.com`;
    const userId = await insertAppUser(db.pool, email);
    await db.pool.query(
      `INSERT INTO notification (user_id, event, object_type, object_id) VALUES ($1, 'approval.plan_ready', 'scenario', 'abc')`,
      [userId],
    );
    await call({ path: '/notifications', email, role: 'EXE' });
    expect(sender.sent).toHaveLength(0);
    const res = await call({ method: 'POST', path: '/notifications/read-all', email, role: 'EXE', body: {} });
    expect(res.status).toBe(200);
    expect(sender.sent.map((m) => m.to)).toEqual([email]);
    expect(sender.sent[0]!.text).toContain(`${BASE}/approvals?scenario=abc`);
  });
});
