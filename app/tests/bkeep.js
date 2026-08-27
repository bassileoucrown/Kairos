// Work that lands where it was sent, and a room you can put away.
//
// THREE THINGS, ONE THEME: the app knew where something belonged and would not
// say so, or knew a thing was finished and had nowhere to put it.
//
//   A TASK PROMOTED FROM THE PAD carried no source message, so it appeared on
//   the space's task list and in nobody's conversation. Work handed to an
//   office arrived somewhere only a person already looking for it would find —
//   the exact failure the pad exists to prevent, moved one step along.
//
//   A SPACE COULD NOT BE RENAMED IF IT WAS PRIVATE. The guard belonged to
//   delegation and sat at the top of the handler, so renaming was refused with
//   a sentence about delegating — wrong, and confusing on the space most likely
//   to have been named in a hurry.
//
//   NOTHING COULD BE FINISHED. A room stayed live forever or was deleted, and
//   deleting a room to tidy a list is how a decision trail disappears.
//
// The three worth watching hardest are the ones where being wrong is expensive:
//
//   AN ARCHIVED ROOM MUST BE CLOSED ON EVERY WAY IN. There are nine ways to put
//   something into a thread, and a rule enforced on some of them is not a rule.
//
//   CLOSING A SPACE HAS NO UNDO, so the name has to be typed and the SERVER has
//   to be the one checking — a guard only the screen enforces is decoration.
//
//   THE APP'S OWN ROOMS are not deletable: the direct line exists because two
//   people have a relationship, and deleting it would have the app recreate it
//   empty, which looks exactly like data loss because it is.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4587, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
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

  let browser = null;
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

    // ---- The pad hands work to a room -------------------------------------
    head('Work handed over from the pad turns up in the room it was sent to:');
    const office = (await boss('GET', `/today/${bossId}`)).d.directLine;
    ok('the office has a room', !!office?.threadId, JSON.stringify(office));

    let r = await boss('POST', '/pad', { body: 'Get the board pack printed' });
    const noteId = r.d.item.id;
    ok('a line can be written on the pad', r.s === 201, JSON.stringify(r.d).slice(0, 140));

    r = await boss('POST', `/pad/${noteId}/task`,
      { spaceId: office.spaceId, assigneeId: paId });
    ok('and handed to the office as a task', r.s === 201, JSON.stringify(r.d).slice(0, 200));
    const taskId = r.d.taskId;
    ok('and it says which room it landed in', r.d.threadId === office.threadId,
      `${r.d.threadId} vs ${office.threadId}`);

    // THE POINT OF THE WHOLE THING. It used to be filed with no source
    // message, so it showed on a list and in nobody's conversation.
    const msgs = await pa('GET', `/threads/${office.threadId}/messages`);
    const line = msgs.d.messages.find((m) => /board pack/.test(m.body || ''));
    ok('the office can see it in the conversation', !!line,
      JSON.stringify(msgs.d.messages.map((m) => m.body)));
    ok('with the task hanging off that very line',
      (line?.tasks || []).some((t) => t.id === taskId), JSON.stringify(line?.tasks));
    ok('and it is the assistant who has it',
      (line?.tasks || [])[0]?.assigneeName === 'Ngozi Bello',
      JSON.stringify(line?.tasks));

    // A space with no conversation gets its task and no invented room.
    const quiet = await boss('POST', '/spaces', { name: `Quiet ${ID}`, context: 'work' });
    r = await boss('POST', '/pad', { body: 'Something with nowhere to say it' });
    r = await boss('POST', `/pad/${r.d.item.id}/task`, { spaceId: quiet.d.space.id });
    ok('a space with no room still gets the task', r.s === 201, JSON.stringify(r.d).slice(0, 140));
    ok('and no conversation is invented for it', r.d.threadId === null, String(r.d.threadId));

    // ---- Renaming ----------------------------------------------------------
    head('A space can be renamed, whatever kind it is:');
    const work = await boss('POST', '/spaces', { name: `Lagos move ${ID}`, context: 'work' });
    const workId = work.d.space.id;
    r = await boss('PATCH', `/spaces/${workId}`, { name: `Lagos move — done ${ID}` });
    ok('a work space renames', r.s === 200, JSON.stringify(r.d).slice(0, 140));
    ok('and the new name sticks', r.d.space.name === `Lagos move — done ${ID}`, r.d.space.name);

    // THE BUG. The private guard belonged to delegation and refused the rename
    // with a sentence about delegating.
    const priv = await boss('POST', '/spaces', { name: `Mine ${ID}`, context: 'private' });
    r = await boss('PATCH', `/spaces/${priv.d.space.id}`, { name: `Mine, renamed ${ID}` });
    ok('and so does a private one, which used to be refused', r.s === 200,
      `${r.s} ${JSON.stringify(r.d)}`);
    // The guard itself must still hold for the thing it was written for.
    r = await boss('PATCH', `/spaces/${priv.d.space.id}`, { autoDelegateRoles: ['pa'] });
    ok('but a private space still cannot be delegated to anybody', r.s === 400,
      `${r.s} ${JSON.stringify(r.d)}`);

    r = await pa('PATCH', `/spaces/${workId}`, { name: 'Not mine to rename' });
    ok('and only the owner may rename', r.s === 403, `${r.s} ${JSON.stringify(r.d)}`);

    // ---- Archiving ---------------------------------------------------------
    head('A finished conversation can be put away and still read:');
    const th = await boss('POST', `/spaces/${workId}/threads`, { name: 'Lease terms' });
    const threadId = th.d.thread.id;
    await boss('POST', `/threads/${threadId}/messages`, { body: 'The break clause is at five years.' });
    await boss('POST', `/threads/${threadId}/messages`,
      { body: 'Signed on the eleventh.', register: 'record', recordType: 'decision' });

    r = await boss('POST', `/threads/${threadId}/archive`);
    ok('it can be archived', r.s === 200 && !!r.d.archivedAt, JSON.stringify(r.d));

    const still = await boss('GET', `/threads/${threadId}/messages`);
    ok('every word in it is still there', still.d.messages.length === 2,
      String(still.d.messages.length));
    ok('and it says it is archived', !!still.d.thread.archivedAt, JSON.stringify(still.d.thread));
    ok('the space lists it as archived rather than losing it',
      (await boss('GET', `/spaces/${workId}`)).d.threads
        .some((t) => t.id === threadId && t.archivedAt),
      JSON.stringify((await boss('GET', `/spaces/${workId}`)).d.threads));

    // EVERY WAY IN, because a rule enforced on some of them is not a rule.
    head('And it is closed on every way in, not just the composer:');
    const firstId = still.d.messages[0].id;
    const recId = still.d.messages[1].id;
    ok('no new message', (await boss('POST', `/threads/${threadId}/messages`, { body: 'x' })).s === 409);
    ok('no editing what is there',
      (await boss('PATCH', `/threads/${threadId}/messages/${firstId}`, { body: 'y' })).s === 409);
    ok('no taking a line back',
      (await boss('DELETE', `/threads/${threadId}/messages/${firstId}`)).s === 409);
    ok('no promoting a note to a record',
      (await boss('POST', `/threads/${threadId}/messages/${firstId}/promote`,
        { recordType: 'decision' })).s === 409);
    ok('no acknowledging a record',
      (await pa('POST', `/threads/${threadId}/messages/${recId}/ack`)).s === 409);
    ok('no marking a line done',
      (await boss('POST', `/threads/${threadId}/messages/${firstId}/done`)).s === 409);
    ok('and no superseding a record',
      (await boss('POST', `/threads/${threadId}/messages/${recId}/supersede`,
        { body: 'Actually the ninth', recordType: 'decision' })).s === 409);
    // Reading is untouched: that is the entire point of archiving rather than
    // deleting.
    ok('but reading it is untouched',
      (await pa('GET', `/threads/${threadId}/messages`)).s === 200);

    head('And taking it back out reopens it:');
    r = await boss('DELETE', `/threads/${threadId}/archive`);
    ok('it comes out of the archive', r.s === 200 && r.d.archivedAt === null, JSON.stringify(r.d));
    ok('and accepts words again',
      (await boss('POST', `/threads/${threadId}/messages`, { body: 'One more thing.' })).s === 201);
    await boss('POST', `/threads/${threadId}/archive`);

    // ---- Closing the space -------------------------------------------------
    head('Closing a space says what it costs, and will not be nudged into it:');
    const contents = await boss('GET', `/spaces/${workId}/contents`);
    ok('what is inside can be counted first', contents.s === 200, JSON.stringify(contents.d));
    ok('and the count is real', contents.d.contents.messages >= 3 && contents.d.contents.records >= 1,
      JSON.stringify(contents.d.contents));

    r = await boss('DELETE', `/spaces/${workId}`);
    ok('closing it without typing the name is refused', r.s === 400, JSON.stringify(r.d).slice(0, 160));
    ok('and the refusal says what would go', !!r.d.contents, JSON.stringify(r.d.contents));
    r = await boss('DELETE', `/spaces/${workId}`, { confirmName: 'something else' });
    ok('so is typing the wrong thing', r.s === 400);

    r = await pa('DELETE', `/spaces/${workId}`, { confirmName: `Lagos move — done ${ID}` });
    ok('an assistant cannot close their principal\'s space', r.s === 403,
      `${r.s} ${JSON.stringify(r.d)}`);

    // THE APP'S OWN ROOMS. Deleting the direct line would have the app rebuild
    // it empty on the next request, which looks exactly like data loss.
    r = await boss('DELETE', `/spaces/${office.spaceId}`, { confirmName: 'anything' });
    ok('and the office itself cannot be closed at all', r.s === 400,
      `${r.s} ${JSON.stringify(r.d)}`);
    ok('being told to archive the conversation instead',
      /archive/i.test(r.d?.error || ''), r.d?.error);

    r = await boss('DELETE', `/spaces/${workId}`, { confirmName: `Lagos move — done ${ID}` });
    ok('but the owner typing the name closes it', r.s === 200, JSON.stringify(r.d).slice(0, 160));
    ok('and it is gone', (await boss('GET', `/spaces/${workId}`)).s === 404);
    ok('taking its conversations with it',
      (await boss('GET', `/threads/${threadId}/messages`)).s === 404);
    // ---- A project, on the screen that shows one -------------------------
    //
    // THE API TOOK BOTH ALL ALONG. PATCH /projects/:id has accepted a name and
    // a status of active|done|archived since projects were built, and the
    // screen offered neither — so a project kept whatever it was called in a
    // hurry, and a finished one sat on the space's list looking live forever.
    // Nothing refused it; there was no way in. That is why this part is driven
    // through the page rather than the API: the API was never the gap.
    head('A project can be renamed and put away, from the screen that shows it:');
    const home = await boss('POST', '/spaces', { name: `Office ${ID}`, context: 'work' });
    const homeId = home.d.space.id;
    const proj = await boss('POST', `/spaces/${homeId}/projects`, { name: 'Lagos office move' });
    const projectId = proj.d.project.id;
    await boss('POST', `/projects/${projectId}/stages`, { name: 'Lease' });

    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `ada${ID}@x.com`, password: PW }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const [ck, cv] = cookie.split('=');
    await ctx.addCookies([{ name: ck, value: cv, domain: '127.0.0.1', path: '/' }]);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    await page.goto(`${BASE}/projects/${projectId}`);
    await page.waitForSelector('.stage-row', { timeout: 20000 });
    ok('there is a way to rename it',
      (await page.locator('button:has-text("Rename")').count()) === 1);

    page.once('dialog', (d) => d.accept('Lagos office move — phase two'));
    await page.click('button:has-text("Rename")');
    await page.waitForFunction(
      () => /phase two/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('and renaming it works end to end', true);
    ok('and the new name is what the space is told',
      (await boss('GET', `/spaces/${homeId}/projects`)).d.projects
        .some((p) => p.name === 'Lagos office move — phase two'));

    await page.click('button:has-text("Archive")');
    await page.waitForFunction(
      () => /is archived/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('it can be archived from the same place', true);
    ok('and the page says so rather than looking identical',
      /left the space's live list/.test(await page.locator('body').innerText()));
    // Archived, not deleted — the whole reason to offer this instead of a
    // delete button.
    ok('while everything in it is still there',
      (await boss('GET', `/projects/${projectId}`)).d.stages.length === 1);

    await page.goto(`${BASE}/spaces/${homeId}`);
    await page.waitForSelector('.space-card', { timeout: 20000 });
    const spaceText = await page.locator('body').innerText();
    ok('the space files it under Archived rather than losing it',
      /Archived projects/.test(spaceText), spaceText.slice(0, 300));
    ok('and it is out of the live list',
      (await page.locator('h3:has-text("Projects") ~ .space-card:not(.is-archived)')
        .filter({ hasText: 'phase two' }).count()) === 0);

    await page.goto(`${BASE}/projects/${projectId}`);
    await page.waitForSelector('button:has-text("Take out of the archive")', { timeout: 20000 });
    ok('and it offers the way back rather than a dead end', true);
    await page.click('button:has-text("Take out of the archive")');
    await page.waitForFunction(
      () => !/is archived/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('which puts it back on the live list',
      (await boss('GET', `/spaces/${homeId}/projects`)).d.projects
        .find((p) => p.id === projectId)?.status === 'active');
    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    proc.kill();
  }

  console.log(fails === 0
    ? '\nWork lands where it was sent, and a finished room can be put away rather than lost.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
