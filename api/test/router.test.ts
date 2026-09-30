import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { publicRoute } from '../src/auth/guards.js';
import type { RequestContext } from '../src/context.js';
import { costFigure } from '../src/http/cost.js';
import { ApiError } from '../src/http/errors.js';
import { Router } from '../src/http/router.js';

const noop = () => ({ statusCode: 200, body: null });

describe('Router', () => {
  it('matches a static route', () => {
    const router = new Router().get('/health', noop);
    const match = router.resolve('GET', '/health');
    expect(match.kind).toBe('matched');
  });

  it('treats a trailing slash and repeated slashes as the same path', () => {
    const router = new Router().get('/health', noop);
    expect(router.resolve('GET', '/health/').kind).toBe('matched');
    expect(router.resolve('GET', '//health').kind).toBe('matched');
  });

  it('matches methods case-insensitively', () => {
    const router = new Router().get('/health', noop);
    expect(router.resolve('get', '/health').kind).toBe('matched');
  });

  it('extracts path params', () => {
    const router = new Router().get('/scenarios/:scenarioId/runs/:runId', noop);
    const match = router.resolve('GET', '/scenarios/abc/runs/42');
    expect(match).toMatchObject({
      kind: 'matched',
      params: { scenarioId: 'abc', runId: '42' },
      pattern: '/scenarios/:scenarioId/runs/:runId',
    });
  });

  it('returns not_found for unknown paths', () => {
    const router = new Router().get('/health', noop);
    expect(router.resolve('GET', '/nope').kind).toBe('not_found');
    expect(router.resolve('GET', '/health/extra').kind).toBe('not_found');
  });

  it('returns method_not_allowed with the allowed methods when only the method differs', () => {
    const router = new Router().get('/health', noop).post('/health', noop);
    expect(router.resolve('DELETE', '/health')).toEqual({
      kind: 'method_not_allowed',
      allow: ['GET', 'POST'],
    });
  });

  it('rejects malformed percent-encoding in a param with bad_request', () => {
    const router = new Router().get('/stores/:id', noop);
    expect(() => router.resolve('GET', '/stores/%E0%A4%A')).toThrowError(ApiError);
  });

  it('rejects duplicate route registration', () => {
    const router = new Router().get('/health', noop);
    expect(() => router.get('/health/', noop)).toThrowError(/Duplicate route/);
  });

  it('round-trips any encoded param value (property)', () => {
    const router = new Router().get('/stores/:storeId/departments/:deptId', noop);
    const segment = fc.string({ minLength: 1, maxLength: 24 });
    fc.assert(
      fc.property(segment, segment, (storeId, deptId) => {
        const path = `/stores/${encodeURIComponent(storeId)}/departments/${encodeURIComponent(deptId)}`;
        const match = router.resolve('GET', path);
        expect(match.kind).toBe('matched');
        if (match.kind === 'matched') {
          expect(match.params).toEqual({ storeId, deptId });
        }
      }),
    );
  });

  it('never matches a path with a different segment count (property)', () => {
    const router = new Router().get('/a/:x/c', noop);
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z0-9]{1,6}$/), { minLength: 0, maxLength: 6 }),
        (segments) => {
          fc.pre(segments.length !== 3);
          expect(router.resolve('GET', `/${segments.join('/')}`).kind).not.toBe('matched');
        },
      ),
    );
  });

  it('removes every cost figure from a response without a principal (task 21)', async () => {
    const router = new Router().get('/open', publicRoute(), () => ({
      statusCode: 200,
      body: { label: 'x', seasonCost: costFigure({ level: 'network' }, 13_600_000) },
    }));
    const match = router.resolve('GET', '/open');
    if (match.kind !== 'matched') throw new Error('route not matched');
    const context = { principal: null } as unknown as RequestContext;
    const res = await match.handler({ method: 'GET', path: '/open', headers: {}, query: {}, body: undefined, params: {}, route: '/open' }, context);
    expect(res.body).toEqual({ label: 'x' });
  });
});
