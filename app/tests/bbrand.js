// The name has to be right everywhere someone actually meets it: the tab, the
// wordmark, the two auth screens, an invite, a reset email, and a booking page
// seen by people with no account.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');
const PORT = 4410, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const FULL = 'Kairos by Exousia';

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: '' },
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

    await p.goto(`${BASE}/login`);
    ok('browser tab carries the full name', (await p.title()) === FULL, await p.title());
    ok('login heading carries it', (await p.locator('h1').innerText()).includes(FULL));

    await p.goto(`${BASE}/signup`);
    ok('signup heading carries it', (await p.locator('h1').innerText()).includes(FULL));

    // Sign up and check the wordmark in the app shell.
    await p.fill('#name', 'Ada Boss');
    await p.fill('#email', `b${ID}@x.com`);
    await p.fill('#password', 'password123');
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile');
    await p.fill('#slug', `b${ID}`);
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/connect', { timeout: 15000 });
    await p.click('button:has-text("Skip for now")');
    await p.waitForURL('**/onboarding/meeting-type');
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 15000 });
    ok('the wordmark in the app shell carries the full name',
      (await p.locator('.app-brand').innerText()).includes(FULL));

    // The invited-user banner only renders for someone arriving from an
    // invite, so it needs the real path to be exercised.
    // An invite email, and the reset email.
    await p.goto(`${BASE}/dashboard?tab=members`);
    await p.waitForSelector('#invite-email');
    await p.fill('#invite-email', `pa${ID}@x.com`);
    await p.click('button:has-text("Send invite")');
    await p.waitForSelector('.alert-success code');
    // Captured now: the link is only surfaced on the response that created it.
    const link = await p.locator('.alert-success code').textContent();

    await fetch(`${BASE}/api/auth/forgot-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `b${ID}@x.com` }),
    });

    await p.goto(`${BASE}/dashboard?tab=outbox`);
    await p.waitForSelector('.app-main');
    await p.waitForLoadState('networkidle');
    const outbox = await p.locator('.app-main').innerText();
    ok('the invite email is branded', outbox.includes(`invited you to ${FULL}`), outbox.slice(0, 160));

    ok('the reset email is branded', outbox.includes(`Reset your ${FULL} password`));
    ok('outbox prose uses the short name', outbox.includes('Every email Kairos sends'));

    // The invited-user banner, on the real invite path: a Chief of Staff must
    // see their own title there, not "undefined".
    const invitee = await (await b.newContext()).newPage();
    invitee.on('pageerror', (e) => errs.push(e.message));
    const invitePath = new URL(link, BASE).pathname;
    await invitee.goto(`${BASE}/signup?next=${encodeURIComponent(invitePath)}`);
    await invitee.click('button:has-text("Chief of Staff")');
    await invitee.fill('#name', 'Kit Staff');
    await invitee.fill('#email', `pa${ID}@x.com`);
    await invitee.fill('#password', 'password123');
    await invitee.click('button:has-text("Create account")');
    await invitee.waitForURL('**/onboarding/profile', { timeout: 15000 });
    // The banner is rendered from a fetch of the invite, so wait for it.
    await invitee.waitForSelector('.alert-success', { timeout: 15000 });
    const banner = await invitee.locator('.alert-success').innerText();
    ok('onboarding uses the short name in prose', banner.includes('own Kairos account'), banner);
    ok('and names their real title, not "undefined"',
      banner.includes('Chief of Staff') && !banner.includes('undefined'), banner);

    // A booking page — seen by people who have no account at all.
    const anon = await (await b.newContext()).newPage();
    await anon.goto(`${BASE}/book/b${ID}`);
    await anon.waitForLoadState('networkidle');
    ok('a public booking page carries the name in its tab', (await anon.title()) === FULL);

    ok('no JS errors', errs.length === 0, errs.join(' | '));
  } finally { await b.close(); proc.kill(); }
  console.log(fails === 0 ? '\nThe rebrand is consistent everywhere it is seen.' : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
