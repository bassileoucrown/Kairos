// What happened with the people who booked you.
//
// The old list held one thing: confirmed meetings, ahead and behind. A
// cancelled meeting and a declined request simply left it, which meant the
// question an assistant is actually asked — "we cancelled on her once, didn't
// we?" — had no screen that could answer it.
//
// Two properties matter most here, and both are the kind that break silently:
//
//   NOBODY IS CANCELLED IN SILENCE. Calling off a confirmed meeting from
//   inside the office used to set a column and send nothing. The person who
//   booked would have arrived. That is invisible from the inside, so it is
//   checked from the Outbox.
//
//   THE HISTORY IS SCOPED TO ONE PRINCIPAL. An assistant with two principals
//   must never see one of them in the other's list, whatever they search for.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4609);
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

    // ---- A principal, open all week ---------------------------------------
    const boss = sess();
    await boss('POST', '/auth/signup', { name: 'Ada Boss', email: `h${ID}@x.com`, password: PW });
    const me = (await boss('GET', '/auth/me')).d.user;
    await boss('PATCH', '/profile', { slug: `ada-${ID}`, timezone: 'Africa/Lagos' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
    });
    let r = await boss('POST', '/meeting-types', {
      name: 'Intro', durationMinutes: 30, locationType: 'video', accessTier: 1,
    });
    const open = r.d.meetingType;
    r = await boss('POST', '/meeting-types', {
      name: 'Private', durationMinutes: 30, locationType: 'video', accessTier: 4,
    });
    const closed = r.d.meetingType;

    const slots = async (slug) => (await anon('GET', `/public/ada-${ID}/${slug}/slots`)).d.slots;
    const book = async (slug, body) => {
      const s = await slots(slug);
      return anon('POST', `/public/ada-${ID}/${slug}/book`, { timezone: 'UTC', startAt: s[0].startAt, ...body });
    };

    // Four bookings, one of each ending.
    const kept = (await book(open.slug, { name: 'Stays Booked', email: `keep${ID}@x.com` })).d.booking;
    const dropped = (await book(open.slug, { name: 'Gets Cancelled', email: `drop${ID}@x.com` })).d.booking;
    const refused = (await book(closed.slug, { name: 'Gets Declined', email: `no${ID}@x.com` })).d.booking;
    const visiting = (await book(open.slug, {
      name: 'Wanted To Visit', email: `visit${ID}@x.com`, format: 'in_person',
    })).d.booking;

    // ---- Before anything has ended -----------------------------------------
    head('The list as it stands:');
    r = await boss('GET', '/bookings?scope=upcoming');
    ok('the confirmed ones are ahead of you', r.d.bookings.length === 2,
      String(r.d.bookings.length));
    ok('and each says how it is to happen',
      r.d.bookings.every((b) => !!b.formatLabel), JSON.stringify(r.d.bookings.map((b) => b.formatLabel)));

    r = await boss('GET', '/bookings?scope=pending');
    ok('the two that are still questions are pending', r.d.bookings.length === 2,
      String(r.d.bookings.length));
    const asked = r.d.bookings.find((b) => b.id === visiting.id);
    ok('and one is on record as having asked for something unusual', asked.wasUnusual === true);
    ok('saying what, against what the usual was',
      asked.formatLabel === 'In person' && asked.usualFormatLabel === 'Video call',
      `${asked.formatLabel} / ${asked.usualFormatLabel}`);

    r = await boss('GET', '/bookings?scope=cancelled');
    ok('nothing has ended yet', r.d.bookings.length === 0, String(r.d.bookings.length));

    // ---- Endings ------------------------------------------------------------
    head('Once things end:');
    await boss('POST', `/pa/${me.id}/approvals/${refused.id}/decline`);
    r = await boss('POST', `/bookings/${dropped.id}/cancel`);
    ok('the office can call off a confirmed meeting', r.s === 204, String(r.s));

    r = await boss('GET', '/bookings?scope=cancelled');
    ok('both endings are in one list', r.d.bookings.length === 2, String(r.d.bookings.length));
    const byId = Object.fromEntries(r.d.bookings.map((b) => [b.id, b]));
    ok('the cancelled one says cancelled', byId[dropped.id]?.status === 'cancelled');
    ok('the declined one says declined', byId[refused.id]?.status === 'declined');
    ok('and neither is still counted as upcoming',
      (await boss('GET', '/bookings?scope=upcoming')).d.bookings.length === 1);

    // The property somebody only discovers by standing in a lobby.
    head('Nobody is cancelled in silence:')
    r = await boss('GET', '/emails');
    const told = r.d.emails.filter((e) => e.relatedBookingId === dropped.id
      && /cancel/i.test(e.subject));
    ok('the person who booked is written to', told.length === 1,
      JSON.stringify(r.d.emails.filter((e) => e.relatedBookingId === dropped.id).map((e) => e.subject)));
    ok('at their own address, not the office\'s',
      told[0]?.toEmail === `drop${ID}@x.com`, String(told[0]?.toEmail));

    // ---- Searching -----------------------------------------------------------
    head('Finding one person again:');
    r = await boss('GET', '/bookings?scope=cancelled&q=GETS%20CANCELLED');
    ok('a name matches whatever case it is typed in', r.d.bookings.length === 1
      && r.d.bookings[0].id === dropped.id, JSON.stringify(r.d.bookings.map((b) => b.bookerName)));
    r = await boss('GET', `/bookings?scope=upcoming&q=keep${ID}`);
    ok('an address matches too', r.d.bookings.length === 1 && r.d.bookings[0].id === kept.id);
    r = await boss('GET', '/bookings?scope=upcoming&q=intro');
    ok('and so does the name of the meeting type', r.d.bookings.length === 1);
    r = await boss('GET', '/bookings?scope=upcoming&q=%25');
    ok('a wildcard is searched for, not obeyed', r.d.bookings.length === 0,
      String(r.d.bookings.length));

    // ---- What was said --------------------------------------------------------
    head('What was sent about one booking:');
    r = await boss('GET', `/bookings/${dropped.id}/trail`);
    ok('the correspondence is there', r.d.trail.length >= 2, String(r.d.trail.length));
    ok('oldest first, so it reads as a story',
      new Date(r.d.trail[0].at) <= new Date(r.d.trail[r.d.trail.length - 1].at));
    ok('the cancellation is attributed to the person who sent it',
      r.d.trail.some((t) => /cancel/i.test(t.subject) && t.by === 'Ada Boss' && t.byPerson === true),
      JSON.stringify(r.d.trail.map((t) => [t.subject, t.by])));
    ok('and the booking that was made by itself is not attributed to anybody',
      r.d.trail.some((t) => t.byPerson === false));

    // The reason only subjects come across.
    ok('no letter body is handed over', !JSON.stringify(r.d.trail).includes('/book/manage/'),
      JSON.stringify(r.d.trail).slice(0, 160));

    // ---- The assistant sees the same thing --------------------------------------
    head('Through an assistant:');
    const pa = sess();
    await pa('POST', '/auth/signup', { name: 'Chidi PA', email: `pa${ID}@x.com`, password: PW });
    await pa('PATCH', '/profile', { slug: `chidi-${ID}`, timezone: 'Africa/Lagos' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    r = await boss('POST', '/members', { email: `pa${ID}@x.com`, role: 'pa' });
    ok('the principal can invite them', r.s === 201, JSON.stringify(r.d).slice(0, 120));
    const token = r.d.inviteLink.split('/').pop();
    r = await pa('POST', `/invites/${token}/accept`);
    ok('and they can accept', r.s === 200, JSON.stringify(r.d).slice(0, 120));

    r = await pa('GET', `/pa/${me.id}/bookings?scope=cancelled`);
    ok('the assistant sees the same two endings', r.d.bookings.length === 2,
      String(r.d.bookings?.length));
    r = await pa('GET', `/pa/${me.id}/bookings`);
    ok('and with no scope asked for, gets the upcoming ones the briefs screen wants',
      r.d.bookings.length === 1 && r.d.bookings[0].id === kept.id,
      JSON.stringify(r.d.bookings.map((b) => b.status)));
    ok('with the brief flag that screen reads', r.d.bookings[0].hasBrief === false);

    r = await pa('GET', `/pa/${me.id}/bookings/${dropped.id}/trail`);
    ok('the trail is theirs to read too', r.d.trail.length >= 2);

    // ---- One principal at a time -------------------------------------------------
    head('Two principals never mix:');
    const other = sess();
    await other('POST', '/auth/signup', { name: 'Bo Other', email: `o${ID}@x.com`, password: PW });
    const bo = (await other('GET', '/auth/me')).d.user;
    await other('PATCH', '/profile', { slug: `bo-${ID}`, timezone: 'UTC' });
    await other('POST', '/profile/onboarding-step', { step: 'done' });
    await other('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
    });
    r = await other('POST', '/meeting-types', { name: 'Intro', durationMinutes: 30, locationType: 'video', accessTier: 1 });
    const boSlots = (await anon('GET', `/public/bo-${ID}/${r.d.meetingType.slug}/slots`)).d.slots;
    await anon('POST', `/public/bo-${ID}/${r.d.meetingType.slug}/book`, {
      name: 'Stays Booked', email: `keep${ID}@x.com`, timezone: 'UTC', startAt: boSlots[0].startAt,
    });

    r = await boss('GET', `/bookings?scope=upcoming&q=keep${ID}`);
    ok('the same person booking two principals stays on separate lists',
      r.d.bookings.length === 1 && r.d.bookings[0].id === kept.id,
      String(r.d.bookings.length));

    r = await pa('GET', `/pa/${bo.id}/bookings`);
    ok('and an assistant cannot read a principal they were never given',
      r.s === 403, String(r.s));
    r = await pa('GET', `/pa/${me.id}/bookings/${kept.id}/trail`);
    ok('a booking of the principal they do have is fine', r.s === 200);
    r = await boss('GET', `/bookings/${'nosuchbooking'}/trail`);
    ok('and a booking that does not exist is a 404, not an empty trail', r.s === 404, String(r.s));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nThe office can answer what happened, and nobody is cancelled in silence.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})();
