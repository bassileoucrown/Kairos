// Voice notes on the direct line.
//
// The claims worth proving are not "it records" — the browser does that. They
// are: nothing is stored without a key, the bytes come back exactly as sent,
// what sits in the database is not the recording, a stranger cannot reach it,
// and the retention deadline is real rather than aspirational.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 4492);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

let nextIp = 0;
function client() {
  let cookie = '';
  nextIp += 1;
  const from = `198.51.100.${nextIp}`;
  return async function call(method, path, body, raw = false) {
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': from,
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    if (raw) return { s: r.status, buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type'), cache: r.headers.get('cache-control') };
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { s: r.status, d: json };
  };
}

async function signUp(call, name, email, category) {
  const r = await call('POST', '/auth/signup', { name, email, password: PW, accountCategory: category });
  if (r.s !== 200 && r.s !== 201) throw new Error(`signup ${name}: ${r.s} ${JSON.stringify(r.d)}`);
  await call('POST', '/profile/onboarding-step', { step: 'done' });
  return r.d.user;
}

function boot(env, port) {
  return spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ...env },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function waitReady(base) {
  // A minute. Twenty seconds is plenty on an idle machine and not plenty on a
  // loaded one, and "no server" on a green tree is a board crying wolf.
  const deadline = Date.now() + 60000;
  for (;;) {
    let ready = false;
    try { ready = (await (await fetch(`${base}/api/status`)).json()).databaseReady; }
    catch { /* not up */ }
    if (ready) return;
    if (Date.now() > deadline) throw new Error('server never became ready');
    await new Promise((r) => setTimeout(r, 200));
  }
}

// A recognisable payload, so "the bytes came back" means the same bytes.
//
// Deliberately larger than the app's ordinary 100 KB JSON ceiling, and larger
// still once base64 inflates it by a third. A small clip passes this suite
// whether or not the voice route actually escapes that ceiling — which it did
// not, and a 40 KB clip said nothing about it. A minute of real speech is
// about this size.
const CLIP = crypto.randomBytes(220 * 1024);
const CLIP_B64 = CLIP.toString('base64');

/**
 * Direct access to whichever store the app is using, so the suite proves the
 * same things on SQLite and on Postgres. Placeholders are written $1-style and
 * rewritten for SQLite, since that is the dialect pg cannot fake.
 */
async function rawStore() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Client } = require(`${ROOT}/app/server/node_modules/pg`);
    const c = new Client({ connectionString: url });
    await c.connect();
    const schema = process.env.DATABASE_SCHEMA;
    if (schema) await c.query(`SET search_path TO ${schema}`);
    return {
      query: async (sql, params = []) => (await c.query(sql, params)).rows,
      run: async (sql, params = []) => { await c.query(sql, params); },
      close: () => c.end(),
    };
  }
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(`${ROOT}/app/server/data/kairos.sqlite`);
  const toSqlite = (sql) => sql.replace(/\$\d+/g, '?');
  return {
    query: async (sql, params = []) => db.prepare(toSqlite(sql)).all(...params),
    run: async (sql, params = []) => { db.prepare(toSqlite(sql)).run(...params); },
    close: async () => db.close(),
  };
}

