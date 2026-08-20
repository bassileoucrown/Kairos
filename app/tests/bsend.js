// Two providers, one delivery path.
//
// The differences between SendGrid and Resend are small and all in the places
// that break quietly: SendGrid answers 202 with an empty body where Resend
// answers 200 with JSON, `from` is an object rather than a string, and a
// rejection arrives as { errors: [{ message }] } rather than { message }.
// Reading the wrong one turns a legible refusal — "verify a domain first" —
// into an empty string in the Outbox, which is the exact failure the
// delivery-status work exists to prevent.
//
// Both are exercised against a stand-in that records what it was sent, because
// there is no other way to check the request we build without a real account.
const ROOT = require('path').join(__dirname, '..', '..');
const http = require('http');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4517);
const FAKE = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

// A stand-in provider. `mode` decides what it does next, so one server covers
// acceptance and both rejection shapes.
let received = [];
let mode = 'accept-sendgrid';
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    received.push({ url: req.url, auth: req.headers.authorization, body });
    if (mode === 'accept-sendgrid') { res.writeHead(202); res.end(); return; }
    if (mode === 'accept-resend') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_123' })); return;
    }
    if (mode === 'reject-sendgrid') {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        errors: [{ message: 'The from address does not match a verified Sender Identity.', field: 'from' }],
      }));
      return;
    }
    // reject-resend
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'You can only send testing emails to your own address.' }));
  });
});

