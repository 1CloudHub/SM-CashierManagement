import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { API_ERROR_CODES, type ApiErrorBody, type HealthResponse } from '@lanewise/shared';
import { createApp } from '../src/app.js';
import { parseInput } from '../src/http/validation.js';
import { createLambdaHandler, parseAllowedOrigins } from '../src/lambda.js';

const FIXED_NOW = new Date('2026-10-01T08:00:00.000Z');

function event(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/health',
    resource: '/health',
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    body: null,
    isBase64Encoded: false,
    requestContext: { requestId: 'req-123' } as APIGatewayProxyEvent['requestContext'],
    ...overrides,
  };
}

const lambdaContext = { awsRequestId: 'aws-req-1' } as Context;

function setup(router = createApp()) {
  const lines: string[] = [];
  const handler = createLambdaHandler({
    router,
    env: 'prod',
    now: () => FIXED_NOW,
    logSink: (line) => lines.push(line),
    logLevel: 'debug',
  });
  const call = async (e: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> =>
    handler(e, lambdaContext);
  return { call, lines };
}

describe('GET /health', () => {
  it('returns the health contract', async () => {
    const { call } = setup();
    const res = await call(event());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as HealthResponse;
    expect(body).toEqual({
      status: 'ok',
      service: 'lanewise-api',
      env: 'prod',
      time: '2026-10-01T08:00:00.000Z',
    });
    expect(res.headers).toMatchObject({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': 'req-123',
    });
  });

  it('logs one structured access line per request without headers or body', async () => {
    const { call, lines } = setup();
    await call(event({ headers: { Authorization: 'Bearer secret-token' } }));
    const access = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((e) => e.msg === 'request completed');
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({
      method: 'GET',
      route: '/health',
      status: 200,
      requestId: 'req-123',
      service: 'lanewise-api',
      env: 'prod',
    });
    expect(lines.join('\n')).not.toContain('secret-token');
  });
});

describe('error model', () => {
  it('returns 404 not_found JSON for unknown routes', async () => {
    const { call } = setup();
    const res = await call(event({ path: '/does-not-exist' }));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({
      error: { code: 'not_found', message: 'Resource not found.', requestId: 'req-123' },
    });
  });

  it('returns 405 with an Allow header for a wrong method', async () => {
    const { call } = setup();
    const res = await call(event({ httpMethod: 'DELETE' }));
    expect(res.statusCode).toBe(405);
    expect(res.headers?.Allow).toBe('GET');
    expect((JSON.parse(res.body) as ApiErrorBody).error.code).toBe('method_not_allowed');
  });

  it('returns 400 bad_request for malformed JSON bodies', async () => {
    const app = createApp().post('/echo', (req) => ({ statusCode: 200, body: req.body }));
    const { call } = setup(app);
    const res = await call(
      event({
        httpMethod: 'POST',
        path: '/echo',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as ApiErrorBody).error.code).toBe('bad_request');
  });

  it('returns 415 for non-JSON request bodies', async () => {
    const app = createApp().post('/echo', (req) => ({ statusCode: 200, body: req.body }));
    const { call } = setup(app);
    const res = await call(
      event({ httpMethod: 'POST', path: '/echo', headers: { 'content-type': 'text/plain' }, body: 'hi' }),
    );
    expect(res.statusCode).toBe(415);
  });

  it('parses JSON (including base64-encoded) bodies and validates them', async () => {
    const schema = z.object({ name: z.string().min(1) });
    const app = createApp().post('/echo', (req) => ({
      statusCode: 201,
      body: parseInput(schema, req.body, 'body'),
    }));
    const { call } = setup(app);
    const ok = await call(
      event({
        httpMethod: 'POST',
        path: '/echo',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: Buffer.from(JSON.stringify({ name: 'x' })).toString('base64'),
        isBase64Encoded: true,
      }),
    );
    expect(ok.statusCode).toBe(201);
    expect(JSON.parse(ok.body)).toEqual({ name: 'x' });

    const bad = await call(
      event({
        httpMethod: 'POST',
        path: '/echo',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }),
    );
    expect(bad.statusCode).toBe(422);
    const errBody = JSON.parse(bad.body) as ApiErrorBody;
    expect(errBody.error.code).toBe('validation_failed');
    expect(errBody.error.details?.[0]?.path).toBe('body.name');
  });

  it('hides internal error details behind a 500 with the request id', async () => {
    const app = createApp().get('/boom', () => {
      throw new Error('db password=hunter2 at /var/task/secret.js');
    });
    const { call } = setup(app);
    const res = await call(event({ path: '/boom' }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      error: {
        code: 'internal_error',
        message: 'Something went wrong. Quote the reference ID if you contact support.',
        requestId: 'req-123',
      },
    });
    expect(res.body).not.toContain('hunter2');
  });

  it('always responds with a well-formed JSON body and a known status (property)', async () => {
    const { call } = setup();
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'),
        fc.array(fc.string({ maxLength: 8 }), { maxLength: 4 }),
        fc.option(fc.string({ maxLength: 64 }), { nil: null }),
        async (method, segments, body) => {
          const res = await call(
            event({
              httpMethod: method,
              path: `/${segments.map(encodeURIComponent).join('/')}`,
              headers: { 'content-type': 'application/json' },
              body,
            }),
          );
          const parsed = JSON.parse(res.body) as unknown;
          if (res.statusCode >= 400) {
            const errBody = parsed as ApiErrorBody;
            expect(API_ERROR_CODES).toContain(errBody.error.code);
            expect(errBody.error.requestId).toBe('req-123');
          } else {
            expect(res.statusCode).toBe(200);
            expect(parsed).toMatchObject({ status: 'ok' });
          }
        },
      ),
    );
  });
});

describe('CORS response headers', () => {
  const SPA = 'https://lanewise.prototypes.1cloudhub.com';
  const CF = 'https://d111111abcdef8.cloudfront.net';

  function withOrigins(allowedOrigins?: readonly string[]) {
    const handler = createLambdaHandler({
      router: createApp(),
      env: 'prod',
      now: () => FIXED_NOW,
      logSink: () => undefined,
      ...(allowedOrigins ? { allowedOrigins } : {}),
    });
    return (origin?: string) =>
      handler(event(origin ? { headers: { Origin: origin } } : {}), lambdaContext);
  }

  it('allows any origin when no allowlist is configured', async () => {
    const res = await withOrigins([])(SPA);
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
  });

  it('echoes an allowlisted origin (custom domain or CloudFront domain) and varies on Origin', async () => {
    const call = withOrigins([SPA, CF]);
    for (const origin of [SPA, CF]) {
      const res = await call(origin);
      expect(res.headers).toMatchObject({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin' });
    }
  });

  it('omits Access-Control-Allow-Origin for other or missing origins', async () => {
    const call = withOrigins([SPA, CF]);
    for (const origin of ['https://evil.example.com', `${SPA}.evil.io`, undefined]) {
      const res = await call(origin);
      expect(res.statusCode).toBe(200);
      expect(res.headers?.['Access-Control-Allow-Origin']).toBeUndefined();
      expect(res.headers?.Vary).toBe('Origin');
    }
  });

  it('parses the CORS_ALLOWED_ORIGINS env format', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('*')).toEqual([]);
    expect(parseAllowedOrigins(` ${SPA} ,${CF},`)).toEqual([SPA, CF]);
  });
});
