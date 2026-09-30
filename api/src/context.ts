import type { RoleAssignment, RoleCode } from '@lanewise/shared';
import { errors } from './http/errors.js';
import type { Logger } from './logger.js';

/**
 * The authenticated caller.
 *
 * Identity comes only from claims verified by API Gateway's authorizer
 * (Cognito, task 7) — never from client-supplied headers. `activeRole` and
 * `assignments` stay empty until the RBAC layer (task 8.1) resolves them from
 * the database for every request; handlers must not grant access on a null
 * role.
 */
export interface Principal {
  readonly userId: string;
  readonly email: string;
  readonly activeRole: RoleCode | null;
  readonly assignments: readonly RoleAssignment[];
}

/** Per-request context passed to every route handler. */
export interface RequestContext {
  readonly requestId: string;
  readonly env: string;
  readonly now: () => Date;
  /** Logger pre-bound with requestId (and route once matched). */
  readonly logger: Logger;
  /** `null` for anonymous requests (e.g. `/health`). */
  readonly principal: Principal | null;
}

/**
 * Builds a principal from verified authorizer claims (e.g.
 * `event.requestContext.authorizer.claims` for a Cognito user-pool
 * authorizer). Returns `null` unless both `sub` and `email` are present.
 */
export function principalFromClaims(claims: Readonly<Record<string, unknown>> | undefined | null): Principal | null {
  if (!claims) return null;
  const sub = claims.sub;
  const email = claims.email;
  if (typeof sub !== 'string' || sub.length === 0) return null;
  if (typeof email !== 'string' || email.length === 0) return null;
  return { userId: sub, email: email.toLowerCase(), activeRole: null, assignments: [] };
}

/** Returns the principal or throws 401 `unauthenticated`. */
export function requirePrincipal(context: RequestContext): Principal {
  if (!context.principal) throw errors.unauthenticated();
  return context.principal;
}
