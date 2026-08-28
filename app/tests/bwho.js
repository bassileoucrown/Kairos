// A name you can click, a line you can fix, and a meeting that is over.
//
// Five changes that share one theme: the product knew things it would not act
// on. It knew who wrote a message and would not let you answer them. It knew a
// line was wrong and would not let you correct it. It knew a meeting had
// happened and still offered to move it. It knew a task was finished and kept
// it in the room. And an assistant who had sat through a meeting had nowhere to
// write down what was agreed.
//
// The two worth watching hardest are the ones that widen access:
//
//   A PAIR ROOM is a new place two people can say things nobody else sees, so
//   this proves both of them get the SAME room however they open it, that a
//   stranger gets neither the room nor the fact of it, and that a principal's
//   assistants do not inherit their way into it the way they do the direct line.
//
//   MINUTES are candid by nature — the office's account of somebody who is not
//   in the office — and the booker holds a link they can forward to anyone. So
//   this proves a minute cannot reach the booker's side by any route.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = 4575, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

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
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { s: r.status, d: json };
  };
}

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ENCRYPTION_KEY: KEY },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  // A booking in the past cannot be made through the front door — every route
  // that creates one refuses a time that has gone, which is the rule being
  // tested from the other side. So it is written straight in.
  const db = require(`${ROOT}/app/server/lib/db`);
  let b = null;
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    await db.ready();

    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const pa = client();
    const paUp = await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    const paId = paUp.d.user.id;
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    const invite = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${invite.d.inviteLink.split('/').pop()}/accept`);

    // A SECOND ASSISTANT, IN PLACE BEFORE THE PAIR ROOM EXISTS. The order
    // matters and this is the whole reason it is up here: a leak that adds the
    // principal's other assistants when a pair room is CREATED is invisible to
    // a test where the colleague only joins afterwards. An office normally has
    // its people before two of them start talking privately.
    const colleague = client();
    await colleague('POST', '/auth/signup',
      { name: 'Kunle Ade', email: `kunle${ID}@x.com`, password: PW, accountCategory: 'ea' });
    await colleague('POST', '/profile/onboarding-step', { step: 'done' });
    const inv2 = await boss('POST', '/members', { email: `kunle${ID}@x.com`, role: 'ea' });
    await colleague('POST', `/invites/${inv2.d.inviteLink.split('/').pop()}/accept`);

    const stranger = client();
    await stranger('POST', '/auth/signup',
      { name: 'Chidi Eze', email: `chidi${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await stranger('POST', '/profile/onboarding-step', { step: 'done' });

    const threadId = (await boss('GET', `/today/${bossId}`)).d.directLine?.threadId;
    ok('the direct line is there', !!threadId);
    // Somebody else has to have said something in the room, or there is no
    // name in it but your own — and your own name is deliberately not a menu.
    await pa('POST', `/threads/${threadId}/messages`, { body: 'Understood.' });

    // ---- Fixing what you already said -------------------------------------
    head('A message already sent:');
    const said = await boss('POST', `/threads/${threadId}/messages`, { body: 'Car at nine tomorrow' });
    const fixed = await boss('PATCH', `/threads/${threadId}/messages/${said.d.id}`,
      { body: 'Car at six tomorrow' });
    ok('can be corrected by whoever wrote it', fixed.s === 200, JSON.stringify(fixed.d));

    const after = (await boss('GET', `/threads/${threadId}/messages`))
      .d.messages.find((m) => m.id === said.d.id);
    ok('and the words really change', after.body === 'Car at six tomorrow', after.body);
    // A message that can change silently is a message nobody can rely on.
    ok('and it says it was edited, from the first save', !!after.editedAt);

    ok('somebody else cannot rewrite your words',
      (await pa('PATCH', `/threads/${threadId}/messages/${said.d.id}`, { body: 'nine' })).s === 403);

    const rec = await boss('POST', `/threads/${threadId}/messages`,
      { body: 'The board dinner moves to Thursday', register: 'record', recordType: 'decision' });
    ok('an unacknowledged record can still be corrected',
      (await boss('PATCH', `/threads/${threadId}/messages/${rec.d.id}`,
        { body: 'The board dinner moves to Thursday, at eight' })).s === 200);
    await pa('POST', `/threads/${threadId}/messages/${rec.d.id}/ack`);
    const frozen = await boss('PATCH', `/threads/${threadId}/messages/${rec.d.id}`, { body: 'Friday' });
    // THE ONE THAT MATTERS. Editing a decision out from under somebody who has
    // agreed to it is exactly what the lock exists to stop.
    ok('but not once somebody has acknowledged it', frozen.s === 409, String(frozen.s));
    ok('and it says to supersede instead of just refusing',
      /supersede/i.test(frozen.d.error || ''), frozen.d.error);

    // An @ added in an edit has to reach the person, or a mistyped handle is
    // unrecoverable — but only the newly named, not everybody again.
    const before = (await boss('GET', '/emails')).d.emails.length;
    await boss('PATCH', `/threads/${threadId}/messages/${said.d.id}`,
      { body: 'Car at six tomorrow @ngozi-bello' });
    const mailed = (await boss('GET', '/emails')).d.emails;
    ok('naming somebody in an edit tells them', mailed.length > before,
      `${before} → ${mailed.length}`);
    const second = mailed.length;
    await boss('PATCH', `/threads/${threadId}/messages/${said.d.id}`,
      { body: 'Car at six sharp tomorrow @ngozi-bello' });
    ok('and editing again does not tell them twice',
      (await boss('GET', '/emails')).d.emails.length === second);

    // ---- Clicking a name --------------------------------------------------
    head('Clicking somebody\'s name:');
    const card = await boss('GET', `/people/${paId}`);
    ok('answers who they are', card.s === 200 && card.d.person.name === 'Ngozi Bello',
      JSON.stringify(card.d).slice(0, 120));
    ok('and how you stand with them', card.d.person.relation === 'assistant');
    // The security question this product gets asked most, against the person
    // it is about rather than three screens away.
    ok('including their remit, which is the principal\'s to know',
      card.d.person.canManageScheduling === true);
    ok('and what is open between you', card.d.between.youHandedThem === 0);

    // A name is not a directory lookup.
    ok('never an email address or anything from a vault',
      !JSON.stringify(card.d).includes('@x.com'), JSON.stringify(card.d));
    ok('your own name is not a menu', (await boss('GET', `/people/${bossId}`)).s === 400);
    // Not 403: whether a given person holds a Kairos account is not a fact this
    // will confirm to somebody with no connection to them.
    ok('and a stranger is told nothing, not even that they exist',
      (await stranger('GET', `/people/${paId}`)).s === 404);

    head('A room for the two of you:');
    ok('does not exist merely because you looked', card.d.directThreadId === null);
    const mine = await boss('POST', `/people/${paId}/direct`);
    const theirs = await pa('POST', `/people/${bossId}/direct`);
    ok('opens on demand', mine.s === 201 && !!mine.d.threadId, JSON.stringify(mine.d));
    // Two people clicking each other's names must not end up with two rooms,
    // each holding half of what was said.
    ok('and is the SAME room whichever of you opens it',
      mine.d.threadId === theirs.d.threadId, `${mine.d.threadId} vs ${theirs.d.threadId}`);
    ok('opening it twice does not make a second one',
      (await boss('POST', `/people/${paId}/direct`)).d.threadId === mine.d.threadId);

    const between = await boss('POST', `/threads/${mine.d.threadId}/messages`,
      { body: 'Between us — is Kunle actually up to this?' });
    ok('things can be said in it', between.s === 201);
    ok('and the other person reads them',
      (await pa('GET', `/threads/${mine.d.threadId}/messages`)).d.messages.length === 1);
    ok('a stranger cannot open the room', (await stranger('POST', `/people/${paId}/direct`)).s === 404);
    ok('nor read it with the id in hand',
      (await stranger('GET', `/threads/${mine.d.threadId}/messages`)).s === 404);

    // THE LEAK THIS HAS TO NOT HAVE. A principal's assistants are added to the
    // direct line automatically, and Kunle was already on the team when this
    // room was opened — so if anything seeds a pair room from the owner's
    // assistants, he is in it. He must not be.
    ok('another of the principal\'s own assistants cannot read their pair room',
      (await colleague('GET', `/threads/${mine.d.threadId}/messages`)).s === 404,
      'a colleague inherited their way into a private line');
    ok('nor is the room offered to them as one of their spaces',
      !(await colleague('GET', '/spaces')).d.spaces.some((sp) => sp.id === mine.d.spaceId));

    head('Handing somebody something from their name:');
    const handed = await boss('POST', `/people/${paId}/hand`, { body: 'Chase the visa people' });
    ok('lands on their pad', handed.s === 201, JSON.stringify(handed.d).slice(0, 120));
    ok('with them on it', handed.d.item.assigneeId === paId);
    // Private plus an assignee: the two of you and nobody else. Defaulting to
    // the office pad would be the wrong way round.
    ok('and only the two of you can read it', handed.d.item.visibility === 'private');
    ok('they can see it', (await pa('GET', '/pad')).d.items.some((i) => i.id === handed.d.item.id));
    ok('the card now says what is between you',
      (await boss('GET', `/people/${paId}`)).d.between.youHandedThem === 1);
    ok('and a stranger cannot hand anybody anything',
      (await stranger('POST', `/people/${paId}/hand`, { body: 'x' })).s === 404);

    // ---- Finished work leaves the room ------------------------------------
    head('A task that is done:');
    const instruction = await boss('POST', `/threads/${threadId}/messages`, { body: 'Book the car' });
    const task = await boss('POST', '/tasks',
      { sourceMessageId: instruction.d.id, title: 'Book the car', assigneeId: paId });
    const onLine = () => boss('GET', `/threads/${threadId}/messages`)
      .then((r) => r.d.messages.find((m) => m.id === instruction.d.id).tasks.length);
    ok('shows on the line while it is live', await onLine() === 1);
    await pa('PATCH', `/tasks/${task.d.task.id}`, { status: 'done' });
    ok('leaves the thread once it is finished', await onLine() === 0);
    // Not deleted — it is on the space's list and in My Tasks, where a finished
    // thing belongs. It has only stopped taking up room in a conversation.
    ok('but still exists where finished work belongs',
      (await pa('GET', '/tasks/mine')).d.tasks.some((t) => t.id === task.d.task.id));
    await pa('PATCH', `/tasks/${task.d.task.id}`, { status: 'open' });
    // The filter is the task's own state rather than a second flag that could
    // disagree with it, so reopening brings it back for free.
    ok('and comes back if it is reopened', await onLine() === 1);

    // ---- A meeting that has happened --------------------------------------
    head('An appointment that is over:');
    const mt = await boss('POST', '/meeting-types',
      { name: 'Intro', durationMinutes: 30, locationType: 'video', accessTier: 1 });
    const gone = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO bookings (id, meeting_type_id, owner_id, booker_name, booker_email,
                            booker_timezone, start_at, end_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'UTC', ?, ?, 'confirmed', ?)
    `).run(gone, mt.d.meetingType.id, bossId, 'Tunde Bakare', 'tunde@x.com',
      new Date(Date.now() - 3 * 3600e3).toISOString(),
      new Date(Date.now() - 2.5 * 3600e3).toISOString(), new Date().toISOString());

    const detail = await boss('GET', `/bookings/${gone}`);
    // The screen hides exactly the verbs the server refuses, from this one
    // answer — a button that exists and always fails is worse than none.
    ok('says so on the appointment itself', detail.d.booking.over === true);

    const moved = await boss('POST', `/bookings/${gone}/reschedule`,
      { startAt: new Date(Date.now() + 86400e3).toISOString() });
    ok('cannot be moved', moved.s === 400, String(moved.s));
    ok('and says why, and what to do instead',
      /already happened.*new one/is.test(moved.d.error || ''), moved.d.error);
    ok('cannot be lengthened',
      (await boss('POST', `/bookings/${gone}/duration`, { minutes: 60 })).s === 400);
    ok('cannot be called off',
      (await boss('POST', `/bookings/${gone}/cancel`, {})).s === 400);
    ok('nor by an assistant, who reaches it by a different route',
      (await pa('POST', `/pa/${bossId}/bookings/${gone}/cancel`, {})).s === 400);
    // The booker holds a link and their own set of verbs. Same clock.
    ok('nor by the booker, from the link they were sent',
      (await client()('POST', `/public/bookings/${gone}/cancel`)).s === 400);
    ok('and the booker\'s page knows not to offer it',
      (await client()('GET', `/public/bookings/${gone}`)).d.booking.over === true);

    const live = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO bookings (id, meeting_type_id, owner_id, booker_name, booker_email,
                            booker_timezone, start_at, end_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'UTC', ?, ?, 'confirmed', ?)
    `).run(live, mt.d.meetingType.id, bossId, 'Still Running', 'run@x.com',
      new Date(Date.now() - 10 * 60e3).toISOString(),
      new Date(Date.now() + 20 * 60e3).toISOString(), new Date().toISOString());
    // A meeting that has STARTED is still live: it is the one that runs over,
    // and "change the length" is exactly the verb somebody wants at ten past.
    ok('one that has merely started is still live',
      (await boss('GET', `/bookings/${live}`)).d.booking.over === false);
    ok('and can still be lengthened, which is the point of that verb',
      (await boss('POST', `/bookings/${live}/duration`, { minutes: 45 })).s === 200);

    // ---- Minutes ----------------------------------------------------------
    head('Minuting a meeting for the principal:');
    const filed = await pa('POST', `/pa/${bossId}/bookings/${gone}/minutes`,
      { body: 'He agreed to fund the second tranche, subject to the audit.' });
    ok('an assistant can file them', filed.s === 201, JSON.stringify(filed.d).slice(0, 140));
    ok('and they are minutes, not a note', filed.d.note.kind === 'minute');
    // Forced rather than offered: there is no version of this where sending
    // the office's candid account to its subject is what somebody meant.
    ok('office-only by construction', filed.d.note.visibility === 'office');

    const officeSees = await boss('GET', `/bookings/${gone}/notes`);
    ok('the principal sees them', officeSees.d.notes.some((n) => n.kind === 'minute'));
    // THE ONE THAT MATTERS. The booker's link is a bearer token they can
    // forward to anybody.
    const bookerSees = await client()('GET', `/public/bookings/${gone}`);
    ok('the person minuted sees nothing of them',
      !JSON.stringify(bookerSees.d.notes || []).includes('second tranche'),
      JSON.stringify(bookerSees.d.notes));

    ok('"for the principal\'s information" actually reaches them',
      (await boss('GET', '/emails')).d.emails.some((e) => /^Minutes:/.test(e.subject)),
      'nothing knocked');

    const soon = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO bookings (id, meeting_type_id, owner_id, booker_name, booker_email,
                            booker_timezone, start_at, end_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'UTC', ?, ?, 'confirmed', ?)
    `).run(soon, mt.d.meetingType.id, bossId, 'Later Person', 'later@x.com',
      new Date(Date.now() + 86400e3).toISOString(),
      new Date(Date.now() + 90000e3).toISOString(), new Date().toISOString());
    const early = await pa('POST', `/pa/${bossId}/bookings/${soon}/minutes`, { body: 'too soon' });
    ok('a meeting that has not started cannot be minuted', early.s === 400, String(early.s));
    ok('and is told where that belongs instead',
      /office note/i.test(early.d.error || ''), early.d.error);
    // 403 rather than 404 here, and that is the existing rule rather than a
    // new one: the delegated routes are addressed by whose account you are
    // acting on, so the principal's existence is already in the URL you typed.
    ok('a stranger cannot minute anybody\'s meeting',
      (await stranger('POST', `/pa/${bossId}/bookings/${gone}/minutes`, { body: 'x' })).s === 403);

    // ---- On the screen ----------------------------------------------------
    head('Through the browser:');
    b = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const p = await b.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}/login`);
    await p.fill('#email', `ada${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Log in")');
    await p.waitForURL(/\/workspace|\/today/, { timeout: 20000 });

    await p.goto(`${BASE}/threads/${threadId}`);
    await p.waitForSelector('.msg-note', { timeout: 20000 });

    const line = p.locator(`#m-${said.d.id}`);
    await line.click({ position: { x: 5, y: 5 } });
    ok('your own line offers Edit',
      (await line.locator('button:has-text("Edit")').count()) === 1);
    await line.locator('button:has-text("Edit")').click();
    await p.waitForSelector('.msg-edit', { timeout: 10000 });
    await p.fill('textarea[aria-label="Edit this message"]', 'Car at half six tomorrow');
    await p.click('.msg-edit button:has-text("Save")');
    await p.waitForSelector('.msg-edit', { state: 'detached', timeout: 15000 });
    // WAIT FOR THE WORDS, do not read once. The edit form unmounts as soon as
    // the save resolves, and the message re-renders when the reload lands a
    // moment later — reading innerText in between catches the row mid-flight
    // and returns the avatar and nothing else. This failed intermittently
    // exactly that way.
    await line.locator('.msg-bubble', { hasText: 'half six' })
      .waitFor({ timeout: 15000 })
      .catch(() => {});
    const afterSave = await line.innerText();
    ok('and saving really changes it',
      /half six/.test(afterSave), afterSave.slice(0, 120));
    ok('with "edited" against it', /edited/.test(await line.innerText()));

    // ---- Picking a message, and taking one back ---------------------------
    head('Taking back something you said:');
    const regret = await boss('POST', `/threads/${threadId}/messages`,
      { body: 'Tell him the number is forty-two million.' });
    const taken = await boss('DELETE', `/threads/${threadId}/messages/${regret.d.id}`);
    ok('your own note can be withdrawn', taken.s === 200, JSON.stringify(taken.d));

    // GONE, NOT A TOMBSTONE. This left the row in place with its body emptied
    // for one release, on the argument that a room whose history has holes in
    // it cannot be relied on. The other argument won: a line reading "message
    // withdrawn" in a principal's office is an invitation to ask what it said,
    // and the person who took it back is the one who has to field the asking.
    const afterTakeBack = await pa('GET', `/threads/${threadId}/messages`);
    ok('the row is gone entirely',
      !afterTakeBack.d.messages.some((m) => m.id === regret.d.id),
      JSON.stringify(afterTakeBack.d.messages.map((m) => m.id)));
    ok('the number is nowhere in what the other person is sent',
      !JSON.stringify(afterTakeBack).includes('forty-two million'));
    // Nothing left to point at means nothing left to say no to, and a 404 is
    // the honest answer rather than a special case pretending otherwise.
    ok('and asking again finds nothing to take',
      (await boss('DELETE', `/threads/${threadId}/messages/${regret.d.id}`)).s === 404);
    const someoneElse = await pa('POST', `/threads/${threadId}/messages`, { body: 'Noted.' });
    ok('and you cannot take back somebody else\'s words',
      (await boss('DELETE', `/threads/${threadId}/messages/${someoneElse.d.id}`)).s === 403);
    // Withdrawing a record would be exactly the edit the lock exists to
    // prevent, wearing a different name.
    const refusedRec = await boss('DELETE', `/threads/${threadId}/messages/${rec.d.id}`);
    ok('a record cannot be withdrawn at all', refusedRec.s === 400, String(refusedRec.s));
    ok('and is told to supersede instead', /supersede/i.test(refusedRec.d.error || ''), refusedRec.d.error);

    head('An @ in the middle of a sentence:');
    // THE MOST NATURAL PLACE TO CLICK A PERSON, and for a while the one place
    // that did nothing: author names opened a menu, and "@seun can you confirm
    // Thursday" — the moment somebody is actually thinking about that person —
    // was inert text.
    await boss('POST', `/threads/${threadId}/messages`,
      { body: 'Can @ngozi-bello confirm the Thursday dinner?' });
    await p.reload();
    await p.waitForSelector('.msg-bubble', { timeout: 20000 });
    const atMention = p.locator('.msg-bubble button.person-link.mention', { hasText: '@ngozi-bello' }).first();
    ok('an @ of a real person is clickable', (await atMention.count()) === 1);
    // The look must not change: an address still has to read as an address, or
    // the distinction between "they were told" and "they were only named" is
    // lost to make room for a menu.
    ok('and still drawn as a mention rather than a link',
      /\bmention\b/.test(await atMention.getAttribute('class') || ''),
      await atMention.getAttribute('class'));
    await atMention.click();
    // Wait for the CARD, not just the box. The menu paints immediately with
    // whatever label was clicked — "@ngozi-bello" from a mention — and fills in
    // once the card lands; asserting on the name in between races the fetch.
    await p.waitForSelector('.person-menu .person-handle', { timeout: 15000 });
    ok('and opens the same card', /Ngozi Bello/.test(await p.locator('.person-menu').innerText()),
      await p.locator('.person-menu').innerText());
    await p.keyboard.press('Escape');
    await p.waitForSelector('.person-menu', { state: 'detached', timeout: 10000 });

    head('Somebody you share a room with but nothing else:');
    // A REAL DEAD END WITHOUT THIS. Two people can sit in one project space with
    // no membership and no connection between them — invited separately by a
    // third party. The @ is clickable because they plainly exist; the card is
    // refused because nothing links the accounts. "No such person" about a name
    // the reader is looking at is the worst of both.
    const joint = await boss('POST', '/spaces', { name: 'Joint venture', context: 'work' });
    await boss('POST', `/spaces/${joint.d.space.id}/members`, { email: `chidi${ID}@x.com` });
    const jointThread = await boss('POST', `/spaces/${joint.d.space.id}/threads`, { name: 'Room' });
    const me = (await boss('GET', '/auth/me')).d.user;
    await boss('POST', `/threads/${jointThread.d.thread.id}/messages`,
      { body: `I, @${me.slug}, will sign it off once you are ready.` });

    const outsider = await b.newPage();
    await outsider.goto(`${BASE}/login`);
    await outsider.fill('#email', `chidi${ID}@x.com`);
    await outsider.fill('#password', PW);
    await outsider.click('button:has-text("Log in")');
    await outsider.waitForURL(/\/workspace|\/today/, { timeout: 20000 });
    await outsider.goto(`${BASE}/threads/${jointThread.d.thread.id}`);
    await outsider.waitForSelector('.msg-bubble', { timeout: 20000 });
    // NOT VIA THE @ — that cannot dead-end, and it is worth saying why. Handle
    // resolution is scoped to the reader: somebody who cannot reach a person
    // does not resolve their handle either, so the mention stays plain text
    // rather than becoming a name that opens nothing.
    ok('an unreachable person\'s @ is left as plain text, not a dead link',
      (await outsider.locator('.msg-bubble button.person-link').count()) === 0);

    // The author's name is the path that DOES reach here: it carries the id
    // straight from the message rather than resolving a handle, so it is
    // clickable for anybody whose message you can read.
    const strangerAt = outsider.locator('.msg-who button.person-link').first();
    ok('but the author\'s name is clickable, because you are reading their message',
      (await strangerAt.count()) === 1);
    await strangerAt.click();
    await outsider.waitForSelector('.person-menu .alert-error', { timeout: 15000 });
    const refused = await outsider.locator('.person-menu').innerText();
    ok('and it does not claim they do not exist',
      !/no such person/i.test(refused), refused.slice(0, 140));
    ok('it says what is actually true — nothing links the accounts',
      /nothing links/i.test(refused), refused.slice(0, 200));
    ok('and points at where that starts', /Connections/i.test(refused), refused.slice(0, 200));
    await outsider.close();

    head('A name on a message:');
    // The assistant's name, not the principal's own — your own name is not a
    // menu, and the screen agrees with the server about that.
    const theirName = p.locator('.msg-who button.person-link', { hasText: 'Ngozi' }).first();
    ok('is clickable', (await theirName.count()) === 1);
    await theirName.click();
    await p.waitForSelector('.person-menu .person-handle', { timeout: 15000 });
    const menu = await p.locator('.person-menu').innerText();
    ok('and opens a card naming them', /Ngozi Bello/.test(menu), menu.slice(0, 120));
    ok('carrying their handle to copy', /@ngozi-bello/.test(menu), menu.slice(0, 160));
    ok('and their remit, in words', /PA|hours/i.test(menu), menu.slice(0, 200));
    ok('offering the line between you',
      (await p.locator('.person-menu button:has-text("Open your line")').count())
      + (await p.locator('.person-menu button:has-text("Message them")').count()) === 1);
    ok('and offering to hand them something',
      (await p.locator('.person-menu button:has-text("Hand them something")').count()) === 1);

    await p.locator('.person-menu button:has-text("Open your line")').first().click();
    await p.waitForFunction(
      (t) => window.location.pathname === `/threads/${t}`, mine.d.threadId, { timeout: 20000 },
    );
    ok('which opens the room for the two of you', true);

    head('Your other conversations, from inside one of them:');
    // A SWITCHER, NOT A MERGE. The office room holds the principal AND every
    // assistant; folding a private line into it would put two people's
    // conversation in front of everybody, which is the leak the pair room
    // exists to prevent and the end of the general room being general.
    await p.goto(`${BASE}/threads/${threadId}`);
    await p.waitForSelector('.line-switcher', { timeout: 20000 });
    const chips = await p.locator('.line-chip').allInnerTexts();
    ok('the office room and the private line are both offered',
      chips.length >= 2, JSON.stringify(chips));
    ok('and the one you are in is marked as such',
      (await p.locator('.line-chip.is-here').count()) === 1);

    // What was said privately must not have leaked into the general room.
    const general = await p.locator('.msg-stream').innerText();
    ok('nothing from the private line is in the general one', !/Between us/.test(general));

    const otherChip = p.locator('.line-chip:not(.is-here)').first();
    await otherChip.click();
    await p.waitForFunction(
      (t) => window.location.pathname !== `/threads/${t}`, threadId, { timeout: 20000 },
    );
    // WAIT FOR THE ROOM, NOT THE ELEMENT. The switcher changes the id under a
    // mounted ThreadView, so .msg-stream is already on the page and
    // waitForSelector returns on the OLD room's messages — which is how this
    // read the general room and called it the private one. What has to settle
    // is the content, so that is what is waited on. Not the same as waiting
    // for the words being asserted: an empty stream, or a third room's
    // messages, still ends this wait and still fails the check below.
    await p.waitForFunction((before) => {
      const el = document.querySelector('.msg-stream');
      return el && el.innerText !== before;
    }, general, { timeout: 20000 });
    ok('and switching lands in the other room',
      /Between us/.test(await p.locator('.msg-stream').innerText()),
      (await p.locator('.msg-stream').innerText()).slice(0, 120));

    head('A past appointment on screen:');

    await p.goto(`${BASE}/appointments/${bossId}/${gone}`);
    // WAITING FOR THE PAGE, NOT FOR A BOX THAT IS ALWAYS THERE. `.card` is in
    // the shell, so it is present while the page still says "Loading…" — and
    // reading body text at that moment reads a page with the nav on it and
    // nothing else. Standalone it always won the race; on a board, behind
    // ninety other suites, it lost one and reported that minutes filed and
    // confirmed two hundred lines earlier were missing from the screen.
    // Measurement error, not a product fault, and an expensive one to read.
    await p.waitForFunction(() => {
      const h = document.querySelector('.app-body .hint');
      return !(h && /Loading/.test(h.textContent || ''));
    }, null, { timeout: 20000 });
    const page = await p.locator('body').innerText();
    ok('says it has happened', /already happened/i.test(page), page.slice(0, 200));
    ok('and offers none of the three verbs',
      (await p.locator('button:has-text("Move it")').count())
      + (await p.locator('button:has-text("Change the length")').count())
      + (await p.locator('button:has-text("Call it off")').count()) === 0);
    // The point of keeping the page open: what happened gets written afterwards.
    ok('but the minutes are still there to read',
      /second tranche/.test(page), page.slice(0, 300));

    // ---- On a phone -------------------------------------------------------
    //
    // WHY THIS NEEDED ITS OWN PASS. blayout walks every screen at phone widths
    // and measures overflow, and it passed this menu without seeing it: it
    // measures pages as they LOAD, and a menu that is closed takes up no room.
    // The overflow only exists once somebody taps. Anything that opens over the
    // page needs measuring open.
    //
    // What it was: a popover anchored to an inline name, and a name can sit
    // most of the way across a line — in a record's footer, after "promoted
    // from a note by". At 360px that ran 95px past the right edge, gave the
    // document a horizontal scrollbar, and could land below the fold. Below the
    // breakpoint it is a sheet at the bottom of the screen instead.
    head('On a phone:');
    const phone = await b.newContext({
      viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true,
    });
    const ph = await phone.newPage();
    const phoneErrs = [];
    ph.on('pageerror', (e) => phoneErrs.push(e.message));
    await ph.goto(`${BASE}/login`);
    await ph.fill('#email', `ada${ID}@x.com`);
    await ph.fill('#password', PW);
    await ph.click('button:has-text("Log in")');
    await ph.waitForURL(/\/workspace|\/today/, { timeout: 20000 });
    await ph.goto(`${BASE}/threads/${threadId}`);
    await ph.waitForSelector('button.person-link', { timeout: 20000 });

    // THE RIGHTMOST NAME, which is the one that used to hang off the edge.
    // Taking the first would pass on a build that is still broken.
    const names = ph.locator('button.person-link');
    let worst = names.first();
    let furthest = -1;
    for (let i = 0; i < await names.count(); i += 1) {
      const box = await names.nth(i).boundingBox();
      if (box && box.x > furthest) { furthest = box.x; worst = names.nth(i); }
    }
    const nameBox = await worst.boundingBox();
    // Inline text sits at about 19px, which is a miss with a thumb. The padding
    // grows the hit box and the negative margin hands the space back, so the
    // line does not move.
    ok('a name is a big enough thing to tap', nameBox.height >= 26, `${nameBox.height}px`);

    await worst.click();
    await ph.waitForSelector('.person-menu', { timeout: 15000 });
    const sheet = await ph.locator('.person-menu').boundingBox();
    ok('the menu is fully on screen from the left', sheet.x >= 0, String(sheet.x));
    ok('and does not run off the right', sheet.x + sheet.width <= 360,
      `${(sheet.x + sheet.width).toFixed(0)} of 360`);
    ok('and is not below the fold', sheet.y + sheet.height <= 740,
      `${(sheet.y + sheet.height).toFixed(0)} of 740`);

    const sideways = await ph.evaluate(() => ({
      doc: document.documentElement.scrollWidth, win: window.innerWidth,
    }));
    // The layout rule this broke: the page body must never scroll sideways.
    ok('and the page still does not scroll sideways',
      sideways.doc <= sideways.win, JSON.stringify(sideways));

    ok('there is a visible way to dismiss it',
      (await ph.locator('.person-scrim').count()) === 1);

    // Growing it must not push it off the bottom either — the hand form is the
    // tallest this gets.
    await ph.locator('.person-menu button:has-text("Hand them something")').click();
    await ph.waitForSelector('.person-hand', { timeout: 10000 });
    const grown = await ph.locator('.person-menu').boundingBox();
    ok('and it stays on screen with the hand form open',
      grown.y + grown.height <= 740, `${(grown.y + grown.height).toFixed(0)} of 740`);

    const tap = await ph.locator('.person-menu .btn').first().boundingBox();
    ok('its buttons are thumb-sized', tap.height >= 36, `${tap.height}px`);

    await ph.locator('.person-scrim').click({ position: { x: 180, y: 40 } });
    await ph.waitForSelector('.person-menu', { state: 'detached', timeout: 10000 });
    ok('tapping the page behind closes it', true);
    ok('no page errors on the phone', phoneErrs.length === 0, phoneErrs.join(' | '));
    await phone.close();

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (b) await b.close();
    try { await db.close(); } catch { /* already shut */ }
    proc.kill();
  }
  console.log(fails === 0
    ? '\nA name does something, a line can be fixed, and a meeting that is over stays over.'
    : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
