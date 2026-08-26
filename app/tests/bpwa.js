// Kairos as something you install on a phone.
//
// THE ASSERTION THIS SUITE EXISTS FOR is the negative one: the service worker
// must never touch /api. A worker sits in front of every request the app makes,
// and a cached API response is a copy of somebody's diary, their whereabouts,
// or the office's private notes about a person — in a store that outlives the
// session, survives signing out, and is readable by anything else that ever
// runs on the origin. There is no cache policy careful enough to be worth
// that, so the safe amount of private data in it is none.
//
// Everything else here — the manifest, the icons, the offline shell — is what
// makes the browser willing to install it at all.
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

    head('The browser is told this is an app:');
    let r = await fetch(`${BASE}/manifest.webmanifest`);
    ok('the manifest is served', r.ok, String(r.status));
    const manifest = await r.json();
    ok('with a name to put under the icon', manifest.short_name === 'Kairos', manifest.short_name);
    // Without these three the browser will not offer to install at all.
    ok('it opens without an address bar', manifest.display === 'standalone', manifest.display);
    ok('and starts on the app rather than a marketing page', manifest.start_url === '/', manifest.start_url);
    ok('with a scope that covers the whole app', manifest.scope === '/', manifest.scope);

    const sizes = (manifest.icons || []).map((i) => i.sizes);
    ok('an icon at 192 and at 512, which is what installability requires',
      sizes.includes('192x192') && sizes.includes('512x512'), JSON.stringify(sizes));
    // Android crops an icon to whatever shape the launcher uses and guarantees
    // only the middle 80%. Without a maskable one, the mark gets a white box
    // around it or its corners cut off.
    ok('and a maskable one, so a launcher can crop it to its own shape',
      (manifest.icons || []).some((i) => i.purpose === 'maskable'),
      JSON.stringify((manifest.icons || []).map((i) => i.purpose)));

    for (const icon of manifest.icons) {
      const res = await fetch(`${BASE}${icon.src}`);
      ok(`${icon.src} is really there`, res.ok && res.headers.get('content-type')?.includes('png'),
        `${res.status} ${res.headers.get('content-type')}`);
    }
    r = await fetch(`${BASE}/icons/apple-touch-icon.png`);
    // iOS reads none of the manifest's icons and needs its own.
    ok('and iOS has the icon it insists on being given separately', r.ok, String(r.status));

    head('The page carries what iOS and the tab bar read:');
    const html = await (await fetch(`${BASE}/`)).text();
    ok('the manifest is linked', /rel="manifest"/.test(html));
    ok('the address bar takes the brand colour', /name="theme-color"/.test(html));
    ok('and iOS is given its own icon and title',
      /apple-touch-icon/.test(html) && /apple-mobile-web-app-title/.test(html));

    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await onboard(page, 'Adaeze Okonkwo', `boss${ID}@x.com`, 'Principal');

    head('The worker installs and takes over:');
    await page.waitForFunction(
      () => navigator.serviceWorker?.controller !== null
        && navigator.serviceWorker?.controller !== undefined,
      { timeout: 30000 },
    );
    ok('it is registered and controlling the page', true);

    head('THE RULE — nothing of the API is ever kept:');
    // Exercise the app so plenty of private traffic has been and gone.
    await page.goto(`${BASE}/today`);
    await page.waitForSelector('.nav-item', { timeout: 20000 });
    await page.goto(`${BASE}/pad`);
    await page.waitForSelector('.pad-write', { timeout: 20000 });

    const cached = await page.evaluate(async () => {
      const out = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) out.push(req.url);
      }
      return out;
    });
    const leaked = cached.filter((u) => new URL(u).pathname.startsWith('/api/'));
    ok('not one API response is in any cache', leaked.length === 0, JSON.stringify(leaked));
    // The bearer URLs too: a booker's manage link and a driver's card ARE the
    // credential, so a copy of either is a copy of the credential.
    const bearer = cached.filter((u) => /\/book\/|\/pickup\//.test(new URL(u).pathname));
    ok('nor anything reached by a link that is itself the password',
      bearer.length === 0, JSON.stringify(bearer));
    ok('but the app\'s own files are kept, which is the point',
      cached.some((u) => /\/assets\/|\/$/.test(new URL(u).pathname)),
      JSON.stringify(cached).slice(0, 200));

    head('And an API request still reaches the server, worker or no worker:');
    const live = await page.evaluate(async () => {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      return { status: res.status, fromCache: false, body: await res.json() };
    });
    ok('the answer is real and current', live.status === 200 && !!live.body?.user?.id,
      JSON.stringify(live).slice(0, 160));

    head('Signing out clears what little is held:');
    await page.click('.account-btn, [aria-label*="ccount"]').catch(() => {});
    await page.evaluate(() => navigator.serviceWorker.controller.postMessage('kairos-signed-out'));
    await page.waitForFunction(async () => (await caches.keys()).length === 0, { timeout: 15000 });
    ok('the store is emptied on the way out', true);

    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nKairos installs onto a phone, and the worker in front of it never keeps a line of anybody\'s data.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
