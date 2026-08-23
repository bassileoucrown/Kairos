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
    // Three, not two. The in-person one is on an open tier, and choosing a
    // format other than the principal's usual no longer holds a booking —
    // only the tier does. It used to be counted here as a question.
    ok('the confirmed ones are ahead of you', r.d.bookings.length === 3,
      String(r.d.bookings.length));
    ok('and each says how it is to happen',
      r.d.bookings.every((b) => !!b.formatLabel), JSON.stringify(r.d.bookings.map((b) => b.formatLabel)));

    const asked = r.d.bookings.find((b) => b.id === visiting.id);
    ok('the one who wanted something else is simply booked', !!asked && asked.status === 'confirmed',
      String(asked && asked.status));
    ok('and is on record as having chosen something unusual', asked.wasUnusual === true);
    ok('saying what, against what the usual was',
      asked.formatLabel === 'In person' && asked.usualFormatLabel === 'Video call',
      `${asked.formatLabel} / ${asked.usualFormatLabel}`);

    r = await boss('GET', '/bookings?scope=pending');
    ok('and only the gated tier is still a question', r.d.bookings.length === 1,
      String(r.d.bookings.length));

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
    // Two left, not one: the in-person booking is confirmed now rather than
    // waiting, so it stays on the upcoming list alongside the kept one.
    ok('and neither is still counted as upcoming',
      (await boss('GET', '/bookings?scope=upcoming')).d.bookings.length === 2);

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
    ok('and so does the name of the meeting type', r.d.bookings.length === 2,
      String(r.d.bookings.length));
    r = await boss('GET', '/bookings?scope=upcoming&q=%25');
    ok('a wildcard is searched for, not obeyed', r.d.bookings.length === 0,
      String(r.d.bookings.length));

    // ---- What happened, and what was said ---------------------------------------
    head('The trail of one booking:');
    r = await boss('GET', `/bookings/${dropped.id}/trail`);
    const line = (re) => r.d.trail.find((t) => re.test(t.headline));
    ok('both what was done and what was sent are in it',
      r.d.trail.some((t) => t.source === 'event') && r.d.trail.some((t) => t.source === 'email'),
      JSON.stringify(r.d.trail.map((t) => t.source)));
    ok('oldest first, so it reads as a story',
      new Date(r.d.trail[0].at) <= new Date(r.d.trail[r.d.trail.length - 1].at));
    ok('it opens with the booking itself', r.d.trail[0].headline === 'Booked',
      r.d.trail[0].headline);
    ok('credited to the person who booked, who has no account',
      r.d.trail[0].by === 'Gets Cancelled' && r.d.trail[0].byOffice === false,
      `${r.d.trail[0].by} / office:${r.d.trail[0].byOffice}`);
    ok('the cancellation is recorded as a thing that happened',
      !!line(/^Cancelled$/), JSON.stringify(r.d.trail.map((t) => t.headline)));
    ok('attributed to the office member who did it',
      line(/^Cancelled$/).by === 'Ada Boss' && line(/^Cancelled$/).byOffice === true);
    ok('and the letter that went out is marked as a letter, not as an act',
      r.d.trail.some((t) => t.source === 'email' && /cancel/i.test(t.headline)));
    ok('a letter nobody pressed send on is not credited to anybody',
      r.d.trail.some((t) => t.source === 'email' && t.byPerson === false));

    // The reason only subjects come across.
    ok('no letter body is handed over', !JSON.stringify(r.d.trail).includes('/book/manage/'),
      JSON.stringify(r.d.trail).slice(0, 160));

    // ---- The reason the table exists ---------------------------------------------
    head('A meeting that moves:');
    const wasAt = kept.startAt;
    let free = await slots(open.slug);
    const moveTo = free.find((s) => s.startAt !== wasAt);
    r = await anon('POST', `/public/bookings/${kept.id}/reschedule`, { startAt: moveTo.startAt });
    ok('it can be moved', r.s === 200, JSON.stringify(r.d).slice(0, 120));
    ok('and the row now holds only the new time', r.d.booking.startAt === moveTo.startAt);

    r = await boss('GET', `/bookings/${kept.id}/trail`);
    const moved = r.d.trail.filter((t) => t.kind === 'rescheduled');
    ok('but the move is on the record', moved.length === 1,
      JSON.stringify(r.d.trail.map((t) => t.headline)));
    ok('naming the time first agreed, which the booking itself has forgotten',
      /^Moved from .+ to .+$/.test(moved[0].headline), moved[0].headline);
    ok('and who moved it', moved[0].by === 'Stays Booked');

    // Twice, because one move is the easy case.
    free = await slots(open.slug);
    const again = free.find((s) => s.startAt !== moveTo.startAt);
    await anon('POST', `/public/bookings/${kept.id}/reschedule`, { startAt: again.startAt });
    r = await boss('GET', `/bookings/${kept.id}/trail`);
    ok('a second move does not overwrite the first',
      r.d.trail.filter((t) => t.kind === 'rescheduled').length === 2,
      String(r.d.trail.filter((t) => t.kind === 'rescheduled').length));

    // ---- A whole negotiation, read back -------------------------------------------
    head('A negotiation, read back afterwards:');
    r = await book(open.slug, { name: 'Talked It Over', email: `talk${ID}@x.com`, format: 'in_person' });
    const talked = r.d.booking.id;
    await boss('POST', `/pa/${me.id}/approvals/${talked}/counter`,
      { format: 'video', formatNote: 'The grounds are being resurfaced' });
    await anon('POST', `/public/bookings/${talked}/accept-format`);

    r = await boss('GET', `/bookings/${talked}/trail`);
    const kinds = r.d.trail.filter((t) => t.source === 'event').map((t) => t.kind);
    ok('every turn of it is there, in the order it happened',
      // The booker's choice is recorded as agreed, not proposed: it stands on
      // arrival and nobody is being asked for anything. The office's answer is
      // still a counter, and accepting it is the second format_agreed.
      JSON.stringify(kinds) === JSON.stringify(['booked', 'format_agreed', 'format_countered', 'format_agreed']),
      JSON.stringify(kinds));
    const chose = r.d.trail.filter((t) => t.kind === 'format_agreed')[0];
    ok('the choice says what was wanted and what it replaced',
      /in person/i.test(chose.headline) && /video call/i.test(chose.headline),
      chose.headline);
    const countered = r.d.trail.find((t) => t.kind === 'format_countered');
    ok('the office\'s answer carries its reason',
      countered.detail === 'The grounds are being resurfaced', String(countered.detail));
    ok('and is credited to the office, not to the booker', countered.byOffice === true);
    ok('while the booker\'s agreement is credited to them',
      r.d.trail.find((t) => t.kind === 'format_agreed').by === 'Talked It Over');

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
      r.d.bookings.length > 0 && r.d.bookings.every((b) => b.status === 'confirmed'
        && new Date(b.startAt) > new Date()),
      JSON.stringify(r.d.bookings.map((b) => b.status)));
    ok('including the one that was never in doubt',
      r.d.bookings.some((b) => b.id === kept.id));
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
