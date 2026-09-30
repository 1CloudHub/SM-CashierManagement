import type { ApiErrorDetail } from '@lanewise/shared';
import type { z } from 'zod';
import { ApiError } from './errors.js';

export type InputLocation = 'body' | 'query' | 'params';

/**
 * Validates untrusted input against a zod schema and returns the typed value.
 *
 * Every handler validates its body/query/params through this before use, so
 * no unvalidated input reaches the domain layer. Failures become a 422
 * `validation_failed` error with one detail per problem; paths are prefixed
 * with the input location (e.g. `body.settings.serviceLevel`).
 */
export function parseInput<S extends z.ZodType>(
  schema: S,
  value: unknown,
  location: InputLocation,
): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const details: ApiErrorDetail[] = result.error.issues.map((issue) => ({
    path: [location, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
  throw new ApiError('validation_failed', 'Some fields are missing or invalid.', { details });
}
