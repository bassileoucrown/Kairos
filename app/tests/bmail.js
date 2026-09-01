// Correspondence an assistant handles on a principal's behalf.
//
// WHAT A PA ACTUALLY DOES: view, organise, draft, send, delete — independently,
// without asking each time. The question this file answers is how that is
// scoped so it can be granted at all.
//
// THE BOUNDARY IS AT INGEST, NOT AT READ, and that is the decision everything
// else rests on. Kairos never holds the whole mailbox; the principal decides
// what crosses, and inside that the assistant has a free hand. What is outside
// was never here — not hidden, not redacted, absent. So most of this file is
// about the two edges of that boundary:
//
//   WHO MAY DO WHAT, per mailbox. Being an assistant to a principal does not
//   put you in their correspondence; a grant does, and only the principal can
//   write one. An assistant who could grant sending to a colleague could grant
//   it to themselves through that colleague.
//
//   WHAT GETS IN. The inbound route is the most exposed thing in the product —
//   a door the public internet posts through, whose contents end up in front
//   of a principal. Unsigned, wrongly addressed, and unknown-sender mail each
//   fail differently and deliberately.
//
// AND WHAT A DELETE LEAVES. "Gone, with a record that it existed": the words
// go, the envelope stays, and only the principal can remove the envelope.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4621, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const SECRET = 'inbound-secret-for-tests';
const DOMAIN = 'in.kairos.test';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function client() {
  let cookie = '';
  return async function call(method, path, body, headers = {}) {
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { s: r.status, d: json, text };
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
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const pa = client();
    const paUp = await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    const paId = paUp.d.user.id;
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    let inv = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    const cos = client();
    const cosUp = await cos('POST', '/auth/signup',
      { name: 'Tunde Bakare', email: `tunde${ID}@x.com`, password: PW, accountCategory: 'pa' });
    const cosId = cosUp.d.user.id;
    await cos('POST', '/profile/onboarding-step', { step: 'done' });
    inv = await boss('POST', '/members', { email: `tunde${ID}@x.com`, role: 'chief_of_staff' });
    await cos('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    // Somebody the office knows, so quarantine can be tested against a control.
    await boss('POST', `/pa/${bossId}/contacts`,
      { name: 'Chidi Nwosu', email: `chidi${ID}@ashford.com`, relationshipTier: 'professional' });

    // ---- The mailbox ---------------------------------------------------------
    head('A mailbox is the principal\'s to set up:');
    let r = await boss('POST', `/mail/${bossId}/accounts`,
      { kind: 'delegated', address: `office${ID}@exousia.test`, label: 'The office' });
    const accountId = r.d.account?.id;
    ok('the principal adds one', r.s === 201 && !!accountId, `${r.s} ${JSON.stringify(r.d).slice(0, 140)}`);

    // An assistant setting up a mailbox for a principal is a different act from
    // handling one, and this product does not confuse them.
    ok('an assistant cannot add one for them',
      (await pa('POST', `/mail/${bossId}/accounts`,
        { kind: 'delegated', address: `x${ID}@exousia.test` })).s === 403);

    // A synced mailbox needs a connector nobody has built. Refused with the
    // reason, not accepted into a state that silently never syncs.
    r = await boss('POST', `/mail/${bossId}/accounts`,
      { kind: 'gmail', address: `g${ID}@gmail.test` });
    ok('a Gmail sync says it is not configured rather than pretending',
      r.s === 503 && r.d.code === 'not_configured', `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);

    // ---- Who may touch it ----------------------------------------------------
    head('Being an assistant is not the same as being in the correspondence:');
    // THE ASSERTION THIS FILE EXISTS FOR. A PA of this principal, with no
    // grant, is not in the mailbox at all.
    ok('a PA with no grant cannot see it',
      ((await pa('GET', `/mail/${bossId}/accounts`)).d.accounts || []).length === 0);
    ok('nor open it directly',
      (await pa('GET', `/mail/${bossId}/accounts/${accountId}/threads`)).s === 404);
    // POSITIVE CONTROL: the principal can, so the emptiness above is the rule
    // and not a mailbox that failed to save.
    ok('though the principal can',
      ((await boss('GET', `/mail/${bossId}/accounts`)).d.accounts || []).length === 1);

    // And a Chief of Staff, who sees the whole office everywhere else.
    ok('and a Chief of Staff does not get in by rank',
      ((await cos('GET', `/mail/${bossId}/accounts`)).d.accounts || []).length === 0);

    r = await boss('PUT', `/mail/${bossId}/accounts/${accountId}/grants/${paId}`,
      { view: true, organise: true, draft: true, delete: true, sendMode: 'draft' });
    ok('the principal lets one person in', r.s === 201, String(r.s));
    ok('after which they can see it',
      ((await pa('GET', `/mail/${bossId}/accounts`)).d.accounts || []).length === 1);

    // Granting is the principal's alone: a PA who could grant to a colleague
    // could grant to themselves through that colleague.
    ok('but a PA cannot hand it to somebody else',
      (await pa('PUT', `/mail/${bossId}/accounts/${accountId}/grants/${cosId}`,
        { view: true })).s === 403);
    ok('nor take it away',
      (await pa('DELETE', `/mail/${bossId}/accounts/${accountId}/grants/${cosId}`)).s === 403);
    ok('and handing it over is on the principal\'s access log',
      Number((await db.prepare(
        "SELECT COUNT(*) AS n FROM access_log WHERE action = 'mail_grant'",
      ).get()).n) === 1);

    // ---- Getting mail in -----------------------------------------------------
    head('The door the outside world posts through:');
    r = await boss('GET', `/mail/${bossId}/accounts/${accountId}/inbound`);
    const address = r.d.address;
    ok('the principal is given a forwarding address', /^in\+[A-Za-z0-9_-]+@/.test(address || ''),
      String(address));
    // The token is the credential, so it must not be the sort of thing anybody
    // guesses or derives from the account.
    const tok = address.split('+')[1].split('@')[0];
    ok('and its token is long enough to be a secret', tok.length >= 20, String(tok.length));

    const post = (body, headers) => client()('POST', '/mail-inbound', body, headers);

    // AN UNSIGNED WEBHOOK IS REFUSED. Unconfigured webhooks usually degrade
    // into accepting anything; this one degrades into accepting nothing.
    ok('unsigned mail is refused',
      (await post({ to: address, from: 'x@y.com', subject: 'hi' })).s === 401);
    ok('and mail with the wrong secret',
      (await post({ to: address, from: 'x@y.com', subject: 'hi' },
        { 'x-kairos-inbound-secret': 'wrong' })).s === 401);
    ok('and correctly signed mail to an unknown mailbox',
      (await post({ to: `in+${'a'.repeat(30)}@${DOMAIN}`, from: 'x@y.com', subject: 'hi' },
        { 'x-kairos-inbound-secret': SECRET })).s === 404);

    const signed = (body) => post(body, { 'x-kairos-inbound-secret': SECRET });

    r = await signed({
      to: address, from: `chidi${ID}@ashford.com`, fromName: 'Chidi Nwosu',
      subject: 'The Q3 board pack', body: 'Attached, as promised.', messageId: 'm-1',
    });
    ok('mail from somebody the office knows is taken', r.s === 200 && !r.d.quarantined,
      JSON.stringify(r.d));

    // A stranger who has learned the address is held, not dropped and not
    // accepted: dropping loses a first approach that matters, accepting lets
    // anybody put things in front of a principal.
    r = await signed({
      to: address, from: 'stranger@nowhere.test', subject: 'Investment opportunity',
      body: 'Dear sir', messageId: 'm-2',
    });
    ok('mail from a stranger is quarantined rather than dropped', r.d.quarantined === true,
      JSON.stringify(r.d));

    // A rule that fires twice must not make two messages.
    r = await signed({
      to: address, from: `chidi${ID}@ashford.com`, subject: 'The Q3 board pack',
      body: 'Attached, as promised.', messageId: 'm-1',
    });
    ok('the same message arriving twice is one message', r.d.duplicate === true, JSON.stringify(r.d));
    ok('and the provider is told it succeeded, so it stops retrying', r.s === 200);

    // ---- Working it ----------------------------------------------------------
    head('And the assistant works it without asking:');
    r = await pa('GET', `/mail/${bossId}/accounts/${accountId}/threads`);
    const threads = r.d.threads || [];
    ok('the known correspondence is in the working inbox', threads.length === 1,
      JSON.stringify(threads.map((t) => t.subject)));
    ok('and the stranger is not', !threads.some((t) => /Investment/.test(t.subject)));
    // PRIVATE BY DEFAULT MOVED THIS LINE. Quarantine used to be a tray the
    // office worked through, and this asserted the PA could see what was in
    // it. It is now the boundary itself: a correspondent nobody has admitted
    // is the principal's alone, and admitting them is the principal's act.
    // See lib/mailAccess.js — maySeeThread — and bprivate.js, which is where
    // the whole rule and every door round it are tested.
    ok('and the office cannot see it waiting either',
      ((await pa('GET', `/mail/${bossId}/accounts/${accountId}/threads?quarantined=1`))
        .d.threads || []).length === 0);
    // POSITIVE CONTROL: it really did arrive and really is being held, so the
    // silence above is the rule rather than mail that never landed.
    ok('though the principal sees it waiting',
      ((await boss('GET', `/mail/${bossId}/accounts/${accountId}/threads?quarantined=1`))
        .d.threads || []).length === 1);

    const threadId = threads[0].id;
    r = await pa('PATCH', `/mail/${bossId}/accounts/${accountId}/threads/${threadId}`,
      { state: 'waiting', assignedTo: paId });
    ok('a thread can be filed as waiting on somebody', r.s === 200, String(r.s));
    ok('an invented state is refused',
      (await pa('PATCH', `/mail/${bossId}/accounts/${accountId}/threads/${threadId}`,
        { state: 'vibes' })).s === 400);

    // ---- A narrower grant ----------------------------------------------------
    head('A grant can be narrower than the whole job:');
    await boss('PUT', `/mail/${bossId}/accounts/${accountId}/grants/${cosId}`,
      { view: true, organise: false, delete: false, sendMode: 'draft' });
    ok('somebody can be given reading and nothing else',
      (await cos('GET', `/mail/${bossId}/accounts/${accountId}/threads`)).s === 200);
    r = await cos('PATCH', `/mail/${bossId}/accounts/${accountId}/threads/${threadId}`,
      { state: 'done' });
    ok('and cannot file it', r.s === 403, String(r.s));
    ok('nor delete it',
      (await cos('DELETE', `/mail/${bossId}/accounts/${accountId}/threads/${threadId}`)).s === 403);

    // ---- Deleting ------------------------------------------------------------
    head('Deleting takes the words and keeps the envelope:');
    r = await pa('DELETE', `/mail/${bossId}/accounts/${accountId}/threads/${threadId}`);
    ok('the assistant can clear it', r.s === 204, String(r.s));
    ok('and it leaves the working inbox',
      ((await pa('GET', `/mail/${bossId}/accounts/${accountId}/threads`)).d.threads || []).length === 0);

    r = await boss('GET', `/mail/${bossId}/accounts/${accountId}/deleted`);
    const tomb = (r.d.deleted || [])[0];
    // THE POINT OF "GONE, WITH A RECORD THAT IT EXISTED".
    ok('but the principal can see that it existed', !!tomb, JSON.stringify(r.d).slice(0, 160));
    ok('who it was from', /ashford/.test(tomb?.correspondentEmail || ''), tomb?.correspondentEmail);
    ok('what it was about', /Q3 board pack/.test(tomb?.subject || ''), tomb?.subject);
    ok('and who deleted it', tomb?.deletedByName === 'Ngozi Bello', tomb?.deletedByName);

    const msgs = await db.prepare('SELECT body FROM mail_messages WHERE thread_id = ?').all(threadId);
    // The words themselves are gone, which is what "deleted" has to mean.
    ok('while the words themselves are gone',
      msgs.every((m) => !m.body), JSON.stringify(msgs));
    ok('and it is on the access log',
      Number((await db.prepare(
        "SELECT COUNT(*) AS n FROM access_log WHERE action = 'mail_delete'",
      ).get()).n) === 1);

    // ---- Purging -------------------------------------------------------------
    head('And only the principal can remove the record that it existed:');
    ok('the assistant cannot purge it',
      (await pa('DELETE', `/mail/${bossId}/accounts/${accountId}/threads/${threadId}/purge`)).s === 403);
    r = await boss('DELETE', `/mail/${bossId}/accounts/${accountId}/threads/${threadId}/purge`);
    ok('the principal can', r.s === 204, String(r.s));
    ok('after which even the envelope is gone',
      !(await db.prepare('SELECT id FROM mail_threads WHERE id = ?').get(threadId)));
    ok('though the fact that a purge happened is still on the log',
      Number((await db.prepare(
        "SELECT COUNT(*) AS n FROM access_log WHERE action = 'mail_purge'",
      ).get()).n) === 1);

    // ---- Taking it back ------------------------------------------------------
    head('And it can be taken back:');
    await boss('DELETE', `/mail/${bossId}/accounts/${accountId}/grants/${paId}`);
    ok('once revoked the assistant is out',
      ((await pa('GET', `/mail/${bossId}/accounts`)).d.accounts || []).length === 0);
    ok('and cannot reach it directly either',
      (await pa('GET', `/mail/${bossId}/accounts/${accountId}/threads`)).s === 404);

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nCorrespondence is handled independently, inside a boundary the principal drew.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
