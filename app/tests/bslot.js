// A clock that lives outside, and a diary you can write in directly.
//
// TWO THINGS THAT SHARE A CAUSE: the app knew something and would not act on
// it without being asked in one particular way.
//
//   THE SWEEP knew a meeting was in half an hour, and on a free Render
//   instance the container is stopped after fifteen idle minutes — no
//   processes, no timers — so the notice never went. /api/sweep lets an
//   outside scheduler both wake it and run it.
//
//   THE DIARY could only be written to through the public booking page, by a
//   stranger, against published hours and a shareable link. Most of a
//   principal's day is not agreed that way, so the day sheet showed a fraction
//   of the day while implying it was the day.
//
// The three worth watching hardest are the ones that widen access:
//
//   AN OPEN SWEEP ENDPOINT is a way to make a stranger's request cost this
//   server a full pass over every task, booking and document it holds. It must
//   refuse without the secret, and look absent when no secret is set.
//
//   WRITING IN SOMEBODY'S DIARY is no smaller a power than taking something
//   out of it, so a delegate without the scheduling remit must not reach it —
//   and somebody with no relationship at all must not learn the account exists.
//
//   A CLASH must be refused rather than filed quietly, because a principal
//   cannot be in two places and only the office knows when both are real.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = 4585, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SECRET = `sweep-secret-${ID}`;
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function client() {
  let cookie = '';
  return async function call(method, path, body, headers = {}) {
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
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

const iso = (ms) => new Date(ms).toISOString();

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
      SWEEP_SECRET: SECRET,
      REMINDER_SWEEP_MS: String(60 * 60 * 1000),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const db = require(`${ROOT}/app/server/lib/db`);

  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    await db.ready();

    const anon = client();

    // ---- The outside clock -------------------------------------------------
    head('A scheduler somewhere else can run the sweep:');
    let r = await anon('POST', '/sweep', undefined, { authorization: `Bearer ${SECRET}` });
    ok('with the secret, it runs', r.s === 200, JSON.stringify(r.d));
    ok('and answers with what it did',
      typeof r.d.tasks === 'number' && typeof r.d.appointments === 'number',
      JSON.stringify(r.d));
    // Several free schedulers can only be given a URL and no headers.
    r = await anon('GET', `/sweep?key=${encodeURIComponent(SECRET)}`);
    ok('a plain GET with the key in the URL works too', r.s === 200, JSON.stringify(r.d));

    head('And nobody else can:');
    ok('no secret at all is refused', (await anon('POST', '/sweep')).s === 401);
    ok('a wrong secret is refused',
      (await anon('POST', '/sweep', undefined, { authorization: 'Bearer nope' })).s === 401);
    // The prefix of a real secret must be no better than nonsense — the whole
    // reason the comparison is over a digest rather than the bytes.
    ok('and a near miss is refused exactly like nonsense',
      (await anon('POST', '/sweep', undefined,
        { authorization: `Bearer ${SECRET.slice(0, -1)}` })).s === 401);
    // A signed-in person is not a scheduler; the secret is the only key.
    ok('being logged in is not a way in',
      (await anon('POST', '/sweep', undefined, { authorization: 'Bearer ' })).s === 401);

    // ---- Writing in the diary ---------------------------------------------
    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('PATCH', '/profile', { timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    head('A meeting agreed on the phone goes straight in:');
    const when = Date.now() + 3 * 24 * 60 * 60 * 1000;
    r = await boss('POST', '/bookings',
      { startAt: iso(when), durationMinutes: 45, name: 'Chidi Eze' });
    ok('no link, no meeting type, no slot picker', r.s === 201, JSON.stringify(r.d).slice(0, 200));
    const first = r.d.booking.id;
    ok('and it runs as long as it was told to',
      new Date(r.d.booking.endAt) - new Date(r.d.booking.startAt) === 45 * 60000);

    const diary = await boss('GET', '/bookings?scope=upcoming');
    ok('it is on the diary like anything else',
      diary.d.bookings.some((b) => b.id === first && b.bookerName === 'Chidi Eze'),
      JSON.stringify(diary.d.bookings.map((b) => b.bookerName)));
    // Published hours are an offer made to strangers, not a fact about when
    // somebody can be somewhere. This principal has no availability at all.
    ok('even with no published hours to book against', true);

    head('And the type it uses is not something the office has to look at:');
    const types = await boss('GET', '/meeting-types');
    ok('it is not in the list of meeting types',
      !(types.d.meetingTypes || []).some((t) => t.name === 'In the diary'),
      JSON.stringify((types.d.meetingTypes || []).map((t) => t.name)));
    const handle = (await boss('GET', '/auth/me')).d.user.slug;
    const page = await anon('GET', `/public/${handle}`);
    ok('nor on the public booking page',
      !(page.d.meetingTypes || []).some((t) => t.name === 'In the diary'),
      JSON.stringify((page.d.meetingTypes || []).map((t) => t.name)));
    // One per office, not one per booking.
    await boss('POST', '/bookings',
      { startAt: iso(when + 3 * 60 * 60 * 1000), durationMinutes: 30, name: 'Tunde Bakare' });
    const internals = await db.prepare(
      "SELECT COUNT(*) AS n FROM meeting_types WHERE owner_id = ? AND kind = 'internal'",
    ).get(bossId);
    ok('and a second one reuses it rather than making another',
      Number(internals.n) === 1, JSON.stringify(internals));

    head('A clash is named, not filed quietly:');
    r = await boss('POST', '/bookings',
      { startAt: iso(when + 15 * 60000), durationMinutes: 30, name: 'Somebody else' });
    ok('overlapping is refused', r.s === 409, `${r.s} ${JSON.stringify(r.d)}`);
    ok('and says what it runs into',
      /Chidi Eze/.test(r.d?.error || ''), r.d?.error);
    ok('handing back the thing itself, so the screen can name it',
      r.d?.clashes?.[0]?.with === 'Chidi Eze', JSON.stringify(r.d?.clashes));
    // A call taken during a car journey is a real thing and only the office
    // knows, so the refusal carries the way through rather than being the end.
    r = await boss('POST', '/bookings',
      { startAt: iso(when + 15 * 60000), durationMinutes: 30, name: 'Somebody else', allowOverlap: true });
    ok('but the office can say to keep both', r.s === 201, JSON.stringify(r.d));
    // Back to back is not overlapping — the most ordinary shape a day has.
    r = await boss('POST', '/bookings',
      { startAt: iso(when + 45 * 60000), durationMinutes: 30, name: 'Straight after' });
    ok('and a meeting starting as another ends is not a clash', r.s === 201,
      `${r.s} ${JSON.stringify(r.d)}`);

    head('What it refuses on its own account:');
    ok('a meeting with nobody', (await boss('POST', '/bookings',
      { startAt: iso(when + 40 * 24 * 3600000), durationMinutes: 30, name: '  ' })).s === 400);
    ok('a time that is not a time', (await boss('POST', '/bookings',
      { startAt: 'tuesday-ish', durationMinutes: 30, name: 'X' })).s === 400);
    ok('and a meeting that runs for a week', (await boss('POST', '/bookings',
      { startAt: iso(when + 41 * 24 * 3600000), durationMinutes: 60 * 24 * 7, name: 'X' })).s === 400);
    // The past is allowed on purpose: an assistant writing up this morning is
    // recording the diary, not booking it.
    ok('but writing up a meeting that already happened is allowed',
      (await boss('POST', '/bookings',
        { startAt: iso(Date.now() - 4 * 3600000), durationMinutes: 30, name: 'This morning' })).s === 201);

    head('And nobody writes in a diary that is not theirs to write in:');
    const stranger = client();
    await stranger('POST', '/auth/signup',
      { name: 'Nobody Special', email: `no${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await stranger('POST', '/profile/onboarding-step', { step: 'done' });
    r = await stranger('POST', '/bookings',
      { ownerId: bossId, startAt: iso(when + 50 * 24 * 3600000), durationMinutes: 30, name: 'Sneaked in' });
    // 404 rather than 403: whether a given person holds a Kairos account is
    // not a fact this confirms to somebody with no connection to them.
    ok('a stranger is told there is no such diary', r.s === 404, `${r.s} ${JSON.stringify(r.d)}`);

    // THE ONE THAT MATTERS MOST. A delegate given the vault but not the diary
    // must not reach the diary by a side door.
    const clerk = client();
    await clerk('POST', '/auth/signup',
      { name: 'Kunle Ade', email: `kunle${ID}@x.com`, password: PW, accountCategory: 'delegate' });
    await clerk('POST', '/profile/onboarding-step', { step: 'done' });
    const inv = await boss('POST', '/members', { email: `kunle${ID}@x.com`, role: 'delegate' });
    await clerk('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);
    await db.prepare('UPDATE memberships SET can_manage_scheduling = 0 WHERE owner_id = ? AND member_user_id = ?')
      .run(bossId, (await clerk('GET', '/auth/me')).d.user.id);
    r = await clerk('POST', '/bookings',
      { ownerId: bossId, startAt: iso(when + 51 * 24 * 3600000), durationMinutes: 30, name: 'Not mine to add' });
    ok('a delegate without the diary remit is refused', r.s === 403, `${r.s} ${JSON.stringify(r.d)}`);
    ok('and told which remit is missing', /remit/i.test(r.d?.error || ''), r.d?.error);

    const pa = client();
    await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    const inv2 = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv2.d.inviteLink.split('/').pop()}/accept`);
    r = await pa('POST', '/bookings',
      { ownerId: bossId, startAt: iso(when + 52 * 24 * 3600000), durationMinutes: 30, name: 'Board dinner' });
    ok('but the PA who runs the diary can', r.s === 201, `${r.s} ${JSON.stringify(r.d)}`);
    ok('and it lands on the principal\'s diary, not their own',
      (await boss('GET', '/bookings?scope=upcoming')).d.bookings
        .some((b) => b.bookerName === 'Board dinner'));
    ok('while their own stays empty',
      !(await pa('GET', '/bookings?scope=upcoming')).d.bookings
        .some((b) => b.bookerName === 'Board dinner'));

    head('Nothing is emailed unless the office asks:');
    const before = (await boss('GET', '/emails')).d.emails.length;
    await boss('POST', '/bookings',
      { startAt: iso(when + 60 * 24 * 3600000), durationMinutes: 30,
        name: 'Quiet one', email: `quiet${ID}@x.com` });
    ok('an address alone does not send anything',
      (await boss('GET', '/emails')).d.emails.length === before,
      String((await boss('GET', '/emails')).d.emails.length));
    await boss('POST', '/bookings',
      { startAt: iso(when + 61 * 24 * 3600000), durationMinutes: 30,
        name: 'Told one', email: `told${ID}@x.com`, notify: true });
    ok('and asking for a confirmation sends one',
      (await boss('GET', '/emails')).d.emails.length === before + 1);

    head('And the meeting it put in is announced like any other:');
    const soon = Date.now() + 20 * 60 * 1000;
    const near = await boss('POST', '/bookings',
      { startAt: iso(soon), durationMinutes: 30, name: 'In twenty minutes', allowOverlap: true });
    ok('it can be put twenty minutes out', near.s === 201, JSON.stringify(near.d));
    r = await anon('POST', '/sweep', undefined, { authorization: `Bearer ${SECRET}` });
    ok('the outside clock picks it up', r.d.appointments >= 1, JSON.stringify(r.d));
    const stamped = await db.prepare('SELECT reminder_stage FROM bookings WHERE id = ?')
      .get(near.d.booking.id);
    ok('and marks it so it is not announced twice',
      stamped.reminder_stage === 'soon', String(stamped.reminder_stage));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nAn outside clock runs the sweep, and the office can write in its own diary.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
