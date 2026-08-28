// What happened while you were away, and knowing when "away" was.
//
// EVERY OTHER SCREEN ANSWERS "what is true now". Somebody back from four days
// out has a different question — "what did I miss" — and answering it meant
// opening six screens and doing the subtraction by eye. That is the work an
// office assistant should not be doing, and it is the first thing a PA will
// notice the app doing for them.
//
// The ones worth watching hardest:
//
//   THE GAP MUST BE CAPTURED BEFORE IT IS CLOSED. last_seen_at is stamped on
//   every authenticated request. Written in the wrong order, by the time
//   anybody opened the screen the app would think they had been away no time
//   at all — and the feature would be silently empty forever, in a way no
//   error ever reports.
//
//   A SHORT GAP IS NOT AN ABSENCE. Somebody who steps out for lunch must not
//   come back to a report, or the report stops meaning anything.
//
//   IT IS THE VIEWER'S, NOT A PRINCIPAL'S. An assistant with three principals
//   was away from all three at once. Being asked to pick one first is being
//   asked to guess where the news is.
//
//   AND IT MUST NOT SHOW YOU YOUR OWN WEEK BACK. Your own messages, your own
//   bookings, tasks you set yourself — none of that is news.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4601, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

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
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ENCRYPTION_KEY: KEY },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const db = require(`${ROOT}/app/server/lib/db`);
  let browser = null;

  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    await db.ready();

    // ---- Email honesty, while we are here ---------------------------------
    //
    // Not strictly catch-up, but the same principle and it belongs somewhere:
    // "configured" and "can reach anybody" are different facts, and reporting
    // the first as though it were the second is how an operator sets a key,
    // sees a green light, and discovers weeks later that no invitation ever
    // arrived.
    head('A configured mailer that can reach nobody says so:');
    const { deliveryState } = require(`${ROOT}/app/server/lib/emailProviders`);
    let st = deliveryState({});
    ok('no provider is not configured', st.configured === false && st.canReachAnyone === false);
    st = deliveryState({ RESEND_API_KEY: 'x' });
    ok('a key with no EMAIL_FROM is configured', st.configured === true);
    // THE ONE THAT BIT IN PRODUCTION. The key is valid, the provider is
    // reachable, mail to the operator arrives, and every tester gets nothing.
    ok('but cannot reach anybody', st.canReachAnyone === false);
    ok('and says why, naming the fix', /verify a domain/i.test(st.reason || ''), st.reason);
    st = deliveryState({ RESEND_API_KEY: 'x', EMAIL_FROM: 'K <hi@onboarding.resend.dev>' });
    ok('the shared test sender is caught too', st.canReachAnyone === false, JSON.stringify(st));
    st = deliveryState({ RESEND_API_KEY: 'x', EMAIL_FROM: 'Kairos <no-reply@kairos.ng>' });
    ok('a verified domain can reach anybody', st.canReachAnyone === true && !st.reason,
      JSON.stringify(st));

    // ---- Cast --------------------------------------------------------------
    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('PATCH', '/profile', { timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const pa = client();
    const paUp = await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    const paId = paUp.d.user.id;
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    const inv = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    // ---- Being here is not being away --------------------------------------
    head('Somebody who never left is told so, rather than shown an empty report:');
    let r = await pa('GET', '/catch-up');
    ok('a person at their desk is not away', r.d.away === false, JSON.stringify(r.d).slice(0, 120));
    ok('and there is nothing to report', r.d.empty === true);

    // A short gap is not an absence: a report after lunch would make the
    // report mean nothing.
    await db.prepare('UPDATE users SET last_seen_at = ?, away_since = NULL WHERE id = ?')
      .run(new Date(Date.now() - 90 * 60 * 1000).toISOString(), paId);
    r = await pa('GET', '/catch-up');
    ok('and neither is stepping out for an hour and a half', r.d.away === false,
      JSON.stringify(r.d).slice(0, 120));

    // ---- Four days out -----------------------------------------------------
    head('Four days out, and the app knows when that was:');
    const space = await boss('POST', '/spaces', { name: `The office ${ID}`, context: 'work' });
    const spaceId = space.d.space.id;
    await boss('PATCH', `/spaces/${spaceId}`, { autoDelegateRoles: ['pa'] });
    let t = await boss('POST', `/spaces/${spaceId}/threads`, { name: 'Board pack' });
    const threadId = t.d.thread.id;
    // Read everything, so what lands after this is genuinely new to the PA.
    await pa('GET', `/threads/${threadId}/messages`);

    // Now the PA leaves. Stamped straight into the column that the request
    // above would otherwise have refreshed.
    const fourDaysAgo = new Date(Date.now() - 4 * 86400000).toISOString();
    await db.prepare('UPDATE users SET last_seen_at = ?, away_since = NULL WHERE id = ?')
      .run(fourDaysAgo, paId);

    // While they are gone, the office carries on.
    await boss('POST', `/threads/${threadId}/messages`, { body: 'Printer confirmed for Thursday' });
    await boss('POST', `/threads/${threadId}/messages`, { body: 'Two copies for the chairman' });
    await boss('POST', `/threads/${threadId}/messages`,
      { body: 'The board has approved the Q3 agenda', register: 'record', recordType: 'decision' });
    const task = await boss('POST', '/tasks',
      { spaceId, title: 'Circulate the pack', assigneeId: paId });
    // Something the PA did themselves, which is not news to them.
    const own = await pa('POST', '/tasks', { spaceId, title: 'My own reminder', assigneeId: paId });
    ok('setup made both a handed task and a self-set one', !!task.d && !!own.d);

    r = await pa('GET', '/catch-up');
    // THE ASSERTION THE WHOLE ORDERING EXISTS FOR. The GET above is itself an
    // authenticated request, so touch() ran before the handler did. Written
    // the wrong way round, away_since would have been closed by the very call
    // asking to read it.
    ok('the request that reads it does not erase the gap', r.d.away === true,
      JSON.stringify(r.d).slice(0, 140));
    ok('and it starts where they left off', r.d.since === fourDaysAgo, r.d.since);
    ok('and there is something to report', r.d.empty === false);

    ok('the room with new messages is there',
      r.d.rooms.some((x) => x.threadId === threadId && x.unread === 3),
      JSON.stringify(r.d.rooms));
    ok('the decision filed in their absence is there',
      r.d.records.some((x) => /Q3 agenda/.test(x.body)), JSON.stringify(r.d.records).slice(0, 200));
    ok('and the work handed to them', r.d.tasks.some((x) => /Circulate the pack/.test(x.title)),
      JSON.stringify(r.d.tasks.map((x) => x.title)));
    // Being shown your own week back is not a catch-up.
    ok('but not the task they set themselves',
      !r.d.tasks.some((x) => /My own reminder/.test(x.title)),
      JSON.stringify(r.d.tasks.map((x) => x.title)));

    // ---- It belongs to the person, not to a principal ----------------------
    head('It is the viewer\'s absence, across every principal they act for:');
    const other = client();
    const otherUp = await other('POST', '/auth/signup',
      { name: 'Chidi Eze', email: `chidi${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await other('PATCH', '/profile', { timezone: 'UTC' });
    await other('POST', '/profile/onboarding-step', { step: 'done' });
    const inv2 = await other('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv2.d.inviteLink.split('/').pop()}/accept`);

    await db.prepare('UPDATE users SET last_seen_at = ?, away_since = ? WHERE id = ?')
      .run(new Date().toISOString(), fourDaysAgo, paId);
    r = await pa('GET', '/catch-up');
    ok('both principals are in scope', r.d.principals.length === 3,
      JSON.stringify(r.d.principals.map((p) => p.name)));

    // ---- Reading it puts it away -------------------------------------------
    head('Reading it ends it, until the next real absence:');
    r = await pa('POST', '/catch-up/seen', {});
    ok('it can be marked read', r.s === 200);
    r = await pa('GET', '/catch-up');
    ok('and stops claiming they were away', r.d.away === false, JSON.stringify(r.d).slice(0, 120));

    // ---- The screen --------------------------------------------------------
    head('And it reads as a screen somebody just back would want:');
    await db.prepare('UPDATE users SET away_since = ? WHERE id = ?').run(fourDaysAgo, paId);
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

    // Signing in is itself a request, so re-stamp the gap it just closed.
    await db.prepare('UPDATE users SET away_since = ? WHERE id = ?').run(fourDaysAgo, paId);
    await page.goto(`${BASE}/catch-up`);
    await page.waitForFunction(
      () => !/Loading…/.test(document.body.innerText), null, { timeout: 20000 },
    );
    const text = await page.locator('body').innerText();
    // WORST TO HAVE MISSED, FIRST. A decision taken in your absence is
    // something you are now working under; a chatty room can wait.
    ok('the decision comes before the chatter',
      text.indexOf('Decided without you') < text.indexOf('Rooms with something in them'),
      `${text.indexOf('Decided without you')} vs ${text.indexOf('Rooms with something in them')}`);
    ok('the work handed over is named', /Handed to you/.test(text), text.slice(0, 400));
    ok('and it says what it counted from', /Counted from when you last had Kairos open/.test(text));
    ok('with a way to be done with it',
      (await page.locator('button:has-text("I have read this")').count()) === 1);

    await page.click('button:has-text("I have read this")');
    await page.waitForTimeout(300);
    ok('which the server agrees with',
      (await pa('GET', '/catch-up')).d.away === false);

    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    proc.kill();
  }

  console.log(fails === 0
    ? '\nComing back after four days, the app says what you missed.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
