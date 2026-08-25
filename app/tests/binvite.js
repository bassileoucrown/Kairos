// An invitation somebody can actually find.
//
// THE BUG. An invite existed in exactly one place: an emailed link holding a
// token. If that mail went to spam, or to an address read once a week, or was
// simply skimmed past, the invitation was invisible to everybody. The
// invitee had no idea they had been asked. The principal's Team screen said
// "Invited", which reads as "they are on my team", and the first real sign
// that nothing had happened was a PA who could not be @-mentioned, could not
// be handed a note, and could not see anything — with no screen anywhere
// explaining why.
//
// Worst of all where it should be easiest: when the invitee ALREADY HOLDS a
// Kairos account. They are signed in, one tap from accepting, and the product
// was emailing them and hoping.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (t) => console.log(`\n${t}`);

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
    const t = await r.text();
    let d = null;
    try { d = t ? JSON.parse(t) : null; } catch { d = t; }
    return { s: r.status, d };
  };
}

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL || '',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const deadline = Date.now() + 20000;
  for (;;) {
    try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('no server');
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    const boss = client();
    await boss('POST', '/auth/signup', { name: 'Adaeze Okonkwo', email: `boss${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const me = (await boss('GET', '/auth/me')).d.user;
    await boss('PATCH', '/profile', { slug: `adaeze-${ID}`, timezone: 'UTC' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    // The PA signed themselves up first. This is the case that matters.
    const pa = client();
    await pa('POST', '/auth/signup', { name: 'Kit Staff', email: `pa${ID}@x.com`, password: PW, accountCategory: 'chief_of_staff' });
    const paMe = (await pa('GET', '/auth/me')).d.user;
    await pa('PATCH', '/profile', { slug: `kit-${ID}`, timezone: 'UTC' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });

    head('The principal adds them on the Team screen:');
    let r = await boss('POST', '/members', { email: `pa${ID}@x.com`, role: 'chief_of_staff' });
    ok('they are added', r.s === 201, JSON.stringify(r.d).slice(0, 160));
    const memberId = r.d.member.id;
    // Honest about what has actually happened, which is: an invitation was
    // sent and nothing is connected.
    ok('but nothing is linked yet, and the record says so',
      r.d.member.status === 'invited', r.d.member.status);

    head('THE FIX — the invitee can find it without going to their inbox:');
    r = await pa('GET', '/invites/waiting');
    ok('it is waiting for them in the app', (r.d.invites || []).length === 1,
      JSON.stringify(r.d).slice(0, 200));
    ok('and names who is asking', r.d.invites[0].ownerName === 'Adaeze Okonkwo',
      r.d.invites[0].ownerName);
    ok('and what they are being asked to be',
      r.d.invites[0].roleLabel === 'Chief of Staff', r.d.invites[0].roleLabel);

    // On the screen they actually open, not a page they have to know about.
    r = await pa('GET', `/today/${paMe.id}`);
    const waiting = r.d.needsYou?.invitesWaiting || [];
    ok('and it is on Today, where it cannot be missed',
      waiting.some((i) => i.ownerName === 'Adaeze Okonkwo'), JSON.stringify(waiting));
    ok('counted among the things that need them',
      r.d.needsYou.count >= 1, String(r.d.needsYou.count));

    head('Until they accept, nothing works — and now it says why:');
    r = await boss('GET', `/mentions/${me.id}/lookup?q=`);
    ok('they cannot be addressed', (r.d.people || []).length === 0, JSON.stringify(r.d.people));
    const jot = await boss('POST', '/pad', { body: 'Book the car.' });
    r = await boss('POST', `/pad/${jot.d.item.id}/hand`, { toUserId: paMe.id });
    ok('they cannot be handed anything', r.s === 400, String(r.s));
    // The old message was "You do not share an office with them" — true, and
    // no help at all to somebody who has just added them to their team.
    ok('and the refusal names the real reason',
      /not accepted your invitation/i.test(r.d?.error || ''), r.d?.error);
    ok('and where to go about it', /Team/.test(r.d?.error || ''), r.d?.error);

    head('The principal can chase it rather than starting again:');
    r = await boss('POST', `/members/${memberId}/resend`);
    ok('the invite can be sent again', r.s === 200, JSON.stringify(r.d));
    ok('and hands back the link, for pasting into WhatsApp',
      /^\/accept-invite\//.test(r.d?.inviteLink || ''), r.d?.inviteLink);
    r = await boss('GET', '/emails');
    ok('a reminder actually goes out',
      (r.d.emails || []).some((e) => /^Reminder:/.test(e.subject || '')),
      JSON.stringify((r.d.emails || []).map((e) => e.subject)).slice(0, 200));

    head('And once accepted, everything joins up:');
    r = await pa('GET', '/invites/waiting');
    await pa('POST', `/invites/${r.d.invites[0].token}/accept`, {});
    r = await pa('GET', '/invites/waiting');
    ok('the invite stops waiting', (r.d.invites || []).length === 0, JSON.stringify(r.d.invites));
    r = await pa('GET', `/today/${paMe.id}`);
    ok('and leaves Today', (r.d.needsYou?.invitesWaiting || []).length === 0,
      JSON.stringify(r.d.needsYou?.invitesWaiting));

    r = await boss('GET', `/mentions/${me.id}/lookup?q=`);
    ok('now they can be addressed', (r.d.people || []).some((p) => p.name === 'Kit Staff'),
      JSON.stringify(r.d.people));
    r = await boss('POST', `/pad/${jot.d.item.id}/hand`, { toUserId: paMe.id });
    ok('and handed work', r.s === 200, JSON.stringify(r.d).slice(0, 140));
    r = await boss('GET', '/members');
    ok('and the Team screen says they are active',
      r.d.members.some((m) => m.status === 'active' && m.memberName === 'Kit Staff'),
      JSON.stringify(r.d.members.map((m) => [m.memberName, m.status])));

    head('And the obvious refusals:');
    r = await boss('POST', `/members/${memberId}/resend`);
    ok('resending to somebody who already accepted is refused', r.s === 400, String(r.s));
    ok('and says they are already in', /already accepted/i.test(r.d?.error || ''), r.d?.error);

    // An invite waiting for somebody else is not yours to see or to take.
    const outsider = client();
    await outsider('POST', '/auth/signup', { name: 'Someone Else', email: `else${ID}@x.com`, password: PW });
    r = await boss('POST', '/members', { email: `later${ID}@x.com`, role: 'pa' });
    const otherToken = r.d.inviteLink.split('/').pop();
    r = await outsider('GET', '/invites/waiting');
    ok('an invite addressed to somebody else is not offered to you',
      (r.d.invites || []).length === 0, JSON.stringify(r.d.invites));
    r = await outsider('POST', `/invites/${otherToken}/accept`, {});
    ok('and holding the link is not enough to take it', r.s === 403, String(r.s));
    r = await outsider('POST', `/members/${memberId}/resend`);
    ok('nor can a stranger chase somebody else\'s invite', r.s === 404, String(r.s));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nAn invitation is visible to the person invited, chaseable by the person who sent it, and explains itself until it is accepted.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
