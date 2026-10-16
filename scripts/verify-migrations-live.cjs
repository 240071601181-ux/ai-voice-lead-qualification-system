// Phase 5 — real-PostgreSQL migration verification (Step 7 A–D).
//
// Run:  npm run test:migrations:live
// (from the repository root, Windows PowerShell or any shell with node/npx)
//
// SAFETY (enforced in code, not just documented):
// - Aborts unless DATABASE_URL (from the repo .env) points at
//   localhost / 127.0.0.1. Never run this with a remote DATABASE_URL.
// - Creates and drops ONLY scratch databases named madlead_p5_* on the
//   local server (via the maintenance `postgres` database). The
//   application database is never migrated, written, or read.
// - Scratch databases are dropped in a finally block, even on failure.
// - No credentials, tokens, or row data are printed (database names and
//   counts only).
//
// What it verifies with the REAL migration runner + REAL PostgreSQL:
//   A. fresh database: full run, ledger 001–019, expected tables, the
//      ADMIN/USER role CHECK, invalid-role rejection, idempotent re-run.
//   B. legacy 018 baseline: partial 001–018 run, representative ADMIN +
//      OPERATOR + lead + conversation rows, full run applies 019,
//      OPERATOR→USER mapping with stable ids, relationships intact,
//      idempotent re-run.
//   C. drift + partial state: tampered checksum fails loudly without
//      recording; a broken 020 file fails with no ledger row.
//   D. concurrency: two runners at once both succeed with 19 unique rows.
//
// Requires: node, npx, ts-node (root devDependencies), pg (root
// dependencies), and a running local PostgreSQL. No test framework.
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = __dirname.includes('scripts') ? path.resolve(__dirname, '..') : process.cwd();
const PG = require(path.join(REPO, 'node_modules', 'pg'));

const DRIVER_SOURCE = `// TEMPORARY driver written by verify-migrations-live.mjs — deleted after use.
import { Pool } from 'pg';
import { runMigrations } from './src/database/migrate';
const main = async (): Promise<void> => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await runMigrations(pool, process.argv[2]);
    console.log('DRIVER_MIGRATIONS_OK');
  } finally {
    await pool.end();
  }
};
main().catch((error: unknown) => {
  console.error('DRIVER_MIGRATIONS_FAILED:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const envText = fs.readFileSync(path.join(REPO, '.env'), 'utf8');
const appUrl = envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim();
const parsed = new URL(appUrl);
if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
  console.log('ABORT: DATABASE_URL is not localhost; refusing to create scratch databases.');
  process.exit(2);
}
const auth = `${parsed.username}${parsed.password ? ':' + parsed.password : ''}@${parsed.hostname}:${parsed.port || 5432}`;
const maintUrl = `${parsed.protocol}//${auth}/postgres`;
const scratchUrl = (db) => `${parsed.protocol}//${auth}/${db}`;

const admin = new PG.Client({ connectionString: maintUrl, connectionTimeoutMillis: 10000 });
const q = (client, sql, params = []) => client.query(sql, params);

const runRunner = (db) => {
  // shell:true is required on Windows to resolve the npx shim.
  const r = spawnSync('npx ts-node --transpile-only src/database/migrate.ts', {
    cwd: REPO,
    shell: true,
    env: { ...process.env, DATABASE_URL: scratchUrl(db) },
    encoding: 'utf8',
    timeout: 180000,
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') + (r.error ? `\nSPAWN_ERROR: ${r.error.message}` : '') };
};

const copyMigrations = (dest, through) => {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, 'src', 'database', 'migrations'))) {
    if (!f.endsWith('.sql')) continue;
    if (through && f > through) continue;
    fs.copyFileSync(path.join(REPO, 'src', 'database', 'migrations', f), path.join(dest, f));
  }
};

