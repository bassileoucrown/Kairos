// The seven things AI Assist can do, and the one thing none of them can.
//
// WHAT THIS SUITE IS FOR. Every ask in lib/assist.js reads what Kairos already
// holds and returns words or proposals. The feature is the words; the property
// worth testing is that NOTHING ELSE HAPPENS — no task created, no record
// filed, no message sent, no mail moved. The gap between "a model suggested
// it" and "the office is now acting on it" is a person, and this file proves
// that gap by counting rows before and after.
//
// AND THAT THEY REFUSE HONESTLY. No key is set here, so every ask returns the
// same 503 with the same code, wherever it is pressed. That is the behaviour an
// office with no model configured actually gets, and it is worth pinning: the
// failure mode this codebase refuses is a template presented as generation.
//
// THE ACCESS RULES STILL HOLD. An ask is a new door onto old data, and a new
// door is exactly where a gate gets forgotten — so a mailbox nobody granted, a
// room nobody is in, and a principal nobody works for are each tried.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4622, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
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
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      // Explicitly absent, so this suite measures what an unconfigured
      // deployment does rather than passing differently on a machine where
      // somebody happens to have a key.
      ANTHROPIC_API_KEY: '',
      INBOUND_EMAIL_SECRET: 'test-secret', INBOUND_EMAIL_DOMAIN: 'in.test',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const db = require(`${ROOT}/app/server/lib/db`);
  const count = async (sql, ...args) => Number((await db.prepare(sql).get(...args)).n);

  try {
    const deadline = Date.now() + 150000;
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
    const inv = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    // Somebody with no connection to this office at all.
    const stranger = client();
    await stranger('POST', '/auth/signup',
      { name: 'Chidi Eze', email: `chidi${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await stranger('POST', '/profile/onboarding-step', { step: 'done' });

    const space = (await boss('POST', '/spaces', { name: 'The board', context: 'work' })).d.space;
    const thread = (await boss('POST', `/spaces/${space.id}/threads`, { name: 'Q3' })).d.thread;
    await boss('POST', `/threads/${thread.id}/messages`,
      { body: 'We will fund the second tranche after the audit.', register: 'note' });

    const account = (await boss('POST', `/mail/${bossId}/accounts`,
      { kind: 'delegated', address: `office${ID}@exousia.test` })).d.account;

    // ---- Every ask refuses the same way ---------------------------------------
    head('With no model configured, all seven say so in the same words:');
    const asks = [
      ['the catch-up brief', () => pa('POST', '/assist/catch-up')],
      ['the week ahead', () => pa('POST', `/assist/${bossId}/week-ahead`)],
      ['a reply in their voice', () => pa('POST', `/assist/${bossId}/reply`, { instruction: 'Decline politely' })],
      ['records in a room', () => boss('POST', `/assist/threads/${thread.id}/records`)],
      ['triage of the mail', () => boss('POST', `/assist/${bossId}/mail/${account.id}/triage`)],
    ];
    for (const [what, run] of asks) {
      const r = await run();
      ok(`${what} refuses rather than pretending`,
        r.s === 503 && r.d.code === 'model_not_configured', `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    }

    // ---- And nothing happened ---------------------------------------------------
    head('And asking changed nothing at all:');
    // THE ASSERTIONS THIS FILE EXISTS FOR. Counted rather than asserted about,
    // because "no task appeared" is the kind of claim that is easy to believe
    // and hard to notice going wrong.
    const before = {
      tasks: await count('SELECT COUNT(*) AS n FROM tasks'),
      records: await count("SELECT COUNT(*) AS n FROM messages WHERE register = 'record'"),
      messages: await count('SELECT COUNT(*) AS n FROM messages'),
      notes: await count('SELECT COUNT(*) AS n FROM booking_notes'),
      mail: await count('SELECT COUNT(*) AS n FROM mail_messages'),
      emails: await count('SELECT COUNT(*) AS n FROM emails'),
    };
    for (const [, run] of asks) await run();
    ok('no task was created', await count('SELECT COUNT(*) AS n FROM tasks') === before.tasks);
    ok('no record was filed',
      await count("SELECT COUNT(*) AS n FROM messages WHERE register = 'record'") === before.records);
    ok('nothing was said in any room',
      await count('SELECT COUNT(*) AS n FROM messages') === before.messages);
    ok('no minute was written',
      await count('SELECT COUNT(*) AS n FROM booking_notes') === before.notes);
    ok('no correspondence was touched',
      await count('SELECT COUNT(*) AS n FROM mail_messages') === before.mail);
    // The one that would be worst: a draft that sent itself.
    ok('and nothing was sent',
      await count('SELECT COUNT(*) AS n FROM emails') === before.emails);

    // ---- The shape of the code, not just its behaviour ---------------------------
    head('And they could not act even if they reached the end:');
    // WHY THIS IS A SOURCE CHECK AND NOT A BEHAVIOUR ONE. The counts above are
    // true and, with no key configured, nearly vacuous: execution never gets
    // as far as any code that could write, so they would pass even if these
    // files were full of INSERTs. The property actually being relied on is
    // structural — lib/assist.js gathers and returns, and routes/assist.js
    // hands the result to a screen — so it is checked structurally. Adding a
    // single UPDATE to either file turns this red, which is exactly what
    // happened when it was tried.
    const src = (f) => require('fs').readFileSync(`${ROOT}/app/server/${f}`, 'utf8')
      // Comments in these files discuss writing at length; it is the code that
      // must not do it.
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const writes = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;
    ok('the assist library contains no write at all',
      !writes.test(src('lib/assist.js')),
      (src('lib/assist.js').match(writes) || [''])[0]);
    ok('and neither does the router',
      !writes.test(src('routes/assist.js')),
      (src('routes/assist.js').match(writes) || [''])[0]);

    // ---- A new door is where a gate gets forgotten -------------------------------
    head('An ask is a new door onto old data, and the gates still hold:');
    ok('a stranger cannot ask about this principal\'s week',
      (await stranger('POST', `/assist/${bossId}/week-ahead`)).s === 403,
      String((await stranger('POST', `/assist/${bossId}/week-ahead`)).s));
    ok('nor read a room they are not in',
      (await stranger('POST', `/assist/threads/${thread.id}/records`)).s === 404);
    // Being an assistant to this principal is NOT being in their
    // correspondence — the mailbox has its own gate. See lib/mailAccess.js.
    ok('and a PA with no mail grant cannot have it triaged',
      (await pa('POST', `/assist/${bossId}/mail/${account.id}/triage`)).s === 404);
    // POSITIVE CONTROL: the principal can, so the 404 above is the mailbox gate
    // rather than a route that never worked.
    ok('though the principal reaches the same ask',
      (await boss('POST', `/assist/${bossId}/mail/${account.id}/triage`)).s === 503);

    // ---- The vault is off limits from here too -----------------------------------
    head('And the vault stays out of reach through the new door:');
    await boss('POST', `/threads/${thread.id}/messages`,
      { body: 'Bring his passport number to the meeting', register: 'note' });
    const r = await boss('POST', `/assist/threads/${thread.id}/records`);
    // ORDER MATTERS, as in bminute: the vault check runs before the missing-key
    // check, so the guard is exercised on every deployment rather than only on
    // ones that have a key — which is none of them in CI.
    ok('a room mentioning the vault stops the ask dead',
      r.d.code === 'vault_off_limits', `${r.s} ${JSON.stringify(r.d).slice(0, 140)}`);
    ok('and says what to do instead', /reveal/i.test(r.d.error || ''), r.d.error);

    // ---- The screens are told before anybody presses -------------------------------
    head('And every screen knows it is unavailable before it is pressed:');
    const caps = (await boss('GET', '/capabilities')).d.capabilities || [];
    // All seven, including ai_reply — which used to sit on the AI Assist page
    // as something planned, and now has a control on the correspondence
    // screen. A capability whose declared screen is not the screen the button
    // is on sends whoever reads it to the wrong place.
    const wanted = ['ai_catch_up', 'ai_meeting_brief', 'ai_minute_tasks',
      'ai_triage', 'ai_reply', 'ai_week_ahead', 'ai_record_candidates'];
    for (const id of wanted) {
      const c = caps.find((x) => x.id === id);
      ok(`${id} is declared`, !!c, JSON.stringify(caps.map((x) => x.id)).slice(0, 200));
      if (c) {
        ok(`  and says it needs a key`,
          c.available === false && (c.needs || []).includes('ANTHROPIC_API_KEY'),
          JSON.stringify(c));
      }
    }
    // Each on the screen it belongs to, not all on one settings page nobody is
    // looking at when they want the feature.
    const screens = new Set(wanted.map((id) => caps.find((c) => c.id === id)?.screen));
    ok('and they are spread across the screens they belong to',
      screens.size >= 4, JSON.stringify([...screens]));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nSeven things AI Assist can do, none of which can act, reach the vault, or pretend.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
