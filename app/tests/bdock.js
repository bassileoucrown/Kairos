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
    // A minute. Twenty seconds is plenty on an idle machine and not plenty on a
    // loaded one, and "no server" on a green tree is a board crying wolf.
    const deadline = Date.now() + 60000;
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
    // A FULL DAY, because an empty one cannot be covered by anything.
    //
    // This used to fill the PAD with eight lines and then measure /today —
    // two different screens. /today on a fresh account says "Nothing waiting
    // on you. Genuinely." and stops, so the check asked whether a fixed
    // button covers the last row of a page with no rows. It could only
    // answer yes, and it did: cutting .app-body's bottom padding to 8px left
    // it green, because a page too short to scroll clears everything by
    // default. A check that survives the deletion of the thing it checks is
    // not a check.
    //
    // A busy day is also the case that matters. Nobody is hurt by a button
    // floating over an empty afternoon; the principal with fourteen things
    // in the diary is the one who cannot read the last of them.
    const filled = await page.evaluate(async () => {
      const me = await (await fetch('/api/auth/me', { credentials: 'include' })).json();
      const id = me.user?.id || me.id;
      const start = new Date(); start.setHours(6, 0, 0, 0);
      let made = 0;
      for (let i = 0; i < 14; i++) {
        const r = await fetch(`/api/itinerary/${id}/items`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            title: `Standing item number ${i}`,
            kind: 'meeting',
            startAt: new Date(start.getTime() + i * 30 * 60000).toISOString(),
            status: 'confirmed',
          }),
        });
        if (r.ok) made++;
      }
      return made;
    });
    ok('the day has enough in it to be worth covering', filled === 14, String(filled));

    for (const [w, h, label] of [[1280, 900, 'a desktop'], [390, 844, 'a phone']]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${BASE}/today`);
      await page.waitForSelector('.pad-dock-btn', { timeout: 20000 });
      // AND WAIT FOR THE PAGE, WHICH IS NOT THE SAME THING. The dock lives in
      // AppShell, and so does "Loading…" — so the selector above clears while
      // the page is still empty. Measuring there measures a short page that
      // never scrolls: it passes for the wrong reason on a slow run and
      // disagrees with the next run.
      await page.waitForSelector('.sched-row', { timeout: 20000 });
      await page.waitForFunction(() => {
        const h = document.querySelector('.app-body .hint');
        return !(h && /Loading/.test(h.textContent || ''));
      }, null, { timeout: 20000 });
      // SCROLL THE LAST ROW INTO VIEW AND ASK WHETHER IT IS COVERED.
      //
      // This used to scroll the window to document.body.scrollHeight and
      // measure from there, which quietly assumed the window is the scroller.
      // It is not always — and when the assumption failed, the "last row" was
      // still hundreds of pixels below the fold, so the check compared the
      // dock against something nobody was looking at and reported a layout
      // fault that did not exist.
      //
      // The real question does not need that assumption: take the lowest
      // thing a person has to read or tap, bring it into view the way the
      // person would, and see whether the button is sitting on it.
      const clear = await page.evaluate(async () => {
        const body = document.querySelector('.app-body');
        let last = null;
        for (const el of body.querySelectorAll('*')) {
          if (el.children.length > 0) continue;
          const cs = getComputedStyle(el);
          if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const speaks = (el.textContent || '').trim() || ['INPUT', 'TEXTAREA', 'IMG'].includes(el.tagName);
          if (!speaks) continue;
          if (!last || r.bottom > last.getBoundingClientRect().bottom) last = el;
        }
        if (!last) return { clear: true, why: 'nothing on the page to cover' };

        // SCROLL TO THE END, THE WAY A READER DOES.
        //
        // Not scrollIntoView({block:'end'}): that aligns the element flush
        // with the VIEWPORT edge, which is the one place it must never be
        // measured. On a phone it dragged the last line down until it sat
        // under the dock and then reported the dock as covering it; on a
        // desktop it did not scroll at all, because the element was already
        // visible, and reported the unscrolled page. Wrong in both
        // directions, from the same mistake.
        //
        // The clearance this check exists to verify IS .app-body's bottom
        // padding, and padding only shows itself at the END OF THE SCROLL
        // RANGE. So go there — every scrollable ancestor of the last row,
        // rather than assuming which element scrolls, since assuming the
        // window was the scroller is what broke the previous version.
        for (let el = last; el; el = el.parentElement) {
          if (el.scrollHeight - el.clientHeight > 4) el.scrollTop = el.scrollHeight;
        }

        // AND THEN WAIT FOR THE DOCK TO STOP MOVING.
        //
        // The dock is anchored to `bottom` and shrinks by reducing its
        // padding over 0.16s, so its TOP EDGE TRAVELS DOWNWARD while it
        // shrinks — and the shrink is driven by a scroll handler, so it can
        // begin well after the scroll lands. A fixed delay therefore lands
        // inside the animation on some runs and after it on others, and
        // inside it the dock is taller and the threshold stricter than
        // anything a reader ever sees. That is a test that disagrees with
        // itself, which is worth less than no test at all.
        //
        // So wait for the rectangle to stop changing rather than guessing how
        // long it takes. Bounded, so a dock that somehow never settles fails
        // as a timeout rather than hanging the suite.
        const rect = () => document.querySelector('.pad-dock-btn').getBoundingClientRect();
        const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        let seen = null;
        let stable = 0;
        for (let i = 0; i < 120 && stable < 3; i++) {
          await frame();
          const r = rect();
          const key = `${Math.round(r.top)}:${Math.round(r.left)}:${Math.round(r.height)}`;
          stable = key === seen ? stable + 1 : 0;
          seen = key;
        }

        const dock = rect();
        const bottom = last.getBoundingClientRect().bottom;
        // Reported either way, so a red result says what it measured instead
        // of only saying "false" — which is what this check did the first
        // time it went red, and it cost an afternoon.
        return {
          clear: bottom <= dock.top,
          settled: stable >= 3,
          bottom: Math.round(bottom),
          dockTop: Math.round(dock.top),
          on: `${last.tagName.toLowerCase()}.${last.className || '(none)'}`,
          text: (last.textContent || '').trim().slice(0, 40),
        };
      });
      ok(`on ${label}, the page's content ends above the dock`, clear.clear,
        `${clear.text ? `"${clear.text}" (${clear.on})` : ''} ends at ${clear.bottom}, `
        + `dock starts at ${clear.dockTop}${clear.settled === false ? ', dock never settled' : ''}`);

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
    // LET THE PAGE STOP GROWING BEFORE SCROLLING IT. The dock shrinks on
    // downward movement and restores on upward, and it reads direction from
    // consecutive scrollY values — so a page still laying itself out is a trap.
    // Content arriving after the scroll changes the document height, the
    // browser corrects the position, and that correction is an UPWARD movement
    // which restores the label a moment after the test asked for it to be
    // gone. It passed alone every time and failed on a loaded board, which is
    // the tell: not a flaky product, a measurement taken mid-layout.
    await page.waitForFunction(() => {
      const h = document.body.scrollHeight;
      if (window.__lastH === h) return true;
      window.__lastH = h;
      return false;
    }, null, { timeout: 20000, polling: 250 });
    const tall = await page.evaluate(() => document.body.scrollHeight > window.innerHeight + 300);
    ok('the page is long enough for scrolling to mean something', tall);
    // The label goes on the way down; the control itself never does, so a
    // thumb already reaching for it does not find nothing.
    await page.evaluate(() => window.scrollTo(0, 600));
    // Waited for rather than slept on, and the position is confirmed as well
    // as the class: a scroll that silently clamped short would otherwise look
    // exactly like a dock that refused to shrink.
    await page.waitForFunction(() => window.scrollY > 120, null, { timeout: 10000 });
    await page.locator('.pad-dock-btn.is-shrunk')
      .waitFor({ timeout: 10000 }).catch(() => {});
    ok('scrolling down shrinks it to a dot',
      (await page.locator('.pad-dock-btn.is-shrunk').count()) === 1,
      `scrollY ${await page.evaluate(() => window.scrollY)}`);
    ok('but it is still there to be tapped',
      await page.locator('.pad-dock-btn').isVisible());
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.pad-dock-btn.is-shrunk')
      .waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
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
