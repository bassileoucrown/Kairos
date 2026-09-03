// Visas: the half that can be answered truthfully.
//
// "Visa requirements" is two questions wearing one name. COVERAGE — does the
// visa I hold cover this trip — is deterministic from documents the principal
// supplied, and is what an assistant genuinely cannot hold in their head: a
// Schengen valid to March, a single-entry US already spent in January, a UK
// visa lapsing four days before the return flight. REQUIREMENT — does this
// passport need a visa for this country — is forty thousand pairs revised
// without notice, and a wrong "none needed" strands somebody at a check-in
// desk with a boarding pass they cannot use.
//
// So the test that matters most is the negative one: with nothing on file, the
// app must say "nothing on file" and must NOT say "no visa needed".
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4559, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
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
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let b = null;
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    const a = client();
    const up = await a('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const id = up.d.user.id;
    await a('PATCH', '/profile', { slug: `h${ID}-1` });
    await a('POST', '/profile/onboarding-step', { step: 'done' });

    const trip = async (name, dest, from, to) => (await a('POST', `/trips/${id}`, {
      name, destination: dest, startsOn: from, endsOn: to, status: 'confirmed',
    })).d.trip.id;
    const look = async (tripId) => (await a('GET', `/trips/${id}/${tripId}`)).d.visa;

    head('Nothing on file, which is the dangerous case:');
    const uk = await trip('London', 'United Kingdom', '2027-03-04', '2027-03-10');
    const none = await look(uk);
    ok('the answer is that nothing is on file', none.state === 'none', JSON.stringify(none).slice(0, 140));
    ok('and it does NOT claim a visa is unnecessary',
      !/not required|no visa needed|visa free/i.test(JSON.stringify(none)), JSON.stringify(none).slice(0, 200));
    ok('it says plainly that the rules lookup is not configured',
      none.rulesKnown === false);
    ok('while still offering a lead time, which is guidance rather than a rule',
      none.processing?.days === 20 && !!none.processing.reviewedOn, JSON.stringify(none.processing));
    ok('stamped with when it was last reviewed, so staleness is visible',
      /^\d{4}-\d{2}-\d{2}$/.test(none.processing.reviewedOn));

    head('A visa that covers it:');
    await a('POST', `/visas/${id}`, {
      country: 'United Kingdom', kind: 'multi', validFrom: '2026-01-01', validTo: '2029-01-01',
    });
    ok('is reported as covered', (await look(uk)).state === 'covers');

    head('The one people miss — valid on the way out, not on the way back:');
    const jp = await trip('Tokyo', 'Japan', '2027-05-01', '2027-05-20');
    await a('POST', `/visas/${id}`, {
      country: 'Japan', kind: 'single', validFrom: '2027-01-01', validTo: '2027-05-10',
    });
    const mid = await look(jp);
    ok('is caught', mid.state === 'expires', JSON.stringify(mid).slice(0, 160));
    ok('naming the last day it works', mid.visas[0].lastGoodDay === '2027-05-10');

    head('Already lapsed:');
    const ke = await trip('Nairobi', 'Kenya', '2027-06-01', '2027-06-05');
    await a('POST', `/visas/${id}`, {
      country: 'Kenya', kind: 'single', validFrom: '2026-01-01', validTo: '2027-01-01',
    });
    ok('is not confused with expiring mid-trip', (await look(ke)).state === 'expired');

    head('Issued, but not yet:');
    const gh = await trip('Accra', 'Ghana', '2027-02-01', '2027-02-05');
    await a('POST', `/visas/${id}`, {
      country: 'Ghana', kind: 'single', validFrom: '2027-03-01', validTo: '2028-03-01',
    });
    ok('is its own answer, not "expired"', (await look(gh)).state === 'not_yet');

    head('A single entry already spent:');
    const us = await trip('New York', 'United States', '2027-09-01', '2027-09-10');
    const made = await a('POST', `/visas/${id}`, {
      country: 'United States', kind: 'single', validFrom: '2026-01-01', validTo: '2030-01-01',
    });
    ok('covers the trip while unused', (await look(us)).state === 'covers');
    await a('POST', `/visas/${id}/${made.d.visa.id}/entry`);
    ok('and is spent once it has been used', (await look(us)).state === 'spent');
    await a('POST', `/visas/${id}/${made.d.visa.id}/entry`, { give_back: true });
    ok('an entry can be given back when a trip falls through',
      (await look(us)).state === 'covers');
    ok('the long American lead time is the appointment, and says so',
      /interview appointment/i.test((await look(us)).processing?.note || ''));

    head('Multiple entry is not counted at all:');
    const ae = await trip('Dubai', 'United Arab Emirates', '2027-04-01', '2027-04-05');
    const multi = await a('POST', `/visas/${id}`, {
      country: 'United Arab Emirates', kind: 'multi', validFrom: '2026-01-01', validTo: '2030-01-01',
    });
    await a('POST', `/visas/${id}/${multi.d.visa.id}/entry`);
    await a('POST', `/visas/${id}/${multi.d.visa.id}/entry`);
    ok('so using it twice changes nothing', (await look(ae)).state === 'covers');

    head('Refusals:');
    ok('an invented kind is refused',
      (await a('POST', `/visas/${id}`, { country: 'Mars', kind: 'teleport' })).s === 400);
    ok('and one that expires before it starts',
      (await a('POST', `/visas/${id}`,
        { country: 'Chad', kind: 'single', validFrom: '2027-05-01', validTo: '2027-01-01' })).s === 400);

    head('Somebody else\'s visas:');
    const other = client();
    await other('POST', '/auth/signup',
      { name: 'Chidi Eze', email: `chidi${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await other('PATCH', '/profile', { slug: `h${ID}-2` });
    await other('POST', '/profile/onboarding-step', { step: 'done' });
    ok('are not readable', [403, 404].includes((await other('GET', `/visas/${id}`)).s));

    head('On screen:');
    b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const errs = [];
    const p = await (await b.newContext()).newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}/login`);
    await p.fill('#email', `ada${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Log in")');
    await p.waitForURL('**/today', { timeout: 20000 });
    await p.goto(`${BASE}/trips`);
    await p.click('.trip-row:has-text("Tokyo")');
    await p.waitForSelector('.visa-state', { timeout: 15000 });
    const shown = await p.locator('.visa-panel').innerText();
    ok('the mid-trip expiry is stated as what will happen',
      /way out and not on the way back/i.test(shown), shown.slice(0, 200));
    ok('rather than as a status code', !/expires_during|state:/i.test(shown));

    await p.click('.link-button:has-text("All trips")');
    await p.waitForSelector('.trip-row', { timeout: 15000 });
    await p.click('.trip-row:has-text("Accra")');
    await p.waitForSelector('.visa-state', { timeout: 15000 });
    ok('a not-yet-valid visa reads differently from an expired one',
      /does not start until/i.test(await p.locator('.visa-panel').innerText()));

    // The requirement lookup now stands beside the coverage answer as a named
    // control rather than in a list at the foot of the page.
    const rules = p.locator('.btn.is-soon:has-text("Check requirement")');
    ok('the rules lookup is present as a named control', (await rules.count()) === 1);
    await rules.click();
    await p.waitForSelector('.soon-why', { timeout: 10000 });
    ok('and says plainly that it is not available yet',
      /not available yet/i.test(await p.locator('.soon-why').innerText()),
      await p.locator('.soon-why').innerText());

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (b) await b.close();
    proc.kill();
  }
  console.log(fails === 0
    ? '\nWhat you hold is checked; what you need is not guessed at.'
    : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
