// The whole delegation story, end to end: separate dashboards, drafts that
// stay hidden, publishing, requesting approval, deciding, roles, revoke, and
// account deletion.
// OWNS ITS SERVER, rather than borrowing whatever is on port 4000.
//
// Twenty-seven of the suites in this directory delete app/server/data/kairos.sqlite
// before they start. A long-lived shared server holds that path open across the
// deletion, so whichever suite ran next against it met a database that was no
// longer the one on disk — signup appeared to work, /auth/me found nobody, and
// the crash landed here rather than anywhere near the cause. Every suite that
// runs immediately after a deleting one hit this; the two that showed it were
// simply the two next in alphabetical order.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const PORT = Number(process.env.PORT || 4563);
const BASE = `http://127.0.0.1:${PORT}/api`;
const server = spawn('node', ['index.js'], {
  cwd: `${ROOT}/app/server`,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});
process.on('exit', () => server.kill());

// Wait for databaseReady, not for a response: the server binds its port before
// the database is up by design, and every API route is 503 until it is.
async function waitReady() {
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
    try { if ((await (await fetch(`${BASE}/status`)).json()).databaseReady) return; }
    catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('the server never became ready');
    await new Promise((r) => setTimeout(r, 200));
  }
}
let fails = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) { fails++; console.log('  ✗ ' + label + (extra ? ' — ' + extra : '')); }
  else console.log('  ✓ ' + label);
};
function sess() {
  let c = '';
  return async (m, p, b) => {
    const r = await fetch(BASE + p, {
      method: m,
      headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) },
      body: b ? JSON.stringify(b) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) c = sc.split(';')[0];
    let d = null;
    try { d = await r.json(); } catch { /* 204 */ }
    return { s: r.status, d };
  };
}
const ID = Date.now().toString(36);
const soon = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

