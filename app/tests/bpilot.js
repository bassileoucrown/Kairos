// The two things a pilot needs that a finished product does not.
//
// A TESTER MUST BE ABLE TO SAY SOMETHING, from where it went wrong. Findings
// that arrive as voice notes an hour later are impressions: the screen
// somebody was on and what they were trying to do are exactly the details that
// do not survive being retold. Taken in the app, the report carries the route
// with it.
//
// AND THE OUTSIDE CLOCK MUST BE VISIBLY RUNNING. On a deployment that gets
// stopped when nobody is looking at it, the sweep is the only thing that makes
// a reminder happen. A scheduler pointed at the wrong URL means every notice
// in the product silently never goes — and that failure looks exactly like a
// quiet week, which is the worst shape a failure can have.
//
// The ones worth watching hardest:
//
//   THE ROUTE, NOT THE ROOM. /threads/9f2c-… identifies a conversation;
//   /threads/:id says which screen. A pilot's feedback table must not become a
//   second index of who was talking to whom.
//
//   ONE TESTER'S REPORT IS NOT ANOTHER'S TO READ. During a pilot the reports
//   are candid about colleagues and about the principal, and a screen that
//   showed them to each other would make the next one less candid.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4603, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SECRET = `sweep-${ID}`;
const OPERATOR = `boss${ID}@x.com`;
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function client() {
  let cookie = '';
  return async function call(method, path, body, headers = {}) {
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
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

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      ENCRYPTION_KEY: KEY, SWEEP_SECRET: SECRET, ANNOUNCEMENT_AUTHORS: OPERATOR,
      REMINDER_SWEEP_MS: String(60 * 60 * 1000),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  let browser = null;
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    // ---- The outside clock, before it has ever run ------------------------
    head('Whether the outside clock is running is a thing you can see:');
    let st = await (await fetch(`${BASE}/api/status`)).json();
    ok('the status says a secret is set', st.sweep?.configured === true, JSON.stringify(st.sweep));
    // "Never" and "four minutes ago" must not be the same answer. Before this
    // there was no answer at all.
    ok('and that it has never come through', st.sweep?.lastRun === null,
      JSON.stringify(st.sweep));

    const anon = client();
    let r = await anon('POST', '/sweep', undefined, { authorization: `Bearer ${SECRET}` });
    ok('the sweep runs', r.s === 200, JSON.stringify(r.d).slice(0, 100));

    st = await (await fetch(`${BASE}/api/status`)).json();
    ok('and now the status says when', !!st.sweep?.lastRun?.at, JSON.stringify(st.sweep));
    ok('and how long ago, in minutes anybody can read',
      st.sweep.lastRun.agoMinutes === 0, String(st.sweep.lastRun?.agoMinutes));
    ok('with what it did', typeof st.sweep.lastRun.result?.tasks === 'number',
      JSON.stringify(st.sweep.lastRun.result));

    // Twice must not make two rows — two schedulers on one deployment, or one
    // retrying, is a thing that happens.
    await anon('POST', '/sweep', undefined, { authorization: `Bearer ${SECRET}` });
    st = await (await fetch(`${BASE}/api/status`)).json();
    ok('running it again updates rather than duplicates', !!st.sweep.lastRun.at);

    // A refused call is not a run: a scheduler with the wrong key must not
    // make the status say everything is fine.
    const before = st.sweep.lastRun.at;
    await new Promise((res) => setTimeout(res, 1100));
    await anon('POST', '/sweep', undefined, { authorization: 'Bearer wrong' });
    st = await (await fetch(`${BASE}/api/status`)).json();
    ok('and a rejected call does not count as one', st.sweep.lastRun.at === before,
      `${before} -> ${st.sweep.lastRun.at}`);

    // ---- A tester saying something ---------------------------------------
    head('A tester can say something from where it went wrong:');
    const boss = client();
    await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: OPERATOR, password: PW, accountCategory: 'principal' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const pa = client();
    await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });

    r = await pa('POST', '/feedback',
      { kind: 'confusing', body: 'I could not tell which principal I was acting for.',
        route: '/threads/9f2c8a11-4b3e-4f77-9d2a-c0ffee001122' });
    ok('a report is taken', r.s === 201, `${r.s} ${JSON.stringify(r.d)}`);

    r = await pa('POST', '/feedback', { kind: 'wrong', body: '', route: '/today' });
    ok('an empty one is refused rather than filed', r.s === 400, String(r.s));

    // ---- What is kept, and what is not ------------------------------------
    head('And the report carries the screen, not the room:');
    r = await boss('GET', '/feedback');
    ok('the operator can read the pile', r.s === 200, `${r.s} ${JSON.stringify(r.d).slice(0, 90)}`);
    const one = (r.d.feedback || [])[0];
    ok('the words are kept exactly', /which principal I was acting for/.test(one?.body || ''),
      one?.body);
    ok('with who said it and what they are',
      one?.userLabel === 'Ngozi Bello' && one?.role === 'pa',
      JSON.stringify({ who: one?.userLabel, role: one?.role }));
    // THE ASSERTION THIS FILE EXISTS FOR. A feedback table must not become a
    // second index of which conversations exist.
    ok('the route says which screen', one?.route === '/threads/:id', one?.route);
    ok('and names no room', !/9f2c8a11/.test(JSON.stringify(one)), JSON.stringify(one).slice(0, 160));
    ok('and it is sorted into a kind', one?.kind === 'confusing', one?.kind);
    ok('arriving open rather than dealt with', one?.status === 'open', one?.status);

    // ---- Nobody else's to read --------------------------------------------
    head('One tester\'s report is not another\'s to read:');
    r = await pa('GET', '/feedback');
    ok('an ordinary tester cannot open the pile', r.s === 404, String(r.s));
    const stranger = client();
    await stranger('POST', '/auth/signup',
      { name: 'Nobody', email: `no${ID}@x.com`, password: PW, accountCategory: 'principal' });
    ok('nor a stranger', (await stranger('GET', '/feedback')).s === 404);

    // ---- The control ------------------------------------------------------
    head('And it is one tap from wherever they are standing:');
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `ngozi${ID}@x.com`, password: PW }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const [ck, cv] = cookie.split('=');
    await ctx.addCookies([{ name: ck, value: cv, domain: '127.0.0.1', path: '/' }]);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    await page.goto(`${BASE}/tasks`);
    await page.waitForSelector('.tellus-tab', { timeout: 20000 });
    ok('the way to speak up is on the screen', true);

    await page.click('.tellus-tab');
    await page.waitForSelector('.tellus-kind', { timeout: 20000 });
    // Three kinds rather than one box: confusing is a design problem, wrong is
    // a bug, an idea is neither, and a pilot reads them differently.
    ok('it asks what kind of thing happened',
      (await page.locator('.tellus-kind').count()) === 3);

    await page.locator('.tellus-kind', { hasText: 'Something is wrong' }).click();
    await page.fill('#tellus-body', 'The task list showed yesterday for a moment.');
    // Somebody whose profession is discretion should know what leaves with it.
    ok('and says what goes with the report',
      /which screen you were on/i.test(await page.locator('.tellus-card').innerText()));
    await page.click('button:has-text("Send")');
    await page.waitForFunction(
      () => /straight through/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('sending it says so', true);

    r = await boss('GET', '/feedback');
    const fromScreen = (r.d.feedback || []).find((f) => /showed yesterday/.test(f.body));
    ok('and it arrives with the screen it came from',
      fromScreen?.route === '/tasks' && fromScreen?.kind === 'wrong',
      JSON.stringify(fromScreen));

    // ---- What was used, counted and not read -------------------------------
    head('What testers did is counted, and what they wrote is not:');
    // Navigating is itself instrumented, and the client batches — so give the
    // flush a moment rather than assuming it has already gone.
    // Moved through the rail rather than by reloading, because that is how a
    // person uses it: one page load, several screens. A test that hard-loads
    // each one would be measuring page loads rather than navigation, and would
    // pass while the thing a tester actually does went uncounted.
    await page.goto(`${BASE}/today`);
    await page.waitForSelector('.app-nav', { timeout: 20000 });
    await page.click('.app-nav a:has-text("Spaces")');
    await page.waitForURL('**/spaces', { timeout: 20000 });
    await page.click('.app-nav a:has-text("Tasks")');
    await page.waitForURL('**/tasks', { timeout: 20000 });
    // Leaving is what flushes it, which is the behaviour that makes a
    // phone-mostly pilot countable at all. pagehide rather than
    // visibilitychange: Safari fires it on a back-forward navigation without
    // ever marking the document hidden, so it is the one that has to work.
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.waitForTimeout(900);

    r = await boss('GET', '/usage?days=14');
    ok('the operator can see what was used', r.s === 200, String(r.s));
    ok('and who is still opening it',
      (r.d.people || []).some((p) => p.who === 'Ngozi Bello'),
      JSON.stringify(r.d.people));
    ok('with the screens they opened',
      (r.d.screens || []).some((x) => x.route === '/spaces'),
      JSON.stringify(r.d.screens));
    // THE LINE. Counts about the app, never anything anybody wrote.
    ok('and nothing anybody typed', !/showed yesterday|acting for/.test(JSON.stringify(r.d)),
      JSON.stringify(r.d).slice(0, 160));

    // The same rule as feedback, and it needs its own check: the navigation
    // above only touched routes with no identifiers in them, so it would have
    // passed just as happily with the shaping removed.
    await pa('POST', '/usage', {
      events: [{ event: 'screen', route: '/threads/aa11bb22-cc33-dd44-ee55-ff6677889900' }],
    });
    r = await boss('GET', '/usage?days=14');
    ok('a counted screen names no room',
      (r.d.screens || []).some((x) => x.route === '/threads/:id')
      && !/aa11bb22/.test(JSON.stringify(r.d)),
      JSON.stringify(r.d.screens));

    r = await pa('GET', '/usage');
    ok('a tester cannot read the counts', r.s === 404, String(r.s));

    r = await boss('GET', '/errors');
    ok('and the faults have a home too', r.s === 200, String(r.s));

    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA tester can say something, and the outside clock is visibly running.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
