/**
 * `npm run db:seed:demo` — seeds the demo network into DATABASE_URL, or resets
 * existing demo data to the seed (task 23; Req 19). Real (non-synthetic) rows
 * are never changed; see ./seed.ts.
 *
 * Bundled to `dist/seed-demo/index.mjs` (like the migrate CLI) so a deploy or
 * operator step can run it without the source tree. Run `db:migrate` first.
 *
 * Environment:
 *   DATABASE_URL           required
 *   DEMO_SEED_ACTOR_EMAIL  optional; an existing Administrator recorded as the
 *                          actor of the audit event (default: the seeded demo
 *                          Administrator)
 *   DEMO_SEED              optional integer POS-history seed (default: the
 *                          DOM-001 Fixture B seed)
 */
import { createPool } from '../pool.js';
import { seedDemoData } from './seed.js';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const seedText = process.env.DEMO_SEED;
  const seed = seedText === undefined || seedText === '' ? undefined : Number(seedText);
  if (seed !== undefined && !Number.isInteger(seed)) throw new Error('DEMO_SEED must be an integer');
  const pool = createPool({ connectionString, max: 1, applicationName: 'lanewise-seed-demo' });
  try {
    let actorUserId: string | undefined;
    const actorEmail = process.env.DEMO_SEED_ACTOR_EMAIL;
    if (actorEmail) {
      const { rows } = await pool.query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [
        actorEmail.toLowerCase(),
      ]);
      if (!rows[0]) throw new Error(`no user with email ${actorEmail}`);
      actorUserId = rows[0].id;
    }
    const result = await seedDemoData(pool, {
      ...(seed !== undefined ? { seed } : {}),
      ...(actorUserId !== undefined ? { actorUserId } : {}),
    });
    console.log(JSON.stringify({ msg: `demo data ${result.mode}`, auditEventId: result.auditEventId, seeded: result.seeded }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ msg: 'demo seed failed', error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
