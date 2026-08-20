// The deployment must always come up and account for itself. A database it
// cannot reach is a condition to report at a URL, not a deploy that dies in a
// queue with nothing to read.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const CWD = `${ROOT}/app/server`;
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

function start(port, env) {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: CWD,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  return { proc, log: () => out };
}

async function waitForPort(port, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/status`); return r; }
    catch {
      if (Date.now() > deadline) return null;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

(async () => {
  console.log('Unreachable database — the case that was killing deploys:');
  const bad = start(4340, {
    DATABASE_URL: 'postgres://kuser:secretpw@10.255.255.1:5432/kdb',
    DATABASE_CONNECT_ATTEMPTS: '2',
    DATABASE_CONNECT_TIMEOUT_MS: '2000',
  });
  try {
    // The whole point: a port within seconds, not after the database answers.
    const t0 = Date.now();
    const res = await waitForPort(4340, 15000);
    ok('binds a port straight away, so the deploy goes live', !!res, 'never bound');
    ok(`and did it fast (${((Date.now() - t0) / 1000).toFixed(1)}s)`, Date.now() - t0 < 10000);

    const status = await (await fetch('http://127.0.0.1:4340/api/status')).json();
    ok('status is served even with no database', typeof status.databaseReady === 'boolean');
    ok('and says the database is not ready', status.databaseReady === false);
    ok('names the backend', status.databaseBackend === 'postgres');
    ok('names the target so it can be compared to the dashboard',
      String(status.databaseTarget).includes('10.255.255.1:5432/kdb'), status.databaseTarget);
    ok('never leaks the password', !JSON.stringify(status).includes('secretpw'));

    // Give it time to exhaust retries and record the reason.
    await new Promise((r) => setTimeout(r, 12000));
    const after = await (await fetch('http://127.0.0.1:4340/api/status')).json();
    ok('reports why, once it has given up', !!after.databaseError, JSON.stringify(after));

    const api = await fetch('http://127.0.0.1:4340/api/auth/me');
    ok('API refuses rather than serving from a broken database', api.status === 503);
    ok('with an explanation', (await api.json()).error.includes('not available'));

    const page = await fetch('http://127.0.0.1:4340/login');
    ok('the page itself still loads', page.status === 200);

    ok('process is still alive, not dead in a queue', bad.proc.exitCode === null);
    ok('log says it stayed up on purpose', /Staying up/.test(bad.log()));
  } finally { bad.proc.kill(); }

  console.log('\nWorking database:');
  const good = start(4341, { DATABASE_URL: '' });
  try {
    const res = await waitForPort(4341, 15000);
    ok('comes up', !!res);
    // Ready is asynchronous, so allow the schema a moment.
    let status;
    for (let i = 0; i < 40; i++) {
      status = await (await fetch('http://127.0.0.1:4341/api/status')).json();
      if (status.databaseReady) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    ok('reports the database ready', status.databaseReady === true);
    ok('and serves the API normally', (await fetch('http://127.0.0.1:4341/api/auth/me')).status === 401);
  } finally { good.proc.kill(); }

  console.log(fails === 0 ? '\nThe deployment always comes up and explains itself.' : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
