// Handing somebody a line starts a conversation. Keeping it going.
//
// "Book the car" is answered with "for what time?", then "eight", then "done,
// he is at the Marina gate". Four sentences and it is over. That is not a
// thread in a space — threads.space_id is NOT NULL, so routing it there would
// mean choosing a space in order to ask a one-line question, which is the
// ceremony the pad exists to avoid. And it is not email, because a reply in an
// inbox leaves Kairos and takes half the exchange with it.
//
// TWO THINGS ARE PROVED HERE. That the answer lands beside the question and
// both people can see it. And that nobody has to be watching a screen for it
// to work: being handed a line knocks, a reply knocks, and whoever owes the
// next word finds it waiting on Today.
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
    const t = await r.text();
    let d = null;
    try { d = t ? JSON.parse(t) : null; } catch { d = t; }
    return { s: r.status, d };
  };
}

const turnOf = (items, id) => (items.find((i) => i.id === id) || {});

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
    try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('no server');
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    const boss = client();
    await boss('POST', '/auth/signup', { name: 'Adaeze Okonkwo', email: `boss${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const me = (await boss('GET', '/auth/me')).d.user;
    await boss('PATCH', '/profile', { slug: `adaeze-${ID}`, timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const inv = await boss('POST', '/members', { email: `pa${ID}@x.com`, role: 'chief_of_staff' });
    const pa = client();
    await pa('POST', '/auth/signup', { name: 'Kit Staff', email: `pa${ID}@x.com`, password: PW, accountCategory: 'chief_of_staff' });
    const paMe = (await pa('GET', '/auth/me')).d.user;
    await pa('PATCH', '/profile', { slug: `kit-${ID}`, timezone: 'UTC' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`, {});

    // --- Handing it over knocks ---------------------------------------------
    head('Being handed something tells you — it used to tell nobody:');
    let r = await boss('POST', '/pad', { body: 'Book the car for the airport run.' });
    const line = r.d.item.id;
    // No @handle in that text on purpose. Handing went through the mention
    // machinery, which only reaches handles written in the body, so a line
    // handed over with no "@kit" in it notified nobody at all and sat on a
    // screen they had no reason to open.
    ok('the line names nobody', !/@/.test('Book the car for the airport run.'));
    r = await boss('POST', `/pad/${line}/hand`, { toUserId: paMe.id });
    ok('handing it over is accepted', r.s === 200, JSON.stringify(r.d).slice(0, 140));
    // Read from the sender's outbox, which is where /emails files anything
    // sent on an owner's behalf — the recipient has an inbox in the world, not
    // in Kairos. What matters is that a letter exists and is addressed to them.
    r = await boss('GET', '/emails');
    const knock = (r.d.emails || []).find(
      (e) => /handed you something/i.test(e.subject || '') && e.toEmail === `pa${ID}@x.com`,
    );
    ok('and they are actually told', !!knock,
      JSON.stringify((r.d.emails || []).map((e) => [e.subject, e.toEmail])).slice(0, 240));
    // A knock, not a transcript: the words stay where the answer can land
    // beside them rather than starting a conversation in an inbox.
    ok('without the note travelling into their inbox',
      !/airport run/.test(knock?.body || ''), (knock?.body || '').slice(0, 140));

    // --- Whose move it is ----------------------------------------------------
    head('The line knows whose move it is:');
    r = await pa('GET', '/pad');
    ok('it is theirs to answer', turnOf(r.d.items, line).yoursToAnswer === true,
      JSON.stringify(turnOf(r.d.items, line)).slice(0, 200));
    r = await boss('GET', '/pad');
    ok('and not the person who handed it over',
      turnOf(r.d.items, line).yoursToAnswer === false,
      String(turnOf(r.d.items, line).yoursToAnswer));

    r = await pa('GET', `/today/${me.id}`);
    ok('so it is waiting on Today, not only on a screen nobody opened',
      (r.d.needsYou?.padYourTurn || []).some((p) => p.id === line),
      JSON.stringify(r.d.needsYou?.padYourTurn || []).slice(0, 200));

    // --- The conversation ----------------------------------------------------
    head('They can ask, rather than guess:');
    r = await pa('POST', `/pad/${line}/replies`, { body: 'For what time?' });
    ok('the question is accepted', r.s === 201, JSON.stringify(r.d).slice(0, 140));
    ok('and the ball moves back', r.d.item.turnBelongsTo === me.id, r.d.item.turnBelongsTo);
    r = await boss('GET', '/emails');
    ok('the person who asked for it is told',
      (r.d.emails || []).some((e) => /replied on the pad/i.test(e.subject || '')),
      JSON.stringify((r.d.emails || []).map((e) => e.subject)).slice(0, 240));
    r = await boss('GET', '/pad');
    ok('and it is now theirs to answer', turnOf(r.d.items, line).yoursToAnswer === true);
    r = await boss(
      'GET', `/today/${me.id}`,
    );
    ok('waiting on their Today too',
      (r.d.needsYou?.padYourTurn || []).some((p) => p.id === line));

    head('And the answer lands beside the question:');
    r = await boss('POST', `/pad/${line}/replies`, { body: 'Eight, from the house.' });
    ok('the answer is accepted', r.s === 201, JSON.stringify(r.d).slice(0, 140));
    r = await pa('GET', `/pad/${line}/replies`);
    ok('both sides read one conversation, in order',
      (r.d.replies || []).map((x) => x.body).join(' | ')
        === 'For what time? | Eight, from the house.',
      JSON.stringify(r.d.replies));
    ok('with each line attributed',
      r.d.replies[0].authorName === 'Kit Staff' && r.d.replies[1].authorName === 'Adaeze Okonkwo',
      JSON.stringify(r.d.replies.map((x) => x.authorName)));
    r = await pa('GET', '/pad');
    ok('and the count is on the line itself', turnOf(r.d.items, line).replyCount === 2,
      String(turnOf(r.d.items, line).replyCount));

    head('It ends when somebody settles it:');
    r = await pa('POST', `/pad/${line}/replies`, { body: 'Done — Marina gate at eight.' });
    ok('the last word is theirs', r.s === 201);
    r = await pa('PATCH', `/pad/${line}`, { state: 'done' });
    ok('and whoever holds it can tick it off', r.s === 200, JSON.stringify(r.d).slice(0, 140));
    // A settled line is nobody's move. It should stop chasing both of them.
    ok('a settled line is nobody\'s turn', r.d.item.turnBelongsTo === null,
      String(r.d.item.turnBelongsTo));
    r = await boss('GET', `/today/${me.id}`);
    ok('and it leaves Today', !(r.d.needsYou?.padYourTurn || []).some((p) => p.id === line),
      JSON.stringify(r.d.needsYou?.padYourTurn || []));
    // What was said stays readable — it happened.
    r = await boss('GET', `/pad/${line}/replies`);
    ok('but what was said is still there', (r.d.replies || []).length === 3,
      String((r.d.replies || []).length));

    // --- A note nobody was handed --------------------------------------------
    head('A note you have not handed to anybody does not nag you:');
    r = await boss('POST', '/pad', { body: 'Think about the Q3 numbers.' });
    const solo = r.d.item.id;
    ok('it is nobody\'s turn', r.d.item.turnBelongsTo === null, String(r.d.item.turnBelongsTo));
    r = await boss('GET', `/today/${me.id}`);
    ok('and it stays off Today', !(r.d.needsYou?.padYourTurn || []).some((p) => p.id === solo));

    // --- The wall still stands ----------------------------------------------
    head('And a conversation cannot reach further than the line it is on:');
    const outsider = client();
    await outsider('POST', '/auth/signup', { name: 'Someone Else', email: `else${ID}@x.com`, password: PW });
    r = await outsider('GET', `/pad/${line}/replies`);
    ok('a stranger cannot read it', r.s === 404, String(r.s));
    r = await outsider('POST', `/pad/${line}/replies`, { body: 'Hello?' });
    ok('nor say anything into it', r.s === 404, String(r.s));
    // The private note was never handed over, so the office has no business
    // in it — the reply route must not become a way around that.
    r = await pa('GET', `/pad/${solo}/replies`);
    ok('and a private line is closed even to the office', r.s === 404, String(r.s));
    r = await pa('POST', `/pad/${solo}/replies`, { body: 'Anything I can do?' });
    ok('in both directions', r.s === 404, String(r.s));

    head('Nothing empty gets in:');
    r = await boss('POST', `/pad/${line}/replies`, { body: '   ' });
    ok('a blank reply is refused', r.s === 400, String(r.s));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA handed note can be talked about where it lives, and whoever owes the next word is told.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
