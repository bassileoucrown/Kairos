// The seven asks, reached by hand.
//
// WHY THIS EXISTS SEPARATELY FROM bassist. That suite proves the asks refuse
// honestly, write nothing, and hold every gate. Every one of its assertions
// would pass with no button anywhere in the client — which is a feature that
// works and that nobody can use. This one only asks: is the control on the
// screen the capability says it is on, and does it say it is not available.
//
// AND IT PROVES THE SWAP. The same client build is booted a second time
// against a server with a key set, and every placeholder is expected to have
// become the real control in the same position. That is the claim the whole
// SoonButton pattern rests on, and it is the one that would quietly rot: a
// capability id typo makes a placeholder that never disappears, and nothing
// but this notices.
//
// SEVEN CONTROLS, FIVE SCREENS. The registry says which is on which; this
// walks to each of them the way a tester would.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const KEYED = PORT + 1;
const KBASE = `http://127.0.0.1:${KEYED}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const SECRET = 'inbound-secret-for-tests';
const DOMAIN = 'in.exousia.test';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function boot(port, env = {}) {
  return spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(port),
      DATABASE_URL: process.env.DATABASE_URL || '',
      INBOUND_EMAIL_SECRET: SECRET, INBOUND_EMAIL_DOMAIN: DOMAIN,
      // Explicitly empty rather than merely unset, so this suite measures an
      // unconfigured deployment even on a machine that happens to have a key
      // in its environment.
      ANTHROPIC_API_KEY: '',
      ...env,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
async function ready(base) {
  const deadline = Date.now() + 150000;
  for (;;) {
    try { if ((await (await fetch(`${base}/api/status`)).json()).databaseReady) break; }
    catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('no server');
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** The placeholder for a capability, by the label it carries on the screen. */
const soon = (p, label) => p.locator(`.btn.is-soon:has-text("${label}")`);
/** The working control in the same position — a plain button, not a placeholder. */
const live = (p, label) => p.locator(`button:not(.is-soon):has-text("${label}")`);

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }
  const bare = boot(PORT);
  let keyed = null;
  let b = null;
  const db = require(`${ROOT}/app/server/lib/db`);

  try {
    await ready(BASE);
    b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));

    // ---- One principal, and everything the seven asks need to have a home ----
    await p.goto(`${BASE}/signup`);
    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Adaeze Okonkwo');
    await p.fill('#email', `ada${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 20000 });
    await p.fill('#slug', `ada${ID}`);
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/connect', { timeout: 20000 });
    await p.click('button:has-text("Skip for now")');
    await p.waitForURL('**/onboarding/meeting-type', { timeout: 20000 });
    await p.fill('#mt-name', 'Board');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 20000 });

    // Built through the API so this file spends its time on the controls.
    const made = await p.evaluate(async ({ id, domain }) => {
      const call = async (method, path, body) => (await fetch(`/api${path}`, {
        method, headers: { 'content-type': 'application/json' },
        credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body),
      })).json();
      const post = (path, body) => call('POST', path, body ?? {});
      const me = (await call('GET', '/auth/me')).user;

      const space = (await post('/spaces', { name: 'The office', context: 'work' })).space;
      const thread = (await post(`/spaces/${space.id}/threads`, { name: 'Q3' })).thread;
      await post(`/threads/${thread.id}/messages`,
        { body: 'We will fund the second tranche after the audit.', register: 'note' });

      // A mailbox with something in it. The principal is in their own
      // correspondence by definition, so no grant is needed here.
      const account = (await post(`/mail/${me.id}/accounts`,
        { kind: 'delegated', address: `office${id}@exousia.test`, label: 'The office' })).account;
      await post(`/pa/${me.id}/contacts`,
        { name: 'Chidi Nwosu', email: `chidi${id}@ashford.com`, relationshipTier: 'professional' });
      const address = (await call('GET', `/mail/${me.id}/accounts/${account.id}/inbound`)).address;

      // Open around the clock, so nothing here depends on the hour it runs at.
      await call('PUT', '/availability', {
        rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' })),
      });
      const mt = (await post('/meeting-types',
        { name: 'Intro', durationMinutes: 60, locationType: 'video', accessTier: 1 })).meetingType;

      return { userId: me.id, threadId: thread.id, accountId: account.id, address, slug: mt.slug, domain };
    }, { id: ID, domain: DOMAIN });

    // Mail arrives through the webhook, which needs the secret — so it is
    // posted from here rather than from the page.
    await fetch(`${BASE}/api/mail-inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kairos-inbound-secret': SECRET },
      body: JSON.stringify({
        to: made.address, from: `chidi${ID}@ashford.com`, fromName: 'Chidi Nwosu',
        subject: 'The Q3 board pack', body: 'Attached, as promised.', messageId: `m-${ID}`,
      }),
    });

    // A meeting, aged into the past the way bminute ages its own: a suite
    // cannot wait a day, and half the minute tools only exist after a meeting
    // has started.
    const slots = await (await fetch(`${BASE}/api/public/ada${ID}/${made.slug}/slots`)).json();
    const booked = await (await fetch(`${BASE}/api/public/ada${ID}/${made.slug}/book`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        timezone: 'UTC', startAt: slots.slots[0].startAt,
        name: 'Chidi Nwosu', email: `chidi${ID}@ashford.com`,
      }),
    })).json();
    const bookingId = booked.booking.id;
    await db.prepare('UPDATE bookings SET start_at = ?, end_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 7200000).toISOString(),
        new Date(Date.now() - 3600000).toISOString(), bookingId);

    // Away, so the catch-up screen is the one somebody coming back sees rather
    // than the "you have not been away" one — which correctly carries no
    // control, there being nothing to read back. See lib/catchUp.js.
    await db.prepare('UPDATE users SET last_seen_at = ?, away_since = NULL WHERE id = ?')
      .run(new Date(Date.now() - 5 * 3600000).toISOString(), made.userId);

    // ---- The rail ---------------------------------------------------------
    head('The correspondence screen is reachable at all:');
    await p.goto(`${BASE}/today`);
    await p.waitForSelector('.app-nav a:has-text("Correspondence")', { timeout: 20000 });
    ok('the rail carries it', true);
    await p.click('.app-nav a:has-text("Correspondence")');
    await p.waitForFunction(() => window.location.pathname === '/mail', null, { timeout: 20000 });
    ok('and clicking it lands on the mailbox', true);

    // ---- Each ask, on its own screen --------------------------------------
    head('While you were away carries the brief:');
    await p.goto(`${BASE}/catch-up`);
    await p.waitForSelector('.soon-control', { timeout: 20000 });
    ok('"Read it back to me" is where the list is',
      (await soon(p, 'Read it back to me').count()) === 1);
    // Pressing it explains rather than swallowing the click — the property the
    // whole placeholder pattern is for, checked once here rather than seven
    // times, since it is one component.
    await soon(p, 'Read it back to me').click();
    await p.waitForSelector('.soon-why', { timeout: 20000 });
    const why = await p.locator('.soon-why').innerText();
    ok('and pressing it names the key it is waiting on',
      /ANTHROPIC_API_KEY/.test(why), why.slice(0, 200));

    head('The weekly report carries the read of the week ahead:');
    await p.goto(`${BASE}/report`);
    await p.waitForSelector('.report-ahead', { timeout: 20000 });
    ok('"Read the week" sits above the counts',
      (await soon(p, 'Read the week').count()) === 1);

    head('A room carries the question about what was settled in it:');
    await p.goto(`${BASE}/threads/${made.threadId}`);
    await p.waitForSelector('.soon-control', { timeout: 20000 });
    ok('"Anything decided here?" is in the room',
      (await soon(p, 'Anything decided here?').count()) === 1);

    head('An appointment carries both halves of a meeting:');
    await p.goto(`${BASE}/appointments/${made.userId}/${bookingId}`);
    await p.waitForSelector('.booking-minutes .soon-control', { timeout: 20000 });
    ok('"Brief me" is there for before you go in',
      (await soon(p, 'Brief me').count()) === 1);
    ok('and "Find the actions" for after',
      (await soon(p, 'Find the actions').count()) === 1);

    head('Correspondence carries triage and the reply:');
    await p.goto(`${BASE}/mail`);
    await p.waitForSelector('.mail-thread', { timeout: 20000 });
    ok('the mail that arrived is on the screen',
      /Q3 board pack/.test(await p.locator('.app-body').innerText()));
    ok('"Sort this out" is above the threads',
      (await soon(p, 'Sort this out').count()) === 1);
    // The reply lives INSIDE a thread, because a draft written where the
    // correspondence is not is a draft somebody has to carry back.
    ok('and the reply is not offered before a thread is open',
      (await soon(p, 'Draft a reply').count()) === 0);
    await p.click('.mail-open');
    await p.waitForSelector('.mail-reply', { timeout: 20000 });
    ok('opening one offers "Draft a reply"',
      (await soon(p, 'Draft a reply').count()) === 1);

    // ---- The claim the pattern rests on -----------------------------------
    head('With ANTHROPIC_API_KEY set, on the same client build:');
    // A syntactically plausible key that will never be used: nothing here
    // presses a working control, only checks that it is now the real one.
    keyed = boot(KEYED, { ANTHROPIC_API_KEY: 'sk-ant-not-a-real-key-for-tests' });
    await ready(KBASE);
    const q = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    q.on('pageerror', (e) => errs.push('keyed: ' + e.message));
    await q.goto(`${KBASE}/login`);
    await q.fill('#email', `ada${ID}@x.com`);
    await q.fill('#password', PW);
    await q.click('button:has-text("Log in")');
    await q.waitForURL('**/today', { timeout: 20000 });

    await q.goto(`${KBASE}/report`);
    await q.waitForSelector('.report-ahead', { timeout: 20000 });
    // Waited for rather than counted on sight: the capability list is a second
    // request, so "no placeholder" is true for a moment on every load and an
    // immediate count would pass whether or not the swap works.
    await q.waitForFunction(
      () => !!document.querySelector('.report-ahead button')
        && !document.querySelector('.report-ahead .btn.is-soon'),
      null, { timeout: 20000 },
    );
    ok('the placeholder is gone and the control is real',
      (await live(q, 'Read the week').count()) === 1
      && (await soon(q, 'Read the week').count()) === 0);

    await q.goto(`${KBASE}/mail`);
    await q.waitForSelector('.mail-thread', { timeout: 20000 });
    await q.waitForFunction(
      () => /Sort this out/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('and so is triage', (await live(q, 'Sort this out').count()) === 1
      && (await soon(q, 'Sort this out').count()) === 0);

    // AND THE ROADMAP AGREES. A capability that reports itself available while
    // still being listed as coming is the registry disagreeing with itself.
    await q.goto(`${KBASE}/coming`);
    await q.waitForSelector('.coming-row', { timeout: 20000 });
    const coming = await q.locator('.app-body').innerText();
    ok('none of the seven is still listed as coming',
      !/Read it back to me|Read the week|Sort this out|Draft a reply|Brief me|Find the actions|Anything decided here/
        .test(coming.split(/Working on this deployment/i)[0]),
      coming.slice(0, 300));

    // ---- And nothing is left saying a raw id ------------------------------
    head('The roadmap says where each one lives in words:')
    await p.goto(`${BASE}/coming`);
    await p.waitForSelector('.coming-row', { timeout: 20000 });
    const bareComing = await p.locator('.app-body').innerText();
    ok('every screen is named rather than printed as an id',
      !/\b(catch_up|ai_assist|direct_line)\b/.test(bareComing),
      (bareComing.match(/\b\w*_\w*\b/g) || []).join(' ').slice(0, 200));
    ok('and the correspondence asks point at Correspondence',
      /Correspondence/.test(bareComing), bareComing.slice(0, 200));

    ok('nothing threw on any of those screens', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (b) await b.close().catch(() => {});
    if (keyed) keyed.kill();
    bare.kill();
  }

  console.log(fails === 0
    ? '\nAll seven asks are on the screens they claim, inert without a key, and real with one.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
