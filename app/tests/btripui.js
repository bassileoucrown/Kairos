// The Trips screen, and the two things a day sheet cannot show: who is meeting
// the principal at the far end, and the phrase that replaces a name board.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4527, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

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
    const p = await (await b.newContext()).newPage();
    p.on('pageerror', (e) => errs.push(e.message));

    await p.goto(`${BASE}/signup`);
    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Adaeze Okonkwo');
    await p.fill('#email', `ada${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 15000 });
    await p.fill('#slug', `ada${ID}`);
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/meeting-type', { timeout: 15000 });
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 15000 });

    await p.goto(`${BASE}/trips`);
    await p.waitForSelector('.empty-state', { timeout: 15000 });
    ok('an empty Trips page says what a trip is for',
      /timezone/i.test(await p.locator('.empty-state').innerText()));

    await p.click('button:has-text("Plan a trip")');
    await p.waitForSelector('#trip-name', { timeout: 15000 });
    await p.fill('#trip-name', 'London, board week');
    await p.fill('#trip-dest', 'London');
    // The zone is chosen by typing a city now, not by spelling "Europe/London".
    await p.click('#trip-tz');
    await p.fill('.tz-search input', 'London');
    await p.click('.tz-option:has-text("London")');
    const today = new Date().toISOString().slice(0, 10);
    await p.fill('#trip-from', today);
    await p.fill('#trip-to', '2099-12-31');
    await p.click('.trip-form button:has-text("Create")');

    await p.waitForSelector('.trip-head', { timeout: 15000 });
    ok('the trip opens on creation', /London, board week/.test(await p.locator('.trip-head').innerText()));
    ok('saying what confirming it will do',
      /drawn in/i.test(await p.locator('.trip-head').innerText()));
    // A principal planning their own travel means it, exactly as with a single
    // itinerary item. Only an assistant's trip starts as a draft, and only a
    // principal can confirm one — it moves which zone their days are drawn in.
    ok('a principal\'s own trip is live at once',
      /confirmed/i.test(await p.locator('.trip-head .pill').innerText()),
      await p.locator('.trip-head .pill').innerText());
    ok('so there is nothing to confirm',
      (await p.locator('button:has-text("Confirm this trip")').count()) === 0);

    // Now the whole point: the day should be drawn in London time.
    await p.goto(`${BASE}/today`);
    await p.waitForSelector('.app-main, main', { timeout: 15000 });
    const todayJson = await p.evaluate(async () => {
      const r = await fetch('/api/pa/principals');
      const { principals } = await r.json();
      const id = principals[0].id;
      return (await (await fetch(`/api/today/${id}`)).json());
    });
    ok('Today is now drawn in the destination zone',
      todayJson.timezone === 'Europe/London', todayJson.timezone);
    ok('and names the trip', todayJson.away?.destination === 'London');

    await p.goto(`${BASE}/trips`);
    await p.waitForSelector('.trip-row', { timeout: 15000 });
    ok('the trip is listed', /London/.test(await p.locator('.trip-row').innerText()));
    await p.click('.trip-row');
    await p.waitForSelector('.trip-head', { timeout: 15000 });

    // Travellers and local contacts.
    await p.click('button:has-text("Add traveller")');
    await p.fill('input[placeholder="Name"]', 'Ngozi Okonkwo');
    await p.fill('input[placeholder="Spouse, aide, security…"]', 'spouse');
    await p.click('.trip-add button:has-text("Add traveller")');
    await p.waitForSelector('.ess-row:has-text("Ngozi")', { timeout: 15000 });
    ok('a traveller is added from the screen', true);

    // A car leg with a hired arrangement, built through the API so the screen
    // is exercised on realistic data rather than a fixture.
    const built = await p.evaluate(async () => {
      const { principals } = await (await fetch('/api/pa/principals')).json();
      const id = principals[0].id;
      const trips = await (await fetch(`/api/trips/${id}`)).json();
      const tripId = trips.trips[0].id;
      const depart = Date.now() + 3 * 86400000;
      const r = await fetch(`/api/itinerary/${id}/trips`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tripId,
          title: 'BA 075 Lagos → London',
          from: 'LOS', to: 'LHR', terminal: 'T5', seat: '2A',
          departAt: new Date(depart).toISOString(),
          arriveAt: new Date(depart + 6.5 * 3600000).toISOString(),
          startTimezone: 'Africa/Lagos', endTimezone: 'Europe/London',
          arrivalTransferMinutes: 75,
          arrivalMeetingPoint: 'T5 arrivals',
          arrival: { arrangement: 'hired', provider: 'Addison Lee', contactPhone: '+44 20 7387 8888' },
        }),
      });
      return r.json();
    });
    ok('a trip chain builds against this trip', !!built.arrivalPickup);

    await p.reload();
    await p.waitForSelector('.trip-row', { timeout: 15000 });
    await p.click('.trip-row');
    await p.waitForSelector('.trip-item', { timeout: 15000 });

    const journey = await p.locator('.trip-detail').innerText();
    ok('the flight shows its terminal and seat', /T5/.test(journey) && /2A/.test(journey), journey.slice(0, 240));
    ok('the arrival car names how it is arranged', /Hired car/.test(journey), journey.slice(0, 400));
    ok('and who to ring', /Addison Lee/.test(journey) && /7387 8888/.test(journey));

    const phrase = await p.locator('.trip-phrase code').first().innerText();
    ok('the meeting phrase is shown to the principal', /^[A-Z]+ [A-Z]+$/.test(phrase.trim()), phrase);
    ok('with the point of it said plainly',
      /nobody holds up a name/i.test(journey));

    // Re-arming shows the card link exactly once.
    await p.click('button:has-text("New phrase and link")');
    await p.waitForSelector('.trip-card-link code', { timeout: 15000 });
    const link = await p.locator('.trip-card-link code').first().innerText();
    ok('a fresh card link appears when armed', /\/pickup\/[0-9a-f]{48}$/.test(link.trim()), link);
    const newPhrase = await p.locator('.trip-phrase code').first().innerText();
    ok('and the phrase changed with it', newPhrase.trim() !== phrase.trim());

    await p.reload();
    await p.waitForSelector('.trip-row', { timeout: 15000 });
    await p.click('.trip-row');
    await p.waitForSelector('.trip-phrase', { timeout: 15000 });
    ok('the link is gone on reload — it is a credential, not a property',
      (await p.locator('.trip-card-link').count()) === 0);
    ok('while the phrase persists, because the principal needs it',
      (await p.locator('.trip-phrase code').count()) >= 1);

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nThe Trips screen works.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
