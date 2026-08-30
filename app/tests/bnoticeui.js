// The notices screen: writing one as the configured author, and reading it as
// somebody who is not.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4465, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const ADMIN = `boss${ID}@x.com`;
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

async function onboard(p, name, email, roleLabel) {
  await p.goto(`${BASE}/signup`);
  if (roleLabel) await p.click(`.role-option:has-text("${roleLabel}")`);
  await p.fill('#name', name);
  await p.fill('#email', email);
  await p.fill('#password', PW);
  await p.click('button:has-text("Create account")');
  await p.waitForURL('**/onboarding/profile', { timeout: 15000 });
  await p.fill('#slug', email.split('@')[0]);
  await p.click('button:has-text("Continue")');
  await p.waitForURL('**/onboarding/connect', { timeout: 15000 });
  await p.click('button:has-text("Skip for now")');
  await p.waitForURL(/onboarding\/meeting-type|workspace|today/, { timeout: 15000 });
  if (p.url().includes('meeting-type')) {
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 15000 });
  }
}

(async () => {
  // Starts from an empty database on purpose. Unique emails are enough to keep
  // most suites independent, but a notice is broadcast to everyone — one left
  // behind by an earlier run is delivered to this run's reader, and "an empty
  // channel explains what it is" can only be tested on an empty channel.
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  }

  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ANNOUNCEMENT_AUTHORS: ADMIN },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];
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
      let ready = false;
      try { ready = (await (await fetch(`${BASE}/api/status`)).json()).databaseReady; }
      catch { /* not up */ }
      if (ready) break;
      if (Date.now() > deadline) throw new Error('server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    const admin = await (await b.newContext()).newPage();
    admin.on('pageerror', (e) => errs.push('author: ' + e.message));
    await onboard(admin, 'Ada Boss', ADMIN, 'Principal');

    const reader = await (await b.newContext()).newPage();
    reader.on('pageerror', (e) => errs.push('reader: ' + e.message));
    await onboard(reader, 'Ben Reed', `ben${ID}@x.com`, 'Personal Assistant');

    // --- The reader sees an empty, honest channel ---
    await reader.goto(`${BASE}/notices`);
    await reader.waitForSelector('.empty-state', { timeout: 30000 });
    const emptyText = await reader.locator('.empty-state').innerText();
    ok('an empty channel explains what it is',
      /nobody else can post/i.test(emptyText) && /no discussion/i.test(emptyText), emptyText);
    ok('and an ordinary account is offered no composer',
      (await reader.locator('button:has-text("Write one")').count()) === 0);

    // --- The author writes one ---
    await admin.goto(`${BASE}/notices`);
    await admin.waitForSelector('button:has-text("Write one")', { timeout: 15000 });
    await admin.click('button:has-text("Write one")');
    await admin.fill('#ann-title', 'Handles are live');
    await admin.fill('#ann-body', 'You can now connect with assistants at other principals.');
    await admin.selectOption('#ann-audience', 'assistants');
    await admin.click('.ann-composer button:has-text("Publish")');
    await admin.waitForSelector('.ann-admin', { timeout: 15000 });
    ok('the author sees it published',
      /published/i.test(await admin.locator('.ann-admin').first().innerText()));

    // --- The reader gets it, with a badge ---
    await reader.goto(`${BASE}/today`);
    // Waited for the item this assertion is ABOUT, not for the first item to
    // appear. The rail paints in order, so waiting on '.nav-item' returns as
    // soon as "The day" exists and the text read a moment later was just that
    // — a race that only showed up on the slower Postgres board.
    // Waited for the BADGE, not for the link. The previous fix waited for the
    // Notices entry, which was closer but still one step short: the rail paints
    // from the route, and the counts arrive afterwards from /attention. So the
    // link exists a beat before any number does, and reading the nav in that
    // beat gets a rail with no badges in it — which on the slower Postgres
    // board is where this landed. Wait for the thing being asserted on.
    await reader.waitForSelector('.app-nav a:has-text("Notices") .nav-badge', { timeout: 15000 });
    const nav = await reader.locator('.app-nav nav').innerText();
    ok('the rail carries Notices with an unread badge',
      nav.includes('Notices') && /Notices\s*\n?1/.test(nav), nav);

    await reader.goto(`${BASE}/notices`);
    await reader.waitForSelector('.ann', { timeout: 15000 });
    const annText = await reader.locator('.ann').innerText();
    ok('the notice is there', annText.includes('Handles are live'), annText);
    ok('marked new on arrival', /new/i.test(annText));
    ok('and labelled with who it was for', /assistants only/i.test(annText), annText);

    // Opening the page is reading it.
    // Wait on the badge itself rather than a fixed pause — the count arrives
    // from a fetch, and a sleep long enough today is a flake tomorrow.
    await reader.goto(`${BASE}/today`);
    await reader.waitForSelector('.nav-item', { timeout: 15000 });
    let cleared = false;
    for (let i = 0; i < 40 && !cleared; i += 1) {
      cleared = (await reader.locator('.nav-item:has-text("Notices") .nav-badge').count()) === 0;
      if (!cleared) await reader.waitForTimeout(250);
    }
    ok('reading it clears the badge', cleared, await reader.locator('.app-nav nav').innerText());

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nThe notices screen works.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
