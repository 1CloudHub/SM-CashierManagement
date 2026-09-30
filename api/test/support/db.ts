/**
 * Per-test-file database: a fresh database on the shared test server, fully
 * migrated with the real migrations in `api/migrations/`.
 */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { inject } from 'vitest';
import { loadMigrations, migrate } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

export interface TestDatabase {
  readonly url: string;
  readonly pool: pg.Pool;
  /** Closes the pool and drops the database. */
  readonly dispose: () => Promise<void>;
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** Creates an empty database; `migrated` (default true) applies all migrations. */
export async function createTestDatabase(options: { migrated?: boolean } = {}): Promise<TestDatabase> {
  const adminUrl = inject('databaseAdminUrl');
  const name = `lw_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const url = withDatabase(adminUrl, name);
  const pool = createPool({ connectionString: url, max: 10 });
  if (options.migrated ?? true) {
    await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  }

  return {
    url,
    pool,
    dispose: async () => {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
