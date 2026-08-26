// How much diary you are looking at.
//
// The calendar was a month, always. Now it is a day, a week or a month, and
// the choice sticks — so three things have to hold that did not have to hold
// before.
//
//   THE FETCH MATCHES THE VIEW. Each length asks the server for exactly the
//   days it shows. This used to fetch every booking the account had ever had
//   and sift them in the browser, which works until somebody has a diary.
//
//   THE PAST IS REACHABLE. A calendar is the one screen that must be able to
//   look backwards. Between building the bookings history and this, the
//   calendar was quietly asking for "upcoming" and rendering empty boxes for
//   every month behind today. Nothing caught it, because nothing had ever
//   walked the calendar backwards.
//
//   HELD TIME SHOWS, CANCELLED TIME DOES NOT. A request nobody has answered
//   still occupies the hour and is exactly what you need to see before
//   agreeing to something else in it. A cancelled meeting is a thing people
//   plan around by mistake.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4615);
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api`;
const ID = Date.now().toString(36);
const PW = 'password123';
const EMAIL = `span${ID}@x.com`;
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

// The principal is in UTC so that a date key in this suite and a date key in
// the browser are the same three numbers, and a failure means what it says.
const dayKey = (iso) => iso.slice(0, 10);
const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const shiftKey = (key, n) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

(async () => {
  const proc = spawn('node', ['index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let browser;

  try {
    // A minute. Twenty seconds is plenty on an idle machine and not plenty on a
    // loaded one, and "no server" on a green tree is a board crying wolf.
    const deadline = Date.now() + 60000;
    for (;;) {
      try { if ((await (await fetch(`${API}/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('the server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    // ---- A principal open all day, every day -----------------------------
    const boss = sess();
    await boss('POST', '/auth/signup', { name: 'Ada Boss', email: EMAIL, password: PW, accountCategory: 'principal' });
    const me = (await boss('GET', '/auth/me')).d.user;
    await boss('PATCH', '/profile', { slug: SLUG, timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
    });
    let r = await boss('POST', '/meeting-types', {
      name: 'Intro', durationMinutes: 30, locationType: 'video', accessTier: 1,
    });
    const open = r.d.meetingType;
    r = await boss('POST', '/meeting-types', {
      name: 'Private', durationMinutes: 30, locationType: 'video', accessTier: 4,
    });
    const closed = r.d.meetingType;

    const slotsOf = async (mt) => (await anon('GET', `/public/${SLUG}/${mt.slug}/slots`)).d.slots;
    const bookAt = async (mt, startAt, name) =>
      (await anon('POST', `/public/${SLUG}/${mt.slug}/book`, {
        name, email: `${name.replace(/\W/g, '')}${ID}@x.com`, timezone: 'UTC', startAt,
      })).d.booking;

    const all = await slotsOf(open);
    // The first day with room for everything this suite puts on one day, which
    // is not the same as the day holding the first slot.
    //
    // Three bookings land on this day, and a booking blocks the principal's
    // time whichever meeting type it came through. Taking the day of all[0]
    // meant that running late in the evening — after 21:00, with availability
    // ending at 23:30 and a breather between appointments — left two slots
    // where three were needed, and the third booking read as a product fault.
    // The same shape as the horizon bug: green all day, red for the last hours
    // of it.
    const perDay = new Map();
    for (const s of all) {
      const k = dayKey(s.startAt);
      perDay.set(k, (perDay.get(k) || 0) + 1);
    }
    const firstDay = [...perDay.keys()].find((k) => perDay.get(k) >= 4);
    if (!firstDay) throw new Error('no day in the horizon has room for four bookings');

    // Weeks run Sunday to Saturday, so "eight days away" is not reliably "next
    // week" — eight days from a Saturday is the week after next, and one click
    // of Next would not reach it. The suite ran green for six days out of
    // seven and would have failed on the seventh, which is the worst kind of
    // test. So the far meeting is chosen by the week it lands in.
    const weekStart = shiftKey(firstDay, -new Date(`${firstDay}T00:00:00Z`).getUTCDay());
    const nextWeekStart = shiftKey(weekStart, 7);
    const weekAfter = shiftKey(nextWeekStart, 7);
    const later = all.find((s) => dayKey(s.startAt) >= nextWeekStart && dayKey(s.startAt) < weekAfter);
    if (!later) throw new Error('the slot horizon does not reach next week');

    // On firstDay, not merely first: everything below asserts against that day.
    const near = await bookAt(open, all.find((s) => dayKey(s.startAt) === firstDay).startAt, 'Near Meeting');
    const far = await bookAt(open, later.startAt, 'Far Meeting');

    // One held, one called off, on the same first day. Slots are refetched
    // between bookings because a booking blocks the principal's time whatever
    // meeting type it came through — the second and third would otherwise be
    // aimed at an hour the first has just taken.
    const heldSlots = await slotsOf(closed);
    const held = await bookAt(closed, heldSlots.find((s) => dayKey(s.startAt) === firstDay).startAt, 'Held Meeting');
    const leftOver = await slotsOf(open);
    const gone = await bookAt(open, leftOver.find((s) => dayKey(s.startAt) === firstDay).startAt, 'Gone Meeting');
    await anon('POST', `/public/bookings/${gone.id}/cancel`);

    // ---- The range itself -------------------------------------------------
    head('Asking for a stretch of days:');
    const range = async (fromDay, toDay, who = boss, prefix = '') => {
      const q = `scope=range&from=${encodeURIComponent(`${fromDay}T00:00:00.000Z`)}`
        + `&to=${encodeURIComponent(`${toDay}T00:00:00.000Z`)}`;
      return (await who('GET', `${prefix}/bookings?${q}`)).d.bookings;
    };

    let list = await range(firstDay, `${firstDay.slice(0, 8)}${String(Number(firstDay.slice(8)) + 1).padStart(2, '0')}`);
    ok('one day returns that day only', list.every((b) => dayKey(b.startAt) === firstDay),
      JSON.stringify(list.map((b) => dayKey(b.startAt))));
    ok('the confirmed meeting is in it', list.some((b) => b.id === near.id));
    ok('so is the one still being asked for', list.some((b) => b.id === held.id && b.status === 'pending'),
      JSON.stringify(list.map((b) => b.status)));
    ok('the cancelled one is not', !list.some((b) => b.id === gone.id),
      JSON.stringify(list.map((b) => b.bookerName)));
    ok('and neither is the meeting eight days out', !list.some((b) => b.id === far.id));

    list = await range(weekStart, nextWeekStart);
    ok('a week reaches its seven days and no further',
      list.some((b) => b.id === near.id) && !list.some((b) => b.id === far.id),
      JSON.stringify(list.map((b) => dayKey(b.startAt))));

    list = await range(weekStart, weekAfter);
    ok('a longer stretch reaches both', list.some((b) => b.id === near.id) && list.some((b) => b.id === far.id));

    // The regression this suite exists to stop coming back.
    head('Looking backwards, which is what a calendar is for:');
    const yearAgo = (() => { const d = new Date(`${firstDay}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); })();
    list = await range(yearAgo, firstDay);
    ok('a stretch entirely in the past is answered, not refused', Array.isArray(list), JSON.stringify(list));
    ok('and holds nothing from the future', !list.some((b) => b.id === near.id || b.id === far.id));

    // ---- The assistant asks the same way ------------------------------------
    head('Through an assistant:');
    const pa = sess();
    await pa('POST', '/auth/signup', { name: 'Chidi PA', email: `pa${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    r = await boss('POST', '/members', { email: `pa${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${r.d.inviteLink.split('/').pop()}/accept`);
    list = await range(weekStart, nextWeekStart, pa, `/pa/${me.id}`);
    ok('they get the same week', list.some((b) => b.id === near.id) && !list.some((b) => b.id === far.id));

    // ---- On screen ------------------------------------------------------------
    head('Choosing the length on screen:');
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

    const shownNames = async () => {
      const t = await p.locator('.cal-month, .cal-week, .cal-hours').first().innerText();
      return { near: /Near Meeting/.test(t), far: /Far Meeting/.test(t), gone: /Gone Meeting/.test(t) };
    };
    const settle = () => p.waitForTimeout(500);

    await p.goto(`${BASE}/dashboard?tab=calendar`);
    await p.waitForSelector('.cal-views', { timeout: 20000 });
    ok('there are three lengths to choose from',
      (await p.locator('.cal-views button').count()) === 3,
      String(await p.locator('.cal-views button').count()));
    ok('a month is where it starts',
      (await p.locator('.cal-views button[aria-pressed="true"]').innerText()).trim() === 'Month');

    // ---- A day ----------------------------------------------------------------
    await p.click('.cal-views button:has-text("Day")');
    await p.waitForSelector('.cal-hours', { timeout: 15000 });
    await settle();
    // "Today" may be the day before the first bookable slot, so walk forward
    // to the day the meeting is actually on rather than assuming.
    const todayKey = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < daysBetween(todayKey, firstDay); i++) {
      await p.click('.cal-move button[aria-label="Next"]');
    }
    await settle();
    let seen = await shownNames();
    ok('a day shows what is on that day', seen.near === true, JSON.stringify(seen));
    ok('and not what is in another week', seen.far === false);
    ok('nor anything that was called off', seen.gone === false);
    ok('the hours are laid out to read down', (await p.locator('.cal-hour').count()) > 0);

    await p.click('.cal-move button[aria-label="Next"]');
    await settle();
    seen = await shownNames();
    ok('moving on a day moves by one day', seen.near === false, JSON.stringify(seen));
    await p.click('.cal-move button[aria-label="Previous"]');
    await settle();
    ok('and back again', (await shownNames()).near === true);

    // ---- A week -----------------------------------------------------------------
    await p.click('.cal-views button:has-text("Week")');
    await p.waitForSelector('.cal-week', { timeout: 15000 });
    await settle();
    seen = await shownNames();
    ok('a week holds the near meeting', seen.near === true, JSON.stringify(seen));
    ok('and still not the far one', seen.far === false);
    ok('with seven days in it', (await p.locator('.cal-week .cal-day').count()) === 7,
      String(await p.locator('.cal-week .cal-day').count()));

    await p.click('.cal-move button[aria-label="Next"]');
    await settle();
    ok('moving on a week moves by seven days',
      (await shownNames()).far === true, JSON.stringify(await shownNames()));
    await p.click('.cal-move button:has-text("Today")');
    await settle();
    ok('and Today brings you back', (await shownNames()).far === false);

    // ---- The choice sticks ---------------------------------------------------------
    head('The length you chose:');
    await p.reload();
    await p.waitForSelector('.cal-views', { timeout: 20000 });
    ok('survives a reload, so it is not asked again every morning',
      (await p.locator('.cal-views button[aria-pressed="true"]').innerText()).trim() === 'Week');
    await p.goto(`${BASE}/today`);
    await p.goto(`${BASE}/dashboard?tab=calendar`);
    await p.waitForSelector('.cal-views', { timeout: 20000 });
    ok('and leaving the screen entirely',
      (await p.locator('.cal-views button[aria-pressed="true"]').innerText()).trim() === 'Week');

    // ---- Held time -------------------------------------------------------------------
    head('A meeting nobody has agreed to yet:');
    await p.click('.cal-views button:has-text("Day")');
    await p.waitForSelector('.cal-hours', { timeout: 15000 });
    for (let i = 0; i < daysBetween(new Date().toISOString().slice(0, 10), firstDay); i++) {
      await p.click('.cal-move button[aria-label="Next"]');
    }
    await settle();
    ok('is on the calendar, since it is holding the time',
      /Held Meeting/.test(await p.locator('.cal-hours').innerText()));
    ok('and is marked as held rather than agreed',
      (await p.locator('.cal-hours .pill:has-text("Held")').count()) >= 1);

    // ---- On a phone ---------------------------------------------------------------------
    head('On a phone:');
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 }, storageState: await ctx.storageState(),
    });
    const ph = await phone.newPage();
    for (const which of ['Day', 'Week', 'Month']) {
      await ph.goto(`${BASE}/dashboard?tab=calendar`);
      await ph.waitForSelector('.cal-views', { timeout: 20000 });
      await ph.click(`.cal-views button:has-text("${which}")`);
      await ph.waitForTimeout(500);
      const over = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(`${which.toLowerCase()} does not scroll sideways`, over <= 1, `${over}px`);
    }
    await ph.click('.cal-views button:has-text("Week")');
    await ph.waitForSelector('.cal-week', { timeout: 15000 });
    // Wait for the grid itself to settle rather than reading it the instant
    // the element appears: on a loaded machine the first read can land before
    // the stylesheet's media query has been applied, which fails for a reason
    // that has nothing to do with the layout being wrong.
    const stacked = await ph.waitForFunction(() => {
      const w = document.querySelector('.cal-week');
      return w && getComputedStyle(w).gridTemplateColumns.split(' ').length === 1;
    }, { timeout: 15000 }).then(() => true).catch(() => false);
    ok('and a week stacks rather than squeezing seven columns onto a phone', stacked);
    await phone.close();

    ok('no page threw along the way', errors.length === 0, JSON.stringify(errors).slice(0, 200));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nThe calendar is as long as you asked for, and remembers what you asked.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})();
