// A database that turns up late must be picked up on its own. Provisioning a
// managed instance can take minutes, and requiring a human to redeploy for a
// problem that fixed itself is the kind of thing nobody remembers to do.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn, execSync } = require('child_process');

const PORT = 4370;
const BASE = `http://127.0.0.1:${PORT}/api`;
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function status() {
  try { return await (await fetch(`${BASE}/status`)).json(); } catch { return null; }
}

(async () => {
  // Start with Postgres down.
  try { execSync('pg_ctlcluster 16 main stop', { stdio: 'ignore' }); } catch { /* already down */ }
  await sleep(1500);

  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      DATABASE_URL: 'postgres://kairos:kairos@127.0.0.1:5432/kairos',
      DATABASE_CONNECT_ATTEMPTS: '2',
      DATABASE_CONNECT_TIMEOUT_MS: '2000',
      DATABASE_RECHECK_MS: '5000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });

  try {
    for (let i = 0; i < 60 && !(await status()); i++) await sleep(200);
    ok('server is up despite no database', !!(await status()));

    // Let the initial ladder exhaust and record a real failure.
    for (let i = 0; i < 60; i++) {
      const s = await status();
      if (s?.databaseError) break;
      await sleep(500);
    }
    const failed = await status();
    ok('it gives up on the first ladder and says why', !!failed.databaseError, JSON.stringify(failed));
    ok('and is refusing API calls meanwhile', (await fetch(`${BASE}/auth/me`)).status === 503);
    ok('log says it will recheck rather than needing a redeploy', /Rechecking in 5s/.test(log));

    // The database finally arrives.
    console.log('\n  …starting Postgres now, without touching the app:');
    execSync('pg_ctlcluster 16 main start', { stdio: 'ignore' });
    await sleep(2000);

    let healed = null;
    for (let i = 0; i < 40; i++) {
      const s = await status();
      if (s?.databaseReady) { healed = s; break; }
      await sleep(1000);
    }
    ok('the app recovers on its own, with no redeploy', !!healed, 'still not ready after 40s');
    ok('and clears the error it was reporting', healed && healed.databaseError === null);

    // Genuinely usable, not merely flagged ready.
    const r = await fetch(`${BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Late', email: `late${Date.now()}@x.com`, password: 'password123' }),
    });
    ok('and actually serves requests afterwards', r.status === 201, `signup returned ${r.status}`);
  } finally { proc.kill(); }

  console.log(fails === 0 ? '\nThe app heals itself when the database turns up.' : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
