// The vault's second gate asks for the second factor.
//
// The claim, stated from the attacker's side: somebody who has taken the
// account — password and all — still cannot read a passport number without the
// phone. That is what a password-based gate could never give, because the
// attacker it has to survive is precisely the one who knows the password.
//
// Where two-factor is not enrolled there is nothing else to ask for, so the
// password stands. The gate never gets weaker than it was.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const totp = require(`${ROOT}/app/server/lib/totp`);

const PORT = Number(process.env.PORT || 4515);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function client() {
  let cookie = '';
  const call = async (method, path, body) => {
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
  call.cookie = () => cookie;
  return call;
}

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
      ...process.env, NODE_ENV: 'production', PORT: String(PORT), ENCRYPTION_KEY: KEY,
      // Short enough to watch it lapse inside a test run.
      STEP_UP_GRACE_MS: '2500',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    // --- a principal with two-factor on, holding a passport ---
    const ada = client();
    const up = await ada('POST', '/auth/signup',
      { name: 'Ada Boss', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const adaId = up.d.user.id;
    await ada('POST', '/profile/onboarding-step', { step: 'done' });

    const made = await ada('POST', `/essentials/${adaId}`,
      { category: 'travel_identity', field: 'passport_number', value: 'Z99887766' });
    const essentialId = made.d.essential?.id || made.d.id;

    head('Before two-factor, the password is the gate:');
    const before = await ada('GET', `/essentials/${adaId}`);
    ok('and the screen is told so', before.d.stepUpFactor === 'password', before.d.stepUpFactor);
    const byPw = await ada('POST', `/essentials/${adaId}/${essentialId}/reveal`, { password: PW });
    ok('the password reveals', byPw.s === 200 && byPw.d.essential.value === 'Z99887766',
      JSON.stringify(byPw.d).slice(0, 120));

    head('Turning two-factor on changes what the gate asks for:');
    const setup = await ada('POST', '/security/2fa/setup');
    const secret = setup.d.secret;
    const now = () => totp.codeAt(secret, Math.floor(Date.now() / 1000 / 30));
    const confirmed = await ada('POST', '/security/2fa/confirm', { code: now() });
    ok('two-factor is on', confirmed.s === 200);
    const recovery = confirmed.d.recoveryCodes;

    const after = await ada('GET', `/essentials/${adaId}`);
    ok('and the screen is told to ask for a code', after.d.stepUpFactor === 'code', after.d.stepUpFactor);

    // Wait out the grace earned by the password reveal above.
    await new Promise((r) => setTimeout(r, 2700));

    head('The password alone no longer opens the vault:');
    const stillPw = await ada('POST', `/essentials/${adaId}/${essentialId}/reveal`, { password: PW });
    ok('a correct password is refused', stillPw.s === 401, JSON.stringify(stillPw.d));
    ok('and the refusal says what is wanted instead',
      stillPw.d.needs === 'code' && /authenticator/i.test(stillPw.d.error), JSON.stringify(stillPw.d));
    ok('no value came back with it', !JSON.stringify(stillPw.d).includes('Z99887766'));

    const wrongCode = await ada('POST', `/essentials/${adaId}/${essentialId}/reveal`, { code: '000000' });
    ok('a wrong code is refused', wrongCode.s === 401 && /not right/i.test(wrongCode.d.error));

    head('The code from the phone does:');
    const byCode = await ada('POST', `/essentials/${adaId}/${essentialId}/reveal`, { code: now() });
    ok('it reveals', byCode.s === 200 && byCode.d.essential.value === 'Z99887766',
      JSON.stringify(byCode.d).slice(0, 120));

    head('And covers a short run of work rather than asking every time:');
    const again = await ada('POST', `/essentials/${adaId}/${essentialId}/reveal`, {});
    ok('a second reveal moments later needs nothing', again.s === 200);
    const block = await ada('POST', `/essentials/${adaId}/travel-block`, {});
    ok('so does the travel block', block.s === 200, JSON.stringify(block.d).slice(0, 100));

    await new Promise((r) => setTimeout(r, 2700));
    const lapsed = await ada('POST', `/essentials/${adaId}/${essentialId}/reveal`, {});
    ok('once the window lapses it asks again',
      lapsed.s === 401 && lapsed.d.needs === 'code', JSON.stringify(lapsed.d));

    head('The travel block is gated identically — it is a reveal of everything:');
    const blockPw = await ada('POST', `/essentials/${adaId}/travel-block`, { password: PW });
    ok('the password will not assemble it either',
      blockPw.s === 401 && blockPw.d.needs === 'code', JSON.stringify(blockPw.d).slice(0, 120));
    const blockCode = await ada('POST', `/essentials/${adaId}/travel-block`, { code: now() });
    ok('the code will', blockCode.s === 200);

    head('A recovery code works, for the phone in the river:');
    await new Promise((r) => setTimeout(r, 2700));
    const byRecovery = await ada('POST', `/essentials/${adaId}/${essentialId}/reveal`,
      { code: recovery[0] });
    ok('it reveals', byRecovery.s === 200);
    await new Promise((r) => setTimeout(r, 2700));
    const reused = await ada('POST', `/essentials/${adaId}/${essentialId}/reveal`,
      { code: recovery[0] });
    ok('but only once', reused.s === 401, JSON.stringify(reused.d));

    head('The whole point, from the attacker side:');
    // A stolen session: they have the password, and they are already signed in.
    const thief = client();
    const stolen = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `ada${ID}@x.com`, password: PW, code: now() }),
    });
    const thiefCookie = stolen.headers.get('set-cookie').split(';')[0];
    const asThief = async (path, body) => {
      const r = await fetch(`${BASE}/api${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: thiefCookie },
        body: JSON.stringify(body),
      });
      return { s: r.status, d: await r.json().catch(() => null) };
    };
    await new Promise((r) => setTimeout(r, 2700));
    const grab = await asThief(`/essentials/${adaId}/${essentialId}/reveal`, { password: PW });
    ok('somebody inside the account, holding the password, still cannot read it',
      grab.s === 401, JSON.stringify(grab.d));
    ok('and gets no part of the number', !JSON.stringify(grab.d).includes('Z99887766'));

    head('Every reveal is still written down:');
    const log = await ada('GET', '/security/access-log');
    const reveals = (log.d.entries || []).filter((e) => e.action === 'reveal');
    ok('including the ones inside the grace window', reveals.length >= 5, String(reveals.length));

    head('An account without two-factor is unaffected:');
    const ben = client();
    const up2 = await ben('POST', '/auth/signup',
      { name: 'Ben Reed', email: `ben${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await ben('POST', '/profile/onboarding-step', { step: 'done' });
    const benId = up2.d.user.id;
    const benMade = await ben('POST', `/essentials/${benId}`,
      { category: 'travel_identity', field: 'passport_number', value: 'B11223344' });
    const benEssential = benMade.d.essential?.id || benMade.d.id;
    const benList = await ben('GET', `/essentials/${benId}`);
    ok('their gate is still the password', benList.d.stepUpFactor === 'password');
    const benNothing = await ben('POST', `/essentials/${benId}/${benEssential}/reveal`, {});
    ok('and nothing at all is still refused', benNothing.s === 401 && benNothing.d.needs === 'password');
    const benPw = await ben('POST', `/essentials/${benId}/${benEssential}/reveal`, { password: PW });
    ok('while the password still works', benPw.s === 200 && benPw.d.essential.value === 'B11223344');
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }
  console.log(fails === 0 ? '\nThe vault survives somebody who has the account.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
