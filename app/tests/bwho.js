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
    ok('your own line offers Edit',
      (await line.locator('button:has-text("Edit")').count()) === 1);
    await line.locator('button:has-text("Edit")').click();
    await p.waitForSelector('.msg-edit', { timeout: 10000 });
    await p.fill('textarea[aria-label="Edit this message"]', 'Car at half six tomorrow');
    await p.click('.msg-edit button:has-text("Save")');
    await p.waitForSelector('.msg-edit', { state: 'detached', timeout: 15000 });
    ok('and saving really changes it',
      /half six/.test(await line.innerText()), (await line.innerText()).slice(0, 120));
    ok('with "edited" against it', /edited/.test(await line.innerText()));

    head('A name on a message:');
    // The assistant's name, not the principal's own — your own name is not a
    // menu, and the screen agrees with the server about that.
    const theirName = p.locator('.msg-who button.person-link', { hasText: 'Ngozi' }).first();
    ok('is clickable', (await theirName.count()) === 1);
    await theirName.click();
    await p.waitForSelector('.person-menu', { timeout: 15000 });
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

    head('A past appointment on screen:');
    await p.goto(`${BASE}/appointments/${bossId}/${gone}`);
    await p.waitForSelector('.card', { timeout: 20000 });
    const page = await p.locator('body').innerText();
    ok('says it has happened', /already happened/i.test(page), page.slice(0, 200));
    ok('and offers none of the three verbs',
      (await p.locator('button:has-text("Move it")').count())
      + (await p.locator('button:has-text("Change the length")').count())
      + (await p.locator('button:has-text("Call it off")').count()) === 0);
    // The point of keeping the page open: what happened gets written afterwards.
    ok('but the minutes are still there to read',
      /second tranche/.test(page), page.slice(0, 300));

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
