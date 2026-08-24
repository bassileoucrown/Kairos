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
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const deadline = Date.now() + 20000;
  for (;;) {
    try { const r = await (await fetch(`${BASE}/api/status`)).json(); if (r.databaseReady) break; } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('no server');
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
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nYou can name who you work with, and only they can let you in.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
