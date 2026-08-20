// Putting something into a trip, from the screen.
//
// Everything a trip can hold has existed on the server since trips were built,
// and the Trips screen has been drawing all of it faithfully — for journeys
// that could not be created. "The journey" was read-only: the one endpoint
// that fills it had no button anywhere in the app. So a trip was a name, two
// dates and an empty list, and every feature underneath was invisible, because
// nothing ever reached the condition that renders it.
//
// This drives the screen the way somebody planning a trip would, and then
// checks that the things previously only reachable by API are on the page:
// the terminal and the seat, the car to the airport, the hired car at the far
// end with a number to ring, and the phrase that meets them there.
//
// It also checks the time, which is the part that fails silently. An assistant
// filling this form is often not in the country the flight leaves from.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4539, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

// Far from Lagos and far from London, so a browser-zone bug cannot pass by
// coincidence.
const BROWSER_TZ = 'America/Los_Angeles';

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  }
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (;;) {
    try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
    catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }

  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];
  try {
    const p = await (await b.newContext({ timezoneId: BROWSER_TZ })).newPage();
    p.on('pageerror', (e) => errs.push(e.message));

    await p.goto(`${BASE}/signup`);
    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Adaeze Okonkwo');
    await p.fill('#email', `ada${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 15000 });
    await p.fill('#slug', `ada${ID}`);
    await p.click('#timezone');
    await p.fill('.tz-search input', 'Lagos');
    await p.click('.tz-option:has-text("Lagos")');
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/meeting-type', { timeout: 15000 });
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 15000 });

    head('A trip, planned from the screen:');
    await p.goto(`${BASE}/trips`);
    await p.click('button:has-text("Plan a trip")');
    await p.waitForSelector('#trip-name', { timeout: 15000 });
    await p.fill('#trip-name', 'London, board week');
    await p.fill('#trip-dest', 'London');
    await p.click('#trip-tz');
    await p.fill('.tz-search input', 'London');
    await p.click('.tz-option:has-text("London")');
    await p.fill('#trip-from', '2027-03-04');
    await p.fill('#trip-to', '2027-03-10');
    await p.click('.trip-form button:has-text("Create")');
    await p.waitForSelector('.trip-head', { timeout: 15000 });

    ok('an empty trip says what adding the flight will also do',
      /car to the airport/i.test(await p.locator('.empty-state').first().innerText()),
      await p.locator('.empty-state').first().innerText());
    ok('and there is a way to add one',
      (await p.locator('button:has-text("Add a flight")').count()) === 1);

    head('The flight, with the cars either side of it:');
    await p.click('button:has-text("Add a flight")');
    await p.waitForSelector('#leg-title', { timeout: 15000 });

    ok('the destination is carried over rather than retyped',
      (await p.inputValue('#leg-to')) === 'London');
    ok('the departure zone starts at home',
      /Lagos/.test(await p.locator('#leg-start-tz').innerText()),
      await p.locator('#leg-start-tz').innerText());
    ok('and the arrival zone at the trip\'s destination',
      /London/.test(await p.locator('#leg-end-tz').innerText()),
      await p.locator('#leg-end-tz').innerText());

    await p.fill('#leg-title', 'BA 075 Lagos → London');
    await p.fill('#leg-from', 'LOS');
    await p.fill('#leg-terminal', 'T5');
    await p.fill('#leg-seat', '2A');
    await p.fill('#leg-ref', 'PNR X7QK2M');
    await p.fill('#leg-depart-date', '2027-03-04');
    await p.fill('#leg-depart-time', '09:00');
    await p.fill('#leg-arrive-date', '2027-03-04');
    await p.fill('#leg-arrive-time', '15:30');
    await p.fill('#leg-pickup-from', 'Ikoyi residence');

    head('A hired car with nobody to ring:');
    await p.selectOption('#leg-arr-arrangement', 'hired');
    await p.waitForSelector('#leg-arr-provider', { timeout: 10000 });
    ok('asks for the company and the number as soon as it is chosen', true);
    ok('saying why', /callable/i.test(await p.locator('.journey-form').innerText()));
    await p.click('.journey-form button:has-text("Add to the trip")');
    await p.waitForSelector('.journey-form .alert-error', { timeout: 15000 });
    ok('and refuses to save without one',
      /name or a number/i.test(await p.locator('.journey-form .alert-error').innerText()),
      await p.locator('.journey-form .alert-error').innerText());

    head('Filled in properly:');
    await p.fill('#leg-arr-provider', 'Addison Lee');
    await p.fill('#leg-arr-contact', 'Dispatch');
    await p.fill('#leg-arr-phone', '+44 20 7387 8888');
    await p.fill('#leg-meet', 'T5 arrivals, Costa Coffee');
    await p.fill('#leg-arrival-to', 'The Connaught');
    await p.click('.journey-form button:has-text("Add to the trip")');
    await p.waitForSelector('.trip-item', { timeout: 20000 });

    const journey = await p.locator('.trip-detail').innerText();
    ok('the flight is on the trip', /BA 075/.test(journey));
    ok('with its terminal and seat', /T5/.test(journey) && /2A/.test(journey));
    ok('and its booking reference', /X7QK2M/.test(journey));
    ok('a car to the airport was built alongside it',
      /Ikoyi residence/.test(journey), journey.slice(0, 400));
    ok('and a car at the far end that is not the household driver',
      /Hired car/.test(journey), journey.slice(0, 600));
    ok('naming the company', /Addison Lee/.test(journey));
    ok('and who to ring when the flight lands late', /7387 8888/.test(journey));

    head('Met by a phrase rather than a name board:');
    ok('a meeting phrase was armed as part of building it',
      /^[A-Z]+ [A-Z]+$/.test((await p.locator('.trip-phrase code').first().innerText()).trim()),
      await p.locator('.trip-phrase code').first().innerText());
    ok('with the driver\'s card address offered once, right there',
      /\/pickup\/[0-9a-f]{48}/.test(await p.locator('.trip-card-link code').first().innerText()),
      await p.locator('.trip-card-link code').first().innerText());
    ok('and something to look for in the hall',
      (await p.locator('.trip-finder .signal-panel').count()) >= 1);

    head('The time, entered from a third country:');
    const stored = await p.evaluate(async () => {
      const { principals } = await (await fetch('/api/pa/principals')).json();
      const id = principals[0].id;
      const trips = await (await fetch(`/api/trips/${id}`)).json();
      const t = await (await fetch(`/api/trips/${id}/${trips.trips[0].id}`)).json();
      return t.items.find((i) => i.kind === 'flight');
    });
    // 09:00 in Lagos (UTC+1, no DST) is 08:00Z. The browser was deliberately
    // put in Los Angeles: reading the form in the browser's zone would store
    // 17:00Z and every downstream time would be eight hours wrong.
    ok('09:00 in Lagos is stored as 08:00 UTC, not 09:00 wherever the PA sits',
      stored.startAt.startsWith('2027-03-04T08:00'), stored.startAt);
    // 15:30 in London on 4 March is GMT, so 15:30Z.
    ok('and the landing time is read in London, where it lands',
      stored.endAt.startsWith('2027-03-04T15:30'), stored.endAt);

    head('One thing on its own:');
    await p.click('button:has-text("Add something else")');
    await p.waitForSelector('#one-title', { timeout: 15000 });
    await p.selectOption('#one-kind', 'meal');
    await p.fill('#one-title', 'Dinner with the board');
    await p.fill('#one-date', '2027-03-05');
    await p.fill('#one-time', '19:30');
    await p.fill('#one-location', 'The Connaught');
    await p.click('.journey-form button:has-text("Add to the trip")');
    await p.waitForFunction(
      () => /Dinner with the board/.test(document.querySelector('.trip-detail')?.textContent || ''),
      null, { timeout: 20000 },
    );
    ok('lands on the trip too', true);
    const dinner = await p.evaluate(async () => {
      const { principals } = await (await fetch('/api/pa/principals')).json();
      const id = principals[0].id;
      const trips = await (await fetch(`/api/trips/${id}`)).json();
      const t = await (await fetch(`/api/trips/${id}/${trips.trips[0].id}`)).json();
      return t.items.find((i) => i.kind === 'meal');
    });
    ok('at 19:30 London, which is 19:30 UTC in March',
      dinner.startAt.startsWith('2027-03-05T19:30'), dinner.startAt);

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nA trip can be built from the screen that shows it.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
