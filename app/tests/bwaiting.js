// Knowing there is something waiting for you without opening every screen.
//
// The rail carried two counts before this, each fetched by the screen that
// owned it. Now there is one endpoint behind all of them, which makes three
// things worth proving and easy to get wrong:
//
//   A COUNT IS A LEAK LIKE ANY OTHER. Telling somebody there are four unread
//   messages in a space they cannot open still tells them the space exists and
//   that something is happening in it. Every count here has to obey exactly
//   the access rule that governs reading the thing counted.
//
//   YOUR OWN VOICE DOES NOT COUNT. A badge that rose when you wrote a message
//   or set yourself a task would be permanently lit, and a permanent light is
//   not a signal.
//
//   READING CLEARS IT. A dot that survives being acted on is worse than no dot,
//   because the next one gets ignored.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4611);
const BASE = `http://127.0.0.1:${PORT}/api`;
const ID = Date.now().toString(36);
const PW = 'password123';
const AUTHOR = `voice${ID}@x.com`;

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
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      // So there is somebody who can publish a notice to count.
      ANNOUNCEMENT_AUTHORS: AUTHOR,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    const deadline = Date.now() + 30000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('the server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    const signup = async (name, email, category) => {
      const s = sess();
      await s('POST', '/auth/signup', { name, email, password: PW, accountCategory: category });
      await s('POST', '/profile/onboarding-step', { step: 'done' });
      const me = (await s('GET', '/auth/me')).d.user;
      return [s, me];
    };

    const [boss, me] = await signup('Ada Boss', `w${ID}@x.com`, 'principal');
    await boss('PATCH', '/profile', { slug: `ada-${ID}`, timezone: 'Africa/Lagos' });

    const counts = async (who, principalId) =>
      (await who('GET', `/attention${principalId ? `?principalId=${principalId}` : ''}`)).d;

    // ---- Nothing waiting -------------------------------------------------
    head('A fresh account:');
    let a = await counts(boss);
    ok('has nothing waiting anywhere', a.total === 0, JSON.stringify(a.counts));
    ok('and says so with numbers, not with silence',
      Object.values(a.counts).every((n) => n === 0), JSON.stringify(a.counts));

    // ---- Approvals -------------------------------------------------------
    head('Somebody asks for time:');
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
    });
    let r = await boss('POST', '/meeting-types', {
      name: 'Private', durationMinutes: 30, locationType: 'video', accessTier: 4,
    });
    const mt = r.d.meetingType;
    const slots = (await anon('GET', `/public/ada-${ID}/${mt.slug}/slots`)).d.slots;
    await anon('POST', `/public/ada-${ID}/${mt.slug}/book`, {
      name: 'A Stranger', email: `s${ID}@x.com`, timezone: 'UTC', startAt: slots[0].startAt,
    });

    a = await counts(boss);
    ok('the approval queue is counted', a.counts.approvals === 1, String(a.counts.approvals));
    ok('and it is in the total', a.total === 1, String(a.total));

    // ---- The assistant sees the same queue --------------------------------
    head('Their assistant:');
    const [pa, paUser] = await signup('Chidi PA', `p${ID}@x.com`, 'pa');
    r = await boss('POST', '/members', { email: `p${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${r.d.inviteLink.split('/').pop()}/accept`);

    a = await counts(pa, me.id);
    ok('sees the principal\'s queue when acting for them', a.counts.approvals === 1,
      String(a.counts.approvals));
    a = await counts(pa, paUser.id);
    ok('and their own empty one when acting for themselves', a.counts.approvals === 0);

    // ---- A principal they do not support ----------------------------------
    head('A principal nobody gave them:');
    const [other, otherUser] = await signup('Bo Other', `o${ID}@x.com`, 'principal');
    await other('PATCH', '/profile', { slug: `bo-${ID}`, timezone: 'UTC' });
    await other('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
    });
    r = await other('POST', '/meeting-types', {
      name: 'Private', durationMinutes: 30, locationType: 'video', accessTier: 4,
    });
    const boSlots = (await anon('GET', `/public/bo-${ID}/${r.d.meetingType.slug}/slots`)).d.slots;
    await anon('POST', `/public/bo-${ID}/${r.d.meetingType.slug}/book`, {
      name: 'Another Stranger', email: `s2${ID}@x.com`, timezone: 'UTC', startAt: boSlots[0].startAt,
    });
    ok('that principal really does have one waiting',
      (await counts(other)).counts.approvals === 1);

    a = await counts(pa, otherUser.id);
    ok('but the assistant is told nothing about it', a.counts.approvals === 0,
      String(a.counts.approvals));
    ok('and is not given an error either, which would confirm it exists',
      a.counts.approvals === 0 && typeof a.total === 'number');

    // ---- Unread messages ---------------------------------------------------
    head('A message in a shared space:');
    r = await boss('POST', '/spaces', { name: 'The Office', context: 'work' });
    const space = r.d.space;
    r = await boss('POST', `/spaces/${space.id}/threads`, { name: 'Logistics' });
    const thread = r.d.thread;
    ok('the assistant can reach it, being a PA on a work space',
      (await pa('GET', `/spaces/${space.id}`)).s === 200);

    await boss('POST', `/threads/${thread.id}/messages`, { body: 'The car is booked for six.' });
    a = await counts(pa, me.id);
    ok('it counts as unread for the assistant', a.counts.messages === 1,
      String(a.counts.messages));
    a = await counts(boss);
    ok('but not for whoever wrote it', a.counts.messages === 0, String(a.counts.messages));

    await pa('GET', `/threads/${thread.id}/messages`);
    a = await counts(pa, me.id);
    ok('opening the thread clears it', a.counts.messages === 0, String(a.counts.messages));

    await boss('POST', `/threads/${thread.id}/messages`, { body: 'Make it half past five.' });
    a = await counts(pa, me.id);
    ok('and a later message counts again', a.counts.messages === 1, String(a.counts.messages));

    // The property the whole isolation model rests on.
    head('A message in a space they cannot open:');
    r = await boss('POST', '/spaces', { name: 'Just Me', context: 'private' });
    const priv = r.d.space;
    r = await boss('POST', `/spaces/${priv.id}/threads`, { name: 'Notes' });
    await boss('POST', `/threads/${r.d.thread.id}/messages`, { body: 'Sell the Lagos flat.' });
    ok('the assistant cannot open it', (await pa('GET', `/spaces/${priv.id}`)).s === 404);
    a = await counts(pa, me.id);
    ok('and it is not counted for them either', a.counts.messages === 1,
      `${a.counts.messages} — a private space leaked into a count`);
    ok('nor does a stranger hear about any of it',
      (await counts(other)).counts.messages === 0);

    // ---- Tasks --------------------------------------------------------------
    head('Work put on somebody:');
    await boss('POST', '/tasks', {
      spaceId: space.id, title: 'Confirm the driver', assigneeId: paUser.id,
    });
    a = await counts(pa, me.id);
    ok('a task somebody else set counts', a.counts.tasks === 1, String(a.counts.tasks));

    r = await boss('POST', '/tasks', {
      spaceId: space.id, title: 'My own reminder', assigneeId: me.id,
    });
    a = await counts(boss);
    ok('a task you set yourself does not', a.counts.tasks === 0, String(a.counts.tasks));

    r = await pa('GET', `/tasks?spaceId=${space.id}`);
    const mine = r.d.tasks.find((t) => t.title === 'Confirm the driver');
    await pa('PATCH', `/tasks/${mine.id}`, { status: 'done' });
    a = await counts(pa, me.id);
    ok('and finishing one clears it', a.counts.tasks === 0, String(a.counts.tasks));

    // ---- Arrangements waiting on the principal --------------------------------
    head('An arrangement sent for a decision:');
    const soon = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    r = await pa('POST', `/itinerary/${me.id}/items`, {
      kind: 'flight', title: 'BA75 to London', startAt: soon,
    });
    const item = r.d.item;
    a = await counts(boss);
    ok('a draft is nobody\'s business but the assistant\'s', a.counts.requests === 0,
      String(a.counts.requests));

    await pa('POST', `/itinerary/${me.id}/items/${item.id}/propose`, { note: 'Confirm by Friday?' });
    a = await counts(boss);
    ok('once sent, it is waiting on the principal', a.counts.requests === 1,
      String(a.counts.requests));
    a = await counts(pa, me.id);
    ok('and not on the assistant, who is the one waiting', a.counts.requests === 0,
      String(a.counts.requests));

    await boss('POST', `/itinerary/${me.id}/items/${item.id}/decide`, { approve: true });
    a = await counts(boss);
    ok('deciding clears it', a.counts.requests === 0, String(a.counts.requests));

    // ---- Notices -------------------------------------------------------------
    head('A notice to everyone:');
    const [author] = await signup('The Desk', AUTHOR, 'principal');
    r = await author('POST', '/announcements', {
      title: 'Scheduled maintenance', body: 'Sunday, 02:00 to 04:00.', publish: true,
    });
    ok('it publishes', r.s === 201, JSON.stringify(r.d).slice(0, 120));
    a = await counts(boss);
    ok('and is counted as unread', a.counts.notices === 1, String(a.counts.notices));

    r = await boss('GET', '/announcements');
    await boss('POST', `/announcements/${r.d.announcements[0].id}/read`);
    a = await counts(boss);
    ok('reading it clears it', a.counts.notices === 0, String(a.counts.notices));

    // ---- The total -------------------------------------------------------------
    head('The one number the menu button carries:');
    a = await counts(boss);
    const sum = Object.values(a.counts).reduce((x, y) => x + y, 0);
    ok('is the sum of the rest, so the dot cannot disagree with the rail',
      a.total === sum, `${a.total} vs ${sum}`);
    ok('and it is not zero, since there is still a queue', a.total > 0, JSON.stringify(a.counts));

    // ---- Signed out --------------------------------------------------------------
    ok('none of this is readable signed out', (await anon('GET', '/attention')).s === 401);
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nThe rail says where something is waiting, and never where it is not.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})();
