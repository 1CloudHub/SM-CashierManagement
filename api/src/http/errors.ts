import {
  HTTP_STATUS_BY_ERROR_CODE,
  NOT_FOUND_OR_NO_ACCESS_MESSAGE,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiErrorDetail,
} from '@lanewise/shared';

/**
 * An expected, user-safe API failure. Anything thrown that is not an ApiError
 * is treated as an internal error and its message is never returned to the
 * client (design.md › Error Handling: "no stack trace shown").
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: readonly ApiErrorDetail[];
  /** Extra response headers (e.g. `Allow` for 405). */
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { details?: readonly ApiErrorDetail[]; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = HTTP_STATUS_BY_ERROR_CODE[code];
    this.details = options.details ?? [];
    this.headers = options.headers ?? {};
  }
}

export const INTERNAL_ERROR_MESSAGE =
  'Something went wrong. Quote the reference ID if you contact support.';

export const errors = {
  badRequest: (message = 'The request is malformed.') => new ApiError('bad_request', message),
  unauthenticated: () => new ApiError('unauthenticated', 'Sign in to continue.'),
  /** Deliberately generic: never reveal anything about an out-of-scope object (P1). */
  forbidden: () => new ApiError('forbidden', 'You do not have access to this resource.'),
  notFound: () => new ApiError('not_found', 'Resource not found.'),
  /**
   * A deep link to an object that is missing **or** out of scope: identical
   * either way, so the response never reveals that the object exists (Req 2.4).
   */
  notFoundOrNoAccess: () => new ApiError('not_found', NOT_FOUND_OR_NO_ACCESS_MESSAGE),
  methodNotAllowed: (allow: readonly string[]) =>
    new ApiError('method_not_allowed', 'Method not allowed for this resource.', {
      headers: { Allow: allow.join(', ') },
    }),
  unsupportedMediaType: () =>
    new ApiError('unsupported_media_type', 'Request body must be application/json.'),
  payloadTooLarge: (message = 'Request body is too large.') => new ApiError('payload_too_large', message),
  conflict: (message: string) => new ApiError('conflict', message),
  validationFailed: (message: string, details: readonly ApiErrorDetail[] = []) =>
    new ApiError('validation_failed', message, { details }),
  /** A dependency (database, storage) is not configured or unreachable. */
  serviceUnavailable: () =>
    new ApiError('service_unavailable', 'The service is temporarily unavailable. Try again shortly.'),
} as const;

export function toErrorBody(err: ApiError, requestId: string): ApiErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      requestId,
      ...(err.details.length > 0 ? { details: err.details } : {}),
    },
  };
}

export function internalErrorBody(requestId: string): ApiErrorBody {
  return { error: { code: 'internal_error', message: INTERNAL_ERROR_MESSAGE, requestId } };
}
