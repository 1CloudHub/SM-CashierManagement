/**
 * API wire contracts shared by the API service and the SPA: the JSON error
 * model and the health-check response.
 */
import type { IsoDateTime } from './entities.js';

export const API_ERROR_CODES = [
  'bad_request',
  'validation_failed',
  'unauthenticated',
  'forbidden',
  'not_found',
  'method_not_allowed',
  'conflict',
  'payload_too_large',
  'unsupported_media_type',
  'internal_error',
  'service_unavailable',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const HTTP_STATUS_BY_ERROR_CODE: Readonly<Record<ApiErrorCode, number>> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  internal_error: 500,
  service_unavailable: 503,
};

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value);
}

/** One field-level validation problem. `path` is dot-joined (e.g. `settings.serviceLevel`). */
export interface ApiErrorDetail {
  readonly path: string;
  readonly message: string;
}

/**
 * Error response body. `message` is safe to show to users; internals (stack
 * traces, SQL, object attributes outside scope) are never included. The
 * `requestId` is the reference ID shown on the 500/503 page.
 */
export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly requestId: string;
    readonly details?: readonly ApiErrorDetail[];
  };
}

export const API_SERVICE_NAME = 'lanewise-api';

/** `GET /health` response contract (walking skeleton, task 3.5). */
export interface HealthResponse {
  readonly status: 'ok';
  readonly service: typeof API_SERVICE_NAME;
  readonly env: string;
  readonly time: IsoDateTime;
}
