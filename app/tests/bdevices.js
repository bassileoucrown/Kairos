// Signing in on more than one device, seeing all of them, and ending any of
// them from any of the others.
//
// The property worth proving is not that a row disappears — it is that the
// revoked device is dead on its very next request. Sessions are rows read
// fresh on every call, so that follows; a stateless token would have needed a
// blocklist and this suite would have caught its absence.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4573);
const BASE = `http://127.0.0.1:${PORT}/api`;
const SERVER_DIR = `${ROOT}/app/server`;

let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

// Each client carries its own cookie AND its own user agent, which is what
// makes them different devices as far as the server is concerned.
function device(userAgent) {
  let c = '';
  return async (m, p, b) => {
    const r = await fetch(BASE + p, {
      method: m,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
        ...(c ? { Cookie: c } : {}),
      },
      body: b ? JSON.stringify(b) : undefined,
    });
    const sc = r.headers.get('set-cookie'); if (sc) c = sc.split(';')[0];
    let d = null; try { d = await r.json(); } catch { /* 204 */ }
    return { s: r.status, d };
  };
}

const UA = {
  laptop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  phone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  tablet: 'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

const ID = Date.now().toString(36);
const PW = 'password123';
const EMAIL = `dev${ID}@x.com`;
const QUESTION = 'The street my grandmother lived on';
const ANSWER = 'Ojuelegba Road';

(async () => {
  const proc = spawn('node', ['index.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), SESSION_TOUCH_MS: '0' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    // A minute. Twenty seconds is plenty on an idle machine and not plenty on a
    // loaded one, and "no server" on a green tree is a board crying wolf.
    const deadline = Date.now() + 60000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('the server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    // ---- Three devices, one account ------------------------------------
    head('Signing in on more than one device:');
    const laptop = device(UA.laptop);
    let r = await laptop('POST', '/auth/signup', { name: 'Ada', email: EMAIL, password: PW });
    ok('the first device signs up', r.s === 201, JSON.stringify(r.d).slice(0, 120));
    await laptop('POST', '/profile/onboarding-step', { step: 'done' });

    const phone = device(UA.phone);
    r = await phone('POST', '/auth/login', { email: EMAIL, password: PW });
    ok('a second device signs in with the same account', r.s === 200);

    const tablet = device(UA.tablet);
    r = await tablet('POST', '/auth/login', { email: EMAIL, password: PW });
    ok('and a third', r.s === 200);

    ok('the first device still works — signing in elsewhere disturbs nothing',
      (await laptop('GET', '/auth/me')).s === 200);

    // ---- Seeing them ----------------------------------------------------
    head('Seeing where you are signed in:');
    r = await laptop('GET', '/security/sessions');
    ok('all three are listed', r.d.sessions.length === 3, String(r.d.sessions?.length));
    const named = r.d.sessions.map((s) => s.device);
    ok('each is named by device rather than by token',
      named.some((n) => /iPhone/.test(n)) && named.some((n) => /Mac/.test(n)) && named.some((n) => /Android/.test(n)),
      JSON.stringify(named));
    ok('exactly one is marked as this device',
      r.d.sessions.filter((s) => s.isCurrent).length === 1);
    ok('this device is listed first, so it is hard to pick by accident',
      r.d.sessions[0].isCurrent === true);
    ok('each says when it was last used', r.d.sessions.every((s) => !!s.lastSeenAt));
    ok('and where it was last used from', r.d.sessions.every((s) => !!s.address),
      JSON.stringify(r.d.sessions.map((s) => s.address)));

    ok('the session cookie itself is never in the response',
      !JSON.stringify(r.d).includes('kairos_session'));
    const handles = r.d.sessions.map((s) => s.id);
    ok('handles are short, not usable credentials', handles.every((h) => h.length <= 16),
      JSON.stringify(handles));

    // ---- The guard, before a question is set -----------------------------
    head('Before a security question is set:');
    ok('the screen is told to ask for a password', r.d.guard.needs === 'password');
    const phoneHandle = r.d.sessions.find((s) => /iPhone/.test(s.device)).id;

    r = await laptop('POST', `/security/sessions/${phoneHandle}/revoke`, {});
    ok('revoking with nothing is refused', r.s === 401, String(r.s));
    r = await laptop('POST', `/security/sessions/${phoneHandle}/revoke`, { password: 'wrong' });
    ok('and with the wrong password', r.s === 401);

    // ---- Setting the question -------------------------------------------
    head('Setting the question:');
    r = await laptop('POST', '/security/question', { question: QUESTION, answer: ANSWER });
    ok('setting it without the password is refused', r.s === 401, String(r.s));
    r = await laptop('POST', '/security/question', { question: 'Short', answer: ANSWER, password: PW });
    ok('a question too short to recognise is refused', r.s === 400, JSON.stringify(r.d));
    r = await laptop('POST', '/security/question', {
      question: 'What is my dog called, Rex', answer: 'Rex', password: PW,
    });
    ok('an answer written inside its own question is refused', r.s === 400, JSON.stringify(r.d));
    r = await laptop('POST', '/security/question', { question: QUESTION, answer: ANSWER, password: PW });
    ok('a real one is accepted', r.s === 200 && r.d.question.isSet === true, JSON.stringify(r.d));
    ok('and the answer is nowhere in the response', !JSON.stringify(r.d).toLowerCase().includes('ojuelegba'));

    r = await laptop('GET', '/security/sessions');
    ok('the guard now asks the question instead', r.d.guard.needs === 'answer'
      && r.d.guard.question === QUESTION, JSON.stringify(r.d.guard));

    // ---- Ending one device ----------------------------------------------
    head('Ending the lost device from another one:');
    r = await laptop('POST', `/security/sessions/${phoneHandle}/revoke`, { answer: 'wrong' });
    ok('the wrong answer is refused', r.s === 401);
    ok('and the phone is still alive at that point', (await phone('GET', '/auth/me')).s === 200);

    r = await laptop('POST', `/security/sessions/${phoneHandle}/revoke`, { answer: '  ojuelegba   ROAD ' });
    ok('capitals and stray spaces still pass', r.s === 200, JSON.stringify(r.d).slice(0, 140));

    // The property this whole feature rests on.
    ok('the phone is dead on its very next request', (await phone('GET', '/auth/me')).s === 401);
    ok('and the laptop is untouched', (await laptop('GET', '/auth/me')).s === 200);
    ok('the tablet is untouched too', (await tablet('GET', '/auth/me')).s === 200);
    ok('the list is down to two', r.d.sessions.length === 2, String(r.d.sessions.length));

    // ---- You cannot evict yourself --------------------------------------
    head('Your own device is not revocable here:');
    r = await laptop('GET', '/security/sessions');
    const own = r.d.sessions.find((s) => s.isCurrent).id;
    r = await laptop('POST', `/security/sessions/${own}/revoke`, { answer: ANSWER });
    ok('signing yourself out here is refused, and says where to do it', r.s === 400
      && /sign out/i.test(r.d.error), JSON.stringify(r.d));
    ok('so this device still works', (await laptop('GET', '/auth/me')).s === 200);

    // ---- Somebody else's session is not yours to end ---------------------
    head('Another account\'s session:');
    const stranger = device(UA.laptop);
    await stranger('POST', '/auth/signup', { name: 'Bo', email: `s${ID}@x.com`, password: PW });
    await stranger('POST', '/profile/onboarding-step', { step: 'done' });
    const strangerSessions = (await stranger('GET', '/security/sessions')).d.sessions;
    ok('a stranger sees only their own', strangerSessions.length === 1);
    r = await stranger('POST', `/security/sessions/${own}/revoke`, { password: PW });
    ok('and cannot end one of ours — 404, not 403', r.s === 404, String(r.s));
    ok('ours is still alive', (await laptop('GET', '/auth/me')).s === 200);

    // ---- All the others at once ------------------------------------------
    head('Ending everything else:');
    r = await laptop('POST', '/security/sessions/revoke-others', { answer: ANSWER });
    ok('the tablet goes', r.s === 200 && r.d.ended === 1, JSON.stringify(r.d).slice(0, 120));
    ok('the tablet is dead on its next request', (await tablet('GET', '/auth/me')).s === 401);
    ok('this device survives, which is the entire point',
      (await laptop('GET', '/auth/me')).s === 200);
    ok('and only it remains listed', r.d.sessions.length === 1 && r.d.sessions[0].isCurrent);

    // ---- Keeping this device signed in -----------------------------------
    head('Staying signed in on a device you trust:');
    r = await laptop('GET', '/security/sessions');
    const before = r.d.sessions.find((x) => x.isCurrent);
    ok('a device is not trusted to begin with', before.trusted === false);

    r = await laptop('POST', '/security/sessions/trust', { trusted: true });
    ok('trusting it without the answer is refused', r.s === 401, String(r.s));

    r = await laptop('POST', '/security/sessions/trust', { trusted: true, answer: ANSWER });
    ok('with the answer it is accepted', r.s === 200, JSON.stringify(r.d).slice(0, 120));
    const after = r.d.sessions.find((x) => x.isCurrent);
    ok('and the device says so', after.trusted === true);
    ok('its clock is pushed well past the ordinary thirty days',
      new Date(after.expiresAt) - new Date(before.expiresAt) > 60 * 86400000,
      `${before.expiresAt} -> ${after.expiresAt}`);

    // The property that makes the long life safe to offer at all.
    ok('a trusted device is still listed like any other', !!after.id);

    r = await laptop('POST', '/security/sessions/trust', { trusted: false });
    ok('withdrawing trust needs no answer — it only ever reduces', r.s === 200);
    ok('and the device is ordinary again',
      r.d.sessions.find((x) => x.isCurrent).trusted === false);
    ok('but is still signed in — that was not a sign-out',
      (await laptop('GET', '/auth/me')).s === 200);

    // ---- Guessing costs something ----------------------------------------
    head('Guessing the answer:');
    let throttled = false;
    for (let i = 0; i < 14; i++) {
      const a = await laptop('POST', '/security/sessions/revoke-others', { answer: `guess${i}` });
      if (a.s === 429) { throttled = true; break; }
    }
    ok('guessing gets throttled', throttled);
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nYou can be signed in everywhere, and end any of it from anywhere.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})();
