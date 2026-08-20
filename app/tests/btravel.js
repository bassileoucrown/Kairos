// How long the drive actually takes, and saying so honestly when it cannot.
//
// travel_minutes has been on every itinerary item since the day was modelled
// as a chain, and the cascade already reasons from it — but it has always been
// a number somebody typed once and reused forever. In Lagos that number IS the
// schedule: the same drive is twelve minutes on a Sunday morning and eighty at
// six on a Thursday.
//
// The provider is replaced with a stub this suite drives, which is the honest
// boundary — everything on our side of it is tested and nothing pretends to
// test Google's traffic model. What that leaves worth proving: the departure
// time is actually sent, traffic figures are preferred over free-flow ones,
// the answer is cached by quarter hour because every call is billed, a
// provider outage never takes the day sheet down, and nothing is ever applied
// to the itinerary without somebody saying so.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const http = require('http');

const PORT = Number(process.env.PORT || 4547);
const MAPS_PORT = PORT + 5;
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function client(base) {
  let cookie = '';
  return async function call(method, path, body) {
    const r = await fetch(`${base}/api${path}`, {
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
function boot(port, env = {}) {
  return spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ...env },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
async function ready(base) {
  for (;;) {
    try { if ((await (await fetch(`${base}/api/status`)).json()).databaseReady) break; }
    catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }
}

// The maps provider, under this suite's control.
const seen = [];
let reply = null;
const maps = http.createServer((req, res) => {
  seen.push(new URL(req.url, 'http://x'));
  res.writeHead(reply.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(reply.body));
});

const setup = async (c, id) => {
  await c('POST', '/profile/onboarding-step', { step: 'done' });
  const made = await c('POST', `/itinerary/${id}/items`, {
    kind: 'car', title: 'Car to the office',
    startAt: '2027-03-04T06:30:00.000Z',
    location: 'Ikoyi, Lagos', destination: 'Victoria Island, Lagos',
  });
  return made.d.item.id;
};

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }
  await new Promise((r) => maps.listen(MAPS_PORT, r));

  // ---- Nothing configured, which is how it ships --------------------
  const bare = boot(PORT);
  let wired = null;
  try {
    await ready(BASE);
    const a = client(BASE);
    const up = await a('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const adaId = up.d.user.id;
    const itemId = await setup(a, adaId);

    head('With no maps key set:');
    const none = await a('POST', `/itinerary/${adaId}/items/${itemId}/travel-time`);
    ok('the refusal is 501 — our work outstanding, not a typo of theirs',
      none.s === 501, String(none.s));
    ok('naming the variable an operator would set',
      /MAPS_API_KEY/.test(none.d.error || ''), none.d.error);

    const caps = await a('GET', '/capabilities?screen=itinerary');
    ok('and the screen is told, from the same environment the feature reads',
      caps.d.capabilities.some((c) => c.id === 'travel_time' && c.available === false));

    // ---- Configured, pointed at the stub -----------------------------
    head('With a key, at half past six on a Thursday:');
    wired = boot(PORT + 1, {
      MAPS_API_KEY: 'test-key',
      MAPS_BASE_URL: `http://127.0.0.1:${MAPS_PORT}/dm`,
    });
    const W = `http://127.0.0.1:${PORT + 1}`;
    await ready(W);
    const w = client(W);
    await w('POST', '/auth/login', { email: `ada${ID}@x.com`, password: PW });

    reply = { status: 200 };
    reply.body = { rows: [{ elements: [{
      status: 'OK',
      duration: { value: 1200 },
      duration_in_traffic: { value: 4800 },
      distance: { value: 9400 },
    }] }] };

    const est = await w('POST', `/itinerary/${adaId}/items/${itemId}/travel-time`);
    ok('an estimate comes back', est.s === 200, JSON.stringify(est.d).slice(0, 120));
    ok('taking the traffic figure, not the free-flow one',
      est.d.minutes === 80, String(est.d.minutes));
    ok('and saying which it was, because they are not the same claim',
      est.d.traffic === true);
    ok('with the distance', est.d.distanceKm === 9.4, String(est.d.distanceKm));

    const q = seen[0].searchParams;
    ok('the leg\'s own ends were sent', q.get('origins') === 'Ikoyi, Lagos'
      && q.get('destinations') === 'Victoria Island, Lagos');
    ok('and the DEPARTURE TIME, which is the entire point',
      q.get('departure_time') === String(Date.parse('2027-03-04T06:30:00.000Z') / 1000),
      q.get('departure_time'));
    ok('asking for traffic explicitly', q.get('traffic_model') === 'best_guess');

    head('Nothing is applied without being asked:');
    ok('the estimate did not touch the itinerary', est.d.applied === false);
    const before = await w('GET', `/itinerary/${adaId}/day?date=2027-03-04`);
    ok('travel minutes are still what they were',
      before.d.entries.find((e) => e.id === itemId).travelMinutes === 0);

    const applied = await w('POST', `/itinerary/${adaId}/items/${itemId}/travel-time`, { apply: true });
    ok('applying it is a separate, deliberate act', applied.d.applied === true);
    ok('and it says what the number used to be, rather than silently replacing it',
      applied.d.previousMinutes === 0);
    const after = await w('GET', `/itinerary/${adaId}/day?date=2027-03-04`);
    ok('the itinerary now carries the real number',
      after.d.entries.find((e) => e.id === itemId).travelMinutes === 80);

    head('Cached by the quarter hour, because every call is billed:');
    const callsBefore = seen.length;
    await w('POST', `/itinerary/${adaId}/items/${itemId}/travel-time`);
    ok('asking again does not ask the provider again', seen.length === callsBefore);
    const again = await w('POST', `/itinerary/${adaId}/items/${itemId}/travel-time`);
    ok('and the answer is the same', again.d.minutes === 80);
    ok('marked as cached, so nobody mistakes it for a fresh lookup', again.d.cached === true);

    head('A road with no route:');
    reply = { status: 200, body: { rows: [{ elements: [{ status: 'ZERO_RESULTS' }] }] } };
    const far = await w('POST', `/itinerary/${adaId}/items/${itemId}/travel-time`,
      { from: 'Lagos', to: 'Honolulu', departAt: '2027-06-01T09:00:00.000Z' });
    ok('is a 400 with something a person can read',
      far.s === 400 && /no route/i.test(far.d.error || ''), JSON.stringify(far.d));

    head('The provider having a bad day:');
    reply = { status: 500, body: { error: 'boom' } };
    const broke = await w('POST', `/itinerary/${adaId}/items/${itemId}/travel-time`,
      { from: 'A', to: 'B', departAt: '2027-06-02T09:00:00.000Z' });
    ok('does not take the day sheet with it', broke.s === 400, String(broke.s));
    ok('and says who failed', /answered 500/.test(broke.d.error || ''), broke.d.error);
    const stillThere = await w('GET', `/itinerary/${adaId}/day?date=2027-03-04`);
    ok('the itinerary still loads, with its number intact',
      stillThere.s === 200
      && stillThere.d.entries.find((e) => e.id === itemId).travelMinutes === 80);

    head('Traffic data the region does not have:');
    reply = { status: 200, body: { rows: [{ elements: [{
      status: 'OK', duration: { value: 900 }, distance: { value: 5000 },
    }] }] } };
    const plain = await w('POST', `/itinerary/${adaId}/items/${itemId}/travel-time`,
      { from: 'C', to: 'D', departAt: '2027-06-03T09:00:00.000Z' });
    ok('falls back to the plain duration rather than failing', plain.d.minutes === 15);
    ok('and says so, so nobody reads it as a traffic figure', plain.d.traffic === false);

    head('A leg with nowhere written on it:');
    // An empty field in the body means "use the leg's own", which is why this
    // is tested with an item that genuinely has neither end filled in rather
    // than by passing a blank string.
    const bare2 = await w('POST', `/itinerary/${adaId}/items`, {
      kind: 'meeting', title: 'Somewhere, sometime',
      startAt: '2027-06-04T09:00:00.000Z',
    });
    const emptyId = bare2.d.item.id;
    const callsSoFar = seen.length;
    const half = await w('POST', `/itinerary/${adaId}/items/${emptyId}/travel-time`);
    ok('is refused rather than guessed at',
      half.s === 400 && /somewhere to go/i.test(half.d.error || ''), JSON.stringify(half.d));
    ok('and nothing was billed to find that out', seen.length === callsSoFar);

    head('Somebody else\'s itinerary:');
    const b = client(W);
    await b('POST', '/auth/signup',
      { name: 'Chidi Eze', email: `chidi${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await b('POST', '/profile/onboarding-step', { step: 'done' });
    ok('cannot be estimated against',
      [403, 404].includes((await b('POST', `/itinerary/${adaId}/items/${itemId}/travel-time`)).s));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (wired) wired.kill();
    bare.kill();
    maps.close();
  }
  console.log(fails === 0
    ? '\nThe road is asked, the answer is offered, and nothing moves on its own.'
    : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
