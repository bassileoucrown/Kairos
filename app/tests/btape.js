// Recording a meeting, and everything that has to be true first.
//
// THE STATE MACHINE EXISTED AND THE CAPTURE DID NOT. lib/minutes.js has held
// off | on | stopped, the consent notice, and the refusal when the deployment
// cannot record, since minutes were built. What it could not do was take a
// single byte of audio. This file is about the rest of it.
//
// WHY A FAKE STORE AND A FAKE TRANSCRIBER. Both are somebody else's service,
// and a suite that needed real ones would be a suite nobody runs. So this
// stands up two small HTTP servers and points STORAGE_ENDPOINT and
// TRANSCRIPTION_ENDPOINT at them. What that proves is the part Kairos owns:
// the consent gate, the encryption, the ordering, the cleanup on failure, and
// the transcript becoming material a minute can be drafted from. What it does
// NOT prove is that a real S3 bucket accepts the signature — that is proved
// separately, against AWS's own published vector, further down.
//
// THE ASSERTION THIS FILE EXISTS FOR is the consent gate. A recording feature
// that will take audio for a meeting nobody turned recording on for makes the
// state machine decorative and the notice a lie.
const ROOT = require('path').join(__dirname, '..', '..');
const http = require('http');

const PORT = 4647, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const STORE_PORT = PORT + 1, TRANS_PORT = PORT + 2;
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

/** A bucket in memory, speaking just enough S3 to be put to and deleted from. */
function fakeStore() {
  const objects = new Map();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const key = req.url;
      if (req.method === 'PUT') { objects.set(key, Buffer.concat(chunks)); res.writeHead(200); }
      else if (req.method === 'GET') {
        const v = objects.get(key);
        if (!v) { res.writeHead(404); res.end(); return; }
        res.writeHead(200); res.end(v); return;
      } else if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); }
      else res.writeHead(405);
      res.end();
    });
  });
  return { server, objects };
}

/** A transcriber that returns fixed words, or refuses when told to. */
function fakeTranscriber(state) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (state.fail) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('the model is down');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: state.text }));
    });
  });
  return server;
}

