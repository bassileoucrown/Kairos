// Who decides how a meeting happens.
//
// It used to be the principal, once, when they made the meeting type. Now the
// person asking for the meeting chooses, and the office agrees — or suggests
// something else and the booker answers.
//
// The property that matters most is the one that is easy to lose: taking the
// principal's usual format must change nothing at all. If choosing "the same as
// always" started sending Tier 1 bookings to an approval queue, the feature
// would have quietly broken the thing it was built on top of.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4605);
const BASE = `http://127.0.0.1:${PORT}/api`;
const ID = Date.now().toString(36);
const PW = 'password123';

let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function sess() {
  let c = '';
  return async (m, p, b) => {
    const r = await fetch(BASE + p, {
      method: m,
      headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) },
      body: b ? JSON.stringify(b) : undefined,
    });
    const sc = r.headers.get('set-cookie'); if (sc) c = sc.split(';')[0];
    let d = null; try { d = await r.json(); } catch { /* 204 */ }
    return { s: r.status, d };
  };
}
const anon = sess();

(async () => {
  const proc = spawn('node', ['index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    const deadline = Date.now() + 30000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('the server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    // ---- A principal who takes video calls, open to anyone --------------
    const boss = sess();
    await boss('POST', '/auth/signup', { name: 'Ada Boss', email: `f${ID}@x.com`, password: PW });
    const me = (await boss('GET', '/auth/me')).d.user;
    await boss('PATCH', '/profile', { slug: `ada-${ID}`, timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    // Every day, all day: this suite is about formats, and a slot that is hard
    // to find would only make it flaky.
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
    });
    let r = await boss('POST', '/meeting-types', {
      name: 'Intro', durationMinutes: 30, locationType: 'video', accessTier: 1,
    });
    const openType = r.d.meetingType;

    const slots = async (slug) => (await anon('GET', `/public/${`ada-${ID}`}/${slug}/slots`)).d.slots;
    const book = (slug, body) => anon('POST', `/public/${`ada-${ID}`}/${slug}/book`, body);

    // ---- What the booker is offered -------------------------------------
    head('What the booking page offers:');
    r = await anon('GET', `/public/ada-${ID}`);
    const offered = r.d.meetingTypes[0].formats;
    ok('every format is offered, not just the principal\'s', offered.length >= 4,
      JSON.stringify(offered.map((f) => f.id)));
    ok('the principal\'s own is marked as the usual one',
      offered.find((f) => f.id === 'video').isUsual === true);
    ok('and there is somewhere to write anything else',
      offered.some((f) => f.id === 'other' && f.needsNote === true));

    // ---- Taking the usual format changes nothing -------------------------
    head('Taking the usual format:');
    let open = await slots(openType.slug);
    r = await book(openType.slug, {
      name: 'Same As Always', email: `same${ID}@x.com`, timezone: 'UTC',
      startAt: open[0].startAt, format: 'video',
    });
    ok('a Tier 1 booking still lands straight on the diary', r.d.booking.status === 'confirmed',
      JSON.stringify(r.d).slice(0, 140));
    ok('and it gets its video room as before', !!r.d.booking.videoRoom);

    r = await anon('GET', `/public/bookings/${r.d.booking.id}`);
    ok('with nothing left to agree', r.d.booking.formatState === 'agreed', r.d.booking.formatState);

    // Saying nothing at all is the same as taking the usual one.
    open = await slots(openType.slug);
    r = await book(openType.slug, {
      name: 'Said Nothing', email: `quiet${ID}@x.com`, timezone: 'UTC', startAt: open[0].startAt,
    });
    ok('choosing nothing is treated as the usual format', r.d.booking.status === 'confirmed');

    // ---- Choosing something else ----------------------------------------
    //
    // The booker's choice is allowed. It was not always: picking anything
    // other than the principal's usual format used to hold the booking until
    // somebody agreed, which made a Tier 1 booking pending because the caller
    // preferred the telephone. The tier decides, and nothing else does.
    head('Choosing something else:');
    open = await slots(openType.slug);
    r = await book(openType.slug, {
      name: 'Wants To Visit', email: `visit${ID}@x.com`, timezone: 'UTC',
      startAt: open[0].startAt, format: 'in_person',
    });
    ok('a different format is allowed, and Tier 1 still lands on the diary',
      r.d.booking.status === 'confirmed', JSON.stringify(r.d.booking).slice(0, 140));
    const visitId = r.d.booking.id;
    ok('and no video room is made for a meeting that is not one',
      !r.d.booking.videoRoom);

    r = await anon('GET', `/public/bookings/${visitId}`);
    ok('the booker is not left waiting on anybody',
      r.d.booking.formatState === 'agreed', r.d.booking.formatState);
    ok('and it is in person, as they asked', r.d.booking.formatLabel === 'In person');

    // The office is told, because it no longer arrives in their queue.
    r = await boss('GET', '/emails');
    const heard = (r.d.emails || []).some((e) => /Wants To Visit/.test(e.subject || ''));
    ok('the office is emailed about a booking that departs from the usual', heard);

    // "Something else" has to say what it is.
    open = await slots(openType.slug);
    r = await book(openType.slug, {
      name: 'Vague', email: `vague${ID}@x.com`, timezone: 'UTC',
      startAt: open[0].startAt, format: 'other',
    });
    ok('"something else" with nothing written is refused', r.s === 400, JSON.stringify(r.d));

    open = await slots(openType.slug);
    r = await book(openType.slug, {
      name: 'Specific', email: `spec${ID}@x.com`, timezone: 'UTC',
      startAt: open[0].startAt, format: 'other', formatNote: 'A walk around the estate',
    });
    ok('with a note it is accepted, and it too goes straight on the diary',
      r.s === 201 && r.d.booking.status === 'confirmed', JSON.stringify(r.d).slice(0, 140));
    const walkId = r.d.booking.id;

    // ---- What the office is shown ----------------------------------------
    head('What the office is shown:');
    r = await boss('GET', `/bookings?scope=upcoming`);
    const listed = (r.d.bookings || []).find((b) => b.id === visitId);
    ok('the booking is in the list', !!listed);
    ok('saying how they are meeting', listed.formatLabel === 'In person', listed.formatLabel);
    ok('and that it departs from the usual', listed.wasUnusual === true);
    ok('with the usual named, so nobody has to remember it',
      listed.usualFormatLabel === 'Video call', listed.usualFormatLabel);
    ok('and the choices to suggest from travel with it',
      Array.isArray(listed.formats) && listed.formats.length > 0);

    const walkListed = (r.d.bookings || []).find((b) => b.id === walkId);
    ok('a written-in choice carries its words',
      walkListed.formatNote === 'A walk around the estate', String(walkListed.formatNote));

    // Nothing is waiting on the office: it never became a request.
    r = await boss('GET', `/pa/${me.id}/approvals`);
    ok('and none of it is sitting in the approval queue',
      !(r.d.bookings || []).some((b) => b.id === visitId || b.id === walkId));

    // ---- The office suggests something else ------------------------------
    head('The office suggesting something else:');
    r = await boss('POST', `/pa/${me.id}/approvals/${walkId}/counter`, { format: 'other' });
    ok('a counter of "something else" needs its own words', r.s === 400, JSON.stringify(r.d));
    r = await boss('POST', `/pa/${me.id}/approvals/${walkId}/counter`,
      { format: 'other', formatNote: 'A walk around the estate' });
    ok('countering with the same thing is refused', r.s === 400, JSON.stringify(r.d));

    r = await boss('POST', `/pa/${me.id}/approvals/${walkId}/counter`,
      { format: 'video', formatNote: 'The grounds are being resurfaced' });
    ok('a real counter is accepted', r.s === 200, JSON.stringify(r.d));

    r = await anon('GET', `/public/bookings/${walkId}`);
    ok('the booker sees the suggestion', r.d.booking.counterFormatLabel === 'Video call',
      String(r.d.booking.counterFormatLabel));
    ok('with the reason given', r.d.booking.counterFormatNote === 'The grounds are being resurfaced');
    ok('their own request is still on record', r.d.booking.formatLabel === 'Something else');
    // Confirmed, not pending — and that is the change. A suggestion is not a
    // withdrawal of the booking: their time stays theirs while they think
    // about how to spend it. On a Tier 3 booking this would read 'pending',
    // for the tier's own reasons rather than the format's.
    ok('and their time is still theirs while they decide',
      r.d.booking.status === 'confirmed', r.d.booking.status);

    // ---- The booker answers ----------------------------------------------
    head('The booker answering:');
    r = await anon('POST', `/public/bookings/${walkId}/accept-format`);
    ok('accepting is allowed', r.s === 200, JSON.stringify(r.d).slice(0, 120));
    ok('the format becomes the one suggested', r.d.booking.formatLabel === 'Video call');
    ok('it is agreed', r.d.booking.formatState === 'agreed');
    ok('the booking is confirmed, since Tier 1 needed nothing else',
      r.d.booking.status === 'confirmed');
    ok('and now it does get a video room', !!r.d.booking.videoRoom);

    r = await anon('POST', `/public/bookings/${walkId}/accept-format`);
    ok('accepting twice is refused — there is nothing left to accept', r.s === 400);

    // ---- Withdrawing instead ---------------------------------------------
    head('Withdrawing instead of accepting:');
    open = await slots(openType.slug);
    r = await book(openType.slug, {
      name: 'Will Withdraw', email: `wd${ID}@x.com`, timezone: 'UTC',
      startAt: open[0].startAt, format: 'phone',
    });
    const wdId = r.d.booking.id;
    await boss('POST', `/pa/${me.id}/approvals/${wdId}/counter`, { format: 'video' });
    r = await anon('POST', `/public/bookings/${wdId}/cancel`);
    ok('the booker can simply withdraw', r.s === 200 && r.d.booking.status === 'cancelled',
      JSON.stringify(r.d.booking?.status));

    // ---- A tier that wanted approval anyway -------------------------------
    head('When the tier wanted approval too:');
    r = await boss('POST', '/meeting-types', {
      name: 'Private', durationMinutes: 30, locationType: 'video', accessTier: 4,
    });
    const closedType = r.d.meetingType;
    open = await slots(closedType.slug);
    r = await book(closedType.slug, {
      name: 'Tier Four', email: `t4${ID}@x.com`, timezone: 'UTC',
      startAt: open[0].startAt, format: 'in_person',
    });
    const t4 = r.d.booking.id;
    await boss('POST', `/pa/${me.id}/approvals/${t4}/counter`, { format: 'phone' });
    r = await anon('POST', `/public/bookings/${t4}/accept-format`);
    ok('accepting the format does not confirm a Tier 4 booking on its own',
      r.d.booking.status === 'pending', r.d.booking.status);
    ok('but the format is settled', r.d.booking.formatState === 'agreed');
    r = await boss('POST', `/pa/${me.id}/approvals/${t4}/approve`);
    ok('the office still has the last word on the time', r.s === 200);
    r = await anon('GET', `/public/bookings/${t4}`);
    ok('and then it is confirmed', r.d.booking.status === 'confirmed');
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nThe booker says how they would like to meet, and the office answers.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})();
