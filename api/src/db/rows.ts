/** Small helpers shared by the repositories. */
import type pg from 'pg';
import { errors } from '../http/errors.js';
import type { Queryable } from './pool.js';

/** Runs a query expected to return exactly one row; 404 when none. */
export async function queryOne<R extends pg.QueryResultRow>(
  db: Queryable,
  text: string,
  values: readonly unknown[] = [],
): Promise<R> {
  const { rows } = await db.query<R>(text, values);
  const row = rows[0];
  if (!row) throw errors.notFound();
  return row;
}

/** Like queryOne but returns null when there is no row. */
export async function queryMaybe<R extends pg.QueryResultRow>(
  db: Queryable,
  text: string,
  values: readonly unknown[] = [],
): Promise<R | null> {
  const { rows } = await db.query<R>(text, values);
  return rows[0] ?? null;
}

export function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** PostgreSQL SQLSTATE of a driver error, if any. */
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/** SQLSTATEs the API maps to 409/422 rather than 500 (constraint violations). */
export const PG_ERRORS = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  notNullViolation: '23502',
  insufficientPrivilege: '42501',
} as const;
