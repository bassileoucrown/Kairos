// Email delivery status. The one that matters: a provider rejection must be
// visible, because an invitation that silently goes nowhere leaves somebody
// waiting without knowing they are waiting.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const http = require('http');

const PORT = Number(process.env.PORT || 4477);
const FAKE_PORT = 4478;
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { s: r.status, d: json };
  };
}

(async () => {
  // A stand-in for Resend that refuses exactly the way the real one does when
  // a domain has not been verified.
  let mode = 'reject';
  const fake = http.createServer((req, res) => {
    if (mode === 'reject') {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        statusCode: 403,
        message: 'You can only send testing emails to your own email address.',
      }));
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_123' }));
    }
  });
  await new Promise((r) => fake.listen(FAKE_PORT, r));

  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      RESEND_API_KEY: 'test_key',
      // The lib posts to api.resend.com; point it at the stand-in instead.
      RESEND_ENDPOINT: `http://127.0.0.1:${FAKE_PORT}/emails`,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    // A minute. Twenty seconds is plenty on an idle machine and not plenty on a
    // loaded one, and "no server" on a green tree is a board crying wolf.
    const deadline = Date.now() + 60000;
    for (;;) {
      let ready = false;
      try { ready = (await (await fetch(`${BASE}/api/status`)).json()).databaseReady; }
      catch { /* not up */ }
      if (ready) break;
      if (Date.now() > deadline) throw new Error('server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    const status = await (await fetch(`${BASE}/api/status`)).json();
    ok('the app reports email as configured', status.emailDeliveryConfigured === true);

    const ada = client();
    await ada('POST', '/auth/signup', { name: 'Ada Boss', email: `ada${ID}@x.com`, password: PW });
    await ada('POST', '/profile/onboarding-step', { step: 'done' });

    // --- A rejected send ---
    await ada('POST', '/members', { email: `ben${ID}@x.com`, role: 'pa' });
    let box = await ada('GET', '/emails');
    let invite = box.d.emails.find((e) => e.category === 'invite');
    ok('the message is still recorded', !!invite, JSON.stringify(box.d.emails));
    ok('and marked as not delivered', invite?.deliveryStatus === 'failed', invite?.deliveryStatus);
    ok('carrying the provider\'s own words',
      /only send testing emails to your own/i.test(invite?.deliveryError || ''), invite?.deliveryError);
    ok('and the status code', /403/.test(invite?.deliveryError || ''), invite?.deliveryError);

    // --- An accepted send ---
    mode = 'accept';
    await ada('POST', '/members', { email: `cara${ID}@x.com`, role: 'ea' });
    box = await ada('GET', '/emails');
    const second = box.d.emails.find((e) => e.toEmail === `cara${ID}@x.com`);
    ok('an accepted message is marked delivered', second?.deliveryStatus === 'sent', second?.deliveryStatus);
    ok('with no error attached', !second?.deliveryError, second?.deliveryError);

    // --- The first one did not change ---
    const again = (await ada('GET', '/emails')).d.emails.find((e) => e.id === invite.id);
    ok('and the earlier failure is still on the record', again.deliveryStatus === 'failed');
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
    fake.close();
  }
  console.log(fails === 0 ? '\nDelivery failures are visible.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
