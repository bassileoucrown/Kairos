// One box that finds anything, asked as the person asking.
//
// EVERY OTHER SCREEN ASKS ONE TABLE. Search asks all of them, which is why it
// is the one feature in this product that can undo the rest of it: the obvious
// implementation queries everything and filters afterwards, and that leaks by
// its shape even when it shows nothing — "3 results in Essentials" tells a
// scheduling delegate a passport exists.
//
// So this suite is almost entirely negatives, and the trap with negatives is
// that they pass when the code is broken and when the thing was never there.
// Every one below therefore has a POSITIVE CONTROL beside it: the same word,
// searched by somebody who is entitled to it, comes back. A delegate finding
// nothing for "passport" means something only because the principal finds
// something for "passport" in the same breath.
//
// The four that matter most:
//
//   A SCHEDULING DELEGATE does not find sensitive things — not the entry, not
//   the document, not the archive — while finding the ordinary ones.
//
//   A PERSONAL TRIP is offline to the office. Somebody searching the city the
//   principal is quietly in gets nothing.
//
//   A ROOM SOMEBODY IS NOT IN is not searchable, and neither is a word said
//   inside it. This is the sharpest one, because a room is where people write
//   what they would not put in a field.
//
//   THE VALUE IS NEVER RETURNED. Search finds that a passport is on file. The
//   number costs a second factor and a line in the custody trail, and typing
//   into a box is not that.
const ROOT = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4677, BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
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
    return { s: r.status, d, text: t };
  };
}

async function signUp(call, name, email, category, handle) {
  await call('POST', '/auth/signup', { name, email, password: PW, accountCategory: category });
  await call('PATCH', '/profile', { slug: handle });
  await call('POST', '/profile/onboarding-step', { step: 'done' });
  return (await call('GET', '/auth/me')).d.user;
}

