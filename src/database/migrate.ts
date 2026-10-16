import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { Pool, PoolClient } from 'pg';
import { pool } from './index';

type Migration = { name: string; sql: string; checksum: string };

const migrationFiles = (directory: string): Migration[] =>
  readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => {
      const sql = readFileSync(path.join(directory, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });

/**
 * Upgrade databases created before the migration ledger was introduced.
 * The 018 schema is the legacy marker: all earlier migrations are historical
 * at that point and must not be blindly replayed against production data.
 */
const baselineLegacy018 = async (client: PoolClient, migrations: Migration[]): Promise<void> => {
  const state = await client.query<{ has_users: boolean; has_role: boolean; has_018_tables: boolean; has_operator_constraint: boolean }>(`
    SELECT to_regclass('public.users') IS NOT NULL AS has_users,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='role') AS has_role,
      to_regclass('public.customer_access_tokens') IS NOT NULL AND to_regclass('public.customer_sessions') IS NOT NULL AS has_018_tables,
      EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
        WHERE t.relname='users' AND c.conname='users_role_check' AND pg_get_constraintdef(c.oid) LIKE '%OPERATOR%') AS has_operator_constraint
  `);
  const schema = state.rows[0];
  if (!schema.has_users) return;
  if (!schema.has_role || !schema.has_018_tables || !schema.has_operator_constraint) {
    throw new Error('A pre-ledger database was found, but it does not match the complete 018 schema. Reconcile schema_migrations manually before retrying.');
  }
  const legacy = migrations.filter((migration) => /^0(?:0[1-9]|1[0-8])_/.test(migration.name));
  if (legacy.length !== 18) throw new Error(`Expected migrations 001 through 018 for legacy baseline, found ${legacy.length}`);
  for (const migration of legacy) {
    await client.query(
      'INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, $2)',
      [migration.name, migration.checksum]
    );
  }
};

export const runMigrations = async (database: Pick<Pool, 'connect'>, directory = path.resolve(__dirname, 'migrations')): Promise<void> => {
  const migrations = migrationFiles(directory);
  const client = await database.connect();
  let locked = false;
  try {
    // Session lock serializes startup migrations across app instances.
    await client.query('SELECT pg_advisory_lock($1)', [741903218]);
    locked = true;
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_name TEXT PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    await client.query('BEGIN');
    try {
      const count = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM schema_migrations');
      if (count.rows[0].count === '0') await baselineLegacy018(client, migrations);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    for (const migration of migrations) {
      const prior = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE migration_name = $1', [migration.name]
      );
      if (prior.rows.length) {
        if (prior.rows[0].checksum.trim() !== migration.checksum) {
          throw new Error(`Migration drift detected for ${migration.name}; recorded checksum does not match the file`);
        }
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, $2)', [migration.name, migration.checksum]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${migration.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [741903218]).catch(() => undefined);
    client.release();
  }
};

if (require.main === module) {
  runMigrations(pool).then(() => {
    console.log('Database migrations are up to date');
    process.exitCode = 0;
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Database migration failed');
    process.exitCode = 1;
  }).finally(() => pool.end());
}
