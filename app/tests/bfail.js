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
 * it said plus what /api/status reports.
 *
 * This used to sleep for a fixed six seconds and then read the status once,
 * which was a stopwatch racing a connection handshake. Alone it always won;
 * inside the full run, straight after a suite that had just been driving
 * Chromium, it sometimes did not — and every assertion that depends on the
 * verdict having been reached failed at once, which reads like six product
 * faults rather than one impatient test. So it now waits for the verdict
 * itself: ready, or an error to report. `settleMs` is only the deadline.
 */
/**
 * Is there actually a Postgres to fail against?
 *
 * Every assertion below distinguishes one kind of database failure from
 * another, which only means anything when a working database exists as the
 * control. Without one, half the suite fails with messages like "did not retry
 * an authentication failure" — technically true, wholly misleading, and
 * indistinguishable from a real regression at a glance.
 */
/**
 * Is the control database actually there?
 *
 * RETRIED, like every other readiness check in this directory. It used to be a
 * single connect with a four-second timeout, and it went red twice inside an
 * hour on a box where Postgres was demonstrably up the moment afterwards. Run
 * on its own it always passed; run after thirty other suites — one of which
 * has just closed a browser — a single attempt loses its race with the load
 * and the suite announces that the database is down.
 *
 * A precondition that cries wolf is worse than no precondition. It was written
 * to stop somebody reading a database outage as a product bug, and a flaky one
 * spends that credibility teaching the reader to ignore it.
 */
async function postgresIsUp(attempts = 5) {
  const { Client } = require(`${ROOT}/app/server/node_modules/pg`);
  for (let i = 0; i < attempts; i++) {
    const client = new Client({ connectionString: GOOD, connectionTimeoutMillis: 4000 });
    try {
      await client.connect();
      await client.end();
      return true;
    } catch {
      await client.end().catch(() => {});
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  return false;
}

/**
 * Every server this suite starts, so none of them can outlive it.
 *
 * These are servers that deliberately CANNOT reach a database, and the
 * contract being tested is that such a server stays up and keeps retrying. So
 * a leaked one does not sit idle — it retries forever, pinning a core, and
 * every test run for the next hour is slower and stranger for it. That is not
 * hypothetical: one escaped and spent twenty minutes at 100% CPU, which
 * destabilised Postgres, which failed this suite, which leaked another.
 *
 * proc.kill() at the end of a happy path is not enough on its own, because the
 * paths that matter are the unhappy ones.
 */
const started = [];
function reapAll() {
  for (const p of started.splice(0)) {
    try { p.kill('SIGKILL'); } catch { /* already gone */ }
  }
}
for (const signal of ['exit', 'SIGINT', 'SIGTERM']) process.on(signal, reapAll);
process.on('uncaughtException', (e) => { reapAll(); throw e; });

function boot(env, { settleMs = 25000 } = {}) {
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
    started.push(proc);
    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { out += d; });

    let exited = null;
    proc.on('exit', (code) => { exited = code; });

    (async () => {
      const deadline = Date.now() + settleMs;
      let status = null;
      for (;;) {
        try { status = await (await fetch(`${BASE}/api/status`)).json(); }
        catch { status = null; /* not listening yet */ }
        // A verdict is either "serving" or "here is why I am not".
        if (status && (status.databaseReady === true || status.databaseError)) break;
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      proc.kill();
      resolve({ out, status, exited });
    })();
  });
}

(async () => {
  // Checked before anything is spawned. Bailing out mid-boot is what leaked a
  // server the last time this check lived in the wrong place.
  if (!await postgresIsUp()) {
    console.log('\n  ✗ Postgres is not reachable at 127.0.0.1:5432.');
    console.log('    This suite compares kinds of database failure, so it needs a');
    console.log('    working database as the control. Nothing here is a product fault.');
    console.log('    Start Postgres and run it again.');
    console.log('\n1 FAILED');
    process.exit(1);
  }

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
