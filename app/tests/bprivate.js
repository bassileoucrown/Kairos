// Which correspondence an assistant sees, and which is the principal's alone.
//
// PRIVATE BY DEFAULT. The obvious design — a list of addresses barred from the
// assistant — leaks three ways, and each of them is found out afterwards: a
// person is not an address, so the same conversation arrives from a phone or a
// new domain; the subject line is the content, so "Re: the settlement" in a
// list tells them everything without opening it; and it fails open, so
// anything nobody remembered to add is visible.
//
// So the default is the other way round. An assistant sees correspondents the
// principal has ADMITTED. Everything else waits where only the principal can
// see it, and letting one through is the principal's act.
//
// PLUS A PER-THREAD OVERRIDE, for the case the rule cannot predict: a
// correspondent the office knows perfectly well who writes about something
// personal once.
//
// WHAT THIS FILE IS REALLY FOR is the list of doors. A privacy rule is only as
// good as the narrowest route around it, so every way of reaching a thread is
// tried from an assistant who should not have it: the list, the thread itself,
// filing it, deleting it, and — the one most likely to be forgotten — handing
// it to a model for triage.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4643, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const SECRET = 'inbound-secret-for-tests';
const DOMAIN = 'in.exousia.test';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function client() {
  let cookie = '';
  return async function call(method, path, body, headers = {}) {
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers, ...(cookie ? { cookie } : {}) },
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
      INBOUND_EMAIL_SECRET: SECRET, INBOUND_EMAIL_DOMAIN: DOMAIN,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    const deadline = Date.now() + 150000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = client();
    const bossId = (await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' })).d.user.id;
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const pa = client();
    await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    const inv = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);
    const paId = (await pa('GET', '/auth/me')).d.user.id;

    // Somebody the office knows. Their correspondence is the office's business.
    await boss('POST', `/pa/${bossId}/contacts`,
      { name: 'Chidi Nwosu', email: `chidi${ID}@ashford.com`, relationshipTier: 'professional' });

    const account = (await boss('POST', `/mail/${bossId}/accounts`,
      { kind: 'delegated', address: `office${ID}@exousia.test`, label: 'The office' })).d.account;
    await boss('PUT', `/mail/${bossId}/accounts/${account.id}/grants/${paId}`,
      { view: true, organise: true, draft: true, delete: true, sendMode: 'draft' });

    const address = (await boss('GET', `/mail/${bossId}/accounts/${account.id}/inbound`)).d.address;
    const post = (body) => client()('POST', '/mail-inbound', body,
      { 'x-kairos-inbound-secret': SECRET });

    await post({
      to: address, from: `chidi${ID}@ashford.com`, fromName: 'Chidi Nwosu',
      subject: 'The Q3 board pack', body: 'Attached, as promised.', messageId: `known-${ID}`,
    });
    const stranger = await post({
      to: address, from: 'solicitor@private.test', fromName: 'A Solicitor',
      subject: 'The settlement', body: 'As discussed.', messageId: `new-${ID}`,
    });
    ok('mail from somebody new is held rather than accepted',
      stranger.d.quarantined === true, JSON.stringify(stranger.d));

    const listFor = async (who) =>
      (await who('GET', `/mail/${bossId}/accounts/${account.id}/threads`)).d.threads || [];
    const quarantinedFor = async (who) =>
      (await who('GET', `/mail/${bossId}/accounts/${account.id}/threads?quarantined=1`)).d.threads || [];

    // ---- The default -------------------------------------------------------------
    head('An assistant sees the correspondents the principal has admitted:');
    let mine = await listFor(pa);
    ok('the known correspondent is theirs to work',
      mine.some((t) => /Q3 board pack/.test(t.subject)), JSON.stringify(mine.map((t) => t.subject)));
    ok('and there is exactly one thread in their list', mine.length === 1,
      JSON.stringify(mine.map((t) => t.subject)));

    head('And nothing at all of the one nobody admitted:');
    // THE ASSERTION THIS FILE EXISTS FOR. Not "cannot open" — cannot see that
    // it is there. The subject line alone would have said enough.
    ok('the held correspondence is not in their list',
      !mine.some((t) => /settlement/i.test(t.subject)), JSON.stringify(mine.map((t) => t.subject)));
    ok('nor in the held tray, which is no longer theirs to work',
      (await quarantinedFor(pa)).length === 0,
      JSON.stringify(await quarantinedFor(pa)));

    // POSITIVE CONTROL: the principal sees both, so the two silences above are
    // the rule rather than mail that failed to arrive.
    ok('though the principal has both', (await listFor(boss)).length
      + (await quarantinedFor(boss)).length === 2,
      JSON.stringify([(await listFor(boss)).length, (await quarantinedFor(boss)).length]));

    const held = (await quarantinedFor(boss))[0];
    const known = (await listFor(boss)).find((t) => /Q3/.test(t.subject));

    // ---- Every other door ----------------------------------------------------------
    head('And every other way in is shut, not just the list:');
    const at = (id) => `/mail/${bossId}/accounts/${account.id}/threads/${id}`;
    ok('opening it directly is not found',
      (await pa('GET', at(held.id))).s === 404);
    ok('filing it is not found',
      (await pa('PATCH', at(held.id), { state: 'done' })).s === 404);
    // The most damaging verb, and the one a gate written only for reading
    // would leave open.
    ok('and deleting it is not found',
      (await pa('DELETE', at(held.id))).s === 404);
    // POSITIVE CONTROL: the same three work on the thread they may see, so the
    // 404s above are the gate rather than three broken routes.
    ok('though all three reach the correspondence they do handle',
      (await pa('GET', at(known.id))).s === 200
      && (await pa('PATCH', at(known.id), { state: 'waiting' })).s === 200,
      'one of GET/PATCH failed on the admitted thread');
    // Put back, because the control above really did file it and the triage
    // check below asks for what is still open. A positive control that leaves
    // the fixture changed makes the next assertion measure the control.
    await pa('PATCH', at(known.id), { state: 'open' });

    // ---- The door most easily forgotten ---------------------------------------------
    head('Including the one that hands correspondence to a model:');
    // No key is configured here, so the ask refuses — but it refuses AFTER
    // assembling the list, which is where a private thread would have leaked.
    // Counting what the mailbox hands the ask is therefore done directly.
    const mailbox = require(`${ROOT}/app/server/lib/mailbox`);
    const mailAccess = require(`${ROOT}/app/server/lib/mailAccess`);
    const acct = await require(`${ROOT}/app/server/lib/db`)
      .prepare('SELECT * FROM mail_accounts WHERE id = ?').get(account.id);
    const paMay = await mailAccess.accessFor(acct, paId);
    const forTriage = await mailbox.threads(acct.id, { state: 'open', may: paMay });
    ok('triage is handed only what the assistant may see',
      forTriage.length === 1 && !/settlement/i.test(forTriage[0].subject),
      JSON.stringify(forTriage.map((t) => t.subject)));

    // ---- Admitting is the principal's ------------------------------------------------
    head('Letting a new correspondent through belongs to the principal:');
    ok('an assistant cannot admit one',
      (await pa('PATCH', at(held.id), { releaseQuarantine: true })).s === 404);
    let r = await boss('PATCH', at(held.id), { releaseQuarantine: true });
    ok('the principal can', r.s === 200, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    mine = await listFor(pa);
    ok('after which the office can work it',
      mine.some((t) => /settlement/i.test(t.subject)), JSON.stringify(mine.map((t) => t.subject)));

    // ---- The per-thread override -------------------------------------------------------
    head('And one correspondence can be taken back out of the office\'s sight:');
    ok('an assistant cannot take one private',
      (await pa('PATCH', at(known.id), { visibility: 'private' })).s === 403);
    r = await boss('PATCH', at(known.id), { visibility: 'private' });
    ok('the principal can', r.s === 200, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    mine = await listFor(pa);
    ok('and it leaves the assistant\'s list entirely',
      !mine.some((t) => /Q3/.test(t.subject)), JSON.stringify(mine.map((t) => t.subject)));
    ok('while the one they were admitted to stays',
      mine.some((t) => /settlement/i.test(t.subject)), JSON.stringify(mine.map((t) => t.subject)));
    ok('and the principal still has it, marked',
      (await listFor(boss)).some((t) => /Q3/.test(t.subject) && t.visibility === 'private'),
      JSON.stringify((await listFor(boss)).map((t) => [t.subject, t.visibility])));

    // NOT A ONE-WAY DOOR. A principal who cannot undo this would think twice
    // before using it, which would make the feature not exist.
    r = await boss('PATCH', at(known.id), { visibility: 'office' });
    ok('and it can be put back', r.s === 200, String(r.s));
    ok('after which the office has it again',
      (await listFor(pa)).some((t) => /Q3/.test(t.subject)));

    ok('a visibility that is neither is refused',
      (await boss('PATCH', at(known.id), { visibility: 'somewhat' })).s === 400);

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nAn assistant sees who the principal admitted, and one letter can always be kept back.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
