import { isAllowedEmail, type RoleAssignment, type RoleCode, type Scope } from '@lanewise/shared';
import { errors } from './http/errors.js';
import type { Logger } from './logger.js';

/**
 * The signed-in identity, taken only from claims verified by API Gateway's
 * Cognito authorizer (task 7) — never from client-supplied headers.
 */
export interface Identity {
  /** Cognito `sub`. */
  readonly sub: string;
  /** Lower-cased, allowlisted work email. */
  readonly email: string;
  /** Display name from the token, if any. */
  readonly name: string | null;
}

/**
 * The authorised caller, resolved from the database by the RBAC layer
 * (api/src/auth/, task 8.1) for every guarded request: the app user, their
 * role assignments, the active role for this request and that role's scope.
 * Handlers must not grant access on a null role or scope.
 */
export interface Principal {
  /** `app_user.id` (the id recorded in audit events). */
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly activeRole: RoleCode | null;
  readonly assignments: readonly RoleAssignment[];
  /** The active role's data scope; `null` when there is no active role. */
  readonly scope: Scope | null;
  /** Whether the demo role switcher is on (requirement 3). */
  readonly demoMode: boolean;
}

/** Per-request context passed to every route handler. */
export interface RequestContext {
  readonly requestId: string;
  readonly env: string;
  readonly now: () => Date;
  /** Logger pre-bound with requestId (and route once matched). */
  readonly logger: Logger;
  /** Verified identity; `null` for anonymous requests (e.g. `/health`). */
  readonly identity: Identity | null;
  /**
   * Set by the route guard once the request is authorised; `null` on public
   * routes and for signed-in users who are not provisioned yet.
   */
  readonly principal: Principal | null;
}

/**
 * Builds the identity from verified authorizer claims (e.g.
 * `event.requestContext.authorizer.claims` for a Cognito user-pool
 * authorizer). Returns `null` unless both `sub` and `email` are present and
 * the email is on the smretail.com / 1cloudhub.com allowlist.
 *
 * The allowlist check is defence in depth for P13: the pre-sign-up trigger
 * already refuses to create such accounts, but the API never trusts that a
 * token for an out-of-allowlist email is legitimate (e.g. a pool
 * misconfiguration or a user created before the trigger was attached).
 */
export function identityFromClaims(claims: Readonly<Record<string, unknown>> | undefined | null): Identity | null {
  if (!claims) return null;
  const sub = claims.sub;
  const email = claims.email;
  if (typeof sub !== 'string' || sub.length === 0) return null;
  if (typeof email !== 'string' || email.length === 0) return null;
  if (!isAllowedEmail(email)) return null;
  const name = typeof claims.name === 'string' && claims.name.trim().length > 0 ? claims.name.trim() : null;
  return { sub, email: email.toLowerCase(), name };
}

/** Returns the identity or throws 401 `unauthenticated`. */
export function requireIdentity(context: RequestContext): Identity {
  if (!context.identity) throw errors.unauthenticated();
  return context.identity;
}

/** Returns the authorised principal or throws (401 when anonymous, else 403). */
export function requirePrincipal(context: RequestContext): Principal {
  if (!context.identity) throw errors.unauthenticated();
  if (!context.principal) throw errors.forbidden();
  return context.principal;
}
