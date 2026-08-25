// A line open on an appointment, and the wall down the middle of it.
//
// The office prepares for a meeting in writing: what the principal needs to
// know, what was agreed internally. The office also SAYS things to the person
// they are meeting — directions before, a follow-up after. Those are two
// different kinds of writing and only one of them is for a stranger's eyes.
//
// The manage link asks for no password. Holding /book/manage/<id> is what
// makes somebody the booker, so anything reachable from there is readable by
// anyone that link is ever forwarded to. The assertion this suite exists for
// is that an office note is not reachable from there — not filtered out on the
// screen, not present and hidden, ABSENT from the payload.
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

const SECRET = 'He always runs late — tell the driver 20 minutes early.';

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
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
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
    });
    let r = await boss('POST', '/meeting-types', {
      name: 'Intro', durationMinutes: 30, locationType: 'video', accessTier: 1,
    });
    const mt = r.d.meetingType;

    const anon = client();
    const slots = (await anon('GET', `/public/adaeze-${ID}/${mt.slug}/slots`)).d.slots || [];
    await anon('POST', `/public/adaeze-${ID}/${mt.slug}/book`, {
      timezone: 'UTC', startAt: slots[0].startAt, name: 'Chidi Eze', email: `chidi${ID}@x.com`,
    });
    const bookingId = (await boss('GET', '/bookings')).d.bookings[0].id;

    // --- Detail for the principal's own use --------------------------------
    head('The office writes what the principal needs:');
    r = await boss('POST', `/bookings/${bookingId}/notes`, { body: SECRET });
    ok('a note is accepted', r.s === 201, JSON.stringify(r.d).slice(0, 160));
    ok('and is the office\'s own by default, without anybody choosing',
      r.d.note.visibility === 'office', r.d.note.visibility);
    ok('carrying who wrote it', r.d.note.authorName === 'Adaeze Okonkwo', r.d.note.authorName);

    // --- The wall ----------------------------------------------------------
    head('The booker cannot reach it — the whole point:');
    r = await anon('GET', `/public/bookings/${bookingId}`);
    ok('their page loads', r.s === 200, String(r.s));
    ok('and carries no office note at all', (r.d.notes || []).length === 0,
      JSON.stringify(r.d.notes));
    // Not "filtered on screen" — absent from the bytes. Checked against the
    // whole payload, because a leak could arrive through any field.
    ok('the words are nowhere in what they are sent',
      !JSON.stringify(r.d).includes('runs late'), 'the secret reached the booker');

    // --- Saying something TO them ------------------------------------------
    head('Saying something to the booker is a different register:');
    r = await boss('POST', `/bookings/${bookingId}/notes`, {
      body: 'Use the Marina entrance, not the main gate.', visibility: 'shared',
    });
    ok('a shared note is accepted', r.s === 201, JSON.stringify(r.d).slice(0, 140));
    r = await anon('GET', `/public/bookings/${bookingId}`);
    ok('and this one does reach them', (r.d.notes || []).length === 1, JSON.stringify(r.d.notes));
    ok('with the office named', r.d.notes[0].authorName === 'Adaeze Okonkwo');
    ok('and the office note still absent beside it',
      !JSON.stringify(r.d).includes('runs late'));

    // --- The booker answers -------------------------------------------------
    head('The booker can answer while the appointment stands:');
    r = await anon('POST', `/public/bookings/${bookingId}/notes`, { body: 'Understood, thank you.' });
    ok('their note is accepted', r.s === 201, JSON.stringify(r.d).slice(0, 140));
    ok('and is marked as theirs, not the office\'s', r.d.note.fromBooker === true);
    r = await boss('GET', '/emails');
    ok('the office is emailed, because somebody is now waiting',
      (r.d.emails || []).some((e) => /left a note/i.test(e.subject || '')),
      JSON.stringify((r.d.emails || []).map((e) => e.subject)).slice(0, 200));

    r = await boss('GET', `/bookings/${bookingId}/notes`);
    ok('the office reads both registers as one conversation',
      (r.d.notes || []).length === 3, String((r.d.notes || []).length));
    ok('in the order they were written',
      r.d.notes.map((n) => n.visibility).join(',') === 'office,shared,shared',
      r.d.notes.map((n) => n.visibility).join(','));

    // --- Following up afterwards -------------------------------------------
    head('Following up after the meeting:');
    r = await boss('POST', `/bookings/${bookingId}/follow-up`, {
      body: 'You are sending the draft by Friday; we will revert on the budget.',
    });
    ok('the follow-up is accepted', r.s === 201, JSON.stringify(r.d).slice(0, 140));
    ok('and is shared, since it is for them', r.d.note.visibility === 'shared');
    r = await boss('GET', '/emails');
    const followUp = (r.d.emails || []).find((e) => /^Following up:/.test(e.subject || ''));
    ok('it is emailed rather than left on a page they may never revisit', !!followUp,
      JSON.stringify((r.d.emails || []).map((e) => e.subject)).slice(0, 240));
    // A follow-up is the one note somebody is waiting on, so the email carries
    // the words rather than a link to go and find them.
    ok('and the email carries what was said',
      /draft by Friday/.test(followUp?.body || ''), (followUp?.body || '').slice(0, 120));

    // --- An assistant does all of it ---------------------------------------
    head('An assistant can do all of this for their principal:');
    const inv = await boss('POST', '/members', { email: `pa${ID}@x.com`, role: 'chief_of_staff' });
    const pa = client();
    await pa('POST', '/auth/signup', { name: 'Kit Staff', email: `pa${ID}@x.com`, password: PW, accountCategory: 'chief_of_staff' });
    await pa('PATCH', '/profile', { slug: `kit-${ID}` });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`, {});

    r = await pa('POST', `/pa/${me.id}/bookings/${bookingId}/notes`, { body: 'Car booked for 8.' });
    ok('they can add detail', r.s === 201, JSON.stringify(r.d).slice(0, 140));
    r = await pa('GET', `/pa/${me.id}/bookings/${bookingId}/notes`);
    ok('and read the whole conversation', (r.d.notes || []).length === 5, String((r.d.notes || []).length));
    r = await pa('POST', `/pa/${me.id}/bookings/${bookingId}/follow-up`, { body: 'Minutes attached.' });
    ok('and follow up in the principal\'s name', r.s === 201, JSON.stringify(r.d).slice(0, 140));

    // --- Who may not ---------------------------------------------------------
    head('And somebody with no business here cannot:');
    const outsider = client();
    await outsider('POST', '/auth/signup', { name: 'Someone Else', email: `else${ID}@x.com`, password: PW });
    r = await outsider('GET', `/pa/${me.id}/bookings/${bookingId}/notes`);
    ok('not through the delegated route', r.s === 403, String(r.s));
    r = await outsider('GET', `/bookings/${bookingId}/notes`);
    ok('and not through their own', r.s === 404, String(r.s));

    // --- The line closes with the appointment -------------------------------
    head('The line closes when the appointment does:');
    await boss('POST', `/bookings/${bookingId}/cancel`, {});
    r = await anon('POST', `/public/bookings/${bookingId}/notes`, { body: 'Still there?' });
    ok('a cancelled appointment takes no more notes', r.s === 400, String(r.s));
    ok('and says why', /closed/i.test(r.d?.error || ''), r.d?.error);
    // What was already said stays readable — it happened.
    r = await anon('GET', `/public/bookings/${bookingId}`);
    ok('but what was already said is still there', (r.d.notes || []).length > 0,
      String((r.d.notes || []).length));

    head('Nothing empty gets in:');
    r = await boss('POST', `/bookings/${bookingId}/notes`, { body: '   ' });
    ok('a blank note is refused', r.s === 400, String(r.s));
    r = await boss('POST', `/bookings/${bookingId}/notes`, { body: 'x', visibility: 'everyone' });
    ok('and a register nobody defined', r.s === 400, String(r.s));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nAn appointment carries a line to the booker, and the office\'s own notes stay behind it.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
