// A journey filed under the trip it belongs to.
//
// The column has existed since movements were built and nothing ever filled it
// or read it, so a trip to Abuja and the car to the airport for it were two
// records that did not know about each other. This wires it, and the whole
// risk of wiring it is that a trip and a movement are governed by DIFFERENT
// access rules which must not become one rule by accident.
//
//   A MOVEMENT IS NARROWER THAN A TRIP. A movement admits the principal and
//   whoever arranged it. A trip admits the office, or on a private one the
//   principal, its arranger and anybody named. So somebody the principal has
//   shared a trip with must see the trip in full and the cars NOT AT ALL — an
//   escort roster is not a travel detail.
//
//   AND A TRIP IS NARROWER THAN A MOVEMENT, the other way round. A stand-in
//   given one day's sight of a hospital run must not learn from the label on
//   it that there is a family holiday. So the trip's NAME travels only to a
//   reader separately entitled to the trip.
//
//   NOR MAY THE OFFER LEAK ONE. The app volunteering "is this part of the
//   Barbados trip?" is the app saying there is a Barbados trip. Private trips
//   are never proposed — only ever chosen deliberately — and the difference
//   between "not offered" and "not there" is what the pair below proves.
const ROOT = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 4662, BASE = `http://127.0.0.1:${PORT}`;
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
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { s: r.status, d: json };
  };
}

/** A day offset from today, as a local date string. */
function day(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}
/** Noon on that day, as an instant. */
function noon(n) {
  return `${day(n)}T12:00:00.000Z`;
}

