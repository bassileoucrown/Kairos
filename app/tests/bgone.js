// Taking somebody out of the address book, and what goes with them.
//
// THE PLAIN VERSION OF THIS BUTTON IS DANGEROUS, which is the whole reason
// this file exists. A contact looks like a name and an email on a card. It is
// also the SUBJECT a vault entry hangs off — a spouse's passport, a child's
// yellow fever card — with ON DELETE CASCADE behind it. So the obvious delete
// button on a contact card silently destroys a family member's identity
// documents, and the person pressing it has no way to know that from what they
// are looking at.
//
// So the first attempt is refused and says what is attached, and only a
// request naming that number goes through. The confirmation IS the count:
// somebody who has read "3 documents" has been told the thing that matters,
// which a typed name would not have told them.
//
// AND THE MEETINGS STAY. Bookings are keyed on the booker's email rather than
// on the contact row, so the history of who was seen and when survives.
// Removing somebody from your address book is not a claim that you never met.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4605, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

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
  const fs = require('fs');
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
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('PATCH', '/profile', { timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    // ---- Somebody with nothing kept against them --------------------------
    head('A contact with nothing behind them goes without ceremony:');
    let r = await boss('POST', `/pa/${bossId}/contacts`,
      { email: 'kemi@x.com', name: 'Kemi Adebayo' });
    const plain = r.d.contact.id;
    r = await boss('DELETE', `/pa/${bossId}/contacts/${plain}`);
    ok('they are simply removed', r.s === 204, `${r.s} ${JSON.stringify(r.d)}`);
    ok('and are gone from the book',
      !(await boss('GET', `/pa/${bossId}/contacts`)).d.contacts.some((c) => c.id === plain));

    r = await boss('DELETE', `/pa/${bossId}/contacts/${plain}`);
    ok('removing them twice is a plain not-found', r.s === 404, String(r.s));

    // ---- Somebody the vault knows about -----------------------------------
    head('But somebody the vault knows about is not removed quietly:');
    r = await boss('POST', `/pa/${bossId}/contacts`,
      { email: 'ifeoma@x.com', name: 'Ifeoma Eze' });
    const family = r.d.contact.id;
    // A spouse's papers, hung off the contact rather than off the principal.
    for (const [field, value, expires] of [
      ['passport_number', 'B77220011', '2030-04-01'],
      ['yellow_fever_card', 'YF-9911', '2032-01-01'],
    ]) {
      const made = await boss('POST', `/essentials/${bossId}`, {
        category: 'travel_identity', field, value, expiresOn: expires,
        subjectContactId: family,
      });
      ok(`a document is held against them (${field})`, made.s === 201,
        `${made.s} ${JSON.stringify(made.d).slice(0, 120)}`);
    }

    // THE ASSERTION THIS FILE EXISTS FOR.
    r = await boss('DELETE', `/pa/${bossId}/contacts/${family}`);
    ok('the first attempt is refused', r.s === 409, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    ok('and says what would go with them', r.d.documents === 2, JSON.stringify(r.d));
    ok('naming it as the reason', r.d.code === 'contact_has_records', r.d.code);
    // Refused means refused: nothing may be half-done.
    ok('and nothing has been deleted yet',
      (await boss('GET', `/essentials/${bossId}`)).d.essentials
        .filter((e) => e.subjectContactId === family).length === 2);

    // A number that is not the real one is not a confirmation.
    r = await boss('DELETE', `/pa/${bossId}/contacts/${family}`, { alsoDelete: 1 });
    ok('agreeing to the wrong number is still refused', r.s === 409, String(r.s));
    r = await boss('DELETE', `/pa/${bossId}/contacts/${family}`, { alsoDelete: true });
    ok('and so is a bare yes', r.s === 409, String(r.s));

    r = await boss('DELETE', `/pa/${bossId}/contacts/${family}`, { alsoDelete: 2 });
    ok('naming the count goes through', r.s === 204, `${r.s} ${JSON.stringify(r.d)}`);
    ok('and the documents go with them',
      (await boss('GET', `/essentials/${bossId}`)).d.essentials
        .filter((e) => e.subjectContactId === family).length === 0);
    // Destroying papers is a reach into the vault, and the principal is
    // entitled to see that it happened — so the deletion is written to the
    // access log beside the reveals. Checked against the table rather than
    // through an endpoint, because nothing reads that log back yet; an
    // assertion that cannot fail is worse than no assertion, and the first
    // draft of this line was one.
    const logged = await require(`${ROOT}/app/server/lib/db`).prepare(
      "SELECT * FROM access_log WHERE subject_owner_id = ? AND action = 'delete'",
    ).all(bossId);
    ok('destroying somebody\'s papers is on the record',
      logged.some((l) => /Ifeoma/.test(l.field || '')),
      JSON.stringify(logged.map((l) => l.field)));

    // ---- Nobody else's book -----------------------------------------------
    head('And it is nobody else\'s book to empty:');
    r = await boss('POST', `/pa/${bossId}/contacts`, { email: 'bola@x.com', name: 'Bola Adeyemi' });
    const mine = r.d.contact.id;
    const stranger = client();
    await stranger('POST', '/auth/signup',
      { name: 'Nobody', email: `no${ID}@x.com`, password: PW, accountCategory: 'principal' });
    ok('somebody outside the office cannot reach it',
      (await stranger('DELETE', `/pa/${bossId}/contacts/${mine}`)).s === 403);
    ok('and the contact is still there',
      (await boss('GET', `/pa/${bossId}/contacts`)).d.contacts.some((c) => c.id === mine));

    // ---- The button --------------------------------------------------------
    head('The button is on the card, once it is opened:');
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `ada${ID}@x.com`, password: PW }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const [ck, cv] = cookie.split('=');
    await ctx.addCookies([{ name: ck, value: cv, domain: '127.0.0.1', path: '/' }]);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    await page.goto(`${BASE}/pa/${bossId}?tab=contacts`);
    await page.waitForSelector('.contact-card', { timeout: 20000 });
    // A delete sitting on a closed row is a delete somebody presses while
    // scrolling, and this one can take a passport with it.
    ok('it is not on the closed card',
      (await page.locator('.contact-card button:has-text("Remove")').count()) === 0);

    // Opened by its own Edit control rather than by clicking the card: the
    // card is a thing you read, and only the control opens it.
    await page.locator('.contact-card', { hasText: 'Bola Adeyemi' })
      .locator('button:has-text("Edit")').click();
    await page.waitForSelector('.contact-card.is-open', { timeout: 20000 });
    ok('and is there once the card is opened',
      (await page.locator('.contact-card.is-open button:has-text("Remove")').count()) === 1);

    await page.click('.contact-card.is-open button:has-text("Remove")');
    await page.waitForFunction(
      () => !/Bola Adeyemi/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('pressing it takes them off the list', true);
    ok('and the server agrees',
      !(await boss('GET', `/pa/${bossId}/contacts`)).d.contacts.some((c) => c.id === mine));

    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    proc.kill();
  }

  console.log(fails === 0
    ? '\nSomebody can be taken out of the book, and what goes with them is said first.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
