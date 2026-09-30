/**
 * Calls a router the way the Lambda adapter does, without API Gateway events
 * or the database-backed principal resolution: `testRouter` registers routes
 * behind a fake enforcer that takes the principal from the test and applies
 * the real RBAC matrix (`can`) to each route's guard. The real enforcer is
 * exercised end to end through `makeClient` (./rbac.ts).
 */
import { can, type RoleCode } from '@lanewise/shared';
import type { Enforcer } from '../../src/auth/guards.js';
import { requireIdentity, requirePrincipal, type Principal, type RequestContext } from '../../src/context.js';
import { ApiError, errors } from '../../src/http/errors.js';
import { Router } from '../../src/http/router.js';
import { createLogger } from '../../src/logger.js';

export interface TestResponse {
  readonly status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read arbitrary JSON bodies
  readonly body: any;
}

export interface DispatchOptions {
  readonly body?: unknown;
  readonly query?: Record<string, string>;
  /** The authorised caller; `null`/omitted = anonymous. */
  readonly principal?: Principal | null;
  readonly now?: () => Date;
}

export function principal(userId: string, activeRole: RoleCode | null, email = 'tester@smretail.com'): Principal {
  return {
    userId,
    email,
    name: 'Test User',
    activeRole,
    assignments: [],
    scope: activeRole === null ? null : { type: 'global' },
    demoMode: true,
  };
}

/** Guards with the real matrix; the principal comes from the test's context. */
export const testEnforcer: Enforcer = async (guard, _request, context) => {
  if (guard.kind === 'public') return context;
  requireIdentity(context);
  if (guard.kind === 'authenticated') return context;
  const p = requirePrincipal(context);
  if (p.activeRole === null || !can(p.activeRole, guard.resource, guard.action)) throw errors.forbidden();
  return context;
};

export function testRouter(): Router {
  return new Router({ enforcer: testEnforcer });
}

export async function dispatch(router: Router, method: string, path: string, options: DispatchOptions = {}): Promise<TestResponse> {
  const match = router.resolve(method, path);
  if (match.kind !== 'matched') return { status: match.kind === 'not_found' ? 404 : 405, body: null };
  const p = options.principal ?? null;
  const context: RequestContext = {
    requestId: 'test-request',
    env: 'test',
    now: options.now ?? (() => new Date()),
    logger: createLogger({ level: 'error', sink: () => undefined }),
    identity: p ? { sub: `sub-${p.email}`, email: p.email, name: p.name } : null,
    principal: p,
  };
  try {
    const response = await match.handler(
      { method, path, headers: {}, query: options.query ?? {}, body: options.body, params: match.params, route: match.pattern },
      context,
    );
    return { status: response.statusCode, body: response.body };
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
    throw error;
  }
}
