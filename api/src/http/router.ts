import type { Enforcer, RouteGuard } from '../auth/guards.js';
import { errors } from './errors.js';
import type { RouteHandler } from './types.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type Segment = { readonly kind: 'static'; readonly value: string } | { readonly kind: 'param'; readonly name: string };

interface Route {
  readonly method: HttpMethod;
  readonly pattern: string;
  readonly segments: readonly Segment[];
  readonly handler: RouteHandler;
  readonly guard: RouteGuard | null;
}

/** A registered route as reported by `Router.routes()` (safe to log/inspect). */
export interface RouteInfo {
  readonly method: HttpMethod;
  readonly pattern: string;
  readonly guard: RouteGuard | null;
}

export type RouteMatch =
  | {
      readonly kind: 'matched';
      readonly handler: RouteHandler;
      readonly params: Record<string, string>;
      readonly pattern: string;
    }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'method_not_allowed'; readonly allow: readonly HttpMethod[] };

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

function parsePattern(pattern: string): Segment[] {
  return splitPath(pattern).map((s) =>
    s.startsWith(':') ? { kind: 'param', name: s.slice(1) } : { kind: 'static', value: s },
  );
}

function canonical(segments: readonly Segment[]): string {
  return `/${segments.map((s) => (s.kind === 'param' ? ':' : s.value)).join('/')}`;
}

function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw errors.badRequest('The request path is malformed.');
  }
}

export interface RouterOptions {
  /** Runs non-public guards (api/src/auth/enforcer.ts). Required to register one. */
  readonly enforcer?: Enforcer;
}

type RouteArgs = [handler: RouteHandler] | [guard: RouteGuard, handler: RouteHandler];

/**
 * Minimal method + path router. Patterns use `:name` for a single path
 * segment. Trailing and repeated slashes are ignored. Intentionally tiny: API
 * Gateway fronts it; cross-cutting concerns (context, errors, logging) live in
 * the Lambda adapter.
 *
 * Each route declares a guard (`publicRoute()`, `authenticated()` or
 * `authorize(...)`, task 8.1). A non-public guard runs through the enforcer
 * before the handler, so a handler never runs unauthorised;
 * `assertGuarded()` rejects any route registered without one (P12).
 */
export class Router {
  private readonly table: Route[] = [];
  private readonly enforcer: Enforcer | undefined;

  constructor(options: RouterOptions = {}) {
    this.enforcer = options.enforcer;
  }

  add(method: HttpMethod, pattern: string, ...args: RouteArgs): this {
    const [guard, handler] = args.length === 1 ? [null, args[0]] : args;
    const segments = parsePattern(pattern);
    const key = canonical(segments);
    if (this.table.some((r) => r.method === method && canonical(r.segments) === key)) {
      throw new Error(`Duplicate route: ${method} ${pattern}`);
    }
    let guarded = handler;
    if (guard !== null && guard.kind !== 'public') {
      const enforcer = this.enforcer;
      if (!enforcer) throw new Error(`Route ${method} ${pattern} needs an enforcer for its ${guard.kind} guard`);
      guarded = async (request, context) => handler(request, await enforcer(guard, request, context));
    }
    this.table.push({ method, pattern: `/${splitPath(pattern).join('/')}`, segments, handler: guarded, guard });
    return this;
  }

  get(pattern: string, ...args: RouteArgs): this {
    return this.add('GET', pattern, ...args);
  }

  post(pattern: string, ...args: RouteArgs): this {
    return this.add('POST', pattern, ...args);
  }

  put(pattern: string, ...args: RouteArgs): this {
    return this.add('PUT', pattern, ...args);
  }

  patch(pattern: string, ...args: RouteArgs): this {
    return this.add('PATCH', pattern, ...args);
  }

  delete(pattern: string, ...args: RouteArgs): this {
    return this.add('DELETE', pattern, ...args);
  }

  /** Every registered route with its guard, in registration order. */
  routes(): RouteInfo[] {
    return this.table.map(({ method, pattern, guard }) => ({ method, pattern, guard }));
  }

  /** Throws at startup if any route was registered without declaring a guard (P12). */
  assertGuarded(): this {
    const unguarded = this.table.filter((r) => r.guard === null).map((r) => `${r.method} ${r.pattern}`);
    if (unguarded.length > 0) {
      throw new Error(`Routes without an authorization guard: ${unguarded.join(', ')}`);
    }
    return this;
  }

  resolve(method: string, path: string): RouteMatch {
    const upper = method.toUpperCase();
    const parts = splitPath(path);
    const allow: HttpMethod[] = [];

    for (const route of this.table) {
      const params = this.match(route.segments, parts);
      if (params === null) continue;
      if (route.method === upper) {
        return { kind: 'matched', handler: route.handler, params, pattern: route.pattern };
      }
      if (!allow.includes(route.method)) allow.push(route.method);
    }

    return allow.length > 0 ? { kind: 'method_not_allowed', allow: allow.sort() } : { kind: 'not_found' };
  }

  private match(segments: readonly Segment[], parts: readonly string[]): Record<string, string> | null {
    if (segments.length !== parts.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i] as Segment;
      const part = parts[i] as string;
      if (segment.kind === 'static') {
        if (segment.value !== part) return null;
      } else {
        params[segment.name] = decodeSegment(part);
      }
    }
    return params;
  }
}
