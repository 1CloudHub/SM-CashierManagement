/**
 * Calls a router the way the Lambda adapter does — resolve, run the guarded
 * handler (the route's guard runs through the real RBAC enforcer, task 8.1),
 * map ApiErrors — without API Gateway events.
 */
import type { RoleCode } from '@lanewise/shared';
import { ACTIVE_ROLE_HEADER_KEY } from '../../src/auth/principal.js';
import type { Identity, RequestContext } from '../../src/context.js';
import { ApiError } from '../../src/http/errors.js';
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
  /** The verified identity (the enforcer resolves the principal from it); omit for anonymous. */
  readonly identity?: Identity | null;
  /** Sent as `X-Active-Role`. */
  readonly role?: RoleCode;
  readonly now?: () => Date;
}

export function identity(email: string): Identity {
  return { sub: `sub-${email}`, email, name: null };
}

export async function dispatch(router: Router, method: string, path: string, options: DispatchOptions = {}): Promise<TestResponse> {
  const match = router.resolve(method, path);
  if (match.kind !== 'matched') return { status: match.kind === 'not_found' ? 404 : 405, body: null };
  const context: RequestContext = {
    requestId: 'test-request',
    env: 'test',
    now: options.now ?? (() => new Date()),
    logger: createLogger({ level: 'error', sink: () => undefined }),
    identity: options.identity ?? null,
    principal: null,
  };
  const headers: Record<string, string> = options.role ? { [ACTIVE_ROLE_HEADER_KEY]: options.role } : {};
  try {
    const response = await match.handler(
      { method, path, headers, query: options.query ?? {}, body: options.body, params: match.params, route: match.pattern },
      context,
    );
    return { status: response.statusCode, body: response.body };
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
    throw error;
  }
}
