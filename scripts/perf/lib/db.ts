/**
 * Benchmark database: an embedded PostgreSQL 17 (the same `embedded-postgres`
 * setup as api/test/support/global-setup.ts) or `PERF_DATABASE_URL` (an admin
 * URL, e.g. postgres://postgres:pw@localhost:5432/postgres), with a fresh
 * database migrated by the real migrations in api/migrations.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadMigrations, migrate } from '../../../api/src/db/migrate.js';
import { createPool } from '../../../api/src/db/pool.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../api/migrations', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      server.close(() => (a && typeof a === 'object' ? resolve(a.port) : reject(new Error('no port'))));
    });
  });
}

export interface BenchDatabase {
  readonly pool: pg.Pool;
  /** Connection string of the benchmark database (for a separate worker pool). */
  readonly url: string;
  readonly kind: 'embedded' | 'external';
  readonly dispose: () => Promise<void>;
}

export async function startDatabase(options: { poolMax: number }): Promise<BenchDatabase> {
  let adminUrl = process.env.PERF_DATABASE_URL;
  let stopServer: (() => Promise<void>) | null = null;
  if (!adminUrl) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const port = await freePort();
    const password = randomUUID();
    const logs: string[] = [];
    const server = new EmbeddedPostgres({
      databaseDir: join(tmpdir(), `lanewise-perf-pg-${randomUUID()}`),
      port,
      user: 'postgres',
      password,
      authMethod: 'scram-sha-256',
      persistent: false,
      createPostgresUser: typeof process.getuid === 'function' && process.getuid() === 0,
      initdbFlags: ['--encoding=UTF8', '--no-sync'],
      // Same flags as the API test cluster (fsync off: disposable data).
      postgresFlags: ['-c', 'fsync=off', '-c', 'listen_addresses=127.0.0.1', '-c', 'max_connections=50'],
      onLog: (m: string) => void logs.push(m),
      onError: (e: unknown) => void logs.push(String(e)),
    });
    try {
      await server.initialise();
      await server.start();
    } catch (error) {
      console.error(logs.join(''));
      throw error;
    }
    adminUrl = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
    stopServer = () => server.stop();
  }
  const name = `lw_perf_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  const pool = createPool({ connectionString: u.toString(), max: options.poolMax });
  await migrate(pool, await loadMigrations(MIGRATIONS_DIR));
  return {
    pool,
    url: u.toString(),
    kind: stopServer ? 'embedded' : 'external',
    dispose: async () => {
      await pool.end();
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
      if (stopServer) await stopServer();
    },
  };
}
