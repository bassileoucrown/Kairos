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
  // Two and a half minutes. Twenty seconds was plenty on an idle machine and
  // not plenty on a loaded one; a minute went the same way, twice in one day,
  // on a box where a hundred suites run back to back and each one starts a
  // server and half of them start a browser. "No server" on a green tree is a
  // board crying wolf, and it costs an hour of hunting a product bug that was
  // never there.
  //
  // Waiting longer is free when the tree is green — the loop exits the instant
  // the server answers — and is only paid when something is genuinely broken,
  // which is the right way round for this trade.
  const deadline = Date.now() + 150000;
  for (;;) {
    try { const r = await (await fetch(`${BASE}/api/status`)).json(); if (r.databaseReady) break; } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('no server');
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    // --- Nobody is handed one --------------------------------------------
    //
    // Signup USED to derive a handle from the name and this suite asserted it
    // did. That was the defect rather than the feature: handle_history keeps a
    // handle for good, so a name nobody had chosen was spent permanently on
    // their behalf and burnt for everybody the moment they picked another one.
    head('An account is handed no handle at all:');
    const boss = client();
    await boss('POST', '/auth/signup', {
      name: `Adaeze Okonkwo ${ID}`, email: `boss${ID}@x.com`, password: PW, accountCategory: 'principal',
    });
    let me = (await boss('GET', '/auth/me')).d.user;
    ok('it carries something, because the column cannot be empty',
      !!me.slug && me.slug.length >= 3, String(me.slug));
    ok('but nothing made out of their name', !/adaeze|okonkwo/i.test(me.slug), me.slug);
    ok('and it says plainly that nothing has been chosen',
      me.handleChosen === false, String(me.handleChosen));

    // The first one they actually choose. Everything below is about what a
    // handle costs to change once it is REALLY theirs, so it has to be one
    // that went through claimHandle and into the history.
    await boss('PATCH', '/profile', { slug: `first-${ID}` });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    me = (await boss('GET', '/auth/me')).d.user;
    ok('choosing one makes it theirs', me.slug === `first-${ID}` && me.handleChosen === true,
      `${me.slug} ${me.handleChosen}`);
    const derived = me.slug;

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
    await other('PATCH', '/profile', { slug: `ngozi-${ID}` });
    const theirs = (await other('GET', '/auth/me')).d.user.slug;
    ok('the other account has chosen a handle of its own', theirs === `ngozi-${ID}`, theirs);

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

    // --- What a rename must NOT cost ---------------------------------------
    //
    // Handles live as TEXT inside the things people write, and are resolved
    // when the page is drawn. So without a memory of who held what, changing
    // your handle quietly emptied every @you already written: the sentences
    // survived and the person in them went inert. Three separate ways of
    // asking, because each is a different road to the same fact.
    head('Changing your name does not empty what was already said:');
    const oldOne = derived;
    const stillWorks = await mentions.of(`@${oldOne}`, { viewerId: me.id, ownerId: me.id });
    ok('an @ written before the change still finds the person',
      stillWorks[0]?.kind === 'person' && stillWorks[0]?.id === me.id,
      JSON.stringify(stillWorks[0]));
    ok('and finds them under the name they go by now',
      stillWorks[0]?.name === me.name, JSON.stringify(stillWorks[0]?.name));
    // Written as it was typed. Rewriting the body would be editing what
    // somebody wrote — including records that are frozen on purpose.
    ok('without the words on the page having been touched',
      stillWorks[0]?.handle === oldOne, stillWorks[0]?.handle);

    // THE ONE THAT MATTERS MORE. A released handle that anybody could claim
    // would hand the claimant every mention of the person who used to have it.
    head('And nobody else can pick up the name you put down:');
    const squatter = client();
    await squatter('POST', '/auth/signup',
      { name: 'Someone Else', email: `squat${ID}@x.com`, password: PW });
    await squatter('PATCH', '/profile', { slug: `h${ID}-2` });
    await squatter('POST', '/profile/onboarding-step', { step: 'done' });
    r = await squatter('PATCH', '/profile', { slug: oldOne });
    ok('a handle somebody has ever held is refused to everyone else',
      r.s === 409, `${r.s} ${JSON.stringify(r.d)}`);
    // Said the same way as "somebody has it now". Which of the two it is would
    // be a fact about a stranger's account, and this app does not confirm those.
    ok('in the same words as one still in use',
      /taken/i.test(r.d?.error || ''), r.d?.error);
    r = await boss('PATCH', '/profile', { slug: oldOne });
    ok('but you can always take your own name back', r.s === 200, String(r.s));
    r = await boss('PATCH', '/profile', { slug: `ada-two-${ID}` });
    ok('and go back again', r.s === 200, String(r.s));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nEverybody chooses their own handle, and it stays theirs once they have.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