(async () => {
  await waitReady();
  const boss = sess(); const cos = sess();
  const bossEmail = `boss${ID}@x.com`;
  const cosEmail = `cos${ID}@x.com`;

  await boss('POST', '/auth/signup', { name: 'Ada Boss', email: bossEmail, password: 'password123', timezone: 'UTC', accountCategory: 'principal' });
  const bossId = (await boss('GET', '/auth/me')).d.user.id;
  // Signs up describing themselves as a Chief of Staff.
  await cos('POST', '/auth/signup', { name: 'Kit Staff', email: cosEmail, password: 'password123', timezone: 'UTC', accountCategory: 'chief_of_staff' });
  const cosId = (await cos('GET', '/auth/me')).d.user.id;

  console.log('Roles carried through appointment:');
  let r = await boss('GET', '/members/roles');
  ok('role list is served from the server', r.s === 200 && r.d.roles.length === 4);
  ok('Chief of Staff is offerable', r.d.roles.some((x) => x.id === 'chief_of_staff'));

  // No role given — should infer from how they described themselves at signup.
  r = await boss('POST', '/members', { email: cosEmail });
  ok('invite defaults to the title they chose at signup', r.d.member.role === 'chief_of_staff', r.d.member.role);
  ok('and displays it properly', r.d.member.roleLabel === 'Chief of Staff', r.d.member.roleLabel);
  const inviteToken = r.d.inviteLink.split('/').pop();
  const memberId = r.d.member.id;

  ok('accepting the invite works', (await cos('POST', `/invites/${inviteToken}/accept`)).s === 200);

  console.log('\nSeparate dashboards:');
  r = await cos('GET', '/workspace');
  ok('assistant has their own workspace', r.s === 200);
  ok('spanning their principals without choosing one first', r.d.principals.length === 1 && r.d.principals[0].id === bossId);
  ok('carrying the right title', r.d.principals[0].roleLabel === 'Chief of Staff');
  ok('principal has no workspace of assistants', (await boss('GET', '/workspace')).d.principals.length === 0);

  console.log('\nA draft stays off the principal dashboard:');
  r = await cos('POST', `/itinerary/${bossId}/items`, {
    kind: 'flight', title: 'BA083 to JFK', startAt: soon(30), endAt: soon(38),
  });
  ok('assistant creates an item', r.s === 201, JSON.stringify(r.d));
  ok('and it starts as a draft', r.d.item.status === 'draft', r.d.item.status);
  const draftId = r.d.item.id;
  const dayKey = new Date(soon(30)).toISOString().slice(0, 10);

  r = await boss('GET', `/itinerary/${bossId}/day?date=${dayKey}`);
  ok('principal does NOT see the draft', !r.d.entries.some((e) => e.id === draftId));
  r = await cos('GET', `/itinerary/${bossId}/day?date=${dayKey}`);
  ok('assistant DOES see their own draft', r.d.entries.some((e) => e.id === draftId));
  ok('principal cannot even address it directly',
    (await boss('PATCH', `/itinerary/${bossId}/items/${draftId}`, { title: 'x' })).s === 404);

  r = await cos('GET', `/itinerary/${bossId}/pipeline`);
  ok('it shows in the assistant pipeline', r.d.drafts.some((i) => i.id === draftId));

  console.log('\nPushing a finalized itinerary through:');
  r = await cos('POST', `/itinerary/${bossId}/items/${draftId}/publish`);
  ok('assistant publishes it', r.s === 200 && r.d.item.status === 'confirmed', JSON.stringify(r.d));
  r = await boss('GET', `/itinerary/${bossId}/day?date=${dayKey}`);
  ok('now it IS on the principal dashboard', r.d.entries.some((e) => e.id === draftId));

  console.log('\nRequesting approval instead:');
  r = await cos('POST', `/itinerary/${bossId}/items`, {
    kind: 'meeting', title: 'Dinner with the board', startAt: soon(50),
  });
  const proposeId = r.d.item.id;
  r = await cos('POST', `/itinerary/${bossId}/items/${proposeId}/propose`, { note: 'Needs your call — clashes with the flight home.' });
  ok('assistant sends it for approval', r.s === 200 && r.d.item.status === 'proposed', JSON.stringify(r.d));

  r = await boss('GET', `/today/${bossId}`);
  const req = r.d.needsYou.itineraryRequests.find((i) => i.id === proposeId);
  ok('principal sees the request in what needs them', !!req);
  ok('with the reason attached', req?.proposalNote?.includes('clashes'));
  ok('and the requester named', req?.requestedBy === 'Kit Staff', req?.requestedBy);

  ok('assistant cannot approve their own request',
    (await cos('POST', `/itinerary/${bossId}/items/${proposeId}/decide`, { approve: true })).s === 403);

  r = await cos('GET', '/workspace');
  ok('assistant sees it as awaiting a decision', r.d.awaitingDecision.some((i) => i.id === proposeId));

  console.log('\nThe principal decides:');
  r = await boss('POST', `/itinerary/${bossId}/items/${proposeId}/decide`, { approve: false, note: 'Move it to Thursday.' });
  ok('principal declines with a reason', r.s === 200 && r.d.item.status === 'draft', JSON.stringify(r.d));
  r = await cos('GET', '/workspace');
  const back = r.d.recentlyDecided.find((i) => i.id === proposeId);
  ok('it returns to the assistant, not deleted', !!back);
  ok('carrying the principal reason', back?.decisionNote === 'Move it to Thursday.');
  ok('marked as not approved', back?.approved === false);

  r = await cos('POST', `/itinerary/${bossId}/items/${proposeId}/propose`, { note: 'Moved to Thursday.' });
  ok('assistant can re-propose', r.s === 200 && r.d.item.status === 'proposed');
  r = await boss('POST', `/itinerary/${bossId}/items/${proposeId}/decide`, { approve: true });
  ok('principal approves', r.s === 200 && r.d.item.status === 'confirmed');

  console.log('\nA principal entering their own plan:');
  r = await boss('POST', `/itinerary/${bossId}/items`, { kind: 'personal', title: 'Gym', startAt: soon(20) });
  ok('is live immediately, no drafting', r.d.item.status === 'confirmed', r.d.item.status);

  console.log('\nChanging a title, and revoking:');
  r = await boss('PATCH', `/members/${memberId}`, { role: 'ea' });
  ok('principal can change the title', r.s === 200 && r.d.member.roleLabel === 'EA');
  ok('revoke is the principal\'s', (await boss('POST', `/members/${memberId}/revoke`)).s === 204);
  ok('assistant loses access at once', (await cos('GET', `/itinerary/${bossId}/day`)).s === 403);
  ok('and the principal is gone from their workspace', (await cos('GET', '/workspace')).d.principals.length === 0);
  ok('an assistant cannot revoke anyone', (await cos('POST', `/members/${memberId}/revoke`)).s === 404);

  console.log('\nDeleting an account:');
  r = await cos('GET', '/profile/account-summary');
  ok('assistant is shown what they would lose', r.s === 200 && typeof r.d.summary.bookings === 'number');
  ok('wrong password is refused', (await cos('DELETE', '/profile/account', { password: 'nope' })).s === 401);
  ok('no password is refused', (await cos('DELETE', '/profile/account', {})).s === 400);
  ok('correct password deletes it', (await cos('DELETE', '/profile/account', { password: 'password123' })).s === 204);
  ok('the session is dead', (await cos('GET', '/auth/me')).s === 401);
  const relog = sess();
  ok('and the account is really gone',
    (await relog('POST', '/auth/login', { email: cosEmail, password: 'password123' })).s === 401);

  r = await boss('GET', `/itinerary/${bossId}/day?date=${dayKey}`);
  ok('principal survives their assistant leaving', r.s === 200);

  console.log('\nPrincipal deletes their own account:');
  ok('summary counts their data', (await boss('GET', '/profile/account-summary')).d.summary.itineraryItems >= 1);
  ok('deletion succeeds', (await boss('DELETE', '/profile/account', { password: 'password123' })).s === 204);
  const relog2 = sess();
  ok('account gone', (await relog2('POST', '/auth/login', { email: bossEmail, password: 'password123' })).s === 401);

  console.log(fails === 0 ? '\nDelegation flow is correct.' : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})();
