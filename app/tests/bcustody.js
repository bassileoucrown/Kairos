// Handles, two-factor, encryption, the access log, and who may see what.
// The whole custody layer, from the outside.
//
// This used to lean on whatever server happened to be listening on port 4000,
// and it only ever passed once per database. Three things were wrong with
// that, and all three are fixed here rather than worked around.
//
// IT OWNS ITS SERVER. The rate limiter is in memory and keyed on the address
// as well as the account — and a success clears the account key, never the
// address key. So every login any other suite made from 127.0.0.1 counted
// against this one, and a run that came late in allsuites.sh met a 429 at
// "password alone is no longer enough" and reported it as a product failure.
// Borrowing a shared server also meant borrowing whatever ENCRYPTION_KEY it
// was started with, which is to say usually none, which is to say the whole
// vault half of this suite was testing the refusal path by accident.
//
// ITS FIXTURES ARE SCOPED TO THE RUN. The handle was the literal 'ada-boss'.
// A handle is unique across the app, so the second run against any database
// got "that handle is already taken" — which reads exactly like a
// normalisation bug and is not one.
//
// ITS DATES ARE RELATIVE. Expiry was asserted against dates written in 2026.
// Those assertions were going to start failing on a Tuesday for no reason
// anybody could see, which is the worst kind of red.
//
// ONE THING TO KNOW BEFORE ADDING TO IT: the login limiter allows 8 attempts
// per address per fifteen minutes, and the last section here deliberately
// exhausts them. Everything before it spends exactly five. Add a sign-in
// anywhere above and the throttling assertion stops proving anything.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const totp = require(`${ROOT}/app/server/lib/totp`);

const PORT = Number(process.env.PORT || 4561);
const BASE = `http://127.0.0.1:${PORT}/api`;
const SERVER_DIR = `${ROOT}/app/server`;

let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

function sess() {
  let c = '';
  return async (m, p, b) => {
    const r = await fetch(BASE + p, {
      method: m, headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) },
      body: b ? JSON.stringify(b) : undefined,
    });
    const sc = r.headers.get('set-cookie'); if (sc) c = sc.split(';')[0];
    let d = null; try { d = await r.json(); } catch { /* 204 */ }
    return { s: r.status, d };
  };
}

const ID = Date.now().toString(36);
const PW = 'password123';
const EMAIL = `b${ID}@x.com`;
const HANDLE = `ada-boss-${ID}`;

// Short enough to watch lapse inside one run. The default is five minutes,
// which is right for a person at a check-in desk and useless for a test.
const GRACE_MS = 2000;

/** A calendar date this many days from now, as YYYY-MM-DD. */
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// When the boss's session last proved itself, so the lapse can be waited out
// exactly rather than guessed at with a round number.
let steppedUpAt = 0;

