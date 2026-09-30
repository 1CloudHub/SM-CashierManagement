/**
 * PostgreSQL connection pool and transactions (ADR-0002; task 5.1).
 *
 * The pool uses per-pool type parsers (no global pg mutation):
 *   - `date`    -> 'YYYY-MM-DD' string (no local-timezone Date shifting)
 *   - `int8`    -> number (counts and identity values stay well below 2^53)
 *   - `numeric` -> left as string by pg; mappers convert explicitly.
 */
import pg from 'pg';

const DATE_OID = 1082;
const INT8_OID = 20;

export interface DbConfig {
  readonly connectionString: string;
  /** Pool size; keep small on Lambda (one request per container). */
  readonly max?: number;
  readonly ssl?: pg.PoolConfig['ssl'];
  readonly applicationName?: string;
}

export function createPool(config: DbConfig): pg.Pool {
  const types = new pg.TypeOverrides();
  types.setTypeParser(DATE_OID, (value: string) => value);
  types.setTypeParser(INT8_OID, (value: string) => Number(value));
  const poolConfig: pg.PoolConfig = {
    connectionString: config.connectionString,
    max: config.max ?? 5,
    application_name: config.applicationName ?? 'lanewise-api',
    types,
  };
  if (config.ssl !== undefined) poolConfig.ssl = config.ssl;
  return new pg.Pool(poolConfig);
}

/** Anything that can run a query: a pool, a client or a transaction. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

const txBrand: unique symbol = Symbol('lanewise.tx');

/**
 * A handle to an open transaction. Only `withTransaction` creates one, so a
 * function that takes a `Tx` is guaranteed to run inside a transaction.
 */
export interface Tx extends Queryable {
  readonly [txBrand]: true;
}

function toTx(client: pg.PoolClient): Tx {
  return {
    [txBrand]: true,
    query: <R extends pg.QueryResultRow>(text: string, values?: readonly unknown[]) =>
      client.query<R>(text, values as unknown[] | undefined),
  };
}

/**
 * Runs `fn` in a single transaction: COMMIT on success, ROLLBACK on any error
 * (which is rethrown). The client is always released.
 */
export async function withTransaction<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    const result = await fn(toTx(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      broken = true; // connection is unusable; discard it
    }
    throw error;
  } finally {
    client.release(broken);
  }
}
