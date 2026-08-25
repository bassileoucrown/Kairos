// Moving an appointment, from the office's side.
//
// The booker could always move their own from the link they were sent. The
// office could only cancel — so an assistant needing to shift a confirmed
// meeting by an hour had to call it off and ask the booker to book again,
// which costs the booker two emails and loses the thread.
//
// Two rules are worth pinning here, because they pull in opposite directions:
// the office is NOT confined to the published bookable hours, and it is still
// not allowed to put two meetings on top of each other.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (t) => console.log(`\n${t}`);

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
    let d = null;
    try { d = text ? JSON.parse(text) : null; } catch { d = text; }
    return { s: r.status, d };
  };
}

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL || '',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const deadline = Date.now() + 20000;
  for (;;) {
    try { const r = await (await fetch(`${BASE}/api/status`)).json(); if (r.databaseReady) break; } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('no server');
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    const boss = client();
    await boss('POST', '/auth/signup', { name: 'Adaeze Okonkwo', email: `boss${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const me = (await boss('GET', '/auth/me')).d.user;
    await boss('PATCH', '/profile', { slug: `adaeze-${ID}`, timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    // Open around the clock so the fixture never depends on the hour it runs.
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
    });
    let r = await boss('POST', '/meeting-types', {
      name: 'Intro', durationMinutes: 30, locationType: 'video', accessTier: 1,
    });
    const mt = r.d.meetingType;

    const anon = client();
    const slots = (await anon('GET', `/public/adaeze-${ID}/${mt.slug}/slots`)).d.slots || [];
    ok('there are slots to book', slots.length > 2, String(slots.length));
    await anon('POST', `/public/adaeze-${ID}/${mt.slug}/book`, {
      timezone: 'UTC', startAt: slots[0].startAt, name: 'Chidi Eze', email: `chidi${ID}@x.com`,
    });
    r = await boss('GET', '/bookings');
    const booking = (r.d.bookings || [])[0];
    ok('and one is booked', !!booking, JSON.stringify(r.d).slice(0, 160));
    const was = booking.startAt;

    // --- The office moves it ----------------------------------------------
    head('The office can move a confirmed appointment:');
    // Deliberately a time no slot grid would offer: 3am, well outside any
    // sensible published hours. Bookable hours say when a STRANGER may take a
    // slot, not when the principal is permitted to meet anyone.
    const odd = '2027-06-15T03:00:00.000Z';
    r = await boss('POST', `/bookings/${booking.id}/reschedule`, { startAt: odd });
    ok('to a time the public slot grid would never offer', r.s === 200, JSON.stringify(r.d));
    ok('and the new time is what sticks', r.d.booking.startAt === odd, r.d.booking.startAt);
    ok('keeping the length it always had',
      new Date(r.d.booking.endAt) - new Date(r.d.booking.startAt) === 30 * 60000,
      String(new Date(r.d.booking.endAt) - new Date(r.d.booking.startAt)));

    head('The booker is told, and the old time survives:');
    r = await boss('GET', '/emails');
    ok('an email goes to whoever booked it',
      (r.d.emails || []).some((e) => /^Moved:/.test(e.subject || '') && /chidi/.test(e.toEmail || '')),
      JSON.stringify((r.d.emails || []).map((e) => e.subject)));
    r = await boss('GET', `/bookings/${booking.id}/trail`);
    const moved = (r.d.trail || []).find((t) => /reschedul/i.test(t.kind || ''));
    ok('the trail records the move', !!moved, JSON.stringify(r.d.trail || []).slice(0, 200));
    // The trail hands back a sentence rather than raw fields, and that
    // sentence carries BOTH times — which is the loss booking_events was built
    // to stop. Asserted on the reading, since the reading is the guarantee.
    const oldHour = new Date(was).getUTCHours() % 12 || 12;
    ok('and the line names where it came from as well as where it went',
      /^Moved from .+ to .+$/.test(moved?.headline || '') && moved.headline.includes(String(oldHour)),
      moved?.headline);

    // --- What it will not do ----------------------------------------------
    head('It will not put two meetings on top of each other:');
    const second = (await anon('GET', `/public/adaeze-${ID}/${mt.slug}/slots`)).d.slots[0];
    await anon('POST', `/public/adaeze-${ID}/${mt.slug}/book`, {
      timezone: 'UTC', startAt: second.startAt, name: 'Ngozi Okafor', email: `ngozi${ID}@x.com`,
    });
    r = await boss('GET', '/bookings');
    const other = (r.d.bookings || []).find((b) => /Ngozi/.test(b.bookerName));
    ok('a second appointment exists', !!other, JSON.stringify(r.d.bookings || []).slice(0, 200));

    r = await boss('POST', `/bookings/${booking.id}/reschedule`, { startAt: other.startAt });
    ok('moving one onto the other is refused', r.s === 409, String(r.s));
    ok('and it says what is in the way, not just "taken"',
      /Ngozi/.test(r.d?.error || ''), r.d?.error);

    // Overlap, not just an exact collision — the half-hour after also clashes.
    const overlapping = new Date(new Date(other.startAt).getTime() + 10 * 60000).toISOString();
    r = await boss('POST', `/bookings/${booking.id}/reschedule`, { startAt: overlapping });
    ok('a partial overlap is refused too', r.s === 409, String(r.s));

    // Its own slot must not block it — a no-op move is not a clash.
    r = await boss('POST', `/bookings/${booking.id}/reschedule`, { startAt: odd });
    ok('but its own current time never blocks it', r.s === 200, JSON.stringify(r.d));

    head('And the obvious refusals:');
    r = await boss('POST', `/bookings/${booking.id}/reschedule`, { startAt: 'not a time' });
    ok('a time that is not a time', r.s === 400, String(r.s));
    r = await boss('POST', `/bookings/${booking.id}/reschedule`, {});
    ok('no time at all', r.s === 400, String(r.s));

    // --- An assistant may move it too --------------------------------------
    head('An assistant can move it as well as the principal:');
    const inv = await boss('POST', '/members', { email: `pa${ID}@x.com`, role: 'chief_of_staff' });
    const pa = client();
    await pa('POST', '/auth/signup', { name: 'Kit Staff', email: `pa${ID}@x.com`, password: PW, accountCategory: 'chief_of_staff' });
    await pa('PATCH', '/profile', { slug: `kit-${ID}` });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    await pa(
      'POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`, {},
    );

    const paTime = '2027-06-16T04:30:00.000Z';
    r = await pa('POST', `/pa/${me.id}/bookings/${booking.id}/reschedule`, { startAt: paTime });
    ok('the assistant may move their principal\'s appointment', r.s === 200, JSON.stringify(r.d).slice(0, 200));
    r = await boss('GET', '/bookings');
    const after = (r.d.bookings || []).find((b) => b.id === booking.id);
    ok('and it lands where they put it', after.startAt === paTime, after.startAt);

    // A stranger must not be able to.
    const outsider = client();
    await outsider('POST', '/auth/signup', { name: 'Someone Else', email: `else${ID}@x.com`, password: PW });
    r = await outsider('POST', `/pa/${me.id}/bookings/${booking.id}/reschedule`, { startAt: '2027-06-17T09:00:00.000Z' });
    ok('somebody with no business here cannot', r.s === 403, String(r.s));
    r = await outsider('POST', `/bookings/${booking.id}/reschedule`, { startAt: '2027-06-17T09:00:00.000Z' });
    ok('not by their own route either', r.s === 404, String(r.s));

    // --- Cancelled is cancelled -------------------------------------------
    head('A cancelled appointment is not moved, it is remade:');
    await boss('POST', `/bookings/${booking.id}/cancel`, {});
    r = await boss('POST', `/bookings/${booking.id}/reschedule`, { startAt: '2027-06-18T09:00:00.000Z' });
    ok('moving it is refused', r.s === 400, String(r.s));
    ok('and says to make a new one', /new one/i.test(r.d?.error || ''), r.d?.error);
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nThe office can move an appointment, and cannot double-book one.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
