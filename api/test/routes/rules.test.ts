/**
 * `/rule-sets` and `/rule-versions` routes (task 10; Req 16; P6, P7, P12).
 *
 * Handlers run against a real PostgreSQL through the app router, as the
 * Lambda adapter would call them.
 */
import {
  ROLE_CODES,
  RULE_PERMISSIONS,
  RULE_PERMISSION_KEYS,
  type RoleCode,
  type RuleSetSummary,
  type RuleVersionDetail,
  type RuleVersionDiff,
} from '@lanewise/shared';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import { withAuditedTransaction } from '../../src/db/audit.js';
import * as rulesRepo from '../../src/db/repositories/rules.js';
import { ApiError } from '../../src/http/errors.js';
import { createLambdaHandler, type LambdaHandler } from '../../src/lambda.js';
import { RULE_ROUTES } from '../../src/routes/rules.js';
import { createTestDatabase, type TestDatabase } from '../support/db.js';
import { insertScenario } from '../support/fixtures.js';
import { insertAppUser, seedOrg, setAssignments, uniq } from '../support/rbac.js';

let db: TestDatabase;
let handler: LambdaHandler;
const users = {} as Record<RoleCode, string>;
const emails = {} as Record<RoleCode, string>;
let unassignedEmail: string;
const sets = {} as Record<'wages' | 'lead_times', string>;

interface Result {
  readonly statusCode: number;
  readonly body: unknown;
}

function lambdaFor(app: ReturnType<typeof createApp>): LambdaHandler {
  return createLambdaHandler({ router: app, env: 'test', logSink: () => undefined });
}

/**
 * Calls the real Lambda handler as API Gateway would: verified Cognito claims
 * for the role's user and the role in `X-Active-Role` (task 8.1). Error bodies
 * are flattened to `{ code, details }`.
 */
async function call(
  role: RoleCode | null,
  method: string,
  path: string,
  options: { body?: unknown; query?: Record<string, string>; anonymous?: boolean; via?: LambdaHandler; as?: RoleCode } = {},
): Promise<Result> {
  const headers: Record<string, string> = {};
  if (role !== null) headers['X-Active-Role'] = role;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const who = options.as ?? role;
  const email = who !== null ? emails[who] : unassignedEmail;
  const event = {
    httpMethod: method,
    path,
    resource: '/{proxy+}',
    headers,
    multiValueHeaders: {},
    queryStringParameters: options.query ?? null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    body: options.body === undefined ? null : JSON.stringify(options.body),
    isBase64Encoded: false,
    requestContext: {
      requestId: `req-${uniq()}`,
      authorizer: options.anonymous ? null : { claims: { sub: `sub-${email}`, email } },
    },
  } as unknown as APIGatewayProxyEvent;
  const res = await (options.via ?? handler)(event, { awsRequestId: 'aws' } as Context);
  const body = JSON.parse(res.body) as unknown;
  const error = (body as { error?: { code: string; details?: unknown[] } } | null)?.error;
  return { statusCode: res.statusCode, body: error ? { code: error.code, details: error.details ?? [] } : body };
}

async function auditCount(): Promise<number> {
  const { rows } = await db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_event');
  return rows[0]?.n ?? 0;
}

const WAGES = {
  hourlyRateByRegion: { NCR: 86.875, 'Central Visayas': 67.5 },
  defaultHourlyRate: 80,
  employerLoading: 0.14,
};

beforeAll(async () => {
  db = await createTestDatabase();
  handler = lambdaFor(createApp({ db: () => db.pool, rbac: { ...DEFAULT_RBAC_CONFIG, demoRoleSwitcher: false } }));
  const org = await seedOrg(db.pool);
  for (const role of ROLE_CODES) {
    emails[role] = `${role.toLowerCase()}.${uniq()}@smretail.com`;
    users[role] = await insertAppUser(db.pool, emails[role]);
    const scope =
      role === 'STF'
        ? { type: 'self' as const, staffId: org.demoStaffId }
        : role === 'STM'
          ? { type: 'store' as const, storeIds: [org.demoStoreId] }
          : { type: 'global' as const };
    await setAssignments(db.pool, users[role], [{ role, scope }]);
  }
  unassignedEmail = `nobody.${uniq()}@smretail.com`;
  await insertAppUser(db.pool, unassignedEmail);
  const actor = { userId: users.RST, activeRole: 'RST' as const, requestId: null };
  for (const type of ['wages', 'lead_times'] as const) {
    const set = await withAuditedTransaction(db.pool, actor, (tx) => rulesRepo.createRuleSet(tx, { type, name: type }));
    sets[type] = set.id;
  }
});

