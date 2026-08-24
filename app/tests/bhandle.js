// Your handle after setup is over.
//
// Two claims worth proving. Everybody already HAS one — it is derived at
// signup, so no account has ever been without a name for @ to resolve. And it
// can be changed afterwards, which until now it could not: the onboarding step
// that asks is behind a guard that closes when setup finishes, so a handle
// derived from a full legal name was permanent by accident.
//
// The third thing proved here is the consequence, because it is the part a
// person needs warning about: the handle is also the booking address, so
// changing it breaks every link anybody is holding.
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

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
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
    // --- Everybody already has one ---------------------------------------
    head('An account has a handle before anybody chooses one:');
    const boss = client();
    await boss('POST', '/auth/signup', {
      name: `Adaeze Okonkwo ${ID}`, email: `boss${ID}@x.com`, password: PW, accountCategory: 'principal',
    });
    let me = (await boss('GET', '/auth/me')).d.user;
    ok('signup derives one from the name', !!me.slug && me.slug.length >= 3, String(me.slug));
    ok('and it looks like the person, not like a number',
      /adaeze-okonkwo/.test(me.slug), me.slug);
    const derived = me.slug;

    // The point of the whole feature: this account never went near the
    // onboarding step, and @ still resolves for it.
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    // --- Changing it afterwards -------------------------------------------
    head('And it can be changed once setup is behind you:');
    let r = await boss('PATCH', '/profile', { slug: `ada-${ID}` });
    ok('the change is accepted', r.s === 200, JSON.stringify(r.d).slice(0, 160));
    me = (await boss('GET', '/auth/me')).d.user;
    ok('and it is the new one that sticks', me.slug === `ada-${ID}`, me.slug);

    // Typed the way people actually type it.
    r = await boss('PATCH', '/profile', { slug: `  @ADA-two-${ID}  ` });
    ok('an @ and stray capitals are taken in stride', r.s === 200, JSON.stringify(r.d).slice(0, 120));
    me = (await boss('GET', '/auth/me')).d.user;
    ok('and stored plainly', me.slug === `ada-two-${ID}`, me.slug);

    // --- The consequence --------------------------------------------------
    head('The old address stops working, which is why the screen warns:');
    const anon = client();
    r = await anon('GET', `/public/${derived}`);
    ok('the handle it was signed up with is gone', r.s === 404, String(r.s));
    r = await anon('GET', `/public/${me.slug}`);
    ok('and the booking page has moved to the new one', r.s === 200, String(r.s));

    // --- What is refused --------------------------------------------------
    head('What is refused:');
    const other = client();
    await other('POST', '/auth/signup', { name: 'Ngozi Okafor', email: `ngozi${ID}@x.com`, password: PW });
    const theirs = (await other('GET', '/auth/me')).d.user.slug;

    r = await boss('PATCH', '/profile', { slug: theirs });
    ok('somebody else\'s handle', r.s === 409, String(r.s));
    ok('and it says so plainly, since they can see the handle exists',
      /taken/i.test(r.d?.error || ''), r.d?.error);
    r = await boss('PATCH', '/profile', { slug: 'admin' });
    ok('a reserved name', r.s === 400, String(r.s));
    r = await boss('PATCH', '/profile', { slug: 'ab' });
    ok('too short', r.s === 400, String(r.s));
    r = await boss('PATCH', '/profile', { slug: 'not a handle!' });
    ok('spaces and punctuation', r.s === 400, String(r.s));

    // A refused change must leave the old one working, not half-apply.
    me = (await boss('GET', '/auth/me')).d.user;
    ok('and none of that disturbed the handle they have',
      me.slug === `ada-two-${ID}`, me.slug);
    r = await anon('GET', `/public/${me.slug}`);
    ok('which still answers', r.s === 200, String(r.s));

    // --- It is the same name @ resolves ------------------------------------
    head('It is one name, not two:');
    const mentions = require(`${ROOT}/app/server/lib/mentions`);
    const seen = await mentions.of(`@${me.slug}`, { viewerId: me.id, ownerId: me.id });
    ok('the handle on the settings screen is the one @ finds',
      seen[0]?.kind === 'person' && seen[0]?.id === me.id, JSON.stringify(seen[0]));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nEverybody has a handle from the start, and can still change it later.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
