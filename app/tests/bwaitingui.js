// The rail actually showing it.
//
// bwaiting.js proves the numbers are right and that they do not leak. This
// proves somebody can see them — including on a phone, where the rail is off
// screen and the only thing that can say "there is something in here" is the
// button that opens it.
//
// The property that makes the whole thing worth having is the boring one:
// acting on something clears its mark. A dot that survives being dealt with
// trains people to ignore the next one.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4613);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const EMAIL = `dot${ID}@x.com`;
const SLUG = `ada${ID}`;

let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

const badgeOn = (p, label) => p.locator(`.nav-item:has-text("${label}") .nav-badge`);

(async () => {
  // Start on an empty database. This suite asserts that a fresh account has
  // *nothing* marked, and a notice published by an earlier suite is delivered
  // to everybody — so without this, "no marks at all" fails for a reason that
  // has nothing to do with the rail.
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  }

  const proc = spawn('node', ['index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let browser;

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

    // ---- A principal with nothing waiting ---------------------------------
    await p.goto(`${BASE}/signup`);
    await p.waitForSelector('#password', { timeout: 15000 });
    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Ada Boss');
    await p.fill('#email', EMAIL);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 15000 });
    await p.fill('#slug', SLUG);
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/connect', { timeout: 15000 });
    await p.click('button:has-text("Skip for now")');
    await p.waitForURL('**/onboarding/meeting-type', { timeout: 15000 });
    await p.fill('#mt-name', 'Private');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL(/\/today|\/dashboard/, { timeout: 15000 });
    await p.waitForSelector('.nav-item', { timeout: 15000 });

    head('Before anything has happened:');
    ok('the rail carries no marks at all',
      (await p.locator('.nav-badge').count()) === 0,
      String(await p.locator('.nav-badge').count()));
    ok('and the menu button has no dot',
      (await p.locator('.nav-toggle-dot').count()) === 0);

    // Open the door, and make the meeting type one that has to be approved.
    const slug = await p.evaluate(async () => {
      await fetch('/api/availability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
        }),
      });
      const { meetingTypes } = await (await fetch('/api/meeting-types', { credentials: 'include' })).json();
      const mt = meetingTypes[0];
      await fetch(`/api/meeting-types/${mt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ accessTier: 4 }),
      });
      return mt.slug;
    });

    // ---- Somebody books ----------------------------------------------------
    const guest = await browser.newContext();
    const g = await guest.newPage();
    await g.goto(`${BASE}/book/${SLUG}/${slug}`);
    await g.waitForSelector('.slot-btn', { timeout: 20000 });
    await g.locator('.slot-btn').first().click();
    await g.waitForSelector('#booker-name', { timeout: 15000 });
    await g.fill('#booker-name', 'A Stranger');
    await g.fill('#booker-email', `s${ID}@x.com`);
    await g.click('button[type="submit"]');
    await g.waitForSelector('.confirmation h1', { timeout: 15000 });

    head('Once somebody asks for time:');
    await p.goto(`${BASE}/today`);
    await p.waitForSelector('.nav-item', { timeout: 15000 });
    // The four desk entries became one, so the approvals count is on Desk.
    await p.waitForSelector('.nav-item:has-text("Desk") .nav-badge', { timeout: 15000 });
    ok('the rail marks the desk', (await badgeOn(p, 'Desk').innerText()).trim() === '1',
      (await badgeOn(p, 'Desk').innerText()).trim());
    ok('and marks nothing else', (await p.locator('.nav-badge').count()) === 1,
      String(await p.locator('.nav-badge').count()));

    // ---- The tab strip says which section ----------------------------------
    head('On the desk itself:');
    await p.goto(`${BASE}/pa?tab=contacts`);
    await p.waitForSelector('.tabs .tab-btn', { timeout: 15000 });
    await p.waitForSelector('.tab-btn:has-text("Approvals") .tab-dot', { timeout: 15000 });
    ok('the Approvals tab carries a dot',
      (await p.locator('.tab-btn:has-text("Approvals") .tab-dot').count()) === 1);
    ok('and no other tab does', (await p.locator('.tabs .tab-dot').count()) === 1,
      String(await p.locator('.tabs .tab-dot').count()));

    // ---- On a phone ---------------------------------------------------------
    head('On a phone, where the rail is hidden:');
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
    const ph = await phone.newPage();
    await ph.goto(`${BASE}/today`);
    await ph.waitForSelector('.nav-toggle', { timeout: 15000 });
    await ph.waitForSelector('.nav-toggle-dot', { timeout: 15000 });
    ok('the menu button carries a dot', (await ph.locator('.nav-toggle-dot').count()) === 1);
    ok('and says so out loud, for somebody who cannot see it',
      /waiting/i.test(await ph.locator('.nav-toggle').getAttribute('aria-label')),
      String(await ph.locator('.nav-toggle').getAttribute('aria-label')));

    // The tab strip is a menu at this width, and the dot has to survive that.
    await ph.goto(`${BASE}/pa?tab=contacts`);
    await ph.waitForSelector('.tabs-current', { timeout: 15000 });
    await ph.waitForSelector('.tabs-current .tab-dot', { timeout: 15000 });
    ok('the closed tab menu says one of the sections inside it needs attention',
      (await ph.locator('.tabs-current .tab-dot').count()) === 1);
    await ph.click('.tabs-current');
    await ph.waitForSelector('.tabs-list', { timeout: 15000 });
    ok('and opening it shows which one',
      (await ph.locator('.tabs-list-item:has-text("Approvals") .tab-dot').count()) === 1);
    await phone.close();

    // ---- Dealing with it -----------------------------------------------------
    head('Once it is dealt with:');
    await p.goto(`${BASE}/pa?tab=approvals`);
    await p.waitForSelector('.booking-row button:has-text("Approve")', { timeout: 15000 });
    await p.click('.booking-row button:has-text("Approve")');
    await p.waitForSelector('.empty-state', { timeout: 15000 });

    await p.goto(`${BASE}/today`);
    await p.waitForSelector('.nav-item', { timeout: 15000 });
    await p.waitForTimeout(400);
    ok('the mark is gone from the rail', (await p.locator('.nav-badge').count()) === 0,
      String(await p.locator('.nav-badge').count()));

    await p.goto(`${BASE}/pa?tab=contacts`);
    await p.waitForSelector('.tabs .tab-btn', { timeout: 15000 });
    await p.waitForTimeout(400);
    ok('and from the tab strip', (await p.locator('.tabs .tab-dot').count()) === 0,
      String(await p.locator('.tabs .tab-dot').count()));

    ok('no page threw along the way', errors.length === 0, JSON.stringify(errors).slice(0, 200));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nYou can see there is something waiting, and it goes when you deal with it.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})();
