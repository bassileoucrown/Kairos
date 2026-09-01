// A principal who is not on Kairos, held by the assistant who works for them.
//
// WHAT THIS FILE IS ABOUT. A great many assistants work for somebody who will
// never open an app, and until now that person could not exist here at all:
// every owner-scoped query reads a users row, and memberships.owner_id
// references one. So a kept principal IS a users row, with a password nothing
// can match, and a membership written at the same moment — which is why the
// switcher, the day sheet and the approval queue need no special case.
//
// THE ASSERTIONS THAT MATTER are not that the record can be made. They are
// that it cannot be signed into, that the assistant cannot make themselves the
// only way back into it, and that claiming it does not evict them. Held is not
// owned, and the difference has to be a property of the system rather than a
// sentence in a document. Each of those is sabotaged below.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const fs = require('fs');
const DATA = `${ROOT}/app/server/data`;
for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
  if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
}

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}/api`;
const PW = 'password123';
const ID = Date.now().toString(36);
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (t) => console.log(`\n${t}`);

const server = spawn('node', ['--experimental-sqlite', 'index.js'], {
  cwd: `${ROOT}/app/server`,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: process.env.DATABASE_URL || '' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let boot = '';
server.stderr.on('data', (d) => { boot = (boot + d).slice(-4000); });
let died = null;
server.on('exit', (code, signal) => { died = signal ? `signal ${signal}` : `exit ${code}`; });
process.on('exit', () => server.kill());

function sess() {
  let c = '';
  return async (m, p, b) => {
    const r = await fetch(BASE + p, {
      method: m,
      headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) c = sc.split(';')[0];
    let d = null;
    try { d = await r.json(); } catch { /* 204 */ }
    return { s: r.status, d };
  };
}

async function waitReady() {
  const deadline = Date.now() + 150000;
  for (;;) {
    try { if ((await (await fetch(`${BASE}/status`)).json()).databaseReady) return; }
    catch { /* not up yet */ }
    if (died) throw new Error(`the server never became ready — server ${died}\n${boot.trim()}`);
    if (Date.now() > deadline) throw new Error(`the server never became ready\n${boot.trim()}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

