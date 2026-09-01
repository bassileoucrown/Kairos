// Naming the person you work with, by their handle.
//
// The same screen means two different things depending on who is looking at
// it: a principal appointing an assistant, and an assistant asking to be taken
// on. The second is the one that has to be got right — an assistant must not
// be able to attach themselves to somebody else's account by typing a handle.
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
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  // KEEP THE CHILD'S LAST WORDS. This suite has failed "no server" twice —
  // 27 Aug and 1 Sep — and both times the message was the whole of the
  // evidence, because the server's stderr was being thrown away. A suite that
  // cannot say why its server did not start hands you a hundred and fifty
  // seconds of silence and a guess, and the guess costs more than the bug.
  //
  // Two things are captured. The stderr, so a crash on boot arrives with its
  // stack. And the exit, so a server that dies at once — a port already taken,
  // a schema that will not apply — is reported the instant it happens instead
  // of after the full timeout, which is also how you tell those two apart: a
  // child that exited was broken, a child still running when the clock ran out
  // was slow.
  let boot = '';
  proc.stderr.on('data', (d) => { boot = (boot + d).slice(-4000); });
  let died = null;
  proc.on('exit', (code, signal) => { died = signal ? `signal ${signal}` : `exit ${code}`; });
  const why = () => `${died ? `server ${died}` : 'server still running, never answered'}` +
    `${boot.trim() ? `\n--- server stderr ---\n${boot.trim()}` : '\n--- server printed nothing to stderr ---'}`;

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
    if (died) throw new Error(`no server — ${why()}`);
    if (Date.now() > deadline) throw new Error(`no server — ${why()}`);
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    // --- The cast ---------------------------------------------------------
    const boss = client();
    await boss('POST', '/auth/signup', { name: 'Adaeze Okonkwo', email: `boss${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await boss('PATCH', '/profile', { slug: `adaeze-${ID}` });

    const pa = client();
    await pa('POST', '/auth/signup', { name: 'Kit Staff', email: `pa${ID}@x.com`, password: PW, accountCategory: 'chief_of_staff' });
    await pa('PATCH', '/profile', { slug: `kit-${ID}` });

    // --- The step exists in the flow --------------------------------------
    head('Onboarding stops to ask who you work with:');
    let r = await pa('POST', '/profile/onboarding-step', { step: 'connect' });
    ok('the step is a real one the server accepts', r.s === 200, String(r.s));
    ok('and is where the account now sits', r.d.user.onboardingStep === 'connect', r.d.user.onboardingStep);

    // --- An assistant asks ------------------------------------------------
    head('An assistant naming their principal is ASKING, not appointing:');
    r = await pa('POST', '/members/connect', { handle: `@adaeze-${ID}` });
    ok('the ask is accepted', r.s === 202, JSON.stringify(r.d));
    ok('and answered without confirming the handle exists',
      /will see it/i.test(r.d.message || ''), r.d.message);

    // The assertion this suite exists for.
    r = await pa('GET', `/pa/${(await boss('GET', '/auth/me')).d.user.id}/contacts`);
    ok('asking grants NOTHING until it is approved', r.s === 403, String(r.s));

    r = await boss('GET', '/members');
    const asking = (r.d.members || []).find((m) => m.status === 'requested');
    ok('the principal sees it waiting', !!asking, JSON.stringify(r.d.members));
    ok('under the title they claimed', asking?.roleLabel === 'Chief of Staff', asking?.roleLabel);
    r = await boss('GET', '/emails');
    ok('and is emailed about it', (r.d.emails || [])
      .some((e) => /would like to work with you/i.test(e.subject || '')));

    // --- Approval is what grants ------------------------------------------
    head('Approval is the moment access happens:');
    const bossId = (await boss('GET', '/auth/me')).d.user.id;
    r = await boss('POST', `/members/${asking.id}/approve`);
    ok('the principal can approve', r.s === 200, JSON.stringify(r.d));
    r = await pa('GET', `/pa/${bossId}/contacts`);
    ok('and only then does the assistant get in', r.s === 200, String(r.s));

    // --- A principal appoints ---------------------------------------------
    head('A principal naming an assistant is appointing them:');
    const other = client();
    await other('POST', '/auth/signup', { name: 'Ngozi Okafor', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await other('PATCH', '/profile', { slug: `ngozi-${ID}` });

    r = await boss('POST', '/members/connect', { handle: `ngozi-${ID}`, role: 'ea' });
    ok('the invitation is accepted', r.s === 202, JSON.stringify(r.d));
    r = await boss('GET', '/members');
    const invited = (r.d.members || []).find((m) => /ngozi/.test(m.invitedEmail));
    ok('it goes out as an invitation, not a request',
      invited?.status === 'invited', invited?.status);
    ok('under the title the principal chose', invited?.role === 'ea', invited?.role);
    r = await boss('GET', '/emails');
    ok('and they are emailed a link to accept',
      (r.d.emails || []).some((e) => /invited you to/i.test(e.subject || '')));

    // --- Nothing is confirmed about who exists ----------------------------
    head('A handle that belongs to nobody is answered the same way:');
    r = await boss('POST', '/members/connect', { handle: `nobody-at-all-${ID}` });
    ok('accepted', r.s === 202, JSON.stringify(r.d));
    ok('with the same sentence', /will see it/i.test(r.d.message || ''), r.d.message);
    r = await boss('GET', '/members');
    ok('and no phantom member is created',
      !(r.d.members || []).some((m) => /nobody-at-all/.test(m.invitedEmail || '')));

    // --- Guards -----------------------------------------------------------
    head('The obvious mistakes:');
    r = await boss('POST', '/members/connect', { handle: `adaeze-${ID}` });
    ok('your own handle is refused, and said plainly', r.s === 400, String(r.s));
    r = await pa('POST', '/members/connect', { handle: `adaeze-${ID}` });
    ok('asking again when you already work together says so', r.s === 409, String(r.s));

    // A declined request must not become a permanent bar — people move jobs.
    head('Declining:');
    const third = client();
    await third('POST', '/auth/signup', { name: 'Chidi Eze', email: `chidi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await third('PATCH', '/profile', { slug: `chidi-${ID}` });
    await third('POST', '/members/connect', { handle: `adaeze-${ID}` });
    r = await boss('GET', '/members');
    const chidi = (r.d.members || []).find((m) => /chidi/.test(m.invitedEmail) && m.status === 'requested');
    ok('the request is waiting', !!chidi, JSON.stringify(r.d.members));
    r = await boss('POST', `/members/${chidi.id}/decline`);
    ok('it can be declined', r.s === 200, JSON.stringify(r.d));
    r = await boss('GET', '/members');
    ok('and stops being listed', !(r.d.members || []).some((m) => m.id === chidi.id));
    r = await pa('GET', `/pa/${bossId}/contacts`);
    ok('the approved assistant is unaffected by somebody else being declined', r.s === 200);
    r = await third('POST', '/members/connect', { handle: `adaeze-${ID}` });
    ok('and a decline is not a life sentence — they may ask again', r.s === 202, String(r.s));

    // --- A meeting type is not compulsory ---------------------------------
    head('Finishing without a meeting type:');
    r = await boss('POST', '/profile/onboarding-step', { step: 'done' });
    ok('setup can be completed without creating one', r.s === 200, String(r.s));
    ok('and the account is done', r.d.user.onboardingStep === 'done', r.d.user.onboardingStep);
    r = await client()('GET', `/public/adaeze-${ID}`);
    ok('the booking page still loads', r.s === 200, String(r.s));
    ok('and says plainly that there is nothing to book',
      (r.d.meetingTypes || []).length === 0, JSON.stringify(r.d.meetingTypes));
    // --- Who is behind a handle ----------------------------------------------
    head('An exact handle says who it belongs to:');
    // WHY THIS IS A DELIBERATE REVERSAL of the neutral answer a request gives.
    // Carried into lookup, neutrality made connections pointless: you typed a
    // colleague's handle, got a shrug, and could not tell a typo from somebody
    // who simply is not here. Nobody builds a network they cannot see the edge
    // of. See routes/connections.js for the three things that keep the trade
    // defensible.
    const ngoziHandle = (await other('GET', '/auth/me')).d.user.slug;
    r = await boss('GET', `/connections/lookup?handle=${ngoziHandle}`);
    ok('a real handle resolves to a name', r.d.found === true && !!r.d.name,
      JSON.stringify(r.d));
    // What comes back is enough to answer "is this the right person" and
    // nothing that would make the endpoint worth harvesting for itself.
    ok('and nothing beyond a name and a handle',
      !r.d.email && !r.d.id, JSON.stringify(r.d));

    ok('a handle nobody holds resolves to nothing',
      (await boss('GET', '/connections/lookup?handle=nobody-at-all-here')).d.found === false);
    // Every negative answers identically, so the shape of the refusal does not
    // become the fact the refusal was hiding.
    ok('and so does a malformed one',
      (await boss('GET', '/connections/lookup?handle=..')).d.found === false);

    // --- And it can be turned off ---------------------------------------------
    head('Unless the person would rather not be found:');
    // THE DEFAULT IS ONLY HONEST IF IT CAN BE CHANGED. A default that cannot be
    // turned off is a policy dressed as a default.
    ok('discoverable is on to begin with',
      (await other('GET', '/auth/me')).d.user.discoverable === true);
    ok('and can be turned off',
      (await other('PATCH', '/profile', { discoverable: false })).s === 200);
    // THE ASSERTION THIS SECTION EXISTS FOR: opting out answers exactly as a
    // stranger does, so the choice is real rather than cosmetic.
    ok('after which they answer exactly as a stranger does',
      (await boss('GET', `/connections/lookup?handle=${ngoziHandle}`)).d.found === false);
    // POSITIVE CONTROL: turning it back on restores them, so the false above
    // was the setting and not a lookup that had simply stopped working.
    await other('PATCH', '/profile', { discoverable: true });
    ok('and turning it back on restores them',
      (await boss('GET', `/connections/lookup?handle=${ngoziHandle}`)).d.found === true);

  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nYou can name who you work with, and only they can let you in.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
