// Bringing somebody into a room from inside the sentence about them.
//
// THE MISSING RUNG. Everything needed already existed — the colleague holds an
// account, you work together, the room takes members — and the only way to add
// them was to leave the thread, find the members screen, and come back. So it
// did not happen, and the message went to somebody who could not read it. The
// @ picker inside a thread offered only people already in the room, so a name
// you could see in your head was not in the list and there was no hint why.
//
// WHAT THIS IS NOT. Naming somebody does not add them. A room holds everything
// said in it before you arrived, so adding a person discloses a history, and
// that is not a side effect to attach to typing a name. It is offered, it says
// what it will do, and it waits to be asked.
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

async function join(boss, inviteLink, who, email, slug, category) {
  const c = client();
  await c('POST', '/auth/signup', { name: who, email, password: PW, accountCategory: category });
  const me = (await c('GET', '/auth/me')).d.user;
  await c('PATCH', '/profile', { slug, timezone: 'UTC' });
  await c('POST', '/profile/onboarding-step', { step: 'done' });
  await c('POST', `/invites/${inviteLink.split('/').pop()}/accept`, {});
  return { c, me };
}

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL || '',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  // A minute. Twenty seconds is plenty on an idle machine and not plenty on a
  // loaded one, and "no server" on a green tree is a board crying wolf.
  const deadline = Date.now() + 60000;
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

    // Two assistants, so there is somebody to bring in who is not already here.
    const i1 = await boss('POST', '/members', { email: `kit${ID}@x.com`, role: 'chief_of_staff' });
    const kit = await join(boss, i1.d.inviteLink, 'Kit Staff', `kit${ID}@x.com`, `kit-${ID}`, 'chief_of_staff');
    const i2 = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    const ngozi = await join(boss, i2.d.inviteLink, 'Ngozi Bello', `ngozi${ID}@x.com`, `ngozi-${ID}`, 'pa');

    // --- The team's general room already exists ------------------------------
    head('The team has a room without anybody making one:');
    let r = await boss('GET', `/today/${me.id}`);
    ok('the direct line is there', !!r.d.directLine, JSON.stringify(r.d.directLine || null));
    r = await kit.c('GET', `/today/${me.id}`);
    ok('and the assistants are in it', !!r.d.directLine, JSON.stringify(r.d.directLine || null));
    // Its membership mirrors the team, so it is not the room to hand-manage.
    const directSpaceId = r.d.directLine.spaceId;
    r = await boss('POST', `/spaces/${directSpaceId}/members`, { handle: `ngozi-${ID}` });
    ok('and it refuses hand-added members, since it mirrors the team',
      r.s === 400, String(r.s));
    ok('saying where to do it instead', /Team/.test(r.d?.error || ''), r.d?.error);

    // --- Anybody can make another one ---------------------------------------
    head('Anybody can make a room, not only the principal:');
    r = await kit.c('POST', '/spaces', { name: 'The Lagos move', context: 'work' });
    ok('an assistant can create one', r.s === 201, JSON.stringify(r.d).slice(0, 160));
    const space = r.d.space;
    r = await kit.c('POST', `/spaces/${space.id}/threads`, { name: 'Shipping' });
    ok('and a room inside it', r.s === 201, JSON.stringify(r.d).slice(0, 160));
    const thread = r.d.thread;

    // --- The gap this fixes --------------------------------------------------
    head('Somebody you work with, not in the room, is offered:');
    r = await kit.c('GET', `/mentions/space/${space.id}/lookup?q=`);
    ok('they are in their own group, apart from the room',
      (r.d.nearby || []).some((p) => p.name === 'Ngozi Bello'),
      JSON.stringify(r.d.nearby || []));
    ok('and not mixed in with the people who are in it',
      !(r.d.people || []).some((p) => p.name === 'Ngozi Bello'),
      JSON.stringify(r.d.people || []));
    ok('with the id needed to act on them',
      (r.d.nearby || []).every((p) => !!p.id), JSON.stringify(r.d.nearby));
    ok('and the reader is told they may add somebody', r.d.canAddMembers === true,
      String(r.d.canAddMembers));

    head('Naming them does NOT add them — that is the whole distinction:');
    r = await kit.c('POST', `/threads/${thread.id}/messages`, {
      body: `@ngozi-${ID} can you take the shipping quotes?`,
    });
    ok('the message posts', r.s === 201, JSON.stringify(r.d).slice(0, 160));
    // Mentions are resolved when a thread is READ, not echoed by the post —
    // posting answers with the new id and any stage it moved.
    r = await kit.c('GET', `/threads/${thread.id}/messages`);
    const posted = (r.d.messages || []).find((m) => /shipping quotes/.test(m.body));
    const named = (posted?.mentions || []).find((m) => /ngozi/.test(m.handle));
    ok('they are named', !!named, JSON.stringify(posted?.mentions));
    // The failure this guards: writing "@ngozi will confirm", believing she
    // was asked, and finding out at the airport that she was not.
    ok('but marked as not reached', named?.notified === false, JSON.stringify(named));
    ok('and the reason is said, not left to be discovered',
      named?.reason === 'no-access', named?.reason);
    r = await ngozi.c('GET', `/threads/${thread.id}/messages`);
    ok('and they still cannot read the room', r.s === 404, String(r.s));

    // --- One tap ------------------------------------------------------------
    head('Adding them is one deliberate act:');
    r = await kit.c('POST', `/spaces/${space.id}/members`, { handle: `ngozi-${ID}` });
    ok('they are added by handle, from where the sentence was written',
      r.s === 201, JSON.stringify(r.d).slice(0, 160));
    r = await ngozi.c('GET', `/threads/${thread.id}/messages`);
    ok('now they can read the room', r.s === 200, String(r.s));
    // Said plainly in the UI before the click: a room holds what was said
    // before you arrived, and that is the reason adding is not automatic.
    ok('including what was said before they arrived',
      (r.d.messages || []).some((m) => /shipping quotes/.test(m.body)),
      JSON.stringify((r.d.messages || []).map((m) => m.body)).slice(0, 200));

    r = await kit.c('GET', `/mentions/space/${space.id}/lookup?q=`);
    ok('and they move into the room\'s own group',
      (r.d.people || []).some((p) => p.name === 'Ngozi Bello')
      && !(r.d.nearby || []).some((p) => p.name === 'Ngozi Bello'),
      JSON.stringify({ people: r.d.people, nearby: r.d.nearby }));

    await kit.c('POST', `/threads/${thread.id}/messages`, { body: `@ngozi-${ID} thank you.` });
    r = await kit.c('GET', `/threads/${thread.id}/messages`);
    const thanks = (r.d.messages || []).find((m) => /thank you/.test(m.body));
    const now = (thanks?.mentions || []).find((m) => /ngozi/.test(m.handle));
    ok('and naming them now actually reaches them', now?.notified === true, JSON.stringify(now));

    // --- Who may not --------------------------------------------------------
    head('And not everybody may open a room to somebody new:');
    const outsider = client();
    await outsider('POST', '/auth/signup', { name: 'Someone Else', email: `else${ID}@x.com`, password: PW });
    await outsider('PATCH', '/profile', { slug: `else-${ID}` });
    r = await outsider('GET', `/mentions/space/${space.id}/lookup?q=`);
    ok('a stranger cannot even see who is in it', r.s === 404, String(r.s));
    r = await outsider('POST', `/spaces/${space.id}/members`, { handle: `ngozi-${ID}` });
    ok('nor add anybody to it', r.s === 404, String(r.s));
    // A member without the delegate bit reads the room but does not staff it.
    r = await ngozi.c('GET', `/mentions/space/${space.id}/lookup?q=`);
    ok('and an ordinary member is offered no add button',
      r.d.canAddMembers === false, String(r.d.canAddMembers));

    head('A private space stays a set of one:');
    r = await boss('POST', '/spaces', { name: 'Mine', context: 'private' });
    const priv = r.d.space;
    r = await boss('GET', `/mentions/space/${priv.id}/lookup?q=`);
    ok('nobody may be added to it, whatever the picker offers',
      r.d.canAddMembers === false, String(r.d.canAddMembers));
    r = await boss('POST', `/spaces/${priv.id}/members`, { handle: `kit-${ID}` });
    ok('and the route refuses outright', r.s === 400, String(r.s));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA colleague can be brought into a room from the sentence about them, and naming somebody still never adds them by accident.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
