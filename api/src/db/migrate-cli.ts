/**
 * `npm run db:migrate` — applies pending migrations to DATABASE_URL.
 *
 * Bundled to `dist/migrate/index.mjs` with the SQL files copied beside it
 * (`dist/migrate/migrations/`), so a deploy step (task 24) can run it without
 * the source tree. MIGRATIONS_DIR overrides the directory.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMigrations, migrate } from './migrate.js';
import { createPool } from './pool.js';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const dir = process.env.MIGRATIONS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const pool = createPool({ connectionString, max: 1, applicationName: 'lanewise-migrate' });
  try {
    const result = await migrate(pool, await loadMigrations(dir));
    console.log(
      JSON.stringify({ msg: 'migrations complete', applied: result.applied, alreadyApplied: result.alreadyApplied.length }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ msg: 'migration failed', error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
