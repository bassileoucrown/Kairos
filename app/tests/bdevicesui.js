// Two real browsers, one account, and ending one from the other.
//
// The API suite (bdevices.js) proves the rules. This proves the screen a person
// actually uses in the situation it is for: they are holding one device, another
// is gone, and they have to end it without the authenticator that went with it.
//
// Two browser contexts are two devices as far as the server is concerned —
// separate cookie jars, separate user agents — which is exactly the thing being
// tested, so it cannot be faked with two tabs.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4577;
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const EMAIL = `dui${ID}@x.com`;
const QUESTION = 'The street my grandmother lived on';
const ANSWER = 'Ojuelegba Road';

let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

(async () => {
  const proc = spawn('node', ['index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), SESSION_TOUCH_MS: '0' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let browser;

  try {
    const deadline = Date.now() + 30000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('the server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });

    // ---- The laptop signs up, and sets the question in onboarding --------

    const laptopCtx = await browser.newContext();
    const laptop = await laptopCtx.newPage();
    const errors = [];
    laptop.on('pageerror', (e) => errors.push(String(e)));

    await laptop.goto(`${BASE}/signup`);
    await laptop.click('.role-option:has-text("Principal")');
    await laptop.fill('#name', 'Ada Boss');
    await laptop.fill('#email', EMAIL);
    await laptop.fill('#password', PW);
    await laptop.click('button:has-text("Create account")');
    await laptop.waitForURL('**/onboarding/profile', { timeout: 15000 });
    await laptop.fill('#slug', `ada-${ID}`);
    await laptop.click('button:has-text("Continue")');
    await laptop.waitForURL('**/onboarding/meeting-type', { timeout: 15000 });
    await laptop.fill('#mt-name', 'Intro');
    await laptop.click('button:has-text("Finish setup")');

    await laptop.waitForURL(/\/today|\/dashboard/, { timeout: 15000 });

    // ---- The dashboard asks for a question, and takes one ----------------
    head('The dashboard prompts for a security question:');
    await laptop.goto(`${BASE}/dashboard`);
    await laptop.waitForSelector('.sq-prompt', { timeout: 15000 });
    const promptText = await laptop.locator('.sq-prompt').innerText();
    ok('a new account is prompted to set one',
      /security question/i.test(promptText), promptText.slice(0, 140));
    ok('and told why it is not the authenticator code',
      /authenticator/i.test(promptText), promptText.slice(0, 200));

    await laptop.click('button:has-text("Set your question")');
    await laptop.waitForSelector('#sq-set-question, button:has-text("Set one")', { timeout: 15000 });
    if (await laptop.locator('button:has-text("Set one")').count()) {
      await laptop.click('button:has-text("Set one")');
    }
    await laptop.fill('#sq-set-question', QUESTION);
    await laptop.fill('#sq-set-answer', ANSWER);
    await laptop.fill('#sq-set-password', PW);
    await laptop.click('.key-setup button:has-text("Save")');
    await laptop.waitForSelector('.alert-success', { timeout: 15000 });
    ok('setting it from Settings works', true);

    await laptop.goto(`${BASE}/dashboard`);
    await laptop.waitForSelector('.booking-link-box', { timeout: 15000 });
    ok('and the prompt goes away once it is set',
      (await laptop.locator('.sq-prompt').count()) === 0);

    // ---- The phone signs in ---------------------------------------------
    head('A second device signs in:');
    const phoneCtx = await browser.newContext({ userAgent: PHONE });
    const phone = await phoneCtx.newPage();
    await phone.goto(`${BASE}/login`);
    await phone.fill('#email', EMAIL);
    await phone.fill('#password', PW);
    await phone.click('button:has-text("Log in")');
    await phone.waitForURL(/\/today|\/dashboard/, { timeout: 15000 });
    ok('the phone is in', true);
    await laptop.reload();
    ok('and the laptop is undisturbed', !/\/login/.test(laptop.url()), laptop.url());

    // ---- The list --------------------------------------------------------
    head('Seeing both on the Security screen:');
    await laptop.goto(`${BASE}/dashboard?tab=security`);
    await laptop.waitForSelector('.ess-row', { timeout: 15000 });
    const panel = await laptop.locator('section:has-text("Where you are signed in")').innerText();
    ok('both devices are listed', /iPhone/i.test(panel) && /this device/i.test(panel), panel.replace(/\s+/g, " ").slice(0, 400));
    ok('each says when it was last used', /Last used/.test(panel));

    // ---- Ending the phone ------------------------------------------------
    head('Ending the phone from the laptop:');
    const phoneRow = laptop.locator('.ess-row:has-text("iPhone")');
    await phoneRow.locator('button:has-text("Sign out")').click();
    await laptop.waitForSelector('#revoke-secret', { timeout: 10000 });

    const prompt = await laptop.locator('.revoke-panel').innerText();
    ok('it asks the question the principal wrote, not for a code',
      prompt.includes(QUESTION) && !/authenticator|6-digit/i.test(prompt), prompt.slice(0, 160));

    await laptop.fill('#revoke-secret', 'not the answer');
    await laptop.click('.revoke-panel button:has-text("Sign out")');
    await laptop.waitForSelector('.alert-error', { timeout: 10000 });
    ok('a wrong answer is refused on screen', true);

    await laptop.fill('#revoke-secret', '  ojuelegba ROAD  ');
    await laptop.click('.revoke-panel button:has-text("Sign out")');
    await laptop.waitForSelector('.alert-success', { timeout: 10000 });
    ok('the right answer works, capitals and spaces and all', true);

    const after = await laptop.locator('section:has-text("Where you are signed in")').innerText();
    ok('the phone is gone from the list', !/iPhone/i.test(after), after.slice(0, 200));

    // The whole point, seen from the other device.
    await phone.goto(`${BASE}/today`);
    await phone.waitForURL(/\/login|\/$/, { timeout: 15000 });
    ok('and the phone is signed out the moment it next asks for anything',
      /\/login|\/$/.test(phone.url()), phone.url());

    ok('no page errors anywhere', errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA lost phone can be signed out from the device still in your hand.'
    : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
