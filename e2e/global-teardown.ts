import fs from 'node:fs';
import { Client } from 'pg';
import { statePath, e2eDatabaseUrl } from './global-setup';

export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(statePath)) return;
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
    adminEmail: string;
    userEmail: string;
    leadEmail: string;
  };
  const client = new Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM follow_ups
       WHERE lead_id IN (SELECT id FROM leads WHERE email LIKE 'e2e-%@example.test')`
    );
    await client.query(
      `DELETE FROM leads WHERE email LIKE 'e2e-%@example.test'`
    );
    await client.query('DELETE FROM users WHERE email = ANY($1)', [[state.adminEmail, state.userEmail]]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
    fs.rmSync(statePath, { force: true });
  }
}
