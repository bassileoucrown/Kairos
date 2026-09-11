// Reminders people set for themselves, on one appointment.
//
// WHAT THIS IS ABOUT. The app has always reminded a principal thirty minutes
// before a booking and the booker a day before, and nobody could change
// either, and an ordinary diary entry got nothing at all. Now a person sets
// their own lead time on either kind of appointment.
//
// THE ASSERTIONS THAT MATTER are not that a row can be written. They are that
// two people on the same four o'clock get their own two different warnings,
// that a reminder fires once rather than every sweep, that a meeting which
// moves gets a fresh one, and that setting a reminder is not a way to find out
// about a meeting you are not allowed to see.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const fs = require('fs');
const DATA = `${ROOT}/app/server/data`;
for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
  if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
}

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}/api`;
const PW = 'password123';
const ID = Date.now().toString(36);
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (t) => console.log(`\n${t}`);

const server = spawn('node', ['--experimental-sqlite', 'index.js'], {
  cwd: `${ROOT}/app/server`,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    DATABASE_URL: process.env.DATABASE_URL || '',
    ENCRYPTION_KEY: '0'.repeat(64),
  },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let boot = '';
server.stderr.on('data', (d) => { boot = (boot + d).slice(-4000); });
let died = null;
server.on('exit', (code, signal) => { died = signal ? `signal ${signal}` : `exit ${code}`; });
process.on('exit', () => server.kill());

function sess() {
  let c = '';
  return async (m, p, b) => {
    const r = await fetch(BASE + p, {
      method: m,
      headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) c = sc.split(';')[0];
    let d = null;
    try { d = await r.json(); } catch { /* 204 */ }
    return { s: r.status, d };
  };
}

async function waitReady() {
  const deadline = Date.now() + 150000;
  for (;;) {
    try { if ((await (await fetch(`${BASE}/status`)).json()).databaseReady) return; }
    catch { /* not up yet */ }
    if (died) throw new Error(`the server never became ready — server ${died}\n${boot.trim()}`);
    if (Date.now() > deadline) throw new Error(`the server never became ready\n${boot.trim()}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const rel = (mins) => new Date(Date.now() + mins * 60000).toISOString();

