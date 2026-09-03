// The week the office had, and knowing which room a message landed in.
//
// TWO THINGS THE APP KNEW AND WOULD NOT SAY.
//
//   WHICH ROOM. The rail counted unread messages correctly and the next screen
//   said nothing, so the only way to find them was to open rooms one at a time
//   until the number went down. A count that says something is waiting but not
//   where is half a notification.
//
//   WHAT THE OFFICE DID. A principal engages a PA, an EA or a Chief of Staff
//   precisely so they do not have to watch the work happen — and then has no
//   way to see its shape. Every number needed was already in the database.
//
// The ones worth watching hardest:
//
//   THE THREE COUNTS MUST AGREE. The rail's total, the space's number and the
//   thread's number are now one calculation seen from three places, and the bug
//   that motivated this — a chip keeping its 1 after the rail went quiet — was
//   exactly two of them disagreeing.
//
//   A REPORT IS A VIEW OF OTHER PEOPLE'S WORK. The principal sees the whole
//   office, and so does a Chief of Staff, because running the office is the
//   post. A PA, an EA and a delegate see their own line and nobody else's —
//   they are not each other's supervisors, and a reporting screen must not
//   quietly decide otherwise.
//
//   THE WEEK MUST BE THE PRINCIPAL'S WEEK. Monday to Sunday in their timezone,
//   not the server's — otherwise Sunday evening in Lagos lands in the wrong
//   week every single time and nobody reading it can tell why.
//
//   THE WEEKLY MAIL MUST GO ONCE. The sweep may run every fifteen minutes, so
//   "is it Monday" would send the same report ninety times.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4595, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SECRET = `sweep-${ID}`;
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
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      ENCRYPTION_KEY: KEY,
      SWEEP_SECRET: SECRET,
      REMINDER_SWEEP_MS: String(60 * 60 * 1000),
    },
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

    // ---- The week, before anything touches a database ---------------------
    head('A week is the principal\'s week, not the server\'s:');
    const { weekWindow } = require(`${ROOT}/app/server/lib/weeklyReport`);
    // A Thursday. Last week is the Monday nine days earlier through the Sunday.
    const thursday = new Date('2026-08-27T02:00:00Z');
    const utc = weekWindow('UTC', 1, thursday);
    ok('it runs Monday to Sunday', utc.startDate === '2026-08-17' && utc.endDate === '2026-08-23',
      `${utc.startDate}..${utc.endDate}`);
    ok('and covers exactly seven days',
      new Date(utc.endAt) - new Date(utc.startAt) === 7 * 86400000,
      String((new Date(utc.endAt) - new Date(utc.startAt)) / 86400000));

    const lagos = weekWindow('Africa/Lagos', 1, thursday);
    // THE POINT. Lagos is an hour ahead, so its Monday midnight is 23:00 the
    // Sunday before in UTC. Same calendar week, different instants — and an
    // hour of Sunday evening that UTC would have put in the wrong week.
    ok('the same calendar week in Lagos starts an hour earlier in UTC',
      lagos.startDate === utc.startDate && lagos.startAt === '2026-08-16T23:00:00.000Z',
      `${lagos.startDate} ${lagos.startAt}`);
    const la = weekWindow('America/Los_Angeles', 1, thursday);
    ok('and seven hours later in Los Angeles', la.startAt === '2026-08-17T07:00:00.000Z', la.startAt);
    ok('week 0 is the week in progress',
      weekWindow('UTC', 0, thursday).startDate === '2026-08-24',
      weekWindow('UTC', 0, thursday).startDate);

    // ---- Cast -------------------------------------------------------------
    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('PATCH', '/profile', { timezone: 'Africa/Lagos' });
    await boss('PATCH', '/profile', { slug: `h${ID}-1` });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const pa = client();
    const paUp = await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    const paId = paUp.d.user.id;
    await pa('PATCH', '/profile', { slug: `h${ID}-2` });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    let inv = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    const cos = client();
    const cosUp = await cos('POST', '/auth/signup',
      { name: 'Emeka Nwosu', email: `emeka${ID}@x.com`, password: PW, accountCategory: 'chief_of_staff' });
    const cosId = cosUp.d.user.id;
    await cos('PATCH', '/profile', { slug: `h${ID}-3` });
    await cos('POST', '/profile/onboarding-step', { step: 'done' });
    inv = await boss('POST', '/members', { email: `emeka${ID}@x.com`, role: 'chief_of_staff' });
    await cos('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    // ---- Which room the message is in -------------------------------------
    head('A message that arrives says which room it is in:');
    const space = await boss('POST', '/spaces', { name: `Board ${ID}`, context: 'work' });
    const spaceId = space.d.space.id;
    await boss('PATCH', `/spaces/${spaceId}`, { autoDelegateRoles: ['pa', 'chief_of_staff'] });
    let r = await boss('POST', `/spaces/${spaceId}/threads`, { name: 'Board pack' });
    const loud = r.d.thread.id;
    r = await boss('POST', `/spaces/${spaceId}/threads`, { name: 'Quiet corner' });
    const quiet = r.d.thread.id;

    // The PA opens both, so both start read for them.
    await pa('GET', `/threads/${loud}/messages`);
    await pa('GET', `/threads/${quiet}/messages`);

    await boss('POST', `/threads/${loud}/messages`, { body: 'The pack needs to go out tonight' });
    await boss('POST', `/threads/${loud}/messages`, { body: 'Two copies for the chairman' });

    r = await pa('GET', `/spaces/${spaceId}`);
    const loudRow = r.d.threads.find((t) => t.id === loud);
    const quietRow = r.d.threads.find((t) => t.id === quiet);
    ok('the room with the messages says how many', loudRow?.unread === 2, JSON.stringify(loudRow));
    ok('and the one without says none', quietRow?.unread === 0, JSON.stringify(quietRow));
    // "Started 3 June" was the old meta, and it is true of a room forever.
    ok('and it shows the last thing said', /chairman/.test(loudRow?.lastMessage?.body || ''),
      JSON.stringify(loudRow?.lastMessage));
    ok('with who said it', loudRow?.lastMessage?.authorName === 'Adaeze Okonkwo',
      loudRow?.lastMessage?.authorName);

    r = await pa('GET', '/spaces');
    const spaceRow = r.d.spaces.find((s) => s.id === spaceId);
    ok('the spaces list says which space they are in', spaceRow?.unread === 2, JSON.stringify(spaceRow));

    // THE COUNT THAT USED TO DISAGREE WITH ITSELF.
    r = await pa('GET', '/attention');
    ok('and the rail agrees with both', r.d.counts.messages === 2, JSON.stringify(r.d));

    // Reading the room must move all three together.
    await pa('GET', `/threads/${loud}/messages`);
    const [afterSpace, afterList, afterRail] = await Promise.all([
      pa('GET', `/spaces/${spaceId}`), pa('GET', '/spaces'), pa('GET', '/attention'),
    ]);
    ok('opening the room clears the thread',
      afterSpace.d.threads.find((t) => t.id === loud)?.unread === 0);
    ok('and the space with it',
      afterList.d.spaces.find((s) => s.id === spaceId)?.unread === 0);
    ok('and the rail with both', afterRail.d.counts.messages === 0, JSON.stringify(afterRail.d));

    // Your own words are never unread to you.
    await boss('POST', `/threads/${quiet}/messages`, { body: 'A note to myself' });
    r = await boss('GET', `/spaces/${spaceId}`);
    ok('and nobody has unread messages they wrote themselves',
      r.d.threads.find((t) => t.id === quiet)?.unread === 0,
      JSON.stringify(r.d.threads.find((t) => t.id === quiet)));

    // ---- A week of work ---------------------------------------------------
    head('The week the office had is there to read:');
    // Everything below happens now, so it belongs to the week in progress.
    const soon = new Date(Date.now() + 3 * 86400000).toISOString();
    r = await boss('POST', '/bookings', { startAt: soon, durationMinutes: 30, name: 'Chidi Eze' });
    const bookingId = r.d.booking.id;
    await pa('POST', `/pa/${bossId}/bookings/${bookingId}/cancel`, { note: 'clash' })
      .catch(() => {});

    const task = await pa('POST', '/tasks', {
      spaceId, title: 'Print the board pack', assigneeId: paId,
    });
    await pa('PATCH', `/tasks/${task.d.task?.id || task.d.id}`, { status: 'done' });

    await cos('POST', `/threads/${loud}/messages`,
      { body: 'Chairman has approved the agenda', register: 'record', recordType: 'decision' });

    r = await boss('GET', `/report/${bossId}?week=0`);
    ok('the principal can read it', r.s === 200, JSON.stringify(r.d).slice(0, 140));
    ok('and sees the whole office', r.d.people.length === 2, JSON.stringify(r.d.people.map((p) => p.name)));
    ok('and is told that is what they are seeing', r.d.scope === 'office' && r.d.canSeeEveryone === true);

    const ngozi = r.d.people.find((p) => p.id === paId);
    const emeka = r.d.people.find((p) => p.id === cosId);
    ok('each person is named with their post',
      ngozi?.roleLabel === 'PA' && emeka?.roleLabel === 'Chief of Staff',
      `${ngozi?.roleLabel} / ${emeka?.roleLabel}`);
    ok('a finished task shows against whoever finished it', ngozi?.counts.tasksDone === 1,
      JSON.stringify(ngozi?.counts));
    ok('a record shows against whoever filed it', emeka?.counts.records === 1,
      JSON.stringify(emeka?.counts));
    // Filing a record also writes a message; both are true and both are shown.
    ok('and their messages are counted too', emeka?.counts.messages >= 1, JSON.stringify(emeka?.counts));
    ok('somebody with a quiet week is said to have had one',
      typeof ngozi?.quiet === 'boolean' && ngozi.quiet === false);

    // The half a principal actually reads for.
    ok('what is still open is reported as well',
      typeof r.d.stillOpen?.approvalsWaiting === 'number'
      && typeof r.d.stillOpen?.tasksOverdue === 'number',
      JSON.stringify(r.d.stillOpen));

    head('And who may read whose line follows the post:');
    r = await pa('GET', `/report/${bossId}?week=0`);
    ok('an assistant reads their own line', r.s === 200 && r.d.people.length === 1, JSON.stringify(r.d.people));
    ok('and it is theirs', r.d.people[0]?.id === paId, r.d.people[0]?.id);
    ok('and they are told why it is only one', r.d.scope === 'self' && r.d.canSeeEveryone === false);

    // A Chief of Staff runs the office, so they see it. Asked for explicitly,
    // and it follows the post rather than a switch somebody has to find.
    r = await cos('GET', `/report/${bossId}?week=0`);
    ok('a Chief of Staff sees the whole office', r.d.people.length === 2,
      JSON.stringify(r.d.people.map((p) => p.name)));
    ok('and is told that is what they are seeing', r.d.scope === 'office' && r.d.canSeeEveryone === true,
      JSON.stringify({ scope: r.d.scope, canSeeEveryone: r.d.canSeeEveryone }));
    // But it is not their office, and the screen must not tell them to go and
    // staff somebody else's team.
    ok('while still knowing it is not their own office', r.d.isPrincipal === false,
      String(r.d.isPrincipal));
    ok('and the principal is still the one whose office it is',
      (await boss('GET', `/report/${bossId}?week=0`)).d.isPrincipal === true);

    // THE LINE THAT STILL HOLDS. A PA is nobody's supervisor.
    r = await pa('GET', `/report/${bossId}?week=0`);
    ok('a PA still sees only themselves', r.d.people.length === 1 && r.d.people[0].id === paId,
      JSON.stringify(r.d.people.map((p) => p.name)));

    const stranger = client();
    await stranger('POST', '/auth/signup',
      { name: 'Nobody', email: `no${ID}@x.com`, password: PW, accountCategory: 'principal' });
    ok('and somebody outside the office is refused',
      (await stranger('GET', `/report/${bossId}`)).s === 403);

    // An unbounded number from the URL reaches a date calculation.
    r = await boss('GET', `/report/${bossId}?week=99999`);
    ok('a silly week number is clamped rather than obeyed', r.s === 200, String(r.s));
    r = await boss('GET', `/report/${bossId}?week=notanumber`);
    ok('and nonsense falls back to last week', r.s === 200, String(r.s));

    // ---- The weekly mail --------------------------------------------------
    head('The report goes out once a week, not once a sweep:');
    // Last week is empty for this brand-new account, so force something into
    // it: the sweep only writes when there is something to say.
    const lastWeek = weekWindow('Africa/Lagos', 1);
    const midweek = new Date(new Date(lastWeek.startAt).getTime() + 2 * 86400000).toISOString();
    await db.prepare('UPDATE tasks SET completed_at = ? WHERE assignee_id = ?').run(midweek, paId);

    const anon = client();
    r = await anon('POST', '/sweep', undefined, { authorization: `Bearer ${SECRET}` });
    ok('the sweep sends it', r.d.weeklyReports === 1, JSON.stringify(r.d));

    let mail = await boss('GET', '/emails');
    const reports = (mail.d.emails || []).filter((e) => /Your office/.test(e.subject || ''));
    ok('and it reaches the principal', reports.length === 1,
      JSON.stringify((mail.d.emails || []).map((e) => e.subject)));
    ok('naming the week it covers',
      reports[0]?.subject.includes(lastWeek.startDate), reports[0]?.subject);
    ok('and saying what was done', /task\(s\) finished/.test(reports[0]?.body || ''),
      (reports[0]?.body || '').slice(0, 200));

    // THE GUARD. A sweep every fifteen minutes must not mean a report every
    // fifteen minutes.
    r = await anon('POST', '/sweep', undefined, { authorization: `Bearer ${SECRET}` });
    ok('a second sweep in the same week sends nothing', r.d.weeklyReports === 0, JSON.stringify(r.d));
    mail = await boss('GET', '/emails');
    ok('and there is still only one report',
      (mail.d.emails || []).filter((e) => /Your office/.test(e.subject || '')).length === 1);

    // ---- The screens -------------------------------------------------------
    head('And it can be read without knowing an API exists:');
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `ada${ID}@x.com`, password: PW }),
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

    await page.goto(`${BASE}/report`);
    await page.waitForFunction(
      () => !/Loading…/.test(document.body.innerText), null, { timeout: 20000 },
    );
    const text = await page.locator('body').innerText();
    ok('the report screen names the people', /Ngozi Bello/.test(text) && /Emeka Nwosu/.test(text),
      text.slice(0, 300));
    // Case-insensitive because innerText returns what is RENDERED, and the
    // role sits in a .pill, which is uppercased by CSS. Matching the string as
    // it is written in the source would be testing the stylesheet.
    ok('and their posts', /Chief of Staff/i.test(text), text.slice(0, 300));
    ok('and says which week it is', /Monday to Sunday/.test(text), text.slice(0, 400));
    ok('and what is still open', /Still open right now|Nothing outstanding/.test(text),
      text.slice(0, 400));

    // The list of rooms is the other half of this file.
    await page.goto(`${BASE}/spaces/${spaceId}`);
    await page.waitForSelector('.space-card', { timeout: 20000 });
    const spaceText = await page.locator('body').innerText();
    ok('a room shows the last thing said rather than the day it was made',
      /chairman/i.test(spaceText), spaceText.slice(0, 400));

    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA message says which room it is in, and the week the office had can be read.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
