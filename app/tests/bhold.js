// Running late, stopped on command — and the half hour that belongs to whoever
// booked the appointment.
//
// TWO RULES, AND THEY POINT IN OPPOSITE DIRECTIONS ON PURPOSE.
//
// The first is a floor. Running late ON a booked appointment moves it, and
// moving it emails the person who booked it. Inside thirty minutes that email
// arrives while they are in a car on the way to the old time, so the route
// refuses and says to ring them instead. The office's own entries — the car,
// the prep hour, the drive to the airport — have nobody on the other end and
// carry no floor at all: a PA may shunt one at four minutes' notice, which is
// roughly when anybody notices they are late for it.
//
// The second is a brake. Being late for the eleven o'clock is not being late
// for the four o'clock: a principal skips lunch, the driver takes the
// expressway, and the day is back on its feet by the afternoon. So the cascade
// can be stopped at a named entry — that one and everything after it keep their
// own times. A day that shunts the whole evening every time the morning slips
// is the same cry-wolf failure as one that ignores the gaps, arriving from the
// other side: the office stops believing the screen.
//
// WHY THE BRAKE IS A CUT POINT AND NOT A ROW OF TICK BOXES: every shifted time
// in a plan is computed from a cursor walking forward through the day. Hold a
// middle entry while still moving a later one and that later time is derived
// from a position the principal was never in.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4691, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