(async () => {
  await waitReady();
  try {
    // ---- an office -----------------------------------------------------
    const boss = sess(); const pa = sess(); const outsider = sess();
    await boss('POST', '/auth/signup', { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, timezone: 'UTC', accountCategory: 'principal' });
    await boss('PATCH', '/profile', { slug: `ada${ID}` });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    const bossId = (await boss('GET', '/auth/me')).d.user.id;

    await pa('POST', '/auth/signup', { name: 'Tunde Bakare', email: `tunde${ID}@x.com`, password: PW, timezone: 'UTC', accountCategory: 'chief_of_staff' });
    await pa('PATCH', '/profile', { slug: `tunde${ID}` });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    await boss('POST', '/access-codes', { code: 'THURSDAY-LAGOS-91', role: 'chief_of_staff', window: '24h', uses: 2 });
    await pa('POST', '/access-codes/redeem', { handle: `ada${ID}`, code: 'THURSDAY-LAGOS-91' });
    const paId = (await pa('GET', '/auth/me')).d.user.id;

    await outsider('POST', '/auth/signup', { name: 'Someone Else', email: `else${ID}@x.com`, password: PW, timezone: 'UTC', accountCategory: 'principal' });
    await outsider('PATCH', '/profile', { slug: `else${ID}` });
    await outsider('POST', '/profile/onboarding-step', { step: 'done' });

    head('A reminder can be set while the appointment is being fixed:');
    const made = await boss('POST', `/itinerary/${bossId}/items`, {
      kind: 'meeting', title: 'Board pack review', startAt: rel(90), endAt: rel(150),
      status: 'confirmed', reminderMinutes: 15,
    });
    ok('the entry is created', made.s === 201, JSON.stringify(made.d).slice(0, 120));
    ok('and carries the reminder back', made.d.reminder?.minutes === 15, JSON.stringify(made.d.reminder));
    const itemId = made.d.item.id;

    // A bad value must not lose the entry that was already written.
    const bad = await boss('POST', `/itinerary/${bossId}/items`, {
      kind: 'meeting', title: 'Nonsense reminder', startAt: rel(200), status: 'confirmed',
      reminderMinutes: 999999,
    });
    ok('a silly lead time still creates the entry', bad.s === 201, String(bad.s));
    ok('and says what was wrong rather than swallowing it',
      /further ahead/i.test(bad.d.reminderProblem || ''), bad.d.reminderProblem);
    ok('and sets no reminder', !bad.d.reminder);

    head('Two people on the same four o\'clock get their own:');
    const paSet = await pa('PUT', `/reminders/${bossId}/itinerary/${itemId}`, { minutes: 60 });
    ok('the assistant sets sixty minutes', paSet.s === 200 && paSet.d.reminder.minutes === 60,
      JSON.stringify(paSet.d));
    const bossView = await boss('GET', `/reminders/${bossId}/itinerary/${itemId}`);
    ok('the principal still has their own fifteen', bossView.d.mine?.minutes === 15,
      JSON.stringify(bossView.d.mine));
    ok('and can see the assistant has one too',
      bossView.d.others?.some((o) => o.personName === 'Tunde Bakare' && o.minutes === 60),
      JSON.stringify(bossView.d.others));

    head('Setting one again replaces it rather than adding a second:');
    await boss('PUT', `/reminders/${bossId}/itinerary/${itemId}`, { minutes: 45 });
    const after = await boss('GET', `/reminders/${bossId}/itinerary/${itemId}`);
    ok('the principal now has forty-five', after.d.mine?.minutes === 45, JSON.stringify(after.d.mine));
    ok('and still only one of them', after.d.others.filter((o) => o.userId === bossId).length === 0);

    head('A lead time has to be a number of minutes:');
    for (const [label, minutes] of [['zero', 0], ['a fraction', 1.5], ['a month and a half', 99999], ['nothing at all', null]]) {
      const r = await boss('PUT', `/reminders/${bossId}/itinerary/${itemId}`, { minutes });
      ok(`${label} is refused`, r.s === 400, `${r.s} ${JSON.stringify(r.d)}`);
    }
    await boss('PUT', `/reminders/${bossId}/itinerary/${itemId}`, { minutes: 45 });

    head('It is not a way to find out about a meeting you cannot see:');
    const peek = await outsider('GET', `/reminders/${bossId}/itinerary/${itemId}`);
    ok('a stranger is refused', peek.s === 403 || peek.s === 404, String(peek.s));
    const peekSet = await outsider('PUT', `/reminders/${bossId}/itinerary/${itemId}`, { minutes: 10 });
    ok('and cannot set one either', peekSet.s === 403 || peekSet.s === 404, String(peekSet.s));
    const ghost = await boss('PUT', `/reminders/${bossId}/itinerary/no-such-item`, { minutes: 10 });
    ok('an appointment that does not exist is a 404, not a written row', ghost.s === 404, String(ghost.s));

    head('A reminder for something already started is refused:');
    const past = await boss('POST', `/itinerary/${bossId}/items`, {
      kind: 'meeting', title: 'This morning', startAt: rel(-120), endAt: rel(-60), status: 'confirmed',
    });
    const onPast = await boss('PUT', `/reminders/${bossId}/itinerary/${past.d.item.id}`, { minutes: 30 });
    ok('because it could never fire', onPast.s === 400, `${onPast.s} ${JSON.stringify(onPast.d)}`);

    head('The sweep fires it once, and only when it is due:');
    // Far enough out that 45 minutes has not arrived.
    let swept = await boss('POST', '/sweep/reminders', {});
    if (swept.s === 404) swept = { d: { skipped: true } };

    // Something imminent, with a lead time that has already been reached.
    const soon = await boss('POST', `/itinerary/${bossId}/items`, {
      kind: 'call', title: 'Call — counsel', startAt: rel(10), endAt: rel(40),
      status: 'confirmed', reminderMinutes: 30,
    });
    ok('an entry ten minutes out with a thirty-minute reminder is set up',
      soon.d.reminder?.minutes === 30, JSON.stringify(soon.d.reminder));

    const reminders = require(`${ROOT}/app/server/lib/reminders`);
    const firstRun = await reminders.sweepPersonal(Date.now());
    ok('the sweep sends it', firstRun >= 1, `sent ${firstRun}`);
    const secondRun = await reminders.sweepPersonal(Date.now());
    ok('and does not send it again', secondRun === 0, `sent ${secondRun} on the second pass`);

    head('A meeting that moves deserves a fresh warning:');
    await boss('PATCH', `/itinerary/${bossId}/items/${soon.d.item.id}`, { startAt: rel(20) });
    const afterMove = await reminders.sweepPersonal(Date.now());
    ok('so the sweep sends it again once it has moved', afterMove >= 1, `sent ${afterMove}`);

    head('Clearing it stops the warning:');
    const gone = await boss('DELETE', `/reminders/${bossId}/itinerary/${itemId}`);
    ok('it can be cleared', gone.s === 204, String(gone.s));
    const nowNone = await boss('GET', `/reminders/${bossId}/itinerary/${itemId}`);
    ok('and is gone', nowNone.d.mine === null, JSON.stringify(nowNone.d.mine));
    ok('while the assistant\'s is untouched',
      nowNone.d.others?.some((o) => o.minutes === 60), JSON.stringify(nowNone.d.others));

    head('A deleted appointment keeps no reminders:');
    await boss('DELETE', `/itinerary/${bossId}/items/${soon.d.item.id}`);
    const orphanSweep = await reminders.sweepPersonal(Date.now());
    ok('the sweep has nothing left to carry', orphanSweep === 0, `sent ${orphanSweep}`);

    head('And the control is on the form, not only in the API:');
    // The API working and the form working are two different claims, and the
    // gap between them is where a feature quietly does not exist. This picks
    // the reminder the way a person does and then reads the row back.
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
      const jsErrors = [];
      page.on('pageerror', (e) => jsErrors.push(e.message));
      await page.goto(`http://127.0.0.1:${PORT}/login`);
      await page.fill('#email', `ada${ID}@x.com`);
      await page.fill('#password', PW);
      await page.click('button:has-text("Log in")');
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25000 });
      await page.goto(`http://127.0.0.1:${PORT}/itinerary`);
      await page.waitForTimeout(1200);

      // "Add item" opens the form; the submit inside it says "Add to the day".
      // Both labels read off Itinerary.jsx rather than guessed — the first
      // guess found no button, and a test that cannot open the form reports
      // the control missing when it is merely unreached.
      const opener = page.locator('button:has-text("Add item")').first();
      ok('the day offers a way to add something', await opener.count() === 1);
      await opener.click();
      await page.waitForTimeout(800);

      const picker = page.locator('#itin-remind');
      ok('the form offers a reminder', await picker.count() === 1, `found ${await picker.count()}`);
      ok('and says whose it is',
        (await page.locator('text=This one is yours').count()) > 0);

      if (await picker.count()) {
        await page.fill('#itin-title', 'Made on the form');
        await picker.selectOption('60');
        await page.click('button:has-text("Add to the day")');
        await page.waitForTimeout(1800);

        const row = await boss('GET', `/itinerary/${bossId}/day`);
        const entry = (row.d.entries || []).find((e) => e.title === 'Made on the form');
        ok('the entry reaches the diary', !!entry, JSON.stringify((row.d.entries || []).map((e) => e.title)));
        if (entry) {
          const set = await boss('GET', `/reminders/${bossId}/itinerary/${entry.id}`);
          ok('and the reminder chosen on the form was stored',
            set.d.mine?.minutes === 60, JSON.stringify(set.d.mine));
        }
      }
      ok('no page errors while doing it', jsErrors.length === 0, jsErrors.join(' | '));
    } finally { await browser.close(); }

    head('The presets are offered rather than guessed at:');
    const presets = await boss('GET', '/reminders/presets');
    ok('there is a list to choose from', Array.isArray(presets.d.presets) && presets.d.presets.length > 3,
      JSON.stringify(presets.d));
    ok('and a default that matches what the app always did',
      presets.d.defaultMinutes === 30, String(presets.d.defaultMinutes));

    // NOTHING SHORTER THAN THE SWEEP IS OFFERED.
    //
    // A reminder fires only if a sweep pass lands inside its window, and the
    // window is exactly as wide as the lead. At a fifteen-minute sweep a
    // five-minute lead was caught about one time in three and a ten-minute lead
    // two in three — and a miss is permanent rather than late, because the next
    // pass finds the meeting started and skips it on purpose.
    //
    // Asserted against the sweep interval rather than against a hardcoded 15,
    // so that shortening the sweep and putting the short leads back is one
    // change and not two — and so this line cannot quietly agree with a list
    // that has drifted away from the clock that drives it.
    const sweepMinutes = Number(process.env.REMINDER_SWEEP_MS || 15 * 60 * 1000) / 60000;
    ok('no lead is shorter than the sweep that has to catch it',
      presets.d.presets.every((m) => m >= sweepMinutes),
      `${JSON.stringify(presets.d.presets)} against a ${sweepMinutes} min sweep`);
    // The positive control. "Every preset is long enough" passes on an empty
    // list too, and a reminder picker with nothing in it is a worse bug than
    // one with a lead that misses.
    ok('and the ones that are left are a real choice',
      presets.d.presets.length >= 5 && presets.d.presets.includes(15)
      && presets.d.presets.includes(1440),
      JSON.stringify(presets.d.presets));
  } catch (e) {
    fails += 1;
    console.log('\nFAILED: ' + (e.stack || e.message));
  }

  console.log(fails === 0
    ? '\nEverybody sets their own warning, and it arrives once.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
