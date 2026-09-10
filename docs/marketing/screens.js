// The real app, screen by screen, on a real phone viewport.
//
// WHY THIS EXISTS. The first month of posts explained Kairos with drawings —
// a phone outline with invented rows in it. A drawing is honest enough as an
// illustration, but it has to be redrawn every time a screen changes, and it
// quietly lets the marketing claim something the product does not do. These
// are photographs of the running app. If a screen is ugly, the post is ugly,
// and that is the correct incentive.
//
// WHAT IT SEEDS. One principal, one assistant paired by access code, one
// driver on the household roster — because the app is not itself with one
// account in it, and a screenshot of an empty Workspace teaches nobody
// anything. The day is anchored around "now" so the NOW band is populated
// whenever this is run.
//
// EVERY SHOT IS CHECKED FOR CONTENT. A screen that failed to load renders as
// a clean empty state and photographs beautifully. So each capture names a
// selector that must be present and a count it must reach, and the run fails
// rather than shipping a picture of nothing. That check is the whole reason
// this file can be trusted: without it "captured 14 screens" is a sentence
// about files existing, not about what is in them.
//
// NOTHING SENSITIVE IS SEEDED. No passport, no document, no vault entry, no
// code, no recovery phrase — the standing instruction for anything outward
// facing while the product is not ready to be asked about those in public.
// The essentials vault is not in this list at all.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright-core'));

const OUT = process.argv[2] || path.join(__dirname, 'shots');
const PORT = Number(process.env.PORT || 4851);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';

// A phone, and a tall one: the posts crop from the top, so extra height costs
// nothing and a short viewport would cut a list off mid-row.
const VW = 390, VH = 1000;

let failed = 0;
const note = (s) => console.log(s);
const bad = (s) => { failed += 1; console.log('  ✗ ' + s); };

