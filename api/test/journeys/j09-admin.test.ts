/**
 * Journey J9 — the Administrator assigns a production role (used when the
 * demo role switcher is off), on the seeded demo network through the real
 * routes with a fake Cognito directory (never AWS) (Req 1, 2, 22; P7, P12,
 * P13).
 *
 * The Administrator invites a user and changes the seeded HR partner's roles;
 * each change is one `role_change` audit event naming the Administrator and
 * the role they acted in. With the switcher off, the new role takes effect on
 * the user's next request and is revoked just as directly; non-administrators
 * (and the Administrator acting in another role) are refused, and an email
 * outside smretail.com / 1cloudhub.com never gets an account.
 */
import type { AdminUser, ApprovalDetail, AuditLogResponse, RoleCode, ScenarioDetail } from '@lanewise/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_SEASON, demoUserId } from '../../src/db/demo/dataset.js';
import { setupJourney, type Journey } from './support.js';

let j: Journey;
const ADM = { userId: demoUserId('ADM'), role: 'ADM' as const };
const HR_USER = demoUserId('HR');

beforeAll(async () => {
  j = await setupJourney();
}, 120_000);

afterAll(async () => {
  await j?.dispose();
});

beforeEach(() => {
  j.directory.calls.length = 0;
});

const adm = (method: string, path: string, body?: unknown) => j.call('ADM', method, path, body === undefined ? {} : { body });
/** As the seeded HR partner in `role`, with production RBAC (no role switcher). */
const hrAs = (role: RoleCode, method: string, path: string, body?: unknown) =>
  j.as(j.emails.HR, role, method, path, { strict: true, ...(body === undefined ? {} : { body }) });

