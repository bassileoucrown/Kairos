// The desk shows what is on it, rather than one drawer and a menu.
//
// WHAT WAS WRONG. The desk holds nine sections behind a tab strip — which on a
// phone is a menu you have to open. So arriving at the desk put you in
// Approvals and said nothing about the other eight: an assistant could not see
// that requests were waiting AND a brief was unwritten AND an instruction was
// outstanding without opening three drawers to find out. The complaint was
// exactly that: why a dropdown, rather than the features showing themselves.
//
// WHAT IT IS NOT. Nine sections stacked on one page, which is the literal
// reading and the wrong build — nine full features each loading their own data,
// slow on a desk and an unfinishable scroll on a phone. What somebody needs on
// arrival is nine answers to "is there anything in here for me", which is one
// query, not nine screens.
//
// The ones worth watching hardest:
//
//   THE COUNTS MUST BE TRUE. A card saying "0 requests waiting" over a queue
//   with three in it is worse than no card: it is the app telling somebody
//   they can stop looking.
//
//   A DOOR THAT WILL 403 MUST NOT BE DRAWN. A delegate without the scheduling
//   remit has no Availability to open, and offering it is a promise the server
//   will refuse.
//
//   THE WAY BACK MUST EXIST. Opening a section replaces the overview, and a
//   screen you can enter and not leave is worse than one you never entered.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4597, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
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

  let browser = null;
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('PATCH', '/profile', { timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    const handle = (await boss('GET', '/auth/me')).d.user.slug;

    // ---- An empty desk ----------------------------------------------------
    head('A desk with nothing on it still says what it holds:');
    let r = await boss('GET', `/pa/${bossId}/desk`);
    ok('the whole desk comes in one request', r.s === 200, JSON.stringify(r.d).slice(0, 140));
    const byId = (d) => Object.fromEntries(d.sections.map((s) => [s.id, s]));
    let sec = byId(r.d);
    ok('every section is described', r.d.sections.length === 9,
      JSON.stringify(r.d.sections.map((s) => s.id)));
    ok('each one says what it is for',
      r.d.sections.every((s) => (s.note || '').length > 20),
      JSON.stringify(r.d.sections.map((s) => s.note?.slice(0, 20))));
    // Nothing bookable at all is worth saying out loud: the public page is
    // live and offering nobody anything.
    ok('no hours set is flagged rather than left at zero', sec.availability.attention === true);
    ok('and no meeting types with it', sec.meeting_types.attention === true);
    // A tool is not a pile, and giving it a number would make it read like one.
    ok('the assistant is a tool, so it carries no count', sec.ai_assist.count === null,
      String(sec.ai_assist.count));

    // ---- A desk with work on it -------------------------------------------
    head('And the numbers are the real ones:');
    await boss('PUT', '/availability', {
      rules: [1, 2, 3].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:00' })),
    });
    const mt = await boss('POST', '/meeting-types',
      { name: 'Introduction', durationMinutes: 30, locationType: 'video', accessTier: 4 });
    const slug = mt.d.meetingType.slug;

    const anon = client();
    const open = (await anon('GET', `/public/${handle}/${slug}/slots`)).d.slots;
    const ask = (name, i) => anon('POST', `/public/${handle}/${slug}/book`,
      { startAt: open[i].startAt, name, email: `${name.split(' ')[0].toLowerCase()}@x.com`, timezone: 'UTC' });
    const a1 = await ask('Bola Adeyemi', 1);
    await ask('Kemi Adebayo', 4);
    await ask('Tunde Bakare', 8);

    // Booking creates a contact, so the three above are already in the book.
    // One more, with a date on it, so the note has something to report.
    await boss('POST', `/pa/${bossId}/contacts`,
      { email: 'ifeoma@x.com', name: 'Ifeoma Eze', birthday: '04-12' });
    await boss('POST', `/pa/${bossId}/instructions`, { text: 'Never book before 9am on a Monday.' });

    r = await boss('GET', `/pa/${bossId}/desk`);
    sec = byId(r.d);
    ok('three requests waiting are three, not none', sec.approvals.count === 3,
      JSON.stringify(sec.approvals));
    ok('and that is marked as needing somebody', sec.approvals.attention === true);
    ok('three days of hours are counted once each', sec.availability.count === 3,
      JSON.stringify(sec.availability));
    ok('and no longer flagged', sec.availability.attention === false || !sec.availability.attention);
    ok('the meeting type is counted', sec.meeting_types.count === 1, JSON.stringify(sec.meeting_types));
    // Three from the requests, plus the one entered by hand.
    ok('and the contacts, including those a booking created', sec.contacts.count === 4,
      JSON.stringify(sec.contacts));
    ok('with the ones who have a date to remember', /1 with a date/.test(sec.contacts.note),
      sec.contacts.note);
    ok('an open instruction is counted', sec.instructions.count === 1, JSON.stringify(sec.instructions));

    // Nothing is confirmed yet, so nothing is unbriefed — the count is of
    // meetings MISSING a brief, which is the number worth acting on.
    ok('nothing is unbriefed while nothing is agreed', sec.briefs.count === 0,
      JSON.stringify(sec.briefs));
    await boss('POST', `/pa/${bossId}/approvals/${a1.d.booking?.id || a1.d.id}/approve`, {});
    r = await boss('GET', `/pa/${bossId}/desk`);
    sec = byId(r.d);
    ok('approving one leaves two waiting', sec.approvals.count === 2, JSON.stringify(sec.approvals));
    ok('and puts one meeting on the books', sec.bookings.count === 1, JSON.stringify(sec.bookings));
    // THE MOST USEFUL SENTENCE ON THE SCREEN: a meeting agreed and not briefed.
    ok('and that meeting now wants a brief', sec.briefs.count === 1 && sec.briefs.attention === true,
      JSON.stringify(sec.briefs));

    // ---- A door that would be refused is not drawn -------------------------
    head('A remit that stops at the diary is not offered the rest:');
    const del = client();
    await del('POST', '/auth/signup',
      { name: 'Tunde Driver', email: `driver${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await del('POST', '/profile/onboarding-step', { step: 'done' });
    let inv = await boss('POST', '/members', { email: `driver${ID}@x.com`, role: 'delegate' });
    await del('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    // Scheduling is ON by default for every assistant — see requireSchedulingAccess
    // in lib/paAccess.js — so it has to be taken away to test what happens when
    // it is absent. A principal who treats their own hours as personal does
    // exactly this from Team.
    const members = await boss('GET', '/members');
    const driverRow = members.d.members.find((m) => /driver/.test(m.invitedEmail || ''));
    r = await boss('PATCH', `/members/${driverRow.id}`, { canManageScheduling: false });
    ok('a principal can keep their hours to themselves', r.s === 200,
      `${r.s} ${JSON.stringify(r.d)}`);

    r = await del('GET', `/pa/${bossId}/desk`);
    ok('a delegate still sees the desk', r.s === 200, String(r.s));
    ok('but not the hours they cannot open',
      !r.d.sections.some((s) => s.id === 'availability' || s.id === 'meeting_types'),
      JSON.stringify(r.d.sections.map((s) => s.id)));
    ok('and is told so plainly', r.d.canSchedule === false, String(r.d.canSchedule));

    const pa = client();
    await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    inv = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);
    r = await pa('GET', `/pa/${bossId}/desk`);
    ok('a full assistant gets all nine', r.d.sections.length === 9,
      JSON.stringify(r.d.sections.map((s) => s.id)));

    const stranger = client();
    await stranger('POST', '/auth/signup',
      { name: 'Nobody', email: `no${ID}@x.com`, password: PW, accountCategory: 'principal' });
    ok('and somebody outside the office cannot see the desk at all',
      (await stranger('GET', `/pa/${bossId}/desk`)).s === 403);

    // ---- The screen --------------------------------------------------------
    head('Opening the desk shows the desk, not one drawer of it:');
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

    await page.goto(`${BASE}/pa`);
    await page.waitForSelector('.desk-card', { timeout: 20000 });
    ok('every section is on the screen at once',
      (await page.locator('.desk-card').count()) === 9,
      String(await page.locator('.desk-card').count()));
    const text = await page.locator('body').innerText();
    // Singular and plural both, because one unbriefed meeting is the common case
    // and a regex that only matches the plural is a test that passes by luck.
    ok('and each says what it holds',
      /requests? waiting/.test(text) && /meetings? unbriefed/.test(text),
      text.slice(0, 400));
    // THE COMPLAINT THIS ANSWERS. A menu you must open to learn what is behind it.
    ok('with no menu to open first',
      (await page.locator('.tabs-shell').count()) === 0,
      String(await page.locator('.tabs-shell').count()));
    ok('and the one needing somebody is marked',
      (await page.locator('.desk-card.needs-you').count()) > 0);
    ok('and named at the top', /needs? you/i.test(text), text.slice(0, 200));

    // Drilling in.
    await page.locator('.desk-card', { hasText: 'Contacts' }).first().click();
    await page.waitForFunction(
      () => /[?&]tab=contacts/.test(window.location.search), null, { timeout: 20000 },
    );
    ok('a card opens its section', true);
    // APPEARS is a change over time, and the URL is not the thing that changes.
    // The wait above is satisfied the moment the query string updates, which
    // happens before the component has re-rendered the strip — so counting it
    // on the next line read a screen that was still the card grid. Bounded, so
    // a strip that genuinely never appears still reddens this.
    const strip = await page.waitForFunction(
      () => document.querySelectorAll('.tabs-shell').length === 1,
      null, { timeout: 20000 },
    ).then(() => true).catch(() => false);
    ok('and the strip appears for moving between them', strip,
      strip ? '' : `saw ${await page.locator('.tabs-shell').count()} strips`);
    // A screen you can enter and not leave is worse than one you never entered.
    ok('with a way back to the whole desk',
      (await page.locator('button:has-text("The whole desk")').count()) === 1);
    await page.click('button:has-text("The whole desk")');
    await page.waitForSelector('.desk-card', { timeout: 20000 });
    ok('which returns to it', (await page.locator('.desk-card').count()) === 9);
    ok('and takes the tab out of the address with it',
      !/tab=/.test(await page.evaluate(() => window.location.search)),
      await page.evaluate(() => window.location.search));

    // A link somebody sent last week still has to land where it says.
    await page.goto(`${BASE}/pa/${bossId}?tab=briefs`);
    await page.waitForSelector('.tabs-shell', { timeout: 20000 });
    ok('an old link straight to a section still lands there',
      /Briefs/.test(await page.locator('body').innerText()));

    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    proc.kill();
  }

  console.log(fails === 0
    ? '\nThe desk shows what is on it, and every drawer says whether it wants opening.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
