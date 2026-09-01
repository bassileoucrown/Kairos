// One assistant, several principals, one list.
//
// WHAT THIS FILE IS ABOUT. Everything else in Kairos is shaped around a
// principal: one person, one day, one queue, and a switcher for an assistant
// who has more than one. That shape makes the assistant's own question
// unanswerable without work — "is anything waiting on me?" needed a switch per
// principal, and switching re-scopes every screen, so the act of checking moved
// them away from whatever they were doing.
//
// /attention/across answers it in one call. The interesting assertions are not
// that the numbers are right; they are about WHOSE numbers appear. An assistant
// who has been revoked is not an assistant with a shorter list — they are a
// stranger, and a stranger sees nothing. That is the assertion worth sabotaging,
// and it is sabotaged below.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const fs = require('fs');
const DATA = `${ROOT}/app/server/data`;
for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
  if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
}

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}/api`;
const PW = 'password123';
const ID = Date.now().toString(36);
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (t) => console.log(`\n${t}`);

const server = spawn('node', ['--experimental-sqlite', 'index.js'], {
  cwd: `${ROOT}/app/server`,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: process.env.DATABASE_URL || '' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let boot = '';
server.stderr.on('data', (d) => { boot = (boot + d).slice(-4000); });
let died = null;
server.on('exit', (code, signal) => { died = signal ? `signal ${signal}` : `exit ${code}`; });
process.on('exit', () => server.kill());

function sess() {
  let c = '';
  return async (m, p, b) => {
    const r = await fetch(BASE + p, {
      method: m,
      headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) c = sc.split(';')[0];
    let d = null;
    try { d = await r.json(); } catch { /* 204 */ }
    return { s: r.status, d };
  };
}

async function waitReady() {
  const deadline = Date.now() + 150000;
  for (;;) {
    try { if ((await (await fetch(`${BASE}/status`)).json()).databaseReady) return; }
    catch { /* not up yet */ }
    if (died) throw new Error(`the server never became ready — server ${died}\n${boot.trim()}`);
    if (Date.now() > deadline) throw new Error(`the server never became ready\n${boot.trim()}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** A principal with a bookable type, and a pending request sitting on it. */
async function principalWithPending(name, slug, pending) {
  const p = sess();
  await p('POST', '/auth/signup', { name, email: `${slug}@x.com`, password: PW, timezone: 'UTC', accountCategory: 'principal' });
  const id = (await p('GET', '/auth/me')).d.user.id;
  await p('PATCH', '/profile', { slug });
  await p('PUT', '/availability', {
    rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
  });
  // Tier 3 needs approving, which is exactly what puts a booking in the queue.
  const mt = (await p('POST', '/meeting-types', {
    name: 'Intro', durationMinutes: 30, locationType: 'video', accessTier: 3,
  })).d.meetingType;
  for (let i = 0; i < pending; i++) {
    const slots = (await (await fetch(`${BASE}/public/${slug}/${mt.slug}/slots`)).json()).slots || [];
    const s = slots[i];
    if (!s) break;
    await fetch(`${BASE}/public/${slug}/${mt.slug}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Caller ${i}`, email: `caller${i}.${slug}@x.com`, timezone: 'UTC', startAt: s.startAt,
      }),
    });
  }
  return { p, id, slug };
}