const main = async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'madlead-p5-'));
  const driverPath = path.join(REPO, 'db-mig-driver-tmp.ts');
  fs.writeFileSync(driverPath, DRIVER_SOURCE);
  const runDriver = (db, dir) => {
    const r = spawnSync(`npx ts-node --transpile-only db-mig-driver-tmp.ts "${dir}"`, {
      cwd: REPO,
      shell: true,
      env: { ...process.env, DATABASE_URL: scratchUrl(db) },
      encoding: 'utf8',
      timeout: 180000,
    });
    return { status: r.status, out: (r.stdout || '') + (r.stderr || '') + (r.error ? `\nSPAWN_ERROR: ${r.error.message}` : '') };
  };

  await admin.connect().catch((e) => {
    console.log(`ABORT: cannot reach local PostgreSQL (${e.code || e.message}). Start the local server and retry; nothing was changed.`);
    try { fs.rmSync(driverPath, { force: true }); } catch { /* best effort */ }
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
    process.exit(3);
  });
  const dbs = ['madlead_p5_fresh', 'madlead_p5_legacy', 'madlead_p5_broken', 'madlead_p5_conc'];
  try {
    for (const db of dbs) {
      await q(admin, `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(() => undefined);
    }

    // ---- A. fresh database ----
    await q(admin, 'CREATE DATABASE madlead_p5_fresh');
    let r = runRunner('madlead_p5_fresh');
    check('A1 fresh run exits 0', r.status === 0, r.status === 0 ? '' : r.out.slice(-500));
    let c = new PG.Client({ connectionString: scratchUrl('madlead_p5_fresh') });
    await c.connect();
    const ledger = await q(c, 'SELECT migration_name FROM schema_migrations ORDER BY migration_name');
    check('A2 ledger holds 001–019 (19 rows)', ledger.rows.length === 19 && ledger.rows[0].migration_name.startsWith('001_') && ledger.rows[18].migration_name.startsWith('019_'), `${ledger.rows.length} rows`);
    const tables = ['users', 'leads', 'conversations', 'conversation_messages', 'qualifications', 'follow_ups', 'calendar_bookings', 'crm_syncs', 'n8n_deliveries', 'whatsapp_deliveries', 'knowledge_documents', 'knowledge_chunks', 'user_sessions', 'customer_access_tokens', 'customer_sessions', 'workspace_settings'];
    const missing = [];
    for (const t of tables) {
      const res = await q(c, 'SELECT to_regclass($1) AS r', [`public.${t}`]);
      if (!res.rows[0].r) missing.push(t);
    }
    check('A3 expected tables exist', missing.length === 0, missing.join(','));
    const cdef = await q(c, `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname='users_role_check'`);
    const def = cdef.rows[0]?.d || '';
    check('A4 role CHECK allows only ADMIN/USER', def.includes("'ADMIN'") && def.includes("'USER'") && !def.includes('OPERATOR'));
    let invalidRejected = false;
    try {
      await q(c, `INSERT INTO users (email, password_hash, role) VALUES ('bad@example.com','x','SUPERADMIN')`);
    } catch { invalidRejected = true; }
    check('A5 invalid role insert rejected', invalidRejected);
    await q(c, `INSERT INTO users (email, password_hash, name, role) VALUES ('admin@example.com','hashed-test-only','Admin','ADMIN')`);
    const cnt = await q(c, 'SELECT COUNT(*)::int AS n FROM users');
    check('A6 ADMIN insert works', cnt.rows[0].n === 1);
    r = runRunner('madlead_p5_fresh');
    const ledger2 = await q(c, 'SELECT COUNT(*)::int AS n FROM schema_migrations');
    check('A7 re-run idempotent (exit 0, still 19 rows)', r.status === 0 && ledger2.rows[0].n === 19);
    await c.end();

    // ---- B. legacy 018 baseline ----
    await q(admin, 'CREATE DATABASE madlead_p5_legacy');
    const legacyDir = path.join(workDir, 'legacy');
    copyMigrations(legacyDir, '018_admin_roles_and_customer_access.sql');
    r = runDriver('madlead_p5_legacy', legacyDir);
    check('B1 partial 001–018 run exits 0', r.status === 0, r.status === 0 ? '' : r.out.slice(-500));
    c = new PG.Client({ connectionString: scratchUrl('madlead_p5_legacy') });
    await c.connect();
    const au = await q(c, `INSERT INTO users (email, password_hash, name, role, status) VALUES ('admin@example.com','h','Admin','ADMIN','active') RETURNING id`);
    const ou = await q(c, `INSERT INTO users (email, password_hash, name, role, status) VALUES ('op@example.com','h','Op','OPERATOR','active') RETURNING id`);
    const ld = await q(c, `INSERT INTO leads (source, name, phone, status) VALUES ('manual','Legacy Lead','+10000000001','NEW') RETURNING id`);
    const cv = await q(c, `INSERT INTO conversations (lead_id, channel, status, user_id, started_at) VALUES ($1,'web','active',$2,NOW()) RETURNING id`, [ld.rows[0].id, ou.rows[0].id]);
    const adminId = au.rows[0].id, opId = ou.rows[0].id, leadId = ld.rows[0].id, convId = cv.rows[0].id;
    r = runRunner('madlead_p5_legacy');
    check('B2 full run applies 019 (exit 0)', r.status === 0, r.status === 0 ? '' : r.out.slice(-500));
    const users = await q(c, 'SELECT id, email, role FROM users ORDER BY email');
    const byEmail = Object.fromEntries(users.rows.map((u) => [u.email, u]));
    check('B3 ADMIN row intact with same id', byEmail['admin@example.com']?.role === 'ADMIN' && byEmail['admin@example.com']?.id === adminId);
    check('B4 OPERATOR→USER mapping, same id', byEmail['op@example.com']?.role === 'USER' && byEmail['op@example.com']?.id === opId);
    const rel = await q(c, 'SELECT id, lead_id, user_id FROM conversations WHERE id=$1', [convId]);
    const lead = await q(c, 'SELECT id, name FROM leads WHERE id=$1', [leadId]);
    check('B5 lead + conversation relationship intact', rel.rows[0]?.user_id === opId && rel.rows[0]?.lead_id === leadId && lead.rows[0]?.name === 'Legacy Lead');
    const usersCnt = await q(c, 'SELECT COUNT(*)::int AS n FROM users');
    check('B6 user count unchanged apart from mapping', usersCnt.rows[0].n === 2);
    const ledgerB = await q(c, 'SELECT COUNT(*)::int AS n FROM schema_migrations');
    r = runRunner('madlead_p5_legacy');
    const ledgerB2 = await q(c, 'SELECT COUNT(*)::int AS n FROM schema_migrations');
    check('B7 re-run idempotent (19 rows)', ledgerB.rows[0].n === 19 && r.status === 0 && ledgerB2.rows[0].n === 19);
    await c.end();

    // ---- C. drift + partial state ----
    c = new PG.Client({ connectionString: scratchUrl('madlead_p5_fresh') });
    await c.connect();
    await q(c, `UPDATE schema_migrations SET checksum='0000000000000000000000000000000000000000000000000000000000000000' WHERE migration_name='019_user_role_rename.sql'`);
    r = runRunner('madlead_p5_fresh');
    check('C1 tampered checksum fails loudly', r.status !== 0 && /drift detected for 019_user_role_rename\.sql/.test(r.out), `exit=${r.status}`);
    const tampered = await q(c, `SELECT checksum FROM schema_migrations WHERE migration_name='019_user_role_rename.sql'`);
    check('C2 failed run records nothing new', tampered.rows[0].checksum.startsWith('0000'));
    await c.end();
    await q(admin, 'CREATE DATABASE madlead_p5_broken');
    const brokenDir = path.join(workDir, 'broken');
    copyMigrations(brokenDir, null);
    fs.writeFileSync(path.join(brokenDir, '020_broken.sql'), 'CREATE TABLE broken (oops THIS IS NOT SQL);');
    r = runDriver('madlead_p5_broken', brokenDir);
    c = new PG.Client({ connectionString: scratchUrl('madlead_p5_broken') });
    await c.connect();
    const broken = await q(c, `SELECT COUNT(*)::int AS n FROM schema_migrations WHERE migration_name='020_broken.sql'`);
    const intact = await q(c, 'SELECT COUNT(*)::int AS n FROM schema_migrations');
    check('C3 broken migration fails with no ledger row', r.status !== 0 && broken.rows[0].n === 0 && intact.rows[0].n === 19, `exit=${r.status}`);
    await c.end();

    // ---- D. concurrency ----
    await q(admin, 'CREATE DATABASE madlead_p5_conc');
    const concEnv = (db) => ({ ...process.env, DATABASE_URL: scratchUrl(db) });
    const runAsync = (db) => new Promise((resolve) => {
      const child = spawn('npx ts-node --transpile-only src/database/migrate.ts', { cwd: REPO, shell: true, env: concEnv(db) });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      child.on('close', (code) => resolve({ status: code, out }));
    });
    const [r1, r2] = await Promise.all([runAsync('madlead_p5_conc'), runAsync('madlead_p5_conc')]);
    c = new PG.Client({ connectionString: scratchUrl('madlead_p5_conc') });
    await c.connect();
    const concLedger = await q(c, 'SELECT COUNT(*)::int AS n, COUNT(DISTINCT migration_name)::int AS u FROM schema_migrations');
    check('D1 concurrent runners both succeed, 19 unique rows', r1.status === 0 && r2.status === 0 && concLedger.rows[0].n === 19 && concLedger.rows[0].u === 19, `exits=${r1.status},${r2.status} rows=${concLedger.rows[0].n}`);
    await c.end();
  } finally {
    for (const db of dbs) {
      await q(admin, `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(() => undefined);
    }
    await admin.end().catch(() => undefined);
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(driverPath, { force: true }); } catch { /* best effort */ }
  }
  console.log(process.exitCode ? 'MIGRATION VERIFICATION: FAILURES PRESENT' : 'MIGRATION VERIFICATION: ALL PASS');
  process.exit(process.exitCode || 0);
};

main().catch((e) => { console.log('SCRIPT_ERROR:', (e && e.stack) || e); process.exit(1); });