describe('J9 — users and roles', () => {
  it('only the System Admin reaches user administration (P12), including the Admin user acting in another role', async () => {
    const list = await adm('GET', '/admin/users');
    expect(list.status).toBe(200);
    expect((list.body.users as AdminUser[]).map((u) => u.email)).toEqual(expect.arrayContaining(Object.values(j.emails)));
    for (const role of ['EXE', 'PLN', 'STM', 'HR', 'FIN', 'RST', 'STF'] as const) {
      expect((await j.call(role, 'GET', '/admin/users')).status, role).toBe(403);
      await j.audited({ status: 403 }, () => j.call(role, 'PATCH', `/admin/users/${HR_USER}`, { body: { roles: ['HR', 'FIN'] } }));
    }
    await j.audited({ status: 403 }, () => j.as(j.emails.ADM, 'EXE', 'PATCH', `/admin/users/${HR_USER}`, { body: { roles: ['HR', 'FIN'] } }));
    expect(j.directory.calls).toEqual([]);
  });

  it('P13: an email outside smretail.com / 1cloudhub.com is refused; no account, no audit, no invitation', async () => {
    for (const email of ['ana.reyes@gmail.com', 'ana@smretail.com.evil.io', 'ana@notsmretail.com', 'ana@1cloudhub.co']) {
      const { res } = await j.audited({ status: 422 }, () => adm('POST', '/admin/users', { email, roles: ['PLN'], scope: { type: 'global' } }));
      expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'body.email' })]);
      expect(await j.count('SELECT 1 FROM app_user WHERE email = $1', [email.toLowerCase()])).toBe(0);
    }
    expect(j.directory.calls).toEqual([]);
  });

  it('invites a user on an allowed domain: one audit event, one (fake) Cognito invitation', async () => {
    const email = 'j09.planner@1cloudhub.com';
    const { res, event } = await j.audited({ status: 201, ...ADM, event: 'user.invited' }, () =>
      adm('POST', '/admin/users', { email, name: 'Ana Reyes', roles: ['PLN'], scope: { type: 'global' } }),
    );
    expect(res.body.user).toMatchObject({ email, status: 'invited', roles: ['PLN'] });
    expect(event?.object_id).toBe(res.body.user.id);
    expect(j.directory.calls).toEqual([{ op: 'invite', email, resend: false }]);
  });

  it('grants HR the Finance role: one role_change event (user + active role); it applies on the next request', async () => {
    // Before: production RBAC refuses Finance for the HR partner.
    expect((await hrAs('FIN', 'GET', '/rule-sets')).status).toBe(403);

    const { res, event } = await j.audited({ status: 200, ...ADM, event: 'user.access_updated' }, () =>
      adm('PATCH', `/admin/users/${HR_USER}`, { roles: ['HR', 'FIN'], scope: { type: 'global' } }),
    );
    expect(event).toMatchObject({ action: 'role_change', object_id: HR_USER });
    expect(JSON.stringify(event?.after)).toContain('FIN');
    expect(res.body.user).toMatchObject({ roles: ['HR', 'FIN'] });

    // A Planner submits a scenario; the HR partner, now also Finance, approves the budget as Finance…
    const created = await j.call('PLN', 'POST', '/scenarios', { body: { name: 'J9 check', season: DEMO_SEASON } });
    const id = (created.body.scenario as ScenarioDetail).id;
    expect((await j.call('PLN', 'POST', `/scenarios/${id}/run`, { body: {} })).status).toBe(201);
    expect((await j.call('PLN', 'POST', `/scenarios/${id}/submit`, { body: {} })).status).toBe(200);
    const { res: budget } = await j.audited({ status: 200, userId: HR_USER, role: 'FIN' }, () =>
      hrAs('FIN', 'POST', `/approvals/${id}/budget`, { decision: 'approve' }),
    );
    expect((budget.body.approval as ApprovalDetail).steps[1]).toMatchObject({ status: 'approved', decidedAsRole: 'FIN', decidedBy: { id: HR_USER } });
    // …and the headcount as HR; each audit row records the role the user acted in (P12).
    await j.audited({ status: 200, userId: HR_USER, role: 'HR' }, () => hrAs('HR', 'POST', `/approvals/${id}/headcount`, { decision: 'approve' }));
    // A role they don't hold is refused (no role switcher).
    await j.audited({ status: 403 }, () => hrAs('PLN', 'GET', '/scenarios'));
  });

  it('revoking the role takes effect immediately; the Admin can’t remove their own Admin role', async () => {
    await j.audited({ status: 200, ...ADM, event: 'user.access_updated' }, () => adm('PATCH', `/admin/users/${HR_USER}`, { roles: ['HR'] }));
    expect((await hrAs('FIN', 'GET', '/rule-sets')).status).toBe(403);
    expect((await hrAs('HR', 'GET', '/rule-sets')).status).toBe(200);
    await j.audited({ status: 409 }, () => adm('PATCH', `/admin/users/${demoUserId('ADM')}`, { roles: ['PLN'], scope: { type: 'global' } }));
  });

  it('the audit log shows the role changes to the Administrator; the Rules Steward and others can’t export it', async () => {
    const log = await j.call('ADM', 'GET', '/audit-events', { query: { category: 'user' } });
    expect(log.status, JSON.stringify(log.body)).toBe(200);
    const changes = (log.body as AuditLogResponse).events.filter((e) => e.event === 'user.access_updated' && e.objectId === HR_USER);
    expect(changes).toHaveLength(2); // granted, then revoked
    for (const e of changes) expect(e).toMatchObject({ action: 'role_change', activeRole: 'ADM', user: { id: demoUserId('ADM') } });
    // The Rules Steward sees data and rules events only — never role changes.
    const rst = await j.call('RST', 'GET', '/audit-events');
    expect(rst.status).toBe(200);
    expect((rst.body as AuditLogResponse).events.some((e) => e.action === 'role_change')).toBe(false);
    expect((await j.call('RST', 'GET', '/audit-events/export')).status).toBe(403);
    expect((await j.call('HR', 'GET', '/audit-events')).status).toBe(403);
  });

  it('deactivating a user disables them in the directory and refuses their next request', async () => {
    const email = 'j09.deactivate@smretail.com';
    const invited = await adm('POST', '/admin/users', { email, roles: ['EXE'], scope: { type: 'global' } });
    expect(invited.status).toBe(201);
    expect((await j.as(email, 'EXE', 'GET', '/approvals', { strict: true })).status).toBe(200);
    await j.audited({ status: 200, ...ADM }, () => adm('POST', `/admin/users/${invited.body.user.id}/deactivate`));
    expect(j.directory.calls).toContainEqual({ op: 'disable', email, resend: false });
    expect((await j.as(email, 'EXE', 'GET', '/approvals', { strict: true })).status).toBe(403);
  });
});
