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
    // Whatever backend this process is pointed at, the server must be pointed
    // at the same one. Some assertions here call lib/mentions directly, which
    // opens its own connection from THIS process — pinning the child to sqlite
    // while the parent held a Postgres URL gave the two of them different
    // databases, and the direct calls failed against fixtures they could not
    // see. That looked like a Postgres bug and was a split brain.
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL || '',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  // A minute. Twenty seconds is plenty on an idle machine and not plenty on a
  // loaded one, and "no server" on a green tree is a board crying wolf.
  const deadline = Date.now() + 60000;
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

    // On Kairos, in the address book, and connected to nobody — so their
    // username exists and naming them still reaches no one. Ngozi accepts a
    // connection later in this suite and stops being that case.
    const femi = client();
    await femi('POST', '/auth/signup', { name: 'Femi Adeyemi', email: `femi${ID}@x.com`, password: PW });
    await femi('PATCH', '/profile', { slug: `femi-${ID}` });
    await pa('POST', `/pa/${me.id}/contacts`, { name: 'Femi Adeyemi', email: `femi${ID}@x.com` });

    // --- Whose username is it? -------------------------------------------
    //
    // The rule this section exists for: a username is made by the person who
    // holds the account. An office writing somebody into its address book does
    // not get to name them.
    head('A contact shows the username its owner chose, or none:');
    let r = await pa('GET', `/pa/${me.id}/contacts`);
    const tunde = r.d.contacts.find((c) => /Tunde/.test(c.name));
    const ngoziContact = r.d.contacts.find((c) => /Ngozi/.test(c.name));
    ok('a contact who is on Kairos shows THEIR username',
      ngoziContact.handle === `ngozi-${ID}`, String(ngoziContact.handle));
    ok('a contact who is not on Kairos has none, and none is invented',
      tunde.handle === null, String(tunde.handle));

    // The username, and nothing else about the account it came from.
    //
    // Pinned as a whole-payload check rather than a list of absences, so a
    // field added later — an account id, a category, a timezone — fails here
    // instead of quietly turning a name into a way into somebody's account.
    ok('a contact carries the username and no other trace of the account',
      Object.keys(ngoziContact).sort().join(',')
        === ['anniversary', 'birthday', 'email', 'handle', 'id', 'lastMeetingAt',
          'meetingCount', 'name', 'notes', 'relationshipTier'].join(','),
      Object.keys(ngoziContact).sort().join(','));
    ok('and its id is the contact record, not the account',
      ngoziContact.id !== (await stranger('GET', '/auth/me')).d.user.id);

    // And it follows the account, because it belongs to the account.
    await stranger('PATCH', '/profile', { slug: `ngozi-renamed-${ID}` });
    r = await pa('GET', `/pa/${me.id}/contacts`);
    ok('and when they rename themselves, the contact says the new one',
      r.d.contacts.find((c) => /Ngozi/.test(c.name)).handle === `ngozi-renamed-${ID}`,
      String(r.d.contacts.find((c) => /Ngozi/.test(c.name)).handle));
    await stranger('PATCH', '/profile', { slug: `ngozi-${ID}` });

    // --- What the picker offers ------------------------------------------
    head('What the picker offers:');
    r = await pa('GET', `/mentions/${me.id}/lookup?q=`);
    ok('the principal is somebody the assistant can address',
      r.d.people.some((p) => p.handle === `adaeze-${ID}`), JSON.stringify(r.d.people));
    ok('and people are marked as being told', r.d.people.every((p) => p.notified === true));
    ok('a contact with an account is offered, by their own username',
      r.d.contacts.some((c) => c.handle === `ngozi-${ID}`), JSON.stringify(r.d.contacts));
    ok('and marked as reaching nobody', r.d.contacts.every((c) => c.notified === false));
    ok('a contact with no account is not offered at all, having no username',
      !r.d.contacts.some((c) => /Tunde/.test(c.name)), JSON.stringify(r.d.contacts));
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
      `@adaeze-${ID} please note @ngozi-${ID} is bringing papers, `
      + 'and @tunde-bakare is nothing at all',
      { viewerId: paMe.id, ownerId: me.id },
    );
    const byKind = Object.fromEntries(resolved.map((m) => [m.handle, m]));
    ok('a connected person is an address', byKind[`adaeze-${ID}`].kind === 'person');
    ok('and is notified', byKind[`adaeze-${ID}`].notified === true);
    ok('a contact on Kairos you cannot reach is a mention',
      byKind[`ngozi-${ID}`].kind === 'contact', JSON.stringify(byKind[`ngozi-${ID}`]));
    ok('and is explicitly not notified', byKind[`ngozi-${ID}`].notified === false);
    ok('and it carries the name, so the screen need not look it up',
      byKind[`ngozi-${ID}`].name === 'Ngozi Okafor', byKind[`ngozi-${ID}`].name);
    // The name this app used to invent. It refers to nobody, and now says so.
    ok('a name derived from a contact is not a username and resolves to nothing',
      byKind['tunde-bakare'].kind === 'unknown', JSON.stringify(byKind['tunde-bakare']));

    // --- Contacts belong to an office ------------------------------------
    head('A contact belongs to one office:');
    const outsider = client();
    await outsider('POST', '/auth/signup', { name: 'Someone Else', email: `else${ID}@x.com`, password: PW });
    const outsiderMe = (await outsider('GET', '/auth/me')).d.user;
    const leaked = await mentions.of(`@ngozi-${ID}`, { viewerId: outsiderMe.id, ownerId: outsiderMe.id });
    ok('somebody else\'s contact does not resolve for them', leaked[0].kind === 'unknown',
      JSON.stringify(leaked[0]));
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
    // --- @ in a thread ----------------------------------------------------
    //
    // The whole distinction has to survive the trip to a screen. In a space it
    // gains a third case: somebody real, with an account, who is not in this
    // room. They are worth naming and they were NOT told, and drawing them as
    // a delivered address would be the same lie by another road.
    head('@ inside a thread:');
    const sp = await boss('POST', '/spaces', { name: 'Board dinner', context: 'work' });
    const spaceId = sp.d.space?.id || sp.d.id;
    ok('a space was made', !!spaceId, JSON.stringify(sp.d).slice(0, 160));

    const th = await boss('POST', `/spaces/${spaceId}/threads`, { name: 'Cars' });
    const threadId = th.d.thread?.id || th.d.id;
    ok('and a thread in it', !!threadId, JSON.stringify(th.d).slice(0, 160));

    // A work space already seeds the owner's chief of staff, so Kit is in the
    // room without being asked twice. Said out loud rather than relied on
    // silently — if that default ever changes, this line is where it shows.
    r = await pa('GET', `/threads/${threadId}/messages`);
    ok('the chief of staff is already in the room', r.s === 200, String(r.s));

    // Filed under the space owner, so it is the owner's outbox that grows.
    const before = ((await boss('GET', '/emails')).d.emails || []).length;
    r = await boss('POST', `/threads/${threadId}/messages`, {
      body: `@kit-${ID} please book the cars. @femi-${ID} has the list, `
        + `and @ngozi-${ID} is not in this space.`,
    });
    ok('the message is accepted', r.s === 201, JSON.stringify(r.d));

    r = await pa('GET', `/threads/${threadId}/messages`);
    const posted = r.d.messages[r.d.messages.length - 1];
    const seen = Object.fromEntries((posted.mentions || []).map((m) => [m.handle, m]));
    ok('the thread hands back what each @ is',
      (posted.mentions || []).length === 3, JSON.stringify(posted.mentions));
    ok('a member is an address', seen[`kit-${ID}`]?.kind === 'person');
    ok('and was told', seen[`kit-${ID}`]?.notified === true);
    ok('a contact is a mention', seen[`femi-${ID}`]?.kind === 'contact',
      JSON.stringify(seen[`femi-${ID}`]));
    ok('and was not told', seen[`femi-${ID}`]?.notified === false);
    // The one this section exists for.
    ok('somebody outside the space is still named',
      seen[`ngozi-${ID}`]?.kind === 'person', JSON.stringify(seen[`ngozi-${ID}`]));
    ok('but is not told, because they cannot read it',
      seen[`ngozi-${ID}`]?.notified === false);
    ok('and the screen is told why', seen[`ngozi-${ID}`]?.reason === 'no-access');

    const after = (await boss('GET', '/emails')).d.emails || [];
    ok('the member addressed gets told',
      after.length > before && after.some((e) => /mentioned you/i.test(e.subject || '')),
      String(after.length) + ' vs ' + String(before));
    ok('and the thread is not quoted into the mail',
      !after.some((e) => /book the cars/i.test(e.body || '')));

    // --- The picker inside a space ----------------------------------------
    head('The picker inside a thread:');
    r = await pa('GET', `/mentions/space/${spaceId}/lookup?q=`);
    ok('offers people in the room', r.d.people.some((p) => p.handle === `adaeze-${ID}`),
      JSON.stringify(r.d.people));
    ok('and nobody outside it',
      !r.d.people.some((p) => p.handle === `ngozi-${ID}`), JSON.stringify(r.d.people));
    ok('and never yourself',
      !r.d.people.some((p) => p.handle === `kit-${ID}`), JSON.stringify(r.d.people));
    ok('and offers no invitation from here',
      r.d.contacts.every((c) => c.canInvite === false));

    const shut = await outsider('GET', `/mentions/space/${spaceId}/lookup?q=`);
    ok('somebody with no access cannot read it at all', shut.s === 404, String(shut.s));

    // --- The same @ everywhere else it can be written --------------------
    //
    // A thread is not the only place with a text box. An instruction, a brief
    // and a task each carry writing that names people, and if @ resolved in
    // one and stayed dead text in the others, the symbol would mean different
    // things on different screens of the same product.
    head('An instruction:');
    r = await pa('POST', `/pa/${me.id}/instructions`, {
      text: `@adaeze-${ID} the car leaves at six. @femi-${ID} has the documents.`,
    });
    ok('is accepted', r.s === 201, JSON.stringify(r.d).slice(0, 160));
    let seenM = Object.fromEntries((r.d.instruction.mentions || []).map((m) => [m.handle, m]));
    ok('the principal is an address', seenM[`adaeze-${ID}`]?.kind === 'person');
    ok('and is told', seenM[`adaeze-${ID}`]?.notified === true);
    ok('a contact is a mention', seenM[`femi-${ID}`]?.kind === 'contact',
      JSON.stringify(seenM[`femi-${ID}`]));
    ok('and is not told', seenM[`femi-${ID}`]?.notified === false);

    r = await pa('GET', `/pa/${me.id}/instructions`);
    ok('and the list carries them too',
      (r.d.instructions[0].mentions || []).length === 2,
      JSON.stringify(r.d.instructions[0].mentions));

    r = await boss('GET', '/emails');
    ok('the person named is told', (r.d.emails || [])
      .some((e) => /named you in an instruction/i.test(e.subject || '')));
    ok('and the instruction is not quoted into the mail',
      !(r.d.emails || []).some((e) => /car leaves at six/i.test(e.body || '')));

    head('A brief:');
    // A brief hangs off a booking, so there has to be one. Open all week and
    // around the clock, deliberately: an availability window that only covers
    // office hours makes this suite pass in the morning and fail at eleven at
    // night, which is a whole family of bugs this repo has already been bitten
    // by more than once.
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
    });
    r = await boss('POST', '/meeting-types', {
      name: 'Intro', durationMinutes: 30, locationType: 'video', accessTier: 1,
    });
    const mt = r.d.meetingType;
    const anon = client();
    const slots = (await anon('GET', `/public/adaeze-${ID}/${mt.slug}/slots`)).d.slots || [];
    ok('there is a slot to book', slots.length > 0, String(slots.length));
    await anon('POST', `/public/adaeze-${ID}/${mt.slug}/book`, {
      timezone: 'UTC', startAt: slots[0].startAt, name: 'Chidi Eze', email: `chidi${ID}@x.com`,
    });

    const bk = await boss('GET', '/bookings');
    const booking = (bk.d.bookings || [])[0];
    if (booking) {
      r = await pa('PUT', `/pa/${me.id}/briefs/${booking.id}`, {
        sections: { who: `@adaeze-${ID} is attending`, background: `@femi-${ID} briefed us` },
      });
      ok('saving resolves what it names', r.s === 200 && (r.d.mentions || []).length === 2,
        JSON.stringify(r.d.mentions));
      const briefMail = ((await boss('GET', '/emails')).d.emails || [])
        .filter((e) => /named you in a brief/i.test(e.subject || '')).length;
      ok('and tells whoever was named', briefMail === 1, String(briefMail));

      // The one that stops a brief becoming a notification machine.
      await pa('PUT', `/pa/${me.id}/briefs/${booking.id}`, {
        sections: { who: `@adaeze-${ID} is attending`, background: `@femi-${ID} briefed us`, logistics: 'Car at six' },
      });
      const again = ((await boss('GET', '/emails')).d.emails || [])
        .filter((e) => /named you in a brief/i.test(e.subject || '')).length;
      ok('saving again does not tell them twice', again === 1, String(again));

      r = await pa('GET', `/pa/${me.id}/briefs/${booking.id}`);
      ok('and reading it back says what each @ is',
        (r.d.mentions || []).some((m) => m.handle === `femi-${ID}` && m.notified === false),
        JSON.stringify(r.d.mentions));
    } else {
      ok('a booking existed to brief', false, JSON.stringify(bk.d).slice(0, 200));
    }

    head('A task:');
    r = await pa('POST', '/tasks', {
      spaceId, title: `Confirm cars with @adaeze-${ID} and @femi-${ID}`,
    });
    ok('is accepted', r.s === 201, JSON.stringify(r.d).slice(0, 160));
    seenM = Object.fromEntries((r.d.task.mentions || []).map((m) => [m.handle, m]));
    ok('a member of the space is an address', seenM[`adaeze-${ID}`]?.kind === 'person');
    ok('and a contact is still only a mention', seenM[`femi-${ID}`]?.notified === false);
    r = await pa('GET', `/tasks?spaceId=${spaceId}`);
    ok('the list carries them', (r.d.tasks[0].mentions || []).length === 2,
      JSON.stringify(r.d.tasks[0]?.mentions));

    // A member who is not the owner's assistant is not handed the address book
    // merely for being added to a thread.
    r = await boss('POST', `/spaces/${spaceId}/members`, { email: `ngozi${ID}@x.com`, role: 'member' });
    ok('a plain member can be added', r.s === 201 || r.s === 409, JSON.stringify(r.d));
    r = await stranger('GET', `/mentions/space/${spaceId}/lookup?q=`);
    ok('a plain member sees the room', r.s === 200 && r.d.people.length > 0, String(r.s));
    ok('but not the office address book', (r.d.contacts || []).length === 0,
      JSON.stringify(r.d.contacts));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\n@ addresses people who can answer, and names the rest without pretending.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
