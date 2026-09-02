// The conversation carries on, whatever the line has become.
//
// THE REPORT: "once a task is assigned, the conversation can not be continued."
// It was true, and the shape of it was wider than tasks. A thread was a flat
// run of messages, which is right for "car's outside" and wrong for the three
// things a line can turn into, all of which are frozen the moment they do:
//
//   - a RECORD locks its body on first acknowledgement, on purpose, so what
//     people agreed to cannot change under them;
//   - a VOICE NOTE is a recording nobody can amend;
//   - a TASK moves the work off to a list with a status dropdown and no words.
//
// Ask "which Thursday?" about any of those and the question went into the flat
// run, ten lines below the thing it was about, attached to nothing. Worse for a
// task: the message it came from carried no sign that anything had happened to
// it, and the task carried no way back.
//
// The fix is not to unfreeze any of them — the freezing is the point. It is to
// let an ordinary note be pinned to the thing it answers, and to hang the task
// back on the line it came out of. So what this suite proves is that every
// format is answerable and none of them had to become editable to be so.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4571, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
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
  let b = null;
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

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

    const today = await boss('GET', `/today/${bossId}`);
    const threadId = today.d.directLine?.threadId;
    ok('the direct line is there', !!threadId, JSON.stringify(today.d.directLine));

    // ---- The reported case ------------------------------------------------
    head('An instruction is given, and turned into work:');
    const said = await boss('POST', `/threads/${threadId}/messages`,
      { body: 'Book the car for six tomorrow' });
    const saidId = said.d.id;
    const task = await boss('POST', '/tasks',
      { sourceMessageId: saidId, title: 'Book the car', assigneeId: paId });
    ok('the task is created and assigned', task.s === 201 && task.d.task.assigneeId === paId,
      JSON.stringify(task.d).slice(0, 140));

    const withTask = await boss('GET', `/threads/${threadId}/messages`);
    const line = withTask.d.messages.find((m) => m.id === saidId);
    ok('and the line it came from now says so, rather than looking untouched',
      line.tasks.length === 1 && line.tasks[0].id === task.d.task.id,
      JSON.stringify(line.tasks));
    ok('carrying who it fell to', line.tasks[0].assigneeName === 'Ngozi Bello');
    ok('and where it has got to', line.tasks[0].status === 'open');

    head('The assistant answers the line the task came out of:');
    const asked = await pa('POST', `/threads/${threadId}/messages`,
      { body: 'For what time exactly?', replyToId: saidId });
    ok('which is allowed — this is the whole complaint', asked.s === 201, JSON.stringify(asked.d));

    const read = await boss('GET', `/threads/${threadId}/messages`);
    const answer = read.d.messages.find((m) => m.id === asked.d.id);
    ok('and the answer knows what it is answering', answer.replyTo?.id === saidId,
      JSON.stringify(answer.replyTo));
    ok('naming who said it, so it reads as a quotation',
      answer.replyTo.authorName === 'Adaeze Okonkwo', answer.replyTo.authorName);

    // A pointer, not a second copy. If the stub carried everything the message
    // does, there would be two versions of one message travelling in the same
    // response — the exact shape of every drift bug in this codebase.
    ok('the quotation is a stub rather than a whole second message',
      answer.replyTo.acks === undefined && answer.replyTo.voice === undefined,
      Object.keys(answer.replyTo).join(','));

    // ---- The frozen formats ----------------------------------------------
    head('A record, which cannot be edited once acknowledged:');
    const rec = await boss('POST', `/threads/${threadId}/messages`,
      { body: 'The car is at six, every Tuesday.', register: 'record', recordType: 'decision' });
    ok('acknowledging it freezes the body',
      (await pa('POST', `/threads/${threadId}/messages/${rec.d.id}/ack`)).d.locked === true);
    ok('editing it is refused, which is the point',
      (await boss('PATCH', `/threads/${threadId}/messages/${rec.d.id}`, { body: 'seven' })).s === 409);

    const query = await pa('POST', `/threads/${threadId}/messages`,
      { body: 'Which Tuesday do we start?', replyToId: rec.d.id });
    ok('but asking a question about it is not', query.s === 201, JSON.stringify(query.d));

    const afterQ = await boss('GET', `/threads/${threadId}/messages`);
    const frozen = afterQ.d.messages.find((m) => m.id === rec.d.id);
    ok('and the record is still locked afterwards — a reply is not an amendment',
      frozen.locked === true && frozen.body === 'The car is at six, every Tuesday.',
      `${frozen.locked} / ${frozen.body}`);
    ok('the question is a note, not a second record filed in the formal history',
      afterQ.d.messages.find((m) => m.id === query.d.id).register === 'note');

    head('A voice note, which carries no text to reply beneath:');
    const clip = Buffer.alloc(6000, 7).toString('base64');
    const spoken = await boss('POST', `/threads/${threadId}/voice`,
      { audio: clip, mimeType: 'audio/webm', durationMs: 4000 });
    ok('posts', spoken.s === 201, JSON.stringify(spoken.d).slice(0, 140));
    const heard = await pa('POST', `/threads/${threadId}/messages`,
      { body: 'Understood — the airport, not the office.', replyToId: spoken.d.id });
    ok('and can be answered like anything else', heard.s === 201, JSON.stringify(heard.d));
    const spokenView = (await boss('GET', `/threads/${threadId}/messages`))
      .d.messages.find((m) => m.id === heard.d.id);
    ok('with the quotation saying it was a recording rather than quoting nothing',
      spokenView.replyTo?.id === spoken.d.id && spokenView.replyTo.body === null,
      JSON.stringify(spokenView.replyTo));

    // A recording can also BE the answer. Half a reply mechanism — typed only —
    // would be no mechanism at all for the person who speaks rather than types.
    const spokenBack = await pa('POST', `/threads/${threadId}/voice`,
      { audio: clip, mimeType: 'audio/webm', durationMs: 3000, replyToId: rec.d.id });
    ok('and a recording can itself be a reply', spokenBack.s === 201,
      JSON.stringify(spokenBack.d).slice(0, 140));
    ok('pinned to what it answers',
      (await boss('GET', `/threads/${threadId}/messages`))
        .d.messages.find((m) => m.id === spokenBack.d.id).replyTo?.id === rec.d.id);

    // ---- The boundary -----------------------------------------------------
    head('A reply cannot reach into another room:');
    const elsewhere = await boss('POST', '/spaces', { name: 'Elsewhere', context: 'work' });
    const otherThread = await boss('POST', `/spaces/${elsewhere.d.space.id}/threads`, { name: 'Private' });
    const otherMsg = await boss('POST', `/threads/${otherThread.d.thread.id}/messages`,
      { body: 'What the assistant must not be shown' });

    // The PA is not in that space at all. Quoting across the boundary would
    // render the line inside a room they can read, which is a leak dressed up
    // as a convenience.
    const sneak = await pa('POST', `/threads/${threadId}/messages`,
      { body: 'nothing to see here', replyToId: otherMsg.d.id });
    ok('naming a message from a space you cannot see is refused', sneak.s === 400, String(sneak.s));
    ok('and says so plainly rather than dropping the anchor in silence',
      /not in this conversation/i.test(sneak.d.error || ''), sneak.d.error);
    // Silently dropping it would be worse than refusing: the sender would see a
    // reply that landed, and the reader a message pinned to nothing.
    ok('nothing was posted', !(await boss('GET', `/threads/${threadId}/messages`))
      .d.messages.some((m) => m.body === 'nothing to see here'));

    // Even the principal, who CAN see both rooms, may not quote across them.
    // The rule is about the room, not about the reader.
    ok('not even for somebody who can read both rooms',
      (await boss('POST', `/threads/${threadId}/messages`,
        { body: 'cross-posting', replyToId: otherMsg.d.id })).s === 400);

    // ---- The way back, from the task ---------------------------------------
    head('The task can always find the conversation again:');
    const mine = await pa('GET', '/tasks/mine');
    const assigned = mine.d.tasks.find((t) => t.id === task.d.task.id);
    ok('a task from a message carries the thread', assigned.sourceThreadId === threadId);
    ok('and the exact line, so the link lands on it rather than at the foot of the room',
      assigned.sourceMessageId === saidId);

    // The other door in. A pad line has no source message — that is the whole
    // point of the pad, a thought caught before it knows where it belongs — so
    // the link back has to be followed the other way, from the line that points
    // forward at the task.
    const note = await boss('POST', '/pad', { body: 'Chase the visa people' });
    await boss('POST', `/pad/${note.d.item.id}/hand`, { toUserId: paId });
    await pa('POST', `/pad/${note.d.item.id}/replies`, { body: 'Which consulate?' });
    const spaces = await boss('GET', '/spaces');
    const promoted = await boss('POST', `/pad/${note.d.item.id}/task`,
      { spaceId: spaces.d.spaces[0].id });
    ok('a pad line becomes a task', promoted.s === 201, JSON.stringify(promoted.d).slice(0, 140));

    const inSpace = await boss('GET', `/tasks?spaceId=${spaces.d.spaces[0].id}`);
    const fromPad = inSpace.d.tasks.find((t) => t.id === promoted.d.taskId);
    // IT LANDS IN THE ROOM NOW, and that is a change of contract rather than a
    // drift. A task promoted to a space used to carry no source message, so it
    // appeared on the space's task list and in nobody's conversation — work
    // handed to an office arriving somewhere only a person already looking for
    // it would find. The line is posted and the task hangs off it, exactly as
    // one made from a message does.
    ok('and lands in the space\'s room rather than only on its list',
      !!fromPad.sourceMessageId && !!fromPad.sourceThreadId,
      JSON.stringify({ m: fromPad.sourceMessageId, t: fromPad.sourceThreadId }));
    ok('while still pointing back at the note it came from',
      fromPad.sourcePadItemId === note.d.item.id, fromPad.sourcePadItemId);
    ok('whose conversation is still there to carry on',
      (await pa('GET', `/pad/${note.d.item.id}/replies`)).d.replies.length === 1);
    ok('and can still be added to after the promotion',
      (await pa('POST', `/pad/${note.d.item.id}/replies`, { body: 'Abuja.' })).s === 201);

    // ---- On the screen -----------------------------------------------------
    head('Through the browser, which is where it was reported:');
    b = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const p = await b.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}/login`);
    await p.fill('#email', `ngozi${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Log in")');
    await p.waitForURL(/\/workspace|\/today/, { timeout: 20000 });

    await p.goto(`${BASE}/threads/${threadId}`);
    // The task chip arrives with the messages, so waiting for it waits for a
    // loaded page rather than for the shell.
    await p.waitForSelector('.msg-task', { timeout: 20000 });

    const instructed = p.locator(`#m-${saidId}`);
    // Pick it first: the verbs belong to the message somebody tapped.
    await instructed.click({ position: { x: 5, y: 5 } });
    ok('the line that became a task says so on the line itself',
      /Book the car/.test(await instructed.locator('.msg-task').innerText()),
      await instructed.locator('.msg-task').innerText());
    ok('with its state, so the room can see where the work has got to',
      /open/i.test(await instructed.locator('.msg-task-state').innerText()));
    ok('and STILL offers to reply, which is what was missing',
      (await instructed.locator('button:has-text("Reply")').count()) === 1);

    await instructed.locator('button:has-text("Reply")').click();
    await p.waitForSelector('.msg-replying', { timeout: 10000 });
    const pinned = await p.locator('.msg-replying').innerText();
    ok('the composer says what it is about to answer', /Adaeze/.test(pinned), pinned);
    ok('quoting the line', /Book the car for six/.test(pinned), pinned);

    await p.fill('textarea[aria-label="Message"]', 'Booked — six sharp.');
    await p.click('.msg-compose button:has-text("Send")');
    await p.waitForSelector('.msg-quote', { timeout: 15000 });
    ok('the answer posts with its quotation attached',
      (await p.locator('.msg-quote').count()) >= 1);
    // STOPS is a change over time, so it needs a wait rather than a snapshot.
    // This read the count the instant the quotation appeared, which is a
    // different state update from the composer clearing its pin — on a slower
    // backend the pin was simply still there for another beat. Waiting with a
    // bound keeps the assertion real: if it never clears, the wait runs out and
    // this goes red, which is exactly what a broken composer should do.
    const cleared = await p.waitForFunction(
      () => document.querySelectorAll('.msg-replying').length === 0,
      null, { timeout: 15000 },
    ).then(() => true).catch(() => false);
    ok('and the composer stops claiming to be a reply', cleared,
      cleared ? '' : `still pinned after 15s: ${await p.locator('.msg-replying').innerText().catch(() => '?')}`);

    head('A record on the screen — the frozen one:');
    const recordEl = p.locator(`#m-${rec.d.id}`);
    await recordEl.click({ position: { x: 5, y: 5 } });
    ok('shows it is locked', /locked/i.test(await recordEl.innerText()));
    ok('offers no way to edit it', (await recordEl.locator('button:has-text("Edit")').count()) === 0);
    ok('and offers Reply anyway',
      (await recordEl.locator('button:has-text("Reply")').count()) === 1);

    head('Arriving from the task, at the line rather than the room:');
    await p.goto(`${BASE}/tasks`);
    await p.waitForSelector('.task-row', { timeout: 20000 });
    // Named rather than taken first: both of this assistant's tasks offer a way
    // back, and picking whichever sorted first would pass for the wrong reason
    // on any day the ordering changed.
    const back = p.locator('.task-row:has-text("Book the car") a:has-text("carry on the conversation")');
    ok('the task from a message offers a way back into the conversation',
      (await back.count()) === 1);
    // BOTH LEAD TO A ROOM NOW. A task promoted from the pad used to lead back
    // to the settled note, because the room had never been told about it. Now
    // the line is posted where the work was sent, and the room is the more
    // useful destination: it is where the people who have to act on it are.
    // The note still points forward at the task, so nothing is lost.
    ok('and so does the one promoted from the pad, pointing at the room it landed in',
      /\/threads\//.test(await p.locator('.task-row:has-text("Chase the visa people") a:has-text("carry on the conversation")')
        .getAttribute('href') || ''));

    await back.click();
    // Not waitForURL: this is a client-side navigation, so there is no load
    // event to wait for and the default wait would time out on a page that had
    // in fact arrived.
    await p.waitForFunction(
      (t) => window.location.pathname === `/threads/${t}`, threadId, { timeout: 20000 },
    );
    await p.waitForSelector(`#m-${saidId}`, { timeout: 20000 });
    // The follow-along scroll used to win every race and drop the reader at the
    // foot of the room. Landing ON the line is the whole point of the link.
    const landed = await p.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: window.innerHeight };
    }, `m-${saidId}`);
    ok('and lands on the line it named, not at the end of the thread',
      landed && landed.bottom > 0 && landed.top < landed.h,
      JSON.stringify(landed));

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (b) await b.close();
    proc.kill();
  }
  console.log(fails === 0
    ? '\nNothing a line turns into is the end of talking about it.'
    : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
