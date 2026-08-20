// Finding the driver: the signal both phones show, and the tap that ends it.
//
// The claim being tested is narrow and physical. Two people who have never met
// are in the same hall. One of them is holding up a coloured panel; the other
// is looking for it. Nothing in the room learns who either of them is, a
// photograph of the panel is worthless a minute later, and when the principal
// says "that is them" the driver finds out without either saying a name.
//
// The window is squeezed to two seconds here so rotation and the freeze can be
// observed inside a test rather than asserted about.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');
const signal = require(`${ROOT}/app/server/lib/pickupSignal`);

const PORT = Number(process.env.PORT || 4531);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const WINDOW = 2000;
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const words = (s) => `${s.colour.id}/${s.shape.id}`;

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
  // --- Derivation, before anything is served -----------------------------
  head('What the signal is made of:');
  const tok = 'a'.repeat(48);
  const at = 1_800_000_000_000;
  ok('the same card at the same moment gives the same answer',
    words(signal.signalAt(tok, at)) === words(signal.signalAt(tok, at + 100)));
  ok('and both sides are told when it next changes',
    Date.parse(signal.signalAt(tok, at).changesAt) > at);

  // Spread, not uniqueness: forty-eight combinations is a finder, not a
  // credential — the phrase is what proves anything. What would be wrong is a
  // derivation that leaned on one colour.
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(words(signal.signalAt(`t${i}`.padEnd(48, '0'), at)));
  ok('different cards spread across the palette', seen.size >= 30, `${seen.size} of 48`);

  const colours = new Set();
  for (let w = 0; w < 200; w++) colours.add(signal.signalAt(tok, at + w * signal.WINDOW_MS).colour.id);
  ok('and one card walks the palette as it rotates', colours.size >= 6, `${colours.size} of 8`);

  // --- The server --------------------------------------------------------
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
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      PICKUP_SIGNAL_WINDOW_MS: String(WINDOW),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  let b = null;
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await wait(200);
    }

    const ada = client();
    const up = await ada('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const adaId = up.d.user.id;
    await ada('POST', '/profile/onboarding-step', { step: 'done' });

    const trip = await ada('POST', `/trips/${adaId}`, {
      name: 'London', destination: 'London', destinationTimezone: 'Europe/London',
      startsOn: new Date().toISOString().slice(0, 10), endsOn: '2099-12-31', status: 'confirmed',
    });
    const depart = Date.now() + 3 * 86400000;
    const built = await ada('POST', `/itinerary/${adaId}/trips`, {
      tripId: trip.d.trip.id,
      title: 'BA 075 Lagos → London', from: 'LOS', to: 'LHR', terminal: 'T5',
      departAt: new Date(depart).toISOString(),
      arriveAt: new Date(depart + 6.5 * 3600000).toISOString(),
      startTimezone: 'Africa/Lagos', endTimezone: 'Europe/London',
      arrivalTransferMinutes: 75, arrivalMeetingPoint: 'T5 arrivals, costa coffee',
      arrival: { arrangement: 'hired', provider: 'Addison Lee', contactPhone: '+44 20 7387 8888' },
    });
    const token = built.d.arrivalPickup.cardPath.split('/').pop();
    const itemId = built.d.arrivalPickup.itemId;
    const sigPath = `/itinerary/${adaId}/items/${itemId}/signal`;

    const driver = () => fetch(`${BASE}/api/trips/pickup/${token}/signal`).then((r) => r.json());

    head('Both sides are shown the same thing:');
    const mine = await ada('GET', sigPath);
    const theirs = await driver();
    ok('the principal is told what to look for', !!mine.d.signal?.colour, JSON.stringify(mine.d).slice(0, 120));
    ok('the driver is told what to hold up', !!theirs.signal?.colour);
    ok('and it is the same colour and shape',
      words(mine.d.signal) === words(theirs.signal), `${words(mine.d.signal)} vs ${words(theirs.signal)}`);
    ok('named in words either of them could say down a phone',
      /^[A-Z][a-z]+$/.test(theirs.signal.colour.name) && /^[A-Z][a-z]+$/.test(theirs.signal.shape.name),
      `${theirs.signal.colour.name} ${theirs.signal.shape.name}`);

    head('What the driver\'s phone is NOT given:');
    const asText = JSON.stringify(theirs);
    ok('never the address that produced the signal', !asText.includes(token));
    ok('nor anything else about the principal',
      !/adaeze|okonkwo|ada[a-z0-9]*@/i.test(asText), asText.slice(0, 160));
    ok('and a wrong address is refused the same as an expired one',
      (await fetch(`${BASE}/api/trips/pickup/${'0'.repeat(48)}/signal`)).status === 404);

    head('It rotates, so a photograph goes stale:');
    const first = words(theirs.signal);
    let rotated = false;
    for (let i = 0; i < 12 && !rotated; i++) {
      await wait(WINDOW / 2);
      if (words((await driver()).signal) !== first) rotated = true;
    }
    ok('the panel changes on its own', rotated);

    head('"That is them":');
    const claimed = await ada('POST', `${sigPath}/found`);
    ok('the principal can end the search', claimed.d.signal?.found === true, JSON.stringify(claimed.d).slice(0, 120));
    ok('and the driver learns it without a name being said',
      (await driver()).signal.found === true);
    ok('nothing is scheduled to change any more', claimed.d.signal.changesAt === null);

    const frozen = words(claimed.d.signal);
    await wait(WINDOW * 3);
    const still = await driver();
    ok('the signal freezes, so it is still true when they arrive',
      words(still.signal) === frozen, `${frozen} → ${words(still.signal)}`);
    ok('on both screens', words((await ada('GET', sigPath)).d.signal) === frozen);

    head('Wrong phone, wrong hand:');
    const undone = await ada('DELETE', `${sigPath}/found`);
    ok('the principal can take it back', undone.d.signal.found === false);
    ok('and the panel starts rotating again', !!undone.d.signal.changesAt);
    ok('which the driver sees too', (await driver()).signal.found === false);

    head('A new driver starts from nothing:');
    await ada('POST', `${sigPath}/found`);
    const rearmed = await ada('POST', `/itinerary/${adaId}/items/${itemId}/pickup`);
    const newToken = rearmed.d.cardPath.split('/').pop();
    ok('re-arming issues a new address', newToken !== token);
    ok('the old card is dead', (await fetch(`${BASE}/api/trips/pickup/${token}/signal`)).status === 404);
    const fresh = await fetch(`${BASE}/api/trips/pickup/${newToken}/signal`).then((r) => r.json());
    ok('and the new driver is not told he has already been recognised',
      fresh.signal.found === false, JSON.stringify(fresh.signal).slice(0, 120));

    head('A pickup nobody armed has no signal:');
    const items = await ada('GET', `/trips/${adaId}/${trip.d.trip.id}`);
    const flight = items.d.items.find((i) => i.kind === 'flight');
    const none = await ada('GET', `/itinerary/${adaId}/items/${flight.id}/signal`);
    ok('the flight leg answers 404, not an empty panel', none.s === 404);

    // --- The two screens, driven ----------------------------------------
    head('In the hall:');
    b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const errs = [];

    // The driver: a phone, a forwarded link, and no account whatsoever.
    const driverCtx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const dp = await driverCtx.newPage();
    dp.on('pageerror', (e) => errs.push('driver: ' + e.message));
    await dp.goto(`${BASE}/pickup/${newToken}`);
    await dp.waitForSelector('.signal-panel', { timeout: 15000 });
    ok('the card opens with no sign-in', true);
    ok('and says what to do with it',
      /hold this up/i.test(await dp.locator('.driver-instruction').innerText()));
    ok('carrying the phrase', /^[A-Z]+ [A-Z]+$/.test((await dp.locator('.driver-phrase code').innerText()).trim()));
    const driverFacts = await dp.locator('.driver-facts').innerText();
    ok('the flight and the meeting point', /BA 075/.test(driverFacts) && /costa coffee/i.test(driverFacts),
      driverFacts.slice(0, 200));
    ok('a first name and nothing more', /Adaeze/.test(driverFacts) && !/Okonkwo/.test(driverFacts),
      driverFacts.slice(0, 200));
    ok('the panel is described for a screen reader too',
      /with a/.test(await dp.locator('.signal-panel').getAttribute('aria-label')),
      await dp.locator('.signal-panel').getAttribute('aria-label'));

    // The principal, walking out of customs.
    const pp = await (await b.newContext()).newPage();
    pp.on('pageerror', (e) => errs.push('principal: ' + e.message));
    await pp.goto(`${BASE}/login`);
    await pp.fill('#email', `ada${ID}@x.com`);
    await pp.fill('#password', PW);
    await pp.click('button:has-text("Log in")');
    await pp.waitForURL(/\/today/, { timeout: 20000 });
    await pp.goto(`${BASE}/trips`);
    await pp.click('.trip-row');
    await pp.waitForSelector('.trip-finder .signal-panel', { timeout: 15000 });
    ok('the principal is shown what to look for',
      /look for/i.test(await pp.locator('.trip-finder').innerText()));
    ok('and told it changes, so a stale glance is not trusted',
      /every minute/i.test(await pp.locator('.trip-finder').innerText()));

    await pp.click('.trip-finder button:has-text("That\'s them")');
    await pp.waitForFunction(
      () => /confirmed/i.test(document.querySelector('.trip-finder')?.textContent || ''),
      null, { timeout: 15000 },
    );
    ok('one tap ends the search', true);

    // The whole point: his phone changes in his hand, without being touched.
    await dp.waitForFunction(
      () => /have seen you/i.test(document.querySelector('.driver-instruction')?.textContent || ''),
      null, { timeout: 20000 },
    );
    ok('the driver\'s screen changes in his hand, untouched', true);
    ok('telling him to stay put',
      /stay where you are/i.test(await dp.locator('.driver-instruction').innerText()));

    // Frozen on both, so the comparison is meaningful rather than a race.
    const shown = (await dp.locator('.signal-words').innerText()).trim();
    const looking = (await pp.locator('.trip-finder .signal-words').innerText()).trim();
    ok('and the two panels agree', shown === looking, `${shown} vs ${looking}`);

    await pp.click('.trip-finder button:has-text("Not them")');
    await dp.waitForFunction(
      () => /hold this up/i.test(document.querySelector('.driver-instruction')?.textContent || ''),
      null, { timeout: 20000 },
    );
    ok('and it can be taken back, on both screens at once', true);

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (b) await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nNobody held up a name, and nobody had to guess.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