// A fixed day well in the future, so the cascade arithmetic never depends on
// the hour the suite runs at.
const DAY = '2027-05-18';
const at = (hhmm) => `${DAY}T${hhmm}:00.000Z`;
const hhmm = (iso) => new Date(iso).toISOString().slice(11, 16);

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

    // An assistant, so the office has a direct line for the cascade to report
    // into. Without one there is nowhere for "still keeping the four o'clock"
    // to land, and that sentence is half the point of a hold.
    const pa = client();
    await pa('POST', '/auth/signup',
      { name: 'Tunde Bello', email: `tunde${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    const inv = await boss('POST', '/members', { email: `tunde${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    const add = async (f) => (await boss('POST', `/itinerary/${bossId}/items`, f)).d.item;

    // -----------------------------------------------------------------------
    // The brake
    // -----------------------------------------------------------------------
    //
    // A back-to-back morning and a loose afternoon. Forty-five minutes late on
    // the first pushes the second by thirty and the third by fifteen, and the
    // fourth is far enough away that the gap swallows what is left.
    const a = await add({ kind: 'meeting', title: 'Board call', startAt: at('09:00'), endAt: at('09:45') });
    const b = await add({ kind: 'meeting', title: 'Site visit', startAt: at('10:00'), endAt: at('11:00') });
    const c = await add({ kind: 'meeting', title: 'Bank', startAt: at('11:15'), endAt: at('12:00') });
    const d = await add({ kind: 'meal', title: 'Lunch', startAt: at('12:15'), endAt: at('13:00') });
    ok('the day is built', !!(a && b && c && d));

    const preview = async (body) =>
      (await boss('POST', `/itinerary/${bossId}/items/${a.id}/delay/preview`, body)).d.plan;
    const effectOn = (plan, id) => plan.effects.find((e) => e.id === id);

    head('Without a hold, the whole chain moves:');
    let p = await preview({ minutes: 45 });
    ok('the one after moves by the overlap', effectOn(p, b.id)?.movedBy === 30,
      JSON.stringify(effectOn(p, b.id)));
    ok('and the one after that moves too', effectOn(p, c.id)?.effect === 'shifted',
      JSON.stringify(effectOn(p, c.id)));
    ok('until a gap absorbs it', effectOn(p, d.id)?.effect === 'unchanged',
      JSON.stringify(effectOn(p, d.id)));

    head('Holding one stops the day there:');
    p = await preview({ minutes: 45, hold: c.id });
    ok('the one before the hold still moves', effectOn(p, b.id)?.effect === 'shifted',
      JSON.stringify(effectOn(p, b.id)));
    ok('the held one is reported as held, not shifted',
      effectOn(p, c.id)?.effect === 'held', JSON.stringify(effectOn(p, c.id)));
    ok('and keeps its own time', effectOn(p, c.id)?.newStartAt === effectOn(p, c.id)?.startAt);
    // The number is the decision. Holding is a claim that the time gets made up
    // somewhere, and how much has to be made up is what the claim is about.
    ok('saying how much has to be made up for it', effectOn(p, c.id)?.lateBy === 15,
      String(effectOn(p, c.id)?.lateBy));
    ok('everything after the hold keeps its time too',
      effectOn(p, d.id)?.effect === 'unchanged'
      && /after the hold/i.test(effectOn(p, d.id)?.reason || ''),
      JSON.stringify(effectOn(p, d.id)));
    ok('and the plan says the hold landed', p.holdApplied === true && p.holdRequested === c.id,
      `${p.holdApplied} ${p.holdRequested}`);
    ok('with a count a screen can read', p.counts.held === 1, JSON.stringify(p.counts));

    head('Applying honours it:');
    let r = await boss('POST', `/itinerary/${bossId}/items/${a.id}/delay`,
      { minutes: 45, hold: c.id });
    ok('it goes through', r.s === 200, `${r.s} ${JSON.stringify(r.d).slice(0, 160)}`);

    const day = await boss('GET', `/itinerary/${bossId}/day?date=${DAY}`);
    const find = (t) => day.d.entries.find((e) => e.title === t);
    // THE POSITIVE CONTROL FOR THE THREE ASSERTIONS BELOW. "Nothing moved" is
    // what a hold looks like and also what a broken apply looks like. This one
    // says the apply did real work, so the three that follow are about the hold
    // rather than about an endpoint that quietly did nothing.
    ok('the delayed item really moved', hhmm(find('Board call').startAt) === '09:45',
      hhmm(find('Board call').startAt));
    ok('and so did the one before the hold', hhmm(find('Site visit').startAt) === '10:30',
      hhmm(find('Site visit').startAt));
    ok('the held one did not', hhmm(find('Bank').startAt) === '11:15',
      hhmm(find('Bank').startAt));
    ok('nor did what came after it', hhmm(find('Lunch').startAt) === '12:15',
      hhmm(find('Lunch').startAt));

    head('The office is told what was held, not only what moved:');
    const today = await boss('GET', `/today/${bossId}`);
    const thread = today.d.directLine?.threadId;
    const msgs = thread ? (await boss('GET', `/threads/${thread}/messages`)).d.messages : [];
    ok('the note names the thing being kept',
      msgs.some((m) => /still keeping bank/i.test(m.body)),
      JSON.stringify(msgs.map((m) => m.body)));
    ok('and the time to make up for it',
      msgs.some((m) => /15 min to make up/i.test(m.body)),
      JSON.stringify(msgs.map((m) => m.body)));

    head('A hold that names nothing on the day is refused, not ignored:');
    r = await boss('POST', `/itinerary/${bossId}/items/${b.id}/delay`,
      { minutes: 30, hold: 'not-a-real-id', acceptConflicts: true });
    ok('refused', r.s === 409, `${r.s} ${JSON.stringify(r.d).slice(0, 160)}`);
    ok('in words that say what to do', /look again/i.test(r.d.error || ''), r.d.error);
    const untouched = await boss('GET', `/itinerary/${bossId}/day?date=${DAY}`);
    ok('and nothing moved while it was being refused',
      untouched.d.entries.find((e) => e.title === 'Bank').startAt
      === day.d.entries.find((e) => e.title === 'Bank').startAt);

    // -----------------------------------------------------------------------
    // The floor
    // -----------------------------------------------------------------------
    head('A booker keeps the half hour before their appointment:');
    await boss('PATCH', '/profile', { slug: `ada${ID}` });
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek, startTime: '00:00', endTime: '23:30',
      })),
    });
    const mt = (await boss('POST', '/meeting-types', {
      name: 'Board', durationMinutes: 60, locationType: 'video', accessTier: 1,
    })).d.meetingType;

    // Booked properly, through the public page, so the row is a real booking
    // with a real person on it — and only then pulled forward. Inventing a slot
    // the booking rules would not have offered would make this suite about
    // availability instead of about the floor.
    const bookDay = new Date(Date.now() + 30 * 3600000).toISOString().slice(0, 10);
    const anon = client();
    const slots = (await anon('GET', `/public/ada${ID}/${mt.slug}/slots?date=${bookDay}`)).d.slots || [];
    ok('the day has slots to book', slots.length > 0, String(slots.length));
    const booked = await anon('POST', `/public/ada${ID}/${mt.slug}/book`, {
      timezone: 'UTC', startAt: slots[Math.floor(slots.length / 2)].startAt,
      name: 'Chidi Nwosu', email: `chidi${ID}@ashford.com`,
    });
    const bookingId = booked.d.booking?.id;
    ok('a stranger books an hour', !!bookingId,
      `${booked.s} ${JSON.stringify(booked.d).slice(0, 200)}`);

    // Only the clock hand moves. The row, the booker and the trail are real.
    const pullTo = async (minutesFromNow) => {
      const start = new Date(Date.now() + minutesFromNow * 60000).toISOString();
      const end = new Date(Date.now() + (minutesFromNow + 60) * 60000).toISOString();
      await db.prepare('UPDATE bookings SET start_at = ?, end_at = ? WHERE id = ?')
        .run(start, end, bookingId);
      return start;
    };

    await pullTo(20);
    r = await boss('POST', `/itinerary/${bossId}/bookings/${bookingId}/delay/preview`, { minutes: 15 });
    ok('the preview still shows what the day would do', r.s === 200 && !!r.d.plan, String(r.s));
    ok('but says the appointment is too close to move', !!r.d.tooSoon,
      JSON.stringify(r.d).slice(0, 200));
    ok('naming the person it would reach too late',
      /Chidi Nwosu/.test(r.d.tooSoon?.error || ''), r.d.tooSoon?.error);
    ok('and what the notice actually is, so a screen need not hardcode it',
      r.d.tooSoon?.noticeMinutes === 30, String(r.d.tooSoon?.noticeMinutes));
    ok('with how long is left', r.d.tooSoon?.minutesLeft >= 18 && r.d.tooSoon?.minutesLeft <= 21,
      String(r.d.tooSoon?.minutesLeft));

    const wasAt = (await db.prepare('SELECT start_at FROM bookings WHERE id = ?').get(bookingId)).start_at;
    r = await boss('POST', `/itinerary/${bossId}/bookings/${bookingId}/delay`, { minutes: 15 });
    ok('and applying it is refused', r.s === 400, `${r.s} ${JSON.stringify(r.d).slice(0, 160)}`);
    ok('in the same words', /Chidi Nwosu/.test(r.d.error || ''), r.d.error);
    ok('telling them directly rather than by email',
      /tell them directly/i.test(r.d.error || ''), r.d.error);
    ok('and the appointment did not move',
      (await db.prepare('SELECT start_at FROM bookings WHERE id = ?').get(bookingId)).start_at === wasAt);

    // THE POSITIVE CONTROL. Without this, "refused" would be indistinguishable
    // from a route that refuses everything — and a running-late button that
    // never works is a worse bug than one that works too close to the hour.
    head('And keeps nothing before that:');
    const fromNinety = await pullTo(90);
    r = await boss('POST', `/itinerary/${bossId}/bookings/${bookingId}/delay/preview`, { minutes: 15 });
    ok('an hour and a half out, the preview raises nothing', r.s === 200 && !r.d.tooSoon,
      JSON.stringify(r.d.tooSoon));
    r = await boss('POST', `/itinerary/${bossId}/bookings/${bookingId}/delay`,
      { minutes: 15, acceptConflicts: true });
    ok('and applying goes through', r.s === 200, `${r.s} ${JSON.stringify(r.d).slice(0, 200)}`);
    const movedTo = (await db.prepare('SELECT start_at FROM bookings WHERE id = ?').get(bookingId)).start_at;
    ok('the appointment really moved',
      Math.round((Date.parse(movedTo) - Date.parse(fromNinety)) / 60000) === 15,
      `${fromNinety} → ${movedTo}`);

    // -----------------------------------------------------------------------
    // And the office's own day has no floor at all
    // -----------------------------------------------------------------------
    head("A PA may move the principal's own entry at any point before it starts:");
    const soonStart = new Date(Date.now() + 4 * 60000).toISOString();
    const soon = await add({
      kind: 'meeting', title: 'Desk hour',
      startAt: soonStart,
      endAt: new Date(Date.now() + 64 * 60000).toISOString(),
    });
    ok('an entry four minutes away exists', !!soon, JSON.stringify(soon).slice(0, 120));
    r = await boss('POST', `/itinerary/${bossId}/items/${soon.id}/delay`,
      { minutes: 20, acceptConflicts: true });
    ok('four minutes out, running late still works', r.s === 200,
      `${r.s} ${JSON.stringify(r.d).slice(0, 200)}`);
    const after = await db.prepare('SELECT start_at FROM itinerary_items WHERE id = ?').get(soon.id);
    ok('and it really moved',
      Math.round((Date.parse(after.start_at) - Date.parse(soonStart)) / 60000) === 20,
      `${soonStart} → ${after.start_at}`);

    head('And none of this is a door round the side:');
    const stranger = client();
    await stranger('POST', '/auth/signup',
      { name: 'Emeka Obi', email: `emeka${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await stranger('POST', '/profile/onboarding-step', { step: 'done' });
    ok('a stranger cannot hold anything on this day',
      (await stranger('POST', `/itinerary/${bossId}/items/${a.id}/delay`,
        { minutes: 10, hold: c.id })).s === 403);
    ok('nor learn whether an appointment is too close to move',
      (await stranger('POST', `/itinerary/${bossId}/bookings/${bookingId}/delay/preview`,
        { minutes: 10 })).s === 403);
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? "\nA delay stops where it is told to, and a booker keeps the half hour before their appointment."
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