(async () => {
  // The suite decrypts what the store received, to prove the audio left this
  // process already sealed. secretBox reads the key at load, and only the
  // SPAWNED server was given one — so this process needs the same key set
  // before anything requires it, or the check measures the test's environment
  // rather than the product's behaviour.
  process.env.ENCRYPTION_KEY = KEY;
  const fs = require('fs');
  const { spawn } = require('child_process');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }

  const store = fakeStore();
  const transState = { text: 'He will fund the second tranche once the audit is in.', fail: false };
  const trans = fakeTranscriber(transState);
  await new Promise((r) => store.server.listen(STORE_PORT, '127.0.0.1', r));
  await new Promise((r) => trans.listen(TRANS_PORT, '127.0.0.1', r));

  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      ENCRYPTION_KEY: KEY,
      STORAGE_BUCKET: 'kairos-test',
      STORAGE_ENDPOINT: `http://127.0.0.1:${STORE_PORT}`,
      STORAGE_REGION: 'us-east-1',
      STORAGE_KEY: 'AKIAIOSFODNN7EXAMPLE',
      STORAGE_SECRET: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      TRANSCRIPTION_ENDPOINT: `http://127.0.0.1:${TRANS_PORT}/v1/audio/transcriptions`,
      TRANSCRIPTION_KEY: 'test-key',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const db = require(`${ROOT}/app/server/lib/db`);

  try {
    const deadline = Date.now() + 150000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    // ---- The signature, against AWS's own vector ---------------------------------
    head('The part that cannot be tested against a fake — the signature:');
    const objectStore = require(`${ROOT}/app/server/lib/objectStore`);
    const vector = objectStore.sign({
      method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt',
      region: 'us-east-1', service: 's3',
      key: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      at: new Date(Date.UTC(2013, 4, 24, 0, 0, 0)),
      headers: { range: 'bytes=0-9' },
    });
    // A signature that is subtly wrong fails at the worst moment, in a way
    // that looks like a network problem. AWS publishes this exact case.
    ok('matches the published AWS Signature Version 4 test vector',
      vector.signature === 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
      vector.signature);

    const boss = client();
    const bossId = (await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' })).d.user.id;
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    await boss('PATCH', '/profile', { slug: `ada${ID}` });
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek, startTime: '00:00', endTime: '23:30',
      })),
    });
    const mt = (await boss('POST', '/meeting-types', {
      name: 'Board', durationMinutes: 60, locationType: 'video', accessTier: 1,
    })).d.meetingType;

    const anon = client();
    const slots = (await anon('GET', `/public/ada${ID}/${mt.slug}/slots`)).d.slots || [];
    const bookingId = (await anon('POST', `/public/ada${ID}/${mt.slug}/book`, {
      timezone: 'UTC', startAt: slots[0].startAt,
      name: 'Chidi Nwosu', email: `chidi${ID}@ashford.com`,
    })).d.booking.id;
    // Aged into the past, because minutes belong to a meeting that has started.
    await db.prepare('UPDATE bookings SET start_at = ?, end_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 7200000).toISOString(),
        new Date(Date.now() - 3600000).toISOString(), bookingId);

    const at = `/pa/${bossId}/bookings/${bookingId}`;
    const audio = Buffer.from('not really audio, but bytes all the same').toString('base64');
    const send = (body) => boss('POST', `${at}/recording/audio`, body);

    // ---- The consent gate ------------------------------------------------------
    head('Nothing is taken for a meeting nobody turned recording on for:');
    let r = await send({ audio, mimeType: 'audio/webm', durationMs: 1000 });
    ok('audio for an unrecorded meeting is refused',
      r.s === 409 && r.d.code === 'not_recording', `${r.s} ${JSON.stringify(r.d).slice(0, 140)}`);
    ok('and says what has to happen first',
      /turn recording on/i.test(r.d.error || ''), r.d.error);
    ok('nothing reached the store',
      store.objects.size === 0, String(store.objects.size));
    ok('and nothing was filed',
      Number((await db.prepare('SELECT COUNT(*) AS n FROM booking_recordings').get()).n) === 0);

    // ---- Turning it on ----------------------------------------------------------
    head('Somebody turns it on, having told the room:');
    r = await boss('POST', `${at}/recording`, { state: 'on' });
    ok('the meeting can be put into the recording state', r.s === 200, `${r.s} ${JSON.stringify(r.d)}`);
    ok('and the notice comes back with it',
      /must be told it is being recorded/i.test(r.d.notice || ''), r.d.notice);

    // ---- The capture -------------------------------------------------------------
    head('And then the audio is taken, kept and turned into words:');
    r = await send({ audio, mimeType: 'audio/webm', durationMs: 4000 });
    ok('the capture goes through', r.s === 201, `${r.s} ${JSON.stringify(r.d).slice(0, 200)}`);
    ok('the audio reached the store', store.objects.size === 1, String(store.objects.size));

    // ENCRYPTED BEFORE IT LEFT. The store is somebody else's disk even when it
    // is the office's own, and this is the assertion that says so.
    const stored = [...store.objects.values()][0].toString('utf8');
    ok('and what landed there is not the audio',
      !stored.includes('not really audio'), stored.slice(0, 80));
    ok('it is a ciphertext this deployment can open',
      require(`${ROOT}/app/server/lib/secretBox`).decrypt(stored) !== null);

    const rec = await db.prepare('SELECT * FROM booking_recordings').get();
    ok('the transcript is what was kept',
      /second tranche/.test(rec.transcript || ''), rec.transcript);
    ok('and the audio is on a clock while the words are not',
      !!rec.expires_at && Date.parse(rec.expires_at) > Date.now(), rec.expires_at);

    // ---- The transcript is material, not the minute --------------------------------
    head('The transcript joins the notes rather than becoming the record:');
    const notes = await db.prepare(
      "SELECT kind FROM booking_notes WHERE booking_id = ?",
    ).all(bookingId);
    ok('it is filed as its own kind',
      notes.some((n) => n.kind === 'transcript'), JSON.stringify(notes));
    // THE ASSERTION THAT KEEPS A MACHINE OUT OF THE RECORD. A transcript filed
    // as a minute is a record of a meeting that nobody read.
    ok('and never as a minute',
      !notes.some((n) => n.kind === 'minute'), JSON.stringify(notes));

    const minutesLib = require(`${ROOT}/app/server/lib/minutes`);
    const booking = await db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    const material = await minutesLib.material(booking);
    ok('a minute drafted now would be written from it',
      /second tranche/.test(material.text), material.text.slice(0, 200));
    ok('labelled as a transcript rather than as somebody\'s note',
      /Transcript of the recording/.test(material.text), material.text.slice(0, 300));

    // ---- When the transcriber fails --------------------------------------------------
    head('And a transcript that fails leaves nothing behind:');
    transState.fail = true;
    const before = store.objects.size;
    r = await send({ audio, mimeType: 'audio/webm', durationMs: 4000 });
    ok('the capture reports the failure', r.s === 502, `${r.s} ${JSON.stringify(r.d).slice(0, 160)}`);
    // NOTHING IS KEPT FOR NOTHING. Audio whose transcript failed has no reason
    // to sit in a bucket, and this is the assertion that stops one filling up
    // with recordings nobody knows the provenance of.
    ok('and the audio it had already stored is removed again',
      store.objects.size === before, `${before} → ${store.objects.size}`);
    ok('with no row left claiming a recording exists',
      Number((await db.prepare('SELECT COUNT(*) AS n FROM booking_recordings').get()).n) === 1);
    transState.fail = false;

    // ---- Bad audio ---------------------------------------------------------------------
    head('And what is not audio is not stored:');
    ok('an unsupported format is refused',
      (await send({ audio, mimeType: 'application/pdf' })).s === 400);
    ok('and an empty recording is refused',
      (await send({ audio: '', mimeType: 'audio/webm' })).s === 400);

    // ---- The gate is the office's ---------------------------------------------------
    head('And it is not a door round the side:');
    const stranger = client();
    await stranger('POST', '/auth/signup',
      { name: 'Emeka Obi', email: `emeka${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await stranger('POST', '/profile/onboarding-step', { step: 'done' });
    ok('somebody outside the office cannot post audio to this meeting',
      (await stranger('POST', `${at}/recording/audio`, { audio, mimeType: 'audio/webm' })).s === 403);
    ok('nor read what was captured',
      (await stranger('GET', `${at}/recordings`)).s === 403);

    // ---- What the screen is told -------------------------------------------------------
    head('And the office can see what was captured, never the audio:');
    r = await boss('GET', `${at}/recordings`);
    ok('the list comes back', r.s === 200 && (r.d.recordings || []).length === 1,
      `${r.s} ${JSON.stringify(r.d).slice(0, 200)}`);
    ok('saying how many words rather than handing over the recording',
      r.d.recordings[0].words > 0 && r.d.recordings[0].audio === undefined,
      JSON.stringify(r.d.recordings[0]));
    ok('and readiness says the deployment is configured',
      r.d.readiness?.available === true, JSON.stringify(r.d.readiness));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
    store.server.close();
    trans.close();
  }

  console.log(fails === 0
    ? '\nA meeting is recorded only when somebody said so, and the words outlive the audio.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
