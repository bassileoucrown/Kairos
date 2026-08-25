// The pad: somewhere to put a thing you have just thought of.
//
// WHY IT EXISTS. tasks.space_id is NOT NULL, so nothing could be written down
// until somebody had decided which space it belonged to. That is the wrong
// order for a thought — one arrives walking out of a meeting, and if capturing
// it costs a form it is not captured at all.
//
// THE ASSERTION THIS SUITE IS REALLY FOR is the privacy one. A principal's
// jottings are not their office's business, and a scheduling delegate who can
// read "call the lawyer" is a reason to stop using the pad. So: a private line
// is absent from what anybody else is served — not filtered on screen, not
// present and hidden, ABSENT — and the one act that widens who can read it is
// deliberate and says so.
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

const SECRET = 'Call the lawyer about the estate before Friday.';

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

    // The office: an assistant with full access to everything the product
    // considers the principal's business.
    const inv = await boss('POST', '/members', { email: `pa${ID}@x.com`, role: 'chief_of_staff' });
    const pa = client();
    await pa('POST', '/auth/signup', { name: 'Kit Staff', email: `pa${ID}@x.com`, password: PW, accountCategory: 'chief_of_staff' });
    const paMe = (await pa('GET', '/auth/me')).d.user;
    await pa('PATCH', '/profile', { slug: `kit-${ID}` });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`, {});

    // --- Capture costs one field ------------------------------------------
    head('Writing something down asks nothing else of you:');
    let r = await boss('POST', '/pad', { body: SECRET });
    ok('a line is accepted on its own', r.s === 201, JSON.stringify(r.d).slice(0, 200));
    const secretId = r.d.item.id;
    ok('with no space, no date and no assignee',
      r.d.item.taskId === null && r.d.item.wakeAt === null && r.d.item.assigneeId === null,
      JSON.stringify(r.d.item));
    // The default is the whole reason anybody trusts the thing.
    ok('and it is private without anybody choosing', r.d.item.visibility === 'private', r.d.item.visibility);
    r = await boss('POST', '/pad', { body: '   ' });
    ok('an empty line is refused', r.s === 400, String(r.s));

    // --- The wall -----------------------------------------------------------
    head('The office cannot read it — the point of the whole feature:');
    r = await pa('GET', '/pad');
    ok('their pad loads', r.s === 200, String(r.s));
    // Checked against the whole payload rather than the list, because a leak
    // could arrive through any field.
    ok('and the words are nowhere in what they are served',
      !JSON.stringify(r.d).includes('lawyer'), 'a private line reached the office');
    r = await pa('PATCH', `/pad/${secretId}`, { state: 'done' });
    ok('they cannot settle a line they cannot see', r.s === 404, String(r.s));
    r = await pa('DELETE', `/pad/${secretId}`);
    ok('nor delete it', r.s === 404, String(r.s));

    // --- Putting one where the office can see it ----------------------------
    head('Sharing a line is a deliberate act:');
    r = await boss('POST', '/pad', { body: 'Chase the caterers for Thursday.', visibility: 'office' });
    ok('an office line is accepted', r.s === 201, JSON.stringify(r.d).slice(0, 160));
    const officeId = r.d.item.id;
    r = await pa('GET', '/pad');
    ok('and the office does see that one', JSON.stringify(r.d).includes('caterers'));
    ok('while the private one is still absent beside it',
      !JSON.stringify(r.d).includes('lawyer'));

    // An office line is readable by the office, but the words stay the
    // author's. Reading is not the same permission as rewriting.
    r = await pa('PATCH', `/pad/${officeId}`, { body: 'Cancel the caterers.' });
    ok('the office cannot rewrite somebody else\'s note', r.s === 403, String(r.s));
    ok('and says why', /wrote it/i.test(r.d?.error || ''), r.d?.error);

    // --- Coming back to it --------------------------------------------------
    head('A line can be put down and picked up later:');
    const soon = new Date(Date.now() - 60000).toISOString();   // already due
    const later = new Date(Date.now() + 7 * 86400000).toISOString();
    r = await boss('PATCH', `/pad/${secretId}`, { wakeAt: later });
    ok('you can ask to be reminded', r.s === 200, JSON.stringify(r.d).slice(0, 160));
    ok('and it is not awake yet', r.d.item.awake === false, String(r.d.item.awake));
    r = await boss('PATCH', `/pad/${secretId}`, { wakeAt: soon });
    ok('one whose day has come is awake', r.d.item.awake === true, String(r.d.item.awake));

    r = await boss('GET', `/today/${me.id}`);
    const waking = r.d.needsYou?.padWaking || [];
    ok('and it surfaces on Today, where somebody will see it',
      waking.some((p) => p.id === secretId), JSON.stringify(waking).slice(0, 200));
    // Today is otherwise the principal's screen; this one row is the viewer's.
    r = await pa('GET', `/today/${me.id}`);
    ok('but not on the assistant\'s view of the same day',
      !(r.d.needsYou?.padWaking || []).some((p) => p.id === secretId),
      JSON.stringify(r.d.needsYou?.padWaking || []));

    r = await boss('PATCH', `/pad/${secretId}`, { wakeAt: null });
    ok('and the reminder can be called off', r.d.item.wakeAt === null, String(r.d.item.wakeAt));

    // --- Becoming a task ----------------------------------------------------
    head('A line that turns out to matter becomes a task:');
    r = await boss('POST', '/spaces', { name: 'The estate', context: 'private' });
    const space = r.d.space;
    r = await boss('POST', `/pad/${secretId}/task`, { spaceId: space.id });
    ok('it is promoted', r.s === 201, JSON.stringify(r.d).slice(0, 200));
    const taskId = r.d.taskId;
    ok('and the line remembers what it became', r.d.item.taskId === taskId, r.d.item.taskId);
    // Kept rather than deleted: the only record that the thought started here.
    ok('and is settled rather than deleted', r.d.item.state === 'done', r.d.item.state);
    // Assigned to whoever promoted it, or the promotion moves a loose end from
    // a list you read to a space you do not — the failure the pad exists to
    // prevent, reappearing one step further on.
    r = await boss('GET', '/tasks/mine');
    ok('the task is real, is yours, and carries the words',
      (r.d.tasks || []).some((t) => t.id === taskId && /lawyer/.test(t.title)),
      JSON.stringify((r.d.tasks || []).map((t) => t.title)).slice(0, 200));

    r = await boss('POST', `/pad/${secretId}/task`, { spaceId: space.id });
    ok('promoting the same line twice is refused', r.s === 400, String(r.s));
    ok('and says it is already one', /already a task/i.test(r.d?.error || ''), r.d?.error);
    r = await boss('POST', `/pad/${officeId}/task`, {});
    ok('and a task with no space is refused', r.s === 400, String(r.s));

    // --- Becoming something on the diary ------------------------------------
    head('Or something on a real day:');
    r = await boss('POST', '/pad', { body: 'Lunch with the auditors.' });
    const lunchId = r.d.item.id;
    const when = new Date(Date.now() + 3 * 86400000).toISOString();
    r = await boss('POST', `/pad/${lunchId}/itinerary`, { startAt: when });
    ok('it lands on the diary', r.s === 201, JSON.stringify(r.d).slice(0, 200));
    // A principal entering their own plan means it — the same rule the
    // itinerary itself uses.
    ok('live at once, because the principal put it there', r.d.status === 'confirmed', r.d.status);
    ok('and the line points at it', !!r.d.item.itineraryItemId, JSON.stringify(r.d.item));
    r = await boss('POST', `/pad/${lunchId}/itinerary`, { startAt: when });
    ok('twice is refused', r.s === 400, String(r.s));
    r = await boss('POST', '/pad', { body: 'Something else.' });
    r = await boss('POST', `/pad/${r.d.item.id}/itinerary`, { startAt: 'not a time' });
    ok('and a time that is not a time', r.s === 400, String(r.s));

    // --- Handing it over ----------------------------------------------------
    head('Handing a line to somebody widens who can read it, deliberately:');
    r = await boss('POST', '/pad', { body: 'Book the car for the airport run.' });
    const carId = r.d.item.id;
    r = await pa('GET', '/pad');
    ok('it starts private, so the office cannot see it',
      !JSON.stringify(r.d).includes('airport run'));
    r = await boss('POST', `/pad/${carId}/hand`, { toUserId: paMe.id });
    ok('handing it over is accepted', r.s === 200, JSON.stringify(r.d).slice(0, 160));
    ok('and names who has it', r.d.item.assigneeName === 'Kit Staff', r.d.item.assigneeName);
    r = await pa('GET', '/pad');
    ok('now they can see it, which is the whole point of handing it over',
      JSON.stringify(r.d).includes('airport run'));
    // The one thing the person it was handed to may do without owning it.
    r = await pa('PATCH', `/pad/${carId}`, { state: 'done' });
    ok('and they can tick it off', r.s === 200, JSON.stringify(r.d).slice(0, 160));
    r = await pa('PATCH', `/pad/${carId}`, { body: 'No car needed.' });
    ok('but still cannot rewrite it', r.s === 403, String(r.s));

    // --- A stranger ---------------------------------------------------------
    head('Somebody with no business here sees none of it:');
    const outsider = client();
    await outsider('POST', '/auth/signup', { name: 'Someone Else', email: `else${ID}@x.com`, password: PW });
    r = await outsider('GET', '/pad');
    ok('their pad is their own and empty', (r.d.items || []).length === 0,
      JSON.stringify(r.d.items || []).slice(0, 200));
    ok('with nothing of anybody else\'s in it',
      !JSON.stringify(r.d).includes('caterers') && !JSON.stringify(r.d).includes('lawyer'));
    r = await outsider('PATCH', `/pad/${officeId}`, { state: 'done' });
    ok('and an office line they are not part of is not found', r.s === 404, String(r.s));
    r = await boss('POST', `/pad/${officeId}/hand`, { toUserId: (await outsider('GET', '/auth/me')).d.user.id });
    ok('nor can a line be handed to a stranger', r.s === 400, String(r.s));
    ok('because you do not share an office', /share an office/i.test(r.d?.error || ''), r.d?.error);

    // --- A note about something --------------------------------------------
    head('A line remembers what it was written against:');
    r = await boss('POST', '/pad', {
      body: 'Chase them for the draft.', aboutKind: 'booking', aboutId: 'some-booking-id',
    });
    ok('it carries what it is about', r.d.item.about?.kind === 'booking', JSON.stringify(r.d.item.about));
    r = await boss('GET', '/pad?aboutKind=booking&aboutId=some-booking-id');
    ok('and can be found by it', (r.d.items || []).length === 1, String((r.d.items || []).length));
    r = await boss('POST', '/pad', { body: 'x', aboutKind: 'nonsense', aboutId: 'y' });
    ok('a kind nobody defined is refused', r.s === 400, String(r.s));

    head('And the pad can be cleared:');
    r = await boss('DELETE', `/pad/${officeId}`);
    ok('your own line goes when you say so', r.s === 204, String(r.s));
    r = await boss('GET', '/pad');
    ok('and is gone', !JSON.stringify(r.d).includes('caterers'));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA thought costs one line to keep, stays yours unless you say otherwise, and can grow into the thing it turned out to be.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
