// Keeping individual things, rather than whole rooms.
//
// Archiving already existed at the level of a conversation and a project: put
// the room away, keep every word in it. What was missing was the finer move
// the office actually asks for — "before we delete this space, take out the
// three things that mattered".
//
// THE ONE PROPERTY THAT MATTERS, AND THE REASON THIS IS NOT A FLAG. Messages
// hang off threads with ON DELETE CASCADE. An archived_at column on the
// message would therefore be destroyed by exactly the deletion it exists to
// survive — the feature would appear to work in every test that did not delete
// anything, and fail silently the first time it was used for its actual
// purpose. So keeping copies the words out into a store the principal owns,
// and the test below deletes the entire space to prove it.
//
// The rest is the shape of any archive worth having:
//
//   IT MUST WORK ON A ROOM THAT IS ALREADY CLOSED. Every other verb on a
//   message is refused once a thread is archived. Keeping cannot be, because
//   "archive the finished matter, then save what was in it" is the order
//   people do this in.
//
//   IT MUST NOT BE A BACK DOOR. What lands in here arrives stripped of the
//   space membership that used to protect it. A delegate engaged for
//   scheduling could not open the room; they do not get the archive of it.
//
//   A DOCUMENT PUT AWAY MUST GO QUIET. Archiving an expired passport that goes
//   on generating renewal mail teaches an office to ignore renewal mail.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4593, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
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

