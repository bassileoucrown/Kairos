// The pad, within reach of wherever you are.
//
// A thought arrives halfway down a day sheet, not at the top of the pad's own
// screen. The header is not sticky, so a button up there is only reachable
// after scrolling back up — which is exactly the friction that sends a note to
// the back of an envelope instead.
//
// So it floats, bottom-right. The interesting assertions here are the ones
// about it NOT being in the way, because "does that button cover my content"
// is the real question and it is answerable by measurement rather than by
// opinion: the last row of a full list must be clear of the dock, on a phone
// as well as a desktop.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (t) => console.log(`\n${t}`);

async function onboard(p, name, email, roleLabel) {
  await p.goto(`${BASE}/signup`);
  if (roleLabel) await p.click(`.role-option:has-text("${roleLabel}")`);
  await p.fill('#name', name);
  await p.fill('#email', email);
  await p.fill('#password', PW);
  await p.click('button:has-text("Create account")');
  await p.waitForURL('**/onboarding/profile', { timeout: 20000 });
  await p.fill('#slug', email.split('@')[0]);
  await p.click('button:has-text("Continue")');
  await p.waitForURL('**/onboarding/connect', { timeout: 20000 });
  await p.click('button:has-text("Skip for now")');
  await p.waitForURL(/onboarding\/meeting-type|workspace|today/, { timeout: 20000 });
  if (p.url().includes('meeting-type')) {
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 20000 });
  }
}

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL || '',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let browser = null;
  try {
    const deadline = Date.now() + 30000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await onboard(page, 'Adaeze Okonkwo', `boss${ID}@x.com`, 'Principal');

    head('It is there wherever you are:');
    for (const [path, where] of [
      ['/today', 'the day'], ['/itinerary', 'the itinerary'], ['/trips', 'trips'],
      ['/spaces', 'spaces'], ['/tasks', 'tasks'], ['/dashboard', 'the dashboard'],
      ['/connections', 'connections'], ['/notices', 'notices'],
    ]) {
      await page.goto(`${BASE}${path}`);
      await page.waitForSelector('.pad-dock-btn', { timeout: 20000 });
      ok(`on ${where}`, true);
    }

    head('And nowhere it has no business being:');
    // The pad's own screen already has a composer at the top of it.
    await page.goto(`${BASE}/pad`);
    await page.waitForSelector('.pad-write', { timeout: 20000 });
    ok('not on the pad itself, which already has one',
      (await page.locator('.pad-dock-btn').count()) === 0);
    // These render no AppShell, so the dock cannot reach them — asserted
    // because "it is scoped by where it is mounted" is only true until
    // somebody mounts it somewhere else.
    const anon = await (await browser.newContext()).newPage();
    for (const [path, where] of [['/login', 'the sign-in page'], ['/signup', 'signing up']]) {
      await anon.goto(`${BASE}${path}`);
      await anon.waitForSelector('#password', { timeout: 20000 });
      ok(`not on ${where}`, (await anon.locator('.pad-dock-btn').count()) === 0);
    }

    head('Writing from it never leaves the page you are on:');
    await page.goto(`${BASE}/today`);
    await page.waitForSelector('.pad-dock-btn', { timeout: 20000 });
    await page.click('.pad-dock-btn');
    await page.waitForSelector('.pad-dock-open textarea', { timeout: 20000 });
    // The promise is that you can start typing at once.
    ok('the box takes the caret on its own',
      await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'));
    await page.fill('.pad-dock-open textarea', 'Ask the bank about the mandate.');
    await page.click('.pad-dock-open button:has-text("Note it")');
    await page.waitForSelector('.pad-dock-btn.is-saved', { timeout: 20000 });
    ok('it says the line was kept', true);
    ok('and you are still on the day you were reading',
      new URL(page.url()).pathname === '/today', page.url());

    await page.goto(`${BASE}/pad`);
    await page.waitForSelector('.pad-line', { timeout: 20000 });
    ok('the line is on the pad',
      /mandate/.test(await page.locator('.pad-line').first().innerText()));

    head('A line written on an appointment remembers which one:');
    // Set up something to look at.
    const boss = { cookie: '' };
    await page.goto(`${BASE}/dashboard?tab=availability`);
    await page.evaluate(async () => {
      await fetch('/api/availability', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
        }),
        credentials: 'include',
      });
    });
    const made = await page.evaluate(async (slug) => {
      const mt = await (await fetch('/api/meeting-types', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Board', durationMinutes: 30, locationType: 'video', accessTier: 1 }),
        credentials: 'include',
      })).json();
      const slots = await (await fetch(`/api/public/${slug}/${mt.meetingType.slug}/slots`)).json();
      await fetch(`/api/public/${slug}/${mt.meetingType.slug}/book`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          timezone: 'UTC', startAt: slots.slots[0].startAt, name: 'Chidi Eze', email: 'chidi@x.com',
        }),
      });
      const mine = await (await fetch('/api/bookings', { credentials: 'include' })).json();
      const me = await (await fetch('/api/auth/me', { credentials: 'include' })).json();
      return { bookingId: mine.bookings[0].id, ownerId: me.user.id };
    }, `boss${ID}`);
    void boss;

    await page.goto(`${BASE}/appointments/${made.ownerId}/${made.bookingId}`);
    await page.waitForSelector('.pad-dock-btn', { timeout: 20000 });
    await page.click('.pad-dock-btn');
    await page.waitForSelector('.pad-dock-open textarea', { timeout: 20000 });
    const said = await page.locator('.pad-dock-open').innerText();
    ok('and says so before you write it', /Kept against the appointment/.test(said), said.slice(0, 160));
    await page.fill('.pad-dock-open textarea', 'Chase them for the draft.');
    await page.click('.pad-dock-open button:has-text("Note it")');
    await page.waitForSelector('.pad-dock-btn.is-saved', { timeout: 20000 });
    const attached = await page.evaluate(async (b) => {
      const d = await (await fetch(`/api/pad?aboutKind=booking&aboutId=${b}`, { credentials: 'include' })).json();
      return (d.items || []).length;
    }, made.bookingId);
    ok('and the line is filed against that appointment', attached === 1, String(attached));

    head('THE OBSTRUCTION QUESTION, measured rather than assumed:');
    // A full list, so there is something at the very bottom to be covered.
    await page.goto(`${BASE}/pad`);
    await page.waitForSelector('.pad-write textarea', { timeout: 20000 });
    for (let i = 0; i < 8; i++) {
      await page.fill('.pad-write textarea', `Line number ${i} on the pad.`);
      await page.click('.pad-write button:has-text("Jot it")');
      await page.waitForSelector(`.pad-line:has-text("number ${i}")`, { timeout: 20000 });
    }

    for (const [w, h, label] of [[1280, 900, 'a desktop'], [390, 844, 'a phone']]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${BASE}/today`);
      await page.waitForSelector('.pad-dock-btn', { timeout: 20000 });
      // Scroll to the very end, which is where a fixed corner button does its
      // damage: the last row is the one that ends up underneath it.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(400);
      const clear = await page.evaluate(() => {
        const dock = document.querySelector('.pad-dock-btn').getBoundingClientRect();
        const body = document.querySelector('.app-body').getBoundingClientRect();
        // Content ends above where the dock begins. This is the padding on
        // .app-body doing its job; without it the last row sits under the
        // button and cannot be read or tapped.
        return body.bottom <= dock.top;
      });
      ok(`on ${label}, the page's content ends above the dock`, clear);

      const onScreen = await page.evaluate(() => {
        const r = document.querySelector('.pad-dock-btn').getBoundingClientRect();
        return r.right <= window.innerWidth && r.bottom <= window.innerHeight
          && r.left >= 0 && r.top >= 0;
      });
      ok(`and on ${label} it is fully on screen`, onScreen);
    }

    head('It gets out of the way while you read:');
    await page.setViewportSize({ width: 390, height: 844 });
    // The appointment page, not the pad — the pad renders no dock by design,
    // and a scroll test on a page without one proves nothing. Tall enough on a
    // phone to actually scroll, which the next line insists on rather than
    // assuming: a page that does not scroll would pass every assertion below
    // for the wrong reason.
    await page.goto(`${BASE}/appointments/${made.ownerId}/${made.bookingId}`);
    // Wait for the APPOINTMENT, not the dock. The dock comes from AppShell and
    // is in the DOM immediately; the booking arrives from a request afterwards.
    // Measuring on the dock meant measuring a page still showing "Loading…",
    // which is short — it passed alone and failed under a loaded board, which
    // is the signature of waiting on the wrong element.
    await page.waitForSelector('.trail-line', { timeout: 20000 });
    await page.waitForSelector('.pad-dock-btn', { timeout: 20000 });
    const tall = await page.evaluate(() => document.body.scrollHeight > window.innerHeight + 300);
    ok('the page is long enough for scrolling to mean something', tall);
    // The label goes on the way down; the control itself never does, so a
    // thumb already reaching for it does not find nothing.
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(400);
    ok('scrolling down shrinks it to a dot',
      (await page.locator('.pad-dock-btn.is-shrunk').count()) === 1);
    ok('but it is still there to be tapped',
      await page.locator('.pad-dock-btn').isVisible());
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    ok('and coming back up restores the label',
      (await page.locator('.pad-dock-btn.is-shrunk').count()) === 0);

    head('And it closes the way anything floating should:');
    await page.click('.pad-dock-btn');
    await page.waitForSelector('.pad-dock-open', { timeout: 20000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pad-dock-open', { state: 'detached', timeout: 20000 });
    ok('Escape puts it away', true);

    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nThe pad is one tap away on every screen, and never on top of anything.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
