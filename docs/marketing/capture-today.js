// The real Today screen, on a real phone viewport, with a real day in it.
//
// The poster's phone held a drawing. A drawing is honest enough as an
// illustration, but the owner asked for the product, and the product is
// better than the drawing in the one way that matters: it is true.
//
// Seeds a day that reads like a principal's — a board meeting running now, a
// lunch with a leave-time, a call, a review, family time, a flight — then
// collapses the "What Today does" guide panel, because that panel is a
// first-run explainer and nobody's fourth day looks like that.
const ROOT = '/home/user/Kairos';
const OUT = '/tmp/claude-0/-home-user-Kairos/7e78184d-9ae0-58d8-94a0-bd5eb2bf040e/scratchpad';
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = 4821, BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36), PW = 'password123';

// Tall enough to hold the whole day without scrolling, narrow enough to be a
// phone. Cropped to the frame's aspect after capture.
const VW = 390, VH = 880;

async function ready() {
  for (let i = 0; i < 300; i += 1) {
    try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) return; }
    catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server never came up');
}

(async () => {
  const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  }
  const srv = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      ENCRYPTION_KEY: '0'.repeat(64) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let b = null;
  try {
    await ready();
    b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const ctx = await b.newContext({
      viewport: { width: VW, height: VH }, deviceScaleFactor: 3,
      isMobile: true, hasTouch: true,
    });
    const p = await ctx.newPage();

    // ---- an account -------------------------------------------------
    await p.goto(`${BASE}/signup`);
    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Bassileou Crown');
    await p.fill('#email', `b${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 25000 });
    await p.fill('#slug', `b${ID}`);
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/connect', { timeout: 25000 });
    await p.click('button:has-text("Skip for now")');
    await p.waitForURL('**/onboarding/meeting-type', { timeout: 25000 });
    await p.fill('#mt-name', 'Intro call');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 25000 });

    const me = await p.evaluate(async () =>
      (await (await fetch('/api/auth/me', { credentials: 'include' })).json()));
    const owner = me.user.id;

    // ---- a day worth photographing ----------------------------------
    // Anchored around "now" so the NOW band is populated: a screenshot of an
    // empty day would be a screenshot of nothing.
    const now = new Date();
    const at = (h, m = 0) => {
      const d = new Date(now);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    // A full working day, 08:00 to 20:00, so the picture shows a day rather
    // than whatever two hours happen to surround the moment of capture.
    const base = 8;

    const items = [
      { kind: 'meeting', title: 'Strategy meeting', startAt: at(base), endAt: at(base + 1),
        location: 'Board room · Exousia' },
      { kind: 'call', title: 'Client call', startAt: at(base + 2), endAt: at(base + 3),
        location: 'Video' },
      { kind: 'meal', title: 'Lunch — Mrs Bello', startAt: at(base + 4), endAt: at(base + 5),
        location: 'The Sky Lounge, Ikoyi' },
      { kind: 'meeting', title: 'Project review', startAt: at(base + 6), endAt: at(base + 7),
        location: 'Office' },
      { kind: 'personal', title: 'Family time', startAt: at(base + 8), endAt: at(base + 9),
        location: 'Home' },
      { kind: 'flight', title: 'Flight to Abuja', startAt: at(base + 12), endAt: at(base + 13, 30),
        location: 'Lagos (LOS)', destination: 'Abuja (ABV)' },
    ];
    for (const it of items) {
      await p.evaluate(async ([o, body]) => {
        await fetch(`/api/itinerary/${o}/items`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }, [owner, it]);
    }

    await p.goto(`${BASE}/today`);
    await p.waitForTimeout(1400);

    // The guide panel is a first-run explainer, not the product. Collapse it
    // the way a person would, rather than hiding it with injected CSS —
    // injected CSS would make this a picture of a page that cannot exist.
    // .what-this-toggle, from components/WhatThisDoes.jsx. The first version
    // of this guessed at three class names, hit none of them, and then
    // "verified" the result against a fourth that does not exist either — so
    // it reported the panel collapsed while it filled two thirds of the shot.
    // The panel folds itself once it has been seen — that is the component's
    // own behaviour (WhatThisDoes.jsx: open the first time, folded
    // afterwards), so a second visit is the natural way to reach the state
    // every returning user sees. Clicking the toggle was the first attempt and
    // did not take; reloading is both simpler and truer to real use.
    await p.reload();
    await p.waitForSelector('.sched-row', { timeout: 20000 });
    await p.waitForTimeout(900);
    const collapse = p.locator('.what-this-toggle').first();
    if (await p.locator('.what-this-does.is-open').count() && await collapse.count()) {
      await collapse.click({ timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(700);
    }
    const stillOpen = await p.locator('.what-this-does.is-open').count();
    if (stillOpen) throw new Error('the guide panel is still open — the shot would be of the explainer');
    await p.waitForTimeout(400);

    await p.screenshot({ path: `${OUT}/today-raw.png` });
    // Cropped just above the floating Tell-us / Note pills. They are real
    // controls and stay in the product, but half a pill at the cut line reads
    // as a rendering fault rather than as a button.
    await p.screenshot({ path: `${OUT}/today-phone.png`,
      clip: { x: 0, y: 0, width: VW, height: 765 } });
    const shot = await p.evaluate(() => ({
      title: document.querySelector('.app-header h1')?.textContent,
      rows: document.querySelectorAll('.sched-row').length,
      guideOpen: !!document.querySelector('.what-this-does.is-open'),
      now: document.querySelector('.next-up-title')?.textContent || null,
    }));
    console.log('captured:', JSON.stringify(shot));
    await ctx.close();
  } catch (err) {
    console.log('THREW: ' + (err.stack || err.message));
  } finally {
    if (b) await b.close();
    srv.kill();
  }
})();
