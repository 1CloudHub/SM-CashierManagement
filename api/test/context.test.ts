import { describe, expect, it } from 'vitest';
import { principalFromClaims, requirePrincipal, type RequestContext } from '../src/context.js';
import { ApiError } from '../src/http/errors.js';
import { createLogger } from '../src/logger.js';

function ctx(principal: RequestContext['principal']): RequestContext {
  return {
    requestId: 'r',
    env: 'test',
    now: () => new Date(0),
    logger: createLogger({ sink: () => undefined }),
    principal,
  };
}

describe('request context', () => {
  it('builds no principal when the authorizer supplied no claims', () => {
    expect(principalFromClaims(undefined)).toBeNull();
    expect(principalFromClaims({})).toBeNull();
    expect(principalFromClaims({ email: 'a@smretail.com' })).toBeNull();
  });

  it('builds a principal from verified authorizer claims with no role until RBAC resolves it', () => {
    expect(principalFromClaims({ sub: 'u-1', email: 'Ana@SMRetail.com' })).toEqual({
      userId: 'u-1',
      email: 'ana@smretail.com',
      activeRole: null,
      assignments: [],
    });
  });

  it('builds no principal for an email outside the domain allowlist (P13 defence in depth)', () => {
    for (const email of ['a@gmail.com', 'a@smretail.com.evil.io', 'a@it.smretail.com', 'a@evilsmretail.com']) {
      expect(principalFromClaims({ sub: 'u-1', email })).toBeNull();
    }
    expect(principalFromClaims({ sub: 'u-2', email: 'b@1cloudhub.com' })?.email).toBe('b@1cloudhub.com');
  });

  it('requirePrincipal throws unauthenticated when anonymous', () => {
    expect(() => requirePrincipal(ctx(null))).toThrowError(ApiError);
    try {
      requirePrincipal(ctx(null));
    } catch (err) {
      expect((err as ApiError).status).toBe(401);
    }
  });
});
