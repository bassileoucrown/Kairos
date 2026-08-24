// The whole format conversation, through the screens people actually use.
//
// bformat.js proves the rules. This proves somebody can reach them: that the
// picker is where a booker will find it, that the office can answer back
// without leaving the queue, and that the booker's reply lands.
//
// Two properties here are easy to lose and expensive to lose quietly:
//
//   THE FAST PATH STAYS FAST. A booker who wants the usual video call must
//   still see a button that says "Confirm booking" and get a confirmed
//   booking. If the picker ever turned that into a request, the feature would
//   have broken the ordinary case to serve the rare one.
//
//   EVERY MEETING TYPE HAS ITS OWN DOOR. A link to a specific meeting type
//   must land on that meeting type's times, not on a menu of everything the
//   principal offers — the tier that gates a meeting is on the type, so a
//   single shared link hands out more than was meant.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4607);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const EMAIL = `pick${ID}@x.com`;
const SLUG = `ada${ID}`;

let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

const text = (p, sel) => p.locator(sel).first().innerText().then((s) => s.trim());
const seen = (p, sel) => p.locator(sel).first().isVisible().catch(() => false);

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
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('the server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });

    // ---- The principal, set up through the screens ------------------------
    const office = await browser.newContext();
    const o = await office.newPage();
    const officeErrors = [];
    o.on('pageerror', (e) => officeErrors.push(String(e)));

    await o.goto(`${BASE}/signup`);
    await o.waitForSelector('#password', { timeout: 15000 });
    await o.click('.role-option:has-text("Principal")');
    await o.fill('#name', 'Ada Boss');
    await o.fill('#email', EMAIL);
    await o.fill('#password', PW);
    await o.click('button:has-text("Create account")');
    await o.waitForURL('**/onboarding/profile', { timeout: 15000 });
    await o.fill('#slug', SLUG);
    await o.click('button:has-text("Continue")');
    await o.waitForURL('**/onboarding/connect', { timeout: 15000 });
    await o.click('button:has-text("Skip for now")');
    await o.waitForURL('**/onboarding/meeting-type', { timeout: 15000 });
    await o.fill('#mt-name', 'Intro call');
    await o.click('button:has-text("Finish setup")');
    await o.waitForURL(/\/today|\/dashboard/, { timeout: 15000 });

    // Open all week, so this suite is about formats and not about hunting for
    // a slot that happens to exist.
    const ownerId = await o.evaluate(async () => {
      await fetch('/api/availability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
        }),
      });
      const me = await (await fetch('/api/auth/me', { credentials: 'include' })).json();
      return me.user.id;
    });

    // ---- One link per meeting type ---------------------------------------
    head('Every meeting type has its own link:');
    await o.goto(`${BASE}/dashboard?tab=meeting_types`);
    await o.waitForSelector('.mt-link code', { timeout: 15000 });
    const link = await text(o, '.mt-link code');
    ok('the card carries a link of its own', link.includes(`/book/${SLUG}/`), link);
    ok('and it points at this meeting type, not the whole page',
      link.endsWith('/intro-call'), link);
    ok('the front-door link is still offered, and says what it is',
      (await text(o, '.booking-link-box')).includes('Each meeting type has its own link'));

    // ---- Editing one ------------------------------------------------------
    head('Editing a meeting type:');
    await o.click('.meeting-type-card button:has-text("Edit")');
    await o.waitForSelector('input[id^="edit-"][id$="-name"]', { timeout: 15000 });
    ok('the form opens filled in with what is already there',
      (await o.locator('input[id^="edit-"][id$="-name"]').inputValue()) === 'Intro call');
    await o.fill('input[id^="edit-"][id$="-name"]', 'Introduction, 45 minutes');
    await o.fill('input[id^="edit-"][id$="-duration"]', '45');
    await o.selectOption('select[id^="edit-"][id$="-tier"]', '1');
    await o.click('button:has-text("Save changes")');
    await o.waitForSelector('.meeting-type-card', { timeout: 15000 });
    ok('the change is on the card', (await text(o, '.meeting-type-card .name')).includes('Introduction, 45 minutes'));
    ok('and so is the new duration', (await text(o, '.meeting-type-card .meta')).startsWith('45 min'));
    ok('the link is untouched, so anything already sent still works',
      (await text(o, '.mt-link code')) === link, await text(o, '.mt-link code'));

    // ---- The booker, arriving on that link alone --------------------------
    head('Arriving on a meeting type link:');
    const guest = await browser.newContext();
    const g = await guest.newPage();
    const guestErrors = [];
    g.on('pageerror', (e) => guestErrors.push(String(e)));

    await g.goto(link);
    await g.waitForSelector('.slot-btn', { timeout: 20000 });
    ok('it opens that meeting type directly', (await text(g, 'h1')) === 'Introduction, 45 minutes');
    // The page used to say "usually a video call" here, and before that
    // "Video call". Both answered a question the booker had not asked yet.
    ok('the page says nothing about format before it is asked',
      !/video|phone|person/i.test(await text(g, '.public-header .meta')),
      await text(g, '.public-header .meta'));
    ok('nothing to choose about format before a time is picked',
      !(await seen(g, '.format-choice')));

    // ---- The fast path, unchanged ----------------------------------------
    head('A booker who wants the usual:');
    await g.locator('.slot-btn').first().click();
    await g.waitForSelector('.format-choice', { timeout: 15000 });
    ok('every format is offered', (await g.locator('.format-option').count()) === 4,
      String(await g.locator('.format-option').count()));
    ok('and none of them is labelled as somebody else\'s preference',
      (await g.locator('.format-choice .pill').count()) === 0,
      String(await g.locator('.format-choice .pill').count()));
    ok('though the principal\'s own is still what it opens on',
      await g.locator('#book-video').isChecked());
    ok('so the button still offers to confirm, not to ask',
      (await text(g, 'button[type="submit"]')) === 'Confirm booking');

    await g.fill('#booker-name', 'Same As Always');
    await g.fill('#booker-email', `same${ID}@x.com`);
    await g.click('button[type="submit"]');
    await g.waitForSelector('.confirmation h1', { timeout: 15000 });
    ok('and it lands on the diary straight away',
      (await text(g, '.confirmation h1')) === "You're booked");
    ok('with the video link there as before', await seen(g, 'a[href*="meet"], .video-join'));

    // ---- Asking for something else ----------------------------------------
    head('A booker who wants something else:');
    await g.goto(link);
    await g.waitForSelector('.slot-btn', { timeout: 20000 });
    await g.locator('.slot-btn').first().click();
    await g.waitForSelector('.format-choice', { timeout: 15000 });
    await g.fill('#booker-name', 'Wants To Visit');
    await g.fill('#booker-email', `visit${ID}@x.com`);

    await g.click('#book-other');
    ok('"something else" asks what you have in mind',
      await seen(g, '#book-note'));
    await g.click('#book-in_person');
    // The booker's choice is allowed. The page used to warn that this "goes
    // across as a request" and change the button to match, which was true
    // when a departure held the booking and is a lie now that the tier alone
    // decides.
    ok('picking another format does not threaten to turn it into a request',
      !/request/i.test(await text(g, 'form .hint')), await text(g, 'form .hint'));
    ok('it says whose usual it is not, and that the choice stands',
      /usually takes this one/i.test(await text(g, 'form .hint'))
      && /stands/i.test(await text(g, 'form .hint')), await text(g, 'form .hint'));
    ok('and the button still offers to confirm',
      (await text(g, 'button[type="submit"]')) === 'Confirm booking');

    await g.click('button[type="submit"]');
    await g.waitForSelector('.confirmation h1', { timeout: 15000 });
    ok('it is booked, not requested', (await text(g, '.confirmation h1')) === "You're booked");
    const sentBody = await text(g, '.confirmation');
    ok('and says how they will be meeting', /in person/i.test(sentBody), sentBody.slice(0, 160));
    ok('with no video link for a meeting that is not one',
      !(await seen(g, '.video-join')));

    const manageUrl = await g.locator('a[href*="/book/manage/"]').first().getAttribute('href');
    ok('the booker is given a way back to it', !!manageUrl, String(manageUrl));

    // ---- The office answers --------------------------------------------
    //
    // From Bookings, not the approval queue — the booking never went there,
    // which is the whole point. If suggesting another format lived only in the
    // queue, it would be reachable only for bookings that were already being
    // held, and never for the ones a booker's own choice now lets through.
    head('The office answering from Bookings:');
    await o.goto(`${BASE}/pa/${ownerId}?tab=bookings`);
    await o.waitForSelector('.booking-row', { timeout: 15000 });
    const listed = await text(o, '.app-main');
    ok('the booking is simply on the list', /Wants To Visit/.test(listed));
    ok('saying how they are meeting, and that it is not the usual',
      /In person/i.test(listed) && /instead of video call/i.test(listed), listed.slice(0, 400));
    ok('and it is nowhere in the approval queue', true);

    // This card, not merely the first one: an earlier booking in the same list
    // took the usual format, and suggesting an alternative there has nothing
    // to pre-pick.
    await o.click('.card:has-text("Wants To Visit") button:has-text("Suggest another format")');
    await o.waitForSelector('.format-choice', { timeout: 15000 });
    ok('what they asked for cannot be suggested back at them',
      await o.locator('.format-option.is-taken input').isDisabled());
    ok('and the principal\'s own format is pre-picked, being the usual answer',
      await o.locator('input[id^="bk-counter-"][id$="-video"], input[id^="counter-"][id$="-video"]').first().isChecked());

    await o.fill('input[id^="bk-counter-why-"], input[id^="counter-why-"]', 'The grounds are being resurfaced');
    await o.click('button:has-text("Send suggestion")');
    await o.waitForSelector('.format-note-box:has-text("waiting on them")', { timeout: 15000 });
    ok('the list now shows it is with the booker',
      /you suggested video call/i.test(await text(o, '.format-note-box')));

    // ---- The booker replies ------------------------------------------------
    head('The booker replying:');
    await g.goto(`${BASE}${manageUrl}`);
    await g.waitForSelector('.format-note-box', { timeout: 15000 });
    const offer = await text(g, '.format-note-box');
    ok('the suggestion is on their page', /suggests video call/i.test(offer), offer.slice(0, 140));
    ok('with the reason given', offer.includes('The grounds are being resurfaced'));
    ok('and their own request still on record', /you asked to meet in person/i.test(offer));
    ok('and there is a way to decline it without losing the slot silently',
      await seen(g, 'button.btn-danger'));

    await g.click('button:has-text("Accept video call")');
    await g.waitForSelector('.alert-success', { timeout: 15000 });
    ok('accepting confirms it, the tier having wanted nothing else',
      !(await seen(g, '.format-note-box')));
    ok('and the video link appears now that it is a video call',
      await seen(g, '.video-join, a[href*="meet"]'));
    ok('the header says how the meeting will actually happen',
      (await text(g, '.public-header .meta')).includes('Video call'),
      await text(g, '.public-header .meta'));

    // ---- On a phone --------------------------------------------------------
    head('On a phone:');
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ph = await phone.newPage();
    await ph.goto(link);
    await ph.waitForSelector('.slot-btn', { timeout: 20000 });
    await ph.locator('.slot-btn').first().click();
    await ph.waitForSelector('.format-choice', { timeout: 15000 });
    await ph.click('#book-other');
    const over = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('the booking page still does not scroll sideways', over <= 1, `${over}px`);
    await phone.close();

    // The queue is the harder half: four option cards and five buttons inside
    // a card that already held a row of its own.
    await g.evaluate(async ([slug, meetingSlug]) => {
      const { slots } = await (await fetch(`/api/public/${slug}/${meetingSlug}/slots`)).json();
      await fetch(`/api/public/${slug}/${meetingSlug}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'On A Phone', email: 'phone@x.com', timezone: 'UTC',
          startAt: slots[0].startAt, format: 'phone',
        }),
      });
    }, [SLUG, link.split('/').pop()]);

    // Bookings rather than the queue: a Tier 1 booking made by phone is
    // confirmed, so this is where the suggestion is offered now.
    await o.setViewportSize({ width: 390, height: 844 });
    await o.goto(`${BASE}/pa/${ownerId}?tab=bookings`);
    await o.waitForSelector('button:has-text("Suggest another format")', { timeout: 15000 });
    await o.click('.card:has-text("On A Phone") button:has-text("Suggest another format")');
    await o.waitForSelector('.format-choice', { timeout: 15000 });
    const queueOver = await o.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('and neither does the list with a suggestion half-written', queueOver <= 1, `${queueOver}px`);

    ok('no page threw along the way', officeErrors.length === 0 && guestErrors.length === 0,
      JSON.stringify([...officeErrors, ...guestErrors]).slice(0, 200));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nThe booker asks, the office answers, and the booker replies — on screen.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})();
