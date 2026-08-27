// Being told, while there is still time to do something about it.
//
// THE QUESTION THIS ANSWERS: "how does it tell me I have a brief to give or a
// letter to write, when I am busy with something else?" The audit that
// prompted it found three holes, and they are the reason this suite exists
// rather than a few lines added to bdue:
//
//   1. REMINDERS WENT TO EMAIL AND NOWHERE ELSE. lib/knock.js exists precisely
//      so that one idea — telling somebody Kairos wants them — has one
//      implementation across two channels. The reminder sweep predated it and
//      called sendEmail directly, so the one class of notice whose entire
//      purpose is reaching a person who is busy with something else was the one
//      class that could not reach their phone.
//
//   2. NOTHING SWEPT APPOINTMENTS AT ALL. A booking landed in the diary, the
//      day sheet drew it, and from then until it began the app said nothing.
//      That is the exact case a scheduling product exists to cover.
//
//   3. essentials.reminder_stage WAS WRITTEN AND NEVER READ. The column was
//      added and cleared correctly on every edit, and nothing ever set it — so
//      the feature whose stated point is that a passport under six months'
//      validity turns somebody away at check-in never mentioned a passport to
//      anybody. Half a mechanism is worse than none: the half that exists makes
//      it look finished.
//
// The two properties worth watching hardest are the ones that make people turn
// notifications off: a nudge must fire ONCE per rung, and it must never say a
// thing that should stay behind a session.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = 4583, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
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

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      ENCRYPTION_KEY: KEY,
      // Never on its own timer during the suite: every sweep here is called
      // by hand with an explicit clock, so nothing races the assertions.
      REMINDER_SWEEP_MS: String(60 * 60 * 1000),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const db = require(`${ROOT}/app/server/lib/db`);
  const reminders = require(`${ROOT}/app/server/lib/reminders`);
  const webPush = require(`${ROOT}/app/server/lib/webPush`);

  // WHAT WENT TO A PHONE, recorded rather than sent. There is no phone here
  // and no push service; what matters is that the reminder path REACHES the
  // push channel at all, which is exactly what it did not do before.
  const buzzed = [];
  const realNotify = webPush.notify;
  webPush.notify = async (userId, payload) => { buzzed.push({ userId, ...payload }); };

  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    await db.ready();

    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('PATCH', '/profile', { timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const pa = client();
    const paUp = await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    const paId = paUp.d.user.id;
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    const invite = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${invite.d.inviteLink.split('/').pop()}/accept`);

    const space = await boss('POST', '/spaces', { name: `Office ${ID}`, context: 'work' });
    const spaceId = space.d.space.id;

    // ---- A task with a deadline -------------------------------------------
    head('A brief you are supposed to give, while there is still time:');
    const now = Date.now();
    const brief = await boss('POST', '/tasks', {
      spaceId,
      title: 'Write the board brief',
      assigneeId: paId,
      dueAt: iso(now + 20 * 60 * 60 * 1000), // inside the ordinary 24h lead
    });
    ok('the task exists and is somebody\'s', brief.d.task.assigneeId === paId);

    let mailedBefore = (await boss('GET', '/emails')).d.emails.length;
    buzzed.length = 0;
    let swept = await reminders.runReminderSweep(now);
    ok('the sweep picks it up', swept.tasks === 1, JSON.stringify(swept));

    const mails = (await boss('GET', '/emails')).d.emails;
    ok('an email goes out', mails.length === mailedBefore + 1,
      `${mailedBefore} -> ${mails.length}`);
    // THE HOLE THIS SUITE WAS WRITTEN FOR. An email read tomorrow is a record
    // of a miss, not a way to prevent one.
    ok('AND the phone is rung, not only the inbox',
      buzzed.some((b) => b.userId === paId && /board brief/.test(b.title)),
      JSON.stringify(buzzed));
    ok('and tapping it lands on the work, not the front door',
      buzzed.find((b) => b.userId === paId)?.url === '/tasks');

    // Once per rung. A phone that buzzes every fifteen minutes about the same
    // deadline is a phone whose owner turns the whole class off.
    buzzed.length = 0;
    swept = await reminders.runReminderSweep(now + 60 * 1000);
    ok('and it does not nag again at the same rung', swept.tasks === 0 && buzzed.length === 0,
      JSON.stringify(swept));

    // But the deadline passing is a new thing to say.
    buzzed.length = 0;
    swept = await reminders.runReminderSweep(now + 21 * 60 * 60 * 1000);
    ok('though passing the deadline is worth saying once', swept.tasks === 1);
    ok('and says so in those words',
      /Overdue/.test(buzzed.find((b) => b.userId === paId)?.title || ''),
      JSON.stringify(buzzed.map((b) => b.title)));

    head('And a high-priority one is told sooner, because it costs more:');
    const letter = await boss('POST', '/tasks', {
      spaceId,
      title: 'Write the letter to the registry',
      assigneeId: paId,
      dueAt: iso(now + 40 * 60 * 60 * 1000),
      priority: 'high',
    });
    ok('a normal task would still be silent at forty hours',
      reminders.dueBand(iso(now + 40 * 60 * 60 * 1000), now, 'normal') === null);
    buzzed.length = 0;
    swept = await reminders.runReminderSweep(now);
    ok('but a high one is already being warned', swept.tasks === 1,
      JSON.stringify(swept));
    ok('and it is the letter', buzzed.some((b) => /registry/.test(b.title)),
      JSON.stringify(buzzed.map((b) => b.title)));
    await boss('DELETE', `/tasks/${letter.d.task.id}`);

    // ---- An appointment ---------------------------------------------------
    head('A meeting, before it starts rather than after:');
    // Wide open, so the suite never depends on what hour it is run at.
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
    });
    const mt = await boss('POST', '/meeting-types',
      { name: 'Board review', durationMinutes: 30, accessTier: 1 });
    const slug = mt.d.meetingType.slug;
    const me = await boss('GET', '/auth/me');
    const handle = me.d.user.slug;
    // Booked far enough out to be accepted, then placed by hand: every route
    // that creates a booking refuses a time in the past, and the point here is
    // the clock the sweep is given, not the clock the booking was made on.
    const openings = await (client())('GET', `/public/${handle}/${slug}/slots`);
    const slot = (openings.d.slots || [])[0];
    ok('there is a slot to book', !!slot, JSON.stringify(openings.d).slice(0, 160));
    const booked = await (client())('POST', `/public/${handle}/${slug}/book`, {
      name: 'Chidi Eze', email: `chidi${ID}@x.com`, timezone: 'UTC', startAt: slot.startAt,
    });
    ok('and it can be booked', booked.s === 201, JSON.stringify(booked.d).slice(0, 160));
    const bookingId = booked.d.booking.id;

    const soon = now + 20 * 60 * 1000;
    await db.prepare('UPDATE bookings SET start_at = ?, end_at = ? WHERE id = ?')
      .run(iso(soon), iso(soon + 30 * 60 * 1000), bookingId);

    buzzed.length = 0;
    swept = await reminders.runReminderSweep(now);
    ok('the meeting is announced before it starts', swept.appointments === 1,
      JSON.stringify(swept));
    const ring = buzzed.find((b) => b.userId === bossId);
    ok('to the person whose diary it is', !!ring, JSON.stringify(buzzed));
    ok('saying how long they have', /In \d+ minutes/.test(ring?.title || ''), ring?.title);
    ok('and landing on the appointment itself',
      ring?.url === `/appointments/${bossId}/${bookingId}`, ring?.url);
    // Not the assistants too. Buzzing three people for one four o'clock is how
    // an office learns to ignore the buzz.
    ok('and not to everybody else in the office',
      !buzzed.some((b) => b.userId === paId), JSON.stringify(buzzed.map((b) => b.userId)));

    buzzed.length = 0;
    ok('and it is not announced twice',
      (await reminders.runReminderSweep(now + 60 * 1000)).appointments === 0);

    // A meeting that has moved deserves a fresh warning; a stamp left behind
    // means the NEW time passes in silence because the old one was announced.
    head('And a meeting that moves is announced again:');
    const later = now + 5 * 60 * 60 * 1000;
    await boss('POST', `/bookings/${bookingId}/reschedule`,
      { startAt: iso(later) }).catch(() => {});
    const stamp = await db.prepare('SELECT reminder_stage FROM bookings WHERE id = ?').get(bookingId);
    ok('moving it clears the warning already given',
      stamp.reminder_stage === null, String(stamp.reminder_stage));
    buzzed.length = 0;
    ok('so the new time is announced in its turn',
      (await reminders.runReminderSweep(later - 20 * 60 * 1000)).appointments === 1);

    // ---- A document that stops working ------------------------------------
    head('A passport that is about to stop working:');
    const ess = await boss('POST', `/essentials/${bossId}`, {
      category: 'travel_identity',
      field: 'passport_number',
      label: 'Passport',
      value: 'A01234567',
      expiresOn: ymd(now + 120 * DAY),
    });
    ok('it can be recorded with an expiry', ess.s === 201, JSON.stringify(ess.d).slice(0, 160));

    buzzed.length = 0;
    swept = await reminders.runReminderSweep(now);
    ok('four months out, it is mentioned', swept.essentials === 1, JSON.stringify(swept));
    const doc = buzzed.find((b) => b.userId === bossId);
    ok('to whoever the office belongs to', !!doc, JSON.stringify(buzzed));
    // WHOSE DOCUMENT, NEVER WHAT IT SAYS. A notification is read by whoever is
    // holding the phone, and this one is about a passport number.
    ok('and the number is nowhere in it',
      !JSON.stringify(buzzed).includes('A01234567'), JSON.stringify(buzzed));

    buzzed.length = 0;
    ok('and it is not repeated at the same rung',
      (await reminders.runReminderSweep(now + DAY)).essentials === 0);
    // Three rungs, because a document is not a task: worth mentioning six
    // months out, worth acting on one month out, a different problem once gone.
    buzzed.length = 0;
    ok('but a month out is a different thing to say',
      (await reminders.runReminderSweep(now + 100 * DAY)).essentials === 1);
    ok('and says it is urgent now',
      /Expires soon/.test(buzzed.find((b) => b.userId === bossId)?.title || ''),
      JSON.stringify(buzzed.map((b) => b.title)));
    buzzed.length = 0;
    ok('and expiring outright is the third and last',
      (await reminders.runReminderSweep(now + 130 * DAY)).essentials === 1);
    ok('said as expired rather than as coming up',
      /^Expired:/.test(buzzed.find((b) => b.userId === bossId)?.title || ''),
      JSON.stringify(buzzed.map((b) => b.title)));
    buzzed.length = 0;
    ok('and then it stops, having said everything it has to say',
      (await reminders.runReminderSweep(now + 200 * DAY)).essentials === 0);

    head('Editing the date starts the warnings over:');
    const list = await boss('GET', `/essentials/${bossId}`);
    const row = (list.d.essentials || list.d.items || []).find((e) => e.label === 'Passport');
    ok('the entry is readable', !!row, JSON.stringify(list.d).slice(0, 200));
    await boss('PATCH', `/essentials/${bossId}/${row.id}`, { expiresOn: ymd(now + 400 * DAY) });
    buzzed.length = 0;
    ok('a renewed passport is quiet again',
      (await reminders.runReminderSweep(now)).essentials === 0);
    ok('until the new date comes round',
      (await reminders.runReminderSweep(now + 250 * DAY)).essentials === 1);
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    webPush.notify = realNotify;
    proc.kill();
  }

  console.log(fails === 0
    ? '\nWork, meetings and documents all say something before it is too late.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
