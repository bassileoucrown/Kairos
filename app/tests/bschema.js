// Proves DATABASE_SCHEMA does what it claims: Kairos can share one Postgres
// instance with another app that already owns a `users` table in `public`,
// without either one touching the other.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const { Client } = require(`${ROOT}/app/server/node_modules/pg`);

const URL = 'postgres://kairos:kairos@127.0.0.1:5432/kairos';
const PORT = 4114;
const base = `http://127.0.0.1:${PORT}`;

function ok(cond, label) { if (!cond) throw new Error(`FAILED: ${label}`); console.log('  ✓ ' + label); }

async function admin(fn) {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

async function start(env) {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: URL, ...env },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  // Waits for databaseReady, not merely for the port to answer. Startup binds
  // first and prepares the schema after, so a 200 from /api/status is not the
  // same as being able to serve a signup — and creating this schema from cold
  // is exactly when that gap is widest.
  const deadline = Date.now() + 30000;
  for (;;) {
    let ready = false;
    try { ready = (await (await fetch(base + '/api/status')).json()).databaseReady; }
    catch { /* not up yet */ }
    if (ready) return proc;
    if (proc.exitCode !== null) throw new Error(`server exited with ${proc.exitCode}`);
    if (Date.now() > deadline) throw new Error('server never became ready');
    await new Promise((r) => setTimeout(r, 200));
  }
}

(async () => {
  // A pre-existing tenant: another app's `users` table sitting in `public`,
  // with a shape nothing like ours.
  await admin(async (c) => {
    await c.query('DROP SCHEMA IF EXISTS kairos CASCADE');
    await c.query('DROP TABLE IF EXISTS public.users CASCADE');
    await c.query('CREATE TABLE public.users (id serial primary key, handle text not null)');
    await c.query("INSERT INTO public.users (handle) VALUES ('someone-elses-app')");
  });
  console.log('Set up a foreign `public.users` table belonging to another app.');

  const proc = await start({ DATABASE_SCHEMA: 'kairos' });
  try {
    const email = `tenant-${Date.now()}@example.com`;
    const signup = await fetch(base + '/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', name: 'Tenant User' }),
    });
    ok(signup.status === 201, 'signed up against the shared instance');

    await admin(async (c) => {
      const ours = await c.query('SELECT email FROM kairos.users WHERE email = $1', [email]);
      ok(ours.rowCount === 1, 'the account landed in the kairos schema');

      const theirs = await c.query('SELECT handle FROM public.users');
      ok(theirs.rowCount === 1 && theirs.rows[0].handle === 'someone-elses-app',
        "the other app's public.users is untouched");

      const cols = await c.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='account_category'");
      ok(cols.rowCount === 0, 'migrations did not alter the other app\'s table');

      const mine = await c.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema='kairos' AND table_name='users' AND column_name='account_category'");
      ok(mine.rowCount === 1, 'migrations did run against ours (account_category present)');
    });
  } finally { proc.kill(); }

  // Restarting must reuse the schema, not fail on CREATE SCHEMA or re-migrate.
  const again = await start({ DATABASE_SCHEMA: 'kairos' });
  try {
    ok((await (await fetch(base + '/api/status')).json()).storageDurable === true, 'restarts cleanly onto the existing schema');
  } finally { again.kill(); }

  // A bad schema name must be refused, not escaped and executed.
  const bad = spawn('node', ['--experimental-sqlite', '-e', 'require("./lib/db")'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, DATABASE_URL: URL, DATABASE_SCHEMA: 'public; DROP TABLE users' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  bad.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((r) => bad.on('exit', r));
  ok(code !== 0 && /plain lowercase identifier/.test(stderr), 'a non-identifier DATABASE_SCHEMA is refused');

  await admin(async (c) => {
    const still = await c.query('SELECT handle FROM public.users');
    ok(still.rowCount === 1, 'and nothing was dropped in the attempt');
  });

  console.log('\nSchema isolation holds: Kairos can share a free Postgres instance safely.');
})().catch((e) => { console.error('\n' + e.message); process.exit(1); });