// ---------------------------------------------------------------------------
// A tiny API client, cookie-carrying. Seeding through the API rather than the
// UI: the UI is what we are photographing, and driving it forty times to
// arrange a day would make this file about form-filling.
// ---------------------------------------------------------------------------
function api() {
  let cookie = '';
  return async function call(method, p, body) {
    const r = await fetch(`${BASE}/api${p}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let d = null;
    try { d = text ? JSON.parse(text) : null; } catch { d = { raw: text }; }
    if (r.status >= 400) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
    return { s: r.status, d, cookie };
  };
}

// The handle is not optional and the order matters: `/profile/onboarding-step`
// refuses to move on without one ("Choose a handle before going on"), which is
// the app being right — a principal without a handle has no booking address
// and an assistant cannot be pointed at them.
async function signUp(call, name, email, category, slug) {
  const r = await call('POST', '/auth/signup', { name, email, password: PW, accountCategory: category });
  await call('PATCH', '/profile', { slug });
  await call('POST', '/profile/onboarding-step', { step: 'done' });
  return r.d.user;
}

async function ready() {
  const deadline = Date.now() + 150000;
  for (;;) {
    try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) return; }
    catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('server never became ready');
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ---------------------------------------------------------------------------
// The day. Anchored on today at fixed hours so two runs a week apart produce
// the same picture, and so the NOW band always has something in it.
// ---------------------------------------------------------------------------
const now = new Date();
const at = (h, m = 0) => {
  const d = new Date(now); d.setHours(h, m, 0, 0); return d.toISOString();
};
const dayAt = (offset, h, m = 0) => {
  const d = new Date(now); d.setDate(d.getDate() + offset); d.setHours(h, m, 0, 0);
  return d.toISOString();
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const DATA = path.join(ROOT, 'app', 'server', 'data');
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(path.join(DATA, f));
  }

  const srv = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: path.join(ROOT, 'app', 'server'),
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      ENCRYPTION_KEY: '0'.repeat(64),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  let browser = null;
  try {
    await ready();

    // ---- the people -----------------------------------------------------
    const boss = api(), aide = api(), driver = api();
    const HANDLE = `adaeze-okonkwo-${ID}`;
    const bossU = await signUp(boss, 'Adaeze Okonkwo', `ada${ID}@x.com`, 'principal', HANDLE);
    await boss('PATCH', '/profile', { timezone: 'Africa/Lagos' });
    await signUp(aide, 'Tunde Bakare', `tunde${ID}@x.com`, 'pa', `tunde-bakare-${ID}`);
    await signUp(driver, 'Femi Okon', `femi${ID}@x.com`, 'principal', `femi-okon-${ID}`);

    // The assistant joins the way a real one does: a code the principal set,
    // read down the phone alongside the handle.
    await boss('POST', '/access-codes', { code: 'THURSDAY-LAGOS-91', role: 'chief_of_staff', window: '24h', uses: 2 });
    await aide('POST', '/access-codes/redeem', { handle: HANDLE, code: 'THURSDAY-LAGOS-91' });

    // ---- a bookable meeting type, for the public page --------------------
    await boss('POST', '/meeting-types', {
      name: 'Introduction', durationMinutes: 30, description: 'A first conversation.',
    });
    await boss('POST', '/meeting-types', {
      name: 'Board matter', durationMinutes: 60, description: 'Requires the desk to agree it.',
    });
    // Four rather than two. A real principal offers several, and with two the
    // page is mostly white below the fold — an honest photograph of a screen
    // that happens to be nearly empty, which is a weak thing to post.
    await boss('POST', '/meeting-types', {
      name: 'Site visit', durationMinutes: 90, description: 'Somewhere other than the office.',
    });
    await boss('POST', '/meeting-types', {
      name: 'Quick call back', durationMinutes: 15, description: 'Fifteen minutes, by telephone.',
    });

    // ---- the day ---------------------------------------------------------
    const day = [
      { kind: 'meeting', title: 'Board pack review', startAt: at(8), endAt: at(9),
        location: 'Board room · Victoria Island' },
      { kind: 'call', title: 'Call — Lagos counsel', startAt: at(10), endAt: at(10, 45),
        location: 'Video' },
      { kind: 'meal', title: 'Lunch — Mrs Bello', startAt: at(13), endAt: at(14),
        location: 'The Sky Lounge, Ikoyi' },
      { kind: 'meeting', title: 'Quarterly review', startAt: at(15, 30), endAt: at(16, 30),
        location: 'Office' },
      { kind: 'personal', title: 'Family time', startAt: at(18), endAt: at(19, 30), location: 'Home' },
      { kind: 'flight', title: 'Flight to Abuja', startAt: dayAt(1, 7, 20), endAt: dayAt(1, 8, 40),
        location: 'Lagos (LOS)', destination: 'Abuja (ABV)' },
      { kind: 'meeting', title: 'Ministry meeting', startAt: dayAt(1, 11), endAt: dayAt(1, 12),
        location: 'Abuja' },
      { kind: 'flight', title: 'Flight to Lagos', startAt: dayAt(1, 18), endAt: dayAt(1, 19, 20),
        location: 'Abuja (ABV)', destination: 'Lagos (LOS)' },
    ];
    for (const it of day) await boss('POST', `/itinerary/${bossU.id}/items`, it);

    // ---- the pad ---------------------------------------------------------
    for (const body of [
      'Chase the caterers for Thursday.',
      'Ask Tunde to move the Friday review — clashes with the flight.',
      'Thank the chairman for the introduction.',
    ]) await boss('POST', '/pad', { body, visibility: 'office' });

    // ---- the household ---------------------------------------------------
    // Both accept. An instruction only reaches an `active` member — an invited
    // one is a pending row — so seeding a chef who never accepted and then
    // instructing them is asking the app for something it correctly refuses.
    const chef = api();
    await signUp(chef, 'Chidi Nwosu', `chidi${ID}@x.com`, 'principal', `chidi-nwosu-${ID}`);
    const hire = await boss('POST', `/household/${bossU.id}/staff`,
      { name: 'Femi Okon', email: `femi${ID}@x.com`, jobTitle: 'Driver' });
    const hireChef = await boss('POST', `/household/${bossU.id}/staff`,
      { name: 'Chidi Nwosu', email: `chidi${ID}@x.com`, jobTitle: 'Chef' });
    await driver('POST', `/invites/${hire.d.inviteLink.split('/').pop()}/accept`);
    await chef('POST', `/invites/${hireChef.d.inviteLink.split('/').pop()}/accept`);

    const roster = await boss('GET', `/household/${bossU.id}`);
    const driverRow = roster.d.members.find((m) => m.jobTitle === 'Driver');
    const chefRow = roster.d.members.find((m) => m.jobTitle === 'Chef');
    await boss('POST', `/household/${bossU.id}/instructions`,
      { memberId: driverRow.id, body: 'Car at 06:15 for the Abuja flight.', dueAt: dayAt(1, 6, 15) });
    await boss('POST', `/household/${bossU.id}/instructions`,
      { memberId: chefRow.id, body: 'Dinner for six on Thursday, two vegetarian.' });

    // ---- somewhere to talk -----------------------------------------------
    await boss('POST', '/spaces', { name: 'Ikoyi lease', context: 'work' });
    await boss('POST', '/spaces', { name: 'Abuja trip — logistics', context: 'work' });

    // ---- the fleet --------------------------------------------------------
    const car = await boss('POST', `/movement/${bossU.id}/vehicles`,
      { label: 'The Prado', plate: 'LSD-244-KJA', makeModel: 'Toyota Land Cruiser Prado', colour: 'Black' })
      .catch(() => null);
    if (car) {
      await boss('POST', `/movement/${bossU.id}/drivers`,
        { name: 'Femi Okon', phone: '+234 802 000 0000' }).catch(() => null);
    }

    // -----------------------------------------------------------------------
    // The shots.
    // -----------------------------------------------------------------------
    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

    // as, path, filename, a selector that must be there, how many, and the
    // least text the screen should carry. The text floor is a second net under
    // the selector, for a screen whose selector is only `body` — but it is a
    // property of the screen, not of the app: the public booking page is
    // correctly four lines long, and a global floor called it broken.
    const SHOTS = [
      ['boss', '/today', 'today', '.sched-row', 3],
      ['boss', '/itinerary', 'itinerary', '.sched-row', 3],
      ['boss', '/pad', 'pad', '.pad-body', 2],
      ['boss', '/household', 'household', 'body', 1],
      ['boss', '/spaces', 'spaces', 'body', 1],
      ['boss', '/trips', 'trips', 'body', 1],
      ['boss', '/movements', 'movements', 'body', 1],
      ['boss', '/coming', 'coming', 'body', 1],
      ['boss', '/report', 'report', 'body', 1],
      ['boss', '/dashboard?tab=members', 'team', 'body', 1],
      ['aide', '/workspace', 'workspace', 'body', 1],
      ['aide', '/pa', 'desk', 'body', 1],
      ['driver', '/instructions', 'instructions', 'body', 1],
      // The handle is read back rather than assumed. claimHandle normalises
      // what it is given, so the string sent up is not necessarily the string
      // stored — and a booking page built from the wrong one 404s into a tidy
      // empty state that photographs like a real screen.
      ['public', `/book/${(await boss('GET', '/auth/me')).d.user.slug}`, 'booking', '.meeting-list-item', 2, 60],
    ];

    const logins = {
      boss: [`ada${ID}@x.com`, PW],
      aide: [`tunde${ID}@x.com`, PW],
      driver: [`femi${ID}@x.com`, PW],
    };
    const contexts = {};
    for (const who of Object.keys(logins)) {
      const ctx = await browser.newContext({
        viewport: { width: VW, height: VH }, deviceScaleFactor: 3,
        isMobile: true, hasTouch: true,
      });
      const p = await ctx.newPage();
      await p.goto(`${BASE}/login`);
      await p.fill('#email', logins[who][0]);
      await p.fill('#password', logins[who][1]);
      await p.click('button:has-text("Log in")');
      await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25000 });
      contexts[who] = p;
    }
    contexts.public = await (await browser.newContext({
      viewport: { width: VW, height: VH }, deviceScaleFactor: 3,
      isMobile: true, hasTouch: true,
    })).newPage();

    const captured = [];
    for (const [who, route, name, sel, least, minChars = 120] of SHOTS) {
      const p = contexts[who];
      try {
        await p.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
        await p.waitForTimeout(1500);

        // The "What this does" panel opens on a first visit and folds
        // afterwards — that is the component's own behaviour, so a second
        // visit is how a returning user sees the screen. Reloading rather
        // than injecting CSS: injected CSS makes a picture of a page that
        // cannot exist.
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForTimeout(1600);
        const toggle = p.locator('.what-this-toggle').first();
        if (await p.locator('.what-this-does.is-open').count() && await toggle.count()) {
          await toggle.click({ timeout: 4000 }).catch(() => {});
          await p.waitForTimeout(600);
        }
        if (await p.locator('.what-this-does.is-open').count()) {
          bad(`${name}: the guide panel is still open — the shot would be of the explainer`);
          continue;
        }

        // THE CHECK THIS FILE EXISTS FOR. A screen that failed to load looks
        // like a tidy empty state.
        const found = await p.locator(sel).count();
        if (found < least) {
          bad(`${name}: expected at least ${least} of "${sel}", found ${found} — not photographing an empty screen`);
          continue;
        }
        // A screen that rendered an error is also not an empty state.
        const oops = await p.locator('.error, .app-error').count();
        const words = (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim();
        if (words.length < minChars) {
          // Print what was actually on it. "73 characters" says a screen is
          // wrong; the 73 characters say which way.
          bad(`${name}: only ${words.length} characters — "${words.slice(0, 110)}"`);
          continue;
        }

        const file = path.join(OUT, `${name}.png`);
        await p.screenshot({ path: file });
        captured.push({ name, route, who, chars: words.length, errors: oops });
        note(`  ✓ ${name.padEnd(13)} ${String(found).padStart(3)}× ${sel.padEnd(22)} ${words.length} chars`
          + (oops ? `  (${oops} error blocks)` : ''));
      } catch (err) {
        bad(`${name}: ${err.message.split('\n')[0]}`);
      }
    }

    fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(captured, null, 2));
    note(`\n${captured.length} of ${SHOTS.length} screens captured into ${OUT}`);
  } catch (err) {
    bad('THREW: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
  process.exit(failed ? 1 : 0);
})();
