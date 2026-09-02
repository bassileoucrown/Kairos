// Every feature says what it does and how to use it, on itself.
//
// This replaced the pilot's single orientation note on Today, so the thing
// worth guarding is exactly the fault that note had: guidance that exists in
// one place and is silent everywhere else, or guidance that describes a
// product that has since moved.
//
// FOUR THINGS ARE WORTH WATCHING HARDEST:
//
//   NO SCREEN MAY ASK FOR GUIDANCE THAT DOES NOT EXIST. Every id the client
//   passes is checked against the register by reading the client source. A
//   screen that asks for a feature nobody wrote fails silently in a browser —
//   it renders nothing, looks exactly like a screen that was never wired, and
//   would sit there for months.
//
//   AND NOTHING IN THE REGISTER MAY BE UNREACHABLE. The other half of the same
//   drift: copy written for a screen that was renamed is copy nobody will ever
//   read, and it will still be sitting there being wrong.
//
//   THE "NOT WORKING YET" LINE IS COMPUTED, NOT TYPED. It is the one part of
//   this that can lie: guidance telling a tester to try something that is
//   switched off is worse than no guidance. Proved with a pair — one server
//   without the credential, one with — because an assertion that a notice is
//   absent passes just as happily when the join was never built.
//
//   AND IT MUST NOT BE ABLE TO BREAK THE SCREEN IT IS ON. An unknown id is a
//   200 with nothing in it, never a 404 the page has to handle.
const ROOT = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4657, BASE = `http://127.0.0.1:${PORT}`;
const KPORT = 4658, KBASE = `http://127.0.0.1:${KPORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function client(base) {
  let cookie = '';
  return async function call(method, p, body) {
    const r = await fetch(`${base}/api${p}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { s: r.status, d: json };
  };
}

function serve(port, extraEnv = {}) {
  return spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function waitFor(base) {
  for (;;) {
    try { if ((await (await fetch(`${base}/api/status`)).json()).databaseReady) return; }
    catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Every guide id the client actually asks for. Two shapes, because there are
// two ways a screen names its feature: a page names itself once through the
// shell, and a page with tabs names the tab, because on those screens the tab
// IS the feature.
function idsAskedForByTheClient() {
  const src = `${ROOT}/app/client/src`;
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.jsx')) files.push(full);
    }
  }(src));

  const found = new Set();
  const dynamic = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/guide="([a-z_]+)"/g)) found.add(m[1]);
    for (const m of text.matchAll(/<WhatThisDoes id=\{?"?([a-z_]+)"?\}?/g)) {
      if (/^[a-z_]+$/.test(m[1]) && !m[0].includes('{')) found.add(m[1]);
    }
    // A tab-driven screen names its feature with a variable, so the TABS list
    // that variable comes from is read instead. Read rather than skipped: the
    // desk and the account screen between them are seventeen of these.
    //
    // Keyed on `id={tab` specifically rather than on any variable. The shell
    // also passes one — `id={guide}` — and its own file happens to hold a list
    // of `{ id: ... }` objects for the five nav groups, which this would
    // otherwise collect as five features nobody ever wrote.
    if (/<WhatThisDoes id=\{tab/.test(text)) {
      for (const m of text.matchAll(/\{ id: '([a-z_]+)'/g)) dynamic.push([path.basename(f), m[1]]);
      for (const m of text.matchAll(/id=\{tab \|\| '([a-z_]+)'\}/g)) dynamic.push([path.basename(f), m[1]]);
    }
  }
  for (const [, id] of dynamic) found.add(id);
  return found;
}

