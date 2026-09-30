/**
 * Minimal forward-only migration runner for plain SQL files (task 5.1).
 *
 * - Migrations live in `api/migrations/NNNN_name.sql` and are applied in
 *   version order, each in its own transaction.
 * - Applied versions are recorded in `schema_migrations` with a SHA-256
 *   checksum; editing an applied migration is an error (add a new one).
 * - A session advisory lock serialises concurrent runners (e.g. two deploys).
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';

export interface Migration {
  /** Zero-padded version, e.g. `0001`. */
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
/** Arbitrary constant key for pg_advisory_lock. */
const LOCK_KEY = 7_340_531;

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new Error(`invalid migration file name: ${file} (expected NNNN_name.sql)`);
    const [, version, name] = match as unknown as [string, string, string];
    if (migrations.some((m) => m.version === version)) {
      throw new Error(`duplicate migration version ${version}`);
    }
    const sql = await readFile(join(dir, file), 'utf8');
    migrations.push({ version, name, sql, checksum: checksumOf(sql) });
  }
  return migrations;
}

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

export async function migrate(pool: pg.Pool, migrations: readonly Migration[]): Promise<MigrateResult> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version    text PRIMARY KEY,
          name       text NOT NULL,
          checksum   text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`);
      const { rows } = await client.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations',
      );
      const known = new Map(rows.map((r) => [r.version, r.checksum]));
      const applied: string[] = [];
      const alreadyApplied: string[] = [];

      for (const m of [...migrations].sort((a, b) => a.version.localeCompare(b.version))) {
        const existing = known.get(m.version);
        if (existing !== undefined) {
          if (existing !== m.checksum) {
            throw new Error(
              `migration ${m.version}_${m.name} was modified after being applied; add a new migration instead`,
            );
          }
          alreadyApplied.push(m.version);
          continue;
        }
        await client.query('BEGIN');
        try {
          await client.query(m.sql);
          await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
            m.version,
            m.name,
            m.checksum,
          ]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw new Error(`migration ${m.version}_${m.name} failed: ${(error as Error).message}`, {
            cause: error,
          });
        }
        applied.push(m.version);
      }
      return { applied, alreadyApplied };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
