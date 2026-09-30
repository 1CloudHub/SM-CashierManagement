/**
 * Calls a router the way the Lambda adapter does — resolve, authorise the
 * route's declared permission, run the handler, map ApiErrors — without
 * API Gateway events.
 */
import type { RoleCode } from '@lanewise/shared';
import type { Principal, RequestContext } from '../../src/context.js';
import { ApiError } from '../../src/http/errors.js';
import { requireActiveRole, type AuthorizeRoute } from '../../src/http/permissions.js';
import type { Router } from '../../src/http/router.js';
import { createLogger } from '../../src/logger.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read arbitrary JSON bodies
export interface TestResponse<T = any> {
  readonly status: number;
  readonly body: T;
}

export interface DispatchOptions {
  readonly body?: unknown;
  readonly query?: Record<string, string>;
  readonly principal?: Principal | null;
  readonly authorize?: AuthorizeRoute;
  readonly now?: () => Date;
}

export function principal(userId: string, activeRole: RoleCode | null, email = 'tester@smretail.com'): Principal {
  return { userId, email, activeRole, assignments: [] };
}

export async function dispatch(router: Router, method: string, path: string, options: DispatchOptions = {}): Promise<TestResponse> {
  const match = router.resolve(method, path);
  if (match.kind !== 'matched') return { status: match.kind === 'not_found' ? 404 : 405, body: null };
  const context: RequestContext = {
    requestId: 'test-request',
    env: 'test',
    now: options.now ?? (() => new Date()),
    logger: createLogger({ level: 'error', sink: () => undefined }),
    principal: options.principal ?? null,
  };
  try {
    if (match.permission) await (options.authorize ?? requireActiveRole)(match.permission, context);
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
