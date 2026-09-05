// Clicking a schedule opens it, and what opens can be changed.
//
// TWO GAPS, ONE COMPLAINT. A schedule was made and then could not be got back
// to:
//
//   THE ROW WAS NOT THE TARGET. Only the few words of the title were a link,
//   inside a row the width of the screen. Pressing the row — which is what
//   clicking an appointment means, and what a thumb does on a phone — did
//   nothing, and reasonably read as "there is nothing to open".
//
//   AND HALF OF THEM HAD NOWHERE TO GO. An appointment somebody booked has had
//   its own page from the start. An entry the office made itself — the car,
//   the dinner, the school run — had none: it could only be changed from a
//   small tool on the row that drew it, so changing a thing you made meant
//   finding the day it was on first.
//
// A third thing turned up while building it, and is the one a person would
// actually hit: the edit form derived the DAY from the entry and never offered
// it, so a meeting could be re-timed within its day and not moved to another
// one. Moving Tuesday to Thursday meant deleting and retyping — which loses
// the notes and the series, the exact loss the form's own comment says it
// exists to prevent. It was doing half the job it described.
const ROOT = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4679, BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function client() {
  let cookie = '';
  return async function call(method, p, body) {
    const r = await fetch(`${BASE}/api${p}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const t = await r.text();
    let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = { raw: t }; }
    return { s: r.status, d };
  };
}
async function signUp(call, name, email, category, handle) {
  await call('POST', '/auth/signup', { name, email, password: PW, accountCategory: category });
  await call('PATCH', '/profile', { slug: handle });
  await call('POST', '/profile/onboarding-step', { step: 'done' });
  return (await call('GET', '/auth/me')).d.user;
}
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let browser = null;

  try {
    const deadline = Date.now() + 150000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = client();
    const me = await signUp(boss, 'Adaeze Okonkwo', `ada${ID}@x.com`, 'principal', `ada-${ID}`);
    await boss('PATCH', '/profile', { timezone: 'Africa/Lagos' });

    // A schedule the office makes itself, on a day two days out so it is
    // neither past nor today.
    const made = (await boss('POST', `/itinerary/${me.id}/items`, {
      kind: 'meal',
      title: 'Dinner with the Geneva delegation',
      startAt: `${day(2)}T18:30:00.000Z`,
      endAt: `${day(2)}T20:30:00.000Z`,
      location: 'Hotel des Bergues',
      notes: 'Table booked under Okonkwo.',
    })).d.item;
    ok('a schedule is made', !!made?.id, JSON.stringify(made).slice(0, 140));

    // ---- It can be fetched on its own -------------------------------------
    head('A schedule that was made can be asked for on its own:');
    let r = await boss('GET', `/itinerary/${me.id}/items/${made.id}`);
    ok('the entry comes back by id', r.s === 200 && r.d.item?.id === made.id,
      `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    ok('with everything the screen needs to draw itself',
      r.d.item.title === 'Dinner with the Geneva delegation'
      && !!r.d.timezone && r.d.viewerIsPrincipal === true,
      JSON.stringify({ tz: r.d.timezone, own: r.d.viewerIsPrincipal }));

    r = await boss('GET', `/itinerary/${me.id}/items/made-up-id`);
    ok('and one that does not exist is a 404, not a crash', r.s === 404, String(r.s));

    // A DRAFT STAYS OUT OF THE PRINCIPAL'S SIGHT. The detail route must not be
    // the one way round the rule every other handler here applies — a route
    // that skipped it would be a second copy of the gate, and the copy that
    // drifts is the one that shows somebody a draft.
    head('And the new way in does not become a way round the draft rule:');
    const pa = client();
    await signUp(pa, 'Ngozi Bello', `ngozi${ID}@x.com`, 'pa', `ngozi-${ID}`);
    r = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${String(r.d.inviteLink).split('/').pop()}/accept`);

    const draft = (await pa('POST', `/itinerary/${me.id}/items`, {
      kind: 'meeting', title: 'Draft — the bank, not yet agreed',
      startAt: `${day(3)}T10:00:00.000Z`, endAt: `${day(3)}T11:00:00.000Z`,
      status: 'draft',
    })).d.item;
    ok('an assistant writes a draft', draft?.status === 'draft', JSON.stringify(draft?.status));
    // POSITIVE CONTROL: the assistant who wrote it can open it.
    r = await pa('GET', `/itinerary/${me.id}/items/${draft.id}`);
    ok('and can open their own draft', r.s === 200, String(r.s));
    r = await boss('GET', `/itinerary/${me.id}/items/${draft.id}`);
    ok('but the principal cannot, exactly as on the day sheet', r.s === 404, String(r.s));
    // POSITIVE CONTROL: the principal can open a published one, so the 404
    // above is the draft rule rather than a route that refuses everybody.
    r = await boss('GET', `/itinerary/${me.id}/items/${made.id}`);
    ok('though they can open a published one', r.s === 200, String(r.s));

    // ---- The day can be changed, not only the time ------------------------
    head('A schedule can be moved to another day:');
    r = await boss('PATCH', `/itinerary/${me.id}/items/${made.id}`, {
      startAt: `${day(5)}T19:00:00.000Z`, endAt: `${day(5)}T21:00:00.000Z`,
    });
    ok('the server takes a new day', r.s === 200, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    ok('and it lands on it', String(r.d.item.startAt).slice(0, 10) === day(5),
      `${r.d.item.startAt} vs ${day(5)}`);
    // What makes moving worth doing rather than deleting and retyping.
    ok('keeping the notes it was carrying', r.d.item.notes === 'Table booked under Okonkwo.',
      JSON.stringify(r.d.item.notes));
    ok('and where it is', r.d.item.location === 'Hotel des Bergues',
      JSON.stringify(r.d.item.location));

    // ---- On screen ---------------------------------------------------------
    head('And on screen, the whole row opens it:');
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } }))
      .newPage();
    const threw = [];
    page.on('pageerror', (e) => threw.push(e.message));

    await page.goto(`${BASE}/login`);
    await page.fill('input[type=email]', `ada${ID}@x.com`);
    await page.fill('input[type=password]', PW);
    await page.click('button[type=submit]');
    await page.waitForSelector('nav', { timeout: 20000 });

    // The day sheet opens on today and its date is not in the URL, so the
    // day is picked the way a person picks it.
    await page.goto(`${BASE}/itinerary`);
    await page.waitForSelector('input[aria-label="Day"]', { timeout: 20000 });
    await page.fill('input[aria-label="Day"]', day(5));
    await page.waitForSelector('.sched-row', { timeout: 20000 });
    const row = page.locator('.sched-row', { hasText: 'Dinner with the Geneva delegation' });
    ok('the entry is on the day', (await row.count()) === 1, String(await row.count()));
    ok('and its row is marked as one that opens',
      /is-openable/.test(await row.getAttribute('class') || ''),
      await row.getAttribute('class'));

    // THE ASSERTION THE WHOLE THING EXISTS FOR. Clicked well away from the
    // title — near the right-hand edge of the row, where there is no text at
    // all — because that is exactly where the old version did nothing.
    const box = await row.boundingBox();
    ok('the row is a large target rather than a few words', box.width > 300, JSON.stringify(box));
    await page.mouse.click(box.x + box.width - 24, box.y + box.height / 2);
    await page.waitForFunction(() => /\/schedule\//.test(window.location.pathname), null,
      { timeout: 10000 }).catch(() => {});
    ok('and pressing it anywhere opens the schedule',
      /^\/schedule\//.test(new URL(page.url()).pathname), new URL(page.url()).pathname);

    await page.waitForSelector('.card', { timeout: 10000 });
    const face = await page.locator('body').innerText();
    ok('the page names the thing', /Dinner with the Geneva delegation/.test(face),
      face.slice(0, 200));
    ok('and says where it is', /Hotel des Bergues/.test(face), face.slice(0, 300));

    // ---- Editable from the details -----------------------------------------
    head('And from there it can be edited:');
    await page.click('button:has-text("Edit the details")');
    await page.waitForSelector('.itin-edit', { timeout: 10000 });
    ok('the form opens on the page itself',
      (await page.locator('.itin-edit').count()) === 1);
    // The field that did not exist before this.
    const dayField = page.locator('.itin-edit input[type="date"]');
    ok('and it offers the day, not only the time', (await dayField.count()) === 1,
      String(await dayField.count()));
    ok('starting on the day it is currently on',
      (await dayField.inputValue()) === day(5), await dayField.inputValue());

    await dayField.fill(day(6));
    await page.fill('.itin-edit input[type="text"]', 'Dinner with the Geneva delegation — moved');
    const saved = page.waitForResponse(
      (res) => /\/api\/itinerary\/.*\/items\//.test(res.url())
        && res.request().method() === 'PATCH' && res.status() === 200,
      { timeout: 20000 },
    );
    await page.click('.itin-edit button:has-text("Save the change")');
    await saved;
    await page.waitForTimeout(400);
    ok('saving from the details page takes',
      /moved/.test(await page.locator('body').innerText()),
      (await page.locator('body').innerText()).slice(0, 200));

    r = await boss('GET', `/itinerary/${me.id}/items/${made.id}`);
    ok('and the day it was moved to is the day it is on',
      String(r.d.item.startAt).slice(0, 10) === day(6), r.d.item.startAt);
    ok('with the notes still on it', r.d.item.notes === 'Table booked under Okonkwo.',
      JSON.stringify(r.d.item.notes));

    ok('nothing threw on any of it', threw.length === 0, JSON.stringify(threw));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA schedule opens where you press it, and can be changed once it is open.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
