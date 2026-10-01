/**
 * Route guards (task 8.1, P12). Every route declares exactly one guard when it
 * is registered; `createApp` refuses to start if any route lacks one
 * (`Router.assertGuarded`).
 *
 *  - `publicRoute()` — no sign-in (only `GET /health`).
 *  - `authenticated()` — a verified identity, no RBAC permission: for routes
 *    that only ever return or change the caller's own record (`/me`).
 *  - `authorize(resource, action, scopeTarget?)` — the active role must hold
 *    `action` on `resource` in the RBAC matrix, and, when a scope target is
 *    given, the addressed object must be inside the active role's scope.
 */
import type { PermissionAction, RbacResource } from '@lanewise/shared';
import type { RequestContext } from '../context.js';
import type { RoutedRequest } from '../http/types.js';

/**
 * Which path parameter names the object a deep link addresses, and its kind.
 * `saved_view` is owner-scoped: only the user who saved it may address it.
 */
export type ScopeTarget =
  | { readonly kind: 'store'; readonly param: string }
  | { readonly kind: 'staff'; readonly param: string }
  | { readonly kind: 'saved_view'; readonly param: string };

export type RouteGuard =
  | { readonly kind: 'public' }
  | { readonly kind: 'authenticated' }
  | {
      readonly kind: 'authorize';
      readonly resource: RbacResource;
      readonly action: PermissionAction;
      readonly scopeTarget?: ScopeTarget;
    };

export function publicRoute(): RouteGuard {
  return { kind: 'public' };
}

export function authenticated(): RouteGuard {
  return { kind: 'authenticated' };
}

export function authorize(resource: RbacResource, action: PermissionAction, scopeTarget?: ScopeTarget): RouteGuard {
  return scopeTarget ? { kind: 'authorize', resource, action, scopeTarget } : { kind: 'authorize', resource, action };
}

/**
 * Runs a non-public guard for a request: resolves the principal and either
 * returns the context with `principal` set or throws 401/403/404.
 */
export type Enforcer = (guard: RouteGuard, request: RoutedRequest, context: RequestContext) => Promise<RequestContext>;
