// Pointing at an existing Kairos database must upgrade it in place: keep every
// row, add what's missing, and give old rows sensible values for columns that
// didn't exist when they were written.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const { Client } = require(`${ROOT}/app/server/node_modules/pg`);

const URL = 'postgres://kairos:kairos@127.0.0.1:5432/kairos';
const PORT = 4400;
const BASE = `http://127.0.0.1:${PORT}/api`;
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

async function admin(fn) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

(async () => {
  // Build a database as it looked BEFORE this week's work: no itinerary
  // status columns, no account_category, no scheduling flag.
  await admin(async (c) => {
    // Drop every table rather than the schema itself — the role may not own
    // `public`, and a failed DROP SCHEMA leaves the old tables in place.
    await c.query(`DO $$
      DECLARE t text;
      BEGIN
        FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        LOOP EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', t); END LOOP;
      END $$;`);
    await c.query('DROP SCHEMA IF EXISTS kairos CASCADE');
    await c.query(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, timezone TEXT NOT NULL DEFAULT 'UTC',
        email_verified INTEGER NOT NULL DEFAULT 0, onboarding_step TEXT NOT NULL DEFAULT 'profile',
        created_at TEXT NOT NULL)`);
    await c.query(`
      CREATE TABLE itinerary_items (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_by TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL DEFAULT 'meeting',
        title TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT,
        start_timezone TEXT, end_timezone TEXT,
        location TEXT NOT NULL DEFAULT '', destination TEXT NOT NULL DEFAULT '',
        reference TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
        booking_id TEXT, created_at TEXT NOT NULL)`);
    await c.query(`INSERT INTO users (id,email,password_hash,name,slug,created_at)
      VALUES ('u1','old@example.com','x','Old Principal','old-principal','2026-01-01T00:00:00Z')`);
    await c.query(`INSERT INTO itinerary_items (id,owner_id,created_by,kind,title,start_at,created_at)
      VALUES ('i1','u1','u1','flight','Existing flight to Lagos','2026-09-01T09:00:00Z','2026-01-01T00:00:00Z')`);
  });
  console.log('Built a database in the OLD shape, with one user and one itinerary item.\n');

  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: URL },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { const s = await (await fetch(`${BASE}/status`)).json(); if (s.databaseReady) { ready = true; break; } }
      catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    ok('the app accepts the existing database', ready);

    await admin(async (c) => {
      const u = await c.query("SELECT * FROM users WHERE id = 'u1'");
      ok('the existing account is still there', u.rowCount === 1);
      ok('with its email and name untouched',
        u.rows[0]?.email === 'old@example.com' && u.rows[0]?.name === 'Old Principal');
      ok('and gained the new column with a sane default',
        u.rows[0]?.account_category === 'principal', String(u.rows[0]?.account_category));

      const it = await c.query("SELECT * FROM itinerary_items WHERE id = 'i1'");
      ok('the existing itinerary item survived', it.rowCount === 1);
      ok('with its title intact', it.rows[0]?.title === 'Existing flight to Lagos');
      // The one that matters: everything written before drafts existed must
      // count as confirmed, or a principal's calendar would silently empty.
      ok('and counts as confirmed, not stranded as a draft',
        it.rows[0]?.status === 'confirmed', String(it.rows[0]?.status));
      ok('with the new proposal fields present and empty',
        it.rows[0]?.proposal_note === '' && it.rows[0]?.proposed_at === null);

      const tables = await c.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
      const names = tables.rows.map((r) => r.table_name);
      for (const t of ['spaces', 'projects', 'tasks', 'memberships', 'messages']) {
        ok(`missing table "${t}" was created`, names.includes(t));
      }
    });

    // And it is genuinely usable, not merely migrated.
    const r = await fetch(`${BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'old@example.com', password: 'whatever' }),
    });
    ok('the API serves against the upgraded database', r.status === 401, `got ${r.status}`);
  } finally { proc.kill(); }

  console.log(fails === 0 ? '\nAn existing database is upgraded in place, losing nothing.' : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
