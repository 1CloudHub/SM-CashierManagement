/**
 * AWS Lambda entry point: adapts API Gateway (REST, proxy integration) events
 * to the transport-neutral router, and owns the cross-cutting concerns —
 * request context, JSON body parsing, the JSON error model, response headers
 * and structured access logging.
 */
import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createApp } from './app.js';
import { identityFromClaims, type RequestContext } from './context.js';
import { ApiError, errors, internalErrorBody, toErrorBody } from './http/errors.js';
import type { Router } from './http/router.js';
import type { ApiRequest, ApiResponse } from './http/types.js';
import { createLogger, isLogLevel, type LogLevel } from './logger.js';

/** Largest accepted request body (bytes, after base64 decoding). */
export const MAX_BODY_BYTES = 1024 * 1024;

export interface LambdaHandlerOptions {
  readonly router?: Router;
  readonly env?: string;
  readonly now?: () => Date;
  readonly logLevel?: LogLevel;
  readonly logSink?: (line: string) => void;
  /**
   * Browser origins allowed to call the API (CORS). Defaults to the
   * comma-separated `CORS_ALLOWED_ORIGINS` env var set by infra/lib/api-stack.ts;
   * empty or `*` => any origin.
   */
  readonly allowedOrigins?: readonly string[];
}

export type LambdaHandler = (event: APIGatewayProxyEvent, context: Context) => Promise<APIGatewayProxyResult>;

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

/** Parses a comma-separated origin allowlist; `[]` means any origin. */
export function parseAllowedOrigins(value: string | undefined): string[] {
  const origins = (value ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  return origins.includes('*') ? [] : origins;
}

/**
 * CORS response headers. Mirrors the API Gateway preflight in
 * infra/lib/api-stack.ts: the request's Origin is echoed only when it is on
 * the allowlist (the SPA's custom domain and CloudFront domain).
 */
function corsHeaders(allowedOrigins: readonly string[], origin: string | undefined): Record<string, string> {
  if (allowedOrigins.length === 0) return { 'Access-Control-Allow-Origin': '*' };
  if (origin !== undefined && allowedOrigins.includes(origin)) {
    return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  }
  return { Vary: 'Origin' };
}

function lowerCaseHeaders(headers: APIGatewayProxyEvent['headers'] | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (typeof v === 'string') out[k.toLowerCase()] = v;
  }
  return out;
}

function queryParams(event: APIGatewayProxyEvent): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(event.queryStringParameters ?? {})) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function parseBody(event: APIGatewayProxyEvent, headers: Record<string, string>): unknown {
  if (event.body === null || event.body === undefined || event.body.length === 0) return undefined;

  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'utf8');
  if (raw.byteLength > MAX_BODY_BYTES) throw errors.payloadTooLarge();

  const contentType = (headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw errors.unsupportedMediaType();

  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw errors.badRequest('Request body is not valid JSON.');
  }
}

function toResult(response: ApiResponse, requestId: string, cors: Record<string, string>): APIGatewayProxyResult {
  return {
    statusCode: response.statusCode,
    headers: { ...BASE_HEADERS, ...cors, ...response.headers, 'X-Request-Id': requestId },
    body: JSON.stringify(response.body ?? null),
  };
}

export function createLambdaHandler(options: LambdaHandlerOptions = {}): LambdaHandler {
  const router = options.router ?? createApp();
  const env = options.env ?? process.env.LANEWISE_ENV ?? 'unknown';
  const allowedOrigins = options.allowedOrigins ?? parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
  const now = options.now ?? (() => new Date());
  const envLevel = process.env.LOG_LEVEL;
  const rootLogger = createLogger({
    level: options.logLevel ?? (isLogLevel(envLevel) ? envLevel : 'info'),
    base: { service: 'lanewise-api', env },
    now,
    ...(options.logSink ? { sink: options.logSink } : {}),
  });

  return async (event, lambdaContext) => {
    const started = Date.now();
    const requestId = event.requestContext?.requestId ?? lambdaContext.awsRequestId ?? randomUUID();
    const method = (event.httpMethod ?? 'GET').toUpperCase();
    const logger = rootLogger.child({ requestId });
    let route: string | null = null;
    let response: ApiResponse;

    try {
      const headers = lowerCaseHeaders(event.headers);
      const match = router.resolve(method, event.path ?? '/');
      if (match.kind === 'not_found') throw errors.notFound();
      if (match.kind === 'method_not_allowed') throw errors.methodNotAllowed(match.allow);
      route = match.pattern;

      const request: ApiRequest = {
        method,
        path: event.path,
        headers,
        query: queryParams(event),
        body: parseBody(event, headers),
      };
      const claims = (event.requestContext?.authorizer as { claims?: Record<string, unknown> } | null | undefined)
        ?.claims;
      const context: RequestContext = {
        requestId,
        env,
        now,
        logger: logger.child({ route }),
        identity: identityFromClaims(claims),
        principal: null,
      };

      response = await match.handler({ ...request, params: match.params, route }, context);
    } catch (err) {
      if (err instanceof ApiError) {
        response = { statusCode: err.status, headers: err.headers, body: toErrorBody(err, requestId) };
        if (err.status >= 500) logger.error('request failed', { code: err.code, err });
      } else {
        logger.error('unhandled error', { err });
        response = { statusCode: 500, body: internalErrorBody(requestId) };
      }
    }

    // Access log: never includes headers, query or body (may carry PII/tokens).
    logger.info('request completed', {
      method,
      route,
      status: response.statusCode,
      durationMs: Date.now() - started,
    });
    const origin = lowerCaseHeaders(event.headers).origin;
    return toResult(response, requestId, corsHeaders(allowedOrigins, origin));
  };
}

/** Lambda handler (`index.handler` in the bundle). */
export const handler: LambdaHandler = createLambdaHandler();
