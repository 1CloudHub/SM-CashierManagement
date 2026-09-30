import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, migrate, type Migration } from '../../src/db/migrate.js';
import { createTestDatabase, MIGRATIONS_DIR, type TestDatabase } from '../support/db.js';

const TABLES = [
  'app_user',
  'passkey',
  'role_assignment',
  'region',
  'store',
  'department',
  'store_location',
  'barangay',
  'dataset_snapshot',
  'ingestion_run',
  'rule_set',
  'rule_version',
  'scenario',
  'scenario_snapshot',
  'scenario_rule_version',
  'scenario_run',
  'scenario_run_snapshot',
  'scenario_run_rule_version',
  'approval_step',
  'staff',
  'staff_training',
  'staff_availability',
  'roster',
  'shift',
  'shift_override',
  'staff_request',
  'staff_home_area',
  'travel_time',
  'shift_offer',
  'transfer_request',
  'transfer_request_staff',
  'notification',
  'notification_preference',
  'saved_view',
  'audit_event',
  'consent_text',
  'staff_consent',
];

describe('migration runner', () => {
  let db: TestDatabase;
  let migrations: Migration[];

  beforeAll(async () => {
    db = await createTestDatabase({ migrated: false });
    migrations = await loadMigrations(MIGRATIONS_DIR);
  });
  afterAll(async () => {
    await db.dispose();
  });

  it('loads the migrations in version order', () => {
    const versions = migrations.map((m) => m.version);
    expect(versions).toEqual([...versions].sort());
    expect(versions[0]).toBe('0001');
  });

  it('applies every migration once and is idempotent on re-run', async () => {
    const first = await migrate(db.pool, migrations);
    expect(first.applied).toEqual(migrations.map((m) => m.version));
    const second = await migrate(db.pool, migrations);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(migrations.map((m) => m.version));
  });

  it('creates every DOM-002 table', async () => {
    const { rows } = await db.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = rows.map((r) => r.table_name);
    for (const t of TABLES) expect(names).toContain(t);
  });

  it('rejects an applied migration whose SQL was edited', async () => {
    const tampered = migrations.map((m, i) => (i === 0 ? { ...m, checksum: 'x'.repeat(64) } : m));
    await expect(migrate(db.pool, tampered)).rejects.toThrow(/modified after being applied/);
  });

  it('serialises concurrent runners', async () => {
    const results = await Promise.all([migrate(db.pool, migrations), migrate(db.pool, migrations)]);
    for (const r of results) expect(r.applied).toEqual([]);
  });
});
