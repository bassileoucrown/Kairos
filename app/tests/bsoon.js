// A feature that is here by name, and not yet by function.
//
// The version this replaces put a list at the foot of each screen. That is a
// footnote, and a footnote is not the same as seeing the feature: it tells
// somebody a thing is planned without showing them where it will live or what
// it will be called. So every unbuilt capability now stands in the place the
// working one will occupy, named the way it will be named, and visibly inert —
// and there is one screen listing all of them for whoever is being shown the
// product rather than using it.
//
// Three things worth proving. The placeholder is present and NAMED where the
// real thing will be. Pressing it explains rather than swallowing the click,
// because a control that only greys out is indistinguishable from a bug. And
// it removes itself the moment the thing behind it works — proved by booting
// the same client build against a configured server.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4553, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function boot(port, env = {}) {
  return spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(port),
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ...env,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
async function ready(base) {
  for (;;) {
    try { if ((await (await fetch(`${base}/api/status`)).json()).databaseReady) break; }
    catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }
}

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  }
  const bare = boot(PORT);
  let wired = null;
  let b = null;
  try {
    await ready(BASE);
    b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const errs = [];
    const p = await (await b.newContext()).newPage();
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

    // ---- One screen listing everything, for whoever is being shown it ---
    head('The roadmap is inside the product:');
    ok('the rail carries it', (await p.locator('.app-nav a:has-text("Coming")').count()) === 1);
    await p.click('.app-nav a:has-text("Coming")');
    await p.waitForSelector('.coming-row', { timeout: 15000 });
    const coming = await p.locator('.app-body').innerText();
    ok('every unbuilt thing is named',
      /Travel time/i.test(coming) && /flight status/i.test(coming)
      && /visa is required/i.test(coming) && /Attach a scan|document/i.test(coming)
      && /Transcribe|transcri/i.test(coming) && /concierge/i.test(coming),
      coming.slice(0, 400));
    ok('and each says which screen it will appear on',
      /Appears on/i.test(coming));
    ok('naming the control it will be, so it can be pointed at',
      /as .?Check requirement|as .?Travel time/i.test(coming), coming.slice(0, 300));
    ok('the ones waiting on a credential name it',
      /MAPS_API_KEY|FLIGHT_DATA_KEY/.test(coming), coming.slice(0, 400));

    // ---- In situ, where the working thing will be -----------------------
    head('On Trips, beside the question it answers:');
    await p.goto(`${BASE}/trips`);
    await p.click('button:has-text("Plan a trip")');
    await p.waitForSelector('#trip-name', { timeout: 15000 });
    await p.fill('#trip-name', 'London');
    await p.fill('#trip-dest', 'United Kingdom');
    await p.fill('#trip-from', '2027-03-04');
    await p.fill('#trip-to', '2027-03-10');
    await p.click('.trip-form button:has-text("Create")');
    await p.waitForSelector('.soon-control', { timeout: 15000 });

    const check = p.locator('.btn.is-soon:has-text("Check requirement")');
    ok('the visa requirement stands next to the visa answer',
      (await check.count()) === 1);
    ok('marked, so nobody presses it expecting a result',
      /soon/i.test(await check.innerText()), await check.innerText());
    ok('and forwarding a confirmation is there too',
      (await p.locator('.btn.is-soon:has-text("Forward a confirmation")').count()) === 1);

    head('Pressing one answers rather than swallowing the click:');
    ok('nothing is explained before it is asked', (await p.locator('.soon-why').count()) === 0);
    await check.click();
    await p.waitForSelector('.soon-why', { timeout: 10000 });
    const why = await p.locator('.soon-why').innerText();
    ok('it says the feature is not available yet', /not available yet/i.test(why), why);
    ok('and what it would do, so the name is not the only clue',
      /nationality|required/i.test(why), why);
    await check.click();
    ok('and it closes again', (await p.locator('.soon-why').count()) === 0);

    head('The vault:');
    await p.goto(`${BASE}/dashboard?tab=essentials`);
    await p.waitForSelector('.btn.is-soon', { timeout: 15000 });
    ok('offers attaching a scan, by name',
      (await p.locator('.btn.is-soon:has-text("Attach a scan")').count()) === 1);

    head('Concierge:');
    await p.goto(`${BASE}/concierge`);
    await p.waitForSelector('.soon-banner', { timeout: 15000 });
    ok('carries the request control the desk will use',
      (await p.locator('.btn.is-soon:has-text("Make a request")').count()) === 1);

    head('Nothing is left saying it twice:');
    await p.goto(`${BASE}/trips`);
    await p.click('.trip-row');
    await p.waitForSelector('.trip-detail', { timeout: 15000 });
    ok('the old foot-of-page list is gone',
      (await p.locator('.notyet-panel').count()) === 0);

    // ---- The claim that matters ---------------------------------------
    head('With MAPS_API_KEY set, on the same client build:');
    wired = boot(PORT + 1, { MAPS_API_KEY: 'test-key', MAPS_BASE_URL: 'http://127.0.0.1:9/none' });
    const W = `http://127.0.0.1:${PORT + 1}`;
    await ready(W);
    const q = await (await b.newContext()).newPage();
    q.on('pageerror', (e) => errs.push('wired: ' + e.message));
    await q.goto(`${W}/login`);
    await q.fill('#email', `ada${ID}@x.com`);
    await q.fill('#password', PW);
    await q.click('button:has-text("Log in")');
    await q.waitForURL('**/today', { timeout: 20000 });
    await q.goto(`${W}/coming`);
    await q.waitForSelector('.coming-row', { timeout: 15000 });
    await q.waitForFunction(
      () => /working on this deployment/i.test(document.querySelector('.app-body')?.textContent || ''),
      null, { timeout: 15000 },
    );
    ok('travel time moves to the working list on its own', true);
    const still = await q.locator('.app-body').innerText();
    ok('and the others are still listed as coming',
      /visa is required/i.test(still));

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (b) await b.close();
    if (wired) wired.kill();
    bare.kill();
  }
  console.log(fails === 0
    ? '\nEvery unbuilt feature is visible, named, inert, and removes itself when it works.'
    : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
