// Covers every way the database can be unavailable at boot.
//
// The contract changed once and this suite now tracks the current one: the
// server does NOT exit. It listens first and stays up, so the deployment is
// always reachable and can account for itself through /api/status — a database
// still being provisioned fixes itself without anybody redeploying by hand
// (bheal.js proves the recovery). What must hold in every failure mode is that
// it refuses to serve, says something actionable, and never prints the
// password.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const CWD = `${ROOT}/app/server`;
const GOOD = 'postgres://kairos:kairos@127.0.0.1:5432/kairos';
const PORT = 4210;
const BASE = `http://127.0.0.1:${PORT}`;

let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

/**
 * Boots, waits until the server has reached a verdict, and returns everything
 * it said plus what /api/status reports. `settleMs` is how long to watch — the
 * point is that it is still up at the end of it.
 */
function boot(env, { settleMs = 6000 } = {}) {
  return new Promise((resolve) => {
    const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
      cwd: CWD,
      env: {
        ...process.env, NODE_ENV: 'production', PORT: String(PORT),
        // Long enough that a recheck never lands mid-assertion.
        DATABASE_RECHECK_MS: '600000',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { out += d; });

    let exited = null;
    proc.on('exit', (code) => { exited = code; });

    setTimeout(async () => {
      let status = null;
      try { status = await (await fetch(`${BASE}/api/status`)).json(); }
      catch { /* not listening */ }
      proc.kill();
      resolve({ out, status, exited });
    }, settleMs);
  });
}

(async () => {
  console.log('Unreachable host (transient — retries, then waits rather than dying):');
  const refused = await boot({
    DATABASE_URL: 'postgres://kairos:secretpw@127.0.0.1:5999/kairos',
    DATABASE_CONNECT_ATTEMPTS: '3',
  });
  ok('stays up so the deployment can explain itself', refused.exited === null);
  ok('and answers /api/status', !!refused.status, JSON.stringify(refused.status));
  ok('reporting that the database is not ready', refused.status?.databaseReady === false);
  // storageDurable answers "is durable storage configured", not "is it up" —
  // the two are separate facts and databaseReady carries the second. Postgres
  // that is merely unreachable must not be reported as ephemeral disk.
  ok('while still saying durable storage is what is configured',
    refused.status?.storageDurable === true);
  ok('naming the failure in the status body',
    /ECONNREFUSED/.test(refused.status?.databaseError || ''), refused.status?.databaseError);
  ok('retried with backoff before reporting', /retrying in 1s — attempt 1 of 3/.test(refused.out));
  ok('backed off and retried again', /attempt 2 of 3/.test(refused.out));
  ok('names the host, port, database and user',
    /127\.0\.0\.1:5999\/kairos \(user kairos\)/.test(refused.out));
  ok('never prints the password', !/secretpw/.test(refused.out));
  ok('offers something to act on', /Common causes/.test(refused.out));
  ok('and says it will look again by itself', /Rechecking in/.test(refused.out));

  console.log('\nWrong password (permanent — must NOT burn the retry ladder):');
  const badpw = await boot({
    DATABASE_URL: 'postgres://kairos:wrongpassword@127.0.0.1:5432/kairos',
    DATABASE_CONNECT_ATTEMPTS: '6',
  });
  ok('did not retry an authentication failure', !/retrying in/.test(badpw.out));
  ok('reports the real cause', /password authentication failed/i.test(badpw.out));
  ok('and puts it where /api/status can be read',
    /password authentication failed/i.test(badpw.status?.databaseError || ''),
    badpw.status?.databaseError);
  ok('still without printing the password', !/wrongpassword/.test(badpw.out));

  console.log('\nDatabase that does not exist (permanent):');
  const nodb = await boot({
    DATABASE_URL: 'postgres://kairos:kairos@127.0.0.1:5432/nosuchdb',
    DATABASE_CONNECT_ATTEMPTS: '6',
  });
  ok('fails without retrying', !/retrying in/.test(nodb.out));
  ok('reports that the database is missing', /does not exist/i.test(nodb.out));

  console.log('\nGarbled URL:');
  const junk = await boot({ DATABASE_URL: 'not-a-url', DATABASE_CONNECT_ATTEMPTS: '2' });
  ok('says the URL itself is malformed', /unparseable DATABASE_URL|not a Postgres connection string/i.test(junk.out),
    junk.out.slice(0, 200));
  ok('and does not bury it under a list of other causes', !/Common causes/.test(junk.out));

  console.log('\nWorking database:');
  const good = await boot({ DATABASE_URL: GOOD });
  ok('comes up ready', good.status?.databaseReady === true, JSON.stringify(good.status));
  ok('on durable storage', good.status?.storageDurable === true);
  ok('with no error to report', !good.status?.databaseError);

  console.log('\nNo DATABASE_URL at all:');
  const sqlite = await boot({ DATABASE_URL: '' });
  ok('falls back to SQLite and serves', sqlite.status?.databaseReady === true);
  ok('but is honest that the disk is not durable', sqlite.status?.storageDurable === false);

  console.log(fails === 0 ? '\nEvery failure mode stays up and explains itself.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\n' + (e.stack || e.message)); process.exit(1); });
