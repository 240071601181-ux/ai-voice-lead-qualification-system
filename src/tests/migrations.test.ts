import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { runMigrations } from '../database/migrate';

class MigrationDb {
  applied = new Map<string, string>();
  queries: string[] = [];
  legacy018 = false;
  roleValues = ['ADMIN', 'OPERATOR', 'OPERATOR'];
  roleConstraint: string[] = ['ADMIN', 'OPERATOR'];
  connect = async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      this.queries.push(sql);
      if (sql.includes('to_regclass')) {
        return { rows: [{ has_users: this.legacy018, has_role: this.legacy018, has_018_tables: this.legacy018, has_operator_constraint: this.legacy018 }] };
      }
      if (sql.includes('COUNT(*)::text')) return { rows: [{ count: String(this.applied.size) }] };
      if (sql.startsWith('SELECT checksum FROM schema_migrations')) {
        const checksum = this.applied.get(String(params[0]));
        return { rows: checksum ? [{ checksum }] : [] };
      }
      if (sql.startsWith('INSERT INTO schema_migrations')) {
        this.applied.set(String(params[0]), String(params[1]));
      }
      if (sql.includes("UPDATE users SET role = 'USER' WHERE role = 'OPERATOR'")) {
        this.roleValues = this.roleValues.map((role) => role === 'OPERATOR' ? 'USER' : role);
      }
      if (sql.includes("CHECK (role IN ('ADMIN', 'USER'))")) this.roleConstraint = ['ADMIN', 'USER'];
      return { rows: [] };
    },
    release: jest.fn(),
  }) as any;
}

describe('migration runner', () => {
  let temp: string;
  beforeEach(() => { temp = mkdtempSync(path.join(os.tmpdir(), 'madlead-migrations-')); });
  afterEach(() => rmSync(temp, { recursive: true, force: true }));

  it('applies a fresh migration once and skips it on the second run', async () => {
    const directory = path.join(temp, 'migrations');
    mkdirSync(directory);
    writeFileSync(path.join(directory, '001_first.sql'), 'CREATE TABLE first_table (id INT);');
    const db = new MigrationDb();
    await runMigrations(db as any, directory);
    await runMigrations(db as any, directory);
    expect(db.applied.size).toBe(1);
    expect(db.queries.filter((query) => query.includes('CREATE TABLE first_table'))).toHaveLength(1);
  });

  it('baselines a complete 018 database, upgrades OPERATOR rows, and keeps only ADMIN/USER', async () => {
    const db = new MigrationDb();
    db.legacy018 = true;
    const migrationsDir = path.resolve(__dirname, '../database/migrations');
    await runMigrations(db as any, migrationsDir);
    await runMigrations(db as any, migrationsDir);
    expect(db.applied.size).toBe(19);
    expect(db.roleValues).toEqual(['ADMIN', 'USER', 'USER']);
    expect(db.roleConstraint).toEqual(['ADMIN', 'USER']);
    expect(db.queries.filter((query) => query.includes("UPDATE users SET role = 'USER' WHERE role = 'OPERATOR'")).length).toBe(1);
    expect(db.queries.filter((query) => query.includes('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check')).length).toBe(1);
  });

  it('stops with the exact migration name when a migration fails', async () => {
    const directory = path.join(temp, 'migrations');
    mkdirSync(directory);
    writeFileSync(path.join(directory, '007_broken.sql'), 'BROKEN SQL;');
    const db = new MigrationDb();
    const connect = db.connect;
    db.connect = async () => {
      const client = await connect();
      const original = client.query;
      client.query = async (sql: string, params?: unknown[]) => {
        if (sql === 'BROKEN SQL;') throw new Error('syntax error');
        return original(sql, params);
      };
      return client;
    };
    await expect(runMigrations(db as any, directory)).rejects.toThrow('Migration 007_broken.sql failed: syntax error');
    expect(db.applied.size).toBe(0);
  });

  it('fails closed when an already applied migration file changes', async () => {
    const directory = path.join(temp, 'migrations');
    mkdirSync(directory);
    writeFileSync(path.join(directory, '003_stable.sql'), 'SELECT 1;');
    const db = new MigrationDb();
    await runMigrations(db as any, directory);
    writeFileSync(path.join(directory, '003_stable.sql'), 'SELECT 2;');
    await expect(runMigrations(db as any, directory)).rejects.toThrow('Migration drift detected for 003_stable.sql');
  });
});
