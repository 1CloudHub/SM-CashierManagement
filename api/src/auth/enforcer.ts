/**
 * The authorization middleware behind every non-public route guard (task
 * 8.1; requirements 2.1, 2.4, 2.5, 3.2; P1, P12).
 */
import { can } from '@lanewise/shared';
import type pg from 'pg';
import { requireIdentity } from '../context.js';
import { errors } from '../http/errors.js';
import type { RbacConfig } from './config.js';
import type { Enforcer } from './guards.js';
import { ACTIVE_ROLE_HEADER_KEY, resolvePrincipal } from './principal.js';
import { isTargetInScope } from './scope.js';

export interface EnforcerDeps {
  /** The database pool; throws `service_unavailable` when none is configured. */
  readonly db: () => pg.Pool;
  readonly rbac: RbacConfig;
}

/**
 * For each guarded request: require a verified identity (401), resolve the
 * principal from the database (403 for a disabled user or a disallowed
 * `X-Active-Role`), then for `authorize` guards require a provisioned user
 * with an active role that holds the permission (403), and — for deep links —
 * an addressed object that exists and is in scope (the same 404 either way).
 * Nothing is written while authorising.
 */
export function createEnforcer(deps: EnforcerDeps): Enforcer {
  return async (guard, request, context) => {
    if (guard.kind === 'public') return context;
    const identity = requireIdentity(context);
    const db = deps.db();
    const principal = await resolvePrincipal(db, identity, request.headers[ACTIVE_ROLE_HEADER_KEY], deps.rbac);
    if (guard.kind === 'authenticated') return { ...context, principal };

    if (!principal || principal.activeRole === null || principal.scope === null) throw errors.forbidden();
    if (!can(principal.activeRole, guard.resource, guard.action)) throw errors.forbidden();
    if (guard.scopeTarget) {
      const id = request.params[guard.scopeTarget.param];
      if (id === undefined || !(await isTargetInScope(db, principal.scope, guard.scopeTarget, id))) {
        throw errors.notFoundOrNoAccess();
      }
    }
    return { ...context, principal };
  };
}