(async () => {
  await waitReady();
  try {
    // --- The cast ---------------------------------------------------------
    const one = await principalWithPending('Adaeze Okonkwo', `ada-${ID}`, 2);
    const two = await principalWithPending('Bola Ade', `bola-${ID}`, 1);
    const three = await principalWithPending('Chidi Eze', `chidi-${ID}`, 3);

    const pa = sess();
    await pa('POST', '/auth/signup', { name: 'Kit Staff', email: `kit${ID}@x.com`, password: PW, timezone: 'UTC', accountCategory: 'pa' });
    await pa('PATCH', '/profile', { slug: `kit-${ID}` });
    // The shell does not render until onboarding is finished, and the browser
    // check below needs the shell.
    await pa('POST', '/profile/onboarding-step', { step: 'done' });

    for (const who of [one, two]) {
      const inv = await who.p('POST', '/members', { email: `kit${ID}@x.com` });
      const token = inv.d.inviteLink.split('/').pop();
      await pa('POST', `/invites/${token}/accept`);
      who.memberId = inv.d.member.id;
    }

    // --- The question an assistant actually opens the app to ask ----------
    head('One call answers whose day needs you first:');
    let r = await pa('GET', '/attention/across');
    ok('the list comes back', r.s === 200, String(r.s));
    const by = Object.fromEntries((r.d.principals || []).map((p) => [p.slug, p]));
    ok('both principals they support are on it', !!by[one.slug] && !!by[two.slug],
      JSON.stringify((r.d.principals || []).map((p) => p.slug)));
    ok('and so are they, because their own queue is theirs too',
      (r.d.principals || []).some((p) => p.role === 'owner'));
    ok('each principal carries their own count, not a shared one',
      by[one.slug]?.approvals === 2 && by[two.slug]?.approvals === 1,
      `${by[one.slug]?.approvals} and ${by[two.slug]?.approvals}`);
    ok('the total is the sum of them', r.d.total === 3, String(r.d.total));
    ok('and it says how many principals are supported rather than counted',
      r.d.supporting === 2, String(r.d.supporting));
    ok('each row names the principal, so the list can be read',
      by[one.slug]?.name === 'Adaeze Okonkwo', by[one.slug]?.name);
    ok('and carries their timezone, since their day is read in it',
      by[one.slug]?.timezone === 'UTC', by[one.slug]?.timezone);

    // --- Whose queues, and whose not --------------------------------------
    // The third principal has an assistant of their own — SOMEBODY ELSE'S.
    // Without that they have no membership row at all, and "they are absent"
    // would pass for the wrong reason: there would be nothing in the table to
    // leak. Sabotaging the member filter proved exactly that, so the fixture
    // now puts a row there to leak.
    const other = sess();
    await other('POST', '/auth/signup', { name: 'Not Our Assistant', email: `other${ID}@x.com`, password: PW, timezone: 'UTC', accountCategory: 'pa' });
    const otherInv = await three.p('POST', '/members', { email: `other${ID}@x.com` });
    await other('POST', `/invites/${otherInv.d.inviteLink.split('/').pop()}/accept`);

    head('A principal who appointed somebody else is not on your list:');
    r = await pa('GET', '/attention/across');
    const seen = Object.fromEntries((r.d.principals || []).map((p) => [p.slug, p]));
    ok('the third principal is absent', !seen[three.slug],
      JSON.stringify(Object.keys(seen)));
    ok('and their three pending requests are not in the total', r.d.total === 3, String(r.d.total));
    const theirs = await other('GET', '/attention/across');
    const theirSlugs = (theirs.d.principals || []).map((p) => p.slug);
    ok('the other assistant sees their own principal', theirSlugs.includes(three.slug),
      JSON.stringify(theirSlugs));
    ok('and not the two who never appointed them',
      !theirSlugs.includes(one.slug) && !theirSlugs.includes(two.slug),
      JSON.stringify(theirSlugs));

    head('Revoked is a stranger, not an assistant with a shorter list:');
    ok('revoking is the principal\'s to do',
      (await one.p('POST', `/members/${one.memberId}/revoke`)).s === 204);
    r = await pa('GET', '/attention/across');
    const after = Object.fromEntries((r.d.principals || []).map((p) => [p.slug, p]));
    ok('the revoked principal drops off entirely', !after[one.slug],
      JSON.stringify(Object.keys(after)));
    ok('their pending requests leave the total with them', r.d.total === 1, String(r.d.total));
    ok('the one still standing is untouched', after[two.slug]?.approvals === 1,
      String(after[two.slug]?.approvals));
    ok('and the supported count follows', r.d.supporting === 1, String(r.d.supporting));

    head('Somebody with nobody to support gets an honest empty answer:');
    const alone = sess();
    await alone('POST', '/auth/signup', { name: 'Solo Person', email: `solo${ID}@x.com`, password: PW, timezone: 'UTC', accountCategory: 'pa' });
    r = await alone('GET', '/attention/across');
    ok('they get exactly themselves', r.s === 200 && r.d.principals.length === 1, JSON.stringify(r.d.principals?.length));
    ok('supporting is nought, which is not the same as one row',
      r.d.supporting === 0, String(r.d.supporting));
    ok('and nothing is waiting', r.d.total === 0, String(r.d.total));

    // --- And an assistant can SEE it, without switching -------------------
    head('The switcher says whose day needs you, without being used:'); {
      const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
      const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${PORT}/login`);
      await page.fill('#email', `kit${ID}@x.com`);
      await page.fill('#password', PW);
      await page.click('button[type="submit"]');
      try {
        await page.waitForSelector('#principal-select', { timeout: 60000 });
      } catch {
        // An account signed up through the API has not been through onboarding,
        // and the shell — switcher included — does not render until it has. The
        // bare selector timeout said none of that, so it is said here.
        throw new Error('the switcher never rendered — the page is at '
          + page.url() + ' showing "'
          + (await page.locator('body').innerText()).slice(0, 120).replace(/\n/g, ' ') + '"');
      }
      // The count has to survive into the label, since an option cannot carry
      // a badge. Read the options rather than the endpoint: the endpoint is
      // already proved above, and what is unproved is that it reaches a screen.
      await page.waitForFunction(
        () => /waiting/i.test(document.querySelector('#principal-select')?.innerText || ''),
        null, { timeout: 60000 },
      );
      const labels = await page.locator('#principal-select option').allInnerTexts();
      ok('a principal with something waiting says so in the switcher',
        labels.some((t) => /Bola Ade — 1 waiting/i.test(t)), JSON.stringify(labels));
      ok('and one with nothing waiting is not decorated with a nought',
        !labels.some((t) => /0 waiting/i.test(t)), JSON.stringify(labels));
      await browser.close();
    }

    head('Signed out, it is not an empty list — it is a refusal:');
    const stranger = await fetch(`${BASE}/attention/across`);
    ok('no session, no list', stranger.status === 401, String(stranger.status));
  } catch (e) {
    fails++;
    console.log('  ✗ threw: ' + (e && e.stack ? e.stack : e));
  }

  server.kill();
  console.log(fails ? `\n${fails} FAILURES` : '\nOne assistant sees every principal that needs them, and only those.');
  process.exit(fails ? 1 : 0);
})();
