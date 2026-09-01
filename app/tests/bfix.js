// Changing something that is already there.
//
// WHAT THIS FILE IS ABOUT. Kairos was good at creating things and had almost
// no way to correct one. A pad line with a typo, an itinerary entry at the
// wrong hour, a meeting that turned out to need ninety minutes — each of them
// meant deleting the thing and typing it again, which is not the same act: a
// repeating entry loses its series, a pad line loses the replies hanging off
// it, and an appointment loses the thread with whoever booked it.
//
// The servers already allowed all of this. PATCH /pad/:id has taken a body
// since the pad was built, and PATCH /itinerary/…/items/:id takes every field.
// Nothing on either screen called them. That is the gap this file is about,
// and it is the reason the suite drives a browser rather than the API: an
// endpoint nobody can reach is not shipped.
//
// AND WHAT HAS ALREADY HAPPENED SAYS SO. A day sheet that shows last Tuesday
// exactly as it shows next Tuesday — everything live, nothing settled — is
// asking somebody to work out by eye what they already got through.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

/** Yesterday and tomorrow, as the day sheet addresses them. */
function dayKey(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// Asking the day sheet for a different day is a network round trip and a
// re-render, not a repaint. Twenty seconds was enough every time this suite was
// run on its own and not enough once on a board of a hundred and twelve, where
// the identical wait twenty-five lines earlier had already passed in the very
// same run — same code, same data, same page, one timed out and one did not,
// which is timing and nothing else. The box has form: bconnect records twenty
// seconds and then sixty both proving too short for a server to start here.
//
// Note it cannot be done by URL instead. Itinerary.jsx line 465 seeds its date
// from new Date() and never reads ?date=, so the input is the only way in and
// this wait is unavoidable.
const DAY_LOAD = 60000;

/**
 * Wait for a day's content, and say what was on screen if it never came.
 * A bare "Timeout 20000ms exceeded" cost a diagnosis; the day the app really
 * does stop honouring the date picker, this should be the line that says so
 * rather than the line that looks like the board being slow again.
 */
async function waitForDay(p, re, asked) {
  try {
    await p.waitForFunction(
      (src) => new RegExp(src, 'i').test(document.body.innerText),
      re.source, { timeout: DAY_LOAD },
    );
  } catch (e) {
    const shown = await p.locator('input[aria-label="Day"]').inputValue().catch(() => '??');
    const head = await p.locator('.day-heading').innerText().catch(() => '??');
    const busy = await p.evaluate(() => /loading|…/i.test(document.body.innerText)).catch(() => false);
    throw new Error(
      `never saw /${re.source}/i after asking for ${asked} — `
      + `the picker reads ${shown}, the heading reads ${head}, `
      + `${busy ? 'and the page was still loading' : 'and the page was not loading'}. `
      + `${shown === asked ? 'The app took the date and did not finish.' : 'The app never took the date.'}`,
    );
  }
}

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL || '',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let browser = null;
  try {
    const deadline = Date.now() + 150000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const p = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));

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

    // ---- A line on the pad ------------------------------------------------
    head('A note on the pad can be reworded rather than binned and retyped:');
    await p.goto(`${BASE}/pad`);
    await p.waitForSelector('textarea, .pad-line', { timeout: 20000 });
    await p.fill('.pad-write textarea', 'Chase Bola for teh draft');
    await p.click('.pad-write button:has-text("Jot it")');
    await p.waitForFunction(
      () => /teh draft/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('the line is on the pad', true);

    // The controls live behind the line's own menu, which is where every other
    // thing you can do to a line already lives.
    await p.click('.pad-line button:has-text("Do something")');
    await p.waitForSelector('.pad-actions', { timeout: 20000 });
    ok('the line offers to change its wording',
      (await p.locator('.pad-actions button:has-text("Edit the wording")').count()) === 1);

    await p.click('.pad-actions button:has-text("Edit the wording")');
    await p.waitForSelector('.pad-action-form textarea', { timeout: 20000 });
    // Prefilled with what is there. An edit box that opens empty is a rewrite,
    // and somebody correcting one word should not retype the sentence.
    ok('and opens with what the line already says',
      (await p.locator('.pad-action-form textarea').inputValue()) === 'Chase Bola for teh draft',
      await p.locator('.pad-action-form textarea').inputValue());

    await p.fill('.pad-action-form textarea', 'Chase Bola for the draft');
    await p.click('.pad-action-form button:has-text("Save the wording")');
    await p.waitForFunction(
      () => /Chase Bola for the draft/.test(document.body.innerText)
        && !/teh draft/.test(document.body.innerText),
      null, { timeout: 20000 },
    );
    ok('and saving it changes the line rather than adding a second one', true);
    ok('there is still only one line', (await p.locator('.pad-line').count()) === 1,
      String(await p.locator('.pad-line').count()));

    // ---- An entry on the day ----------------------------------------------
    head('An entry on the itinerary can be corrected in place:');
    await p.goto(`${BASE}/itinerary?date=${dayKey(1)}`);
    await p.waitForSelector('button:has-text("Add item")', { timeout: 20000 });
    // The screen reads its day from its own state rather than the URL, so the
    // date is set through the control a person would use.
    await p.fill('input[aria-label="Day"]', dayKey(1));
    await p.click('button:has-text("Add item")');
    await p.waitForSelector('.itin-form', { timeout: 20000 });
    await p.fill('#itin-title', 'Lunch with Chidi');
    await p.fill('#itin-start', '12:00');
    await p.click('.itin-form button:has-text("Add to the day")');
    await p.waitForFunction(
      () => /Lunch with Chidi/.test(document.body.innerText), null, { timeout: 20000 },
    );
    await p.click('.itin-form button:has-text("Done")');

    await p.waitForSelector('.itin-entry', { timeout: 20000 });
    ok('the entry offers an edit', (await p.locator('.itin-tool:has-text("Edit")').count()) === 1);
    await p.click('.itin-tool:has-text("Edit")');
    await p.waitForSelector('.itin-edit', { timeout: 20000 });
    const prefilled = await p.locator('.itin-edit input[type="time"]').first().inputValue();
    ok('opening it shows the time it is at now', prefilled === '12:00', prefilled);

    await p.fill('.itin-edit input[type="time"] >> nth=0', '13:30');
    await p.fill('.itin-edit input[type="text"] >> nth=0', 'Lunch with Chidi Nwosu');
    await p.click('.itin-edit button:has-text("Save the change")');
    await p.waitForFunction(
      () => /Chidi Nwosu/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('and the change lands on the day', true);
    // THE ASSERTION THIS IS ACTUALLY FOR. An "edit" that creates a second
    // entry and leaves the first is the shape this feature exists to avoid,
    // and it would pass every assertion above.
    ok('without leaving the old one behind',
      (await p.locator('.itin-entry').count()) === 1,
      String(await p.locator('.itin-entry').count()));
    const dayText = await p.locator('.app-body').innerText();
    ok('and the new time is the one shown', /1:30|13:30/.test(dayText), dayText.slice(0, 300));

    // ---- What already happened -------------------------------------------
    head('A day that has been and gone says so:');
    await p.fill('input[aria-label="Day"]', dayKey(-1));
    await p.waitForFunction(
      () => !/Lunch with Chidi/.test(document.body.innerText), null, { timeout: 20000 },
    );
    await p.click('button:has-text("Add item")');
    await p.waitForSelector('.itin-form', { timeout: 20000 });
    await p.fill('#itin-title', 'Board meeting');
    await p.fill('#itin-start', '09:00');
    await p.fill('#itin-end', '10:00');
    await p.click('.itin-form button:has-text("Add to the day")');
    await p.waitForFunction(
      () => /Board meeting/.test(document.body.innerText), null, { timeout: 20000 },
    );
    await p.click('.itin-form button:has-text("Done")');
    await p.waitForSelector('.itin-entry', { timeout: 20000 });

    ok('yesterday\'s entry is marked done',
      (await p.locator('.itin-entry.is-done').count()) === 1,
      String(await p.locator('.itin-entry.is-done').count()));
    ok('and says so in a word rather than only in grey',
      (await p.locator('.itin-entry .pill:has-text("Done")').count()) === 1);
    // The day sheet now agrees with the appointment's own page, which has
    // always said a past meeting cannot be moved or called off.
    ok('and stops offering to make it run late',
      (await p.locator('.itin-tool:has-text("Running late")').count()) === 0);

    head('While a day still to come does not:');
    await p.fill('input[aria-label="Day"]', dayKey(1));
    await p.waitForFunction(
      () => /Chidi Nwosu/.test(document.body.innerText), null, { timeout: 20000 },
    );
    // POSITIVE CONTROL. Without this, "nothing is marked done" would pass just
    // as well on a screen where the marking never works at all.
    ok('tomorrow is not marked done',
      (await p.locator('.itin-entry.is-done').count()) === 0);
    ok('and still offers to make it run late',
      (await p.locator('.itin-tool:has-text("Running late")').count()) === 1);
    ok('and the now line is not drawn on a day that is not today',
      (await p.locator('.day-now-inline, .day-now').count()) === 0,
      String(await p.locator('.day-now-inline, .day-now').count()));

    // ---- An appointment somebody booked -----------------------------------
    head('And an appointment on the day sheet carries what its own page carries:');
    // Built through the API: this file is about the controls, not about
    // driving the public booking page, which bslot already does.
    const slug = `ada${ID}`;
    const mt = await p.evaluate(async () => {
      const post = async (path, body) => (await fetch(`/api${path}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        credentials: 'include', body: JSON.stringify(body),
      })).json();
      await post('/availability', {
        rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek, startTime: '00:00', endTime: '23:30',
        })),
      });
      const r = await fetch('/api/meeting-types', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: 'Intro', durationMinutes: 60, locationType: 'video', accessTier: 1 }),
      });
      return (await r.json()).meetingType;
    });
    const slots = await (await fetch(`${BASE}/api/public/${slug}/${mt.slug}/slots`)).json();
    // The first slot that is not today, so the appointment is in the future
    // however late in the day this suite happens to run.
    const future = (slots.slots || []).find((s) => s.startAt.slice(0, 10) > dayKey(0))
      || (slots.slots || [])[0];
    const booked = await (await fetch(`${BASE}/api/public/${slug}/${mt.slug}/book`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        timezone: 'UTC', startAt: future.startAt,
        name: 'Chidi Nwosu', email: `chidi${ID}@x.com`,
      }),
    })).json();
    // Checked rather than assumed. A failed booking would make every assertion
    // below fail on a timeout, which says "the buttons are missing" when what
    // actually happened is that there is no appointment.
    ok('the appointment was booked', !!booked.booking?.id, JSON.stringify(booked).slice(0, 200));

    // THE DAY IN THE PRINCIPAL'S ZONE, not the UTC prefix of the timestamp.
    //
    // Slicing the ISO string reads the day in UTC, and the itinerary reads it
    // in the principal's own zone — so an appointment at 00:30 Lagos is the
    // 4th to the app and the 3rd to this suite, and the assertions below fail
    // saying the controls are missing when the day sheet is simply on another
    // date. The endpoint says which zone it is working in; use it.
    const zone = (await p.evaluate(async () => (await (await fetch('/api/today', {
      credentials: 'include',
    })).json()).timezone)) || 'UTC';
    const bookedDay = new Intl.DateTimeFormat('en-CA', { timeZone: zone })
      .format(new Date(future.startAt));

    await p.goto(`${BASE}/itinerary`);
    await p.waitForSelector('input[aria-label="Day"]', { timeout: 20000 });
    await p.fill('input[aria-label="Day"]', bookedDay);
    // Case-insensitive: the pill is uppercased by CSS, so innerText returns
    // FROM A BOOKING and matching the source spelling tests the stylesheet.
    await waitForDay(p, /from a booking/, bookedDay);
    // The three the appointment's own page offers under "Change the
    // arrangement", plus the notes. Length was the one this screen did not
    // have, so an assistant had to open the appointment to lengthen a meeting.
    // Running late is on this list because a booked appointment is exactly the
    // kind a principal overruns, and it was the one control the day sheet
    // withheld from them. See lib/cascade.js and blater.js.
    for (const label of ['Running late', 'Move', 'Length', 'Cancel', 'Notes']) {
      ok(`the booking offers ${label}`,
        (await p.locator(`.itin-tool:has-text("${label}")`).count()) >= 1);
    }
    // The recording control lives on the appointment itself. Unconfigured
    // here, so what a tester must see is the control naming the credentials
    // rather than nothing at all. The capture itself is proved in btape.js.
    await p.goto(`${BASE}/appointments/${(await p.evaluate(async () =>
      (await (await fetch('/api/auth/me', { credentials: 'include' })).json()).user.id))}/${booked.booking.id}`);
    await p.waitForSelector('.booking-minutes', { timeout: 20000 });
    await p.waitForSelector('.minute-record', { timeout: 20000 });
    const rec = await p.locator('.minute-record').innerText();
    ok('the appointment says recording is not available here',
      /not available on this deployment/i.test(rec), rec.slice(0, 200));
    ok('and names a credential rather than saying "not configured"',
      /TRANSCRIPTION_ENDPOINT|STORAGE_BUCKET|ENCRYPTION_KEY/.test(rec), rec.slice(0, 300));

    await p.goto(`${BASE}/itinerary`);
    await p.waitForSelector('input[aria-label="Day"]', { timeout: 20000 });
    await p.fill('input[aria-label="Day"]', bookedDay);
    await waitForDay(p, /from a booking/, bookedDay);
    await p.click('.itin-tool:has-text("Length")');
    await p.waitForSelector('input[type="number"]', { timeout: 20000 });
    ok('and Length opens on the length it currently runs',
      (await p.locator('input[type="number"]').inputValue()) === '60',
      await p.locator('input[type="number"]').inputValue());

    // ---- The report, for any days you like --------------------------------
    head('The report can be asked for by date from the screen:');
    await p.goto(`${BASE}/report`);
    await p.waitForSelector('.report-period', { timeout: 20000 });
    ok('the picker is on the screen', true);
    await p.fill('#rp-from', dayKey(-9));
    await p.fill('#rp-to', dayKey(-3));
    await p.click('.report-period button:has-text("Run it")');
    await p.waitForFunction(
      (d) => document.body.innerText.includes(d), dayKey(-9), { timeout: 20000 },
    );
    ok('and running it reports those days', true);
    ok('saying it is a period rather than a week',
      /period you asked for/i.test(await p.locator('.report-head').innerText()),
      await p.locator('.report-head').innerText());
    // The download must follow the period rather than quietly staying weekly.
    const href = await p.locator('.report-download a:has-text("Document")').getAttribute('href');
    ok('and the download asks for the same days',
      href.includes(`from=${dayKey(-9)}`) && href.includes(`to=${dayKey(-3)}`), href);

    ok('the way back to whole weeks is offered',
      (await p.locator('.report-period button:has-text("Back to weeks")').count()) === 1);
    await p.click('.report-period button:has-text("Back to weeks")');
    await p.waitForFunction(
      () => /Last week|The week so far/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('and taking it goes back to them', true);

    head('And the principal is shown who opened what:');
    ok('the trail is on their own report',
      (await p.locator('.report-trail').count()) === 1,
      String(await p.locator('.report-trail').count()));

    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    proc.kill();
  }

  console.log(fails === 0
    ? '\nWhat is already written can be corrected, and what already happened says so.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
