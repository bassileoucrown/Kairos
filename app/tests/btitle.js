// A person may correct what they are called. They may not widen what they can
// do by describing themselves differently.
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
const PORT = Number(process.env.PORT || 4565);
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
  const deadline = Date.now() + 30000;
  for (;;) {
    try { if ((await (await fetch(`${BASE}/status`)).json()).databaseReady) return; }
    catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('the server never became ready');
    await new Promise((r) => setTimeout(r, 200));
  }
}
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
    let d = null; try { d = await r.json(); } catch {}
    return { s: r.status, d };
  };
}
const ID = Date.now().toString(36);

(async () => {
  await waitReady();
  const boss = sess();
  await boss('POST', '/auth/signup', { name: 'Ada', email: `b${ID}@x.com`, password: 'password123' });
  await boss('POST', '/profile/onboarding-step', { step: 'done' });

  console.log('Invited before they had an account, then signs up as Chief of Staff:');
  let r = await boss('POST', '/members', { email: `c${ID}@x.com` });
  ok('invitation defaults to PA, having nothing to read', r.d.member.role === 'pa', r.d.member.role);
  const cosToken = r.d.inviteLink.split('/').pop();

  const cos = sess();
  await cos('POST', '/auth/signup', { name: 'Kit', email: `c${ID}@x.com`, password: 'password123', accountCategory: 'chief_of_staff' });
  r = await cos('GET', `/invites/${cosToken}`);
  ok('the pending invite already reads Chief of Staff', r.d.invite.roleLabel === 'Chief of Staff', r.d.invite.roleLabel);
  await cos('POST', `/invites/${cosToken}/accept`);
  r = await boss('GET', '/members');
  ok('and the membership settles as Chief of Staff',
    r.d.members.find((m) => m.invitedEmail === `c${ID}@x.com`)?.role === 'chief_of_staff');

  console.log('\nA delegate invitation, accepted by someone calling themselves Chief of Staff:');
  r = await boss('POST', '/members', { email: `d${ID}@x.com`, role: 'delegate' });
  ok('the principal chose delegate', r.d.member.role === 'delegate');
  const delToken = r.d.inviteLink.split('/').pop();

  const del = sess();
  await del('POST', '/auth/signup', { name: 'Dee', email: `d${ID}@x.com`, password: 'password123', accountCategory: 'chief_of_staff' });
  r = await del('GET', `/invites/${delToken}`);
  ok('signing up did NOT widen the pending invite', r.d.invite.role === 'delegate', r.d.invite.role);
  await del('POST', `/invites/${delToken}/accept`);
  r = await boss('GET', '/members');
  const settled = r.d.members.find((m) => m.invitedEmail === `d${ID}@x.com`);
  ok('and accepting did NOT widen it either', settled?.role === 'delegate', settled?.role);
  ok('so the narrower remit stands', settled?.roleLabel === 'Delegate');

  console.log(fails === 0 ? '\nTitles are self-corrected; remit is not.' : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})();
