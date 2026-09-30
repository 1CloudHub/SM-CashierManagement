/**
 * Helpers for the RBAC tests: call the real Lambda handler with verified
 * Cognito claims, and seed an organisation with demo store/cashier.
 */
import { randomBytes } from 'node:crypto';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import type { RoleCode, Scope } from '@lanewise/shared';
import type pg from 'pg';
import { createApp, type AppDeps } from '../../src/app.js';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import { scopeToColumns } from '../../src/db/repositories/users.js';
import { createLambdaHandler } from '../../src/lambda.js';

export const uniq = (): string => randomBytes(4).toString('hex');

export interface CallOptions {
  readonly method?: string;
  readonly path: string;
  readonly email?: string | null;
  readonly role?: string;
  readonly body?: unknown;
}

export interface CallResult {
  readonly status: number;
  readonly body: unknown;
  readonly raw: string;
}

export function makeClient(pool: pg.Pool, demoRoleSwitcher: boolean) {
  const deps: AppDeps = { db: () => pool, rbac: { ...DEFAULT_RBAC_CONFIG, demoRoleSwitcher } };
  const router = createApp(deps);
  const handler = createLambdaHandler({ router, env: 'test', logSink: () => undefined });
  const call = async (options: CallOptions): Promise<CallResult> => {
    const headers: Record<string, string> = {};
    if (options.role !== undefined) headers['X-Active-Role'] = options.role;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const email = options.email === undefined ? null : options.email;
    const event = {
      httpMethod: options.method ?? 'GET',
      path: options.path,
      resource: '/{proxy+}',
      headers,
      multiValueHeaders: {},
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      body: options.body === undefined ? null : JSON.stringify(options.body),
      isBase64Encoded: false,
      requestContext: {
        requestId: `req-${uniq()}`,
        authorizer: email === null ? null : { claims: { sub: `sub-${email}`, email } },
      },
    } as unknown as APIGatewayProxyEvent;
    const res = await handler(event, { awsRequestId: 'aws' } as Context);
    return { status: res.statusCode, body: JSON.parse(res.body) as unknown, raw: res.body };
  };
  return { call, router, deps };
}

export async function one<T extends pg.QueryResultRow>(db: pg.Pool, sql: string, values: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, values);
  if (!rows[0]) throw new Error(`no row: ${sql}`);
  return rows[0];
}

export async function insertRegion(db: pg.Pool, synthetic = true): Promise<string> {
  return (await one<{ id: string }>(db, 'INSERT INTO region (code, name, synthetic) VALUES ($1, $1, $2) RETURNING id', [`R-${uniq()}`, synthetic])).id;
}

export async function insertStore(db: pg.Pool, regionId: string, code = `S-${uniq()}`): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      `INSERT INTO store (code, name, format, region_id, synthetic) VALUES ($1, $2, 'sm_supermarket', $3, true) RETURNING id`,
      [code, `SM ${code}`, regionId],
    )
  ).id;
}

export async function insertStaff(db: pg.Pool, storeId: string, name: string, employeeNo = `E-${uniq()}`): Promise<string> {
  const dept = await one<{ id: string }>(
    db,
    `INSERT INTO department (store_id, name, installed_lanes, default_handle_time_min, trading_open, trading_close, synthetic)
     VALUES ($1, $2, 10, 2.5, '10:00', '22:00', true) RETURNING id`,
    [storeId, `Dept ${uniq()}`],
  );
  return (
    await one<{ id: string }>(
      db,
      `INSERT INTO staff (store_id, department_id, employee_no, name, employment_type, synthetic)
       VALUES ($1, $2, $3, $4, 'regular', true) RETURNING id`,
      [storeId, dept.id, employeeNo, name],
    )
  ).id;
}

export async function insertAppUser(db: pg.Pool, email: string, options: { status?: string; activeRole?: RoleCode } = {}): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      'INSERT INTO app_user (email, name, status, active_role) VALUES ($1, $2, $3, $4) RETURNING id',
      [email, 'Test User', options.status ?? 'active', options.activeRole ?? null],
    )
  ).id;
}

/** Replaces a user's assignments (raw SQL: test setup, not an audited app path). */
export async function setAssignments(db: pg.Pool, userId: string, assignments: readonly { role: RoleCode; scope: Scope }[]): Promise<void> {
  await db.query('DELETE FROM role_assignment WHERE user_id = $1', [userId]);
  for (const a of assignments) {
    const { scopeType, scopeIds } = scopeToColumns(a.scope);
    await db.query('INSERT INTO role_assignment (user_id, role, scope_type, scope_ids) VALUES ($1, $2, $3, $4)', [
      userId,
      a.role,
      scopeType,
      scopeIds,
    ]);
  }
}

export interface WriteCounts {
  readonly audit: number;
  readonly users: number;
  readonly assignments: number;
  readonly roles: string;
}

/** Row counts (and every user's active role) — any write shows up here. */
export async function writeCounts(db: pg.Pool): Promise<WriteCounts> {
  const row = await one<{ audit: number; users: number; assignments: number; roles: string | null }>(
    db,
    `SELECT (SELECT count(*) FROM audit_event)::int AS audit,
            (SELECT count(*) FROM app_user)::int AS users,
            (SELECT count(*) FROM role_assignment)::int AS assignments,
            (SELECT string_agg(id || ':' || coalesce(active_role, '-'), ',' ORDER BY id) FROM app_user) AS roles`,
  );
  return { ...row, roles: row.roles ?? '' };
}

/**
 * A small organisation: 3 regions x 3 stores, the demo store `smsm-qc` in the
 * first region with demo cashier PT-02, and a named cashier in every store.
 */
export async function seedOrg(db: pg.Pool) {
  const regions = [await insertRegion(db), await insertRegion(db), await insertRegion(db)];
  const stores: { id: string; regionId: string }[] = [];
  const demoStoreId = await insertStore(db, regions[0] as string, DEFAULT_RBAC_CONFIG.demoStoreCode);
  stores.push({ id: demoStoreId, regionId: regions[0] as string });
  for (const [i, regionId] of regions.entries()) {
    for (let k = i === 0 ? 1 : 0; k < 3; k += 1) stores.push({ id: await insertStore(db, regionId), regionId });
  }
  const demoStaffName = `Demo Cashier ${uniq()}`;
  const demoStaffId = await insertStaff(db, demoStoreId, demoStaffName, DEFAULT_RBAC_CONFIG.demoStaffEmployeeNo);
  const staff = [{ id: demoStaffId, name: demoStaffName, storeId: demoStoreId }];
  for (const store of stores) {
    const name = `Cashier ${uniq()}`;
    staff.push({ id: await insertStaff(db, store.id, name), name, storeId: store.id });
  }
  return { regions, stores, demoStoreId, demoStaffId, staff };
}
