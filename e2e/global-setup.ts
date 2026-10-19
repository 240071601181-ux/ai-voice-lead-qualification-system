import bcrypt from 'bcryptjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import type { FullConfig } from '@playwright/test';

const statePath = path.resolve('test-results/e2e-state.json');
const password = process.env.E2E_TEST_PASSWORD || 'E2e-only-password-123!';

function e2eDatabaseUrl(): string {
  const raw = process.env.E2E_DATABASE_URL;
  if (!raw) throw new Error('E2E_DATABASE_URL is required and must name a disposable database.');
  const url = new URL(raw);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('E2E_DATABASE_URL must point to localhost or 127.0.0.1.');
  }
  if (!/^madlead_e2e_[a-z0-9_]+$/i.test(url.pathname.slice(1))) {
    throw new Error('E2E_DATABASE_URL database name must match madlead_e2e_<suffix>.');
  }
  return raw;
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const databaseUrl = e2eDatabaseUrl();
  const runId = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const adminEmail = `e2e-admin-${runId}@example.test`;
  const userEmail = `e2e-user-${runId}@example.test`;
  const leadEmail = `e2e-lead-${runId}@example.test`;
  const client = new Client({ connectionString: databaseUrl });

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'migrate'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  await client.connect();
  try {
    const hash = await bcrypt.hash(password, 12);
    const admin = await client.query(
      `INSERT INTO users (email, password_hash, name, role, status)
       VALUES ($1, $2, $3, 'ADMIN', 'active') RETURNING id`,
      [adminEmail, hash, 'E2E Admin']
    );
    const user = await client.query(
      `INSERT INTO users (email, password_hash, name, role, status)
       VALUES ($1, $2, $3, 'USER', 'active') RETURNING id`,
      [userEmail, hash, 'E2E User']
    );
    const lead = await client.query(
      `INSERT INTO leads (source, name, phone, email, status)
       VALUES ('e2e', 'E2E Lead', '+919999000001', $1, 'NEW') RETURNING id`,
      [leadEmail]
    );
    fs.writeFileSync(
      statePath,
      JSON.stringify({ adminEmail, userEmail, leadEmail, adminId: admin.rows[0].id, userId: user.rows[0].id, leadId: lead.rows[0].id, password }, null, 2),
      'utf8'
    );
  } finally {
    await client.end();
  }
}

export { statePath, e2eDatabaseUrl };
