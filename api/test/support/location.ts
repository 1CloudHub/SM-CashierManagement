/**
 * Location-privacy test support: barangay reference rows (PSGC-shaped, Metro
 * Manila) and route calls through the real task 8.1 enforcer.
 */
import type { RoleCode, Scope } from '@lanewise/shared';
import type pg from 'pg';
import { DEFAULT_RBAC_CONFIG } from '../../src/auth/config.js';
import { createEnforcer } from '../../src/auth/enforcer.js';
import type { RequestContext } from '../../src/context.js';
import type { Queryable } from '../../src/db/pool.js';
import { scopeToColumns } from '../../src/db/repositories/users.js';
import { Router } from '../../src/http/router.js';
import { createLogger } from '../../src/logger.js';
import { registerLocationPrivacyRoutes } from '../../src/routes/location-privacy.js';

export const BARANGAYS = [
  { code: '137404001', name: 'Bagong Pag-asa', city: 'Quezon City' },
  { code: '137401002', name: 'Wack-Wack Greenhills', city: 'Mandaluyong' },
  { code: '137403003', name: 'San Antonio', city: 'Pasig' },
  { code: '137403004', name: 'Kapitolyo', city: 'Pasig' },
  { code: '137607005', name: 'Pinagsama', city: 'Taguig' },
] as const;

const CENTROIDS: Readonly<Record<string, [number, number]>> = {
  '137404001': [14.6581, 121.0345],
  '137401002': [14.5952, 121.0521],
  '137403003': [14.5826, 121.0615],
  '137403004': [14.5693, 121.0573],
  '137607005': [14.5264, 121.0617],
};

/** Inserts the reference barangays (with their public centroids) if missing. */
export async function seedBarangays(db: Queryable): Promise<void> {
  for (const b of BARANGAYS) {
    const [lat, lon] = CENTROIDS[b.code] ?? [0, 0];
    await db.query(
      `INSERT INTO barangay (psgc_code, name, city, centroid_lat, centroid_lon) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (psgc_code) DO NOTHING`,
      [b.code, b.name, b.city, lat, lon],
    );
  }
}

/** The location-privacy routes behind the real task 8.1 enforcer (demo role switcher off). */
export function locationRouter(pool: pg.Pool): Router {
  const deps = { db: () => pool, rbac: { ...DEFAULT_RBAC_CONFIG, demoRoleSwitcher: false } };
  return registerLocationPrivacyRoutes(new Router({ enforcer: createEnforcer(deps) }), deps).assertGuarded();
}

/** Who a route call is made as: a verified email (or none) and the `X-Active-Role` header. */
export interface Caller {
  readonly email: string | null;
  readonly role?: RoleCode;
}

/**
 * Gives `userId` exactly one role assignment (or none) and returns a caller
 * acting in it. Raw SQL: test setup, not an audited app path.
 */
export async function callerAs(db: Queryable, userId: string, role: RoleCode | null, scope: Scope | null = null): Promise<Caller> {
  await db.query('DELETE FROM role_assignment WHERE user_id = $1', [userId]);
  if (role !== null && scope !== null) {
    const { scopeType, scopeIds } = scopeToColumns(scope);
    await db.query('INSERT INTO role_assignment (user_id, role, scope_type, scope_ids) VALUES ($1, $2, $3, $4)', [
      userId,
      role,
      scopeType,
      scopeIds,
    ]);
  }
  const { rows } = await db.query<{ email: string } & pg.QueryResultRow>('SELECT email FROM app_user WHERE id = $1', [userId]);
  const email = rows[0]?.email ?? null;
  return role === null ? { email } : { email, role };
}

export const ANONYMOUS: Caller = { email: null };

/** Calls a route as `caller`; API errors come back as `{ status, body: { code } }`. */
export async function callRoute(
  router: Router,
  caller: Caller,
  method: string,
  path: string,
  options: { body?: unknown; query?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const match = router.resolve(method, path);
  if (match.kind !== 'matched') throw new Error(`no route ${method} ${path}`);
  const context: RequestContext = {
    requestId: 'req-test',
    env: 'test',
    now: () => new Date(),
    logger: createLogger({ sink: () => undefined }),
    identity: caller.email === null ? null : { sub: `sub-${caller.email}`, email: caller.email, name: null },
    principal: null,
  };
  const headers: Record<string, string> = caller.role ? { 'x-active-role': caller.role } : {};
  try {
    const res = await match.handler(
      { method, path, headers, query: options.query ?? {}, body: options.body, params: match.params, route: match.pattern },
      context,
    );
    return { status: res.statusCode, body: res.body as Record<string, unknown> };
  } catch (err) {
    const e = err as { status?: unknown; code?: string };
    if (typeof e.status === 'number' && e.status < 500) return { status: e.status, body: { code: e.code } };
    throw err;
  }
}
