import type pg from 'pg';
import { rbacConfigFromEnv, type RbacConfig } from './auth/config.js';
import { createEnforcer } from './auth/enforcer.js';
import { publicRoute } from './auth/guards.js';
import { userDirectoryFromEnv, type UserDirectory } from './auth/user-directory.js';
import { createPool } from './db/pool.js';
import { errors } from './http/errors.js';
import { Router } from './http/router.js';
import { createS3Storage, type IngestionStorage } from './ingestion/storage.js';
import { registerAdminUserRoutes } from './routes/admin-users.js';
import { registerApprovalRoutes } from './routes/approvals.js';
import { registerAuditLogRoutes } from './routes/audit-log.js';
import { healthHandler } from './routes/health.js';
import { registerIngestionRoutes } from './routes/ingestion.js';
import { registerLocationPrivacyRoutes } from './routes/location-privacy.js';
import { registerMeRoutes } from './routes/me.js';
import { registerSavedViewRoutes } from './routes/saved-views.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerRuleRoutes } from './routes/rules.js';
import { registerScenarioRoutes } from './routes/scenarios.js';
import { registerStoreRoutes } from './routes/stores.js';

export interface AppDeps {
  /** The database pool (created lazily); throws `service_unavailable` when unconfigured. */
  readonly db: () => pg.Pool;
  readonly rbac: RbacConfig;
  /** Ingestion object storage (created lazily); throws `service_unavailable` when unconfigured. */
  readonly storage: () => IngestionStorage;
  /**
   * The Cognito user pool for invitations and deactivation (SCR-070/071);
   * `null` (or absent) changes the app user only.
   */
  readonly directory?: () => UserDirectory | null;
}

/**
 * Production dependencies: `DATABASE_URL` (pool created on first use), the
 * RBAC env flags, the uploads bucket `UPLOADS_BUCKET` (infra/lib/data-stack.ts)
 * and the user pool `COGNITO_USER_POOL_ID` (infra/lib/api-stack.ts).
 */
export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): AppDeps {
  let pool: pg.Pool | null = null;
  let storage: IngestionStorage | null = null;
  let directory: UserDirectory | null | undefined;
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
    directory: () => {
      if (directory === undefined) directory = userDirectoryFromEnv(env);
      return directory;
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
  registerSearchRoutes(router, deps);
  registerSavedViewRoutes(router, deps);
  registerIngestionRoutes(router, deps);
  registerRuleRoutes(router, deps);
  registerScenarioRoutes(router, deps);
  registerLocationPrivacyRoutes(router, deps);
  registerApprovalRoutes(router, deps);
  registerAdminUserRoutes(router, deps);
  registerAuditLogRoutes(router, deps);
  return router.assertGuarded();
}