async function signUp(call, name, email, category, handle) {
  await call('POST', '/auth/signup', { name, email, password: PW, accountCategory: category });
  await call('PATCH', '/profile', { slug: handle });
  await call('POST', '/profile/onboarding-step', { step: 'done' });
  return (await call('GET', '/auth/me')).d.user;
}

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

  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = client();
    const me = await signUp(boss, 'Adaeze Okonkwo', `boss${ID}@x.com`, 'principal', `boss-${ID}`);

    // An office trip next week, and a private one the week after.
    let r = await boss('POST', `/trips/${me.id}`, {
      name: 'Abuja board', destination: 'Abuja', startsOn: day(7), endsOn: day(10),
    });
    ok('an office trip is created', r.s === 201, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    const office = r.d.trip;

    r = await boss('POST', `/trips/${me.id}`, {
      name: 'Barbados', destination: 'Bridgetown', startsOn: day(20), endsOn: day(27),
    });
    const priv = r.d.trip;
    r = await boss('PATCH', `/trips/${me.id}/${priv.id}/visibility`, { visibility: 'private' });
    ok('and a private one', r.s === 200, `${r.s} ${JSON.stringify(r.d)}`);

    // ---- The offer -------------------------------------------------------
    head('The app offers the trip a journey falls inside, and only an office one:');
    r = await boss('GET', `/movement/${me.id}/trip-options?at=${noon(8)}`);
    ok('a car leaving mid-trip is offered that trip',
      (r.d.covering || []).some((t) => t.id === office.id),
      JSON.stringify((r.d.covering || []).map((t) => t.name)));
    ok('and it is the only thing offered', (r.d.covering || []).length === 1,
      JSON.stringify(r.d.covering));

    // THE PAIR. The private trip's dates fit exactly as well; the only reason
    // it is not offered is the rule. Both halves are asserted so "not offered"
    // cannot be confused with "not there".
    r = await boss('GET', `/movement/${me.id}/trip-options?at=${noon(22)}`);
    ok('a car leaving inside the PRIVATE trip is offered nothing',
      (r.d.covering || []).length === 0, JSON.stringify(r.d.covering));
    ok('though the trip is plainly there to be chosen',
      (r.d.other || []).some((t) => t.id === priv.id && t.private === true),
      JSON.stringify((r.d.other || []).map((t) => [t.name, t.private])));

    r = await boss('GET', `/movement/${me.id}/trip-options?at=${noon(200)}`);
    ok('and a car on an ordinary day is offered nothing at all',
      (r.d.covering || []).length === 0, JSON.stringify(r.d.covering));

    // ---- Filing -----------------------------------------------------------
    head('A journey can be filed under a trip, at either end:');
    r = await boss('POST', `/movement/${me.id}/movements`, {
      title: 'To the airport', departsFrom: 'Ikoyi', destination: 'MMIA',
      departsAt: noon(7), expectedMinutes: 60, tripId: office.id,
    });
    ok('created with a trip on it', r.s === 201, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    const airport = r.d.movement;
    ok('and it names the trip back', airport.trip?.id === office.id, JSON.stringify(airport.trip));
    ok('saying it is not a private one', airport.trip?.private === false);

    r = await boss('POST', `/movement/${me.id}/movements`, {
      title: 'School run', departsFrom: 'Ikoyi', destination: 'School', departsAt: noon(1),
    });
    const school = r.d.movement;
    ok('a journey with no trip is still an ordinary thing', school.trip === null,
      JSON.stringify(school.trip));

    r = await boss('PATCH', `/movement/${me.id}/movements/${school.id}/trip`, { tripId: office.id });
    ok('one can be filed afterwards', r.s === 200 && r.d.movement.trip?.id === office.id,
      `${r.s} ${JSON.stringify(r.d.movement?.trip)}`);
    r = await boss('PATCH', `/movement/${me.id}/movements/${school.id}/trip`, { tripId: null });
    ok('and taken back out', r.s === 200 && r.d.movement.trip === null,
      `${r.s} ${JSON.stringify(r.d.movement?.trip)}`);

    // ---- On the trip ------------------------------------------------------
    head('And the trip shows the cars:');
    r = await boss('GET', `/trips/${me.id}/${office.id}`);
    ok('the trip lists the journey filed under it',
      (r.d.journeys || []).some((j) => j.id === airport.id),
      JSON.stringify((r.d.journeys || []).map((j) => j.title)));
    ok('and only that one', (r.d.journeys || []).length === 1,
      JSON.stringify((r.d.journeys || []).map((j) => j.title)));

    r = await boss('GET', `/trips/${me.id}/${priv.id}`);
    ok('a trip with no cars under it lists none', (r.d.journeys || []).length === 0,
      JSON.stringify(r.d.journeys));

    // ---- Somebody else's trip --------------------------------------------
    head('A journey cannot be filed under a trip that is not available:');
    const other = client();
    const stranger = await signUp(other, 'Ngozi Bello', `ngozi${ID}@x.com`, 'principal', `ngozi-${ID}`);
    r = await other('POST', `/trips/${stranger.id}`, {
      name: 'Someone else\'s', destination: 'Accra', startsOn: day(7), endsOn: day(9),
    });
    const theirs = r.d.trip;
    r = await boss('POST', `/movement/${me.id}/movements`, {
      title: 'Nope', departsAt: noon(8), tripId: theirs.id,
    });
    ok('another account\'s trip is refused', r.s === 400, `${r.s} ${JSON.stringify(r.d)}`);
    // The same sentence a typo gets, so which ids exist cannot be probed.
    ok('in words that do not confirm it exists',
      r.d?.error === 'That trip is not available.', String(r.d?.error));
    r = await boss('POST', `/movement/${me.id}/movements`, {
      title: 'Nope', departsAt: noon(8), tripId: 'no-such-trip',
    });
    ok('and a made-up id gets exactly the same answer',
      r.s === 400 && r.d?.error === 'That trip is not available.', String(r.d?.error));
    ok('the stranger is a real separate account', stranger.id !== me.id);

    // ---- The two rules, pulling opposite ways -----------------------------
    head('Seeing the trip does not give you the cars:');
    // An assistant this principal has appointed, who did NOT arrange the
    // journey. They can see the office trip; the movement is not theirs.
    const pa = client();
    await signUp(pa, 'Tunde Bakare', `pa${ID}@x.com`, 'pa', `pa-${ID}`);
    r = await boss('POST', '/members', { email: `pa${ID}@x.com`, role: 'pa' });
    ok('an assistant is invited', r.s === 201, `${r.s} ${JSON.stringify(r.d).slice(0, 160)}`);
    const token = String(r.d.inviteLink).split('/').pop();
    r = await pa('POST', `/invites/${token}/accept`);
    ok('and accepts', r.s === 200 || r.s === 201, `${r.s} ${JSON.stringify(r.d).slice(0, 160)}`);

    r = await pa('GET', `/trips/${me.id}/${office.id}`);
    ok('they can open the office trip', r.s === 200, `${r.s} ${JSON.stringify(r.d).slice(0, 100)}`);
    // THE ASSERTION THIS SECTION EXISTS FOR. They see the whole trip and none
    // of the cars, because a movement is not a travel detail.
    ok('and see no cars on it, having arranged none',
      (r.d.journeys || []).length === 0, JSON.stringify(r.d.journeys));
    ok('while the principal, on the same trip, sees the car',
      ((await boss('GET', `/trips/${me.id}/${office.id}`)).d.journeys || []).length === 1);

    head('And a stand-in on one journey learns nothing about the trip:');
    r = await boss('POST', `/movement/${me.id}/movements/${airport.id}/grants`,
      { userId: (await pa('GET', '/auth/me')).d.user.id, reason: 'covering' });
    ok('a one-day grant is made', r.s === 201 || r.s === 200, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    r = await pa('GET', `/movement/${me.id}/movements/${airport.id}`);
    ok('the stand-in can now see the journey', r.s === 200 && !!r.d.movement,
      `${r.s} ${JSON.stringify(r.d).slice(0, 100)}`);
    ok('but as the partial view it is', r.d.movement.access === 'coordination',
      String(r.d.movement.access));
    // Not even the id: a partial view gets no trip at all, for the same reason
    // it gets no notes.
    ok('and it carries no trip whatsoever',
      r.d.movement.trip === undefined && r.d.movement.tripId === undefined,
      JSON.stringify({ trip: r.d.movement.trip, tripId: r.d.movement.tripId }));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA journey knows its trip, and neither rule leaks into the other.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
