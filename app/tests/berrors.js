// Faults get written down, an operator can read them, and nobody else can.
//
// Also: a trip can be cancelled without losing what is in it, and deleted
// with what is in it — the two being different is the whole point.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const OPERATOR = `ops${ID}@x.com`;
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

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
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { s: r.status, d: data };
  };
}

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      DATABASE_URL: '',
      // The operator gate is an environment list on purpose — nothing in the
      // database can promote an account onto it.
      ANNOUNCEMENT_AUTHORS: OPERATOR,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const deadline = Date.now() + 20000;
  for (;;) {
    try { const r = await (await fetch(`${BASE}/api/status`)).json(); if (r.databaseReady) break; }
    catch { if (Date.now() > deadline) throw new Error('no server'); await new Promise((r) => setTimeout(r, 200)); }
  }

  try {
    // --- A browser reporting itself -------------------------------------
    console.log('\nThe browser reports a fault:');
    const anon = client();
    const posted = await anon('POST', '/errors', {
      message: 'Cannot read properties of undefined (reading map)',
      stack: 'at Today (index.js:12:3)',
      url: '/today',
    });
    ok('it is accepted without being signed in', posted.s === 204, String(posted.s));

    // --- Who may read them ----------------------------------------------
    console.log('\nWho can read what broke:');
    const nobody = client();
    await nobody('POST', '/auth/signup', { name: 'Ada', email: `a${ID}@x.com`, password: PW });
    const denied = await nobody('GET', '/errors');
    ok('an ordinary account cannot', denied.s === 404, String(denied.s));
    ok('and is not told the screen exists', denied.d?.error === 'No such endpoint.', JSON.stringify(denied.d));

    const ops = client();
    await ops('POST', '/auth/signup', { name: 'Ops', email: OPERATOR, password: PW });
    const seen = await ops('GET', '/errors');
    ok('the operator can', seen.s === 200, String(seen.s));
    const fault = (seen.d?.faults || []).find((f) => /reading map/.test(f.message));
    ok('and the fault is there', !!fault, JSON.stringify(seen.d?.faults || []).slice(0, 200));
    ok('with the route it happened on', fault?.route === '/today', fault?.route);
    ok('marked as coming from a browser', fault?.kind === 'client', fault?.kind);

    // --- The same fault twice is one row on screen -----------------------
    //
    // "Same" means the same shape, not the same string: the ids and counts in
    // a message vary between occurrences of one bug, so they are generalised
    // before fingerprinting. Three reports differing only by an id are one
    // fault. A genuinely different message is not.
    console.log('\nThe same fault, many times:');
    for (const who of ['7f3a2b19', '91cc4de2', '0a1b2c3d']) {
      await anon('POST', '/errors', {
        message: `Contact ${who} not found`,
        stack: 'at Contacts (index.js:44:9)',
        url: '/pa/x',
      });
    }
    await anon('POST', '/errors', {
      message: 'Something else entirely', stack: 'at Other (index.js:9:1)', url: '/pa/x',
    });

    const grouped = await ops('GET', '/errors');
    const one = (grouped.d.faults || []).find((f) => /not found/.test(f.message));
    ok('three reports differing only by an id are one fault',
      one?.occurrences === 3, String(one?.occurrences));
    ok('and a different message is a different one',
      (grouped.d.faults || []).some((f) => /Something else/.test(f.message)
        && f.fingerprint !== one.fingerprint));

    const detail = await ops('GET', `/errors/${one.fingerprint}`);
    ok('and the occurrences can be opened', detail.s === 200 && detail.d.occurrences.length > 1,
      String(detail.d?.occurrences?.length));

    // --- Nothing sensitive is kept --------------------------------------
    console.log('\nWhat is deliberately not kept:');
    await anon('POST', '/errors?token=SECRETCAPABILITY', {
      message: 'boom', stack: 'x', url: '/book/manage/abc?token=SECRETCAPABILITY',
    });
    const after = await ops('GET', '/errors');
    const leaked = JSON.stringify(after.d.faults).includes('SECRETCAPABILITY');
    ok('a query string is dropped from what is stored', !leaked);

    // --- Clearing --------------------------------------------------------
    const cleared = await ops('DELETE', `/errors/${one.fingerprint}`);
    ok('an operator can clear a fault they have fixed', cleared.s === 204, String(cleared.s));
    const gone = await ops('GET', '/errors');
    ok('and it goes', !(gone.d.faults || []).some((f) => f.fingerprint === one.fingerprint));

    // --- Trips: cancel keeps, delete removes -----------------------------
    console.log('\nA trip can be called off, or removed:');
    const boss = client();
    await boss('POST', '/auth/signup', { name: 'Boss', email: `b${ID}@x.com`, password: PW });
    const me = (await boss('GET', '/auth/me')).d.user;
    await boss('PATCH', '/profile', { slug: `b${ID}`, timezone: 'Africa/Lagos' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const day = (n) => {
      const d = new Date(); d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const mk = async (name) => {
      const r = await boss('POST', `/trips/${me.id}`, {
        name, destination: 'London', startsOn: day(7), endsOn: day(10),
      });
      return r.d.trip.id;
    };

    const keep = await mk('London, board week');
    await boss('POST', `/itinerary/${me.id}/items`, {
      title: 'BA075 to London', kind: 'flight', tripId: keep,
      startAt: new Date(Date.now() + 7 * 864e5).toISOString(), status: 'confirmed',
    });

    const cancelled = await boss('POST', `/trips/${me.id}/${keep}/cancel`);
    ok('cancelling marks it cancelled', cancelled.d?.trip?.status === 'cancelled', JSON.stringify(cancelled.d).slice(0, 120));
    const stillThere = await boss('GET', `/trips/${me.id}/${keep}`);
    ok('and keeps what is in it, because somebody still has to ring the airline',
      stillThere.d.items.length === 1, String(stillThere.d.items.length));
    const twice = await boss('POST', `/trips/${me.id}/${keep}/cancel`);
    ok('cancelling twice is refused rather than pretended', twice.s === 409, String(twice.s));

    // Delete takes the legs with it.
    const scrap = await mk('Duplicate, made by mistake');
    await boss('POST', `/itinerary/${me.id}/items`, {
      title: 'Car to the airport', kind: 'car', tripId: scrap,
      startAt: new Date(Date.now() + 7 * 864e5).toISOString(), status: 'confirmed',
    });
    const warned = await boss('GET', `/trips/${me.id}/${scrap}/deletion`);
    ok('deleting says what it would take with it first', warned.d.items === 1, JSON.stringify(warned.d));

    const del = await boss('DELETE', `/trips/${me.id}/${scrap}`);
    ok('the trip is deleted', del.s === 200 && del.d.deleted === true, String(del.s));
    ok('with the things that were built as part of it', del.d.itemsRemoved === 1, String(del.d.itemsRemoved));
    const missing = await boss('GET', `/trips/${me.id}/${scrap}`);
    ok('and it is gone', missing.s === 404, String(missing.s));

    // The cancelled trip's flight was never touched.
    const survivor = await boss('GET', `/trips/${me.id}/${keep}`);
    ok('the other trip is untouched by all of that', survivor.d.items.length === 1);

    // --- A confirmed trip is the principal's to delete -------------------
    console.log('\nA confirmed trip moves their clock, so it is theirs:');
    const inv = await boss('POST', '/members', { email: `pa${ID}@x.com`, role: 'chief_of_staff' });
    const pa = client();
    await pa('POST', '/auth/signup', { name: 'Kit', email: `pa${ID}@x.com`, password: PW, accountCategory: 'chief_of_staff' });
    await pa('PATCH', '/profile', { slug: `pa${ID}` });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`, {});

    const locked = await mk('Confirmed already');
    await boss('PATCH', `/trips/${me.id}/${locked}`, { status: 'confirmed' });
    const refused = await pa('DELETE', `/trips/${me.id}/${locked}`);
    ok('an assistant is refused', refused.s === 403, String(refused.s));
    ok('and told to cancel it or ask', /Cancel it instead/.test(refused.d?.error || ''), refused.d?.error);
    const check = await pa('GET', `/trips/${me.id}/${locked}/deletion`);
    ok('the screen knows in advance not to offer it', check.d.needsPrincipal === true, JSON.stringify(check.d));
    const allowed = await boss('DELETE', `/trips/${me.id}/${locked}`);
    ok('the principal is not', allowed.s === 200, String(allowed.s));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nFaults are recorded and readable, and a trip can be called off or removed.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
