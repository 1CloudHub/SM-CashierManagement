import { errors } from './errors.js';
import type { RouteHandler } from './types.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type Segment = { readonly kind: 'static'; readonly value: string } | { readonly kind: 'param'; readonly name: string };

interface Route {
  readonly method: HttpMethod;
  readonly pattern: string;
  readonly segments: readonly Segment[];
  readonly handler: RouteHandler;
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

/**
 * Minimal method + path router. Patterns use `:name` for a single path
 * segment. Trailing and repeated slashes are ignored. Intentionally tiny: API
 * Gateway fronts it, so it needs no middleware stack; cross-cutting concerns
 * (context, errors, logging) live in the Lambda adapter.
 */
export class Router {
  private readonly routes: Route[] = [];

  add(method: HttpMethod, pattern: string, handler: RouteHandler): this {
    const segments = parsePattern(pattern);
    const key = canonical(segments);
    if (this.routes.some((r) => r.method === method && canonical(r.segments) === key)) {
      throw new Error(`Duplicate route: ${method} ${pattern}`);
    }
    this.routes.push({ method, pattern: `/${splitPath(pattern).join('/')}`, segments, handler });
    return this;
  }

  get(pattern: string, handler: RouteHandler): this {
    return this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: RouteHandler): this {
    return this.add('POST', pattern, handler);
  }

  put(pattern: string, handler: RouteHandler): this {
    return this.add('PUT', pattern, handler);
  }

  patch(pattern: string, handler: RouteHandler): this {
    return this.add('PATCH', pattern, handler);
  }

  delete(pattern: string, handler: RouteHandler): this {
    return this.add('DELETE', pattern, handler);
  }

  resolve(method: string, path: string): RouteMatch {
    const upper = method.toUpperCase();
    const parts = splitPath(path);
    const allow: HttpMethod[] = [];

    for (const route of this.routes) {
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
