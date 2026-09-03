// The custody screens in a real browser, plus the leak check: a sensitive
// value must not escape into the Outbox, the page source, or a list response.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');
const totp = require(`${ROOT}/app/server/lib/totp`);

const PORT = 4420, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const PASSPORT = 'Z99887766';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: '',
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (;;) {
    try { const r = await (await fetch(`${BASE}/api/status`)).json(); if (r.databaseReady) break; }
    catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];
  try {
    const p = await (await b.newContext()).newPage();
    p.on('pageerror', (e) => errs.push(e.message));

    await p.goto(`${BASE}/signup`);
    await p.fill('#name', 'Ada Boss');
    await p.fill('#email', `b${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile');
    // The field arrives empty now — nothing is chosen for anybody — so the
    // point this assertion was always making is checked where it can be: once
    // there is a handle to talk about, the screen talks about a HANDLE rather
    // than about the last part of a booking URL.
    ok('onboarding asks for a handle rather than filling one in',
      await p.inputValue('#slug') === '', await p.inputValue('#slug'));
    await p.fill('#slug', `ada${ID}`);
    ok('and presents it as a handle, not a booking link',
      (await p.locator('.onboarding-card').innerText()).includes(`@ada${ID}`));
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/connect', { timeout: 15000 });
    await p.click('button:has-text("Skip for now")');
    await p.waitForURL('**/onboarding/meeting-type');
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 15000 });

    // --- Essentials ---
    await p.goto(`${BASE}/dashboard?tab=essentials`);
    await p.waitForSelector('button:has-text("Add a detail")', { timeout: 15000 });
    await p.click('button:has-text("Add a detail")');
    await p.selectOption('#ess-category', 'travel_identity');
    await p.selectOption('#ess-field', 'passport_number');
    await p.fill('#ess-value', PASSPORT);
    await p.fill('#ess-expires', '2026-10-01');
    await p.click('button:has-text("Save")');
    await p.waitForSelector('.ess-row', { timeout: 15000 });

    const masked = await p.locator('.ess-value').first().innerText();
    ok('the passport shows masked', masked.includes('••••') && masked.includes('7766'), masked);
    ok('the raw number is NOT in the page source', !(await p.content()).includes(PASSPORT));
    // Scope to the row — the dashboard header has pills of its own.
    ok('expiry is flagged on the row',
      /days left/i.test(await p.locator('.ess-row').first().innerText()),
      await p.locator('.ess-row').first().innerText());

    await p.click('button:has-text("Reveal")');
    // The step-up asks in the app now rather than through window.prompt, which
    // showed the password in the clear and could not be filled by a password
    // manager — on the one screen that holds a passport number.
    await p.waitForSelector('.ask-card', { timeout: 15000 });
    ok('the step-up asks inside Kairos, not in a browser box',
      (await p.locator('.ask-card h2').innerText()).includes('Confirm it is you'));
    ok('and the password is masked while it is typed',
      (await p.locator('.ask-card input').first().getAttribute('type')) === 'password');
    await p.fill('.ask-card input', PW);
    await p.click('.ask-card button:has-text("Confirm")');
    await p.waitForFunction((v) => document.body.innerText.includes(v), PASSPORT, { timeout: 15000 });
    ok('revealing with a password shows it', true);

    // --- The leak check ---
    await p.goto(`${BASE}/dashboard?tab=outbox`);
    await p.waitForSelector('.app-main');
    await p.waitForLoadState('networkidle');
    ok('no sensitive value reached the Outbox', !(await p.content()).includes(PASSPORT));

    // --- Today shows the expiry, without the number ---
    await p.goto(`${BASE}/today`);
    await p.waitForSelector('.needs-card', { timeout: 15000 });
    const today = await p.content();
    ok('Today warns the passport is expiring', today.includes('Expiring soon'));
    ok('and never carries the number', !today.includes(PASSPORT));

    // --- Security screen ---
    await p.goto(`${BASE}/dashboard?tab=security`);
    await p.waitForSelector('button:has-text("Set up two-factor")', { timeout: 15000 });
    ok('the access log shows the reveal',
      (await p.locator('.app-main').innerText()).includes('reveal'));
    await p.click('button:has-text("Set up two-factor")');
    await p.waitForSelector('#totp-code', { timeout: 15000 });
    // Grouped for readability on the setup screen, so the spaces come out.
    const secret = (await p.locator('.totp-secret code').innerText()).trim().replace(/\s/g, '');
    await p.fill('#totp-code', totp.codeAt(secret, Math.floor(Date.now() / 1000 / 30)));
    await p.click('button:has-text("Confirm")');
    await p.waitForSelector('.ess-codes', { timeout: 15000 });
    ok('two-factor turns on and issues recovery codes',
      (await p.locator('.ess-codes li').count()) === 8);
    // The panel re-fetches after confirming, so wait for the state to land.
    await p.waitForSelector('button:has-text("Turn off")', { timeout: 15000 });
    // The wording follows where the code is spent, and the default is the
    // vault rather than the front door.
    ok('and the screen now says it is on, and where the code is needed',
      /code is needed to reveal anything sensitive/i.test(await p.locator('.app-main').innerText()),
      (await p.locator('.app-main').innerText()).slice(0, 200));

    ok('no JS errors', errs.length === 0, errs.join(' | '));
  } finally { await b.close(); proc.kill(); }
  console.log(fails === 0 ? '\nThe custody screens work.' : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
