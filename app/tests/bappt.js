// The appointment page: one place that holds a meeting and every verb for it.
//
// WHAT WENT WRONG WITHOUT IT. Every verb already worked and none of them was
// in the same place. Cancelling lived in the Bookings tab, moving on the day
// sheet, notes in a panel on Today, the length nowhere at all. So somebody who
// clicked the appointment itself — which is what a person does — got nothing,
// and reported, correctly, that a booked appointment could not be edited.
//
// Two things are proved here. That the click leads somewhere: the title on the
// day sheet is a way in, and what it leads to is that appointment and not
// another. And that the page's verbs are real — in particular the new one,
// length, which is its own act rather than a field inside a move, because
// running twenty minutes over is not the same decision as moving to Thursday.
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
    let d = null;
    try { d = text ? JSON.parse(text) : null; } catch { d = text; }
    return { s: r.status, d, cookie };
  };
}

const mins = (b) => Math.round((Date.parse(b.endAt) - Date.parse(b.startAt)) / 60000);

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
    // A minute. Twenty seconds is plenty on an idle machine and not plenty on a
    // loaded one, and "no server" on a green tree is a board crying wolf.
    const deadline = Date.now() + 60000;
    for (;;) {
      try { const r = await (await fetch(`${BASE}/api/status`)).json(); if (r.databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = client();
    await boss('POST', '/auth/signup', { name: 'Adaeze Okonkwo', email: `boss${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const me = (await boss('GET', '/auth/me')).d.user;
    await boss('PATCH', '/profile', { slug: `adaeze-${ID}`, timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    // Open around the clock so nothing here depends on the hour it runs at.
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
    });
    const mt = (await boss('POST', '/meeting-types', {
      name: 'Intro', durationMinutes: 30, locationType: 'video', accessTier: 1,
    })).d.meetingType;

    const anon = client();
    const slots = (await anon('GET', `/public/adaeze-${ID}/${mt.slug}/slots`)).d.slots || [];
    await anon('POST', `/public/adaeze-${ID}/${mt.slug}/book`, {
      timezone: 'UTC', startAt: slots[0].startAt, name: 'Chidi Eze', email: `chidi${ID}@x.com`,
    });
    const booking = (await boss('GET', '/bookings')).d.bookings[0];

    // --- One request, the whole appointment --------------------------------
    head('The page asks once and gets everything:');
    let r = await boss('GET', `/bookings/${booking.id}`);
    ok('the appointment comes back', r.s === 200 && r.d.booking?.id === booking.id, JSON.stringify(r.d).slice(0, 160));
    ok('with what has been said about it', Array.isArray(r.d.notes), typeof r.d.notes);
    ok('and what has happened to it', Array.isArray(r.d.trail) && r.d.trail.length > 0,
      JSON.stringify(r.d.trail || []).slice(0, 120));
    // Everything on that page is a time, and an assistant is regularly not in
    // the same country as the diary they keep. Rendering in the browser's zone
    // would move every appointment on screen by the offset between them.
    ok('and the zone those times are meant to be read in', r.d.timezone === 'UTC', r.d.timezone);

    r = await boss('GET', `/bookings/${'x'.repeat(12)}`);
    ok('an appointment that is not yours is not found', r.s === 404, String(r.s));

    // --- Length, as its own act --------------------------------------------
    head('The length can be changed without moving anything:');
    r = await boss('POST', `/bookings/${booking.id}/duration`, { minutes: 60 });
    ok('a longer meeting is accepted', r.s === 200, JSON.stringify(r.d).slice(0, 160));
    ok('it now runs an hour', mins(r.d.booking) === 60, String(mins(r.d.booking)));
    ok('and starts exactly where it always did', r.d.booking.startAt === booking.startAt,
      `${r.d.booking.startAt} vs ${booking.startAt}`);

    r = await boss('GET', '/emails');
    const told = (r.d.emails || []).find((e) => /^Now 60 minutes/.test(e.subject || ''));
    ok('the booker is told, because their afternoon just changed', !!told,
      JSON.stringify((r.d.emails || []).map((e) => e.subject)).slice(0, 240));

    r = await boss('GET', `/bookings/${booking.id}/trail`);
    const line = (r.d.trail || []).find((t) => /relengthened/.test(t.kind || ''));
    ok('and it is on the record', !!line, JSON.stringify(r.d.trail || []).slice(0, 200));
    ok('naming both lengths, not just the new one',
      /30/.test(line?.headline || '') && /60/.test(line?.headline || ''), line?.headline);

    head('And what it refuses:');
    r = await boss('POST', `/bookings/${booking.id}/duration`, { minutes: 60 });
    ok('a change that changes nothing', r.s === 400, String(r.s));
    ok('and says so plainly', /already runs/i.test(r.d?.error || ''), r.d?.error);
    r = await boss('POST', `/bookings/${booking.id}/duration`, { minutes: 2 });
    ok('a meeting too short to be one', r.s === 400, String(r.s));
    r = await boss('POST', `/bookings/${booking.id}/duration`, { minutes: 900 });
    ok('and one longer than a working day', r.s === 400, String(r.s));
    r = await boss('POST', `/bookings/${booking.id}/duration`, {});
    ok('no length at all', r.s === 400, String(r.s));

    // Growing a meeting into the next one is the same wrong as moving it there.
    head('Growing into the next appointment is refused like any other clash:');
    const next = (await anon('GET', `/public/adaeze-${ID}/${mt.slug}/slots`)).d.slots
      .find((s) => Date.parse(s.startAt) > Date.parse(booking.startAt));
    await anon('POST', `/public/adaeze-${ID}/${mt.slug}/book`, {
      timezone: 'UTC', startAt: next.startAt, name: 'Ngozi Okafor', email: `ngozi${ID}@x.com`,
    });
    const gap = Math.round((Date.parse(next.startAt) - Date.parse(booking.startAt)) / 60000);
    r = await boss('POST', `/bookings/${booking.id}/duration`, { minutes: gap + 30 });
    ok('running long enough to swallow it is refused', r.s === 409, `${r.s} · gap ${gap}`);
    ok('and names who is in the way', /Ngozi/.test(r.d?.error || ''), r.d?.error);
    r = await boss('GET', `/bookings/${booking.id}`);
    ok('the refused change left the meeting alone', mins(r.d.booking) === 60, String(mins(r.d.booking)));

    // --- Where there is room ------------------------------------------------
    //
    // The move form used to be two bare boxes: you typed a time, pressed Move,
    // and found out from a red banner whether anything was already there.
    head('The day says where there is room:');
    // PINNED TO A FIXED DAY, deliberately. This used to ask about whatever day
    // the slot grid happened to hand out, which is usually today — and the
    // office day runs 06:00 to 22:00, so a run after ten at night found no
    // future openings and failed on a product that was behaving correctly.
    // A fixture that depends on the hour it runs at is not testing the thing
    // it claims to.
    const dayKey = '2027-06-15';
    const ngoziBooking = (await boss('GET', '/bookings')).d.bookings
      .find((b) => /Ngozi/.test(b.bookerName));
    await boss('POST', `/bookings/${ngoziBooking.id}/reschedule`, { startAt: `${dayKey}T14:00:00.000Z` });
    await boss('POST', `/bookings/${booking.id}/reschedule`, { startAt: `${dayKey}T09:00:00.000Z` });
    r = await boss('GET', `/bookings/${booking.id}/openings?date=${dayKey}`);
    ok('the day comes back', r.s === 200, JSON.stringify(r.d).slice(0, 200));
    ok('with times to choose from', (r.d.openings || []).length > 0, String((r.d.openings || []).length));
    ok('and what is already on it', (r.d.busy || []).some((b) => /Ngozi/.test(b.label)),
      JSON.stringify((r.d.busy || []).map((b) => b.label)));
    ok('measured for this meeting\'s own length', r.d.minutes === 60, String(r.d.minutes));

    // THE PROPERTY THIS WHOLE FEATURE RESTS ON. A picker that offers a time
    // the verb then refuses is worse than no picker: it invites the mistake it
    // was built to prevent. So no opening may overlap a live booking.
    const busyBookings = (r.d.busy || []).filter((b) => b.kind === 'booking');
    const bad = (r.d.openings || []).filter((o) => busyBookings.some(
      (b) => Date.parse(o.startAt) < Date.parse(b.endAt) && Date.parse(o.endAt) > Date.parse(b.startAt),
    ));
    ok('and not one of them collides with what is already there',
      bad.length === 0, JSON.stringify(bad.slice(0, 2)));

    // The appointment's own slot must be offered — it is not in its own way.
    ok('its own current time is not treated as taken',
      !(r.d.busy || []).some((b) => b.id === booking.id),
      JSON.stringify((r.d.busy || []).map((b) => b.id)));

    // AND THE OTHER HALF. The office is not confined to the published hours —
    // lib/rescheduleBooking.js is explicit about it — so a picker that only
    // ever offered bookable slots would quietly take that away. Availability
    // above is 00:00–23:30, so the office day's edges are what to look at.
    head('And it is not the public slot grid:');
    ok('the day runs earlier than anyone could book',
      new Date(r.d.dayStartsAt).getUTCHours() === 6, r.d.dayStartsAt);
    ok('and later', new Date(r.d.dayEndsAt).getUTCHours() === 22, r.d.dayEndsAt);
    ok('every offered time says whether a stranger could have taken it',
      (r.d.openings || []).every((o) => typeof o.withinHours === 'boolean'));
    // Quarter-hours, not the meeting's own length: the office is fitting
    // something into a gap, and a gap rarely begins on the half hour.
    ok('and they step by the quarter hour',
      (r.d.openings || []).every((o) => new Date(o.startAt).getUTCMinutes() % 15 === 0),
      JSON.stringify((r.d.openings || []).slice(0, 3).map((o) => o.startAt)));

    head('A day nobody could use says so rather than coming back empty:');
    r = await boss('GET', `/bookings/${booking.id}/openings?date=not-a-day`);
    ok('a date that is not a date is refused', r.s === 400, String(r.s));
    ok('and says so plainly', /not a date/i.test(r.d?.error || ''), r.d?.error);

    // --- The assistant's copy of the same page -----------------------------
    head('An assistant reaches the same page and the same verbs:');
    const inv = await boss('POST', '/members', { email: `pa${ID}@x.com`, role: 'chief_of_staff' });
    const pa = client();
    await pa('POST', '/auth/signup', { name: 'Kit Staff', email: `pa${ID}@x.com`, password: PW, accountCategory: 'chief_of_staff' });
    await pa('PATCH', '/profile', { slug: `kit-${ID}` });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`, {});

    r = await pa('GET', `/pa/${me.id}/bookings/${booking.id}`);
    ok('they get the whole appointment too', r.s === 200 && r.d.booking?.id === booking.id, String(r.s));
    ok('in the principal\'s zone, not their own', r.d.timezone === 'UTC', r.d.timezone);
    r = await pa('GET', `/pa/${me.id}/bookings/${booking.id}/openings?date=${dayKey}`);
    ok('and the same read of where there is room', r.s === 200 && (r.d.openings || []).length > 0,
      JSON.stringify(r.d).slice(0, 160));
    r = await pa('POST', `/pa/${me.id}/bookings/${booking.id}/duration`, { minutes: 45 });
    ok('and can change the length in their principal\'s name', r.s === 200, JSON.stringify(r.d).slice(0, 160));
    ok('which lands', mins(r.d.booking) === 45, String(mins(r.d.booking)));

    const outsider = client();
    await outsider('POST', '/auth/signup', { name: 'Someone Else', email: `else${ID}@x.com`, password: PW });
    r = await outsider('GET', `/pa/${me.id}/bookings/${booking.id}`);
    ok('somebody with no business here gets nothing', r.s === 403, String(r.s));
    r = await outsider('POST', `/pa/${me.id}/bookings/${booking.id}/duration`, { minutes: 15 });
    ok('and cannot stretch a stranger\'s meeting', r.s === 403, String(r.s));
    // A day's openings are a read of somebody's diary — who is busy when is
    // exactly what an outsider must not be able to ask for.
    r = await outsider('GET', `/pa/${me.id}/bookings/${booking.id}/openings?date=${dayKey}`);
    ok('nor read their day', r.s === 403, String(r.s));

    // --- The click ----------------------------------------------------------
    // The whole complaint was that clicking an appointment did nothing. The
    // rest of this suite proves the page works; this proves you can get to it.
    head('Clicking the appointment on the day sheet opens it:');
    // Ngozi's meeting was booked above to prove the clash rule, and its slot
    // may well be today. Call it off first so the move below cannot be refused
    // by it — and so the day sheet carries exactly one appointment to click.
    const others = (await boss('GET', '/bookings')).d.bookings.filter((b) => b.id !== booking.id);
    for (const b of others) await boss('POST', `/bookings/${b.id}/cancel`, {});

    // Put it on today so the day sheet carries it — AHEAD OF NOW, not at a
    // fixed hour. It used to be 13:00 UTC, which is fine in the morning and a
    // guaranteed failure every afternoon: an appointment that has finished no
    // longer offers Move, Length or Call it off, so the assertions below found
    // no buttons and blamed the page.
    const soon = new Date(Date.now() + 10 * 60000);

    // AND STOP THE WALL CLOCK DECIDING WHICH DAY THIS IS. "Ten minutes out"
    // fixed the afternoon and left midnight: run this at 23:59 and the
    // appointment lands on TOMORROW's sheet, so Today is empty and the failure
    // reads as a page that will not draw an appointment. It did exactly that.
    //
    // The day sheet is rendered in the principal's zone, so rather than hunt
    // for an hour that works everywhere, the principal is moved to a zone
    // where this instant is mid-morning. Ten minutes ago is the same local day
    // as ten minutes from now at 10am in a way it never is at midnight, and
    // that holds whatever the machine's clock says.
    const ahead = ((10 - soon.getUTCHours()) + 24) % 24;
    const zone = ahead === 0 ? 'UTC'
      : ahead <= 14 ? `Etc/GMT-${ahead}` : `Etc/GMT+${24 - ahead}`;
    ok('the principal can be put in a zone where this is mid-morning',
      (await boss('PATCH', '/profile', { timezone: zone })).s === 200, zone);
    r = await boss('POST', `/bookings/${booking.id}/reschedule`, { startAt: soon.toISOString() });
    ok('it can be put on today to be clicked', r.s === 200, JSON.stringify(r.d).slice(0, 160));

    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    await page.goto(`${BASE}/login`);
    await page.fill('#email', `boss${ID}@x.com`);
    await page.fill('#password', PW);
    await page.click('button:has-text("Log in")');
    await page.waitForURL('**/today', { timeout: 20000 });

    const href = `/appointments/${me.id}/${booking.id}`;
    // By href rather than "the first link on the sheet": the assertion is that
    // this appointment's name leads to THIS appointment.
    await page.waitForSelector(`.sched-title-link[href="${href}"]`, { timeout: 20000 });
    await page.click(`.sched-title-link[href="${href}"]`);
    await page.waitForURL(`**${href}`, { timeout: 20000 });
    ok('the click lands on that appointment and no other', true);

    // waitForURL fires on the URL changing, not on the page having drawn, so
    // wait for something only this page renders before reading anything.
    await page.waitForSelector('button:has-text("Change the length")', { timeout: 20000 });
    const shown = await page.locator('.booking-row').first().innerText();
    ok('and it names who is coming', /Chidi Eze/.test(shown), shown.slice(0, 160));
    ok('and how long it runs', /45 min/.test(shown), shown.slice(0, 160));

    head('And the verbs are there, on the appointment itself:');
    for (const verb of ['Move it', 'Change the length', 'Call it off']) {
      ok(`“${verb}” is on the page`, (await page.locator(`button:has-text("${verb}")`).count()) > 0);
    }

    await page.click('button:has-text("Change the length")');
    await page.waitForSelector('#bd-mins', { timeout: 10000 });
    await page.fill('#bd-mins', '90');
    await page.click('button.btn-primary:has-text("Change the length")');
    // The page reloads itself from the server after the change, so the proof
    // is what comes back, not what was typed.
    await page.waitForSelector('.booking-row:has-text("1h 30m")', { timeout: 20000 });
    ok('changing the length from the page works end to end', true);

    r = await boss('GET', `/bookings/${booking.id}`);
    ok('and the diary agrees with the screen', mins(r.d.booking) === 90, String(mins(r.d.booking)));

    head('Moving it shows the day rather than asking you to guess:');
    await page.click('button:has-text("Move it")');
    // The picker opens on the appointment's own day, which is today. Late in
    // the evening today genuinely has no room left — the office day ends at
    // ten — and the picker says so rather than showing an empty grid. Stepping
    // to the next day is what somebody would actually do, and it makes this
    // assertion independent of the hour the suite runs at.
    await page.waitForSelector('.move-picker', { timeout: 20000 });
    await page.click('.move-day button:has-text("→")');
    await page.waitForSelector('.move-picker .slot-grid .slot-btn', { timeout: 20000 });
    const offered = await page.locator('.move-picker .slot-btn').count();
    ok('free times are on screen to pick from', offered > 0, String(offered));
    ok('and the typed time is still there for anything else',
      (await page.locator('#mv-time').count()) === 1);

    const before = (await boss('GET', `/bookings/${booking.id}`)).d.booking.startAt;
    await page.click('.move-picker .slot-btn');
    // The primary Move it inside the picker, not the toggle that opened it.
    await page.click('.move-picker button.btn-primary:has-text("Move it")');
    await page.waitForSelector('button:has-text("Change the length")', { timeout: 20000 });
    r = await boss('GET', `/bookings/${booking.id}`);
    ok('clicking one moves the appointment there', r.d.booking.startAt !== before,
      `${before} -> ${r.d.booking.startAt}`);
    ok('and it keeps the length it had', mins(r.d.booking) === 90, String(mins(r.d.booking)));

    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nAn appointment is a page you can open, and everything you may do to it is on it.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