afterAll(async () => {
  await db?.dispose();
});

describe('route permissions (declared once per route; P12)', () => {
  it('every rule route declares exactly one known permission and is registered', () => {
    for (const route of RULE_ROUTES) {
      expect(RULE_PERMISSION_KEYS).toContain(route.permission);
      const sample = route.path.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');
      const app = createApp({ db: () => db.pool, rbac: DEFAULT_RBAC_CONFIG });
      expect(app.resolve(route.method, sample).kind, `${route.method} ${route.path}`).toBe('matched');
    }
  });

  it('refuses a role without the route permission and writes no audit event', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...RULE_ROUTES), fc.constantFrom(...ROLE_CODES), async (route, role) => {
        fc.pre(!RULE_PERMISSIONS[route.permission].includes(role));
        const before = await auditCount();
        const path = route.path.replace(':ruleSetId', sets.wages).replace(':versionId', '00000000-0000-4000-8000-000000000000');
        const res = await call(role, route.method, path, { body: {} });
        expect(res.statusCode).toBe(403);
        expect(await auditCount()).toBe(before);
      }),
      { numRuns: 60 },
    );
  });

  it('needs a signed-in user with an active role', async () => {
    expect((await call('PLN', 'GET', '/rule-sets', { anonymous: true })).statusCode).toBe(401);
    // A signed-in user without any role assignment has no active role.
    expect((await call(null, 'GET', '/rule-sets')).statusCode).toBe(403);
    // Outside demo mode a user can't activate a role they don't hold (a planner posing as Rules Steward).
    expect((await call('RST', 'POST', `/rule-sets/${sets.wages}/versions`, { as: 'PLN', body: {} })).statusCode).toBe(403);
    expect((await call('STF', 'GET', '/rule-sets')).statusCode).toBe(403);
  });
});

