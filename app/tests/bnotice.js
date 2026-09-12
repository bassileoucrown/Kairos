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
  // Read directly, because with no mail provider configured the emails table
  // is the only record a send leaves — which is what makes "and the assistant
  // was emailed" assertable at all.
  const db = require(`${ROOT}/app/server/lib/db`);
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

    // -----------------------------------------------------------------------
    // Publishing knocks
    // -----------------------------------------------------------------------
    //
    // A notice used to wait on a screen until somebody happened to open Kairos.
    // It now goes out through lib/knock.js like every other knock — an email,
    // and a push to any phone that has granted permission. The emails table is
    // the record either way: with no provider configured it is the only record,
    // which is exactly what makes it assertable here.
    head('Publishing tells people rather than waiting to be found:');
    const mailTo = async (email) => Number((await db.prepare(
      "SELECT COUNT(*) AS n FROM emails WHERE to_email = ? AND category = 'notice'",
    ).get(email)).n);

    const paBefore = await mailTo(`ben${ID}@x.com`);
    const bossBefore = await mailTo(ADMIN);
    const sent = await boss('POST', '/announcements', {
      title: 'Kairos is moving to a new address',
      body: 'From Monday the office is on the third floor. Nothing else changes.',
      audience: 'everyone',
      publish: true,
    });
    ok('publishing reports how many it reached', sent.d.reached >= 3, JSON.stringify(sent.d.reached));
    ok('and the assistant was emailed', (await mailTo(`ben${ID}@x.com`)) === paBefore + 1,
      `${paBefore} → ${await mailTo(`ben${ID}@x.com`)}`);
    // THE AUTHOR IS NOT KNOCKED. knock() only skips a person knocking on
    // themselves when an author is passed, and none is here — a notice comes
    // from Kairos, not from whoever typed it — so announce() does the skip.
    ok('and the author was not emailed their own notice',
      (await mailTo(ADMIN)) === bossBefore, `${bossBefore} → ${await mailTo(ADMIN)}`);

    const body = await db.prepare(
      "SELECT subject, body FROM emails WHERE to_email = ? AND category = 'notice' ORDER BY created_at DESC LIMIT 1",
    ).get(`ben${ID}@x.com`);
    ok('the email is titled with the notice', body.subject === 'Kairos is moving to a new address',
      body.subject);
    // The opening words rather than "you have a new notice": that line is the
    // push body too, and it is what lets somebody decide on a lock screen.
    ok('and leads with the notice itself', /third floor/.test(body.body), body.body);
    ok('asking them to read it rather than deal with it',
      /read it/.test(body.body) && !/deal with it/.test(body.body), body.body);

    head('A notice knocks exactly who it is aimed at:');
    const driverBefore = await mailTo(`femi${ID}@x.com`);
    const paBefore2 = await mailTo(`ben${ID}@x.com`);
    await boss('POST', '/announcements', {
      title: 'Parking', body: 'Use the rear gate from Monday.',
      audience: 'household', publish: true,
    });
    ok('household staff are emailed', (await mailTo(`femi${ID}@x.com`)) === driverBefore + 1);
    // THE POSITIVE CONTROL FOR THE AIM. Without it, "the driver was emailed"
    // passes just as well for a broadcast that ignores the audience entirely
    // and mails everybody — which is the worst failure this feature has.
    ok('and an assistant is not', (await mailTo(`ben${ID}@x.com`)) === paBefore2,
      `${paBefore2} → ${await mailTo(`ben${ID}@x.com`)}`);
    // AND THE TWO DIRECTIONS AGREE. audiencesFor answers "which feeds am I
    // in", recipientsFor answers "who is in this feed". A notice that knocks
    // somebody who then cannot find it on their screen is worse than one that
    // knocks nobody, and two functions reading one rule is exactly how this
    // codebase has drifted before.
    ok('and everybody knocked can actually see it on their screen',
      (await driver('GET', '/announcements')).d.announcements.some((a) => a.title === 'Parking'));

    head('A broadcast cannot be sent twice by pressing twice:');
    const twicePublished = await boss('POST',
      `/announcements/${sent.d.announcement.id}/publish`);
    ok('a second publish is refused', twicePublished.s === 409, String(twicePublished.s));
    ok('and nobody was emailed again', (await mailTo(`ben${ID}@x.com`)) === paBefore2,
      `${paBefore2} → ${await mailTo(`ben${ID}@x.com`)}`);

    head('And the author can see what went out:');
    const finalList = await boss('GET', '/announcements/drafts');
    const moved = finalList.d.announcements.find((a) => a.title === 'Kairos is moving to a new address');
    ok('the count is recorded on the notice', moved.announcedCount >= 3, String(moved.announcedCount));
    ok('with when it went', !!moved.announcedAt, String(moved.announcedAt));
    // Only ever to the author: how many inboxes a notice reached is an
    // operational fact, not something a reader has any business being told.
    const reader = (await pa('GET', '/announcements')).d.announcements
      .find((a) => a.title === 'Kairos is moving to a new address');
    ok('and a reader is told neither', reader.announcedCount === undefined
      && reader.announcedAt === undefined, JSON.stringify(reader));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }
  console.log(fails === 0 ? '\nThe notices channel is correct.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