/** Every hit, flattened, so an assertion can ask "is this word anywhere in it". */
function flat(res) {
  return (res.d?.groups || []).flatMap((g) => g.hits.map((h) => ({ ...h, group: g.id })));
}
const inGroup = (res, id) => flat(res).filter((h) => h.group === id);
const anywhere = (res, re) => flat(res).some((h) => re.test(`${h.title} ${h.detail}`));
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
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ENCRYPTION_KEY: KEY },
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

    // ---- An office ---------------------------------------------------------
    const boss = client();
    const me = await signUp(boss, 'Adaeze Okonkwo', `ada${ID}@x.com`, 'principal', `ada-${ID}`);

    // A full-remit assistant, and a scheduling delegate. The difference
    // between them is the whole point of most of what follows.
    const pa = client();
    await signUp(pa, 'Ngozi Bello', `ngozi${ID}@x.com`, 'pa', `ngozi-${ID}`);
    let r = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${String(r.d.inviteLink).split('/').pop()}/accept`);

    const del = client();
    await signUp(del, 'Chidi Umeh', `chidi${ID}@x.com`, 'pa', `chidi-${ID}`);
    r = await boss('POST', '/members', { email: `chidi${ID}@x.com`, role: 'delegate' });
    await del('POST', `/invites/${String(r.d.inviteLink).split('/').pop()}/accept`);

    // Somebody with no standing at all.
    const outsider = client();
    await signUp(outsider, 'Tunde Bakare', `tunde${ID}@x.com`, 'principal', `tunde-${ID}`);

    // The vault: one sensitive entry, one ordinary.
    await boss('POST', `/essentials/${me.id}`, {
      category: 'travel_identity', field: 'passport_number',
      label: 'Passport (Nigeria)', value: 'A05512347',
    });
    await boss('POST', `/essentials/${me.id}`, {
      category: 'logistics', field: 'vehicle_plate',
      label: 'Passport-blue Range Rover plate', value: 'LAG-118-KJA',
    });

    // A contact, so an ordinary source has something in it.
    r = await boss('POST', `/pa/${me.id}/contacts`, {
      name: 'Emeka Passport-Agent', email: `emeka${ID}@x.com`,
      notes: 'Runs the travel desk.',
    });
    ok('a contact is on file', r.s === 201, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);

    // Two trips: one the office may see, one personal.
    const officeTrip = (await boss('POST', `/trips/${me.id}`, {
      name: 'Geneva board week', destination: 'Geneva',
      startsOn: day(10), endsOn: day(14), visibility: 'office',
    })).d.trip;
    const privateTrip = (await boss('POST', `/trips/${me.id}`, {
      name: 'Zanzibar with the family', destination: 'Zanzibar',
      startsOn: day(30), endsOn: day(37), visibility: 'private',
    })).d.trip;
    ok('the office has two trips, one of them personal',
      !!officeTrip && !!privateTrip, JSON.stringify({ officeTrip, privateTrip }).slice(0, 120));

    // A room the assistant is in and the delegate is not, with a sentence in
    // it that nobody outside should be able to find.
    const space = (await boss('POST', '/spaces', { name: 'Board matters', context: 'work' })).d.space;
    await boss('POST', `/spaces/${space.id}/members`, {
      email: `ngozi${ID}@x.com`, role: 'contributor',
    });
    const thread = (await boss('POST', `/spaces/${space.id}/threads`, {
      name: 'Zanzibar lease renewal',
    })).d.thread;
    await boss('POST', `/threads/${thread.id}/messages`, {
      body: 'The bank will not move on the Zanzibar covenant before the audit lands.',
      register: 'talk',
    });

    // ---- Nobody without standing gets anything -----------------------------
    head('Search answers for a desk you are actually at:');
    r = await outsider('GET', `/search/${me.id}?q=passport`);
    ok('a stranger is refused outright', r.s === 403, String(r.s));
    r = await (client())('GET', `/search/${me.id}?q=passport`);
    ok('and somebody not signed in at all is refused', r.s === 401, String(r.s));

    // ---- The principal finds their own things -----------------------------
    head('The principal finds what is theirs:');
    r = await boss('GET', `/search/${me.id}?q=passport`);
    ok('the search answers', r.s === 200, String(r.s));
    ok('the vault entry is found', inGroup(r, 'essentials').some((h) => /Passport \(Nigeria\)/.test(h.title)),
      JSON.stringify(inGroup(r, 'essentials')));
    ok('with a way through to it',
      inGroup(r, 'essentials').every((h) => /tab=essentials/.test(h.href)),
      JSON.stringify(inGroup(r, 'essentials').map((h) => h.href)));

    // THE ASSERTION THE VAULT'S WHOLE DESIGN RESTS ON. Finding that a passport
    // is on file is not reading the number, and this must never become that.
    ok('but the number itself is nowhere in the answer',
      !/A05512347/.test(r.text), 'the value was returned');
    // And not masked either — a mask is still a statement about the value.
    ok('nor a mask of it', !/2347/.test(r.text), 'a masked value was returned');

    ok('the contact is found too', inGroup(r, 'people').length === 1,
      JSON.stringify(inGroup(r, 'people')));
    ok('and the ordinary vault entry that merely mentions the word',
      inGroup(r, 'essentials').some((h) => /Range Rover/.test(h.title)),
      JSON.stringify(inGroup(r, 'essentials').map((h) => h.title)));
    ok('the groups are named for the screen',
      (r.d.groups || []).every((g) => g.label && g.label.length > 2),
      JSON.stringify((r.d.groups || []).map((g) => g.label)));

    // ---- The delegate ------------------------------------------------------
    head('A scheduling delegate finds the ordinary and not the sensitive:');
    r = await del('GET', `/search/${me.id}?q=passport`);
    ok('their search answers rather than refusing', r.s === 200, String(r.s));
    // POSITIVE CONTROL FIRST. They really are searching this desk, so the
    // absences below are the gate rather than an empty response.
    ok('they find the contact, so the search is working for them',
      inGroup(r, 'people').length === 1, JSON.stringify(flat(r)));
    ok('and the ordinary vault entry, which their remit covers',
      inGroup(r, 'essentials').some((h) => /Range Rover/.test(h.title)),
      JSON.stringify(inGroup(r, 'essentials').map((h) => h.title)));
    ok('but not the passport entry',
      !inGroup(r, 'essentials').some((h) => /Passport \(Nigeria\)/.test(h.title)),
      JSON.stringify(inGroup(r, 'essentials').map((h) => h.title)));
    // NOT "0 of 3", NOT "1 withheld". Absent.
    ok('and nothing anywhere says something was held back',
      !/withheld|hidden|not shown|cannot see/i.test(r.text), r.text.slice(0, 200));

    // ---- The personal trip -------------------------------------------------
    head('A personal trip is offline to the office:');
    r = await boss('GET', `/search/${me.id}?q=zanzibar`);
    ok('the principal finds their own', inGroup(r, 'trips').length === 1,
      JSON.stringify(inGroup(r, 'trips')));
    r = await pa('GET', `/search/${me.id}?q=geneva`);
    // POSITIVE CONTROL: the assistant can search trips at all.
    ok('the assistant finds the office trip', inGroup(r, 'trips').length === 1,
      JSON.stringify(inGroup(r, 'trips')));
    r = await pa('GET', `/search/${me.id}?q=zanzibar`);
    ok('and does not find the personal one',
      inGroup(r, 'trips').length === 0, JSON.stringify(inGroup(r, 'trips')));
    ok('nor its destination anywhere else in the answer',
      !/Zanzibar with the family/.test(r.text), r.text.slice(0, 300));

    // ---- The room ----------------------------------------------------------
    head('A room you are not in is not searchable, and nor is what was said in it:');
    r = await pa('GET', `/search/${me.id}?q=zanzibar`);
    ok('somebody in the room finds the room', inGroup(r, 'rooms').length === 1,
      JSON.stringify(inGroup(r, 'rooms')));
    ok('and the sentence inside it', inGroup(r, 'said').length === 1,
      JSON.stringify(inGroup(r, 'said')));
    ok('with the line it came from, trimmed to fit',
      inGroup(r, 'said')[0]?.title?.length < 120,
      String(inGroup(r, 'said')[0]?.title));

    // AND THE DELEGATE IS NOT IN IT, which is a fact about the product rather
    // than about search — asserted here because search is what found it.
    //
    // A Work space auto-admits the principal's assistants, and it used to pick
    // them by the account_category they typed at signup rather than by the
    // role the principal appointed them to. Chidi was invited as a delegate
    // and had described themselves as "PA", so every Work space the principal
    // created quietly admitted them. See applyRoleDefaults in spaceAccess.js.
    const rooms = await del('GET', `/spaces/${space.id}`);
    ok('the delegate cannot open the room at all, whatever they called themselves',
      rooms.s === 404 || rooms.s === 403, `${rooms.s} ${JSON.stringify(rooms.d).slice(0, 120)}`);
    // POSITIVE CONTROL: the assistant the principal DID appoint is in it.
    const paRooms = await pa('GET', `/spaces/${space.id}`);
    ok('while the assistant appointed as a PA is', paRooms.s === 200, String(paRooms.s));

    r = await del('GET', `/search/${me.id}?q=zanzibar`);
    ok('the delegate, who is not in it, finds neither the room',
      inGroup(r, 'rooms').length === 0, JSON.stringify(inGroup(r, 'rooms')));
    ok('nor the sentence', inGroup(r, 'said').length === 0, JSON.stringify(inGroup(r, 'said')));
    ok('and not the word anywhere at all', !/covenant/i.test(r.text), r.text.slice(0, 200));
    // POSITIVE CONTROL: the delegate's search is alive on the same word.
    r = await del('GET', `/search/${me.id}?q=range`);
    ok('though their search finds what is theirs on another word',
      flat(r).length > 0, JSON.stringify(flat(r)));

    // ---- Documents ---------------------------------------------------------
    //
    // A filename is findable; a document that was flagged sensitive is not
    // findable by somebody who could not open it. Storage is not configured in
    // this suite, so the rows are written directly — the gate under test is
    // the search filter, not the upload.
    head('A document is found by name, by whoever could open it:');
    const dbLib = require(`${ROOT}/app/server/lib/db`);
    const crypto = require('crypto');
    const ess = (await boss('GET', `/essentials/${me.id}`)).d.essentials;
    const plate = ess.find((e) => /Range Rover/.test(e.label));
    const now = new Date().toISOString();
    for (const [name, sensitivity] of [
      ['insurance-certificate.pdf', 'ordinary'],
      ['passport-scan.pdf', 'sensitive'],
    ]) {
      await dbLib.prepare(`
        INSERT INTO documents (id, owner_id, essential_id, object_key, format, mime_type,
                               filename, bytes, sensitivity, flagged_by, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, 'pdf', 'application/pdf', ?, 1024, ?, 'name', ?, ?)
      `).run(crypto.randomUUID(), me.id, plate.id, 'k', name, sensitivity, me.id, now);
    }

    r = await boss('GET', `/search/${me.id}?q=scan`);
    ok('the principal finds the scan by its filename',
      inGroup(r, 'documents').some((h) => /passport-scan\.pdf/.test(h.title)),
      JSON.stringify(inGroup(r, 'documents')));
    r = await del('GET', `/search/${me.id}?q=certificate`);
    ok('a delegate finds the ordinary document on a field they can read',
      inGroup(r, 'documents').some((h) => /insurance-certificate/.test(h.title)),
      JSON.stringify(inGroup(r, 'documents')));
    r = await del('GET', `/search/${me.id}?q=scan`);
    // THE ONE THAT MATTERS. The document is stricter than the entry it hangs
    // on — that is exactly the case the flag exists for, and search must
    // honour the document's own line rather than the entry's.
    ok('but not the sensitive scan sitting on that same field',
      inGroup(r, 'documents').length === 0, JSON.stringify(inGroup(r, 'documents')));

    // ---- The pad -----------------------------------------------------------
    head('A private line is the author\'s own:');
    await pa('POST', '/pad', { body: 'Chase the Zanzibar villa deposit', visibility: 'private' });
    r = await pa('GET', `/search/${me.id}?q=villa`);
    ok('the author finds their own line', inGroup(r, 'pad').length === 1,
      JSON.stringify(inGroup(r, 'pad')));
    r = await boss('GET', `/search/${me.id}?q=villa`);
    ok('and the principal does not, because it was private',
      inGroup(r, 'pad').length === 0, JSON.stringify(inGroup(r, 'pad')));
    // POSITIVE CONTROL: an office line does reach the principal's search.
    await pa('POST', '/pad', {
      body: 'Villa quote needs the office to decide', visibility: 'office', ownerId: me.id,
    });
    r = await boss('GET', `/search/${me.id}?q=villa`);
    ok('though a line put on the office pad does',
      inGroup(r, 'pad').some((h) => /office to decide/.test(h.title)),
      JSON.stringify(inGroup(r, 'pad')));

    // ---- Every result leads somewhere --------------------------------------
    //
    // THE ONE THAT ACTUALLY BIT. The first version of this register invented
    // hrefs — `/trips/<id>`, `/tasks?task=<id>` — that read like routes and
    // are not any route this client has. React Router sends an unmatched path
    // to the landing page, so every one of those results silently dumped the
    // reader on Today, which looks like a bug in search and is a bug in the
    // link. A result that goes nowhere is worse than no result, because the
    // reader believes they were shown the thing.
    head('Every result points at a screen that exists:');
    const routes = fs.readFileSync(`${ROOT}/app/client/src/App.jsx`, 'utf8')
      .split('\n').map((l) => (/<Route path="([^"]+)"/.exec(l) || [])[1])
      .filter(Boolean);
    ok('the client\'s own route table was read', routes.length > 20, String(routes.length));
    const resolves = (href) => {
      const path = String(href).split('?')[0].split('#')[0];
      const parts = path.split('/').filter(Boolean);
      return routes.some((route) => {
        const want = route.split('/').filter(Boolean);
        if (want.length !== parts.length) return false;
        return want.every((seg, i) => seg.startsWith(':') || seg === parts[i]);
      });
    };
    // Gathered across several searches so every source contributes one.
    const everyHit = [];
    for (const word of ['passport', 'geneva', 'zanzibar', 'scan', 'villa', 'emeka']) {
      everyHit.push(...flat(await boss('GET', `/search/${me.id}?q=${word}`)));
    }
    ok('several sources are represented in the sample',
      new Set(everyHit.map((h) => h.group)).size >= 5,
      JSON.stringify([...new Set(everyHit.map((h) => h.group))]));
    const broken = everyHit.filter((h) => !resolves(h.href));
    ok('and not one of them points at a path this app does not have',
      broken.length === 0, JSON.stringify(broken.map((h) => `${h.group}: ${h.href}`)));
    // POSITIVE CONTROL: the checker can tell a bad path from a good one, so
    // the green above is the hrefs rather than a check that always passes.
    ok('the check itself can spot an invented route',
      !resolves('/trips/abc123') && resolves('/trips'), 'the route checker is not checking');

    // ---- No source is quietly broken ---------------------------------------
    //
    // run() catches a source that throws, so one broken query cannot take down
    // the whole answer. That is right and it is also how a query broken by a
    // renamed column goes unnoticed: a source contributing nothing looks
    // exactly like a source with nothing to contribute. Both column mistakes
    // in the first version of this register — contacts.company and
    // kept_items.created_at — were invisible for that reason until the
    // assertions that happened to cover them went red.
    head('Nothing is failing quietly:');
    r = await boss('GET', `/search/${me.id}?q=a`);
    ok('a short query reports no failures', (r.d.failed || []).length === 0,
      JSON.stringify(r.d.failed));
    for (const word of ['passport', 'geneva', 'the', 'scan']) {
      r = await boss('GET', `/search/${me.id}?q=${word}`);
      ok(`every source answers for "${word}" without throwing`,
        (r.d.failed || []).length === 0, JSON.stringify(r.d.failed));
    }
    // And from a viewer with a narrower remit, which takes different branches.
    r = await del('GET', `/search/${me.id}?q=passport`);
    ok('and for a delegate too', (r.d.failed || []).length === 0, JSON.stringify(r.d.failed));

    // ---- The shape of the answer -------------------------------------------
    head('And the box behaves like a box:');
    r = await boss('GET', `/search/${me.id}?q=p`);
    ok('one letter is not a search, and says so',
      r.s === 200 && r.d.tooShort === true && r.d.total === 0, JSON.stringify(r.d).slice(0, 160));
    ok('with the minimum said rather than left to be guessed',
      r.d.minimum === 2, String(r.d.minimum));
    r = await boss('GET', `/search/${me.id}?q=`);
    ok('an empty query is answered rather than erroring', r.s === 200, String(r.s));
    r = await boss('GET', `/search/${me.id}?q=zzzznothing`);
    ok('a word that is nowhere returns an empty answer, not an error',
      r.s === 200 && r.d.total === 0 && (r.d.groups || []).length === 0,
      JSON.stringify(r.d).slice(0, 160));

    // Case, because Postgres LIKE is case-sensitive and SQLite's is not — the
    // exact difference that reaches main when only one board is run.
    for (const q of ['GENEVA', 'geneva', 'GeNeVa']) {
      r = await boss('GET', `/search/${me.id}?q=${q}`);
      ok(`"${q}" finds the trip whatever the case`, inGroup(r, 'trips').length === 1,
        `${q}: ${JSON.stringify(inGroup(r, 'trips'))}`);
    }

    // A LIKE wildcard typed by a person is a search term, not a pattern.
    r = await boss('GET', `/search/${me.id}?q=${encodeURIComponent('%')}`);
    ok('a percent sign does not match everything',
      r.d.total === 0 || r.d.tooShort === true, JSON.stringify(r.d).slice(0, 160));

    // ---- The box on screen -------------------------------------------------
    //
    // Every assertion above would pass with no box anywhere in the client.
    head('And there is a box, reachable from wherever you are:');
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } }))
      .newPage();
    const threw = [];
    page.on('pageerror', (e) => threw.push(e.message));

    await page.goto(`${BASE}/login`);
    await page.fill('input[type=email]', `ada${ID}@x.com`);
    await page.fill('input[type=password]', PW);
    await page.click('button[type=submit]');
    await page.waitForSelector('nav', { timeout: 20000 });

    // From a screen that is not a search screen, which is the point.
    await page.goto(`${BASE}/itinerary`);
    await page.waitForSelector('.find-open', { timeout: 20000 });
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.find-input', { timeout: 10000 });
    ok('the chord opens it from any screen', true);

    await page.fill('.find-input', 'geneva');
    // Waited on the answer for THIS word rather than on the box, which is
    // present the moment it opens and would photograph the previous state.
    await page.waitForResponse(
      (r) => /\/api\/search\//.test(r.url()) && /q=geneva/.test(r.url()) && r.status() === 200,
      { timeout: 20000 },
    );
    await page.waitForSelector('.find-hit', { timeout: 10000 });
    const shown = await page.locator('.find-hit').allInnerTexts();
    ok('and typing finds the trip', shown.some((t) => /Geneva board week/.test(t)),
      JSON.stringify(shown));
    // Case-insensitive: the heading is upper-cased by the stylesheet, and an
    // assertion that reads the rendered text has to read what is rendered.
    ok('under a heading that says what kind of thing it is',
      /trips/i.test(await page.locator('.find-group h3').first().innerText()),
      await page.locator('.find-group h3').first().innerText());

    // The first hit is the one Enter would take, so say that before pressing
    // anything — otherwise "Enter went somewhere" and "Enter went to the RIGHT
    // somewhere" are the same assertion, and the cursor landing on hit two is
    // indistinguishable from the keypress being lost.
    ok('the first hit is the one the cursor is on',
      /Geneva board week/.test(await page.locator('.find-hit').first().innerText()),
      await page.locator('.find-hit').first().innerText());

    // CLICKED BY NAME RATHER THAN PRESSING ENTER BLIND. Enter acts on whatever
    // the cursor is on, and the cursor is React state that settles a tick
    // after the list paints — pressing into that gap navigated to the app's
    // landing page once in several runs, which is a race in the test and not
    // in the box. Clicking the named hit exercises the same go().
    await page.locator('.find-hit', { hasText: 'Geneva board week' }).click();
    await page.waitForFunction(() => /trip=/.test(window.location.search), null,
      { timeout: 10000 }).catch(() => {});
    const landed = new URL(page.url());
    ok('and choosing it takes you to the screen it lives on',
      landed.pathname === '/trips', landed.pathname);
    // NOT JUST THE SCREEN — the trip. A result that drops you on a list and
    // leaves you to find what you just searched for did half its job, and it
    // is indistinguishable from a working one unless the id is checked.
    ok('with that trip named in the address, so it opens rather than the list',
      landed.searchParams.get('trip') === officeTrip.id,
      `${landed.search} vs ${officeTrip.id}`);
    await page.waitForSelector('.trip-open, .trip-detail, h2', { timeout: 10000 }).catch(() => {});
    ok('and the trip itself is on the screen',
      /Geneva board week/.test(await page.locator('body').innerText()),
      (await page.locator('body').innerText()).slice(0, 200));

    // Escape closes without navigating anywhere. Waited for the shell to
    // finish drawing on the page we just landed on — pressing the chord at a
    // half-mounted screen is a race, not a test.
    await page.waitForSelector('.find-open', { timeout: 20000 });
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.find-input', { timeout: 10000 });
    const before = page.url();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    ok('Escape closes it', (await page.locator('.find-input').count()) === 0);
    ok('and leaves you where you were', page.url() === before, `${before} → ${page.url()}`);

    // A word that is nowhere says so, in the same words it uses for a word
    // that is somewhere this person may not look.
    await page.click('.find-open');
    await page.fill('.find-input', 'zzzznothing');
    await page.waitForResponse(
      (r) => /\/api\/search\//.test(r.url()) && /zzzznothing/.test(r.url()),
      { timeout: 20000 },
    );
    await page.waitForTimeout(200);
    ok('a word that is nowhere is said plainly',
      /Nothing here/.test(await page.locator('.find-results').innerText()),
      await page.locator('.find-results').innerText());

    ok('and nothing threw while the box was open', threw.length === 0, JSON.stringify(threw));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nOne box finds everything the person asking is allowed to see, and nothing else.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
