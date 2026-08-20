// Signing back in with two-factor on, through the login screen.
//
// This suite exists because of a lockout I shipped. bmfa proved the API
// refuses a password-only login and accepts a code — but it proved it with
// fetch, never through the page. The login screen rendered email and password
// only, ignored the server's needsCode entirely, and offered nowhere to type
// the six digits. Two-factor could be turned on and then locked you out of
// your own account.
//
// Testing the endpoint is not testing the door.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const totp = require(`${ROOT}/app/server/lib/totp`);
const { spawn } = require('child_process');

const PORT = 4513, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const EMAIL = `ada${ID}@x.com`;
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

const now = () => totp.codeAt(SECRET, Math.floor(Date.now() / 1000 / 30));
let SECRET = '';

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
    const p = await (await b.newContext()).newPage();
    p.on('pageerror', (e) => errs.push(e.message));

    // --- an account with two-factor genuinely on ---
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

    await p.goto(`${BASE}/dashboard?tab=security`);
    await p.click('button:has-text("Set up two-factor")');
    await p.waitForSelector('.totp-secret code', { timeout: 15000 });
    SECRET = (await p.locator('.totp-secret code').innerText()).trim().replace(/\s/g, '');
    await p.fill('#totp-code', now());
    await p.click('.totp-setup button:has-text("Confirm")');
    await p.waitForSelector('.ess-codes', { timeout: 15000 });
    const recovery = (await p.locator('.ess-codes li').allInnerTexts()).map((s) => s.trim());
    ok('two-factor is on, with recovery codes issued', recovery.length >= 8);

    // This suite is about the return journey through the login page, and the
    // code is spent on the vault by default — so it is moved to the front door
    // deliberately here. Moving it costs a step-up of its own, which the screen
    // asks for in a prompt; Playwright dismisses dialogs unless told otherwise.
    p.on('dialog', (d) => d.accept(now()));
    await p.selectOption('#totp-scope', 'login_and_vault');
    await p.waitForFunction(
      () => /sign in/i.test(document.querySelector('.ess-group')?.textContent || ''),
      null, { timeout: 15000 },
    );
    ok('and asked for at sign-in, for this test', true);

    // --- log out, and try to get back in ---
    head('Signing back in:');
    const ctx2 = await b.newContext();
    const back = await ctx2.newPage();
    back.on('pageerror', (e) => errs.push('login: ' + e.message));
    await back.goto(`${BASE}/login`);
    await back.fill('#email', EMAIL);
    await back.fill('#password', PW);
    await back.click('button:has-text("Log in")');

    // The bug: this box did not exist, so there was no way to finish.
    await back.waitForSelector('#login-code', { timeout: 15000 });
    ok('the page asks for the code AND gives somewhere to type it', true);
    ok('and says where the code comes from',
      /authenticator app/i.test(await back.locator('.totp-login').innerText()),
      await back.locator('.totp-login').innerText());
    ok('naming apps rather than assuming knowledge',
      /Google Authenticator|1Password/.test(await back.locator('.totp-login').innerText()));
    ok('the email and password are not thrown away',
      (await back.inputValue('#email')) === EMAIL && (await back.inputValue('#password')) === PW);
    ok('and nothing is reported as an error yet, because nothing went wrong',
      (await back.locator('.alert-error').count()) === 0);

    head('A wrong code:');
    await back.fill('#login-code', '000000');
    await back.click('button:has-text("Verify and log in")');
    await back.waitForSelector('.alert-error', { timeout: 15000 });
    ok('is refused and said so', /not right/i.test(await back.locator('.alert-error').innerText()));
    ok('with the box still there to try again',
      (await back.locator('#login-code').count()) === 1);

    head('The real code:');
    await back.fill('#login-code', now());
    await back.click('button:has-text("Verify and log in")');
    await back.waitForURL(/\/today|\/pa|\/workspace|\/dashboard/, { timeout: 20000 });
    ok('signs in', true);

    head('And a recovery code, for the phone in the river:');
    const ctx3 = await b.newContext();
    const lost = await ctx3.newPage();
    lost.on('pageerror', (e) => errs.push('recovery: ' + e.message));
    await lost.goto(`${BASE}/login`);
    await lost.fill('#email', EMAIL);
    await lost.fill('#password', PW);
    await lost.click('button:has-text("Log in")');
    await lost.waitForSelector('#login-code', { timeout: 15000 });

    await lost.click('button:has-text("Lost the phone")');
    ok('there is a way through without the phone',
      /Recovery code/i.test(await lost.locator('.totp-login label').innerText()));
    ok('explaining what one is',
      /works once/i.test(await lost.locator('.totp-login .hint').innerText()));

    await lost.fill('#login-code', recovery[0]);
    await lost.click('button:has-text("Verify and log in")');
    await lost.waitForURL(/\/today|\/pa|\/workspace|\/dashboard/, { timeout: 20000 });
    ok('and it gets you in', true);

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nTwo-factor no longer locks you out of your own account.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
