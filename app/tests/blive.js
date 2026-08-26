// Knowing a message has landed, without being told to go and look.
//
// The rail's counts used to be fetched only on navigation, on the reasoning
// that "a rail that quietly renumbers itself while somebody is reading it is a
// rail that makes them look twice". The reasoning was right; the remedy was
// not. Somebody sitting on Today while their assistant sends three messages
// should not have to click something unrelated to discover them.
//
// So it asks again while somebody is looking, and an arrival is ANNOUNCED
// rather than sneaked in: the count changes and the badge marks itself as new
// until the screen it refers to is opened. Silence was never the point; not
// being startled was.
//
// The second half is the conversation itself. A message arriving must appear —
// and must not yank a reader who has scrolled back through last Tuesday down
// to the bottom because a colleague said "ok".
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

function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const t = await r.text();
    let d = null;
    try { d = t ? JSON.parse(t) : null; } catch { d = t; }
    return { s: r.status, d };
  };
}

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

    // A principal and an assistant, so there is somebody to be talked to.
    const boss = client();
    await boss('POST', '/auth/signup', { name: 'Adaeze Okonkwo', email: `boss${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const me = (await boss('GET', '/auth/me')).d.user;
    await boss('PATCH', '/profile', { slug: `adaeze-${ID}`, timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const page = await (await browser.newContext()).newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await onboard(page, 'Kit Staff', `kit${ID}@x.com`, 'Personal Assistant');

    const inv = await boss('POST', '/members', { email: `kit${ID}@x.com`, role: 'chief_of_staff' });
    await page.goto(`${BASE}/accept-invite/${inv.d.inviteLink.split('/').pop()}`);
    await page.click('button:has-text("Accept")');
    await page.waitForSelector('h1:has-text("You\'re in")', { timeout: 20000 });

    // The team's room, which both of them are in.
    const line = (await boss('GET', `/today/${me.id}`)).d.directLine;
    ok('the team has a room to talk in', !!line, JSON.stringify(line || null));

    head('A message lands while you are reading the conversation:');
    await page.goto(`${BASE}/threads/${line.threadId}`);
    await page.waitForSelector('.composer, textarea', { timeout: 20000 });
    const before = await page.locator('.msg-note').count();

    // Sent by the other person, from outside the browser entirely — nothing
    // in this tab knows it happened.
    await boss('POST', `/threads/${line.threadId}/messages`, { body: 'Car is outside.' });

    // No reload, no click. The poll is 12s; allow it two turns.
    await page.waitForSelector('text=Car is outside.', { timeout: 30000 });
    ok('it appears on its own, with nothing clicked', true);
    const after = await page.locator('.msg-note').count();
    ok('and the conversation actually grew', after === before + 1, `${before} -> ${after}`);

    head('And the rail says something arrived, rather than only renumbering:');
    // Somewhere with no conversation on screen, so the rail is the only teller.
    await page.goto(`${BASE}/today`);
    await page.waitForSelector('.nav-item', { timeout: 20000 });
    await boss('POST', `/threads/${line.threadId}/messages`, { body: 'And the driver has the bags.' });
    // The badge marks itself as new — a count alone cannot say "this is new",
    // since three read and three unread look identical.
    await page.waitForSelector('.nav-badge.is-new', { timeout: 40000 });
    ok('the badge marks itself as new', true);
    const marked = await page.locator('.nav-item:has(.nav-badge.is-new)').innerText();
    ok('on the entry it is actually about', /Spaces/i.test(marked), marked);

    head('And looking at it clears the mark:');
    await page.click('.nav-item:has-text("Spaces")');
    await page.waitForURL('**/spaces', { timeout: 20000 });
    await page.waitForSelector('.nav-badge.is-new', { state: 'detached', timeout: 20000 });
    ok('the mark goes when the screen is opened', true);

    head('A phone in a pocket asks nothing:');
    // The whole reason this is safe to poll at all. Emulating the hidden state
    // is the only way to assert it — a timer that keeps running off-screen is
    // invisible until somebody notices their battery.
    await page.goto(`${BASE}/today`);
    await page.waitForSelector('.nav-item', { timeout: 20000 });
    await page.evaluate(() => {
      window.__calls = 0;
      const real = window.fetch;
      window.fetch = (...args) => {
        if (String(args[0]).includes('/api/attention')) window.__calls += 1;
        return real(...args);
      };
    });
    // LET THE PAGE FINISH ARRIVING FIRST, and count from the moment it is
    // hidden rather than from the moment the spy went in.
    //
    // Arriving at a screen asks /attention once, and that request is decided on
    // while the tab is still visible — it is not the poll, and there is nothing
    // to cancel about it. On an idle machine it has gone out long before this
    // point; on one running a full board it can be issued a second later, land
    // after the tab is hidden, and be counted as a poll that never happened.
    // This passed alone and failed on the board, three times, while the timer
    // was behaving perfectly.
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      window.__calls = 0;
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(3000);
    const whileHidden = await page.evaluate(() => window.__calls);
    ok('nothing is asked while the tab is hidden', whileHidden === 0, String(whileHidden));

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(1500);
    const onReturn = await page.evaluate(() => window.__calls);
    // The moment somebody comes back is when the screen is most likely stale,
    // so returning asks at once rather than waiting out the interval.
    ok('and coming back asks straight away, without waiting for the interval',
      onReturn >= 1, String(onReturn));

    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA message arriving shows itself, the rail says it is new, and a screen nobody is looking at asks for nothing.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