function boot(env) {
  return spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      RESEND_API_KEY: '', SENDGRID_API_KEY: '', EMAIL_PROVIDER: '',
      SENDGRID_ENDPOINT: `http://127.0.0.1:${FAKE}/v3/mail/send`,
      RESEND_ENDPOINT: `http://127.0.0.1:${FAKE}/emails`,
      ...env,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

async function waitReady() {
  const deadline = Date.now() + 30000;
  for (;;) {
    try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) return; }
    catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('never ready');
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Signs up, which sends nothing, then asks for a reset, which sends one. */
async function triggerOneEmail(email) {
  let cookie = '';
  const call = async (path, body) => {
    const r = await fetch(`${BASE}/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { s: r.status, d: await r.json().catch(() => null), cookie };
  };
  const up = await call('/auth/signup', { name: 'Ada Boss', email, password: PW, accountCategory: 'principal' });
  await call('/profile/onboarding-step', { step: 'done' });
  await call('/auth/forgot-password', { email });
  return { userCookie: cookie, userId: up.d?.user?.id };
}

async function outbox(cookie) {
  const r = await fetch(`${BASE}/api/emails`, { headers: { cookie } });
  return r.json();
}

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  }
  await new Promise((r) => fake.listen(FAKE, r));

  let proc = null;
  try {
    // ---------- SendGrid, accepting ----------
    head('SendGrid, when it accepts:');
    received = []; mode = 'accept-sendgrid';
    proc = boot({ SENDGRID_API_KEY: 'SG.test-key' });
    await waitReady();

    const status = await (await fetch(`${BASE}/api/status`)).json();
    ok('the deployment reports delivery as configured', status.emailDeliveryConfigured === true);

    const a = await triggerOneEmail(`ada${ID}@x.com`);
    ok('a request reached the provider', received.length === 1, String(received.length));
    ok('at SendGrid’s endpoint', /\/v3\/mail\/send$/.test(received[0]?.url || ''), received[0]?.url);
    ok('with the key as a bearer token', received[0]?.auth === 'Bearer SG.test-key');

    const sent = JSON.parse(received[0].body);
    ok('in SendGrid’s shape, not Resend’s',
      Array.isArray(sent.personalizations) && Array.isArray(sent.content),
      JSON.stringify(sent).slice(0, 140));
    ok('addressed to the right person',
      sent.personalizations[0].to[0].email === `ada${ID}@x.com`);
    ok('with from as an object, which SendGrid requires',
      typeof sent.from === 'object' && !!sent.from.email, JSON.stringify(sent.from));
    ok('and the body as plain text', sent.content[0].type === 'text/plain' && !!sent.content[0].value);

    const box = await outbox(a.userCookie);
    ok('202 with an empty body counts as sent, not as a failure',
      box.emails[0].deliveryStatus === 'sent', JSON.stringify(box.emails[0]).slice(0, 160));

    proc.kill(); await new Promise((r) => setTimeout(r, 600));

    // ---------- SendGrid, refusing ----------
    head('SendGrid, when it refuses:');
    received = []; mode = 'reject-sendgrid';
    proc = boot({ SENDGRID_API_KEY: 'SG.test-key' });
    await waitReady();
    const b = await triggerOneEmail(`ben${ID}@x.com`);
    const box2 = await outbox(b.userCookie);
    ok('the failure is recorded', box2.emails[0].deliveryStatus === 'failed');
    ok('naming the provider and the status',
      /SendGrid 403/.test(box2.emails[0].deliveryError || ''), box2.emails[0].deliveryError);
    ok('and carrying the reason out of SendGrid’s errors array',
      /verified Sender Identity/.test(box2.emails[0].deliveryError || ''), box2.emails[0].deliveryError);

    proc.kill(); await new Promise((r) => setTimeout(r, 600));

    // ---------- Resend still works ----------
    head('Resend, unchanged:');
    received = []; mode = 'accept-resend';
    proc = boot({ RESEND_API_KEY: 're_test-key' });
    await waitReady();
    const c = await triggerOneEmail(`cara${ID}@x.com`);
    ok('a request reached the provider', received.length === 1);
    ok('at Resend’s endpoint', /\/emails$/.test(received[0]?.url || ''), received[0]?.url);
    const sentR = JSON.parse(received[0].body);
    ok('in Resend’s flat shape', typeof sentR.from === 'string' && sentR.to === `cara${ID}@x.com`,
      JSON.stringify(sentR).slice(0, 120));
    ok('recorded as sent', (await outbox(c.userCookie)).emails[0].deliveryStatus === 'sent');

    proc.kill(); await new Promise((r) => setTimeout(r, 600));

    head('Resend, when it refuses, still reads its own error shape:');
    received = []; mode = 'reject-resend';
    proc = boot({ RESEND_API_KEY: 're_test-key' });
    await waitReady();
    const d = await triggerOneEmail(`dee${ID}@x.com`);
    const box4 = await outbox(d.userCookie);
    ok('the reason survives', /own address/.test(box4.emails[0].deliveryError || ''),
      box4.emails[0].deliveryError);

    proc.kill(); await new Promise((r) => setTimeout(r, 600));

    // ---------- choosing between them ----------
    head('When both keys are set, EMAIL_PROVIDER decides:');
    received = []; mode = 'accept-resend';
    proc = boot({ SENDGRID_API_KEY: 'SG.k', RESEND_API_KEY: 're_k', EMAIL_PROVIDER: 'resend' });
    await waitReady();
    const e = await triggerOneEmail(`eve${ID}@x.com`);
    ok('the named one is used', /\/emails$/.test(received[0]?.url || ''), received[0]?.url);
    await outbox(e.userCookie);
    proc.kill(); await new Promise((r) => setTimeout(r, 600));

    head('A misconfiguration says so instead of failing silently:');
    received = [];
    proc = boot({ EMAIL_PROVIDER: 'mailchimp' });
    await waitReady();
    const stat = await (await fetch(`${BASE}/api/status`)).json();
    ok('status does not claim delivery is configured', stat.emailDeliveryConfigured === false);
    const f = await triggerOneEmail(`fin${ID}@x.com`);
    const box6 = await outbox(f.userCookie);
    ok('and the email is marked failed rather than quietly dropped',
      box6.emails[0].deliveryStatus === 'failed', JSON.stringify(box6.emails[0]).slice(0, 160));
    ok('with the misconfiguration named',
      /not a provider Kairos knows/.test(box6.emails[0].deliveryError || ''),
      box6.emails[0].deliveryError);
    ok('nothing was sent anywhere', received.length === 0);

    proc.kill(); await new Promise((r) => setTimeout(r, 600));

    head('With no provider at all, nothing changes from before:');
    received = [];
    proc = boot({});
    await waitReady();
    const g = await triggerOneEmail(`gus${ID}@x.com`);
    const box7 = await outbox(g.userCookie);
    ok('the email is still recorded in the Outbox', box7.emails.length === 1);
    ok('as outbox-only rather than sent or failed',
      box7.emails[0].deliveryStatus === 'outbox', box7.emails[0].deliveryStatus);
    ok('and no request went out', received.length === 0);
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc?.kill();
    fake.close();
  }
  console.log(fails === 0 ? '\nEither provider delivers, and says so when it does not.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
