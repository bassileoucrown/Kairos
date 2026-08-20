// Pairing codes. The security properties are the point: one neutral failure,
// the handle required alongside the code, armed rather than standing, the role
// the principal chose rather than a fixed one, and several codes running at
// once so that turning one off cannot silently kill another.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4485);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

// Each simulated person gets their own address. The redeem throttle counts
// against the account AND the source, so sharing one loopback address across
// the whole script would trip the source bucket on unrelated assertions —
// which is the throttle working, not the codes failing. The last section
// hammers from a single address on purpose.
let nextIp = 0;
function client(ip) {
  let cookie = '';
  nextIp += 1;
  const from = ip || `203.0.113.${nextIp}`;
  return async function call(method, path, body) {
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

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    // Deliberately set, to prove it is now ignored.
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), SIGNUP_ACCESS_CODE: 'OLD-GATE' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    const deadline = Date.now() + 30000;
    for (;;) {
      let ready = false;
      try { ready = (await (await fetch(`${BASE}/api/status`)).json()).databaseReady; }
      catch { /* not up */ }
      if (ready) break;
      if (Date.now() > deadline) throw new Error('server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    head('Signup is open:');
    const status = await (await fetch(`${BASE}/api/status`)).json();
    ok('status no longer advertises a signup gate',
      status.signupRequiresCode === undefined, JSON.stringify(status));

    const ada = client();
    const adaU = await signUp(ada, 'Ada Boss', `ada${ID}@x.com`, 'principal');
    await ada('PATCH', '/profile', { slug: `ada${ID}` });
    ok('anyone can sign up with no code at all', !!adaU.id);

    head('Arming a code:');
    const short = await ada('POST', '/access-codes', { code: 'ab', role: 'pa' });
    ok('a too-short code is refused', short.s === 400, JSON.stringify(short.d));
    const badRole = await ada('POST', '/access-codes', { code: 'THURSDAY-91', role: 'emperor' });
    ok('an unknown role is refused', badRole.s === 400, JSON.stringify(badRole.d));

    const armed = await ada('POST', '/access-codes',
      { code: 'thursday lagos 91', role: 'chief_of_staff', window: '24h', uses: 2 });
    ok('a code arms', armed.s === 201, JSON.stringify(armed.d));
    const first = armed.d.codes[0];
    ok('and is normalised for how people actually type it',
      first.code === 'THURSDAY-LAGOS-91', first.code);
    ok('carrying what the principal chose', first.role === 'chief_of_staff');
    ok('live, with a countdown', first.live === true && first.minutesLeft > 1000);
    ok('and a use count', first.usesLeft === 2);

    head('Every failure answers the same way:');
    const ben = client();
    await signUp(ben, 'Ben Reed', `ben${ID}@x.com`, 'pa');

    const wrongCode = await ben('POST', '/access-codes/redeem', { handle: `ada${ID}`, code: 'NOPE-NOPE' });
    const noSuchHandle = await ben('POST', '/access-codes/redeem', { handle: 'nobody-here-at-all', code: 'THURSDAY-LAGOS-91' });
    ok('a wrong code is refused', wrongCode.s === 400);
    ok('an unknown handle is refused', noSuchHandle.s === 400);
    ok('and the two are indistinguishable',
      wrongCode.d.error === noSuchHandle.d.error, `${wrongCode.d.error} / ${noSuchHandle.d.error}`);

    head('The handle is required, not just the code:');
    const zara = client();
    const zaraU = await signUp(zara, 'Zara Cole', `zara${ID}@x.com`, 'principal');
    await zara('PATCH', '/profile', { slug: `zara${ID}` });
    // Zara picks the SAME code. Two principals, one phrase — which is exactly
    // why a bare code could never have worked.
    await zara('POST', '/access-codes', { code: 'THURSDAY-LAGOS-91', role: 'delegate' });
    const toZara = await ben('POST', '/access-codes/redeem',
      { handle: `zara${ID}`, code: 'THURSDAY-LAGOS-91' });
    ok('the same phrase can belong to two principals at once', toZara.s === 201, JSON.stringify(toZara.d));
    ok('and the handle decides whose account you joined',
      toZara.d.joined.id === zaraU.id, JSON.stringify(toZara.d.joined));
    ok('with the role that principal chose, not the other one',
      toZara.d.role === 'delegate', toZara.d.role);

    head('Joining for real:');
    const joined = await ben('POST', '/access-codes/redeem',
      { handle: `ada${ID}`, code: 'thursday-lagos-91' });
    ok('the code works however it is typed', joined.s === 201, JSON.stringify(joined.d));
    ok('as the role the principal chose', joined.d.role === 'chief_of_staff');

    const ws = await ben('GET', '/workspace');
    ok('the principal appears on their workspace immediately',
      ws.d.principals.some((p) => p.id === adaU.id), JSON.stringify(ws.d.principals.map((p) => p.name)));
    ok('with a direct line already open',
      !!ws.d.principals.find((p) => p.id === adaU.id)?.directLine?.threadId);
    ok('and real access', (await ben('GET', `/today/${adaU.id}`)).s === 200);

    const again = await ben('POST', '/access-codes/redeem', { handle: `ada${ID}`, code: 'THURSDAY-LAGOS-91' });
    ok('joining twice says so plainly', again.s === 400 && /already have access/i.test(again.d.error),
      JSON.stringify(again.d));

    head('It runs out:');
    const cara = client();
    await signUp(cara, 'Cara Ng', `cara${ID}@x.com`, 'ea');
    const second = await cara('POST', '/access-codes/redeem', { handle: `ada${ID}`, code: 'THURSDAY-LAGOS-91' });
    ok('a second person can use the remaining use', second.s === 201);

    const dee = client();
    await signUp(dee, 'Dee Fourth', `dee${ID}@x.com`, 'pa');
    const third = await dee('POST', '/access-codes/redeem', { handle: `ada${ID}`, code: 'THURSDAY-LAGOS-91' });
    ok('a third is refused, the uses being spent', third.s === 400, JSON.stringify(third.d));
    ok('with the same neutral wording as a wrong code',
      third.d.error === wrongCode.d.error, third.d.error);

    const spent = await ada('GET', '/access-codes');
    const spentRow = spent.d.codes.find((c) => c.code === 'THURSDAY-LAGOS-91');
    ok('the principal sees why it stopped',
      spentRow.live === false && spentRow.endedBecause === 'used up', JSON.stringify(spentRow));

    head('Turning one off:');
    const armedSecond = await ada('POST', '/access-codes',
      { code: 'SECOND-CODE-77', role: 'pa', window: '1h', uses: 5 });
    const secondId = armedSecond.d.codes.find((c) => c.code === 'SECOND-CODE-77').id;
    const off = await ada('DELETE', `/access-codes/${secondId}`);
    ok('turning off answers with what is left', off.s === 200, JSON.stringify(off.d));
    ok('and the code is gone from the list',
      !off.d.codes.some((c) => c.code === 'SECOND-CODE-77'), JSON.stringify(off.d.codes));
    const afterOff = await dee('POST', '/access-codes/redeem', { handle: `ada${ID}`, code: 'SECOND-CODE-77' });
    ok('a turned-off code stops working at once', afterOff.s === 400, JSON.stringify(afterOff.d));

    head('Several at once, each with its own remit:');
    const nia = client();
    await signUp(nia, 'Nia Obi', `nia${ID}@x.com`, 'principal');
    await nia('PATCH', '/profile', { slug: `nia${ID}` });

    await nia('POST', '/access-codes',
      { code: 'CHIEF-ONE-11', role: 'chief_of_staff', window: '24h', uses: 3 });
    const two = await nia('POST', '/access-codes',
      { code: 'DIARY-TWO-22', role: 'delegate', window: '24h', uses: 3 });
    ok('a second code arms without disturbing the first', two.s === 201, JSON.stringify(two.d));
    const liveNow = two.d.codes.filter((c) => c.live);
    ok('both are live together', liveNow.length === 2, JSON.stringify(liveNow.map((c) => c.code)));
    ok('carrying different remits',
      new Set(liveNow.map((c) => c.role)).size === 2, JSON.stringify(liveNow.map((c) => c.role)));

    const dupPhrase = await nia('POST', '/access-codes', { code: 'chief one 11', role: 'pa' });
    ok('the same phrase twice would be ambiguous, so it is refused',
      dupPhrase.s === 400, JSON.stringify(dupPhrase.d));

    const eve = client();
    await signUp(eve, 'Eve Hart', `eve${ID}@x.com`, 'ea');
    const asChief = await eve('POST', '/access-codes/redeem',
      { handle: `nia${ID}`, code: 'CHIEF-ONE-11' });
    ok('one code grants its own role', asChief.s === 201 && asChief.d.role === 'chief_of_staff',
      JSON.stringify(asChief.d));

    const fin = client();
    await signUp(fin, 'Fin Okoro', `fin${ID}@x.com`, 'pa');
    const asDelegate = await fin('POST', '/access-codes/redeem',
      { handle: `nia${ID}`, code: 'DIARY-TWO-22' });
    ok('the other grants its own, to the same principal',
      asDelegate.s === 201 && asDelegate.d.role === 'delegate', JSON.stringify(asDelegate.d));

    head('Turning one off leaves the rest alone:');
    const niaCodes = (await nia('GET', '/access-codes')).d.codes;
    const chiefId = niaCodes.find((c) => c.code === 'CHIEF-ONE-11').id;
    const stray = await ben('DELETE', `/access-codes/${chiefId}`);
    ok('somebody else\'s code is not found rather than refused', stray.s === 404, JSON.stringify(stray.d));

    await nia('DELETE', `/access-codes/${chiefId}`);
    const gus = client();
    await signUp(gus, 'Gus Ade', `gus${ID}@x.com`, 'pa');
    const deadChief = await gus('POST', '/access-codes/redeem',
      { handle: `nia${ID}`, code: 'CHIEF-ONE-11' });
    ok('the one turned off stops working', deadChief.s === 400, JSON.stringify(deadChief.d));
    const stillDiary = await gus('POST', '/access-codes/redeem',
      { handle: `nia${ID}`, code: 'DIARY-TWO-22' });
    ok('and the one left alone still works',
      stillDiary.s === 201 && stillDiary.d.role === 'delegate', JSON.stringify(stillDiary.d));

    head('The pile is capped:');
    const cap = (await nia('GET', '/access-codes')).d.maxLive;
    ok('the limit is stated to the principal', cap >= 2, String(cap));
    let armedCount = (await nia('GET', '/access-codes')).d.codes.filter((c) => c.live).length;
    let refusedAt = null;
    for (let i = 0; armedCount < cap + 1 && i < 10; i += 1) {
      const r = await nia('POST', '/access-codes', { code: `FILLER-CODE-${i}`, role: 'pa' });
      if (r.s !== 201) { refusedAt = armedCount; break; }
      armedCount = r.d.codes.filter((c) => c.live).length;
    }
    ok('a code past the limit is refused', refusedAt === cap, `refused at ${refusedAt}, cap ${cap}`);

    head('Nobody else can see or set your codes:');
    const peek = await ben('GET', '/access-codes');
    ok('asking for codes returns only your own',
      Array.isArray(peek.d.codes) && peek.d.codes.length === 0, JSON.stringify(peek.d.codes));
    ok('and a principal\'s own codes are theirs to read',
      (await zara('GET', '/access-codes')).d.codes[0].code === 'THURSDAY-LAGOS-91');

    head('Guessing is throttled:');
    let throttled = false;
    for (let i = 0; i < 14; i += 1) {
      const r = await dee('POST', '/access-codes/redeem', { handle: `ada${ID}`, code: `GUESS-${i}` });
      if (r.s === 429) { throttled = true; break; }
    }
    ok('repeated attempts get cut off', throttled);
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }
  console.log(fails === 0 ? '\nPairing codes are correct.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
