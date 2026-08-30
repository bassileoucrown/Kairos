// The direct line, at the API level.
//
// What has to be true: the room appears the moment somebody accepts, both
// sides land in the SAME room, a second assistant joins that same room and
// can read what was said before they arrived, and a revoked assistant is out
// of it immediately.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4431);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

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
    return { status: r.status, body: json };
  };
}

async function signUp(call, name, email, category) {
  const r = await call('POST', '/auth/signup', { name, email, password: PW, accountCategory: category });
  if (r.status !== 200 && r.status !== 201) throw new Error(`signup ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  // Two and a half minutes. Twenty seconds was plenty on an idle machine and
  // not plenty on a loaded one; a minute went the same way, twice in one day,
  // on a box where a hundred suites run back to back and each one starts a
  // server and half of them start a browser. "No server" on a green tree is a
  // board crying wolf, and it costs an hour of hunting a product bug that was
  // never there.
  //
  // Waiting longer is free when the tree is green — the loop exits the instant
  // the server answers — and is only paid when something is genuinely broken,
  // which is the right way round for this trade.
  const deadline = Date.now() + 150000;
  for (;;) {
    try { const r = await (await fetch(`${BASE}/api/status`)).json(); if (r.databaseReady) break; }
    catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('server never became ready');
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    const ada = client(); const ben = client(); const cara = client();
    const adaUser = await signUp(ada, 'Ada Boss', `ada${ID}@x.com`, 'principal');
    const adaId = adaUser.user.id;

    // A principal working alone has nobody to talk to, so no room.
    let today = await ada('GET', `/today/${adaId}`);
    ok('no direct line before there is a team', today.body.directLine === null,
      JSON.stringify(today.body.directLine));

    // --- Ben accepts ---
    const inv = await ada('POST', '/members', { email: `ben${ID}@x.com`, role: 'pa' });
    ok('invite created', inv.status === 201, JSON.stringify(inv.body));
    const benToken = inv.body.inviteLink.split('/').pop();
    await signUp(ben, 'Ben Reed', `ben${ID}@x.com`, 'pa');
    const acc = await ben('POST', `/invites/${benToken}/accept`);
    ok('invite accepted', acc.status === 200, JSON.stringify(acc.body));

    today = await ada('GET', `/today/${adaId}`);
    const line = today.body.directLine;
    ok('the principal has a direct line the moment somebody accepts', !!line?.threadId,
      JSON.stringify(line));
    ok('it starts empty', line && line.lastMessage === null && line.unread === 0);

    const ws = await ben('GET', '/workspace');
    const benLine = ws.body.principals?.[0]?.directLine;
    ok('the assistant sees it on their workspace', !!benLine?.threadId, JSON.stringify(benLine));
    ok('both sides are in the SAME room', benLine?.threadId === line?.threadId,
      `${benLine?.threadId} vs ${line?.threadId}`);

    // --- Talking ---
    const posted = await ben('POST', `/threads/${line.threadId}/messages`, { body: 'Car is outside.' });
    ok('the assistant can post', posted.status === 201, JSON.stringify(posted.body));

    today = await ada('GET', `/today/${adaId}`);
    ok('the principal sees the last message', today.body.directLine?.lastMessage?.body === 'Car is outside.',
      JSON.stringify(today.body.directLine?.lastMessage));
    ok('and it counts as unread', today.body.directLine?.unread === 1,
      String(today.body.directLine?.unread));

    // READING IS WHAT CLEARS IT, and that is a correction. The count used to
    // be what you had not ANSWERED, which never moved until you replied — so
    // somebody who read a message watched the rail go quiet while the room
    // kept its 1. Two numbers for one question, disagreeing in the way most
    // likely to be noticed. Opening the thread is what reading means, and it
    // is the same stamp the rail has always used.
    await ada('GET', `/threads/${line.threadId}/messages`);
    today = await ada('GET', `/today/${adaId}`);
    ok('and reading it clears the count, without a word being said back',
      today.body.directLine?.unread === 0, String(today.body.directLine?.unread));

    const reply = await ada('POST', `/threads/${line.threadId}/messages`, { body: 'On my way down.' });
    ok('the principal can reply', reply.status === 201, JSON.stringify(reply.body));

    today = await ada('GET', `/today/${adaId}`);
    ok('answering leaves it clear', today.body.directLine?.unread === 0,
      String(today.body.directLine?.unread));
    const ws2 = await ben('GET', '/workspace');
    ok('and raises the assistant\'s', ws2.body.principals[0].directLine.unread === 1,
      String(ws2.body.principals[0].directLine.unread));

    // --- A second assistant joins the same room ---
    const inv2 = await ada('POST', '/members', { email: `cara${ID}@x.com`, role: 'ea' });
    const caraToken = inv2.body.inviteLink.split('/').pop();
    await signUp(cara, 'Cara Ng', `cara${ID}@x.com`, 'ea');
    await cara('POST', `/invites/${caraToken}/accept`);

    const caraWs = await cara('GET', '/workspace');
    const caraLine = caraWs.body.principals[0].directLine;
    ok('a second assistant lands in the same room, not a new one',
      caraLine?.threadId === line.threadId, `${caraLine?.threadId} vs ${line.threadId}`);

    const history = await cara('GET', `/threads/${line.threadId}/messages`);
    ok('and can read what was said before they arrived',
      history.status === 200 && history.body.messages?.length === 2,
      `${history.status} / ${history.body.messages?.length}`);

    // --- Membership is a mirror, not a second list ---
    const manual = await ada('POST', `/spaces/${line.spaceId}/members`, { email: `ben${ID}@x.com` });
    ok('adding someone by hand is refused rather than silently undone',
      manual.status === 400 && /direct line/i.test(manual.body.error || ''),
      `${manual.status} ${JSON.stringify(manual.body)}`);

    // --- Revoking ---
    const members = await ada('GET', '/members');
    const benMembership = members.body.members.find((m) => m.invitedEmail === `ben${ID}@x.com`);
    const rev = await ada('POST', `/members/${benMembership.id}/revoke`);
    ok('revoked', rev.status === 204, String(rev.status));

    const benAfter = await ben('GET', `/threads/${line.threadId}/messages`);
    ok('a revoked assistant loses the room immediately', benAfter.status === 404,
      `${benAfter.status} ${JSON.stringify(benAfter.body)}`);
    const benPost = await ben('POST', `/threads/${line.threadId}/messages`, { body: 'still here?' });
    ok('and cannot post into it', benPost.status === 404, String(benPost.status));

    const caraStill = await cara('GET', `/threads/${line.threadId}/messages`);
    ok('the remaining assistant is untouched', caraStill.status === 200, String(caraStill.status));

    const adaStill = await ada('GET', `/today/${adaId}`);
    ok('and the principal still has their line', !!adaStill.body.directLine?.threadId);
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0 ? '\nAll direct-line checks passed.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 1 && 0 : 1);
})();
