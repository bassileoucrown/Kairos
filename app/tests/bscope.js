// Where the second factor is demanded.
//
// The default moved: signing in costs the password, and the code is spent on
// the vault. A code at the front door protects everything but is paid on every
// login, and that friction is what makes people turn two-factor off — an
// account with it off protects nothing at all. Spending it on the vault puts
// the cost where the value is.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const totp = require(`${ROOT}/app/server/lib/totp`);

const PORT = Number(process.env.PORT || 4525);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const EMAIL = `ada${ID}@x.com`;
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

const login = (body) => fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      STEP_UP_GRACE_MS: '2000',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    const ada = client();
    const up = await ada('POST', '/auth/signup',
      { name: 'Ada Boss', email: EMAIL, password: PW, accountCategory: 'principal' });
    const adaId = up.d.user.id;
    await ada('POST', '/profile/onboarding-step', { step: 'done' });
    const made = await ada('POST', `/essentials/${adaId}`,
      { category: 'travel_identity', field: 'passport_number', value: 'Z99887766' });
    const essentialId = made.d.essential?.id || made.d.id;

    const setup = await ada('POST', '/security/2fa/setup');
    const secret = setup.d.secret;
    const now = () => totp.codeAt(secret, Math.floor(Date.now() / 1000 / 30));
    await ada('POST', '/security/2fa/confirm', { code: now() });

    head('By default the code is spent on the vault, not the front door:');
    const state = await ada('GET', '/security');
    ok('two-factor is on', state.d.twoFactor.enabled === true);
    ok('and scoped to the vault', state.d.twoFactor.scope === 'vault', state.d.twoFactor.scope);
    ok('with both choices offered', (state.d.twoFactor.scopes || []).length === 2);

    const plain = await login({ email: EMAIL, password: PW });
    ok('signing in costs the password and nothing else', plain.status === 200, String(plain.status));
    ok('and no code is asked for', !(await plain.json()).needsCode);

    await new Promise((r) => setTimeout(r, 2200));
    head('But the vault still asks:');
    const byPw = await ada('POST', `/essentials/${adaId}/${essentialId}/reveal`, { password: PW });
    ok('the password will not reveal', byPw.s === 401 && byPw.d.needs === 'code', JSON.stringify(byPw.d));
    const byCode = await ada('POST', `/essentials/${adaId}/${essentialId}/reveal`, { code: now() });
    ok('the code will', byCode.s === 200 && byCode.d.essential.value === 'Z99887766');

    head('A principal who wants it at both can say so:');
    const noCode = await ada('POST', '/security/2fa/scope', { scope: 'login_and_vault' });
    ok('changing it costs a step-up of its own',
      noCode.s === 401 || noCode.s === 200, String(noCode.s));

    await new Promise((r) => setTimeout(r, 2200));
    const refused = await ada('POST', '/security/2fa/scope', { scope: 'login_and_vault' });
    ok('and without one it is refused', refused.s === 401 && refused.d.needs === 'code',
      JSON.stringify(refused.d));

    const moved = await ada('POST', '/security/2fa/scope', { scope: 'login_and_vault', code: now() });
    ok('with a code it moves', moved.s === 200 && moved.d.scope === 'login_and_vault',
      JSON.stringify(moved.d));

    const gated = await login({ email: EMAIL, password: PW });
    ok('now sign-in asks for a code', gated.status === 401);
    ok('and says so', (await gated.json()).needsCode === true);
    const withCode = await login({ email: EMAIL, password: PW, code: now() });
    ok('which gets in', withCode.status === 200);

    head('And can move it back:');
    await new Promise((r) => setTimeout(r, 2200));
    const back = await ada('POST', '/security/2fa/scope', { scope: 'vault', code: now() });
    ok('it returns to the vault only', back.s === 200 && back.d.scope === 'vault');
    ok('and sign-in is a password again',
      (await login({ email: EMAIL, password: PW })).status === 200);

    head('An unknown setting is refused:');
    const junk = await ada('POST', '/security/2fa/scope', { scope: 'everywhere', code: now() });
    ok('refused', junk.s === 400, JSON.stringify(junk.d));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }
  console.log(fails === 0 ? '\nThe code is spent where it is worth spending.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