/** Tomorrow, or any offset from today, as the date string the vault wants. */
function dayString(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ENCRYPTION_KEY: KEY },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  let browser = null;
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('PATCH', '/profile', { slug: `h${ID}-1` });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const pa = client();
    await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('PATCH', '/profile', { slug: `h${ID}-2` });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    let invite = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${invite.d.inviteLink.split('/').pop()}/accept`);

    // A scheduling-only delegate, for the access question further down.
    const driver = client();
    await driver('POST', '/auth/signup',
      { name: 'Tunde Bakare', email: `tunde${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await driver('PATCH', '/profile', { slug: `h${ID}-3` });
    await driver('POST', '/profile/onboarding-step', { step: 'done' });
    invite = await boss('POST', '/members', { email: `tunde${ID}@x.com`, role: 'delegate' });
    await driver('POST', `/invites/${invite.d.inviteLink.split('/').pop()}/accept`);

    // ---- Keeping one line out of a conversation ---------------------------
    head('One message can be taken out of a conversation and kept:');
    const space = await boss('POST', '/spaces', { name: `Lagos lease ${ID}`, context: 'work' });
    const spaceId = space.d.space.id;
    let r = await boss('POST', `/spaces/${spaceId}/threads`, { name: 'Lease terms' });
    const threadId = r.d.thread.id;

    await boss('POST', `/threads/${threadId}/messages`, { body: 'Morning all' });
    r = await boss('POST', `/threads/${threadId}/messages`,
      { body: 'Account for the deposit is 0123456789, Zenith, ref LAGOS-LEASE' });
    const keeper = r.d.id;
    await boss('POST', `/threads/${threadId}/messages`, { body: 'Thanks' });

    r = await boss('POST', `/threads/${threadId}/messages/${keeper}/keep`, {});
    ok('a line can be kept', r.s === 200 && r.d.kept === true, JSON.stringify(r.d));

    r = await boss('GET', `/archive/${bossId}`);
    ok('and it turns up in the archive', r.d.kept?.length === 1, JSON.stringify(r.d).slice(0, 200));
    const item = r.d.kept[0];
    ok('with the words themselves', /0123456789/.test(item.body), item.body);
    // A saved fragment with no answer to "who said this, and where" is a note
    // to nobody — and by the time anyone reads it the room may be gone.
    ok('and who said it', item.saidByName === 'Adaeze Okonkwo', item.saidByName);
    ok('and which room it came from', item.threadName === 'Lease terms', item.threadName);
    ok('and which space that was', /Lagos lease/.test(item.spaceName || ''), item.spaceName);
    ok('and who kept it', item.keptByName === 'Adaeze Okonkwo', item.keptByName);

    // The message itself says so, so the screen can offer Keep once.
    let msgs = await boss('GET', `/threads/${threadId}/messages`);
    ok('the message knows it has been kept',
      msgs.d.messages.find((m) => m.id === keeper)?.kept === true);
    ok('and the ones around it know they have not',
      msgs.d.messages.filter((m) => m.kept).length === 1,
      JSON.stringify(msgs.d.messages.map((m) => [m.body?.slice(0, 12), m.kept])));

    // Pressing Keep twice — a double tap, two assistants tidying the same room
    // — must not quietly produce two entries. An archive with duplicates in it
    // is one nobody trusts to be a full list.
    await boss('POST', `/threads/${threadId}/messages/${keeper}/keep`, {});
    r = await boss('GET', `/archive/${bossId}`);
    ok('keeping it twice keeps it once', r.d.kept.length === 1, String(r.d.kept.length));

    // ---- The property the whole design exists for -------------------------
    head('What is kept survives the conversation being deleted:');
    // Deleting a space needs the name typed, on the server, not just the
    // screen. Checked here so that the delete below is known to be a real one.
    r = await boss('DELETE', `/spaces/${spaceId}`, {});
    ok('a space will not be deleted without the name typed', r.s === 400,
      `${r.s} ${JSON.stringify(r.d)}`);

    const gone = await boss('DELETE', `/spaces/${spaceId}`, { confirmName: `Lagos lease ${ID}` });
    ok('and with the name typed it goes', gone.s === 200 || gone.s === 204,
      `${gone.s} ${JSON.stringify(gone.d)}`);
    ok('the conversation really is gone',
      (await boss('GET', `/threads/${threadId}/messages`)).s === 404);

    // THE ASSERTION THIS WHOLE FILE IS FOR. A flag on the message would have
    // been cascaded away by the delete above and this would read zero.
    r = await boss('GET', `/archive/${bossId}`);
    ok('but the kept line is still in the archive', r.d.kept?.length === 1,
      JSON.stringify(r.d.kept));
    ok('and still says where it came from',
      r.d.kept?.[0]?.threadName === 'Lease terms', r.d.kept?.[0]?.threadName);
    // Offering a link into a deleted room is the one dead end an archive must
    // not have, so it has to know the room is gone.
    ok('and knows the room is no longer there to open',
      r.d.kept?.[0]?.sourceLive === false, String(r.d.kept?.[0]?.sourceLive));

    // ---- Keeping still works once the room is closed ----------------------
    head('A closed room can still have things taken out of it:');
    const shut = await boss('POST', '/spaces', { name: `Old matter ${ID}`, context: 'work' });
    r = await boss('POST', `/spaces/${shut.d.space.id}/threads`, { name: 'Wound up' });
    const shutThread = r.d.thread.id;
    r = await boss('POST', `/threads/${shutThread}/messages`, { body: 'The policy number is AXA-99127' });
    const shutMsg = r.d.id;
    await boss('POST', `/threads/${shutThread}/archive`, {});

    r = await boss('POST', `/threads/${shutThread}/messages`, { body: 'Anything else?' });
    ok('an archived room takes no new messages', r.s === 409, `${r.s} ${JSON.stringify(r.d)}`);
    // The point: the moment you most want to save something is the moment the
    // room is on its way out.
    r = await boss('POST', `/threads/${shutThread}/messages/${shutMsg}/keep`, {});
    ok('but a line in it can still be kept', r.s === 200, `${r.s} ${JSON.stringify(r.d)}`);

    r = await boss('DELETE', `/threads/${shutThread}/messages/${shutMsg}/keep`);
    ok('and un-kept again', r.s === 200, `${r.s} ${JSON.stringify(r.d)}`);
    ok('which takes it out of the archive',
      (await boss('GET', `/archive/${bossId}`)).d.kept.length === 1);
    await boss('POST', `/threads/${shutThread}/messages/${shutMsg}/keep`, {});

    // ---- Who may read an archive ------------------------------------------
    head('An archive is not a back door into rooms somebody cannot open:');
    r = await pa('GET', `/archive/${bossId}`);
    ok('a full assistant reads it', r.s === 200 && r.d.canRead === true, JSON.stringify(r.d).slice(0, 140));
    ok('and sees what is in it', r.d.kept.length === 2, String(r.d.kept?.length));

    r = await driver('GET', `/archive/${bossId}`);
    // Same answer a passport gets: nothing here for you, rather than something
    // being withheld from you.
    ok('a scheduling-only delegate does not', r.d.canRead === false, JSON.stringify(r.d).slice(0, 140));
    ok('and is shown nothing at all', (r.d.kept || []).length === 0, JSON.stringify(r.d.kept));
    r = await driver('DELETE', `/archive/${bossId}/${item.id}`);
    ok('and cannot remove from it either', r.s === 404, `${r.s} ${JSON.stringify(r.d)}`);

    const stranger = client();
    await stranger('POST', '/auth/signup',
      { name: 'Nobody', email: `no${ID}@x.com`, password: PW, accountCategory: 'principal' });
    r = await stranger('GET', `/archive/${bossId}`);
    ok('and somebody outside the office is refused outright', r.s === 403, String(r.s));

    // ---- A note on why it was kept ----------------------------------------
    head('A kept thing can say why it was kept:');
    const keptId = (await boss('GET', `/archive/${bossId}`)).d.kept
      .find((k) => /AXA-99127/.test(k.body))?.id;
    r = await boss('PATCH', `/archive/${bossId}/${keptId}`, { note: 'Needed for the 2027 renewal' });
    ok('a note can be added', r.s === 200, `${r.s} ${JSON.stringify(r.d)}`);
    ok('and it sticks',
      (await boss('GET', `/archive/${bossId}`)).d.kept
        .find((k) => k.id === keptId)?.note === 'Needed for the 2027 renewal');

    r = await boss('DELETE', `/archive/${bossId}/${keptId}`);
    ok('and it can be taken out for good', r.s === 204, String(r.s));
    ok('leaving the rest alone',
      (await boss('GET', `/archive/${bossId}`)).d.kept.length === 1);

    // ---- Documents put away ------------------------------------------------
    head('A document can be put away without being deleted:');
    let e = await boss('POST', `/essentials/${bossId}`, {
      category: 'travel_identity', field: 'passport_number',
      value: 'A00112233', expiresOn: dayString(10),
    });
    const oldPassport = e.d.essential.id;
    e = await boss('POST', `/essentials/${bossId}`, {
      category: 'travel_identity', field: 'passport_number',
      value: 'B99887766', expiresOn: dayString(3000),
    });
    const newPassport = e.d.essential.id;

    r = await boss('GET', `/essentials/${bossId}`);
    ok('both passports are in the vault to begin with',
      r.d.essentials.filter((x) => x.field === 'passport_number').length === 2);

    // The positive control, taken BEFORE archiving. Without it the assertion
    // below passes whether or not the guard exists — which is exactly what it
    // did on the first draft: it read a key that was nested one level deeper,
    // got undefined, and cheerfully reported that the passport had left a list
    // it had never been able to see.
    r = await boss('GET', `/today/${bossId}`);
    const flaggedBefore = (r.d.needsYou?.expiring || []).map((x) => x.id);
    ok('while live and about to lapse, it is on the "about to lapse" list',
      flaggedBefore.includes(oldPassport), JSON.stringify(r.d.needsYou?.expiring));

    r = await boss('POST', `/essentials/${bossId}/${oldPassport}/archive`, {});
    ok('the old one can be put away', r.s === 200 && !!r.d.archivedAt, JSON.stringify(r.d));

    r = await boss('GET', `/essentials/${bossId}`);
    // Two passport numbers side by side, one of them dead, is how the wrong
    // one gets read out at a check-in desk.
    ok('and the live vault now shows one passport',
      r.d.essentials.filter((x) => x.field === 'passport_number').length === 1);
    ok('which is the current one',
      r.d.essentials.find((x) => x.field === 'passport_number')?.id === newPassport);
    ok('and the vault says how many are put away', r.d.archivedCount === 1,
      String(r.d.archivedCount));

    r = await boss('GET', `/essentials/${bossId}/archived`);
    ok('the archived one is readable', r.d.essentials.length === 1, JSON.stringify(r.d).slice(0, 160));
    // Archiving a passport does not make its number less of a passport number.
    ok('and still masked, exactly as it was live', r.d.essentials[0].masked === true,
      JSON.stringify(r.d.essentials[0]));
    ok('and says when it was put away', !!r.d.essentials[0].archivedAt);

    // An office that learns to ignore expiry mail is an office that misses the
    // one that mattered.
    r = await boss('GET', `/today/${bossId}`);
    const flagged = (r.d.needsYou?.expiring || []).map((x) => x.id);
    ok('and putting it away takes it off that list', !flagged.includes(oldPassport),
      JSON.stringify(flagged));

    r = await driver('GET', `/essentials/${bossId}/archived`);
    ok('and a scheduling-only delegate sees no archived passport',
      (r.d.essentials || []).length === 0, JSON.stringify(r.d.essentials));

    r = await boss('DELETE', `/essentials/${bossId}/${oldPassport}/archive`);
    ok('it can be brought back out', r.s === 200 && r.d.archivedAt === null, JSON.stringify(r.d));
    ok('and the vault has both again',
      (await boss('GET', `/essentials/${bossId}`)).d.essentials
        .filter((x) => x.field === 'passport_number').length === 2);
    await boss('POST', `/essentials/${bossId}/${oldPassport}/archive`, {});

    // ---- The screens -------------------------------------------------------
    head('And all of it is reachable without knowing an API exists:');
    const live = await boss('POST', '/spaces', { name: `Board ${ID}`, context: 'work' });
    r = await boss('POST', `/spaces/${live.d.space.id}/threads`, { name: 'Board pack' });
    const liveThread = r.d.thread.id;
    r = await boss('POST', `/threads/${liveThread}/messages`,
      { body: 'The chairman prefers the 8am slot' });
    const liveMsg = r.d.id;

    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `ada${ID}@x.com`, password: PW }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const [ck, cv] = cookie.split('=');
    await ctx.addCookies([{ name: ck, value: cv, domain: '127.0.0.1', path: '/' }]);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    await page.goto(`${BASE}/threads/${liveThread}`);
    await page.waitForSelector('.msg-note', { timeout: 20000 });
    // The verbs belong to the message you picked, so it has to be picked.
    await page.click(`#m-${liveMsg}`);
    await page.waitForSelector('.msg-actions-row', { timeout: 20000 });
    ok('a message offers Keep once you pick it',
      (await page.locator('.msg-actions-row button:has-text("Keep")').count()) === 1);

    await page.click('.msg-actions-row button:has-text("Keep")');
    await page.waitForFunction(
      (id) => !!document.querySelector(`#m-${id} .msg-promote.is-kept`),
      liveMsg, { timeout: 20000 },
    );
    ok('pressing it says so on the message', true);
    ok('and the server agrees',
      (await boss('GET', `/archive/${bossId}`)).d.kept.some((k) => /chairman/.test(k.body)));

    await page.goto(`${BASE}/archive`);
    await page.waitForSelector('.kept-card', { timeout: 20000 });
    const archiveText = await page.locator('body').innerText();
    ok('the archive screen shows what was kept', /chairman prefers the 8am/.test(archiveText),
      archiveText.slice(0, 300));
    ok('and where it came from', /Board pack/.test(archiveText), archiveText.slice(0, 300));
    // Two different mechanisms underneath; one archive from where the reader
    // is standing.
    ok('and the documents put away, under the same heading',
      /Documents put away/.test(archiveText) && /Passport number/i.test(archiveText),
      archiveText.slice(0, 600));
    ok('with a way to put a document back',
      (await page.locator('button:has-text("Put back in the vault")').count()) === 1);
    // The room this one came from is still live, so the way back is offered.
    ok('and a way back to a conversation that still exists',
      (await page.locator('a:has-text("Open the conversation")').count()) === 1);
    ok('but not for the one whose room was deleted',
      (await page.locator('.kept-card').count())
        > (await page.locator('a:has-text("Open the conversation")').count()));

    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    proc.kill();
  }

  console.log(fails === 0
    ? '\nWhat mattered can be taken out and kept, and it outlives the room it was said in.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
