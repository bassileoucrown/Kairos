// Peer connections and the household, with the isolation checks front and
// centre — those are the ones that matter, because both features hand someone
// a way in and the whole question is how far it reaches.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4461);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
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

async function signUp(call, name, email, category) {
  const r = await call('POST', '/auth/signup', { name, email, password: PW, accountCategory: category });
  if (r.s !== 200 && r.s !== 201) throw new Error(`signup ${name}: ${r.s} ${JSON.stringify(r.d)}`);
  await call('POST', '/profile/onboarding-step', { step: 'done' });
  return r.d.user;
}

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
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
      let ready = false;
      try { ready = (await (await fetch(`${BASE}/api/status`)).json()).databaseReady; }
      catch { /* not up yet */ }
      if (ready) break;
      if (Date.now() > deadline) throw new Error('server never became ready — is the database up?');
      await new Promise((r) => setTimeout(r, 200));
    }

    // Two entirely separate worlds: Ada with her PA Ben, Zara with her PA Yemi.
    const ada = client(); const ben = client();
    const zara = client(); const yemi = client();
    const adaU = await signUp(ada, 'Ada Boss', `ada${ID}@x.com`, 'principal');
    const benU = await signUp(ben, 'Ben Reed', `ben${ID}@x.com`, 'pa');
    const zaraU = await signUp(zara, 'Zara Cole', `zara${ID}@x.com`, 'principal');
    const yemiU = await signUp(yemi, 'Yemi Ade', `yemi${ID}@x.com`, 'pa');

    await ada('PATCH', '/profile', { slug: `ada${ID}` });
    await ben('PATCH', '/profile', { slug: `ben${ID}` });
    await yemi('PATCH', '/profile', { slug: `yemi${ID}` });

    for (const [principal, pa, email] of [[ada, ben, `ben${ID}@x.com`], [zara, yemi, `yemi${ID}@x.com`]]) {
      const inv = await principal('POST', '/members', { email, role: 'pa' });
      await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);
    }

    head('Handles before any connection:');
    const cold = await ben('POST', `/spaces`, { name: 'x', context: 'work' });
    const coldAdd = await ben('POST', `/spaces/${cold.d.space.id}/members`, { handle: `yemi${ID}` });
    ok('a stranger\'s handle does not resolve', coldAdd.s === 404, `${coldAdd.s} ${JSON.stringify(coldAdd.d)}`);

    head('Connecting two PAs who work for different principals:');
    const bogus = await ben('POST', '/connections', { handle: 'nobody-at-all-here' });
    ok('a handle that does not exist gets the same answer as one that does',
      bogus.s === 202 && /if that handle belongs/i.test(bogus.d.message), JSON.stringify(bogus.d));

    const req = await ben('POST', '/connections', { handle: `yemi${ID}`, note: 'Thursday, our two principals' });
    ok('a real request is answered identically', req.s === 202 && /if that handle belongs/i.test(req.d.message));

    let yemiList = await yemi('GET', '/connections');
    ok('it arrives as an incoming request', yemiList.d.incoming.length === 1, JSON.stringify(yemiList.d));
    ok('with the context attached', yemiList.d.incoming[0].note === 'Thursday, our two principals');
    ok('and never the requester\'s email',
      !JSON.stringify(yemiList.d).includes(`ben${ID}@x.com`));

    const benBefore = await ben('GET', '/connections');
    ok('the requester sees it as outstanding, not accepted',
      benBefore.d.outgoing.length === 1 && benBefore.d.connected.length === 0);

    const acc = await yemi('POST', `/connections/${yemiList.d.incoming[0].id}/accept`);
    ok('accepting opens a line', acc.s === 200 && !!acc.d.connection.threadId, JSON.stringify(acc.d));
    const threadId = acc.d.connection.threadId;

    const benNow = await ben('GET', '/connections');
    ok('both sides now have it', benNow.d.connected.length === 1
      && benNow.d.connected[0].threadId === threadId);

    const said = await ben('POST', `/threads/${threadId}/messages`, { body: 'Thursday 3pm work for yours?' });
    ok('they can talk', said.s === 201, JSON.stringify(said.d));
    const heard = await yemi('GET', `/threads/${threadId}/messages`);
    ok('and the other hears it', heard.d.messages?.length === 1);

    const promoted = await yemi('POST', `/threads/${threadId}/messages/${said.d.id}/promote`,
      { recordType: 'request' });
    ok('a confirmation can be promoted to a record, which is the whole point',
      promoted.s === 200 || promoted.s === 201, `${promoted.s} ${JSON.stringify(promoted.d)}`);

    head('A connection is not a delegation:');
    const peek = await ben('GET', `/today/${zaraU.id}`);
    ok('Ben cannot see Zara\'s day', peek.s === 403 || peek.s === 404, String(peek.s));
    const peekEss = await ben('GET', `/essentials/${zaraU.id}`);
    ok('nor her essentials', peekEss.s === 403 || peekEss.s === 404, String(peekEss.s));
    const peekPa = await ben('GET', `/pa/${zaraU.id}/approvals`);
    ok('nor her approvals', peekPa.s === 403 || peekPa.s === 404, String(peekPa.s));
    const yemiPeek = await yemi('GET', `/today/${adaU.id}`);
    ok('and it does not work the other way either', yemiPeek.s === 403 || yemiPeek.s === 404, String(yemiPeek.s));

    head('Now the handle resolves, because they both agreed:');
    const warmAdd = await ben('POST', `/spaces/${cold.d.space.id}/members`, { handle: `yemi${ID}` });
    ok('a connected peer\'s handle resolves', warmAdd.s === 201, `${warmAdd.s} ${JSON.stringify(warmAdd.d)}`);

    head('Ending a connection:');
    const ended = await ben('DELETE', `/connections/${benNow.d.connected[0].id}`);
    ok('either side can end it', ended.s === 204, String(ended.s));
    const after = await yemi('GET', `/threads/${threadId}/messages`);
    ok('and the line closes for both', after.s === 404, String(after.s));

    // -----------------------------------------------------------------
    head('The household:');
    const femi = client(); const cook = client();
    await signUp(femi, 'Femi Okon', `femi${ID}@x.com`, 'principal');
    await signUp(cook, 'Chidi Nwosu', `cook${ID}@x.com`, 'principal');

    const addDriver = await ada('POST', `/household/${adaU.id}/staff`,
      { name: 'Femi Okon', email: `femi${ID}@x.com`, jobTitle: 'Driver' });
    ok('a driver can be added', addDriver.s === 201, JSON.stringify(addDriver.d));
    const addCook = await ada('POST', `/household/${adaU.id}/staff`,
      { name: 'Chidi Nwosu', email: `cook${ID}@x.com`, jobTitle: 'Chef' });
    ok('and a chef', addCook.s === 201);

    const noTitle = await ada('POST', `/household/${adaU.id}/staff`, { email: `x${ID}@x.com` });
    ok('a role in the house is required', noTitle.s === 400, String(noTitle.s));

    const invPreview = await femi('GET', `/invites/${addDriver.d.inviteLink.split('/').pop()}`);
    ok('the invite page says what they are joining',
      /will not see their calendar/i.test(invPreview.d.invite?.scope || ''), JSON.stringify(invPreview.d));

    await femi('POST', `/invites/${addDriver.d.inviteLink.split('/').pop()}/accept`);
    await cook('POST', `/invites/${addCook.d.inviteLink.split('/').pop()}/accept`);

    const me = await femi('GET', '/auth/me');
    ok('the app knows to land them on their instructions', me.d.user.isHouseholdStaff === true);

    head('What a driver can reach:');
    for (const [label, path] of [
      ["the principal's day", `/today/${adaU.id}`],
      ['their essentials', `/essentials/${adaU.id}`],
      ['the approval queue', `/pa/${adaU.id}/approvals`],
      ['their contacts', `/pa/${adaU.id}/contacts`],
      ['their itinerary', `/itinerary/${adaU.id}/day?date=2026-08-12`],
      ['their upcoming travel', `/itinerary/${adaU.id}/upcoming`],
      ['the household roster', `/household/${adaU.id}`],
    ]) {
      const r = await femi('GET', path);
      ok(`not ${label}`, r.s === 403 || r.s === 404, `${path} -> ${r.s}`);
    }
    const bogusPath = await femi('GET', '/no-such-endpoint-at-all');
    ok('an unknown API path is a JSON 404, not a page of HTML',
      bogusPath.s === 404 && !!bogusPath.d?.error, `${bogusPath.s} ${JSON.stringify(bogusPath.d).slice(0, 60)}`);

    const wsFemi = await femi('GET', '/workspace');
    ok('and no principal appears in their workspace', wsFemi.d.principals?.length === 0,
      JSON.stringify(wsFemi.d.principals));

    head('Giving an instruction:');
    const roster = await ada('GET', `/household/${adaU.id}`);
    const driverRow = roster.d.members.find((m) => m.jobTitle === 'Driver');
    const cookRow = roster.d.members.find((m) => m.jobTitle === 'Chef');

    const instr = await ada('POST', `/household/${adaU.id}/instructions`,
      { memberId: driverRow.id, body: 'Car at 7:15 for Heathrow T5.', dueAt: '2026-09-01T07:15:00Z' });
    ok('the principal can ask the driver to do something', instr.s === 201, JSON.stringify(instr.d));
    await ada('POST', `/household/${adaU.id}/instructions`,
      { memberId: cookRow.id, body: 'Dinner for six, two vegetarian.' });

    const mine = await femi('GET', '/household/mine');
    ok('the driver sees theirs', mine.d.instructions.length === 1, JSON.stringify(mine.d.instructions));
    ok("and not the chef's", !JSON.stringify(mine.d).includes('Dinner for six'));
    ok('it starts unconfirmed', mine.d.instructions[0].status === 'open');

    const otherInstr = await femi('GET', `/household/instructions/${instr.d.instruction.id}`);
    ok('they can open their own', otherInstr.s === 200);

    const cookMine = await cook('GET', '/household/mine');
    const cookPeek = await cook('GET', `/household/instructions/${instr.d.instruction.id}`);
    ok("one staff member cannot open another's instruction", cookPeek.s === 404, String(cookPeek.s));
    ok("and the chef sees only their own", cookMine.d.instructions.length === 1
      && cookMine.d.instructions[0].body.includes('Dinner'));

    head('Confirming it landed:');
    const todayBefore = await ada('GET', `/today/${adaU.id}`);
    ok('an unconfirmed instruction shows in what needs the principal',
      todayBefore.d.needsYou.unconfirmedInstructions?.length === 2,
      String(todayBefore.d.needsYou.unconfirmedInstructions?.length));

    const gotIt = await femi('POST', `/household/instructions/${instr.d.instruction.id}/acknowledge`);
    ok('the driver can say they have it', gotIt.s === 200);
    const todayAfter = await ada('GET', `/today/${adaU.id}`);
    ok('and it clears from the principal\'s list',
      todayAfter.d.needsYou.unconfirmedInstructions?.length === 1);

    const reply = await femi('POST', `/household/instructions/${instr.d.instruction.id}/replies`,
      { body: 'Traffic on the bridge — ten minutes behind.' });
    ok('they can say something back', reply.s === 201, JSON.stringify(reply.d));
    const detail = await ada('GET', `/household/instructions/${instr.d.instruction.id}`);
    ok('and the principal reads it', detail.d.replies.length === 1);

    head('Who else may instruct:');
    const paSend = await ben('POST', `/household/${adaU.id}/instructions`,
      { memberId: driverRow.id, body: 'Collect the dry cleaning.' });
    ok("the principal's PA can, because that is the job", paSend.s === 201, JSON.stringify(paSend.d));
    const paRoster = await ben('POST', `/household/${adaU.id}/staff`,
      { email: `nope${ID}@x.com`, jobTitle: 'Gardener' });
    ok('but only the principal hires and dismisses', paRoster.s === 403, String(paRoster.s));

    const del = client();
    await signUp(del, 'Dee Legate', `dee${ID}@x.com`, 'principal');
    const delInv = await ada('POST', '/members', { email: `dee${ID}@x.com`, role: 'delegate' });
    await del('POST', `/invites/${delInv.d.inviteLink.split('/').pop()}/accept`);
    const delSend = await del('POST', `/household/${adaU.id}/instructions`,
      { memberId: driverRow.id, body: 'anything' });
    ok('a scheduling-only delegate cannot reach the household', delSend.s === 403, String(delSend.s));
    const delRead = await del('GET', `/household/${adaU.id}`);
    ok('nor read it', delRead.s === 403, String(delRead.s));
    const delToday = await del('GET', `/today/${adaU.id}`);
    ok('and their Today carries no household at all',
      (delToday.d.needsYou?.unconfirmedInstructions || []).length === 0);

    head('Dismissing someone:');
    await ada('POST', `/household/${adaU.id}/staff/${driverRow.id}/revoke`);
    const goneMine = await femi('GET', '/household/mine');
    ok('their instructions stop being reachable', goneMine.d.instructions.length === 0,
      JSON.stringify(goneMine.d.instructions));
    const goneOne = await femi('GET', `/household/instructions/${instr.d.instruction.id}`);
    ok('including individually', goneOne.s === 404, String(goneOne.s));
    const stillOnRecord = await ada('GET', `/household/${adaU.id}`);
    ok('but the principal keeps the record of what was asked',
      JSON.stringify(stillOnRecord.d).includes('Heathrow'));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0 ? '\nConnections and the household are correct.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
