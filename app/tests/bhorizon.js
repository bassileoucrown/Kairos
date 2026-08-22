// How far ahead the diary is open.
//
// Fourteen days was a constant in lib/availability.js, which meant every
// principal on the platform had the same answer to a question that is
// entirely personal. A barrister opens three months; somebody running a
// family office opens a week and would rather nobody could reach past it.
//
// Three things have to hold, and two of them are the kind that get shipped
// broken because nobody looks:
//
//   THE WINDOW ACTUALLY BOUNDS THE SLOTS. Not the grid, not the label — the
//   times a stranger is offered. A setting that changes a sentence and not
//   the diary is worse than no setting.
//
//   THE BOOKING PAGE STOPS SAYING "TWO WEEKS". That string was hard-coded in
//   the empty state, so the moment somebody chose a month it was a lie on the
//   one screen strangers see.
//
//   NOBODY'S DIARY MOVES WITHOUT THEM. An account that has never touched this
//   keeps the fourteen days it already had.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4617);
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;
const ID = Date.now().toString(36);
const PW = 'password123';
const EMAIL = `hz${ID}@x.com`;
const SLUG = `ada${ID}`;

let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function sess() {
  let c = '';
  const call = async (m, p, b) => {
    const r = await fetch(API + p, {
      method: m,
      headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) },
      body: b ? JSON.stringify(b) : undefined,
    });
    const sc = r.headers.get('set-cookie'); if (sc) c = sc.split(';')[0];
    let d = null; try { d = await r.json(); } catch { /* 204 */ }
    return { s: r.status, d };
  };
  call.cookie = () => c;
  return call;
}
const anon = sess();

const dayKey = (iso) => iso.slice(0, 10);
const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

