// Words that file themselves.
//
// THE PROBLEM THIS SOLVES. Filing a record is two taps in a menu, so it mostly
// does not happen, and the decision trail an office is supposed to be able to
// produce a year later is a pile of ordinary messages nobody marked.
//
// THE DANGER IT MUST NOT CREATE. A record here is formal — it has a status, it
// drives a stage, people work under it. Filing something as a decision that
// was only a musing is worse than missing one: a missed record is a nuisance,
// an invented one is a false record, and this product exists to be trusted
// about exactly that.
//
// SO THE LINE IS: A MARKER, NOT A GUESS. "Decision:" typed at the front is an
// instruction — nobody types it by accident — and acting on it is automatic
// without being presumptuous. Everything else stays an ordinary message. Half
// this file is therefore about what does NOT get filed, because that is the
// half that would cost trust.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4616, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
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
    await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    const space = await boss('POST', '/spaces', { name: `The office ${ID}`, context: 'work' });
    const spaceId = space.d.space.id;
    const thread = await boss('POST', `/spaces/${spaceId}/threads`, { name: 'Board pack' });
    const threadId = thread.d.thread.id;

    // The composer sends register: 'note' for ordinary messages, so every case
    // below sends it too. A marker that only fired when the register was
    // absent would never fire from the app at all.
    const say = (body) => boss('POST', `/threads/${threadId}/messages`, { body, register: 'note' });
    const latest = async () => {
      const list = (await boss('GET', `/threads/${threadId}/messages`)).d.messages || [];
      return list[list.length - 1];
    };

    // ---- The vocabulary is published ---------------------------------------
    head('The words are the app\'s to publish, not folklore:');
    const vocab = await boss('GET', '/threads/record-markers');
    ok('they can be asked for', vocab.s === 200, `${vocab.s} ${JSON.stringify(vocab.d).slice(0, 120)}`);
    const markers = (vocab.d.markers || []).map((m) => m.marker);
    ok('and cover every kind of record there is',
      (vocab.d.markers || []).length === 6, JSON.stringify(markers));
    ok('Decision among them', markers.includes('Decision:'), JSON.stringify(markers));

    // ---- Marked lines file themselves --------------------------------------
    head('A marked line files itself:');
    await say('Decision: we go with the Lekki site');
    let m = await latest();
    ok('it lands in the record register', m?.register === 'record', JSON.stringify(m).slice(0, 140));
    ok('as the kind the word named', m?.recordType === 'decision', m?.recordType);
    // THE MARKER IS CONSUMED. Left in, every record in the archive carries a
    // stutter, and the kind is already on the row.
    ok('and the word itself is not part of what was said',
      m?.body === 'we go with the Lekki site', JSON.stringify(m?.body));
    ok('and it is a real record, with a status',
      m?.recordStatus === 'accepted', m?.recordStatus);

    for (const [line, type] of [
      ['Approved: the Q3 budget', 'approval'],
      ['Blocker: the survey is not back', 'blocker'],
      ['Sign-off: Ngozi confirmed the pack', 'sign_off'],
      ['Update: printer confirmed for Thursday', 'update'],
      ['Request: can we move Tuesday?', 'request'],
    ]) {
      await say(line);
      m = await latest();
      ok(`"${line.split(':')[0]}:" files a ${type}`, m?.recordType === type,
        `${m?.register}/${m?.recordType}`);
    }
    // Spelling is not a house style. A marker that only works one way teaches
    // people it is unreliable.
    await say('decided: the surveyor starts Monday');
    ok('and it does not care how you spell it',
      (await latest())?.recordType === 'decision');

    // ---- What must NOT be filed --------------------------------------------
    head('And nothing files itself by accident:');
    await say('I think we should approve the budget');
    m = await latest();
    // THE ASSERTION THIS FILE EXISTS FOR. Inference would file this, and would
    // be putting the office to work under something nobody agreed.
    ok('a sentence that merely sounds like a decision stays an ordinary line',
      m?.register === 'note' && !m?.recordType, JSON.stringify(m).slice(0, 140));
    ok('and keeps every word of itself',
      m?.body === 'I think we should approve the budget', m?.body);

    await say('the blocker: nobody rang the surveyor');
    ok('a marker word mid-sentence is just a word',
      (await latest())?.register === 'note');

    await say('Tomorrow: I will send the pack');
    ok('a word that is not in the vocabulary does nothing',
      (await latest())?.register === 'note');

    // "Decision:" with nothing after it is somebody who has not finished
    // typing. Filing a blank record is worse than filing nothing: it is a row
    // in the formal register that somebody has to supersede rather than
    // delete.
    await say('Decision:');
    m = await latest();
    ok('a marker with nothing after it files nothing',
      m?.register === 'note', JSON.stringify(m).slice(0, 120));
    ok('and keeps what little was typed', m?.body === 'Decision:', m?.body);

    // ---- The explicit path still wins --------------------------------------
    head('And saying it outright still beats guessing at it:');
    await boss('POST', `/threads/${threadId}/messages`,
      { body: 'Decision: this is really a blocker', register: 'record', recordType: 'blocker' });
    m = await latest();
    ok('an explicit record is filed as asked', m?.recordType === 'blocker', m?.recordType);
    // The marker is NOT stripped here, because the caller was not using it as
    // a marker — they said what they meant and the words are theirs.
    ok('and its words are left exactly as written',
      m?.body === 'Decision: this is really a blocker', m?.body);

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA word can file a decision, and nothing files itself by accident.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
