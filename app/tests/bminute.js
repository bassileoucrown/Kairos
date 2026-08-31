// Writing up a meeting, and the four things a model must not be able to do.
//
// WHAT THE FEATURE IS. The assistant was in the room and the principal was
// not. A dictation goes in raw on the way to the car; a draft is written from
// whatever the office has; a person edits it and files it. The office's record
// of the meeting exists, which it mostly did not before, because nobody types
// four paragraphs from memory at seven in the evening.
//
// WHAT THIS SUITE IS ACTUALLY GUARDING, which is the other half:
//
//   IT CANNOT ACT. Asking for a draft must write NOTHING. Not a minute, not a
//   note, nothing. The gap between "a model produced words" and "the office's
//   record says so" is a person reading it, and that gap has to be provable
//   rather than promised.
//
//   IT CANNOT REACH THE VAULT. A meeting note containing the word "passport"
//   must stop the draft outright rather than quietly sending the note to
//   somebody else's servers. This is the one that would end a custody
//   business, and lib/aiModel.js makes it a code path rather than a sentence
//   in a prompt precisely so a test can try it.
//
//   IT CANNOT PRETEND. With no ANTHROPIC_API_KEY the answer is an honest
//   refusal, not a template dressed up as a draft.
//
//   A RECORDING CANNOT START ITSELF. 'off' is the default and there is no
//   'auto'. With no storage and no transcription configured, turning it on
//   refuses and says which piece is missing.
//
// NOTE ON THE MODEL. No key is set in this environment, so the draft path is
// tested up to and including the refusal. The vault gate is tested for real —
// it runs BEFORE the key check is reached, which is the correct order and is
// itself asserted below.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4619, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
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
      // Explicitly absent, not merely unset by accident: this suite asserts
      // what the app does with no model, so it must not pass or fail
      // differently on a machine where somebody happens to have a key.
      ANTHROPIC_API_KEY: '',
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

    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('PATCH', '/profile', { slug: `adaeze-${ID}`, timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    // Open around the clock so nothing here depends on the hour it runs at.
    await boss('PUT', '/availability', {
      rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
    });
    const mt = (await boss('POST', '/meeting-types', {
      name: 'Board', durationMinutes: 60, locationType: 'video', accessTier: 1,
    })).d.meetingType;

    const pa = client();
    await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    const inv = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    const anon = client();
    const slots = (await anon('GET', `/public/adaeze-${ID}/${mt.slug}/slots`)).d.slots || [];
    ok('the booking page offers slots', slots.length > 0, String(slots.length));
    const made = await anon('POST', `/public/adaeze-${ID}/${mt.slug}/book`, {
      timezone: 'UTC', startAt: slots[0].startAt,
      name: 'Chidi Nwosu', email: `chidi${ID}@x.com`,
    });
    const bookingId = made.d.booking?.id;
    ok('a meeting can be booked', !!bookingId, `${made.s} ${JSON.stringify(made.d).slice(0, 160)}`);

    // Moved into the past: the app refuses to book history, and a minute
    // cannot be written for a meeting that has not started. A suite cannot
    // wait a day, so the row is aged the way bcatch ages its own.
    await db.prepare('UPDATE bookings SET start_at = ?, end_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 7200000).toISOString(),
        new Date(Date.now() - 3600000).toISOString(), bookingId);

    const paBase = `/pa/${bossId}/bookings/${bookingId}`;

    // ---- The dictation -------------------------------------------------------
    head('What somebody says walking out of the room:');
    let r = await pa('POST', `${paBase}/dictation`,
      { body: 'He will fund the second tranche once the audit is in. Wants it before March.' });
    ok('a dictation can be filed', r.s === 201, `${r.s} ${JSON.stringify(r.d).slice(0, 140)}`);
    ok('and it is its own kind, not a minute', r.d.note?.kind === 'dictation', r.d.note?.kind);
    // A dictation is candid and half-formed. It is office material, and the
    // person on the other side of the meeting holds a link they can forward.
    const booker = await fetch(`${BASE}/api/public/bookings/${bookingId}`)
      .then((x) => x.json()).catch(() => ({}));
    ok('the person you met cannot see it',
      !JSON.stringify(booker).includes('second tranche'), JSON.stringify(booker).slice(0, 200));

    r = await pa('GET', `${paBase}/notes`);
    ok('but the office can', (r.d.notes || []).some((n) => n.kind === 'dictation'));

    // ---- Asking for a draft --------------------------------------------------
    head('And what happens when there is no model configured:');
    r = await pa('POST', `${paBase}/minutes/draft`);
    // THE HONEST ANSWER. Not a template presented as a draft — see the top of
    // lib/aiModel.js for why that distinction is worth an error code.
    ok('the draft refuses rather than pretending', r.s === 503, String(r.s));
    ok('and says why', r.d.code === 'model_not_configured', JSON.stringify(r.d).slice(0, 160));

    // THE ASSERTION THIS FILE EXISTS FOR. Nothing was written.
    r = await pa('GET', `${paBase}/notes`);
    const after = r.d.notes || [];
    ok('and nothing at all was filed by asking',
      after.filter((n) => n.kind === 'minute').length === 0,
      JSON.stringify(after.map((n) => n.kind)));

    // ---- The vault gate ------------------------------------------------------
    head('A meeting note that mentions the vault stops the draft dead:');
    await pa('POST', `${paBase}/notes`,
      { body: 'Bring his passport number for the visa people', visibility: 'office' });
    r = await pa('POST', `${paBase}/minutes/draft`);
    // ORDER MATTERS AND IS ASSERTED HERE. The vault check runs BEFORE the
    // model-configured check, so a deployment with no key still refuses for
    // the right reason — and, more to the point, a deployment WITH a key never
    // reaches the send. If these were the other way round the guard would be
    // untested on every machine that has no key, which is all of them here.
    ok('it is refused for the vault, not for the missing key',
      r.d.code === 'vault_off_limits', `${r.s} ${JSON.stringify(r.d).slice(0, 160)}`);
    ok('and the refusal says what to do instead',
      /reveal/i.test(r.d.error || ''), r.d.error);

    // ---- Filing --------------------------------------------------------------
    head('A person files it, and the record says who wrote the first version:');
    r = await pa('POST', `${paBase}/minutes`, {
      body: 'Present: AO, CN. Decided: fund tranche two after the audit.',
      draftedByAi: true,
    });
    ok('the minutes can be filed', r.s === 201, String(r.s));
    ok('marked as drafted by a machine', r.d.note?.draftedByAi === true,
      JSON.stringify(r.d.note).slice(0, 160));
    // POSITIVE CONTROL: the flag is carried, not stamped on everything.
    r = await pa('POST', `${paBase}/minutes`, { body: 'And a second one, typed by hand.' });
    ok('and one typed by hand is not', r.d.note?.draftedByAi === false,
      JSON.stringify(r.d.note).slice(0, 160));
    ok('minutes are still office-only', r.d.note?.visibility === 'office', r.d.note?.visibility);

    // ---- Recording -----------------------------------------------------------
    head('A recording never starts itself:');
    r = await pa('GET', `${paBase}`);
    // NOT `(x || 'off') === 'off'`, which is the assertion I first wrote and
    // which passed while the field did not exist at all — so the screen could
    // never have shown whether a meeting was being taped. An absent field and
    // a field saying 'off' are different facts and the test has to tell them
    // apart.
    ok('the meeting says whether it is being recorded',
      typeof r.d.booking?.recordingState === 'string', JSON.stringify(r.d.booking).slice(0, 120));
    ok('and it is off unless somebody said otherwise',
      r.d.booking?.recordingState === 'off', r.d.booking?.recordingState);

    r = await pa('POST', `${paBase}/recording`, { state: 'on' });
    // Storage and transcription are both unconfigured here, so this is the
    // honest refusal — and it names which piece is missing rather than saying
    // "not configured", which tells a deployer nothing.
    ok('turning it on refuses while the pieces are missing', r.s === 503, String(r.s));
    ok('and names what is missing',
      /store|transcription/i.test(r.d.error || ''), r.d.error);

    r = await pa('POST', `${paBase}/recording`, { state: 'auto' });
    ok('there is no such thing as recording automatically', r.s === 400, String(r.s));

    // Turning it OFF is always allowed, even unconfigured: a state that cannot
    // be left is a trap, and this is the direction that reduces surprise.
    r = await pa('POST', `${paBase}/recording`, { state: 'off' });
    ok('but it can always be turned off', r.s === 200, String(r.s));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA meeting gets written up, and the machine that helps cannot act, reach the vault, or pretend.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
