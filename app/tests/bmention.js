// @ as two things, and the difference holding.
//
// An address reaches somebody. A mention refers to a record and reaches
// nobody. If those ever became indistinguishable, an assistant would write
// "@tunde will confirm" believing Tunde had been asked.
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
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: '' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const deadline = Date.now() + 20000;
  for (;;) {
    try { const r = await (await fetch(`${BASE}/api/status`)).json(); if (r.databaseReady) break; }
    catch { if (Date.now() > deadline) throw new Error('no server'); await new Promise((r) => setTimeout(r, 200)); }
  }

  const mentions = require(`${ROOT}/app/server/lib/mentions`);

  try {
    // --- Parsing, which must not be greedy ------------------------------
    head('Reading @ out of a sentence:');
    ok('a plain handle is found', JSON.stringify(mentions.parse('ask @ada')) === '["ada"]');
    ok('punctuation ends it', JSON.stringify(mentions.parse('(@ada), then @kit-staff.'))
      === '["ada","kit-staff"]');
    ok('the same one twice is one', JSON.stringify(mentions.parse('@ada and @ada')) === '["ada"]');
    // People write "email me @ 9". That must not become anything.
    ok('a bare @ is not a handle', JSON.stringify(mentions.parse('email me @ 9')) === '[]');
    ok('an address is not mistaken for one',
      JSON.stringify(mentions.parse('write to ada@example.com')) === '[]',
      JSON.stringify(mentions.parse('write to ada@example.com')));

    // --- The cast --------------------------------------------------------
    const boss = client();
    await boss('POST', '/auth/signup', { name: 'Adaeze Okonkwo', email: `boss${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const me = (await boss('GET', '/auth/me')).d.user;
    await boss('PATCH', '/profile', { slug: `adaeze-${ID}` });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const inv = await boss('POST', '/members', { email: `pa${ID}@x.com`, role: 'chief_of_staff' });
    const pa = client();
    await pa('POST', '/auth/signup', { name: 'Kit Staff', email: `pa${ID}@x.com`, password: PW, accountCategory: 'chief_of_staff' });
    await pa('PATCH', '/profile', { slug: `kit-${ID}` });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`, {});

    // A contact with no account at all, and one who happens to have one.
    await pa('POST', `/pa/${me.id}/contacts`, { name: 'Tunde Bakare', email: `tunde${ID}@x.com` });
    const stranger = client();
    await stranger('POST', '/auth/signup', { name: 'Ngozi Okafor', email: `ngozi${ID}@x.com`, password: PW });
    await stranger('PATCH', '/profile', { slug: `ngozi-${ID}` });
    await pa('POST', `/pa/${me.id}/contacts`, { name: 'Ngozi Okafor', email: `ngozi${ID}@x.com` });

    // --- A contact gets a handle ----------------------------------------
    head('A contact is nameable:');
    let r = await pa('GET', `/pa/${me.id}/contacts`);
    const tunde = r.d.contacts.find((c) => /Tunde/.test(c.name));
    ok('one is derived from their name', tunde.handle === 'tunde-bakare', String(tunde.handle));

    // --- What the picker offers ------------------------------------------
    head('What the picker offers:');
    r = await pa('GET', `/mentions/${me.id}/lookup?q=`);
    ok('the principal is somebody the assistant can address',
      r.d.people.some((p) => p.handle === `adaeze-${ID}`), JSON.stringify(r.d.people));
    ok('and people are marked as being told', r.d.people.every((p) => p.notified === true));
    ok('contacts are offered too', r.d.contacts.some((c) => c.handle === 'tunde-bakare'));
    ok('and marked as reaching nobody', r.d.contacts.every((c) => c.notified === false));
    const ngozi = r.d.contacts.find((c) => /Ngozi/.test(c.name));
    ok('a contact who is not connected can be invited', ngozi.canInvite === true);

    // A stranger with an account is not addressable just for existing.
    r = await pa('GET', `/mentions/${me.id}/lookup?q=ngozi`);
    ok('and is not in the people list merely for having an account',
      !r.d.people.some((p) => /ngozi/.test(p.handle)), JSON.stringify(r.d.people));

    // --- Resolving --------------------------------------------------------
    head('What each @ turns out to be:');
    const paMe = (await pa('GET', '/auth/me')).d.user;
    const resolved = await mentions.of(
      `@adaeze-${ID} please note @tunde-bakare is bringing papers, and @nobody-here is nothing`,
      { viewerId: paMe.id, ownerId: me.id },
    );
    const byKind = Object.fromEntries(resolved.map((m) => [m.handle, m]));
    ok('a connected person is an address', byKind[`adaeze-${ID}`].kind === 'person');
    ok('and is notified', byKind[`adaeze-${ID}`].notified === true);
    ok('a contact is a mention', byKind['tunde-bakare'].kind === 'contact');
    ok('and is explicitly not notified', byKind['tunde-bakare'].notified === false);
    ok('and it carries the name, so the screen need not look it up',
      byKind['tunde-bakare'].name === 'Tunde Bakare', byKind['tunde-bakare'].name);
    ok('a handle belonging to nobody stays nothing', byKind['nobody-here'].kind === 'unknown');

    // --- Contacts belong to an office ------------------------------------
    head('A contact belongs to one office:');
    const outsider = client();
    await outsider('POST', '/auth/signup', { name: 'Someone Else', email: `else${ID}@x.com`, password: PW });
    const outsiderMe = (await outsider('GET', '/auth/me')).d.user;
    const leaked = await mentions.of('@tunde-bakare', { viewerId: outsiderMe.id, ownerId: outsiderMe.id });
    ok('somebody else\'s contact does not resolve for them', leaked[0].kind === 'unknown');
    const denied = await outsider('GET', `/mentions/${me.id}/lookup?q=`);
    ok('and they cannot read the list at all', denied.s === 403, String(denied.s));

    // --- Invite to connect ------------------------------------------------
    head('Inviting a contact to connect:');
    r = await pa('POST', `/mentions/${me.id}/contacts/${ngozi.contactId || ngozi.id}/invite`, {
      note: 'So I can reach you about the board dinner.',
    });
    ok('it is accepted', r.s === 202, JSON.stringify(r.d));
    ok('and says who it went to', /Ngozi/.test(r.d.message || ''), r.d.message);

    r = await stranger('GET', '/connections');
    const incoming = (r.d.incoming || r.d.pending || []).length > 0
      || JSON.stringify(r.d).includes('Kit Staff');
    ok('the person with an account sees a request', incoming, JSON.stringify(r.d).slice(0, 200));

    // The one that matters: a contact with no account gets the same answer.
    r = await pa('POST', `/mentions/${me.id}/contacts/${tunde.id}/invite`, {});
    ok('a contact with no account is answered identically', r.s === 202, JSON.stringify(r.d));
    ok('so nothing is revealed about who is on Kairos',
      /Tunde/.test(r.d.message || ''), r.d.message);
    r = await boss('GET', '/emails');
    ok('and they are emailed an invitation instead',
      (r.d.emails || []).some((e) => /connect on Kairos/i.test(e.subject || '')));

    // --- Once connected, a contact becomes addressable --------------------
    head('Once they accept:');
    r = await stranger('GET', '/connections');
    const conn = JSON.parse(JSON.stringify(r.d));
    const pendingId = (conn.incoming || conn.pending || conn.connections || [])
      .map((c) => c.id).find(Boolean);
    if (pendingId) {
      await stranger('POST', `/connections/${pendingId}/accept`);
      const after = await pa('GET', `/mentions/${me.id}/lookup?q=ngozi`);
      ok('they move into the people the assistant can address',
        after.d.people.some((p) => /ngozi/.test(p.handle)), JSON.stringify(after.d.people));
      ok('and are no longer offered as somebody to invite',
        !(after.d.contacts.find((c) => /Ngozi/.test(c.name))?.canInvite), JSON.stringify(after.d.contacts));
    } else {
      ok('a pending connection was found to accept', false, JSON.stringify(conn).slice(0, 200));
    }
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\n@ addresses people who can answer, and names the rest without pretending.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