(async () => {
  // A fresh database: the retention assertion counts rows, and residue from an
  // earlier run would make the count meaningless.
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  } else {
    // Tolerates the table not existing: on a database that has not yet run a
    // build carrying this feature, there is nothing to clear and that is the
    // normal first case, not a failure.
    const pre = await rawStore();
    try { await pre.run('DELETE FROM voice_notes'); }
    catch { /* not migrated yet */ }
    await pre.close();
  }

  let proc = boot({ ENCRYPTION_KEY: KEY }, PORT);
  try {
    await waitReady(BASE);

    // A principal and their assistant, so there is a direct line to talk in.
    const ada = client();
    const adaU = await signUp(ada, 'Ada Boss', `ada${ID}@x.com`, 'principal');
    await ada('PATCH', '/profile', { slug: `ada${ID}` });
    await ada('POST', '/access-codes', { code: 'VOICE-TEST-11', role: 'pa', uses: 3 });

    const ben = client();
    await signUp(ben, 'Ben Reed', `ben${ID}@x.com`, 'pa');
    const joined = await ben('POST', '/access-codes/redeem', { handle: `ada${ID}`, code: 'VOICE-TEST-11' });
    if (joined.s !== 201) throw new Error(`join failed: ${JSON.stringify(joined.d)}`);

    const ws = await ben('GET', '/workspace');
    const threadId = ws.d.principals.find((p) => p.id === adaU.id)?.directLine?.threadId;
    ok('the assistant has a direct line to talk in', !!threadId);

    head('The composer says whether it can record:');
    const view = await ada('GET', `/threads/${threadId}/messages`);
    ok('with a key set, voice is available', view.d.voice?.available === true, JSON.stringify(view.d.voice));
    ok('and states the ceiling and the retention', view.d.voice.maxSeconds > 0 && view.d.voice.retentionDays > 0);

    head('Sending one:');
    const sent = await ada('POST', `/threads/${threadId}/voice`,
      { audio: CLIP_B64, mimeType: 'audio/webm;codecs=opus', durationMs: 12400 });
    ok('a voice note posts', sent.s === 201, JSON.stringify(sent.d).slice(0, 160));
    ok('even though it is far past the ordinary 100 KB body limit',
      CLIP_B64.length > 100 * 1024, `${Math.round(CLIP_B64.length / 1024)} KB`);
    ok('and comes back with its length', sent.d.voice?.durationMs === 12400);
    ok('and its size', sent.d.voice?.byteSize === CLIP.length, String(sent.d.voice?.byteSize));
    ok('with the codecs parameter dropped from the type',
      sent.d.voice?.mimeType === 'audio/webm', sent.d.voice?.mimeType);

    const after = await ben('GET', `/threads/${threadId}/messages`);
    const msg = after.d.messages.find((m) => m.id === sent.d.id);
    ok('the other side sees it in the thread', !!msg);
    ok('carrying the recording metadata', msg.voice?.durationMs === 12400);
    ok('but not the audio itself', !JSON.stringify(msg).includes(CLIP_B64.slice(0, 64)));
    ok('and an empty body, which is what an untranscribed note honestly is', msg.body === '');

    head('Playing it back:');
    const audio = await ben('GET', `/threads/${threadId}/messages/${sent.d.id}/audio`, undefined, true);
    ok('the recording downloads', audio.s === 200, String(audio.s));
    ok('byte for byte as it was sent', audio.buf.equals(CLIP),
      `${audio.buf.length} vs ${CLIP.length}`);
    ok('served as the type it was stored under', audio.type === 'audio/webm', audio.type);
    ok('and never cached by anything in between',
      /no-store/.test(audio.cache || ''), audio.cache);

    head('What is actually in the database:');
    // Read straight from storage rather than through the app, because the
    // claim is about what a stolen dump contains — and the app would happily
    // decrypt it for us, which proves nothing.
    const raw = await rawStore();
    const stored = (await raw.query('SELECT audio, byte_size, expires_at FROM voice_notes'))[0];
    ok('the stored column is not the recording', !stored.audio.includes(CLIP_B64.slice(0, 64)));
    ok('it is versioned ciphertext', /^v1:/.test(stored.audio), stored.audio.slice(0, 24));
    ok('and the true size is still recorded', Number(stored.byte_size) === CLIP.length);
    const days = (new Date(stored.expires_at) - Date.now()) / 86400000;
    ok('with an expiry roughly 30 days out', days > 29 && days < 31, String(days));

    head('Nobody else can reach it:');
    const stranger = client();
    await signUp(stranger, 'A Stranger', `str${ID}@x.com`, 'principal');
    const peek = await stranger('GET', `/threads/${threadId}/messages/${sent.d.id}/audio`);
    ok('a stranger gets not-found, not a refusal', peek.s === 404, String(peek.s));
    ok('and learns nothing about what is there',
      !/voice|audio|recording/i.test(JSON.stringify(peek.d)), JSON.stringify(peek.d));
    const post = await stranger('POST', `/threads/${threadId}/voice`,
      { audio: CLIP_B64, mimeType: 'audio/webm', durationMs: 1000 });
    ok('and cannot put one there either', post.s === 404, String(post.s));

    head('What is refused:');
    // Two ceilings, and both must answer legibly. Between 2 MB and 4 MB the
    // app's own cap refuses it; past 4 MB the body parser does, and that used
    // to surface as "something went wrong".
    const overCap = Buffer.alloc(2.5 * 1024 * 1024, 7).toString('base64');
    const tooBig = await ada('POST', `/threads/${threadId}/voice`,
      { audio: overCap, mimeType: 'audio/webm', durationMs: 5000 });
    ok('a recording past the cap is refused', tooBig.s === 400, JSON.stringify(tooBig.d).slice(0, 120));
    ok('by name, not as an internal error',
      /at most/i.test(tooBig.d?.error || ''), tooBig.d?.error);

    const absurd = Buffer.alloc(5 * 1024 * 1024, 7).toString('base64');
    const wayTooBig = await ada('POST', `/threads/${threadId}/voice`,
      { audio: absurd, mimeType: 'audio/webm', durationMs: 5000 });
    ok('and one past the parser ceiling is refused legibly too',
      wayTooBig.s === 413, `${wayTooBig.s} ${JSON.stringify(wayTooBig.d)}`);
    const tooLong = await ada('POST', `/threads/${threadId}/voice`,
      { audio: CLIP_B64, mimeType: 'audio/webm', durationMs: 20 * 60 * 1000 });
    ok('an over-long one is refused', tooLong.s === 400, JSON.stringify(tooLong.d));
    const badType = await ada('POST', `/threads/${threadId}/voice`,
      { audio: CLIP_B64, mimeType: 'application/x-msdownload', durationMs: 1000 });
    ok('a format we never verified is refused', badType.s === 400, JSON.stringify(badType.d));
    const empty = await ada('POST', `/threads/${threadId}/voice`, { mimeType: 'audio/webm' });
    ok('and an empty post is refused', empty.s === 400, JSON.stringify(empty.d));

    const count = (await raw.query('SELECT COUNT(*) AS n FROM voice_notes'))[0];
    ok('no refused attempt left a row behind', Number(count.n) === 1, JSON.stringify(count));
    const shells = (await raw.query(
      "SELECT COUNT(*) AS n FROM messages WHERE body = '' AND thread_id = $1", [threadId]))[0];
    ok('and no empty message shells either', Number(shells.n) === 1, JSON.stringify(shells));

    head('A recording cannot be filed as a record:');
    const promoted = await ada('POST', `/threads/${threadId}/messages/${sent.d.id}/promote`,
      { recordType: 'decision' });
    ok('promoting a voice note is refused', promoted.s === 400, JSON.stringify(promoted.d));
    ok('and says what to do instead', /transcript/i.test(promoted.d.error), promoted.d.error);

    head('The Today glance describes it rather than showing a blank:');
    const wsAfter = await ben('GET', '/workspace');
    const line = wsAfter.d.principals.find((p) => p.id === adaU.id)?.directLine;
    ok('the preview names it as a voice note', /Voice note/.test(line?.lastMessage?.body || ''),
      JSON.stringify(line?.lastMessage));
    ok('with its length', /0:12/.test(line?.lastMessage?.body || ''), line?.lastMessage?.body);

    head('Text alongside a recording still reads as text:');
    const both = await ada('POST', `/threads/${threadId}/voice`,
      { audio: CLIP_B64, mimeType: 'audio/webm', durationMs: 3000, body: 'Car is downstairs.' });
    ok('a voice note can carry typed words too', both.s === 201);
    const ws2 = await ben('GET', '/workspace');
    ok('and then the words are the preview',
      ws2.d.principals.find((p) => p.id === adaU.id)?.directLine?.lastMessage?.body === 'Car is downstairs.');
    const canPromote = await ada('POST', `/threads/${threadId}/messages/${both.d.id}/promote`,
      { recordType: 'update' });
    ok('and that one can be filed as a record', canPromote.s === 201, JSON.stringify(canPromote.d));

    head('Expiry is real:');
    await raw.run('UPDATE voice_notes SET expires_at = $1 WHERE message_id = $2',
      [new Date(Date.now() - 1000).toISOString(), sent.d.id]);
    const goneAudio = await ben('GET', `/threads/${threadId}/messages/${sent.d.id}/audio`);
    ok('a lapsed recording is gone before any sweep runs', goneAudio.s === 404, String(goneAudio.s));
    const stillThere = await ben('GET', `/threads/${threadId}/messages`);
    ok('but the message it belonged to stays',
      stillThere.d.messages.some((m) => m.id === sent.d.id));
    await raw.close();

    proc.kill();

    head('With no key set at all:');
    proc = boot({ ENCRYPTION_KEY: '' }, PORT + 1);
    const NOKEY = `http://127.0.0.1:${PORT + 1}`;
    await waitReady(NOKEY);

    const nk = async (method, path, body, cookie) => {
      const r = await fetch(`${NOKEY}/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { s: r.status, d: await r.json().catch(() => null), set: r.headers.get('set-cookie') };
    };
    const up = await nk('POST', '/auth/signup',
      { name: 'Ada Boss', email: `nokey${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const c = up.set.split(';')[0];
    await nk('POST', '/profile/onboarding-step', { step: 'done' }, c);
    const space = await nk('POST', '/spaces', { name: 'Room', context: 'work' }, c);
    const thread = await nk('POST', `/spaces/${space.d.space.id}/threads`, { name: 'Talk' }, c);
    const tid = thread.d.thread?.id || thread.d.id;

    const closed = await nk('GET', `/threads/${tid}/messages`, undefined, c);
    ok('the thread reports voice as unavailable', closed.d.voice?.available === false);
    ok('and says why, in plain words',
      /encryption key/i.test(closed.d.voice?.unavailableReason || ''), closed.d.voice?.unavailableReason);

    const refused = await nk('POST', `/threads/${tid}/voice`,
      { audio: CLIP_B64, mimeType: 'audio/webm', durationMs: 1000 }, c);
    ok('and posting one is refused outright', refused.s === 503, String(refused.s));
    ok('with the same explanation, not an internal error',
      /encryption key/i.test(refused.d?.error || ''), JSON.stringify(refused.d));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }
  console.log(fails === 0 ? '\nVoice notes are held properly.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