(async () => {
  const proc = spawn('node', ['index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let browser;

  try {
    const deadline = Date.now() + 30000;
    for (;;) {
      try { if ((await (await fetch(`${API}/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('the server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = sess();
    await boss('POST', '/auth/signup', { name: 'Ada Boss', email: EMAIL, password: PW, accountCategory: 'principal' });
    const me = (await boss('GET', '/auth/me')).d.user;
    await boss('PATCH', '/profile', { slug: SLUG, timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const week = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:00' }));
    await boss('PUT', '/availability', { rules: week });
    let r = await boss('POST', '/meeting-types', {
      name: 'Intro', durationMinutes: 60, locationType: 'video', accessTier: 1,
    });
    const mt = r.d.meetingType;

    const slots = async () => (await anon('GET', `/public/${SLUG}/${mt.slug}/slots`)).d;
    const reach = (list) => (list.length === 0 ? 0
      : daysBetween(dayKey(list[0].startAt), dayKey(list[list.length - 1].startAt)) + 1);

    // ---- What an account that has never chosen gets -----------------------
    head('An account that has never touched this:');
    r = await boss('GET', '/availability');
    ok('is on the fourteen days it always had', r.d.windowDays === 14, String(r.d.windowDays));
    ok('and is offered lengths to choose from', (r.d.windowChoices || []).length >= 4,
      JSON.stringify((r.d.windowChoices || []).map((c) => c.days)));
    ok('a day being the shortest offered',
      r.d.windowChoices[0].days === 1, JSON.stringify(r.d.windowChoices[0]));
    ok('its hours are still there too', r.d.rules.length === 7, String(r.d.rules?.length));

    let s = await slots();
    ok('the booking page reaches a fortnight', reach(s.slots) === 14, String(reach(s.slots)));
    ok('and says so to whoever asks', s.windowDays === 14, String(s.windowDays));

    // ---- Shortening it ------------------------------------------------------
    head('Opening only the next day:');
    r = await boss('PUT', '/availability', { rules: week, windowDays: 1 });
    ok('the choice is accepted', r.s === 200 && r.d.windowDays === 1, JSON.stringify(r.d.windowDays));
    s = await slots();
    ok('and a stranger is offered one day of times', reach(s.slots) === 1,
      `${reach(s.slots)} days: ${JSON.stringify(s.slots.map((x) => dayKey(x.startAt)))}`);
    ok('the page reports the shorter window', s.windowDays === 1);

    // The property that makes this a real setting rather than a label.
    const beyond = new Date(Date.now() + 5 * 86400000);
    beyond.setUTCHours(10, 0, 0, 0);
    r = await anon('POST', `/public/${SLUG}/${mt.slug}/book`, {
      name: 'Too Far', email: `far${ID}@x.com`, timezone: 'UTC', startAt: beyond.toISOString(),
    });
    ok('and a time past the window cannot be booked even by asking directly',
      r.s === 409, `${r.s} ${JSON.stringify(r.d)}`);

    // ---- Lengthening it ------------------------------------------------------
    head('Opening three months:');
    await boss('PUT', '/availability', { rules: week, windowDays: 90 });
    s = await slots();
    ok('the times run the whole way out', reach(s.slots) === 90, String(reach(s.slots)));
    r = await anon('POST', `/public/${SLUG}/${mt.slug}/book`, {
      name: 'Well Ahead', email: `ahead${ID}@x.com`, timezone: 'UTC', startAt: beyond.toISOString(),
    });
    ok('and the time that was refused a moment ago is bookable now', r.s === 201,
      `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);

    // ---- What will not be accepted ---------------------------------------------
    head('Lengths that are not lengths:');
    for (const [value, why] of [[0, 'zero'], [-3, 'negative'], [400, 'more than a year'], ['soon', 'a word']]) {
      r = await boss('PUT', '/availability', { rules: week, windowDays: value });
      ok(`${why} is refused`, r.s === 400, `${r.s} ${JSON.stringify(r.d)}`);
    }
    r = await boss('GET', '/availability');
    ok('and none of it moved the window', r.d.windowDays === 90, String(r.d.windowDays));
    ok('nor lost the hours', r.d.rules.length === 7, String(r.d.rules?.length));

    // Saying nothing about the window leaves it alone — the hours screen must
    // be able to save hours without restating a decision it did not touch.
    r = await boss('PUT', '/availability', { rules: week.slice(0, 5) });
    ok('saving hours without mentioning the window leaves it where it was',
      r.d.windowDays === 90 && r.d.rules.length === 5,
      `${r.d.windowDays} / ${r.d.rules.length}`);
    await boss('PUT', '/availability', { rules: week, windowDays: 7 });

    // ---- The assistant --------------------------------------------------------
    head('Through an assistant with scheduling:');
    const pa = sess();
    await pa('POST', '/auth/signup', { name: 'Chidi PA', email: `pa${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    r = await boss('POST', '/members', { email: `pa${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${r.d.inviteLink.split('/').pop()}/accept`);

    r = await pa('GET', `/pa/${me.id}/availability`);
    ok('they see the principal\'s window', r.d.windowDays === 7, String(r.d.windowDays));
    r = await pa('PUT', `/pa/${me.id}/availability`, { rules: week, windowDays: 30 });
    ok('and can change it', r.s === 200 && r.d.windowDays === 30, JSON.stringify(r.d.windowDays));
    ok('which the principal sees too',
      (await boss('GET', '/availability')).d.windowDays === 30);

    // ---- Somebody else's diary is unaffected -------------------------------------
    head('One principal at a time:');
    const other = sess();
    await other('POST', '/auth/signup', { name: 'Bo Other', email: `o${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await other('POST', '/profile/onboarding-step', { step: 'done' });
    ok('a second account still has the default', (await other('GET', '/availability')).d.windowDays === 14,
      String((await other('GET', '/availability')).d.windowDays));

    // ---- On screen ---------------------------------------------------------------
    head('Choosing it on the availability screen:');
    await boss('PUT', '/availability', { rules: week, windowDays: 14 });
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const ctx = await browser.newContext();
    await ctx.addCookies([{
      name: boss.cookie().split('=')[0],
      value: boss.cookie().split('=').slice(1).join('='),
      domain: '127.0.0.1', path: '/',
    }]);
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));

    await p.goto(`${BASE}/dashboard?tab=availability`);
    await p.waitForSelector('#booking-window', { timeout: 20000 });
    ok('the choice is on the hours screen, where the rest of this lives',
      (await p.locator('#booking-window').inputValue()) === '14');
    ok('labelled as what it is',
      /how far ahead/i.test(await p.locator('label[for="booking-window"]').innerText()),
      await p.locator('label[for="booking-window"]').innerText());

    await p.selectOption('#booking-window', '7');
    await p.click('button:has-text("Save availability")');
    await p.waitForSelector('.alert-success', { timeout: 15000 });
    ok('saving says what was chosen, in words',
      /a week ahead/i.test(await p.locator('.alert-success').innerText()),
      await p.locator('.alert-success').innerText());

    await p.reload();
    await p.waitForSelector('#booking-window', { timeout: 20000 });
    ok('and it is still chosen when the screen comes back',
      (await p.locator('#booking-window').inputValue()) === '7');

    // ---- The sentence a stranger reads ----------------------------------------------
    head('What a stranger is told when there is nothing free:');
    const guest = await browser.newContext();
    const g = await guest.newPage();
    // Close the week entirely so the empty state is what renders.
    await boss('PUT', '/availability', { rules: [], windowDays: 7 });
    await g.goto(`${BASE}/book/${SLUG}/${mt.slug}`);
    await g.waitForSelector('.empty-state', { timeout: 20000 });
    let said = await g.locator('.empty-state').innerText();
    ok('it says the window the principal actually chose', /next week/i.test(said), said);
    ok('and no longer says two weeks', !/two weeks/i.test(said), said);

    await boss('PUT', '/availability', { rules: [], windowDays: 90 });
    await g.reload();
    await g.waitForSelector('.empty-state', { timeout: 20000 });
    said = await g.locator('.empty-state').innerText();
    ok('and follows a longer one', /next 3 months/i.test(said), said);

    ok('no page threw along the way', errors.length === 0, JSON.stringify(errors).slice(0, 200));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nHow far ahead the diary is open is a decision, and it binds the diary.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})();
