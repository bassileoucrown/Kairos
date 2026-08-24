// Choosing a timezone by typing where you are going.
//
// The list was never missing — the runtime has had all four hundred zones the
// whole time. What was wrong was every way we asked for one: an alphabetical
// dropdown where "Europe/London" sits between Lisbon and Luxembourg, and, on
// the trip form, free text with "Europe/London" for a placeholder, which is a
// spelling test with a 400 for a wrong answer.
//
// So the thing to prove is not that a list renders. It is that somebody who
// knows where they are going, and nothing about IANA, arrives at the right
// zone: by city, by country, by the name of a city whose zone is named after
// somewhere else, and from a keyboard without touching the mouse.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4533, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

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

    // --- Onboarding is the first place anybody meets it ------------------
    await p.goto(`${BASE}/signup`);
    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Adaeze Okonkwo');
    await p.fill('#email', `ada${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 15000 });
    await p.fill('#slug', `ada${ID}`);

    head('Before anything is typed:');
    await p.click('#timezone');
    await p.waitForSelector('.tz-panel', { timeout: 10000 });
    const opening = await p.locator('.tz-list').innerText();
    ok('it opens on somewhere useful rather than the alphabet',
      !/^Abidjan/.test(opening.trim()), opening.slice(0, 80).replace(/\n/g, ' | '));
    ok('offering the places this market actually flies',
      /Lagos/.test(opening) && /London/.test(opening) && /Dubai/.test(opening),
      opening.slice(0, 160).replace(/\n/g, ' | '));
    ok('each with the time it is there right now',
      /\d\d:\d\d/.test(opening) && /GMT/.test(opening), opening.slice(0, 120).replace(/\n/g, ' | '));

    head('Typing a city:');
    await p.fill('.tz-search input', 'lagos');
    await p.waitForFunction(
      () => document.querySelectorAll('.tz-option').length === 1, null, { timeout: 10000 },
    );
    ok('narrows to it', /Lagos/.test(await p.locator('.tz-option').first().innerText()));

    // The one that used to be impossible: the city is not the zone's name.
    head('Typing a city whose zone is named after somewhere else:');
    await p.fill('.tz-search input', 'Abuja');
    await p.waitForSelector('.tz-option', { timeout: 10000 });
    ok('Abuja finds Lagos time', /Lagos/.test(await p.locator('.tz-option').first().innerText()),
      await p.locator('.tz-list').innerText());

    head('Typing a country:');
    await p.fill('.tz-search input', 'Nigeria');
    await p.waitForSelector('.tz-option', { timeout: 10000 });
    ok('Nigeria does too', /Lagos/.test(await p.locator('.tz-option').first().innerText()));
    await p.fill('.tz-search input', 'United Kingdom');
    await p.waitForSelector('.tz-option', { timeout: 10000 });
    ok('and the United Kingdom finds London',
      /London/.test(await p.locator('.tz-option').first().innerText()),
      await p.locator('.tz-list').innerText());

    head('Ranking, because "lon" is London long before it is Colombo:');
    await p.fill('.tz-search input', 'lon');
    await p.waitForSelector('.tz-option', { timeout: 10000 });
    ok('the city that starts with it comes first',
      /London/.test(await p.locator('.tz-option').first().innerText()),
      await p.locator('.tz-list').innerText().then((t) => t.slice(0, 100)));

    head('A search that finds nothing:');
    await p.fill('.tz-search input', 'zzzz');
    await p.waitForFunction(
      () => document.querySelectorAll('.tz-option').length === 0, null, { timeout: 10000 },
    );
    const empty = await p.locator('.tz-panel-hint').innerText();
    ok('says so, and says what to try instead', /nearest large city/i.test(empty), empty);

    head('From the keyboard alone:');
    await p.fill('.tz-search input', 'Dubai');
    await p.waitForSelector('.tz-option', { timeout: 10000 });
    await p.keyboard.press('Enter');
    await p.waitForFunction(
      () => !document.querySelector('.tz-panel'), null, { timeout: 10000 },
    );
    ok('enter chooses and closes it',
      /Dubai/.test(await p.locator('#timezone').innerText()), await p.locator('#timezone').innerText());
    ok('and the field shows the zone it will actually save',
      /Asia\/Dubai/.test(await p.locator('#timezone').innerText()));

    head('Escape and clicking away:');
    await p.click('#timezone');
    await p.waitForSelector('.tz-panel', { timeout: 10000 });
    await p.keyboard.press('Escape');
    ok('escape closes it', (await p.locator('.tz-panel').count()) === 0);
    await p.click('#timezone');
    await p.waitForSelector('.tz-panel', { timeout: 10000 });
    await p.click('h1');
    ok('so does clicking away', (await p.locator('.tz-panel').count()) === 0);

    // Now finish onboarding and prove the choice actually persisted.
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/connect', { timeout: 15000 });
    await p.click('button:has-text("Skip for now")');
    await p.waitForURL('**/onboarding/meeting-type', { timeout: 15000 });
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 15000 });
    const me = await p.evaluate(async () => (await (await fetch('/api/auth/me')).json()));
    ok('the chosen zone is what got saved', me.user.timezone === 'Asia/Dubai', me.user.timezone);

    // --- The trip form, which was the free-text spelling test ------------
    head('On a trip, where this used to be typed by hand:');
    await p.goto(`${BASE}/trips`);
    await p.click('button:has-text("Plan a trip")');
    await p.waitForSelector('#trip-name', { timeout: 15000 });
    await p.fill('#trip-name', 'London, board week');
    await p.fill('#trip-dest', 'London');
    await p.click('#trip-tz');
    await p.fill('.tz-search input', 'London');
    await p.click('.tz-option:has-text("London")');
    ok('the destination zone is picked the same way',
      /Europe\/London/.test(await p.locator('#trip-tz').innerText()),
      await p.locator('#trip-tz').innerText());

    const today = new Date().toISOString().slice(0, 10);
    await p.fill('#trip-from', today);
    await p.fill('#trip-to', '2099-12-31');
    await p.click('.trip-form button:has-text("Create")');
    await p.waitForSelector('.trip-head', { timeout: 15000 });
    ok('and the trip is created with a zone the server accepts',
      /Europe\/London/.test(await p.locator('.trip-head').innerText()),
      await p.locator('.trip-head').innerText());

    // The whole point of the zone: the day is drawn where the principal is.
    const todayJson = await p.evaluate(async () => {
      const { principals } = await (await fetch('/api/pa/principals')).json();
      return (await (await fetch(`/api/today/${principals[0].id}`)).json());
    });
    ok('so Today is drawn in London rather than at home',
      todayJson.timezone === 'Europe/London', todayJson.timezone);

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nYou can pick a timezone by knowing where you are going.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
