// Back, meaning the screen you were just on.
//
// The rail says where everything is; it does not say where you came from. The
// claim worth testing is not that a button exists but that it is honest about
// when it can help: it must not appear on the first screen of a session, where
// "back" would mean leaving Kairos altogether and the person pressing it would
// find themselves signed out of their own tab.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4535, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
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
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
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
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));

    await p.goto(`${BASE}/signup`);
    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Adaeze Okonkwo');
    await p.fill('#email', `ada${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 15000 });
    await p.fill('#slug', `ada${ID}`);
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/meeting-type', { timeout: 15000 });
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 15000 });

    // A new tab, which is what "somebody sent me a link" actually is. Note
    // that reloading the page you are already on is NOT this: a reload keeps
    // the browser's history, so the entries behind you are still really there
    // and offering back is correct. Only a fresh tab starts from nothing.
    head('Arriving cold, with nothing behind you:');
    const fresh = await ctx.newPage();
    fresh.on('pageerror', (e) => errs.push('fresh: ' + e.message));
    await fresh.goto(`${BASE}/today`);
    await fresh.waitForSelector('.app-header', { timeout: 15000 });
    ok('there is no back button, because back would leave Kairos',
      (await fresh.locator('.app-back').count()) === 0);

    head('After moving about inside the app:');
    await fresh.click('.app-nav a:has-text("Trips")');
    await fresh.waitForURL('**/trips', { timeout: 15000 });
    await fresh.waitForSelector('.app-back', { timeout: 15000 });
    ok('the back button appears', true);
    ok('and says what it is, not just an arrow',
      /back/i.test(await fresh.locator('.app-back').innerText()),
      await fresh.locator('.app-back').innerText());

    await fresh.click('.app-back');
    await fresh.waitForURL('**/today', { timeout: 15000 });
    ok('it returns to the screen you were on', true);
    await fresh.waitForFunction(
      () => !document.querySelector('.app-back'), null, { timeout: 15000 },
    );
    ok('and is gone again at the start of the trail', true);

    head('Three deep:');
    await fresh.click('.app-nav a:has-text("Trips")');
    await fresh.waitForURL('**/trips', { timeout: 15000 });
    await fresh.click('.app-nav a:has-text("Tasks")');
    await fresh.waitForURL('**/tasks', { timeout: 15000 });
    await fresh.click('.app-nav a:has-text("Spaces")');
    await fresh.waitForURL('**/spaces', { timeout: 15000 });

    await fresh.click('.app-back');
    await fresh.waitForURL('**/tasks', { timeout: 15000 });
    ok('one step back is one screen, not the beginning', true);
    await fresh.click('.app-back');
    await fresh.waitForURL('**/trips', { timeout: 15000 });
    await fresh.click('.app-back');
    await fresh.waitForURL('**/today', { timeout: 15000 });
    ok('and it walks the whole way back', true);
    await fresh.waitForFunction(
      () => !document.querySelector('.app-back'), null, { timeout: 15000 },
    );
    ok('stopping where the session started', true);

    head('Reloading is not arriving cold:');
    await fresh.click('.app-nav a:has-text("Trips")');
    await fresh.waitForURL('**/trips', { timeout: 15000 });
    await fresh.reload();
    await fresh.waitForSelector('.app-header', { timeout: 15000 });
    ok('back survives a refresh, because the history really is still there',
      (await fresh.locator('.app-back').count()) === 1);

    head('On a phone, where the browser hides its own back:');
    const phone = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    phone.on('pageerror', (e) => errs.push('mobile: ' + e.message));
    await phone.goto(`${BASE}/login`);
    await phone.fill('#email', `ada${ID}@x.com`);
    await phone.fill('#password', PW);
    await phone.click('button:has-text("Log in")');
    await phone.waitForURL('**/today', { timeout: 20000 });
    await phone.click('.nav-toggle');
    await phone.click('.app-nav a:has-text("Trips")');
    await phone.waitForURL('**/trips', { timeout: 15000 });
    ok('the back button is reachable at that width',
      await phone.locator('.app-back').isVisible());
    await phone.click('.app-back');
    await phone.waitForURL('**/today', { timeout: 15000 });
    ok('and returns the same way', true);

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nBack goes back, and is absent when it cannot.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
