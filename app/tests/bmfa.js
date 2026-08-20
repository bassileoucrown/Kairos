// Turning on two-factor, end to end, from the screen.
//
// The suite computes a genuine TOTP code from the secret the page displays and
// hands it back — so "the setup screen works" means the loop actually closes,
// not that the boxes rendered. The user's report was that the code never
// worked; the algorithm was right and the screen was the problem, telling them
// to scan a QR code it had never drawn and naming no app to scan it with.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const totp = require(`${ROOT}/app/server/lib/totp`);
const { spawn } = require('child_process');

const PORT = 4501, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const EMAIL = `ada${ID}@x.com`;
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  }

  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ENCRYPTION_KEY: KEY },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (;;) {
    try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
    catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }

  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];
  try {
    const ctx = await b.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));

    await p.goto(`${BASE}/signup`);
    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Ada Boss');
    await p.fill('#email', EMAIL);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 15000 });
    await p.fill('#slug', `ada${ID}`);
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/meeting-type', { timeout: 15000 });
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 15000 });

    head('The setup screen says where the code comes from:');
    await p.goto(`${BASE}/dashboard?tab=security`);
    await p.waitForSelector('button:has-text("Set up two-factor")', { timeout: 15000 });
    await p.click('button:has-text("Set up two-factor")');
    await p.waitForSelector('.totp-setup', { timeout: 15000 });

    const text = await p.locator('.totp-setup').innerText();
    ok('it says an app is needed', /install an authenticator app/i.test(text));
    ok('and names apps a person can actually go and get',
      /Google Authenticator/.test(text) && /1Password/.test(text), text.slice(0, 200));
    ok('and rules out waiting for a text message',
      /never sends you a code by text or email/i.test(text));

    await p.waitForSelector('.totp-qr svg', { timeout: 20000 });
    ok('a QR code is actually drawn, not merely mentioned',
      (await p.locator('.totp-qr svg').count()) === 1);

    const secretShown = (await p.locator('.totp-secret code').innerText()).trim();
    ok('the key is shown in groups, for typing by hand',
      /^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/.test(secretShown), secretShown);

    const href = await p.locator('.totp-open').getAttribute('href');
    ok('and there is a one-tap link for a phone', /^otpauth:\/\/totp\//.test(href || ''), href);
    const secret = secretShown.replace(/\s/g, '');
    ok('the link carries the same secret as the printed key',
      new URL(href.replace('otpauth://', 'https://')).searchParams.get('secret') === secret);
    ok('it names the issuer so the app labels it Kairos',
      /issuer=Kairos/i.test(href), href);

    head('A wrong code is refused, plainly:');
    await p.fill('#totp-code', '000000');
    await p.click('.totp-setup button:has-text("Confirm")');
    // Scoped to the form. The dashboard shows its own red banner when no
    // availability is set, so an unscoped wait matches something that was
    // already on the page and asserts nothing.
    await p.waitForSelector('.totp-setup .alert-error', { timeout: 15000 });
    const shown = await p.locator('.totp-setup .alert-error').innerText();
    ok('and says so rather than failing silently', /not right/i.test(shown), shown);
    ok('right beside the box, not at the top of the page',
      (await p.locator('.totp-setup .alert-error').count()) === 1);
    ok('leaving the setup screen up so it can be retried',
      (await p.locator('.totp-setup').count()) === 1);

    head('The real code is accepted:');
    // Computed from the secret the page just displayed — if the screen showed
    // the wrong thing, or showed it wrongly, this cannot pass.
    const good = totp.codeAt(secret, Math.floor(Date.now() / 1000 / 30));
    await p.fill('#totp-code', good);
    await p.click('.totp-setup button:has-text("Confirm")');
    await p.waitForSelector('.ess-codes', { timeout: 15000 });
    ok('two-factor turns on with a code from the displayed key', true);

    const recovery = await p.locator('.ess-codes li').allInnerTexts();
    ok('recovery codes are handed over', recovery.length >= 8, String(recovery.length));
    ok('and the screen says to save them now',
      /not shown again/i.test(await p.locator('.ess-group').first().innerText()));
    await p.waitForSelector('.pill:has-text("On")', { timeout: 15000 });
    ok('and it reports itself as on', true);

    head('And it is actually required at the next sign-in:');
    // The code is spent on the vault by default now, so a suite about sign-in
    // has to ask for it there. See lib/stepUp.js — a code at the front door
    // protects everything but is paid on every login, and that friction is
    // what makes people turn two-factor off.
    const moved = await p.evaluate(async (c) => {
      const r = await fetch('/api/security/2fa/scope', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'login_and_vault', code: c }),
      });
      return { s: r.status, d: await r.json().catch(() => null) };
    }, totp.codeAt(secret, Math.floor(Date.now() / 1000 / 30)));
    ok('two-factor can be asked for at sign-in as well',
      moved.s === 200 && moved.d.scope === 'login_and_vault', JSON.stringify(moved));

    await p.goto(`${BASE}/api/auth/logout`).catch(() => {});
    const ctx2 = await b.newContext();
    const p2 = await ctx2.newPage();
    p2.on('pageerror', (e) => errs.push('login: ' + e.message));

    // Through the API, which is where the requirement has to hold.
    const bare = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PW }),
    });
    const bareBody = await bare.json();
    ok('the password alone no longer signs in', bare.status === 401, String(bare.status));
    ok('and the app asks for the code', bareBody.needsCode === true, JSON.stringify(bareBody));

    const withCode = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: EMAIL, password: PW,
        code: totp.codeAt(secret, Math.floor(Date.now() / 1000 / 30)),
      }),
    });
    ok('the code from the app gets in', withCode.status === 200, String(withCode.status));

    const withRecovery = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PW, code: recovery[0].trim() }),
    });
    ok('and so does a recovery code, for the phone in the river',
      withRecovery.status === 200, String(withRecovery.status));

    const reused = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PW, code: recovery[0].trim() }),
    });
    ok('but only once', reused.status === 401, String(reused.status));

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nTwo-factor can be set up by somebody who has never used it.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
