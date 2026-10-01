/**
 * In-process request dispatch (same shape as api/test/support/dispatch.ts):
 * resolve the route, run the guarded handler through the real RBAC enforcer
 * (identity → principal from the DB on every call), map ApiErrors. No API
 * Gateway, Lambda adapter, authorizer or network — handler + DB time only.
 * The response body is JSON-serialised inside the timed region, as the Lambda
 * adapter would.
 */
import type { RoleCode } from '@lanewise/shared';
import { ACTIVE_ROLE_HEADER_KEY } from '../../../api/src/auth/principal.js';
import type { RequestContext } from '../../../api/src/context.js';
import { ApiError } from '../../../api/src/http/errors.js';
import type { Router } from '../../../api/src/http/router.js';
import { createLogger } from '../../../api/src/logger.js';

export interface Response {
  readonly status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly body: any;
  readonly bytes: number;
}

const logger = createLogger({ level: 'error', sink: () => undefined });

export async function dispatch(
  router: Router,
  method: string,
  path: string,
  options: { email: string; role: RoleCode; query?: Record<string, string>; body?: unknown },
): Promise<Response> {
  const match = router.resolve(method, path);
  if (match.kind !== 'matched') return { status: match.kind === 'not_found' ? 404 : 405, body: null, bytes: 0 };
  const context: RequestContext = {
    requestId: 'perf',
    env: 'test',
    now: () => new Date(),
    logger,
    identity: { sub: `sub-${options.email}`, email: options.email, name: null },
    principal: null,
  };
  try {
    const res = await match.handler(
      { method, path, headers: { [ACTIVE_ROLE_HEADER_KEY]: options.role }, query: options.query ?? {}, body: options.body, params: match.params, route: match.pattern },
      context,
    );
    const json = JSON.stringify(res.body ?? null);
    return { status: res.statusCode, body: res.body, bytes: json.length };
  } catch (error) {
    if (error instanceof ApiError) return { status: error.status, body: { error: { code: error.code, message: error.message, details: error.details } }, bytes: 0 };
    throw error;
  }
}