describe('cost-rule journey (Req 16.1, 16.3, 16.5, 16.6)', () => {
  let v1: RuleVersionDetail;

  it('rejects a payload that does not match the engine schema, field by field', async () => {
    const res = await call('RST', 'POST', `/rule-sets/${sets.wages}/versions`, {
      body: { effectiveFrom: '2026-01-01', payload: { ...WAGES, employerLoading: 3, extra: true } },
    });
    expect(res.statusCode).toBe(422);
    const paths = (res.body as { details: { path: string }[] }).details.map((d) => d.path).sort();
    expect(paths).toEqual(['body.payload.employerLoading', 'body.payload.extra']);
  });

  it('creates, submits, gets Finance approval and publishes, with one audit event per step', async () => {
    const pinned = await insertScenario(db.pool, users.PLN);

    const before = await auditCount();
    const created = await call('RST', 'POST', `/rule-sets/${sets.wages}/versions`, {
      body: { effectiveFrom: '2026-01-01', payload: WAGES },
    });
    expect(created.statusCode).toBe(201);
    v1 = (created.body as { version: RuleVersionDetail }).version;
    expect(v1).toMatchObject({ version: 1, status: 'draft', isCostRule: true, ruleSetType: 'wages' });

    // A change note is required before submitting.
    expect((await call('RST', 'POST', `/rule-versions/${v1.id}/submit`)).statusCode).toBe(422);
    expect(
      (await call('RST', 'PATCH', `/rule-versions/${v1.id}`, { body: { changeNote: 'Wage order NCR-25' } })).statusCode,
    ).toBe(200);
    expect((await call('RST', 'POST', `/rule-versions/${v1.id}/submit`)).statusCode).toBe(200);

    // Not publishable before Finance approves, and never by the Rules Steward (cost rule).
    expect((await call('FIN', 'POST', `/rule-versions/${v1.id}/publish`)).statusCode).toBe(409);
    expect((await call('RST', 'POST', `/rule-versions/${v1.id}/publish`)).statusCode).toBe(403);
    expect((await call('EXE', 'POST', `/rule-versions/${v1.id}/publish`)).statusCode).toBe(403);
    // Finance must comment to request changes.
    expect((await call('FIN', 'POST', `/rule-versions/${v1.id}/request-changes`, { body: { comment: ' ' } })).statusCode).toBe(422);
    const changes = await call('FIN', 'POST', `/rule-versions/${v1.id}/request-changes`, { body: { comment: 'Add Visayas' } });
    expect(changes.statusCode).toBe(200);
    expect((changes.body as { version: RuleVersionDetail }).version).toMatchObject({
      status: 'changes_requested',
      reviewComment: 'Add Visayas',
    });
    // Frozen content can't be edited by Finance or anyone once submitted; here the author edits again.
    expect(
      (await call('RST', 'PATCH', `/rule-versions/${v1.id}`, {
        body: { payload: { ...WAGES, hourlyRateByRegion: { ...WAGES.hourlyRateByRegion, 'Western Visayas': 66.25 } } },
      })).statusCode,
    ).toBe(200);
    expect((await call('RST', 'POST', `/rule-versions/${v1.id}/submit`)).statusCode).toBe(200);
    expect((await call('RST', 'POST', `/rule-versions/${v1.id}/approve`, { body: {} })).statusCode).toBe(403);
    expect((await call('FIN', 'POST', `/rule-versions/${v1.id}/approve`, { body: { comment: 'OK' } })).statusCode).toBe(200);
    const published = await call('FIN', 'POST', `/rule-versions/${v1.id}/publish`);
    expect(published.statusCode).toBe(200);
    expect(published.body).toMatchObject({ version: { status: 'published', financeApprovedBy: users.FIN }, staleScenarioIds: [] });
    // created, edited, submitted, changes_requested, edited, submitted, approved, published
    expect(await auditCount()).toBe(before + 8);

    // Pin a scenario to v1 and publish v2: the scenario goes stale and the diff shows the change.
    await db.pool.query(
      `INSERT INTO scenario_rule_version (scenario_id, rule_set_id, rule_version_id, synthetic) VALUES ($1, $2, $3, false)`,
      [pinned, sets.wages, v1.id],
    );
    const draft2 = await call('RST', 'POST', `/rule-sets/${sets.wages}/versions`, {
      body: { effectiveFrom: '2026-10-01', changeNote: 'Wage order 2026' },
    });
    expect(draft2.statusCode).toBe(201);
    const v2 = (draft2.body as { version: RuleVersionDetail }).version;
    // A new draft starts from the in-force version.
    expect(v2.payload).toEqual((await rulesRepo.getRuleVersion(db.pool, v1.id))?.payload);
    // Only one open draft at a time.
    expect(
      (await call('RST', 'POST', `/rule-sets/${sets.wages}/versions`, { body: { effectiveFrom: '2026-11-01' } })).statusCode,
    ).toBe(409);

    await call('RST', 'PATCH', `/rule-versions/${v2.id}`, {
      body: { payload: { ...WAGES, hourlyRateByRegion: { ...WAGES.hourlyRateByRegion, NCR: 90 } } },
    });
    const detail = await call('PLN', 'GET', `/rule-versions/${v2.id}`);
    expect(detail.body).toMatchObject({ impact: { scenarioIds: [pinned] } });

    const diff = await call('HR', 'GET', `/rule-versions/${v2.id}/diff`);
    expect(diff.statusCode).toBe(200);
    const d = diff.body as RuleVersionDiff;
    expect(d.fromVersionId).toBe(v1.id);
    expect(d.changes).toContainEqual({ path: ['hourlyRateByRegion', 'NCR'], kind: 'changed', before: 86.875, after: 90 });
    expect(d.changes).toContainEqual({ path: ['hourlyRateByRegion', 'Western Visayas'], kind: 'removed', before: 66.25 });

    await call('RST', 'POST', `/rule-versions/${v2.id}/submit`);
    await call('FIN', 'POST', `/rule-versions/${v2.id}/approve`, { body: {} });
    const pub2 = await call('FIN', 'POST', `/rule-versions/${v2.id}/publish`);
    expect(pub2.body).toMatchObject({ staleScenarioIds: [pinned], supersededVersionId: v1.id });

    const history = await call('EXE', 'GET', `/rule-sets/${sets.wages}/versions`);
    expect((history.body as { versions: { version: number; status: string }[] }).versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'published'],
      [1, 'superseded'],
    ]);
    // P6: the superseded version is unchanged.
    expect((await rulesRepo.getRuleVersion(db.pool, v1.id))?.payload).toEqual((published.body as { version: RuleVersionDetail }).version.payload);
  });
});

