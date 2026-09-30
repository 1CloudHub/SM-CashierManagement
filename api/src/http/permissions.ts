/**
 * Route permissions: each route declares the capability it needs in exactly
 * one place — the `permission` option passed to `Router.add` — so the RBAC
 * layer (task 8.1) can authorise every request against the active role and
 * scope (P12) from a single hook, `LambdaHandlerOptions.authorize`.
 *
 * Resources and actions follow the design's RBAC matrix (V = view, E = edit,
 * A = approve/publish, X = export, M = manage). The matrix itself — which role
 * holds which capability — belongs to task 8.1; this file only names them.
 */
import { requirePrincipal, type RequestContext } from '../context.js';
import { errors } from './errors.js';

export type PermissionAction = 'view' | 'edit' | 'approve' | 'export' | 'manage';

export interface RoutePermission {
  /** RBAC matrix row, e.g. `data_ingestion` (SCR-050/051). */
  readonly resource: string;
  readonly action: PermissionAction;
}

/** Authorises a request for a route's declared permission; throws 401/403. */
export type AuthorizeRoute = (permission: RoutePermission, context: RequestContext) => void | Promise<void>;

/**
 * Fail-closed default until task 8.1 plugs in the RBAC matrix: the caller
 * must be signed in and have a resolved active role. `principalFromClaims`
 * never sets one, so until then every permissioned route answers 403.
 */
export const requireActiveRole: AuthorizeRoute = (_permission, context) => {
  const principal = requirePrincipal(context);
  if (principal.activeRole === null) throw errors.forbidden();
};
