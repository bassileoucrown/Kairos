// The movement screens, from the point of view of somebody using them.
//
// WHY THIS EXISTS BESIDE bmove. That suite proves the access rule — who may
// see a journey, what a stand-in is given, what is withheld. Every one of its
// assertions would pass with no screen at all, which is the exact failure
// breach.js was written to catch: a rule nobody can reach is not shipped.
//
// So this file only asks: can a person sitting in front of the app arrange a
// journey, put a car on the books with its papers, hand the journey to a
// colleague, and — the one that matters — can that colleague TELL they are
// looking at half of it. A redacted screen that does not admit it is redacted
// is worse than no screen, because the reader believes it.
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

async function onboard(p, name, email, role) {
  await p.goto(`${BASE}/signup`);
  await p.click(`.role-option:has-text("${role}")`);
  await p.fill('#name', name);
  await p.fill('#email', email);
  await p.fill('#password', PW);
  await p.click('button:has-text("Create account")');
  await p.waitForURL('**/onboarding/profile', { timeout: 20000 });
  await p.fill('#slug', email.split('@')[0]);
  await p.click('button:has-text("Continue")');
  await p.waitForURL('**/onboarding/connect', { timeout: 20000 });
  await p.click('button:has-text("Skip for now")');
  await p.waitForURL(/onboarding\/meeting-type|workspace|today/, { timeout: 20000 });
  if (p.url().includes('meeting-type')) {
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL(/today|workspace/, { timeout: 20000 });
  }
}

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
    const deadline = Date.now() + 150000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    const bossEmail = `ada${ID}@x.com`;
    await onboard(page, 'Adaeze Okonkwo', bossEmail, 'Principal');

    // The colleague who will cover. Onboarded in their own window, and made a
    // member of the office through the invite the principal sends.
    const other = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const cos = await other.newPage();
    const cosErrs = [];
    cos.on('pageerror', (e) => cosErrs.push(e.message));
    const cosEmail = `tunde${ID}@x.com`;
    await onboard(cos, 'Tunde Bakare', cosEmail, 'Assistant');
    const link = await page.evaluate(async (email) => {
      const r = await fetch('/api/members', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role: 'chief_of_staff' }),
      });
      return (await r.json()).inviteLink;
    }, cosEmail);
    await cos.goto(`${BASE}/accept-invite/${link.split('/').pop()}`);
    await cos.waitForSelector('button:has-text("Accept")', { timeout: 20000 });
    await cos.click('button:has-text("Accept")');
    await cos.waitForTimeout(1000);

    // ---- Reaching it at all -------------------------------------------------
    head('A tester can find the screen without being told the URL:');
    await page.goto(`${BASE}/today`);
    // The rail, not the address bar. A page reachable only by typing its path
    // is a page that does not exist as far as a tester is concerned.
    await page.waitForSelector('a[href="/movements"]', { timeout: 20000 });
    await page.click('a[href="/movements"]');
    await page.waitForURL('**/movements**', { timeout: 20000 });
    // Waiting for the tab strip rather than for .card: the shell renders
    // before the page has anything in it, and a wait that is already satisfied
    // during "Loading…" measures nothing.
    await page.waitForSelector('.tab-btn:has-text("The cars")', { timeout: 20000 });
    ok('Movements is in the rail and opens', page.url().includes('/movements'));

    // ---- The cars -----------------------------------------------------------
    head('The cars go on the books, papers and all:');
    await page.click('.tab-btn:has-text("The cars")');
    await page.waitForSelector('button:has-text("Add a car")', { timeout: 20000 });
    await page.click('button:has-text("Add a car")');
    await page.fill('#veh-label', 'The black Prado');
    await page.fill('#veh-plate', 'ABC-123-XY');
    await page.fill('#veh-colour', 'Black');
    await page.click('button:has-text("Add the car")');
    await page.waitForSelector('.movement-vehicle', { timeout: 20000 });
    ok('a car can be added by hand', true);

    await page.click('.movement-vehicle button:has-text("Record a paper")');
    await page.waitForSelector('.movement-inline select', { timeout: 20000 });
    const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    await page.selectOption('.movement-inline select', 'insurance');
    await page.fill('.movement-inline input[type="text"]', 'POL-9911');
    await page.fill('.movement-inline input[type="date"]', past);
    await page.click('button:has-text("Record")');
    await page.waitForSelector('.movement-paper', { timeout: 20000 });
    const paperText = await page.locator('.movement-paper').first().innerText();
    // The verdict has to be ON THE SCREEN. A date the reader has to compare
    // against today in their head is not a warning.
    ok('an insurance certificate that has run out says so on the screen',
      /expired/i.test(paperText), paperText);

    // ---- Arranging a journey ------------------------------------------------
    head('A journey is arranged through the form, not the API:');
    await page.click('.tab-btn:has-text("Journeys")');
    await page.waitForSelector('button:has-text("Arrange a journey")', { timeout: 20000 });
    await page.click('button:has-text("Arrange a journey")');
    await page.fill('#mv-title', 'To the Lekki site');
    await page.fill('#mv-from', 'Ikoyi residence');
    await page.fill('#mv-to', 'Lekki Phase 1');
    const soon = new Date(Date.now() + 2 * 3600000);
    const pad = (n) => String(n).padStart(2, '0');
    await page.fill('#mv-at', `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`
      + `T${pad(soon.getHours())}:${pad(soon.getMinutes())}`);
    await page.fill('#mv-notes', 'Avoid the coast road');
    await page.click('button:has-text("Arrange it")');
    await page.waitForSelector('h2:has-text("To the Lekki site")', { timeout: 20000 });
    ok('it opens on the journey it just made', true);

    await page.selectOption('.movement-inline select[aria-label="Which car"]', { label: 'The black Prado' });
    await page.click('button:has-text("Add the car")');
    await page.waitForSelector('.movement-line:has-text("ABC-123-XY")', { timeout: 20000 });
    // The plate came from the fleet without being retyped: that is the point of
    // choosing a car rather than describing one.
    ok('choosing a car from the fleet brings its plate with it', true);

    await page.selectOption('select[aria-label="Their role"]', 'driver');
    await page.fill('input[aria-label="Name"]', 'Sunday Eze');
    await page.fill('input[aria-label="Phone"]', '+2348030000001');
    await page.click('button:has-text("Add them")');
    await page.waitForSelector('.movement-line:has-text("Sunday Eze")', { timeout: 20000 });
    await page.selectOption('select[aria-label="Their role"]', 'escort_lead');
    await page.fill('input[aria-label="Name"]', 'Inspector Musa');
    await page.click('button:has-text("Add them")');
    await page.waitForSelector('.movement-line:has-text("Inspector Musa")', { timeout: 20000 });
    ok('a driver and an escort can be put on it', true);

    // ---- Handing it over ----------------------------------------------------
    head('And handed to a colleague when the arranger cannot be there:');
    await page.waitForSelector('select[aria-label="Who is covering"]', { timeout: 20000 });
    await page.selectOption('select[aria-label="Who is covering"]', { label: 'Tunde Bakare' });
    await page.fill('input[aria-label="Why"]', 'I am out on Thursday');
    await page.click('button:has-text("Hand it over")');
    await page.waitForSelector('.movement-grant', { timeout: 20000 });
    const grantText = await page.locator('.movement-grant').first().innerText();
    ok('the hand-over is listed with when it lapses',
      /Tunde Bakare/.test(grantText) && /until/i.test(grantText), grantText);

    // ---- What the stand-in sees --------------------------------------------
    head('The stand-in gets the journey, and can tell it is not all of it:');
    await cos.goto(`${BASE}/movements`);
    await cos.waitForSelector('.movement-row', { timeout: 20000 });
    const rowText = await cos.locator('.movement-row').first().innerText();
    ok('it is in their list where they will look for it',
      /To the Lekki site/.test(rowText), rowText);
    ok('marked as partial before they even open it', /partial/i.test(rowText), rowText);

    await cos.click('.movement-row');
    await cos.waitForSelector('.movement-partial', { timeout: 20000 });
    const banner = await cos.locator('.movement-partial').innerText();
    // THE ASSERTION THIS FILE EXISTS FOR. Silently redacted is worse than
    // withheld: they will tell somebody there is no escort.
    ok('the screen says out loud that they are seeing part of it',
      /part of this journey/i.test(banner), banner);
    // One escort withheld and no backup car on this journey, so one — and the
    // sentence has to read as English for that case too, not "1 details".
    ok('and says how much is not shown, counted correctly',
      /1 detail is not shown to you/.test(banner), banner);

    const body = await cos.locator('.movement-detail').innerText();
    ok('they get the driver to ring', /Sunday Eze/.test(body));
    ok('and the car', /ABC-123-XY/.test(body));
    ok('the escort is not on their screen', !/Musa/.test(body), body.slice(0, 300));
    ok('nor the principal\'s notes', !/coast road/.test(body));
    // POSITIVE CONTROL for the two absences above: those words ARE on the
    // arranger's screen, so their absence here is redaction and not a page
    // that failed to load.
    const mine = await page.locator('.movement-detail').innerText();
    ok('though both are on the arranger\'s screen',
      /Musa/.test(mine) && /coast road/.test(mine), mine.slice(0, 300));

    // No way to edit what you were lent.
    ok('they are given no way to add to it',
      (await cos.locator('button:has-text("Add them")').count()) === 0);
    ok('nor to hand it on',
      (await cos.locator('button:has-text("Hand it over")').count()) === 0);
    // But the one thing they are most likely to know.
    await cos.click('button:has-text("They arrived")');
    await cos.waitForSelector('.movement-detail:has-text("Arrived")', { timeout: 20000 });
    ok('but they can say the principal arrived', true);

    // ---- Taking it back -----------------------------------------------------
    head('And taken back:');
    await page.reload();
    await page.waitForSelector('.movement-row', { timeout: 20000 });
    await page.click('.movement-row');
    await page.waitForSelector('.movement-grant', { timeout: 20000 });
    // Two clicks, deliberately: the first arms it, the second does it.
    await page.click('.movement-grant button:has-text("Take it back")');
    await page.waitForSelector('button:has-text("Sure?")', { timeout: 20000 });
    await page.click('button:has-text("Sure?")');
    await page.waitForSelector('.movement-grant:has-text("Taken back")', { timeout: 20000 });
    ok('the hand-over can be taken back from the screen', true);

    await cos.goto(`${BASE}/movements`);
    await cos.waitForSelector('.empty-state, .movement-row', { timeout: 20000 });
    ok('after which the journey is gone from their list',
      (await cos.locator('.movement-row').count()) === 0);

    // ---- The alarm, on the day sheet ----------------------------------------
    head('And a journey nobody confirmed arrived reaches the day sheet:');
    // A journey that departed three hours ago and should have taken 45
    // minutes. Built through the API because this section is about whether the
    // ALARM is reachable, not about the form, which is exercised above.
    await page.evaluate(async (owner) => {
      await fetch(`/api/movement/${owner}/movements`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'To the airport',
          departsFrom: 'Ikoyi', destination: 'MMIA',
          departsAt: new Date(Date.now() - 3 * 3600000).toISOString(),
          expectedMinutes: 45,
        }),
      });
    }, await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).user.id));

    await page.goto(`${BASE}/today`);
    await page.waitForSelector('.needs-card', { timeout: 20000 });
    const urgent = await page.locator('.needs-card:has-text("No arrival yet")');
    ok('the missing arrival is on Today', (await urgent.count()) === 1,
      await page.locator('.app-body').innerText().catch(() => ''));
    const alarm = await urgent.innerText();
    ok('and says where they should have been', /MMIA/.test(alarm), alarm);
    ok('and how late', /minutes ago/.test(alarm), alarm);
    // A card with no way out of it is a card that tells somebody they have a
    // problem and leaves them to go hunting for it.
    ok('and leads to the journey',
      (await urgent.locator('a[href="/movements"]').count()) === 1);

    // ---- The card the driver holds ------------------------------------------
    head('And the driver gets a card that works on a phone with no account:');
    // A FRESH journey. The one above was already marked arrived by the
    // stand-in, and a card for a finished journey correctly shows no "we have
    // arrived" button — which would make the click below assert nothing.
    await page.evaluate(async () => {
      const me = (await (await fetch('/api/auth/me')).json()).user.id;
      await fetch(`/api/movement/${me}/movements`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'The evening run', departsFrom: 'Ikoyi', destination: 'Lekki',
          departsAt: new Date(Date.now() - 600000).toISOString(), expectedMinutes: 60,
        }),
      });
    });
    await page.goto(`${BASE}/movements`);
    await page.waitForSelector('.movement-row', { timeout: 20000 });
    await page.click('.movement-row:has-text("The evening run")');
    await page.waitForSelector('.movement-enroute', { timeout: 20000 });
    ok('the office can reach the journey controls', true);

    await page.click('button:has-text("Give the driver a card")');
    await page.waitForSelector('.movement-enroute code', { timeout: 20000 });
    const cardLink = await page.locator('.movement-enroute code').innerText();
    ok('and is given a link to send', /\/drive\//.test(cardLink), cardLink);

    // A PHONE, and a browser that has never signed in. If this needed a
    // session the whole feature would be pointless.
    const phoneCtx = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    });
    const phone = await phoneCtx.newPage();
    const phoneErrs = [];
    phone.on('pageerror', (e) => phoneErrs.push(e.message));
    await phone.goto(`${BASE}${cardLink.replace(/^.*(\/drive\/)/, '$1')}`);
    await phone.waitForSelector('.drive-card', { timeout: 20000 });
    const face = await phone.locator('.drive-card').innerText();
    ok('the card opens with no account at all', /Lekki/.test(face), face.slice(0, 200));
    // THE ASSERTION THIS SECTION EXISTS FOR. The link has no password.
    ok('and it names nobody', !/Adaeze|Okonkwo|Musa/.test(face), face.slice(0, 300));

    // The page must not scroll sideways on a phone at a kerb.
    const wide = await phone.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    ok('and does not run off the side of the phone', !wide);

    await phone.click('button:has-text("We have arrived")');
    await phone.waitForSelector('.drive-arrived', { timeout: 20000 });
    ok('the driver can say they arrived', true);

    // Two presses, never one. A single-tap alarm is one a pocket raises.
    await phone.goto(`${BASE}${cardLink.replace(/^.*(\/drive\/)/, '$1')}`);
    await phone.waitForSelector('.drive-duress', { timeout: 20000 });
    await phone.click('.drive-duress');
    await phone.waitForSelector('button:has-text("Yes — tell them now")', { timeout: 20000 });
    ok('the alarm asks once before it fires', true);
    await phone.click('button:has-text("Yes — tell them now")');
    await phone.waitForFunction(
      () => /something is wrong/i.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('and the card says the office has been told', true);

    // And it reaches the office's own day sheet, loudly.
    await page.goto(`${BASE}/today`);
    await page.waitForSelector('.needs-card', { timeout: 20000 });
    ok('the alarm is on the office\'s day sheet',
      (await page.locator('.needs-card.is-duress').count()) === 1,
      await page.locator('.app-body').innerText().catch(() => ''));

    // ---- The drivers, and a journey that repeats -----------------------------
    head('The drivers are on the books, and a repeating run is laid down:');
    await page.goto(`${BASE}/movements?tab=drivers`);
    await page.waitForSelector('button:has-text("Add a driver")', { timeout: 20000 });
    await page.click('button:has-text("Add a driver")');
    await page.fill('#drv-name', 'Sunday Eze');
    await page.fill('#drv-phone', '+2348030000001');
    await page.click('button:has-text("Add the driver")');
    await page.waitForSelector('.movement-vehicle:has-text("Sunday Eze")', { timeout: 20000 });
    ok('a driver can be added by hand', true);

    await page.click('.movement-vehicle button:has-text("Record a paper")');
    await page.waitForSelector('select[aria-label="Kind of paper"]', { timeout: 20000 });
    await page.selectOption('select[aria-label="Kind of paper"]', 'licence');
    await page.fill('input[aria-label="Paper reference"]', 'LIC-9');
    await page.fill('input[aria-label="Paper expires on"]', past);
    await page.click('button:has-text("Record")');
    await page.waitForSelector('.movement-paper', { timeout: 20000 });
    const dText = await page.locator('.movement-vehicle:has-text("Sunday Eze")').innerText();
    // The same verdict a passport gets, and the same words.
    ok('a lapsed licence says so on the screen', /expired/i.test(dText), dText.slice(0, 200));
    ok('and the driver is flagged as one who should not be driving',
      /should not be driving/i.test(dText), dText.slice(0, 200));

    await page.goto(`${BASE}/movements`);
    await page.waitForSelector('button:has-text("One that repeats")', { timeout: 20000 });
    await page.click('button:has-text("One that repeats")');
    await page.fill('#sr-title', 'The school run');
    await page.fill('#sr-from', 'Ikoyi residence');
    await page.fill('#sr-to', 'Grange School');
    await page.fill('#sr-mins', '35');
    await page.click('button:has-text("Lay it down")');
    await page.waitForSelector('.alert-success', { timeout: 20000 });
    const laid = await page.locator('.alert-success').innerText();
    // Said as a number: "we made 20" and "we made none" look identical on a
    // list that is already long.
    ok('the repeating run says how many journeys it laid down',
      /\d+ journeys laid down/.test(laid), laid);
    ok('and they are in the list',
      (await page.locator('.movement-row:has-text("The school run")').count()) > 0);

    ok('nothing threw on the phone', phoneErrs.length === 0, phoneErrs.join(' | '));
    ok('nothing threw on the arranger\'s side', errs.length === 0, errs.join(' | '));
    ok('nor on the stand-in\'s', cosErrs.length === 0, cosErrs.join(' | '));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA journey can be arranged, handed over, and taken back — by hand, on the screen.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
