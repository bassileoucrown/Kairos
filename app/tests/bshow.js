// Looking at the password you are typing.
//
// Small feature, three ways to get it wrong, and all three are checked here:
// the toggle submitting the form it sits in, the visible word disagreeing with
// what a screen reader announces, and the revealed state surviving into a
// context where somebody else is looking at the screen.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4581;
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const EMAIL = `show${ID}@x.com`;

let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

const typeOf = (p, sel) => p.locator(sel).getAttribute('type');

/** The button belonging to one field, rather than whichever is first on the page. */
const toggleFor = (p, sel) => p.locator(`.password-field:has(${sel}) .password-toggle`);

(async () => {
  const proc = spawn('node', ['index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let browser;

  try {
    // A minute. Twenty seconds is plenty on an idle machine and not plenty on a
    // loaded one, and "no server" on a green tree is a board crying wolf.
    const deadline = Date.now() + 60000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('the server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));

    // ---- Signing up ------------------------------------------------------
    head('On the sign-up form:');
    await p.goto(`${BASE}/signup`);
    await p.waitForSelector('#password', { timeout: 15000 });

    ok('the password starts hidden', (await typeOf(p, '#password')) === 'password');
    ok('and the button offers to show it',
      (await toggleFor(p, '#password').innerText()).trim() === 'Show');
    ok('which is also what it announces',
      (await toggleFor(p, '#password').getAttribute('aria-label')) === 'Show password',
      String(await toggleFor(p, '#password').getAttribute('aria-label')));

    await p.fill('#password', PW);
    await toggleFor(p, '#password').click();
    ok('pressing it reveals the password', (await typeOf(p, '#password')) === 'text');
    ok('the word flips to Hide',
      (await toggleFor(p, '#password').innerText()).trim() === 'Hide');
    ok('and so does what it announces',
      (await toggleFor(p, '#password').getAttribute('aria-label')) === 'Hide password');
    ok('the value is untouched by the switch',
      (await p.locator('#password').inputValue()) === PW);

    // The bug this exists to prevent: a toggle inside a form with no explicit
    // type submits it, so pressing Show creates the account.
    ok('and pressing it did not submit the form', p.url().includes('/signup'), p.url());

    await toggleFor(p, '#password').click();
    ok('pressing again hides it', (await typeOf(p, '#password')) === 'password');

    // ---- Two fields on one page ------------------------------------------
    head('Where a page has two of them:');
    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Ada Boss');
    await p.fill('#email', EMAIL);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 15000 });
    await p.fill('#slug', `ada${ID}`);
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/connect', { timeout: 15000 });
    await p.click('button:has-text("Skip for now")');
    await p.waitForURL('**/onboarding/meeting-type', { timeout: 15000 });
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL(/\/today|\/dashboard/, { timeout: 15000 });

    // Reset-password carries a password and a confirmation, which is where a
    // single shared toggle would reveal both at once.
    await p.goto(`${BASE}/forgot-password`);
    await p.fill('#email', EMAIL);
    await p.click('button:has-text("Send")');
    // The page deliberately does not print the link — it says a mail was sent
    // and nothing more, so that requesting a reset for somebody else's address
    // tells you nothing. With no provider configured the mail still lands in
    // the Outbox, which is where every flow that needs a real token reads it.
    await p.waitForSelector('.alert-success', { timeout: 15000 });
    const path = await p.evaluate(async () => {
      const r = await fetch('/api/emails', { credentials: 'include' });
      const { emails } = await r.json();
      const reset = emails.find((e) => /reset/i.test(e.subject || ''));
      const m = reset && String(reset.body || '').match(/\/reset-password\/[A-Za-z0-9_-]+/);
      return m ? m[0] : null;
    });
    ok('a reset link was issued', !!path, String(path));

    await p.goto(`${BASE}${path}`);
    await p.waitForSelector('#password', { timeout: 15000 });
    ok('both boxes start hidden',
      (await typeOf(p, '#password')) === 'password'
      && (await typeOf(p, '#confirm-password')) === 'password');

    await toggleFor(p, '#password').click();
    ok('showing one shows only that one',
      (await typeOf(p, '#password')) === 'text'
      && (await typeOf(p, '#confirm-password')) === 'password',
      `${await typeOf(p, '#password')} / ${await typeOf(p, '#confirm-password')}`);

    await toggleFor(p, '#confirm-password').click();
    ok('and the other can be shown independently',
      (await typeOf(p, '#password')) === 'text'
      && (await typeOf(p, '#confirm-password')) === 'text');

    await toggleFor(p, '#password').click();
    ok('hiding one leaves the other showing',
      (await typeOf(p, '#password')) === 'password'
      && (await typeOf(p, '#confirm-password')) === 'text');

    // ---- It never starts revealed ----------------------------------------
    head('Coming back to a password box:');
    await p.goto(`${BASE}/dashboard?tab=security`);
    await p.waitForSelector('button:has-text("Set one")', { timeout: 15000 });
    await p.click('button:has-text("Set one")');
    await p.waitForSelector('#sq-set-password', { timeout: 10000 });
    ok('a freshly opened field is hidden', (await typeOf(p, '#sq-set-password')) === 'password');
    await toggleFor(p, '#sq-set-password').click();
    ok('it can be shown here too', (await typeOf(p, '#sq-set-password')) === 'text');

    // Reload rather than re-render: nothing about "shown" should be stored
    // anywhere that survives leaving the page.
    await p.reload();
    await p.waitForSelector('button:has-text("Set one")', { timeout: 15000 });
    await p.click('button:has-text("Set one")');
    await p.waitForSelector('#sq-set-password', { timeout: 10000 });
    ok('and after a reload it is hidden again, not remembered',
      (await typeOf(p, '#sq-set-password')) === 'password');

    ok('no page errors anywhere', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nYou can look at what you are typing, and it never looks back on its own.'
    : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
