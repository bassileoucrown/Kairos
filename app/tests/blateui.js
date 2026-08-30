// Running late, on screen: the preview an assistant reads before agreeing.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4472, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

const DAY = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];
  try {
    // Two and a half minutes. Twenty seconds was plenty on an idle machine and
    // not plenty on a loaded one; a minute went the same way, twice in one day,
    // on a box where a hundred suites run back to back and each one starts a
    // server and half of them start a browser. "No server" on a green tree is a
    // board crying wolf, and it costs an hour of hunting a product bug that was
    // never there.
    //
    // Waiting longer is free when the tree is green — the loop exits the instant
    // the server answers — and is only paid when something is genuinely broken,
    // which is the right way round for this trade.
    const deadline = Date.now() + 150000;
    for (;;) {
      let ready = false;
      try { ready = (await (await fetch(`${BASE}/api/status`)).json()).databaseReady; }
      catch { /* not up */ }
      if (ready) break;
      if (Date.now() > deadline) throw new Error('server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    const p = await (await b.newContext()).newPage();
    p.on('pageerror', (e) => errs.push(e.message));

    await p.goto(`${BASE}/signup`);
    await p.fill('#name', 'Ada Boss');
    await p.fill('#email', `ada${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 15000 });
    await p.fill('#slug', `ada${ID}`);
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/connect', { timeout: 15000 });
    await p.click('button:has-text("Skip for now")');
    await p.waitForURL('**/onboarding/meeting-type', { timeout: 15000 });
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 15000 });

    // --- Build a trip from the form ---
    await p.goto(`${BASE}/itinerary?date=${DAY}`);
    await p.waitForSelector('button:has-text("Build a trip")', { timeout: 15000 });
    await p.fill('input[type="date"]', DAY);
    await p.click('button:has-text("Build a trip")');
    await p.waitForSelector('#trip-title', { timeout: 15000 });
    ok('the form says the flight is treated as an anchor',
      /will not wait/i.test(await p.locator('.trip').innerText()));
    await p.fill('#trip-title', 'BA 083 to Lagos');
    await p.fill('#trip-from', 'Heathrow T5');
    await p.fill('#trip-to', 'Lagos');
    await p.fill('#trip-depart', '14:00');
    await p.fill('#trip-arrive', '20:00');
    await p.fill('#trip-pickup', 'The Connaught');
    await p.click('.trip button:has-text("Build it")');
    await p.waitForSelector('.sched-row', { timeout: 15000 });

    const rows = await p.locator('.sched-row').allInnerTexts();
    ok('one form produced the whole chain', rows.length === 4, `${rows.length}: ${rows.join(' | ')}`);
    ok('with a check-out', rows.some((r) => /check out/i.test(r)), rows.join(' | '));
    ok('a car to the airport', rows.some((r) => /car to heathrow/i.test(r)));
    ok('the flight', rows.some((r) => /BA 083/.test(r)));
    ok('and a transfer at the other end', rows.some((r) => /car from lagos/i.test(r)));

    // --- Running late, previewed ---
    await p.click('.itin-entry:has-text("Check out") button:has-text("Running late")');
    await p.waitForSelector('.late-presets', { timeout: 15000 });
    ok('nothing has moved before a preview is asked for',
      /before anything moves/i.test(await p.locator('.late').innerText()));

    // An hour on the check-out pushes the car and still makes the flight.
    await p.click('.late-presets button:has-text("1 hr")');
    await p.waitForSelector('.late-row', { timeout: 15000 });
    const mild = await p.locator('.late').innerText();
    ok('the preview shows what shifts', /min later/i.test(mild), mild);
    ok('and does not cry wolf when the flight is still catchable',
      !/will not wait/i.test(mild) && (await p.locator('.late button:has-text("Apply")').count()) === 1,
      mild);
    await p.click('.late button:has-text("Cancel")');

    // Ninety minutes on the car itself does threaten it.
    await p.click('.itin-entry:has-text("Car to Heathrow") button:has-text("Running late")');
    await p.waitForSelector('.late-presets', { timeout: 15000 });
    await p.click('.late-presets button:has-text("1.5 hr")');
    await p.waitForSelector('.late-row.is-conflict', { timeout: 15000 });
    const lateText = await p.locator('.late').innerText();
    ok('and names the flight as immovable when it really is', /will not wait/i.test(lateText), lateText);
    ok('the button says so too',
      (await p.locator('.late button:has-text("Apply anyway")').count()) === 1);

    await p.click('.late button:has-text("Apply anyway")');
    await p.waitForSelector('.sched-row', { timeout: 15000 });
    const after = await p.locator('.sched-row').allInnerTexts();
    ok('the flight kept its time', after.some((r) => /BA 083/.test(r) && /2:00 PM|14:00/.test(r)),
      after.join(' | '));

    ok('no page errors', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nThe late flow works on screen.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
