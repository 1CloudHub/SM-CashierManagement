import { describe, expect, it } from 'vitest';
import {
  identityFromClaims,
  requireIdentity,
  requirePrincipal,
  type Principal,
  type RequestContext,
} from '../src/context.js';
import { ApiError } from '../src/http/errors.js';
import { createLogger } from '../src/logger.js';

function ctx(identity: RequestContext['identity'], principal: Principal | null = null): RequestContext {
  return {
    requestId: 'r',
    env: 'test',
    now: () => new Date(0),
    logger: createLogger({ sink: () => undefined }),
    identity,
    principal,
  };
}

function statusOf(fn: () => unknown): number | null {
  try {
    fn();
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return (err as ApiError).status;
  }
}

describe('request context', () => {
  it('builds no identity when the authorizer supplied no claims', () => {
    expect(identityFromClaims(undefined)).toBeNull();
    expect(identityFromClaims({})).toBeNull();
    expect(identityFromClaims({ email: 'a@smretail.com' })).toBeNull();
  });

  it('builds an identity from verified authorizer claims only', () => {
    expect(identityFromClaims({ sub: 'u-1', email: 'Ana@SMRetail.com' })).toEqual({
      sub: 'u-1',
      email: 'ana@smretail.com',
      name: null,
    });
    expect(identityFromClaims({ sub: 'u-1', email: 'ana@smretail.com', name: ' Ana Cruz ' })?.name).toBe('Ana Cruz');
  });

  it('builds no identity for an email outside the domain allowlist (P13 defence in depth)', () => {
    for (const email of ['a@gmail.com', 'a@smretail.com.evil.io', 'a@it.smretail.com', 'a@evilsmretail.com']) {
      expect(identityFromClaims({ sub: 'u-1', email })).toBeNull();
    }
    expect(identityFromClaims({ sub: 'u-2', email: 'b@1cloudhub.com' })?.email).toBe('b@1cloudhub.com');
  });

  it('requireIdentity / requirePrincipal: 401 when anonymous, 403 when not authorised', () => {
    const identity = { sub: 's', email: 'a@smretail.com', name: null };
    expect(statusOf(() => requireIdentity(ctx(null)))).toBe(401);
    expect(statusOf(() => requirePrincipal(ctx(null)))).toBe(401);
    expect(statusOf(() => requirePrincipal(ctx(identity)))).toBe(403);
    const principal: Principal = {
      userId: 'u',
      email: 'a@smretail.com',
      name: 'A',
      activeRole: 'PLN',
      assignments: [],
      scope: { type: 'global' },
      demoMode: true,
    };
    expect(requirePrincipal(ctx(identity, principal))).toBe(principal);
  });
});