(async () => {
  await waitReady();
  try {
    const pa = sess();
    const paEmail = `kit${ID}@x.com`;
    await pa('POST', '/auth/signup', { name: 'Kit Staff', email: paEmail, password: PW, timezone: 'UTC', accountCategory: 'chief_of_staff' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });

    const bossEmail = `adaeze${ID}@x.com`;

    head('An assistant can take on somebody who is not on Kairos:');
    let r = await pa('POST', '/pa/kept', { name: 'Adaeze Okonkwo', claimEmail: bossEmail, timezone: 'Africa/Lagos' });
    ok('the record is made', r.s === 201, JSON.stringify(r.d));
    const kept = r.d?.principal;
    ok('it has a handle of its own', !!kept?.slug, kept?.slug);
    ok('and the principal\'s timezone, not the assistant\'s',
      kept?.timezone === 'Africa/Lagos', kept?.timezone);
    ok('and it says how the principal takes it back',
      /password/i.test(r.d?.claim?.how || ''), r.d?.claim?.how);

    head('It behaves like any other principal, with no special case:');
    r = await pa('GET', '/pa/principals');
    const mine = (r.d.principals || []).find((p) => p.id === kept.id);
    ok('it is in the switcher', !!mine, JSON.stringify((r.d.principals || []).map((p) => p.name)));
    ok('and marked as held rather than an account that appointed you',
      mine?.kept === true, JSON.stringify(mine));
    ok('the assistant\'s own account is not marked held',
      (r.d.principals || []).find((p) => p.role === 'owner')?.kept === false);
    ok('their day sheet opens', (await pa('GET', `/today/${kept.id}`)).s === 200);
    ok('and it is read in their zone, not the assistant\'s',
      (await pa('GET', `/today/${kept.id}`)).d.timezone === 'Africa/Lagos');
    // The day is read in the PRINCIPAL'S zone, so the key has to be derived
    // from the entry rather than from this process's idea of today. Three hours
    // from now in London is already tomorrow in Lagos for part of every day,
    // and asking for the wrong day would look exactly like the entry being lost.
    const entryAt = new Date(Date.now() + 3 * 3600000).toISOString();
    const entryDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' })
      .format(new Date(entryAt));
    const made = await pa('POST', `/itinerary/${kept.id}/items`, {
      kind: 'meeting', title: 'Board pre-read', startAt: entryAt,
    });
    ok('an itinerary entry can be put on it', made.s === 201, JSON.stringify(made.d).slice(0, 120));
    // An assistant's entry lands as a draft — their working, not the
    // principal's day — and is published when it is real. That rule is not
    // suspended for a kept principal, so the assistant publishes here exactly
    // as they would for somebody who signs in. Worth knowing when the Desk is
    // designed: on a held record a draft has no audience at all, so anything
    // left unpublished is invisible to the principal on the day they claim it.
    ok('and publishing it puts it on the principal\'s day',
      (await pa('POST', `/itinerary/${kept.id}/items/${made.d?.item?.id}/publish`)).s === 200);
    ok('and it appears on their day',
      (await pa('GET', '/attention/across')).d.principals.some((p) => p.id === kept.id));

    head('But it is a record, not an account anybody can get into:');
    r = await pa('POST', '/auth/login', { email: bossEmail, password: PW });
    ok('the claim address plus a guessed password is refused', r.s === 401, String(r.s));
    r = await pa('POST', '/auth/login', { email: bossEmail, password: '!kept' });
    ok('and so is the sentinel that is actually in the column', r.s === 401, String(r.s));
    ok('the refusal does not admit the record exists',
      /incorrect email or password/i.test(r.d?.error || ''), r.d?.error);

    // AND THE GUARD ITSELF, not the sentinel that happens to sit in front of it.
    // Removing the kept_by check from login left every assertion above green,
    // because "!kept" is not a hash any password can match — so those were
    // passing on a library's behaviour rather than on the stated rule. Give the
    // held record a real, working password hash, the way a bug elsewhere or a
    // row from some future import might, and the rule is what is left standing.
    {
      const store = require(`${ROOT}/app/server/lib/db`);
      await store.ready();
      const { hashPassword } = require(`${ROOT}/app/server/lib/auth`);
      await store.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(hashPassword('averyrealpassword'), kept.id);
      const tryIt = await pa('POST', '/auth/login', { email: bossEmail, password: 'averyrealpassword' });
      ok('a held record refuses a password that genuinely matches its hash',
        tryIt.s === 401, String(tryIt.s));
      // Put the sentinel back so the claim below is tested from the real state.
      await store.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run('!kept', kept.id);
    }

    head('Held is not owned — the assistant cannot be the way back in:');
    r = await pa('POST', '/pa/kept', { name: 'Second Boss', claimEmail: paEmail });
    ok('their own address is refused as a claim address', r.s === 400, String(r.s));
    ok('and the refusal says why, because it is the whole point',
      /their own|take the record back/i.test(r.d?.error || ''), r.d?.error);
    r = await pa('POST', '/pa/kept', { name: 'Third Boss', claimEmail: bossEmail });
    ok('a claim address already in use is refused', r.s === 409, String(r.s));
    r = await pa('POST', '/pa/kept', { name: 'No Address' });
    ok('and a record with no claim address cannot be made at all', r.s === 400, String(r.s));

    head('The principal takes their record whenever they choose:');
    r = await pa('POST', '/auth/forgot-password', { email: bossEmail });
    ok('asking for a password at the claim address is accepted', r.s === 200 || r.s === 202, String(r.s));
    // THE ASSISTANT CANNOT READ THE CLAIM LINK. Their outbox is their own, and
    // the claim goes to the principal — which is the escrow rule holding at the
    // one moment it would actually be tested. If this ever starts returning the
    // link, an assistant could claim the record they are holding and the whole
    // arrangement inverts.
    const box = (await pa('GET', '/emails')).d;
    const theirs = JSON.stringify(box || '');
    ok('the assistant cannot read the claim link out of their own outbox',
      !/reset-password/.test(theirs), theirs.slice(0, 200));

    // So take the token the way the principal does: out of the record, not out
    // of the assistant's screen. This stands in for them opening their email.
    const store = require(`${ROOT}/app/server/lib/db`);
    await store.ready();
    const row = await store.prepare(
      'SELECT pr.id FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE u.email = ?',
    ).get(bossEmail);
    const match = row?.id ? [null, row.id] : null;
    ok('a claim token was raised against the principal\'s own record', !!match, JSON.stringify(row));

    if (match) {
      const boss = sess();
      r = await boss('POST', `/auth/reset-password/${match[1]}`, { password: 'brandnewpass1' });
      ok('setting a password claims the record', r.s === 200, JSON.stringify(r.d));
      r = await boss('POST', '/auth/login', { email: bossEmail, password: 'brandnewpass1' });
      ok('and now they can sign in', r.s === 200, JSON.stringify(r.d).slice(0, 120));

      head('And claiming it does not evict the assistant:');
      r = await pa('GET', '/pa/principals');
      const after = (r.d.principals || []).find((p) => p.id === kept.id);
      ok('the assistant still has them', !!after, JSON.stringify((r.d.principals || []).map((p) => p.name)));
      ok('but they are no longer marked held', after?.kept === false, JSON.stringify(after));
      ok('the work done while it was held is still there',
        ((await pa('GET', `/itinerary/${kept.id}/day?date=${entryDay}`)).d.entries || [])
          .some((e) => e.title === 'Board pre-read'));
      ok('and the principal sees it as their own',
        ((await boss('GET', `/itinerary/${kept.id}/day?date=${entryDay}`)).d.entries || [])
          .some((e) => e.title === 'Board pre-read'));
    }

    head('A stranger cannot take on a principal on somebody else\'s behalf:');
    const nobody = await fetch(`${BASE}/pa/kept`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Someone', claimEmail: `x${ID}@x.com` }),
    });
    ok('signed out, it is a refusal rather than a record', nobody.status === 401, String(nobody.status));
  } catch (e) {
    fails++;
    console.log('  ✗ threw: ' + (e && e.stack ? e.stack : e));
  }

  server.kill();
  console.log(fails ? `\n${fails} FAILURES` : '\nA principal can be held for somebody not on Kairos, and taken back by them.');
  process.exit(fails ? 1 : 0);
})();
