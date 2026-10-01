import type pg from 'pg';
import { rbacConfigFromEnv, type RbacConfig } from './auth/config.js';
import { createEnforcer } from './auth/enforcer.js';
import { publicRoute } from './auth/guards.js';
import { createPool } from './db/pool.js';
import { errors } from './http/errors.js';
import { Router } from './http/router.js';
import { createS3Storage, type IngestionStorage } from './ingestion/storage.js';
import { createInProcessQueue, createSqsQueue, type JobQueue } from './jobs/queue.js';
import { registerApprovalRoutes } from './routes/approvals.js';
import { healthHandler } from './routes/health.js';
import { registerIngestionRoutes } from './routes/ingestion.js';
import { registerLocationPrivacyRoutes } from './routes/location-privacy.js';
import { registerMeRoutes } from './routes/me.js';
import { registerPlanningRoutes } from './routes/planning.js';
import { registerNetworkMapRoutes } from './routes/network-map.js';
import { registerSavedViewRoutes } from './routes/saved-views.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerRosterRoutes } from './routes/rosters.js';
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
   * Background-job queue (task 14.2): SQS when `JOBS_QUEUE_URL` is set, else
   * jobs run in-process. Omitted (tests) => in-process over `db`.
   */
  readonly jobs?: () => JobQueue;
}

/**
 * Production dependencies: `DATABASE_URL` (pool created on first use), the
 * RBAC env flags, the uploads bucket `UPLOADS_BUCKET` (infra/lib/data-stack.ts)
 * and the jobs queue `JOBS_QUEUE_URL` (infra/lib/jobs-stack.ts).
 */
export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): AppDeps {
  let pool: pg.Pool | null = null;
  let storage: IngestionStorage | null = null;
  let queue: JobQueue | null = null;
  const db = () => {
    if (pool) return pool;
    const connectionString = env.DATABASE_URL;
    if (!connectionString) throw errors.serviceUnavailable();
    pool = createPool({ connectionString, max: 2 });
    return pool;
  };
  return {
    db,
    jobs: () => {
      queue ??= env.JOBS_QUEUE_URL ? createSqsQueue(env.JOBS_QUEUE_URL) : createInProcessQueue(db);
      return queue;
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
  registerSearchRoutes(router, deps);
  registerSavedViewRoutes(router, deps);
  registerIngestionRoutes(router, deps);
  registerRuleRoutes(router, deps);
  registerScenarioRoutes(router, deps);
  registerLocationPrivacyRoutes(router, deps);
  registerApprovalRoutes(router, deps);
  const inProcess = createInProcessQueue(deps.db);
  registerPlanningRoutes(router, { db: deps.db, jobs: deps.jobs ?? (() => inProcess) });
  registerNetworkMapRoutes(router, deps);
  registerRosterRoutes(router, deps);
  return router.assertGuarded();
}