(async () => {
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }

  const bare = serve(PORT);
  let keyed = null;

  let browser = null;
  try {
    await waitFor(BASE);
    // The paired control, started only once the first is up. Same code, one
    // credential different, so what the register says about travel time has to
    // change between them or the join is not a join at all.
    //
    // Second, never alongside: both processes point at one database, and two
    // of them running the migrations at the same moment is a locked file and a
    // failure a long way from its cause.
    keyed = serve(KPORT, { MAPS_API_KEY: `maps-${ID}` });
    await waitFor(KBASE);

    // ---- The register itself ---------------------------------------------
    head('Every feature says what it does and how, in a shape somebody will read:');
    const guide = require(`${ROOT}/app/server/lib/guide.js`);
    const all = guide.list();
    ok('there is a register, and it is not empty', all.length > 0, String(all.length));

    const badTitle = all.filter((f) => !f.title || f.title.length > 40);
    ok('every feature has a name', badTitle.length === 0, badTitle.map((f) => f.id).join(', '));

    // One sentence. A `does` that runs to a paragraph is the beginning of the
    // manual this was built to avoid.
    const badDoes = all.filter((f) => !f.does || f.does.length > 170 || !f.does.endsWith('.'));
    ok('every feature says what it does, in one sentence',
      badDoes.length === 0, badDoes.map((f) => f.id).join(', '));

    const badHow = all.filter((f) => !Array.isArray(f.how) || f.how.length < 1 || f.how.length > 4);
    ok('and says how to use it, in between one and four moves',
      badHow.length === 0, badHow.map((f) => `${f.id}:${f.how?.length}`).join(', '));

    const badStep = all.filter((f) => (f.how || []).some((s) => !s || s.length > 200));
    ok('and no step is a paragraph', badStep.length === 0, badStep.map((f) => f.id).join(', '));

    // ---- Nothing may drift ------------------------------------------------
    head('No screen can ask for guidance that is not there, and none can be orphaned:');
    const asked = idsAskedForByTheClient();
    ok('the client asks for guidance on many screens, not one', asked.size >= 30, String(asked.size));

    const registered = new Set(guide.IDS);
    const missing = [...asked].filter((id) => !registered.has(id)).sort();
    ok('every id a screen asks for is in the register', missing.length === 0, missing.join(', '));

    const orphan = [...registered].filter((id) => !asked.has(id)).sort();
    ok('and every entry in the register is reachable from a screen',
      orphan.length === 0, orphan.join(', '));

    // ---- The endpoint -----------------------------------------------------
    head('A screen can ask, and asking can never break the screen:');
    const anon = client(BASE);
    let r = await anon('GET', '/guide/today');
    ok('a stranger is refused', r.s === 401, String(r.s));

    const pa = client(BASE);
    await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });

    r = await pa('GET', '/guide/today');
    ok('a signed-in reader gets the feature', r.s === 200 && r.d.feature?.id === 'today',
      JSON.stringify(r.d).slice(0, 120));
    ok('with the sentence and the steps', !!r.d.feature.does && r.d.feature.how.length > 0);

    // The one that would otherwise be a 404 the page has to catch. A guidance
    // panel that can 500 a screen is worse than no guidance panel.
    r = await pa('GET', '/guide/no-such-feature');
    ok('an unknown feature is an empty answer, not an error',
      r.s === 200 && r.d.feature === null, `${r.s} ${JSON.stringify(r.d)}`);

    r = await pa('GET', '/guide');
    ok('and the whole register can be read at once',
      r.s === 200 && r.d.features.length === all.length, String(r.d.features?.length));

    // ---- The half that can lie --------------------------------------------
    head('What is not working here yet is computed, and the pair proves it:');
    r = await pa('GET', '/guide/itinerary');
    const bareNotYet = (r.d.feature.notYet || []).map((c) => c.id);
    ok('without the credential, the itinerary says travel time is not working',
      bareNotYet.includes('travel_time'), JSON.stringify(bareNotYet));

    // The same account, through the other server: both processes are pointed
    // at one database, so signing up again here would collide rather than
    // isolate anything. The credential is the only difference between them,
    // which is the entire point of the pair.
    const kpa = client(KBASE);
    r = await kpa('POST', '/auth/login', { email: `ngozi${ID}@x.com`, password: PW });
    ok('the pair share one database, so the same reader signs in to both', r.s === 200, String(r.s));
    r = await kpa('GET', '/guide/itinerary');
    const keyedNotYet = (r.d.feature.notYet || []).map((c) => c.id);
    ok('with it set, the same sentence is gone — so it was never typed there',
      !keyedNotYet.includes('travel_time'), JSON.stringify(keyedNotYet));

    // A feature with nothing behind it to be missing must not sprout a notice.
    r = await pa('GET', '/guide/pad');
    ok('a feature with no credential behind it says nothing about credentials',
      (r.d.feature.notYet || []).length === 0, JSON.stringify(r.d.feature.notYet));

    // ---- On the screen ----------------------------------------------------
    head('And it is on the screen, open the first time and folded after:');
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const ctx = await browser.newContext();
    const p = await ctx.newPage();

    await p.goto(`${BASE}/signup`);
    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Adaeze Okonkwo');
    await p.fill('#email', `ada${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 20000 });
    await p.fill('#slug', `ada${ID}`);
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/connect', { timeout: 20000 });
    await p.click('button:has-text("Skip for now")');
    await p.waitForURL('**/onboarding/meeting-type', { timeout: 20000 });
    await p.fill('#mt-name', 'Board');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 20000 });

    await p.goto(`${BASE}/today`);
    // Waiting on the panel itself rather than on anything beside it: a wait on
    // an adjacent element is how this suite would come to pass while the thing
    // it is about never rendered.
    await p.waitForSelector('.what-this-does', { timeout: 15000 });
    ok('Today carries its own guidance',
      await p.locator('.what-this-does').count() === 1);
    ok('and it is open on the first visit',
      await p.locator('.what-this-does.is-open').count() === 1);
    ok('with the steps showing',
      await p.locator('.what-this-steps li').count() >= 2);

    // The note it replaced said the same four things on every screen, forever.
    ok('the old one-note-for-everything is gone',
      await p.locator('.start-here').count() === 0);

    await p.click('.what-this-head');
    await p.waitForSelector('.what-this-does:not(.is-open)', { timeout: 5000 });
    ok('it folds when asked', await p.locator('.what-this-steps').count() === 0);
    ok('and folded, the heading is still there to open again',
      await p.locator('.what-this-title').count() === 1);

    await p.reload();
    await p.waitForSelector('.what-this-does', { timeout: 15000 });
    ok('and it stays folded on the way back',
      await p.locator('.what-this-does.is-open').count() === 0);

    // A different feature has not been read, so it opens — which is the whole
    // behaviour, and it would be lost by a single remembered flag.
    await p.goto(`${BASE}/trips`);
    await p.waitForSelector('.what-this-does', { timeout: 15000 });
    ok('a feature not yet read still opens by itself',
      await p.locator('.what-this-does.is-open').count() === 1);
    const trips = await p.locator('.what-this-title').innerText();
    ok('and it is about THAT feature', /Trips/i.test(trips), trips);

    await p.goto(`${BASE}/pa`);
    await p.waitForSelector('.what-this-does', { timeout: 15000 });
    const desk = await p.locator('.what-this-title').innerText();
    ok('the desk describes the desk on arrival', /desk/i.test(desk), desk);

    // The tab IS the feature here, so moving between tabs must move the
    // guidance with it rather than leaving the desk's own description sitting
    // above somebody's approvals.
    await p.goto(`${BASE}/pa?tab=approvals`);
    await p.waitForSelector('.what-this-does', { timeout: 15000 });
    for (let i = 0; i < 50; i++) {
      if (/Approvals/i.test(await p.locator('.what-this-title').innerText())) break;
      await new Promise((res) => setTimeout(res, 100));
    }
    const appr = await p.locator('.what-this-title').innerText();
    ok('and a section of it describes that section', /Approvals/i.test(appr), appr);

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    bare.kill();
    if (keyed) keyed.kill();
  }

  console.log(fails === 0
    ? '\nEvery feature says what it does and how to use it, on itself.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
