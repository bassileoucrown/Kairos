// The shape of a working day: how blocks are set, what fits in them, the
// breather between meetings, and what everybody is told about when it ends.
//
// Four properties, each of which is the thing its feature exists for:
//
//   A BLOCK IS A START AND A LENGTH. Nobody should have to work out what 09:00
//   plus three hours comes to in order to say when they are free.
//
//   A BLOCK CAN CAP WHAT FITS IN IT. An hour in the morning and half of one
//   after lunch, which is the whole reason for having more than one block.
//   A meeting type longer than the cap gets *nothing* there rather than a
//   shortened meeting nobody agreed to.
//
//   THE BREATHER IS REAL. Not a label: two meetings cannot be booked back to
//   back, and the slots step by the meeting plus the gap.
//
//   EVERYBODY IS TOLD WHEN IT ENDS. Every confirmation used to name only the
//   start, which reads as complete and is not.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4619);
const BASE = `http://127.0.0.1:${PORT}/api`;
const ID = Date.now().toString(36);
const PW = 'password123';
const EMAIL = `shape${ID}@x.com`;
const SLUG = `ada${ID}`;

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

// The principal is in UTC so an hour in this suite is the same hour on the row.
const hourOf = (iso) => Number(iso.slice(11, 13));
const minuteOf = (iso) => Number(iso.slice(14, 16));

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

    const boss = sess();
    await boss('POST', '/auth/signup', { name: 'Ada Boss', email: EMAIL, password: PW, accountCategory: 'principal' });
    const me = (await boss('GET', '/auth/me')).d.user;
    await boss('PATCH', '/profile', { slug: SLUG, timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    // ---- Saying when you are free, by length ------------------------------
    head('Setting hours by how long they run:');
    let r = await boss('GET', '/availability');
    ok('the screen is offered lengths to pick from', (r.d.lengthChoices || []).length >= 5,
      JSON.stringify((r.d.lengthChoices || []).map((c) => c.minutes)));
    ok('and lengths for the longest meeting', (r.d.capChoices || []).length >= 4);
    ok('with a breather already set, rather than none',
      r.d.gapMinutes === 10, String(r.d.gapMinutes));

    // Every day: a long morning that takes anything, and a short afternoon
    // that will only give half an hour.
    const week = [];
    for (const dayOfWeek of [0, 1, 2, 3, 4, 5, 6]) {
      week.push({ dayOfWeek, startTime: '09:00', lengthMinutes: 180, slotMinutes: 60 });
      week.push({ dayOfWeek, startTime: '14:00', lengthMinutes: 120, slotMinutes: 30 });
    }
    r = await boss('PUT', '/availability', { rules: week, gapMinutes: 0 });
    ok('a block given a start and a length is accepted', r.s === 200, JSON.stringify(r.d).slice(0, 140));
    const mon = r.d.rules.filter((x) => x.dayOfWeek === 1).sort((a, b) => a.startTime.localeCompare(b.startTime));
    ok('and the end is worked out for you', mon[0].endTime === '12:00', mon[0].endTime);
    ok('the length comes back as a length', mon[0].lengthMinutes === 180, String(mon[0].lengthMinutes));
    ok('so does the longest meeting it takes', mon[0].slotMinutes === 60 && mon[1].slotMinutes === 30,
      `${mon[0].slotMinutes} / ${mon[1].slotMinutes}`);
    ok('two blocks on one day, with different limits', mon.length === 2);

    // ---- What a block will and will not take -------------------------------
    head('What fits in each block:');
    r = await boss('POST', '/meeting-types', { name: 'Short', durationMinutes: 30, locationType: 'video', accessTier: 1 });
    const short = r.d.meetingType;
    r = await boss('POST', '/meeting-types', { name: 'Long', durationMinutes: 60, locationType: 'video', accessTier: 1 });
    const long = r.d.meetingType;

    const slotsOf = async (mt) => (await anon('GET', `/public/${SLUG}/${mt.slug}/slots`)).d.slots;
    let shortSlots = await slotsOf(short);
    let longSlots = await slotsOf(long);

    ok('a half-hour meeting is offered times in the morning',
      shortSlots.some((s) => hourOf(s.startAt) >= 9 && hourOf(s.startAt) < 12));
    ok('and in the afternoon',
      shortSlots.some((s) => hourOf(s.startAt) >= 14 && hourOf(s.startAt) < 16));

    ok('an hour-long meeting is offered the morning',
      longSlots.some((s) => hourOf(s.startAt) >= 9 && hourOf(s.startAt) < 12));
    // The property the whole cap exists for.
    ok('but nothing at all in the block that only gives half an hour',
      !longSlots.some((s) => hourOf(s.startAt) >= 14 && hourOf(s.startAt) < 16),
      JSON.stringify(longSlots.filter((s) => hourOf(s.startAt) >= 14).map((s) => s.startAt).slice(0, 3)));
    ok('and it is not quietly shortened instead',
      longSlots.every((s) => new Date(s.endAt) - new Date(s.startAt) === 60 * 60000));

    // ---- A block that cannot keep its own promise ---------------------------
    head('A cap longer than its block:');
    r = await boss('PUT', '/availability', {
      rules: [{ dayOfWeek: 1, startTime: '09:00', lengthMinutes: 30, slotMinutes: 60 }],
    });
    ok('is refused rather than silently ignored', r.s === 400, `${r.s} ${JSON.stringify(r.d)}`);
    ok('and the week is untouched', (await boss('GET', '/availability')).d.rules.length === 14,
      String((await boss('GET', '/availability')).d.rules.length));

    r = await boss('PUT', '/availability', {
      rules: [{ dayOfWeek: 1, startTime: '23:30', lengthMinutes: 120 }],
    });
    ok('so is a block that runs past midnight', r.s === 400, `${r.s} ${JSON.stringify(r.d)}`);

    // ---- The breather ---------------------------------------------------------
    head('A breather after every meeting:');
    r = await boss('PUT', '/availability', { rules: week, gapMinutes: 15 });
    ok('the gap is saved', r.d.gapMinutes === 15, String(r.d.gapMinutes));

    shortSlots = await slotsOf(short);
    const morning = shortSlots.filter((s) => hourOf(s.startAt) >= 9 && hourOf(s.startAt) < 12)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    ok('slots step by the meeting plus the breather, not by the meeting',
      minuteOf(morning[1].startAt) === 45, `${morning[0].startAt} then ${morning[1].startAt}`);

    // The property that makes it more than spacing on a grid.
    const first = morning[0];
    r = await anon('POST', `/public/${SLUG}/${short.slug}/book`, {
      name: 'First In', email: `f${ID}@x.com`, timezone: 'UTC', startAt: first.startAt,
    });
    ok('a meeting can be booked', r.s === 201, JSON.stringify(r.d).slice(0, 120));
    const backToBack = new Date(new Date(first.startAt).getTime() + 30 * 60000).toISOString();
    r = await anon('POST', `/public/${SLUG}/${short.slug}/book`, {
      name: 'Right After', email: `r${ID}@x.com`, timezone: 'UTC', startAt: backToBack,
    });
    ok('and nothing can start the moment it ends', r.s === 409, `${r.s} ${JSON.stringify(r.d)}`);

    const afterGap = new Date(new Date(first.startAt).getTime() + 45 * 60000).toISOString();
    r = await anon('POST', `/public/${SLUG}/${short.slug}/book`, {
      name: 'After The Gap', email: `g${ID}@x.com`, timezone: 'UTC', startAt: afterGap,
    });
    ok('but the slot after the breather is free', r.s === 201, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);

    // ---- What the booker is told ----------------------------------------------
    head('Telling people when it ends:');
    const booking = r.d.booking;
    ok('the confirmation carries an end time', !!booking.endAt, JSON.stringify(booking).slice(0, 120));
    ok('half an hour after the start',
      new Date(booking.endAt) - new Date(booking.startAt) === 30 * 60000);

    r = await boss('GET', '/emails');
    const confirmation = r.d.emails.find((e) => e.relatedBookingId === booking.id
      && /confirmed/i.test(e.subject));
    ok('and so does the email that goes to them', /until/i.test(confirmation.body),
      String(confirmation.body).slice(0, 160));

    r = await anon('GET', `/public/bookings/${booking.id}`);
    ok('the manage page knows it too', !!r.d.booking.endAt);

    // ---- Zero is a real answer --------------------------------------------------
    head('Turning the breather off:');
    await boss('PUT', '/availability', { rules: week, gapMinutes: 0 });
    shortSlots = await slotsOf(short);
    const back = shortSlots.filter((s) => hourOf(s.startAt) === 14).sort((a, b) => a.startAt.localeCompare(b.startAt));
    ok('slots go back to touching', back.length >= 2 && minuteOf(back[1].startAt) === 30,
      JSON.stringify(back.slice(0, 2).map((s) => s.startAt)));

    r = await boss('PUT', '/availability', { rules: week, gapMinutes: 500 });
    ok('an absurd breather is refused', r.s === 400, `${r.s} ${JSON.stringify(r.d)}`);
    r = await boss('PUT', '/availability', { rules: week, warnMinutes: 200 });
    ok('so is an absurd warning', r.s === 400, `${r.s} ${JSON.stringify(r.d)}`);

    // ---- What is running right now -----------------------------------------------
    head('Knowing a meeting is nearly over:');
    r = await boss('GET', `/rhythm/${me.id}/now`);
    ok('the screen is told when to warn', r.d.warnMinutes === 5, String(r.d.warnMinutes));
    ok('and how long the breather is, so it can say what comes next',
      typeof r.d.gapMinutes === 'number');
    ok('with a clock to check its own against', !!r.d.now);
    ok('and nothing running, since nothing is', Array.isArray(r.d.running));

    const pa = sess();
    await pa('POST', '/auth/signup', { name: 'Chidi PA', email: `pa${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    r = await pa('GET', `/rhythm/${me.id}/now`);
    ok('a stranger cannot watch somebody else\'s clock', r.s === 403, String(r.s));

    // ---- What the diary says about the day -----------------------------------------
    head('Reading how somebody works:');
    r = await boss('GET', `/rhythm/${me.id}/pattern`);
    ok('a young account is told there is not enough yet', r.d.enough === false,
      JSON.stringify(r.d).slice(0, 140));
    ok('and how much it would take', r.d.needed > 0 && r.d.sampleSize < r.d.needed,
      `${r.d.sampleSize}/${r.d.needed}`);
    ok('it invents no findings in the meantime', r.d.findings.length === 0);
    ok('but still shows the parts of the day it counts by', r.d.parts.length >= 5);

    // Enough history, all of it in the morning, and one thing moved.
    const soon = (h) => {
      const d = new Date(Date.now() - 3 * 86400000);
      d.setUTCHours(h, 0, 0, 0);
      return d.toISOString();
    };
    for (let i = 0; i < 14; i++) {
      const at = new Date(Date.now() - (2 + i) * 86400000);
      at.setUTCHours(10, 0, 0, 0);
      await boss('POST', `/itinerary/${me.id}/items`, {
        kind: 'meeting', title: `Past meeting ${i}`,
        startAt: at.toISOString(), endAt: new Date(at.getTime() + 3600000).toISOString(),
        status: 'confirmed',
      });
    }
    r = await boss('GET', `/rhythm/${me.id}/pattern`);
    ok('with enough behind them, it will speak', r.d.enough === true,
      `${r.d.sampleSize}/${r.d.needed}`);
    ok('and says where the day happens',
      r.d.findings.some((f) => f.id === 'busiest' && /morning/i.test(f.text)),
      JSON.stringify(r.d.findings.map((f) => f.text)));
    ok('naming where meetings in particular land',
      r.d.findings.some((f) => f.id === 'kind-meeting'),
      JSON.stringify(r.d.findings.map((f) => f.id)));
    ok('every line carries the count behind it',
      r.d.findings.every((f) => !!f.evidence), JSON.stringify(r.d.findings));
    ok('and the counts are there to be argued with',
      r.d.parts.find((p) => p.id === 'morning').count >= 14,
      String(r.d.parts.find((p) => p.id === 'morning').count));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nThe day has a shape, it is easy to say, and everybody is told when it ends.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})();
