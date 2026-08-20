// Turning encryption on for a deployment that has been running without it.
//
// The question this answers is the only one that matters before setting the
// key on a live service: does anything already in the database break? Nothing
// should, because nothing sensitive was ever accepted without a key — but
// "should" is not an answer worth deploying on.
//
// Runs one database through both states: no key, then a key, same rows.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4496);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function session() {
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

function boot(key) {
  return spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ENCRYPTION_KEY: key },
    stdio: ['ignore', 'ignore', 'inherit'],
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

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  }

  let proc = boot('');
  try {
    await waitReady();

    head('Running with no key, as the live deployment has been:');
    const ada = session();
    const up = await ada('POST', '/auth/signup',
      { name: 'Ada Boss', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const adaId = up.d.user.id;
    await ada('POST', '/profile/onboarding-step', { step: 'done' });
    await ada('PATCH', '/profile', { slug: `ada${ID}` });

    // Ordinary details are stored in the clear on purpose — a seat preference
    // is not a secret, and encrypting it would only make it unsearchable.
    const ordinary = await ada('POST', `/essentials/${adaId}`,
      { category: 'preferences', field: 'seat_preference', value: 'Aisle, forward cabin' });
    ok('ordinary details save without a key', ordinary.s === 201, JSON.stringify(ordinary.d));

    const sensitive = await ada('POST', `/essentials/${adaId}`,
      { category: 'travel_identity', field: 'passport_number', value: 'Z99887766' });
    ok('an identity detail is refused rather than stored in the clear',
      sensitive.s === 503, JSON.stringify(sensitive.d));

    const twofa = await ada('POST', '/security/2fa/setup');
    ok('two-factor is refused for the same reason', twofa.s === 503, String(twofa.s));

    // Ordinary work carries on meanwhile, and must survive the change.
    await ada('POST', '/access-codes', { code: 'BEFORE-KEY-11', role: 'pa', uses: 2 });
    const space = await ada('POST', '/spaces', { name: 'Board', context: 'work' });
    const thread = await ada('POST', `/spaces/${space.d.space.id}/threads`, { name: 'Talk' });
    const threadId = thread.d.thread?.id || thread.d.id;
    await ada('POST', `/threads/${threadId}/messages`, { body: 'Said before the key existed.' });

    const closed = await ada('GET', `/threads/${threadId}/messages`);
    ok('and voice notes are not offered', closed.d.voice?.available === false);

    proc.kill();
    await new Promise((r) => setTimeout(r, 700));

    head('The key is set and the service restarts on the same database:');
    proc = boot(KEY);
    await waitReady();

    const back = session();
    const login = await back('POST', '/auth/login', { email: `ada${ID}@x.com`, password: PW });
    ok('the existing account still signs in', login.s === 200, JSON.stringify(login.d).slice(0, 120));

    const list = await back('GET', `/essentials/${adaId}`);
    const seat = JSON.stringify(list.d);
    ok('the detail saved before the key is still readable',
      seat.includes('Aisle, forward cabin'), seat.slice(0, 200));

    const msgs = await back('GET', `/threads/${threadId}/messages`);
    ok('messages from before are intact',
      msgs.d.messages.some((m) => m.body === 'Said before the key existed.'));
    ok('and the access code armed before still works',
      (await back('GET', '/access-codes')).d.codes.some((c) => c.code === 'BEFORE-KEY-11' && c.live));

    head('And what was refused before now works:');
    const nowSensitive = await back('POST', `/essentials/${adaId}`,
      { category: 'travel_identity', field: 'passport_number', value: 'Z99887766' });
    ok('an identity detail saves', nowSensitive.s === 201, JSON.stringify(nowSensitive.d));

    const after = await back('GET', `/essentials/${adaId}`);
    ok('and comes back masked rather than in the open',
      JSON.stringify(after.d).includes('7766') && !JSON.stringify(after.d).includes('Z99887766'),
      JSON.stringify(after.d).slice(0, 300));

    const nowVoice = await back('GET', `/threads/${threadId}/messages`);
    ok('voice notes are available', nowVoice.d.voice?.available === true);
    const nowTwofa = await back('POST', '/security/2fa/setup');
    ok('and two-factor can be set up', nowTwofa.s === 200 || nowTwofa.s === 201, String(nowTwofa.s));

    head('The stored identity detail is ciphertext, not the passport number:');
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(`${ROOT}/app/server/data/kairos.sqlite`);
    const row = raw.prepare("SELECT value, value_enc FROM essentials WHERE field = 'passport_number'").get();
    ok('the plaintext column is empty', !row.value);
    ok('and the encrypted one is versioned ciphertext', /^v1:/.test(row.value_enc || ''),
      String(row.value_enc).slice(0, 24));
    ok('containing nothing that looks like the number',
      !String(row.value_enc).includes('Z99887766'));
    raw.close();
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }
  console.log(fails === 0 ? '\nTurning the key on is additive — nothing already stored breaks.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
