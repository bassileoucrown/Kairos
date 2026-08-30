// Signup is open. Replaces the old signup-gate suite, which tested a
// deployment-wide code that no longer exists.
//
// The claim that replaced it — "an account on its own reaches nothing" — is
// the one worth proving, because it is what makes open signup safe. A stranger
// who signs up must find no directory, no resolvable handle, no space, no
// membership, and no way to touch another account.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4487);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

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

async function signUp(call, name, email, category) {
  const r = await call('POST', '/auth/signup', { name, email, password: PW, accountCategory: category });
  if (r.s !== 200 && r.s !== 201) throw new Error(`signup ${name}: ${r.s} ${JSON.stringify(r.d)}`);
  await call('POST', '/profile/onboarding-step', { step: 'done' });
  return r.d.user;
}

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      // Set on purpose: the old gate must be inert, not merely unset.
      SIGNUP_ACCESS_CODE: 'OLD-GATE-SHOULD-BE-IGNORED',
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    // Two and a half minutes. Twenty seconds was plenty on an idle machine and
    // not plenty on a loaded one; a minute went the same way, twice in one day,
    // on a box where a hundred suites run back to back and each one starts a
    // server and half of them start a browser. "No server" on a green tree is a
    // board crying wolf, and it costs an hour of hunting a product bug that was
    // never there.
    //
    // Waiting longer is free when the tree is green — the loop exits the instant
    // the server answers — and is only paid when something is genuinely broken,
    // which is the right way round for this trade.
    const deadline = Date.now() + 150000;
    for (;;) {
      let ready = false;
      try { ready = (await (await fetch(`${BASE}/api/status`)).json()).databaseReady; }
      catch { /* not up */ }
      if (ready) break;
      if (Date.now() > deadline) throw new Error('server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    head('The old gate is gone, not merely unset:');
    const status = await (await fetch(`${BASE}/api/status`)).json();
    ok('status advertises no signup gate', status.signupRequiresCode === undefined,
      JSON.stringify(status));

    const stranger = client();
    const strangerU = await signUp(stranger, 'A Stranger', `str${ID}@x.com`, 'principal');
    ok('a stranger signs up with no code, even though one is configured', !!strangerU.id);

    // A principal with a full life: assistant, household, vault, spaces.
    const ada = client(); const ben = client(); const femi = client();
    const adaU = await signUp(ada, 'Ada Boss', `ada${ID}@x.com`, 'principal');
    await ada('PATCH', '/profile', { slug: `ada${ID}` });
    await signUp(ben, 'Ben Reed', `ben${ID}@x.com`, 'pa');
    await signUp(femi, 'Femi Okon', `femi${ID}@x.com`, 'principal');

    const inv = await ada('POST', '/members', { email: `ben${ID}@x.com`, role: 'pa' });
    await ben('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);
    const hire = await ada('POST', `/household/${adaU.id}/staff`,
      { name: 'Femi Okon', email: `femi${ID}@x.com`, jobTitle: 'Driver' });
    await femi('POST', `/invites/${hire.d.inviteLink.split('/').pop()}/accept`);
    await ada('POST', `/essentials/${adaU.id}`,
      { category: 'travel_identity', field: 'passport_number', value: 'Z99887766' });
    const space = await ada('POST', '/spaces', { name: 'Board', context: 'work' });
    await ada('POST', '/access-codes', { code: 'THURSDAY-LAGOS-91', role: 'pa' });

    head("An account on its own reaches nothing:");
    for (const [label, method, path] of [
      ["the principal's day", 'GET', `/today/${adaU.id}`],
      ['their itinerary', 'GET', `/itinerary/${adaU.id}/day?date=2027-01-01`],
      ['their essentials', 'GET', `/essentials/${adaU.id}`],
      ['their approvals', 'GET', `/pa/${adaU.id}/approvals`],
      ['their contacts', 'GET', `/pa/${adaU.id}/contacts`],
      ['their household', 'GET', `/household/${adaU.id}`],
      ['their team', 'GET', `/members`],
      ['their space', 'GET', `/spaces/${space.d.space.id}`],
      ['their access code', 'GET', '/access-codes'],
    ]) {
      const r = await stranger(method, path);
      // Two shapes of "no". Principal-scoped routes refuse outright. Routes
      // scoped to the caller (/members, /access-codes) answer 200 with the
      // caller's own empty set, which is equally correct — what must never
      // appear either way is a trace of Ada.
      const body = JSON.stringify(r.d);
      const leaks = /Ada|THURSDAY|Z99887766|Femi|Board/.test(body);
      const denied = !leaks && (r.s === 403 || r.s === 404 || r.s === 200);
      ok(`not ${label}`, denied, `${path} -> ${r.s} ${JSON.stringify(r.d).slice(0, 90)}`);
    }

    head('And discovers nobody:');
    const own = await stranger('POST', '/spaces', { name: 'Mine', context: 'work' });
    const byHandle = await stranger('POST', `/spaces/${own.d.space.id}/members`, { handle: `ada${ID}` });
    ok("a known handle does not resolve for a stranger", byHandle.s === 404,
      `${byHandle.s} ${JSON.stringify(byHandle.d)}`);

    const ws = await stranger('GET', '/workspace');
    ok('their workspace is empty', ws.d.principals.length === 0);
    const conns = await stranger('GET', '/connections');
    ok('they are connected to nobody',
      conns.d.connected.length === 0 && conns.d.incoming.length === 0);

    head('The pairing code is the actual gate:');
    const guess = await stranger('POST', '/access-codes/redeem',
      { handle: `ada${ID}`, code: 'THURSDAY-LAGOS-92' });
    ok('a near-miss code is refused', guess.s === 400, JSON.stringify(guess.d));
    const right = await stranger('POST', '/access-codes/redeem',
      { handle: `ada${ID}`, code: 'THURSDAY-LAGOS-91' });
    ok('and the right one is what lets anybody in', right.s === 201, JSON.stringify(right.d));
    ok('only then does the day open', (await stranger('GET', `/today/${adaU.id}`)).s === 200);
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }
  console.log(fails === 0 ? '\nOpen signup grants nothing on its own.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
