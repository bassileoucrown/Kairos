// A journey that is nobody's business but the principal's.
//
// WHY THIS FILE IS ALL NEGATIVES. Every other suite here proves something
// appears. This one mostly proves things do NOT, which is harder to trust:
// an assertion that a private trip is absent passes just as happily when the
// feature is broken and the trip was never created, or when the request
// errored, or when the test looked in the wrong place. So every hiding
// assertion is paired with a positive control — the SAME viewer seeing the
// SAME kind of thing when it is not private — and the suite fails if the
// control ever stops showing.
//
// THE RULE, from the principal: a personal trip is offline to the office
// entirely. Not blurred, not "somewhere abroad" — absent. Except that the
// principal may name who knows, and except that whoever arranged it can still
// open the thing they built.
//
// AND ONE BIT CROSSES ANYWAY, deliberately: the day is unavailable. A trip
// nobody can see is a trip the office books straight over, which is a worse
// failure than the office knowing a Tuesday is spoken for.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4613, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
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

const dayKey = (offset) => {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
};

(async () => {
  const fs = require('fs');
  const { spawn } = require('child_process');
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
    const deadline = Date.now() + 60000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    // ---- The office ---------------------------------------------------------
    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('PATCH', '/profile', { timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    // The PA, who arranges the work travel.
    const pa = client();
    const paUp = await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    const paId = paUp.d.user.id;
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    let inv = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    // The Chief of Staff, who can otherwise see the whole office.
    const cos = client();
    const cosUp = await cos('POST', '/auth/signup',
      { name: 'Tunde Bakare', email: `tunde${ID}@x.com`, password: PW, accountCategory: 'pa' });
    const cosId = cosUp.d.user.id;
    await cos('POST', '/profile/onboarding-step', { step: 'done' });
    inv = await boss('POST', '/members', { email: `tunde${ID}@x.com`, role: 'chief_of_staff' });
    await cos('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    // ---- Two journeys -------------------------------------------------------
    head('A principal has a work trip and a private one:');
    const work = await pa('POST', `/trips/${bossId}`, {
      name: 'Board week, London', destination: 'London', destinationTimezone: 'Europe/London',
      startsOn: dayKey(10), endsOn: dayKey(14), status: 'confirmed',
    });
    const workId = work.d.trip?.id;
    ok('the assistant arranges the work trip', work.s === 201, `${work.s} ${JSON.stringify(work.d).slice(0, 120)}`);

    const priv = await boss('POST', `/trips/${bossId}`, {
      name: 'Sallah with the family', destination: 'Kaduna', destinationTimezone: 'Africa/Lagos',
      startsOn: dayKey(30), endsOn: dayKey(34), status: 'confirmed', visibility: 'private',
    });
    const privId = priv.d.trip?.id;
    ok('the principal makes their own one private', priv.d.trip?.visibility === 'private',
      JSON.stringify(priv.d).slice(0, 140));

    // ---- What the office sees ----------------------------------------------
    head('The office sees the work and not the rest:');
    let r = await pa('GET', `/trips/${bossId}`);
    const paSees = (r.d.trips || []).map((t) => t.id);
    // POSITIVE CONTROL FIRST. If this ever stops being true the hiding
    // assertion below means nothing, because an empty list hides everything.
    ok('the assistant still sees the work trip', paSees.includes(workId), JSON.stringify(paSees));
    ok('and not the private one', !paSees.includes(privId), JSON.stringify(paSees));

    r = await cos('GET', `/trips/${bossId}`);
    const cosSees = (r.d.trips || []).map((t) => t.id);
    ok('the Chief of Staff still sees the work trip', cosSees.includes(workId), JSON.stringify(cosSees));
    // The one exception to "the Chief of Staff sees the whole office", and it
    // is deliberate: seeing the office is about work.
    ok('and the whole office does not include a family holiday',
      !cosSees.includes(privId), JSON.stringify(cosSees));

    // Not merely filtered from a list — unreachable by its own address, and
    // refused the same way a trip that does not exist is refused.
    ok('opening it directly is a plain not-found',
      (await pa('GET', `/trips/${bossId}/${privId}`)).s === 404);
    ok('while the work trip opens', (await pa('GET', `/trips/${bossId}/${workId}`)).s === 200);
    ok('and the principal can open their own',
      (await boss('GET', `/trips/${bossId}/${privId}`)).s === 200);

    // ---- The legs, which are as private as the journey ----------------------
    head('And the legs of it are just as absent:');
    const leg = await boss('POST', `/itinerary/${bossId}/items`, {
      title: 'Drive up to Kaduna', kind: 'car', tripId: privId,
      startAt: new Date(Date.parse(`${dayKey(30)}T09:00:00Z`)).toISOString(),
      status: 'confirmed',
    });
    ok('a leg is added to the private trip', leg.s === 201, `${leg.s} ${JSON.stringify(leg.d).slice(0, 120)}`);
    const openLeg = await boss('POST', `/itinerary/${bossId}/items`, {
      title: 'Board dinner', kind: 'meal', tripId: workId,
      startAt: new Date(Date.parse(`${dayKey(10)}T18:00:00Z`)).toISOString(),
      status: 'confirmed',
    });
    ok('and one to the work trip', openLeg.s === 201);

    const paDay = await pa('GET', `/itinerary/${bossId}/day?date=${dayKey(30)}`);
    const paWork = await pa('GET', `/itinerary/${bossId}/day?date=${dayKey(10)}`);
    ok('the assistant sees the work leg on its day',
      JSON.stringify(paWork.d).includes('Board dinner'), JSON.stringify(paWork.d).slice(0, 160));
    ok('and nothing at all on the private day',
      !JSON.stringify(paDay.d).includes('Kaduna'), JSON.stringify(paDay.d).slice(0, 200));

    // ---- The clock, which is evidence --------------------------------------
    head('Nor can the clock give it away:');
    // A day drawn in the destination's zone says "they are abroad" without
    // ever showing the trip. Asserted against the timezone the day comes back
    // in rather than against any text.
    const paToday = await pa('GET', `/today/${bossId}`);
    ok('the assistant\'s view of the day stays in the home zone',
      !JSON.stringify(paToday.d?.trip || null).includes('Kaduna'),
      JSON.stringify(paToday.d?.trip || null));

    // ---- The one bit that does cross ---------------------------------------
    head('But the day is not offered as free, because it is not:');
    // A booking to move, so the openings endpoint has something to answer about.
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
    });
    const mt = await boss('POST', '/meeting-types',
      { name: 'Board', durationMinutes: 30, locationType: 'video', accessTier: 1 });
    // The handle is generated at signup, so it is asked for rather than assumed.
    const slug = (await boss('GET', '/auth/me')).d.user.slug;
    const slots = await (await fetch(`${BASE}/api/public/${slug}/${mt.d.meetingType.slug}/slots`)).json();
    ok('the booking page offers times', (slots.slots || []).length > 0, JSON.stringify(slots).slice(0, 120));
    await fetch(`${BASE}/api/public/${slug}/${mt.d.meetingType.slug}/book`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone: 'UTC', startAt: slots.slots[0].startAt, name: 'Chidi Eze', email: 'chidi@x.com' }),
    });
    const mine = await boss('GET', '/bookings');
    const bookingId = mine.d.bookings[0].id;

    const openOnPrivate = await pa('GET',
      `/pa/${bossId}/bookings/${bookingId}/openings?date=${dayKey(31)}&minutes=30`);
    const openOnFree = await pa('GET',
      `/pa/${bossId}/bookings/${bookingId}/openings?date=${dayKey(20)}&minutes=30`);
    // POSITIVE CONTROL. An ordinary day must still offer times, or "no times"
    // proves nothing about privacy.
    ok('an ordinary day still offers times',
      (openOnFree.d.openings || []).length > 0, JSON.stringify(openOnFree.d).slice(0, 140));
    ok('a private day offers none', (openOnPrivate.d.openings || []).length === 0,
      JSON.stringify(openOnPrivate.d).slice(0, 140));
    ok('and says only that it is unavailable',
      openOnPrivate.d.unavailable === true
      && JSON.stringify(openOnPrivate.d.busy) === JSON.stringify(
        [{ id: null, kind: 'unavailable', label: 'Unavailable', startAt: null, endAt: null }]),
      JSON.stringify(openOnPrivate.d.busy));
    // THE POINT OF THE WHOLE PARAGRAPH: the word "unavailable" and nothing else.
    ok('naming neither the trip, the place, nor that it is travel',
      !/Kaduna|Sallah|family|car|trip/i.test(JSON.stringify(openOnPrivate.d)),
      JSON.stringify(openOnPrivate.d).slice(0, 200));
    // And the principal's own picker is not crippled by their own privacy.
    ok('while the principal\'s own day is untouched',
      ((await boss('GET', `/bookings/${bookingId}/openings?date=${dayKey(31)}&minutes=30`))
        .d.openings || []).length > 0);

    // ---- Who may decide ----------------------------------------------------
    head('And it is the principal\'s decision, nobody else\'s:');
    ok('an assistant cannot make a trip private',
      (await pa('PATCH', `/trips/${bossId}/${workId}/visibility`, { visibility: 'private' })).s === 403);
    ok('nor can a Chief of Staff',
      (await cos('PATCH', `/trips/${bossId}/${workId}/visibility`, { visibility: 'private' })).s === 403);
    ok('an assistant creating one cannot mark it private either',
      (await pa('POST', `/trips/${bossId}`, {
        name: 'Sneaky', startsOn: dayKey(50), endsOn: dayKey(51), visibility: 'private',
      })).d.trip?.visibility === 'office');
    ok('the principal can', (await boss('PATCH', `/trips/${bossId}/${workId}/visibility`,
      { visibility: 'private' })).d.trip?.visibility === 'private');
    // Put it back, so the rest of the file reasons about the trip it named.
    await boss('PATCH', `/trips/${bossId}/${workId}/visibility`, { visibility: 'office' });

    // ---- Whoever arranged it keeps it --------------------------------------
    head('Whoever arranged it can still open what they built:');
    // The principal asks the PA to arrange something personal. The PA made it,
    // so the PA can see it — pretending otherwise means an assistant locked out
    // of their own work.
    const arranged = await pa('POST', `/trips/${bossId}`, {
      name: 'Anniversary, Cape Town', destination: 'Cape Town',
      startsOn: dayKey(60), endsOn: dayKey(64), status: 'confirmed',
    });
    const arrangedId = arranged.d.trip.id;
    await boss('PATCH', `/trips/${bossId}/${arrangedId}/visibility`, { visibility: 'private' });
    ok('the assistant who arranged it still sees it',
      (await pa('GET', `/trips/${bossId}/${arrangedId}`)).s === 200);
    ok('but the Chief of Staff, who did not, does not',
      (await cos('GET', `/trips/${bossId}/${arrangedId}`)).s === 404);

    // ---- The principal chooses who else -------------------------------------
    head('The principal can let somebody in, and take it back:');
    ok('somebody outside the office cannot be told',
      (await boss('POST', `/trips/${bossId}/${privId}/shares`, { userId: 'nobody' })).s === 400);
    ok('an assistant cannot hand it round',
      (await pa('POST', `/trips/${bossId}/${privId}/shares`, { userId: cosId })).s === 403);

    ok('the principal names somebody',
      (await boss('POST', `/trips/${bossId}/${privId}/shares`, { userId: cosId })).s === 201);
    ok('and now they can see it', (await cos('GET', `/trips/${bossId}/${privId}`)).s === 200);
    ok('and it is in their list',
      (await cos('GET', `/trips/${bossId}`)).d.trips.some((t) => t.id === privId));
    // Being told does not put the day back on the market for them, it opens
    // the day: they can see what is there and judge, like any other trip.
    ok('their picker stops saying unavailable for that day',
      (await cos('GET', `/pa/${bossId}/bookings/${bookingId}/openings?date=${dayKey(31)}&minutes=30`))
        .d.unavailable !== true);
    // But only for them.
    ok('while it still says so for everybody else',
      (await pa('GET', `/pa/${bossId}/bookings/${bookingId}/openings?date=${dayKey(31)}&minutes=30`))
        .d.unavailable === true);

    ok('and the principal can take it back',
      (await boss('DELETE', `/trips/${bossId}/${privId}/shares/${cosId}`)).s === 204);
    ok('after which it is gone again',
      (await cos('GET', `/trips/${bossId}/${privId}`)).s === 404);
    void paId;

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA personal journey is the principal\'s alone, and the day still cannot be booked over.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
