// "That is done", which nothing could say until now.
//
// A voice note asking for the car to be booked at six had nowhere to record
// that the car was booked. Both existing mechanisms miss it: an
// acknowledgement means somebody read a decision and agreed to it, and a task
// is the heavy path — right for something with a deadline and an owner, wrong
// for an errand worth thirty seconds. So the direct line accumulated
// instructions with no way to tell the handled from the outstanding.
//
// What is worth proving: it works on a recording with no text at all, which is
// the case that prompted it; it is reversible; it is refused on records,
// because a decision is acknowledged rather than run; and it is genuinely a
// different fact from an acknowledgement rather than the same one renamed.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4557, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
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

    // A principal and the assistant who actually runs the errands.
    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const pa = client();
    await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    const invite = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    const token = invite.d.inviteLink.split("/").pop();
    await pa('POST', `/invites/${token}/accept`);

    // The room is surfaced on Today rather than through a route of its own —
    // it is an ordinary thread, which is the whole design.
    const today = await boss('GET', `/today/${bossId}`);
    const threadId = today.d.directLine?.threadId;
    ok('the direct line exists the moment somebody accepts', !!threadId,
      JSON.stringify(today.d.directLine));

    head('An instruction, typed:');
    const typed = await boss('POST', `/threads/${threadId}/messages`,
      { body: 'Book the car for six tomorrow', register: 'note' });
    const typedId = typed.d.id;
    ok('lands as a note', typed.s === 201 && !!typedId, JSON.stringify(typed.d));
    const fresh = await boss('GET', `/threads/${threadId}/messages`);
    ok('and starts with nothing said about whether it happened',
      fresh.d.messages.find((m) => m.id === typedId).doneAt === null);

    head('The assistant does it:');
    const done = await pa('POST', `/threads/${threadId}/messages/${typedId}/done`);
    ok('and can say so', done.s === 200, JSON.stringify(done.d));
    ok('with their name against it, so the principal knows who',
      done.d.doneByName === 'Ngozi Bello', done.d.doneByName);

    const read = await boss('GET', `/threads/${threadId}/messages`);
    const seen = read.d.messages.find((m) => m.id === typedId);
    ok('the principal sees it carried out', !!seen.doneAt);
    ok('by whom', seen.doneByName === 'Ngozi Bello');
    ok('and it is NOT an acknowledgement, which means something else',
      seen.acks.length === 0);

    head('Pressed twice, or on the wrong line:');
    ok('twice is refused rather than silently re-stamped',
      (await pa('POST', `/threads/${threadId}/messages/${typedId}/done`)).s === 409);
    const undone = await pa('DELETE', `/threads/${threadId}/messages/${typedId}/done`);
    ok('and it can be taken back', undone.s === 200 && undone.d.doneAt === null);
    const after = await boss('GET', `/threads/${threadId}/messages`);
    ok('leaving no trace of a thing that did not happen',
      after.d.messages.find((m) => m.id === typedId).doneAt === null);

    head('A record is a different animal:');
    const note2 = await boss('POST', `/threads/${threadId}/messages`,
      { body: 'We are moving the board dinner to Thursday', register: 'note' });
    const rec = await boss('POST', `/threads/${threadId}/messages/${note2.d.id}/promote`,
      { recordType: 'decision' });
    const recId = rec.d.id || rec.d.message?.id;
    const refused = await pa('POST', `/threads/${threadId}/messages/${recId}/done`);
    ok('cannot be marked done', refused.s === 400, String(refused.s));
    ok('and says why, rather than just refusing',
      /acknowledged, not carried out/i.test(refused.d.error || ''), refused.d.error);
    ok('but can still be acknowledged, which is its own thing',
      (await pa('POST', `/threads/${threadId}/messages/${recId}/ack`)).s === 200);

    head('Somebody outside the room:');
    const stranger = client();
    await stranger('POST', '/auth/signup',
      { name: 'Chidi Eze', email: `chidi${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await stranger('POST', '/profile/onboarding-step', { step: 'done' });
    ok('cannot mark anything done in it',
      [403, 404].includes((await stranger('POST', `/threads/${threadId}/messages/${typedId}/done`)).s));

    // ---- The case that prompted all this ------------------------------
    head('A voice note with no text at all:');
    b = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    });
    const ctx = await b.newContext({ permissions: ['microphone'] });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}/login`);
    await p.fill('#email', `ngozi${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Log in")');
    await p.waitForURL(/\/workspace|\/today/, { timeout: 20000 });

    // Posted through the API so the suite is about the marking, not about
    // MediaRecorder — bvoice already proves the recording path.
    const clip = Buffer.alloc(6000, 7).toString('base64');
    const voiced = await p.evaluate(async ({ threadId: t, clip: c }) => {
      const r = await fetch(`/api/threads/${t}/voice`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audio: c, mimeType: 'audio/webm', durationMs: 4000 }),
      });
      return { s: r.status, d: await r.json() };
    }, { threadId, clip });
    ok('a recording posts', voiced.s === 201, JSON.stringify(voiced.d).slice(0, 140));

    await p.goto(`${BASE}/threads/${threadId}`);
    await p.waitForSelector('.msg-note:has(audio)', { timeout: 20000 });
    const voiceNote = p.locator('.msg-note:has(audio)').last();
    // The verbs belong to the message you picked. Tapping the row is how you
    // pick it — and a recording has no bubble, which is exactly why the handle
    // is the row. See pickHandler in ThreadView.
    await voiceNote.click({ position: { x: 5, y: 5 } });
    ok('and the screen offers to mark it done with nothing written',
      (await voiceNote.locator('button:has-text("Mark done")').count()) === 1);
    ok('saying so plainly, where it used to only offer the heavy paths',
      /needs nothing written/i.test(await voiceNote.innerText()),
      (await voiceNote.innerText()).slice(0, 200));

    await voiceNote.locator('button:has-text("Mark done")').click();
    await p.waitForSelector('.msg-done', { timeout: 15000 });
    const marked = await p.locator('.msg-done').innerText();
    ok('one press settles it', /done/i.test(marked), marked);
    ok('naming who did it', /Ngozi/.test(marked), marked);
    ok('and offering to undo', (await p.locator('.msg-done button:has-text("Undo")').count()) >= 1);

    await p.reload();
    await p.waitForSelector('.msg-done', { timeout: 15000 });
    ok('it survives a reload, because it was really recorded', true);

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (b) await b.close();
    proc.kill();
  }
  console.log(fails === 0
    ? '\nAn instruction can now be closed as cheaply as it was given.'
    : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