(async () => {
  // Nothing is wiped. Sibling suites in this directory delete the local SQLite
  // file before they start, which is why running two of them at once used to
  // pull the database out from under whichever was slower — and why running
  // any of them cost you your development data. Every fixture below is scoped
  // to ID, so this suite is idempotent on a database it shares with anybody.

  const proc = spawn('node', ['index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      STEP_UP_GRACE_MS: String(GRACE_MS),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    // A minute. Twenty seconds is plenty on an idle machine and not plenty on a
    // loaded one, and "no server" on a green tree is a board crying wolf.
    const deadline = Date.now() + 60000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/status`)).json()).databaseReady) break; }
      catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error('the server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = sess();
    await boss('POST', '/auth/signup', { name: 'Ada Boss', email: EMAIL, password: PW });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    const me = await boss('GET', '/auth/me');
    ok('the account is there', !!me.d?.user?.id, JSON.stringify(me.d));
    const bossId = me.d.user.id;

    console.log('\nHandles:');
    let r = await boss('PATCH', '/profile', { slug: 'admin' });
    ok('reserved handles are refused', r.s === 400 && /reserved/i.test(r.d.error));
    ok('too short is refused', (await boss('PATCH', '/profile', { slug: 'ab' })).s === 400);
    ok('bad characters are refused', (await boss('PATCH', '/profile', { slug: 'a b!c' })).s === 400);
    r = await boss('PATCH', '/profile', { slug: `@Ada-Boss-${ID}` });
    ok('a leading @ and capitals are accepted and normalised',
      r.s === 200 && r.d.user.slug === HANDLE, `${r.s} ${r.d.user?.slug || r.d.error}`);

    console.log('\nEssentials — ordinary fields:');
    r = await boss('POST', `/essentials/${bossId}`, {
      category: 'preferences', field: 'seat_preference', value: 'Aisle, front of cabin',
    });
    ok('a preference is stored', r.s === 201 && r.d.essential.value === 'Aisle, front of cabin', JSON.stringify(r.d));
    ok('and is not masked', r.d.essential.masked === false);

    console.log('\nEssentials — sensitive fields:');
    const PASSPORT_EXPIRES = day(45);
    r = await boss('POST', `/essentials/${bossId}`, {
      category: 'travel_identity', field: 'passport_number',
      value: 'A01234821', expiresOn: PASSPORT_EXPIRES,
    });
    ok('a passport is stored', r.s === 201, JSON.stringify(r.d));
    const passportId = r.d.essential?.id;
    ok('and comes back masked, not in the clear',
      r.d.essential?.masked === true && /4821$/.test(r.d.essential.value), r.d.essential?.value);
    ok('the raw number is nowhere in the response', !JSON.stringify(r.d).includes('A01234821'));

    r = await boss('GET', `/essentials/${bossId}`);
    ok('listing never returns the raw value', !JSON.stringify(r.d).includes('A01234821'));
    const listed = r.d.essentials.find((e) => e.id === passportId);
    ok('the passport is in the listing', !!listed, JSON.stringify(r.d.essentials?.map((e) => e.field)));
    ok('expiry state is computed', listed?.expiryState === 'expiring', String(listed?.expiryState));
    ok('and it is marked verified on entry', !!listed?.verifiedAt);

    console.log('\nRevealing:');
    r = await boss('POST', `/essentials/${bossId}/${passportId}/reveal`, {});
    ok('reveal without a password is refused', r.s === 401);
    r = await boss('POST', `/essentials/${bossId}/${passportId}/reveal`, { password: 'wrong' });
    ok('reveal with the wrong password is refused', r.s === 401);
    r = await boss('POST', `/essentials/${bossId}/${passportId}/reveal`, { password: PW });
    steppedUpAt = Date.now();
    ok('reveal with the right password works', r.s === 200 && r.d.essential.value === 'A01234821', r.d.essential?.value);

    // One step-up covers a few minutes of work — a Chief of Staff at a
    // check-in desk reads a passport, then a visa, then a Known Traveller
    // number, and typing three codes from a thirty-second rotation is the
    // friction that makes people turn two-factor off entirely. So the very
    // next sensitive read costs nothing, and that is the feature.
    r = await boss('POST', `/essentials/${bossId}/${passportId}/reveal`, {});
    ok('and the next reveal inside the grace window costs nothing',
      r.s === 200 && r.d.essential.value === 'A01234821', `${r.s} ${JSON.stringify(r.d)}`);

    r = await boss('GET', '/security/access-log');
    ok('the reveal was written to the access log',
      r.d.entries.some((e) => e.action === 'reveal' && e.field === 'passport_number'));
    ok('so was the creation', r.d.entries.some((e) => e.action === 'create'));

    console.log('\nWhat a delegate may see:');
    r = await boss('POST', '/members', { email: `d${ID}@x.com`, role: 'delegate' });
    const delToken = r.d.inviteLink.split('/').pop();
    const del = sess();
    await del('POST', '/auth/signup', { name: 'Dee', email: `d${ID}@x.com`, password: PW });
    await del('POST', `/invites/${delToken}/accept`);

    r = await del('GET', `/essentials/${bossId}`);
    ok('a delegate can read the list', r.s === 200);
    ok('and sees the ordinary preference', r.d.essentials.some((e) => e.field === 'seat_preference'));
    ok('but the passport is simply absent, not refused',
      !r.d.essentials.some((e) => e.field === 'passport_number'),
      JSON.stringify(r.d.essentials.map((e) => e.field)));
    ok('and they are told they cannot see sensitive details', r.d.canSeeSensitive === false);
    ok('revealing it is a 404, never a 403',
      (await del('POST', `/essentials/${bossId}/${passportId}/reveal`, { password: PW })).s === 404);
    ok('nor can they create one', (await del('POST', `/essentials/${bossId}`, {
      category: 'travel_identity', field: 'passport_number', value: 'X999',
    })).s === 403);

    console.log('\nWhat a full assistant may see:');
    r = await boss('POST', '/members', { email: `p${ID}@x.com` });
    const paToken = r.d.inviteLink.split('/').pop();
    const pa = sess();
    await pa('POST', '/auth/signup', { name: 'Kit', email: `p${ID}@x.com`, password: PW, accountCategory: 'chief_of_staff' });
    await pa('POST', `/invites/${paToken}/accept`);

    r = await pa('GET', `/essentials/${bossId}`);
    ok('a Chief of Staff sees the passport exists', r.d.essentials.some((e) => e.field === 'passport_number'));
    ok('still masked', r.d.essentials.find((e) => e.field === 'passport_number').masked === true);
    r = await pa('POST', `/essentials/${bossId}/${passportId}/reveal`, { password: PW });
    ok('and can reveal it with their own password', r.s === 200 && r.d.essential.value === 'A01234821');

    r = await boss('GET', '/security/access-log');
    const byPa = r.d.entries.find((e) => e.actorName === 'Kit' && e.action === 'reveal');
    ok('the principal sees who looked', !!byPa);
    ok('and that it was not them', byPa && byPa.isSelf === false);

    console.log('\nTrip readiness:');
    // Both dates are read against the passport's own expiry rather than the
    // calendar, so this suite does not quietly expire.
    r = await boss('GET', `/essentials/${bossId}/trip-ready?date=${day(30)}`);
    ok('a passport expiring within six months is flagged', r.d.overall === 'warning', JSON.stringify(r.d.checks));
    ok('without revealing the number', !JSON.stringify(r.d).includes('A01234821'));
    r = await boss('GET', `/essentials/${bossId}/trip-ready?date=${day(60)}`);
    ok('and travelling after it expires is blocked', r.d.overall === 'blocked', JSON.stringify(r.d.checks));

    console.log('\nTravel block:');
    // Wait the grace window out rather than pausing a round number — the point
    // is that the gate comes back, and a sleep long enough today is a flake
    // tomorrow. Without this the block assembles freely and the assertion
    // below reads as a hole in the vault when it is the window doing its job.
    const lapsed = steppedUpAt + GRACE_MS + 400 - Date.now();
    if (lapsed > 0) await sleep(lapsed);

    r = await boss('POST', `/essentials/${bossId}/travel-block`, {});
    ok('once the window has lapsed, assembling it needs a password again',
      r.s === 401, `${r.s} ${JSON.stringify(r.d)}`);
    r = await boss('POST', `/essentials/${bossId}/travel-block`, { password: PW });
    ok('and then carries the real values', r.s === 200 && r.d.text.includes('A01234821'), r.d.text);
    ok('including the preference', r.d.text.includes('Aisle, front of cabin'));

    console.log('\nTwo-factor:');
    r = await boss('GET', '/security');
    ok('starts off', r.d.twoFactor.enabled === false);
    ok('and reports that encryption is configured', r.d.encryptionConfigured === true);
    r = await boss('POST', '/security/2fa/setup');
    ok('setup issues a secret and a QR uri', r.s === 200 && !!r.d.secret && r.d.uri.startsWith('otpauth://'));
    const secret = r.d.secret;
    const now = () => totp.codeAt(secret, Math.floor(Date.now() / 1000 / 30));
    ok('but is not yet in force', (await boss('GET', '/security')).d.twoFactor.enabled === false);
    ok('a wrong code does not confirm it', (await boss('POST', '/security/2fa/confirm', { code: '000000' })).s === 400);
    r = await boss('POST', '/security/2fa/confirm', { code: now() });
    ok('the right code confirms it', r.s === 200 && r.d.recoveryCodes.length === 8, JSON.stringify(r.d).slice(0, 120));
    const recovery = r.d.recoveryCodes[0];
    ok('and now it is on', (await boss('GET', '/security')).d.twoFactor.enabled === true);

    // Two-factor now defaults to the vault rather than the front door, so
    // sign-in still costs the password alone. bscope owns that decision; what
    // this suite checks is that moving the scope actually moves the gate.
    console.log('\nAsking for it at the front door instead:');
    r = await boss('POST', '/security/2fa/scope', { scope: 'login_and_vault', code: now() });
    ok('the principal can move it there', r.s === 200 && r.d.scope === 'login_and_vault',
      `${r.s} ${JSON.stringify(r.d)}`);

    console.log('\nSigning in with it:');
    // Five attempts from this address, and the limiter allows eight. See the
    // note at the top before adding another.
    const again = sess();
    r = await again('POST', '/auth/login', { email: EMAIL, password: PW });
    ok('password alone is no longer enough', r.s === 401 && r.d.needsCode === true, JSON.stringify(r.d));
    r = await again('POST', '/auth/login', { email: EMAIL, password: PW, code: '111111' });
    ok('a wrong code is refused', r.s === 401);
    r = await again('POST', '/auth/login', { email: EMAIL, password: PW, code: now() });
    ok('the right code signs in', r.s === 200, JSON.stringify(r.d));

    const rec = sess();
    r = await rec('POST', '/auth/login', { email: EMAIL, password: PW, code: recovery });
    ok('a recovery code also signs in', r.s === 200, JSON.stringify(r.d));
    const rec2 = sess();
    r = await rec2('POST', '/auth/login', { email: EMAIL, password: PW, code: recovery });
    ok('but only once', r.s === 401, JSON.stringify(r.d));

    console.log('\nRate limiting:');
    const attacker = sess();
    let blocked = false;
    for (let i = 0; i < 12; i++) {
      const a = await attacker('POST', '/auth/login', { email: EMAIL, password: `guess${i}` });
      if (a.s === 429) { blocked = true; break; }
    }
    ok('guessing gets throttled', blocked);
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0 ? '\nCustody layer is correct.' : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})();
