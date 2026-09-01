// Running late, over the whole day rather than half of it.
//
// THE BUG THIS FILE IS ABOUT. lib/cascade.js read itinerary_items and nothing
// else, so the delay engine was blind to appointments somebody had booked —
// which are precisely the commitments a principal is least able to be late
// for. An assistant pressing "running 30 minutes late" on the morning was told
// the day absorbed it, while the four o'clock with the chairman sat squarely
// in the gap the cascade had just declared empty. A cascade that cannot see
// half the day is worse than none, because it is believed.
//
// A BOOKING IS AN ANCHOR, deliberately. It is somebody else's time: moving it
// emails them and changes a commitment they made. So the plan reports running
// into one as a conflict, in words that name who would have to be told, and
// stops there — rather than shunting a stranger's meeting quietly. That is
// also what an assistant would say out loud.
//
// AND THE APPOINTMENT ITSELF CAN OVERRUN. Running late ON a booking moves it
// through rescheduleBooking, the same function the appointment's own page
// calls, so the booker is told, the event trail is written and a clash is
// refused. A second path that wrote start_at directly would move the meeting
// and leave the person who booked it outside a building at the old time.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4639, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
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
  const db = require(`${ROOT}/app/server/lib/db`);

  try {
    const deadline = Date.now() + 150000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    await boss('PATCH', '/profile', { slug: `ada${ID}` });
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek, startTime: '00:00', endTime: '23:30',
      })),
    });
    const mt = (await boss('POST', '/meeting-types', {
      name: 'Board', durationMinutes: 60, locationType: 'video', accessTier: 1,
    })).d.meetingType;

    // A day built by hand, at fixed times, so nothing here depends on the hour
    // the suite runs at. Tomorrow, to stay clear of "you cannot book history".
    const day = new Date(Date.now() + 30 * 3600000).toISOString().slice(0, 10);
    // HH:MM in, a full ISO instant out. Passing '09' produced
    // 'T09:00.000Z' — no seconds field, which Date rejects.
    const at = (hhmm) => `${day}T${hhmm}:00.000Z`;

    // THE APPOINTMENT IS BOOKED FIRST, and through the public page, because a
    // slot the office invents is not necessarily a slot the booking rules
    // would offer — and this suite is about the cascade, not about arguing
    // with availability. Everything else is then placed relative to it.
    const anon = client();
    const slots = (await anon('GET', `/public/ada${ID}/${mt.slug}/slots?date=${day}`)).d.slots || [];
    ok('the day has slots to book', slots.length > 0, String(slots.length));
    // Late enough in the day that a seven-hour overrun on the morning reaches
    // it, whatever zone the principal turned out to be in.
    const slot = slots.find((sl) => Date.parse(sl.startAt) - Date.parse(`${day}T00:00:00.000Z`)
      >= 12 * 3600000) || slots[slots.length - 1];
    const booked = await anon('POST', `/public/ada${ID}/${mt.slug}/book`, {
      timezone: 'UTC', startAt: slot.startAt,
      name: 'Chidi Nwosu', email: `chidi${ID}@ashford.com`,
    });
    const bookingId = booked.d.booking?.id;
    ok('a stranger books the afternoon', !!bookingId,
      `${booked.s} ${JSON.stringify(booked.d).slice(0, 200)}`);

    // The thing that will overrun: seven hours before it, an hour long. NOT a
    // booking, so the two halves of the day come from two different tables —
    // which is the whole point of the file.
    const morningStart = new Date(Date.parse(slot.startAt) - 7 * 3600000).toISOString();
    const made = await boss('POST', `/itinerary/${bossId}/items`, {
      kind: 'meeting', title: 'Site visit',
      startAt: morningStart,
      endAt: new Date(Date.parse(morningStart) + 3600000).toISOString(),
    });
    ok('the morning is on the day', made.s === 201,
      `${made.s} ${JSON.stringify(made.d).slice(0, 200)}`);
    const morning = made.d.item.id;

    // ---- The cascade can see it ------------------------------------------------
    head('An overrun that would run into a booked appointment says so:');
    // Seven hours late on a 09:00 lands at 16:00, straight into the meeting.
    let r = await boss('POST', `/itinerary/${bossId}/items/${morning}/delay/preview`,
      { minutes: 420 });
    const hit = (r.d.plan?.effects || []).find((e) => e.id === bookingId);
    ok('the appointment is in the plan at all', !!hit,
      JSON.stringify((r.d.plan?.effects || []).map((e) => e.title)));
    ok('and it is a conflict rather than something quietly shoved',
      hit?.effect === 'conflict', JSON.stringify(hit));
    ok('naming who would have to be told',
      /Chidi Nwosu/.test(hit?.reason || ''), hit?.reason);
    ok('and the count says so, so a screen can colour the button',
      r.d.plan.counts.conflicts >= 1, JSON.stringify(r.d.plan.counts));

    // POSITIVE CONTROL. A delay the day absorbs must NOT report a conflict —
    // otherwise "it saw the booking" would be indistinguishable from a plan
    // that shouts about everything.
    head('While an overrun the day absorbs stays quiet:');
    r = await boss('POST', `/itinerary/${bossId}/items/${morning}/delay/preview`,
      { minutes: 20 });
    ok('twenty minutes changes nothing', r.d.plan.counts.conflicts === 0,
      JSON.stringify(r.d.plan.counts));

    // ---- And nothing was moved by asking ----------------------------------------
    head('And previewing moved nothing:');
    const still = await db.prepare('SELECT start_at FROM bookings WHERE id = ?').get(bookingId);
    ok('the appointment is where it was', still.start_at === slot.startAt, still.start_at);

    // ---- Applying refuses to walk into it silently --------------------------------
    head('Applying it has to be meant:');
    r = await boss('POST', `/itinerary/${bossId}/items/${morning}/delay`, { minutes: 420 });
    ok('a delay that hits a booking is refused until it is acknowledged',
      r.s === 409, `${r.s} ${JSON.stringify(r.d).slice(0, 140)}`);

    // ---- Running late ON the appointment ------------------------------------------
    head('And the appointment itself can be the thing running late:');
    r = await boss('POST', `/itinerary/${bossId}/bookings/${bookingId}/delay/preview`,
      { minutes: 30 });
    ok('it has a plan of its own', r.s === 200 && !!r.d.plan, `${r.s}`);
    ok('which knows somebody has to be told',
      r.d.plan.item.attendee?.email === `chidi${ID}@ashford.com`,
      JSON.stringify(r.d.plan.item.attendee));

    const before = Number((await db.prepare(
      "SELECT COUNT(*) AS n FROM emails WHERE to_email = ?",
    ).get(`chidi${ID}@ashford.com`)).n);

    r = await boss('POST', `/itinerary/${bossId}/bookings/${bookingId}/delay`, { minutes: 30 });
    ok('applying it goes through', r.s === 200, `${r.s} ${JSON.stringify(r.d).slice(0, 160)}`);
    const moved = await db.prepare('SELECT start_at FROM bookings WHERE id = ?').get(bookingId);
    const wanted = new Date(Date.parse(slot.startAt) + 30 * 60000).toISOString();
    ok('the appointment actually moved', moved.start_at === wanted,
      `${moved.start_at} wanted ${wanted}`);

    // THE ASSERTION THAT MAKES THIS SAFE. Moving somebody else's appointment
    // without telling them leaves them outside a building at the old time.
    const after = Number((await db.prepare(
      "SELECT COUNT(*) AS n FROM emails WHERE to_email = ?",
    ).get(`chidi${ID}@ashford.com`)).n);
    ok('and the person who booked it was told', after > before, `${before} → ${after}`);

    // ---- The gate is the same one --------------------------------------------------
    head('And it is not a door round the side:');
    const stranger = client();
    await stranger('POST', '/auth/signup',
      { name: 'Emeka Obi', email: `emeka${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await stranger('POST', '/profile/onboarding-step', { step: 'done' });
    ok('somebody outside the office cannot preview this principal\'s day',
      (await stranger('POST', `/itinerary/${bossId}/bookings/${bookingId}/delay/preview`,
        { minutes: 30 })).s === 403);
    ok('nor apply it',
      (await stranger('POST', `/itinerary/${bossId}/bookings/${bookingId}/delay`,
        { minutes: 30 })).s === 403);
    ok('and an appointment that is not this principal\'s is not found',
      (await boss('POST', `/itinerary/${bossId}/bookings/${'x'.repeat(20)}/delay/preview`,
        { minutes: 30 })).s === 404);

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nRunning late reads the whole day, and moving somebody else\'s meeting tells them.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
