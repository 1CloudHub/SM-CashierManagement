import { RBAC_RESOURCES } from '@lanewise/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { DEFAULT_RBAC_CONFIG, parseFlag, rbacConfigFromEnv } from '../../src/auth/config.js';
import { authenticated, authorize, publicRoute, type Enforcer } from '../../src/auth/guards.js';
import { Router } from '../../src/http/router.js';

const noop = () => ({ statusCode: 200, body: null });
const enforcer: Enforcer = async (_guard, _request, context) => context;

describe('route registration check (P12)', () => {
  it('refuses to start with a route that declares no guard', () => {
    const router = new Router({ enforcer }).get('/health', publicRoute(), noop).get('/scenarios', noop);
    expect(() => router.assertGuarded()).toThrowError(/GET \/scenarios/);
  });

  it('refuses a non-public guard without an enforcer to run it', () => {
    expect(() => new Router().get('/stores', authorize('master_data', 'view'), noop)).toThrowError(/enforcer/);
    expect(() => new Router().get('/me', authenticated(), noop)).toThrowError(/enforcer/);
  });

  it('the app declares a guard on every route, and only /health is public', () => {
    const routes = createApp().routes();
    expect(routes.length).toBeGreaterThan(1);
    for (const route of routes) {
      expect(route.guard, `${route.method} ${route.pattern}`).not.toBeNull();
      if (route.guard?.kind === 'public') expect(`${route.method} ${route.pattern}`).toBe('GET /health');
      if (route.guard?.kind === 'authorize') expect(RBAC_RESOURCES).toContain(route.guard.resource);
    }
    expect(routes.map((r) => `${r.method} ${r.pattern}`)).toEqual(
      expect.arrayContaining(['GET /health', 'GET /me', 'PUT /me/active-role', 'GET /stores', 'GET /stores/:storeId']),
    );
  });

  it('a guarded handler never runs when the guard rejects', async () => {
    let ran = false;
    const router = new Router({
      enforcer: async () => {
        throw new Error('denied');
      },
    }).get('/stores', authorize('master_data', 'view'), () => {
      ran = true;
      return { statusCode: 200, body: null };
    });
    const match = router.resolve('GET', '/stores');
    if (match.kind !== 'matched') throw new Error('no match');
    await expect(
      match.handler({ method: 'GET', path: '/stores', headers: {}, query: {}, body: undefined, params: {}, route: '/stores' }, {} as never),
    ).rejects.toThrow('denied');
    expect(ran).toBe(false);
  });
});

describe('RBAC config', () => {
  it('has the demo role switcher on by default and honours DEMO_ROLE_SWITCHER', () => {
    expect(rbacConfigFromEnv({})).toEqual(DEFAULT_RBAC_CONFIG);
    expect(DEFAULT_RBAC_CONFIG.demoRoleSwitcher).toBe(true);
    for (const off of ['false', 'FALSE', '0', 'off', 'no']) {
      expect(rbacConfigFromEnv({ DEMO_ROLE_SWITCHER: off }).demoRoleSwitcher).toBe(false);
    }
    expect(parseFlag('maybe', true)).toBe(true);
    expect(parseFlag(' on ', false)).toBe(true);
  });
});
