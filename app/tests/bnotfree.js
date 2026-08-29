// "I am not available then." An hour, a day, a week, or longer.
//
// WHY THIS IS NOT AN ITINERARY ITEM, which is the whole design and the reason
// this file exists. The diary could already say what the principal was DOING.
// It had no way to say what they were NOT doing, and the two are different
// instructions: the picker deliberately SHOWS a flight at three and still
// offers the hour, because the office can see the flight and decide to book
// against it, and sometimes that is right. This one has no nuance in it — do
// not put anything here — so it subtracts. A block that merely displayed
// itself would be a block that gets booked over, which is no block at all.
//
// ONE SHAPE FOR EVERY LENGTH. A morning, a day, a fortnight, a sabbatical:
// all a start and an end. Asserted at three lengths against the same code
// path, because "blocks an hour" and "blocks a month" being separate features
// is how one of them quietly stops working.
//
// AND IT REACHES THE PUBLIC PAGE. An office that cannot book the time while a
// stranger with the booking link still can is not unavailability, it is a
// note to the office.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4614, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
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

// A fixed hour on a day far enough out that nothing else in the fixture
// reaches it, expressed in UTC because the account is set to UTC.
const at = (dayOffset, hour) => {
  const d = new Date(Date.now() + dayOffset * 86400000);
  return `${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00:00.000Z`;
};
const dayOf = (dayOffset) => new Date(Date.now() + dayOffset * 86400000).toISOString().slice(0, 10);

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

    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('PATCH', '/profile', { timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
    });

    const pa = client();
    await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    const inv = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    // A booking, so the office picker has something to answer about.
    const mt = await boss('POST', '/meeting-types',
      { name: 'Board', durationMinutes: 30, locationType: 'video', accessTier: 1 });
    const slug = (await boss('GET', '/auth/me')).d.user.slug;
    const mtSlug = mt.d.meetingType.slug;
    const firstSlots = await (await fetch(`${BASE}/api/public/${slug}/${mtSlug}/slots`)).json();
    await fetch(`${BASE}/api/public/${slug}/${mtSlug}/book`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone: 'UTC', startAt: firstSlots.slots[0].startAt, name: 'Chidi Eze', email: 'chidi@x.com' }),
    });
    const bookingId = (await boss('GET', '/bookings')).d.bookings[0].id;

    const openings = (who, day) => who('GET',
      `/pa/${bossId}/bookings/${bookingId}/openings?date=${day}&minutes=30`);

    // ---- Every length, one shape -------------------------------------------
    head('Not available — for an hour, a day, or a fortnight:');
    // POSITIVE CONTROLS FIRST, on the very days about to be blocked. Without
    // these, "no times offered" would pass just as well on a day that never
    // had any.
    const beforeHour = await openings(pa, dayOf(3));
    const beforeWeek = await openings(pa, dayOf(20));
    ok('the short day has times to begin with',
      (beforeHour.d.openings || []).length > 0, JSON.stringify(beforeHour.d).slice(0, 120));
    ok('and so does the far one',
      (beforeWeek.d.openings || []).length > 0, JSON.stringify(beforeWeek.d).slice(0, 120));

    const hour = await boss('POST', `/itinerary/${bossId}/unavailable`,
      { startsAt: at(3, 9), endsAt: at(3, 11), reason: 'Funeral' });
    ok('an hour or two can be set aside', hour.s === 201, `${hour.s} ${JSON.stringify(hour.d).slice(0, 140)}`);

    const fortnight = await boss('POST', `/itinerary/${bossId}/unavailable`,
      { startsAt: at(18, 0), endsAt: at(32, 0), reason: 'Away' });
    ok('and a fortnight, by the same route', fortnight.s === 201, String(fortnight.s));

    // ---- What it does to the office picker ----------------------------------
    head('The office is not offered the time:');
    const shortDay = await openings(pa, dayOf(3));
    const inside = (shortDay.d.openings || []).filter((o) => {
      const t = Date.parse(o.startAt);
      return t >= Date.parse(at(3, 9)) && t < Date.parse(at(3, 11));
    });
    ok('nothing is offered inside the blocked hours', inside.length === 0,
      JSON.stringify(inside.slice(0, 3)));
    // THE ASSERTION THAT STOPS THIS BEING A DAY BLOCKER. An hour set aside must
    // take the hour, not the day — a principal who blocks a funeral and loses
    // their whole Thursday will stop using the feature.
    ok('but the rest of that day still is',
      (shortDay.d.openings || []).length > 0, JSON.stringify(shortDay.d).slice(0, 140));
    ok('and the fortnight takes its days',
      ((await openings(pa, dayOf(20))).d.openings || []).length === 0);
    ok('while the day after it comes back',
      ((await openings(pa, dayOf(33))).d.openings || []).length > 0);

    // ---- The public page, which is the one that matters --------------------
    head('And neither is a stranger with the link:');
    const pub = await (await fetch(`${BASE}/api/public/${slug}/${mtSlug}/slots`)).json();
    const strangerInside = (pub.slots || []).filter((s) => {
      const t = Date.parse(s.startAt);
      return (t >= Date.parse(at(3, 9)) && t < Date.parse(at(3, 11)))
        || (t >= Date.parse(at(18, 0)) && t < Date.parse(at(32, 0)));
    });
    ok('the booking page offers nothing in the blocked time',
      strangerInside.length === 0, JSON.stringify(strangerInside.slice(0, 3)));
    // Positive control: the page is still working at all.
    ok('though it is still offering times', (pub.slots || []).length > 0, String((pub.slots || []).length));

    // ---- Why, and who is told ----------------------------------------------
    head('The office is told the time is spoken for, and sometimes why:');
    let list = await pa('GET', `/itinerary/${bossId}/unavailable`);
    let funeral = (list.d.blocks || []).find((b) => b.startsAt === at(3, 9));
    ok('an ordinary block says its reason', funeral?.reason === 'Funeral', JSON.stringify(funeral));

    const quiet = await boss('POST', `/itinerary/${bossId}/unavailable`,
      { startsAt: at(40, 8), endsAt: at(40, 18), reason: 'Oncologist', visibility: 'private' });
    ok('the principal can keep one to themselves', quiet.s === 201, String(quiet.s));

    list = await pa('GET', `/itinerary/${bossId}/unavailable`);
    const hidden = (list.d.blocks || []).find((b) => b.startsAt === at(40, 8));
    ok('the assistant is told the time is gone', !!hidden, JSON.stringify(list.d.blocks));
    ok('and not what it is for', hidden?.reason === '', JSON.stringify(hidden));
    ok('reading only that it is unavailable', hidden?.label === 'Unavailable', hidden?.label);
    // THE ONE THAT WOULD MATTER MOST IF IT BROKE.
    ok('the word does not appear anywhere in the answer',
      !/Oncologist/i.test(JSON.stringify(list.d)), JSON.stringify(list.d).slice(0, 200));
    ok('nor anywhere in the picker for that day',
      !/Oncologist/i.test(JSON.stringify((await openings(pa, dayOf(40))).d)));
    ok('while the principal still sees their own reason',
      (await boss('GET', `/itinerary/${bossId}/unavailable`)).d.blocks
        .find((b) => b.startsAt === at(40, 8))?.reason === 'Oncologist');

    // An assistant cannot hide a hole in the diary that nobody can account for.
    const paQuiet = await pa('POST', `/itinerary/${bossId}/unavailable`,
      { startsAt: at(45, 8), endsAt: at(45, 9), reason: 'Held', visibility: 'private' });
    ok('an assistant cannot make one private',
      paQuiet.d.block?.private === false, JSON.stringify(paQuiet.d));

    // ---- Refusals ----------------------------------------------------------
    head('And it has to be a real stretch of time:');
    ok('backwards is refused',
      (await boss('POST', `/itinerary/${bossId}/unavailable`,
        { startsAt: at(5, 12), endsAt: at(5, 9) })).s === 400);
    ok('so is nothing at all',
      (await boss('POST', `/itinerary/${bossId}/unavailable`, {})).s === 400);
    ok('and a decade is treated as the typo it is',
      (await boss('POST', `/itinerary/${bossId}/unavailable`,
        { startsAt: at(1, 9), endsAt: at(4000, 9) })).s === 400);

    // ---- Lifting it --------------------------------------------------------
    head('And it can be lifted:');
    ok('the assistant cannot lift what they could not read',
      (await pa('DELETE', `/itinerary/${bossId}/unavailable/${quiet.d.block.id}`)).s === 403);
    ok('the principal can',
      (await boss('DELETE', `/itinerary/${bossId}/unavailable/${quiet.d.block.id}`)).s === 204);
    ok('and the day comes back',
      ((await openings(pa, dayOf(40))).d.openings || []).length > 0);
    ok('an ordinary one the assistant set, they can lift',
      (await pa('DELETE', `/itinerary/${bossId}/unavailable/${paQuiet.d.block.id}`)).s === 204);

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nAn hour, a week or a month can be taken off the table, and nobody is offered it.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
