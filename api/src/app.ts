import type pg from 'pg';
import { createPool } from './db/pool.js';
import { errors } from './http/errors.js';
import { Router } from './http/router.js';
import { healthHandler } from './routes/health.js';
import { registerRuleRoutes, type Authorize } from './routes/rules.js';

export interface AppOptions {
  /** Database pool provider; defaults to a lazy pool on `DATABASE_URL` (503 when unset). */
  readonly db?: () => pg.Pool;
  /** The task 8.1 authorize check for feature routes (see routes/rules.ts). */
  readonly authorize?: Authorize;
}

let envPool: pg.Pool | null = null;

/** One pool per Lambda container, created on first use. */
function poolFromEnv(): pg.Pool {
  if (envPool) return envPool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw errors.serviceUnavailable();
  envPool = createPool({ connectionString, max: 2 });
  return envPool;
}

/**
 * Builds the application router. Feature routes are registered here as later
 * tasks add them; each must authorise against the active role and scope
 * (task 8.1, P12) and validate input with `parseInput`.
 *
 * API Gateway forwards every path under the root proxy declared in
 * infra/lib/api-stack.ts (behind the Cognito authorizer), so feature routes
 * need no extra API Gateway resource.
 */
export function createApp(options: AppOptions = {}): Router {
  const router = new Router().get('/health', healthHandler);
  registerRuleRoutes(router, {
    db: options.db ?? poolFromEnv,
    ...(options.authorize ? { authorize: options.authorize } : {}),
  });
  return router;
}
