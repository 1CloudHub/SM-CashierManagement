import { API_SERVICE_NAME, type HealthResponse } from '@lanewise/shared';
import type { RouteHandler } from '../http/types.js';

/** `GET /health` — unauthenticated liveness probe (walking skeleton, task 3.5). */
export const healthHandler: RouteHandler = (_request, context) => {
  const body: HealthResponse = {
    status: 'ok',
    service: API_SERVICE_NAME,
    env: context.env,
    time: context.now().toISOString(),
  };
  return { statusCode: 200, body };
};
