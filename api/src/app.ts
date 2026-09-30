import { Router } from './http/router.js';
import { healthHandler } from './routes/health.js';

/**
 * Builds the application router. Feature routes are registered here as later
 * tasks add them; each must authorise against the active role and scope
 * (task 8.1, P12) and validate input with `parseInput`.
 *
 * API Gateway only forwards the resources declared in infra/lib/api-stack.ts,
 * so a new route also needs its API Gateway resource (and authorizer).
 */
export function createApp(): Router {
  return new Router().get('/health', healthHandler);
}