describe('non-cost rules (Req 16.4)', () => {
  it('the Rules Steward publishes directly; Finance cannot approve or publish them', async () => {
    const payload = {
      leadTimeDays: { FT: 42, PT: 28, FLOAT: 21 },
      contractWeeklyHours: { FT: 48, PT: 24, FLOAT: 32 },
      recruitingBuffer: 0.1,
      milestones: [{ name: 'Start on the floor', daysBeforeNeedBy: { FT: 0, PT: 0, FLOAT: 0 } }],
    };
    const created = await call('RST', 'POST', `/rule-sets/${sets.lead_times}/versions`, {
      body: { effectiveFrom: '2026-01-01', payload, changeNote: 'Initial lead times' },
    });
    const id = (created.body as { version: RuleVersionDetail }).version.id;
    expect((await call('FIN', 'POST', `/rule-versions/${id}/approve`, { body: {} })).statusCode).toBe(409);
    expect((await call('FIN', 'POST', `/rule-versions/${id}/publish`)).statusCode).toBe(403);
    const res = await call('RST', 'POST', `/rule-versions/${id}/publish`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ version: { status: 'published', financeApprovedBy: null } });
  });

  it('a new draft for a rule set without any version needs a payload', async () => {
    const actor = { userId: users.RST, activeRole: 'RST' as const, requestId: null };
    const labor = await withAuditedTransaction(db.pool, actor, (tx) => rulesRepo.createRuleSet(tx, { type: 'labor', name: 'Labor' }));
    const res = await call('RST', 'POST', `/rule-sets/${labor.id}/versions`, { body: { effectiveFrom: '2026-01-01' } });
    expect(res.statusCode).toBe(422);
  });
});

describe('reads', () => {
  it('lists every rule set with its current and open versions and usage (SCR-060)', async () => {
    const res = await call('PLN', 'GET', '/rule-sets');
    expect(res.statusCode).toBe(200);
    const list = (res.body as { ruleSets: RuleSetSummary[] }).ruleSets;
    const wages = list.find((s) => s.type === 'wages');
    expect(wages).toMatchObject({ isCostRule: true, currentVersion: { version: 2, status: 'published' }, openVersion: null, scenarioCount: 1 });
    // Seeded demo versions never mix with real ones (P18).
    const demo = await call('PLN', 'GET', '/rule-sets', { query: { synthetic: 'true' } });
    expect((demo.body as { ruleSets: RuleSetSummary[] }).ruleSets.every((s) => s.currentVersion === null)).toBe(true);
  });

  it('returns 404 for unknown or malformed ids', async () => {
    expect((await call('PLN', 'GET', '/rule-versions/not-a-uuid')).statusCode).toBe(404);
    expect((await call('PLN', 'GET', '/rule-versions/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await call('PLN', 'GET', '/rule-sets/00000000-0000-4000-8000-000000000000/versions')).statusCode).toBe(404);
  });

  it('answers 503 when no database is configured', async () => {
    const noDb = lambdaFor(
      createApp({
        db: () => {
          throw new ApiError('service_unavailable', 'unavailable');
        },
        rbac: DEFAULT_RBAC_CONFIG,
      }),
    );
    expect((await call('PLN', 'GET', '/rule-sets', { via: noDb })).statusCode).toBe(503);
  });
});
