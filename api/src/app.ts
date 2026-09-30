import type pg from 'pg';
import { rbacConfigFromEnv, type RbacConfig } from './auth/config.js';
import { createEnforcer } from './auth/enforcer.js';
import { publicRoute } from './auth/guards.js';
import { createPool } from './db/pool.js';
import { errors } from './http/errors.js';
import { Router } from './http/router.js';
import { createS3Storage, type IngestionStorage } from './ingestion/storage.js';
import { healthHandler } from './routes/health.js';
import { registerIngestionRoutes } from './routes/ingestion.js';
import { registerMeRoutes } from './routes/me.js';
import { registerStoreRoutes } from './routes/stores.js';

export interface AppDeps {
  /** The database pool (created lazily); throws `service_unavailable` when unconfigured. */
  readonly db: () => pg.Pool;
  readonly rbac: RbacConfig;
  /**
   * Ingestion object storage (task 9, `UPLOADS_BUCKET`); throws
   * `service_unavailable` when unconfigured. Omitted => unconfigured.
   */
  readonly storage?: () => IngestionStorage;
}

/**
 * Production dependencies: `DATABASE_URL` (pool created on first use),
 * `UPLOADS_BUCKET` (S3 client created on first use) and the RBAC env flags.
 */
export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): AppDeps {
  let pool: pg.Pool | null = null;
  let storage: IngestionStorage | null = null;
  return {
    db: () => {
      if (pool) return pool;
      const connectionString = env.DATABASE_URL;
      if (!connectionString) throw errors.serviceUnavailable();
      pool = createPool({ connectionString, max: 2 });
      return pool;
    },
    rbac: rbacConfigFromEnv(env),
    storage: () => {
      if (storage) return storage;
      const bucket = env.UPLOADS_BUCKET;
      if (!bucket) throw errors.serviceUnavailable();
      storage = createS3Storage(bucket);
      return storage;
    },
  };
}

/**
 * Builds the application router. Every route declares its guard —
 * `publicRoute()`, `authenticated()` or `authorize(resource, action,
 * scopeTarget?)` — and the app refuses to start if one doesn't (task 8.1,
 * P12). Handlers validate input with `parseInput`.
 *
 * API Gateway only forwards the resources declared in infra/lib/api-stack.ts,
 * so a new route also needs its API Gateway resource (and authorizer).
 */
export function createApp(deps: AppDeps = depsFromEnv()): Router {
  const router = new Router({ enforcer: createEnforcer(deps) }).get('/health', publicRoute(), healthHandler);
  registerMeRoutes(router, deps);
  registerStoreRoutes(router, deps);
  registerIngestionRoutes(router, deps);
  return router.assertGuarded();
}
