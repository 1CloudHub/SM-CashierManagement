/**
 * Runtime dependencies of the feature routes: the PostgreSQL pool and the
 * ingestion object storage. Created lazily from the environment on first use
 * (`DATABASE_URL`, `INGESTION_BUCKET`), so `/health` and cold starts don't
 * need them; a route whose dependency is not configured answers 503.
 */
import type pg from 'pg';
import { createPool } from './db/pool.js';
import { errors } from './http/errors.js';
import { createS3Storage, type IngestionStorage } from './ingestion/storage.js';

export interface AppDeps {
  readonly db: () => pg.Pool;
  readonly storage: () => IngestionStorage;
}

export function envDeps(env: Readonly<Record<string, string | undefined>> = process.env): AppDeps {
  let pool: pg.Pool | null = null;
  let storage: IngestionStorage | null = null;
  return {
    db: () => {
      if (!pool) {
        const connectionString = env.DATABASE_URL;
        if (!connectionString) throw errors.serviceUnavailable();
        pool = createPool({ connectionString, max: 2 });
      }
      return pool;
    },
    storage: () => {
      if (!storage) {
        const bucket = env.INGESTION_BUCKET;
        if (!bucket) throw errors.serviceUnavailable();
        storage = createS3Storage(bucket);
      }
      return storage;
    },
  };
}
