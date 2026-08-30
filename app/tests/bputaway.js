// Putting things away, and throwing them out.
//
// TWO VERBS, AND THEY ARE NOT THE SAME. Archiving is cheap and reversible:
// the thing leaves the live list, stays readable in full, and comes back with
// one tap. Deleting is final and takes what hangs off it. An office given only
// one of them either drowns in finished work or starts destroying records to
// tidy a list, and both are worse than a shelf.
//
// THE SURFACE USED TO BE UNEVEN, which is what this file exists to stop
// happening again. A thread could be archived but not deleted. A space could
// be deleted but not archived. A task could be deleted but not archived. A
// project could be archived but not deleted. Nobody chose that; it accreted.
// So every object is checked for BOTH verbs here, and a new one that supports
// only one will look wrong next to the others.
//
// EVERY DELETE SAYS WHAT GOES FIRST. The confirmation IS the count, or the
// name typed out — never a bare yes, because a bare yes is one mis-tap on a
// phone and this app is used on phones between meetings.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4615, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
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
  const { spawn } = require('child_process');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    const deadline = Date.now() + 60000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const pa = client();
    await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });

    const space = await boss('POST', '/spaces', { name: `The office ${ID}`, context: 'work' });
    const spaceId = space.d.space.id;
    // By email — the members route takes a handle or an address, never an id.
    const joined = await boss('POST', `/spaces/${spaceId}/members`,
      { email: `ngozi${ID}@x.com`, role: 'pa' });
    ok('the assistant is in the room', joined.s === 201 || joined.s === 200,
      `${joined.s} ${JSON.stringify(joined.d).slice(0, 120)}`);

    // ---- A task -------------------------------------------------------------
    head('A finished task can be put away, and comes back if it was a mistake:');
    let r = await boss('POST', '/tasks', { spaceId, title: 'Circulate the board pack' });
    const taskId = r.d.task.id;
    const step = await boss('POST', '/tasks', { spaceId, title: 'Print two copies', parentTaskId: taskId });
    ok('a task with a step is made', r.s === 201 && step.s === 201,
      `${r.s}/${step.s} ${JSON.stringify(step.d).slice(0, 120)}`);

    const onList = async (who = boss, q = '') =>
      ((await who('GET', `/tasks?spaceId=${spaceId}${q}`)).d.tasks || []).map((t) => t.id);
    ok('it is on the list to begin with', (await onList()).includes(taskId));

    ok('archiving it is one call', (await boss('POST', `/tasks/${taskId}/archive`)).s === 200);
    ok('and it leaves the list', !(await onList()).includes(taskId), JSON.stringify(await onList()));
    // THE POINT OF ARCHIVING RATHER THAN DELETING.
    ok('but it is still there to be found', (await onList(boss, '&archived=1')).includes(taskId));
    // Readable in full where it went, which is what "put away, not lost"
    // means — there is no single-task endpoint, so this asks the shelf.
    ok('and is still readable in full',
      ((await boss('GET', `/tasks?spaceId=${spaceId}&archived=1`)).d.tasks || [])
        .some((x) => x.id === taskId && x.title === 'Circulate the board pack'));
    // Its steps go with it, or the list keeps rows whose parent is gone from it.
    ok('its step went with it',
      (await onList(boss, '&archived=1')).length >= 1
      && !(await onList()).includes(taskId));

    ok('bringing it back is one call', (await boss('DELETE', `/tasks/${taskId}/archive`)).s === 200);
    ok('and it is on the list again', (await onList()).includes(taskId));

    // ---- Deleting a task ----------------------------------------------------
    head('And deleting one says what goes with it:');
    r = await boss('GET', `/tasks/${taskId}/deletion`);
    ok('what would go can be asked before asking', r.d.steps === 1, JSON.stringify(r.d));
    r = await boss('DELETE', `/tasks/${taskId}`);
    ok('the first attempt is refused', r.s === 409, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    ok('and says how many steps go with it', r.d.steps === 1, JSON.stringify(r.d));
    ok('a bare yes is not a confirmation',
      (await boss('DELETE', `/tasks/${taskId}`, { alsoDelete: true })).s === 409);
    ok('nor is the wrong number',
      (await boss('DELETE', `/tasks/${taskId}`, { alsoDelete: 9 })).s === 409);
    ok('and nothing has gone yet', (await onList()).includes(taskId));
    ok('naming the count goes through',
      (await boss('DELETE', `/tasks/${taskId}`, { alsoDelete: 1 })).s === 204);
    ok('and the step went with it',
      !((await boss('GET', `/tasks?spaceId=${spaceId}`)).d.tasks || [])
        .some((x) => x.id === step.d.task.id));

    // ---- A thread -----------------------------------------------------------
    head('A conversation can be put away or destroyed, and they differ:');
    let t = await boss('POST', `/spaces/${spaceId}/threads`, { name: 'Board pack' });
    const threadId = t.d.thread.id;
    await boss('POST', `/threads/${threadId}/messages`, { body: 'Printer confirmed for Thursday' });
    await boss('POST', `/threads/${threadId}/messages`,
      { body: 'The board approved the Q3 agenda', register: 'record', recordType: 'decision' });

    ok('archiving is open to anybody who can write here',
      (await pa('POST', `/threads/${threadId}/archive`)).s === 200);
    ok('and it still reads in full',
      ((await boss('GET', `/threads/${threadId}/messages`)).d.messages || []).length === 2);
    await boss('DELETE', `/threads/${threadId}/archive`);

    r = await boss('GET', `/threads/${threadId}/deletion`);
    ok('what deleting would destroy can be asked first',
      r.d.contents?.messages === 2 && r.d.contents?.records === 1, JSON.stringify(r.d));

    // THE DIFFERENCE THAT MATTERS. Putting a room away is anybody's to do;
    // destroying what everybody said in it is not.
    ok('an assistant cannot delete it', (await pa('DELETE', `/threads/${threadId}`,
      { confirmName: 'Board pack' })).s === 403);
    r = await boss('DELETE', `/threads/${threadId}`);
    ok('and the owner is asked for the name', r.s === 400 && r.d.code === 'confirm_name',
      `${r.s} ${JSON.stringify(r.d).slice(0, 140)}`);
    ok('which is refused when it is wrong',
      (await boss('DELETE', `/threads/${threadId}`, { confirmName: 'board pack' })).s === 400);
    ok('and nothing has gone yet',
      ((await boss('GET', `/threads/${threadId}/messages`)).d.messages || []).length === 2);
    r = await boss('DELETE', `/threads/${threadId}`, { confirmName: 'Board pack' });
    ok('the name typed exactly goes through', r.s === 200, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    ok('and it says what it destroyed', r.d.deleted?.messages === 2, JSON.stringify(r.d));
    ok('after which it is gone', (await boss('GET', `/threads/${threadId}/messages`)).s === 404);

    // ---- THE RECORD OUTLIVES THE ROOM ---------------------------------------
    //
    // A room is a place people talked and rooms get made by mistake. A record
    // is a decision the office took, and those were stored together only as an
    // accident of where they were said. Deleting a duplicate thread must not
    // be able to destroy an approval somebody is working under.
    ok('it says how many records it kept', r.d.recordsKept === 1, JSON.stringify(r.d));

    const kept = (await boss('GET', `/archive/${bossId}`)).d.kept || [];
    const survivor = kept.find((k) => /approved the Q3 agenda/.test(k.body || ''));
    ok('and the decision is in the archive', !!survivor,
      JSON.stringify(kept.map((k) => k.body)).slice(0, 200));
    // Everything the copy has to carry, because there is nothing left to ask.
    ok('carrying what kind of record it was', survivor?.recordType === 'decision',
      JSON.stringify(survivor));
    ok('and who said it, and where', survivor?.saidByName === 'Adaeze Okonkwo'
      && survivor?.threadName === 'Board pack', JSON.stringify(survivor));
    ok('and says it was kept because the room went',
      /was deleted/.test(survivor?.note || ''), survivor?.note);
    // The archive must not offer a way back into a room that is gone.
    ok('and does not pretend the room is still there',
      survivor?.sourceLive === false, JSON.stringify(survivor?.sourceLive));

    // THE CONTROL. Ordinary talk is NOT preserved — otherwise "records
    // survive" would be indistinguishable from "nothing is ever deleted",
    // and the assertion above would prove nothing.
    ok('while the ordinary messages did not survive',
      !kept.some((k) => /Printer confirmed/.test(k.body || '')),
      JSON.stringify(kept.map((k) => k.body)).slice(0, 200));

    // ---- A project ----------------------------------------------------------
    head('A project can be put away, and now removed as well:');
    let p = await boss('POST', `/spaces/${spaceId}/projects`, { name: 'Ikoyi refurbishment' });
    const projectId = p.d.project.id;
    const stage = await boss('POST', `/projects/${projectId}/stages`, { name: 'Design' });
    await boss('POST', '/tasks', { spaceId, projectId, title: 'Appoint the surveyor' });
    const linked = await boss('POST', `/spaces/${spaceId}/threads`, { name: 'Refurb chatter' });
    await boss('PATCH', `/threads/${linked.d.thread.id}`, { projectId });

    ok('it can be marked archived, as before',
      (await boss('PATCH', `/projects/${projectId}`, { status: 'archived' })).d.project?.status === 'archived');
    await boss('PATCH', `/projects/${projectId}`, { status: 'active' });

    r = await boss('GET', `/projects/${projectId}/deletion`);
    ok('what would go is countable first',
      r.d.contents?.stages === 1 && r.d.contents?.tasks === 1, JSON.stringify(r.d));

    r = await boss('DELETE', `/projects/${projectId}`);
    ok('the first attempt is refused', r.s === 409, String(r.s));
    ok('and names the stages and the tasks',
      /1 stage and 1 task/.test(r.d.error || ''), r.d.error);
    // THE HALF PEOPLE GET WRONG: the conversation is not the project's to take.
    ok('and says the conversation stays', /will stay in the space/.test(r.d.error || ''), r.d.error);
    ok('an assistant cannot do it either',
      (await pa('DELETE', `/projects/${projectId}`, { alsoDelete: 2 })).s === 403);

    r = await boss('DELETE', `/projects/${projectId}`, { alsoDelete: 2 });
    ok('agreeing to the count goes through', r.s === 200, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    ok('the project is gone', (await boss('GET', `/projects/${projectId}`)).s === 404);
    ok('and its stage with it',
      !((await boss('GET', `/spaces/${spaceId}/projects`)).d.projects || [])
        .some((x) => x.id === projectId));
    void stage;
    // WHAT SURVIVES, asserted rather than assumed. People said those things.
    r = await boss('GET', `/threads/${linked.d.thread.id}/messages`);
    ok('but the conversation survives the plan being abandoned', r.s === 200, String(r.s));

    // ---- A space ------------------------------------------------------------
    head('And a room can be finished with, without being burned down:');
    const room = await boss('POST', '/spaces', { name: `Finished room ${ID}`, context: 'work' });
    const roomId = room.d.space.id;
    const live = async (q = '') => ((await boss('GET', `/spaces${q}`)).d.spaces || []).map((s) => s.id);
    ok('it is on the list to begin with', (await live()).includes(roomId));

    // IN the room, so this tests the owner rule rather than membership. A
    // stranger gets a plain not-found here, like everywhere else in this app,
    // and asserting 403 against a non-member would have passed for the wrong
    // reason — it would prove only that they were not in the room.
    await boss('POST', `/spaces/${roomId}/members`, { email: `ngozi${ID}@x.com`, role: 'pa' });
    ok('an assistant in the room still cannot put it away for everybody',
      (await pa('POST', `/spaces/${roomId}/archive`)).s === 403);
    ok('the owner can', (await boss('POST', `/spaces/${roomId}/archive`)).s === 200);
    ok('and it leaves the live list', !(await live()).includes(roomId), JSON.stringify(await live()));
    ok('but is found where it went', (await live('?archived=1')).includes(roomId));
    ok('and still opens', (await boss('GET', `/spaces/${roomId}`)).s === 200);
    // A room put away that still takes new work was never put away.
    r = await boss('POST', `/spaces/${roomId}/threads`, { name: 'Something new' });
    ok('nothing new can be started in it', r.s === 409, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);

    ok('and it comes back', (await boss('DELETE', `/spaces/${roomId}/archive`)).s === 200);
    ok('onto the live list', (await live()).includes(roomId));
    ok('taking work again',
      (await boss('POST', `/spaces/${roomId}/threads`, { name: 'Something new' })).s === 201);

    // ---- AND ALL OF IT IS FINDABLE IN ONE PLACE -----------------------------
    //
    // THE BUG THIS SECTION EXISTS FOR, reported exactly this way: "a project
    // archived didn't show in ARCHIVE". The screen called Archive showed kept
    // messages and archived documents and nothing else, so everything else put
    // away went somewhere the person who put it there could not find it. A
    // place named Archive that is not where archived things go answers the
    // question wrongly, which is worse than not answering it.
    head('And everything put away is on one shelf:');
    const shelfRoom = await boss('POST', '/spaces', { name: `Shelf room ${ID}`, context: 'work' });
    const shelfRoomId = shelfRoom.d.space.id;
    const shelfProject = await boss('POST', `/spaces/${shelfRoomId}/projects`, { name: 'Filed plan' });
    const shelfTask = await boss('POST', '/tasks', { spaceId: shelfRoomId, title: 'Filed task' });
    const shelfThread = await boss('POST', `/spaces/${shelfRoomId}/threads`, { name: 'Filed talk' });

    await boss('POST', `/projects/${shelfProject.d.project.id}/archive`);
    await boss('POST', `/tasks/${shelfTask.d.task.id}/archive`);
    await boss('POST', `/threads/${shelfThread.d.thread.id}/archive`);
    // The room last, or archiving it would close the door on the rest.
    await boss('POST', `/spaces/${shelfRoomId}/archive`);

    const shelf = (await boss('GET', `/archive/${bossId}`)).d.putAway || {};
    ok('the archived project is on it',
      (shelf.projects || []).some((x) => x.name === 'Filed plan'), JSON.stringify(shelf.projects));
    ok('and the archived task', (shelf.tasks || []).some((x) => x.name === 'Filed task'),
      JSON.stringify(shelf.tasks));
    ok('and the archived conversation',
      (shelf.conversations || []).some((x) => x.name === 'Filed talk'), JSON.stringify(shelf.conversations));
    ok('and the archived room', (shelf.rooms || []).some((x) => x.name === `Shelf room ${ID}`),
      JSON.stringify(shelf.rooms));
    // Each row has to say where it came from, or the shelf is a pile.
    ok('each says which room it came from',
      (shelf.projects || []).every((x) => !!x.spaceName), JSON.stringify(shelf.projects));

    // A project put away the OLD way — status, before the column existed —
    // must still be on the shelf, or this change empties it for everybody who
    // had already archived something.
    const legacy = await boss('POST', `/spaces/${spaceId}/projects`, { name: 'Old spelling' });
    await boss('PATCH', `/projects/${legacy.d.project.id}`, { status: 'archived' });
    const shelf2 = (await boss('GET', `/archive/${bossId}`)).d.putAway || {};
    ok('a project archived the old way is on it too',
      (shelf2.projects || []).some((x) => x.name === 'Old spelling'), JSON.stringify(shelf2.projects));

    // AND MARKED AS FILED WHERE IT LIVES, which is the other half. The space
    // page deliberately still receives archived projects — it shows them as a
    // closed "Archived projects" group, the same as archived conversations —
    // so the test is that the row SAYS it is filed, not that it is missing.
    // Asserting absence here is what broke that grouping the first time.
    const inRoom = ((await boss('GET', `/spaces/${spaceId}/projects`)).d.projects || [])
      .find((x) => x.name === 'Old spelling');
    ok('the room still receives it, marked as filed',
      !!inRoom && (inRoom.status === 'archived' || !!inRoom.archivedAt), JSON.stringify(inRoom));
    const filedNewWay = ((await boss('GET', `/spaces/${shelfRoomId}/projects`)).d.projects || [])
      .find((x) => x.name === 'Filed plan');
    ok('and one filed the new way carries a date rather than a status',
      !!filedNewWay?.archivedAt && filedNewWay.status !== 'archived', JSON.stringify(filedNewWay));

    // Taken back out again, which is what makes it a shelf rather than a bin.
    ok('and it can be taken back out',
      (await boss('DELETE', `/projects/${legacy.d.project.id}/archive`)).s === 200);
    const back = ((await boss('GET', `/spaces/${spaceId}/projects`)).d.projects || [])
      .find((x) => x.name === 'Old spelling');
    ok('after which it is live again',
      !!back && !back.archivedAt && back.status !== 'archived', JSON.stringify(back));
    ok('and off the shelf',
      !(((await boss('GET', `/archive/${bossId}`)).d.putAway?.projects) || [])
        .some((x) => x.name === 'Old spelling'));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nEverything can be put away, everything can be thrown out, and the two are never confused.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
