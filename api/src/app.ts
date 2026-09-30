import { envDeps, type AppDeps } from './deps.js';
import { Router } from './http/router.js';
import { healthHandler } from './routes/health.js';
import { registerIngestionRoutes } from './routes/ingestion.js';

/**
 * Builds the application router. Feature routes are registered here as later
 * tasks add them; each declares its required permission (`permission` route
 * option, see http/permissions.ts) so it is authorised against the active role
 * and scope (task 8.1, P12), and validates input with `parseInput`.
 *
 * API Gateway proxies every path to this function behind the Cognito
 * authorizer (infra/lib/api-stack.ts); only `/health` is public.
 */
export function createApp(deps: AppDeps = envDeps()): Router {
  const router = new Router().get('/health', healthHandler);
  registerIngestionRoutes(router, deps);
  return router;
}
