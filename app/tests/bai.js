// What the assistant is, what it is not, and the one thing it will not do.
//
// TWO RULES SET BY THE PRINCIPAL, both enforced here before there is a model
// in the building to test them against.
//
//   IT MUST NOT PRETEND. The app ships a tab called AI Assist that contains no
//   AI — keyword matching and eight fixed templates. That is a real feature and
//   it is not generation, and presenting its output as though something wrote
//   it is the app taking credit for work it did not do. A product that will
//   mislead about that has no standing to be believed about what it does with
//   a passport. So the screens say which of the two they are showing, and
//   everything needing a model is visibly absent in the place it will occupy.
//
//   THE VAULT IS OFF-LIMITS, ENTIRELY. Not masked, not redacted — refused. A
//   passport number in a prompt has left the building and no later deletion
//   reaches it; a model-supplied digit in a passport number is undetectable by
//   eye and catastrophic at a border. Both directions, and the refusal is a
//   code path rather than an instruction, because an instruction is advice a
//   model may decline to follow.
//
// THE ORDER MATTERS AND IS THE POINT OF THIS FILE. The guard is written and
// proved while drafting is still templates, so it is already true on the day a
// model is wired in behind the same endpoint — rather than being a thing
// somebody has to remember to add at exactly the moment it starts to matter.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = 4599, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
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
  // No ANTHROPIC_API_KEY, deliberately: this is the deployment as it stands.
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ENCRYPTION_KEY: KEY };
  delete env.ANTHROPIC_API_KEY;
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`, env, stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    // ---- The rule, before anything reaches a server ------------------------
    head('The vault rule is a function, not a sentence in a prompt:');
    const aiModel = require(`${ROOT}/app/server/lib/aiModel`);
    ok('with no key, there is no model', aiModel.isConfigured() === false);
    ok('a passport is recognised as vault material',
      aiModel.asksForVault('send them his passport number') === true);
    ok('and a BVN', aiModel.asksForVault('include the BVN on the form') === true);
    ok('and a policy number', aiModel.asksForVault('quote the policy number') === true);
    // A false positive costs a rephrase; a false negative costs a passport.
    ok('an ordinary message is not', aiModel.asksForVault('confirm Tuesday at four') === false);
    // THE REGRESSION THIS FILE FOUND. Matching as substrings, "nin" — the
    // Nigerian identity number, a real thing this vault holds — sits inside
    // "morning", so the guard refused "book him Tuesday morning" as an attempt
    // to exfiltrate an ID. Over-eager is the right way for this to fail;
    // unusable is not, because a guard that blocks ordinary work is a guard
    // somebody finds a way around.
    ok('and "morning" is not a NIN', aiModel.asksForVault('Tuesday morning') === false);
    ok('nor "planning" a policy', aiModel.asksForVault('planning the week') === false);
    ok('while a real NIN still is', aiModel.asksForVault('his NIN please') === true);
    ok('and a real TIN', aiModel.asksForVault('the TIN for the invoice') === true);

    let threw = null;
    try { aiModel.refuseIfVault('draft this', 'his passport expires in March'); }
    catch (e) { threw = e; }
    ok('assembling a prompt with vault material throws', threw?.code === 'vault_off_limits',
      String(threw?.code));
    ok('and says what to do instead', /reveal the detail yourself/i.test(threw?.message || ''),
      (threw?.message || '').slice(0, 80));

    // A DENYLIST WOULD BE A PROMISE TO REMEMBER. This is the opposite: a table
    // has to be admitted by name before a model can ever see it, so anything
    // added later is silent by default.
    ok('essentials are not readable by a model', aiModel.mayRead('essentials') === false);
    ok('nor the access log', aiModel.mayRead('access_log') === false);
    ok('nor anything not named', aiModel.mayRead('some_table_added_next_year') === false);
    ok('while messages are', aiModel.mayRead('messages') === true);

    // ---- The server refuses too --------------------------------------------
    head('And the endpoints refuse, not just the library:');
    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    // Hours and a meeting type, so the scheduling half has something real to
    // filter — otherwise its refusal is "nothing to book against" and the
    // check below proves nothing about the vault rule.
    await boss('PUT', '/availability', {
      rules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:00' })),
    });
    await boss('POST', '/meeting-types',
      { name: 'Introduction', durationMinutes: 30, locationType: 'video', accessTier: 1 });

    let r = await boss('POST', `/pa/${bossId}/ai-assist/draft-message`,
      { instruction: 'Send Bola his passport number for the visa form' });
    ok('a draft that wants a passport is refused', r.s === 400 && r.d.code === 'vault_off_limits',
      `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    // Refused rather than answered with a hole in it: a draft with a gap is one
    // somebody fills in by hand, and then nothing is logged at all.
    ok('and no draft comes back with it', !r.d.body, JSON.stringify(r.d).slice(0, 100));

    r = await boss('POST', `/pa/${bossId}/ai-assist/parse`,
      { message: 'Book Bola in on Tuesday and send over the BVN' });
    ok('so is a scheduling request that smuggles one in',
      r.s === 400 && r.d.code === 'vault_off_limits', `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);

    // The rule must not swallow the feature.
    r = await boss('POST', `/pa/${bossId}/ai-assist/draft-message`,
      { instruction: 'Let them know I need to move our meeting' });
    ok('an ordinary draft still works', r.s === 200 && !!r.d.body, `${r.s}`);
    r = await boss('POST', `/pa/${bossId}/ai-assist/parse`,
      { message: 'Find time with Bola on Tuesday morning' });
    ok('and an ordinary scheduling request still parses', r.s === 200,
      `${r.s} ${JSON.stringify(r.d)}`);

    // ---- What is not here says so ------------------------------------------
    head('What needs a model is visibly absent rather than quietly missing:');
    r = await boss('GET', '/capabilities?screen=ai_assist');
    const caps = Object.fromEntries((r.d.capabilities || []).map((c) => [c.id, c]));
    ok('composing in the principal\'s voice is listed as unavailable',
      caps.ai_compose && caps.ai_compose.available === false, JSON.stringify(caps.ai_compose));
    ok('and reworking a draft', caps.ai_rewrite?.available === false);
    ok('and summarising a conversation', caps.ai_summary?.available === false);
    // REPLYING MOVED, and this is where the move is pinned. It used to sit here
    // as something planned; it is now built, and it sits on the correspondence
    // screen — beside the triage that says a message needs answering, which is
    // the moment somebody wants it. A capability whose declared screen is not
    // the screen its control is on sends whoever reads the roadmap to the
    // wrong place, so the screen is asserted rather than merely the existence.
    const mail = Object.fromEntries(
      ((await boss('GET', '/capabilities?screen=mail')).d.capabilities || [])
        .map((c) => [c.id, c]));
    ok('replying is on the correspondence screen, not this one',
      !caps.ai_reply && mail.ai_reply?.available === false,
      JSON.stringify({ here: !!caps.ai_reply, there: mail.ai_reply }));
    // An operator seeing a named variable is being handed a task; "coming
    // soon" would be asking them to wait for something already built.
    ok('each names the key that would turn it on',
      Object.values(caps).every((c) => (c.needs || []).includes('ANTHROPIC_API_KEY')),
      JSON.stringify(Object.values(caps).map((c) => c.needs)));
    ok('and is marked as waiting on a credential rather than on us',
      Object.values(caps).every((c) => c.state === 'needs_key'),
      JSON.stringify(Object.values(caps).map((c) => c.state)));

    // THE THINGS THAT DO WORK ARE NOT IN THE REGISTER OF THINGS THAT DO NOT.
    ok('finding a time is not listed, because it works',
      !caps.ai_schedule && !Object.values(caps).some((c) => /find a time/i.test(c.label || '')),
      JSON.stringify(Object.values(caps).map((c) => c.label)));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nThe assistant says what it is, and the vault is not its business.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
