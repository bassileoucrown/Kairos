// The notices channel. One direction, aimed, and impossible to write to from
// inside the app unless the environment says you may.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4463);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const ADMIN = `boss${ID}@x.com`;
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
  // Starts from an empty database on purpose. Unique emails keep most suites
  // independent, but a notice is broadcast to everyone — one left behind by an
  // earlier run is delivered to this run's reader, and every unread count here
  // is then off by however many times the suite has been run before.
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  }

  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      ANNOUNCEMENT_AUTHORS: ` ${ADMIN.toUpperCase()} `,
    },
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

    const boss = client(); const pa = client(); const other = client(); const driver = client();
    const bossU = await signUp(boss, 'Ada Boss', ADMIN, 'principal');
    await signUp(pa, 'Ben Reed', `ben${ID}@x.com`, 'pa');
    await signUp(other, 'Zara Cole', `zara${ID}@x.com`, 'principal');
    await signUp(driver, 'Femi Okon', `femi${ID}@x.com`, 'principal');

    const staff = await boss('POST', `/household/${bossU.id}/staff`,
      { name: 'Femi Okon', email: `femi${ID}@x.com`, jobTitle: 'Driver' });
    await driver('POST', `/invites/${staff.d.inviteLink.split('/').pop()}/accept`);

    head('Who may publish:');
    const bossView = await boss('GET', '/announcements');
    ok('the configured author may', bossView.d.canPublish === true, JSON.stringify(bossView.d));
    ok('and the address matched despite case and spaces in the env var', bossView.d.configured === true);
    const paView = await pa('GET', '/announcements');
    ok('an ordinary account may not', paView.d.canPublish === false);
    ok('and is not told that a list of authors exists', paView.d.audiences === undefined);

    const sneak = await pa('POST', '/announcements', { title: 'x', body: 'y' });
    ok('and cannot post', sneak.s === 404, String(sneak.s));
    const sneakDrafts = await pa('GET', '/announcements/drafts');
    ok('nor read drafts', sneakDrafts.s === 404, String(sneakDrafts.s));

    head('Writing:');
    const empty = await boss('POST', '/announcements', { title: '', body: 'x' });
    ok('a notice needs a title', empty.s === 400);

    const draft = await boss('POST', '/announcements',
      { title: 'Maintenance Sunday', body: 'Brief downtime at 02:00.', audience: 'everyone' });
    ok('a draft can be saved without going out', draft.s === 201 && draft.d.announcement.publishedAt === null,
      JSON.stringify(draft.d));
    const unseen = await pa('GET', '/announcements');
    ok('and nobody sees a draft', unseen.d.announcements.length === 0);

    await boss('POST', `/announcements/${draft.d.announcement.id}/publish`);
    const seen = await pa('GET', '/announcements');
    ok('publishing sends it', seen.d.announcements.length === 1, JSON.stringify(seen.d.announcements));
    ok('and it counts as unread', seen.d.unread === 1);

    head('Aimed, not blasted:');
    const forPas = await boss('POST', '/announcements',
      { title: 'For assistants', body: 'A note about handles.', audience: 'assistants', publish: true });
    ok('an assistants-only notice publishes', forPas.s === 201);

    const paSees = await pa('GET', '/announcements');
    ok('the PA gets it', paSees.d.announcements.some((a) => a.title === 'For assistants'));
    const otherSees = await other('GET', '/announcements');
    ok('a principal does not', !otherSees.d.announcements.some((a) => a.title === 'For assistants'),
      JSON.stringify(otherSees.d.announcements.map((a) => a.title)));

    await boss('POST', '/announcements',
      { title: 'For the household', body: 'How to confirm an instruction.', audience: 'household', publish: true });
    const driverSees = await driver('GET', '/announcements');
    ok('household staff get a household notice',
      driverSees.d.announcements.some((a) => a.title === 'For the household'));
    ok('and a PA does not',
      !(await pa('GET', '/announcements')).d.announcements.some((a) => a.title === 'For the household'));

    head('Reading:');
    await pa('POST', `/announcements/${draft.d.announcement.id}/read`);
    const afterRead = await pa('GET', '/announcements');
    ok('marking read lowers the count', afterRead.d.unread === 1, String(afterRead.d.unread));
    const twice = await pa('POST', `/announcements/${draft.d.announcement.id}/read`);
    ok('reading twice is harmless', twice.s === 204, String(twice.s));

    const adminList = await boss('GET', '/announcements/drafts');
    const published = adminList.d.announcements.find((a) => a.title === 'Maintenance Sunday');
    ok('the author can see how many have read it', published.readCount >= 1, String(published.readCount));

    head('Correcting something already sent:');
    await boss('POST', `/announcements/${draft.d.announcement.id}/withdraw`);
    const gone = await pa('GET', '/announcements');
    ok('withdrawing takes it back down',
      !gone.d.announcements.some((a) => a.title === 'Maintenance Sunday'));
    await boss('PATCH', `/announcements/${draft.d.announcement.id}`, { body: 'Brief downtime at 03:00.' });
    await boss('POST', `/announcements/${draft.d.announcement.id}/publish`);
    const back = await pa('GET', '/announcements');
    ok('and it can be corrected and sent again',
      back.d.announcements.some((a) => a.body.includes('03:00')));

    head('There is no way to reply:');
    const reply = await pa('POST', `/announcements/${draft.d.announcement.id}/replies`, { body: 'hello' });
    ok('no reply endpoint exists', reply.s === 404, String(reply.s));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }
  console.log(fails === 0 ? '\nThe notices channel is correct.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
