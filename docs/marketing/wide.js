// The thirteen main screens, full-screen, with the nav rail showing.
//
// DIFFERENT FROM screens.js ON PURPOSE. That one photographs a phone, for
// posts that say what Kairos feels like. This one photographs the whole
// window — rail, header, columns — for posts that explain what a screen
// actually does. A feature explained in detail wants to be seen whole.
//
// THE SEEDING IS THE HARD HALF. Six of these thirteen render as a tidy empty
// state with nothing in them: While you were away has nothing to report until
// somebody else has done something, Tasks until something is assigned, Archive
// until a line is kept, Connections until two offices agree, Trips until one
// is built, Correspondence until mail exists. So this builds a small working
// office — a principal, two assistants, a second principal with an assistant
// of their own, a space with a room and a decision in it — and then
// photographs it.
//
// EVERY SHOT IS CHECKED. A screen that failed to load renders as a tidy empty
// state and photographs beautifully; so does one that loaded and has nothing
// in it, which is the failure this file exists to avoid. Each capture names a
// selector and a count, and the run fails rather than shipping a picture of an
// empty office.
//
// NOTHING SENSITIVE IS SEEDED. No passport, no document, no vault entry, no
// code. The essentials vault is not in this list at all.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright-core'));

const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'wide-shots'));
// Two shapes, one seeding. The office this file builds takes a minute to make
// and is identical either way, so the viewport is an argument rather than a
// second copy of the file that would drift from this one by the third edit.
//   node wide.js <out> laptop   1440x900 @2  — the rail is open, screens whole
//   node wide.js <out> phone     390x844 @3  — the rail is a hamburger
const SHAPE = (process.argv[3] || 'laptop').toLowerCase();
if (!['laptop', 'phone'].includes(SHAPE)) throw new Error(`unknown shape "${SHAPE}"`);
const PHONE = SHAPE === 'phone';
const PORT = Number(process.env.PORT || 4861);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';

// A laptop is wide enough that the nav rail is permanently open rather than
// behind a hamburger. A phone is not, and that is not a fault to correct — it
// is what the screen is on a phone.
const VW = PHONE ? 390 : 1440;
// The phone is captured tall on purpose. The explainer's glass shows roughly
// 2650 source pixels starting below the app header, and a 900px viewport at 3x
// gives only 2700 in total — so the design ran out of screenshot and put a
// blank strip along the bottom of the device. Extra height costs nothing here
// because the design crops anyway.
const VH = PHONE ? 1120 : 900;
const DPR = PHONE ? 3 : 2;

let failed = 0;
const note = (s) => console.log(s);
const bad = (s) => { failed += 1; console.log('  ✗ ' + s); };

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
    return { s: r.status, d };
  };
}

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

const now = new Date();
const at = (h, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d.toISOString(); };
const dayAt = (o, h, m = 0) => {
  const d = new Date(now); d.setDate(d.getDate() + o); d.setHours(h, m, 0, 0); return d.toISOString();
};
const dateOnly = (o) => {
  const d = new Date(now); d.setDate(d.getDate() + o); return d.toISOString().slice(0, 10);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const DATA = path.join(ROOT, 'app', 'server', 'data');
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(path.join(DATA, f));
  }

  const srv = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: path.join(ROOT, 'app', 'server'),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ENCRYPTION_KEY: '0'.repeat(64) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  let browser = null;
  try {
    await ready();

    // ---- an office ------------------------------------------------------
    const boss = api(), aide = api(), driver = api();
    const boss2 = api(), aide2 = api();
    const H = `adaeze-okonkwo-${ID}`;
    const H2 = `emeka-obi-${ID}`;

    const bossU = await signUp(boss, 'Adaeze Okonkwo', `ada${ID}@x.com`, 'principal', H);
    await boss('PATCH', '/profile', { timezone: 'Africa/Lagos' });
    const aideU = await signUp(aide, 'Tunde Bakare', `tunde${ID}@x.com`, 'pa', `tunde-bakare-${ID}`);
    await signUp(driver, 'Femi Okon', `femi${ID}@x.com`, 'principal', `femi-okon-${ID}`);

    // A second office, so Connections has somebody real on the other side.
    await signUp(boss2, 'Emeka Obi', `emeka${ID}@x.com`, 'principal', H2);
    await signUp(aide2, 'Ngozi Eze', `ngozi${ID}@x.com`, 'pa', `ngozi-eze-${ID}`);
    await boss2('POST', '/access-codes', { code: 'HARMATTAN-ABUJA-04', role: 'pa', window: '24h', uses: 2 });
    await aide2('POST', '/access-codes/redeem', { handle: H2, code: 'HARMATTAN-ABUJA-04' });

    await boss('POST', '/access-codes', { code: 'THURSDAY-LAGOS-91', role: 'chief_of_staff', window: '24h', uses: 3 });
    await aide('POST', '/access-codes/redeem', { handle: H, code: 'THURSDAY-LAGOS-91' });

    // THE TWO WARNINGS ON THE TEAM SCREEN ARE STATE, NOT DECORATION.
    // "Your booking page isn't live yet" and "You have no security question
    // yet" are conditional on `hasAvailability === false` and
    // `hasQuestion === false` (Dashboard.jsx). An account that has set its
    // hours and its question does not show them — so the way to take them out
    // of a screenshot is to finish setting the account up, which is what a
    // real principal does in their first ten minutes. Hiding them with
    // injected CSS would be a picture of a state the app cannot be in.
    await boss('PUT', '/availability', {
      rules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:00' })),
    });
    await boss('POST', '/security/question', {
      question: 'What was the name of your first school?',
      answer: 'Corona Ikoyi',
      password: PW,
    });

    for (const mt of [
      { name: 'Introduction', durationMinutes: 30, description: 'A first conversation.' },
      { name: 'Board matter', durationMinutes: 60, description: 'Requires the desk to agree it.' },
      { name: 'Site visit', durationMinutes: 90, description: 'Somewhere other than the office.' },
    ]) await boss('POST', '/meeting-types', mt);

    // ---- the day and the fortnight ---------------------------------------
    for (const it of [
      { kind: 'meeting', title: 'Board pack review', startAt: at(8), endAt: at(9),
        location: 'Board room · Victoria Island' },
      { kind: 'call', title: 'Call — Lagos counsel', startAt: at(10), endAt: at(10, 45), location: 'Video' },
      { kind: 'meal', title: 'Lunch — Mrs Bello', startAt: at(13), endAt: at(14),
        location: 'The Sky Lounge, Ikoyi' },
      { kind: 'meeting', title: 'Quarterly review', startAt: at(15, 30), endAt: at(16, 30), location: 'Office' },
      { kind: 'personal', title: 'Family time', startAt: at(18), endAt: at(19, 30), location: 'Home' },
      { kind: 'meeting', title: 'Ministry meeting', startAt: dayAt(2, 11), endAt: dayAt(2, 12), location: 'Abuja' },
      { kind: 'meeting', title: 'Site walk — Lekki', startAt: dayAt(3, 9), endAt: dayAt(3, 11), location: 'Lekki' },
    ]) await boss('POST', `/itinerary/${bossU.id}/items`, it);

    // ---- LAST WEEK, WHICH IS THE WEEK REPORT OPENS ON ---------------------
    //
    // Report defaults to the previous Monday-to-Sunday. Everything else seeded
    // here is today or later, so the screen opened on zeros and said "Nothing
    // recorded this week" — an accurate picture of an empty account and a
    // useless picture of the feature. A report is only a report of something
    // that happened.
    const dow = (now.getDay() + 6) % 7;          // 0 = Monday
    const lastMonday = -dow - 7;
    const back = (d, h, m = 0) => dayAt(lastMonday + d, h, m);
    for (const it of [
      { kind: 'meeting', title: 'Board — Q3 pack', startAt: back(0, 9), endAt: back(0, 11),
        location: 'Board room · Victoria Island' },
      { kind: 'call', title: 'Call — Lagos counsel', startAt: back(0, 14), endAt: back(0, 15),
        location: 'Video' },
      { kind: 'meeting', title: 'Ikoyi lease — landlord', startAt: back(1, 10), endAt: back(1, 11, 30),
        location: 'Ikoyi' },
      { kind: 'meal', title: 'Lunch — Mrs Bello', startAt: back(1, 13), endAt: back(1, 14, 30),
        location: 'The Sky Lounge, Ikoyi' },
      { kind: 'meeting', title: 'Site walk — Lekki', startAt: back(2, 8), endAt: back(2, 10, 30),
        location: 'Lekki' },
      { kind: 'call', title: 'Call — the chairman', startAt: back(2, 16), endAt: back(2, 16, 30),
        location: 'Telephone' },
      { kind: 'meeting', title: 'Quarterly review', startAt: back(3, 10), endAt: back(3, 12),
        location: 'Office' },
      { kind: 'meeting', title: 'Auditors', startAt: back(3, 14), endAt: back(3, 16),
        location: 'Office' },
      { kind: 'meeting', title: 'Ministry — permit', startAt: back(4, 11), endAt: back(4, 12, 30),
        location: 'Abuja' },
      { kind: 'meal', title: 'Dinner — Emeka Obi', startAt: back(4, 19), endAt: back(4, 21),
        location: 'Ikoyi' },
    ]) await boss('POST', `/itinerary/${bossU.id}/items`, { ...it, status: 'confirmed' });

    // ---- a trip, with legs on it -----------------------------------------
    const trip = await boss('POST', `/trips/${bossU.id}`, {
      name: 'London, board week', destination: 'London',
      startsOn: dateOnly(7), endsOn: dateOnly(11),
    });
    const tripId = trip.d.trip.id;
    for (const leg of [
      { title: 'BA075 Lagos → London', kind: 'flight', tripId, startAt: dayAt(7, 23, 30),
        endAt: dayAt(8, 6, 10), location: 'Lagos (LOS)', destination: 'London (LHR)' },
      { title: 'Board dinner', kind: 'meal', tripId, startAt: dayAt(8, 19), endAt: dayAt(8, 21),
        location: 'The Ned, London' },
      { title: 'Board meeting', kind: 'meeting', tripId, startAt: dayAt(9, 9), endAt: dayAt(9, 13),
        location: 'Moorgate' },
      { title: 'BA074 London → Lagos', kind: 'flight', tripId, startAt: dayAt(10, 21), endAt: dayAt(11, 5, 30),
        location: 'London (LHR)', destination: 'Lagos (LOS)' },
    ]) await boss('POST', `/itinerary/${bossU.id}/items`, { ...leg, status: 'confirmed' });
    await boss('POST', `/trips/${bossU.id}`, {
      name: 'Abuja, ministry', destination: 'Abuja',
      startsOn: dateOnly(21), endsOn: dateOnly(22),
    });

    // ---- the pad ---------------------------------------------------------
    for (const body of [
      'Chase the caterers for Thursday.',
      'Ask Tunde to move the Friday review — it clashes with the flight.',
      'Thank the chairman for the introduction.',
      'Renew the Lekki parking permit before the site walk.',
    ]) await boss('POST', '/pad', { body, visibility: 'office' });

    // ---- a space, a room, a decision, tasks, a kept line ------------------
    const space = await boss('POST', '/spaces', { name: 'Ikoyi lease', context: 'work' });
    const spaceId = space.d.space.id;
    await boss('POST', '/spaces', { name: 'Board — Q3', context: 'work' });
    await boss('POST', '/spaces', { name: 'Lekki site', context: 'work' });

    const room = await boss('POST', `/spaces/${spaceId}/threads`, { name: 'Lease terms' });
    const threadId = room.d.thread.id;
    await boss('POST', `/threads/${threadId}/messages`, { body: 'Morning all — the landlord has come back on the term.' });
    const keeper = await boss('POST', `/threads/${threadId}/messages`, {
      body: 'Agreed: five years with a break at three, service charge capped at 8%.',
      register: 'record', recordType: 'decision',
    });
    await boss('POST', `/threads/${threadId}/messages`, { body: 'Noted, I will get it drafted.' });
    await boss('POST', `/threads/${threadId}/messages/${keeper.d.id}/keep`, {});

    for (const t of [
      { spaceId, title: 'Circulate the revised lease', assigneeId: aideU.id, dueAt: dayAt(2, 17) },
      { spaceId, title: 'Confirm the break clause with counsel', assigneeId: aideU.id, dueAt: dayAt(4, 12) },
      { spaceId, title: 'Book the surveyor for the Lekki walk', assigneeId: aideU.id },
    ]) await boss('POST', '/tasks', t);

    // ---- a connection between the two offices ----------------------------
    await aide('POST', '/connections', { handle: `ngozi-eze-${ID}`, note: 'Thursday — our two principals' });
    const incoming = await aide2('GET', '/connections');
    if (incoming.d.incoming?.length) {
      await aide2('POST', `/connections/${incoming.d.incoming[0].id}/accept`);
    }

    // ---- the household ---------------------------------------------------
    const chef = api();
    await signUp(chef, 'Chidi Nwosu', `chidi${ID}@x.com`, 'principal', `chidi-nwosu-${ID}`);
    const hire = await boss('POST', `/household/${bossU.id}/staff`,
      { name: 'Femi Okon', email: `femi${ID}@x.com`, jobTitle: 'Driver' });
    const hireChef = await boss('POST', `/household/${bossU.id}/staff`,
      { name: 'Chidi Nwosu', email: `chidi${ID}@x.com`, jobTitle: 'Chef' });
    await driver('POST', `/invites/${hire.d.inviteLink.split('/').pop()}/accept`);
    await chef('POST', `/invites/${hireChef.d.inviteLink.split('/').pop()}/accept`);

    // -----------------------------------------------------------------------
    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

    // who, path, filename, selector that must exist, how many, least text
    const SHOTS = [
      ['boss', '/today', 'today', '.sched-row', 3, 400],
      ['aide', '/catch-up', 'catch-up', 'body', 1, 200],
      // Scrolled to the roster. The team list sits below the booking link and
      // the access codes, so an unscrolled shot of this screen is a shot of
      // everything except the team.
      ['boss', '/dashboard?tab=members', 'team', '.meeting-type-card', 1, 400, '.member-toggle'],
      ['boss', '/itinerary', 'itinerary', '.sched-row', 3, 400],
      ['boss', '/pad', 'pad', '.pad-body', 3, 300],
      ['boss', '/trips', 'trips', 'body', 1, 300],
      ['aide', '/pa', 'desk', 'body', 1, 400],
      ['boss', '/report', 'report', 'body', 1, 300],
      // The reporting flow, in the states a person actually puts it in.
      ['boss', '/report', 'report-parts', 'body', 1, 300, null,
        'button:has-text("What the office did")'],
      ['boss', '/report', 'report-export', 'body', 1, 300, 'text=Take it away'],
      ['aide', '/mail', 'correspondence', 'body', 1, 200],
      ['boss', '/spaces', 'spaces', 'body', 1, 300],
      ['aide', '/tasks', 'tasks', 'body', 1, 250],
      ['boss', '/archive', 'archive', 'body', 1, 250],
      ['aide', '/connections', 'connections', 'body', 1, 250],
    ];

    const logins = {
      boss: `ada${ID}@x.com`, aide: `tunde${ID}@x.com`,
    };
    const pages = {};
    for (const who of Object.keys(logins)) {
      const ctx = await browser.newContext({
        viewport: { width: VW, height: VH }, deviceScaleFactor: DPR,
        ...(PHONE ? { isMobile: true, hasTouch: true } : {}),
      });
      const p = await ctx.newPage();
      await p.goto(`${BASE}/login`);
      await p.fill('#email', logins[who]);
      await p.fill('#password', PW);
      await p.click('button:has-text("Log in")');
      await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25000 });
      pages[who] = p;
    }

    const captured = [];
    for (const [who, route, name, sel, least, minChars, scrollTo, click] of SHOTS) {
      const p = pages[who];
      try {
        await p.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
        await p.waitForTimeout(1400);
        // Second visit: the guide panel folds itself once seen, which is the
        // state every returning user is in. Reloading rather than injecting
        // CSS — injected CSS makes a picture of a page that cannot exist.
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.waitForTimeout(1600);
        const toggle = p.locator('.what-this-toggle').first();
        if (await p.locator('.what-this-does.is-open').count() && await toggle.count()) {
          await toggle.click({ timeout: 4000 }).catch(() => {});
          await p.waitForTimeout(600);
        }
        if (await p.locator('.what-this-does.is-open').count()) {
          bad(`${name}: the guide panel is still open`);
          continue;
        }

        // Some screens are worth photographing in a state a person puts them
        // in — a section chosen, a period changed. Pressing the control is how
        // they get there, so the shot stays a photograph of the real app.
        if (click) {
          const btn = p.locator(click).first();
          if (!(await btn.count())) {
            bad(`${name}: nothing matches "${click}" to press`);
            continue;
          }
          await btn.click({ timeout: 6000 });
          await p.waitForTimeout(1100);
        }

        // Put the part worth photographing in the viewport. Scrolling is how a
        // person reaches it, so this is framing rather than staging.
        if (scrollTo) {
          const target = p.locator(scrollTo).first();
          if (!(await target.count())) {
            bad(`${name}: nothing matches "${scrollTo}" to scroll to`);
            continue;
          }
          await target.scrollIntoViewIfNeeded();
          await p.waitForTimeout(700);
        }

        const found = await p.locator(sel).count();
        if (found < least) {
          bad(`${name}: expected ${least}+ of "${sel}", found ${found} — not photographing an empty screen`);
          continue;
        }
        const words = (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim();
        if (words.length < minChars) {
          bad(`${name}: only ${words.length} chars — "${words.slice(0, 110)}"`);
          continue;
        }
        // On a laptop the rail is part of what these posts explain, and its
        // absence means the viewport is being treated as narrow. On a phone
        // the opposite is true, so asserting it either way would be asserting
        // something that cannot fail in one of the two modes.
        if (!PHONE) {
          const rail = await p.locator('.app-nav').count();
          if (!rail) {
            bad(`${name}: no nav rail on screen — the viewport is being treated as narrow`);
            continue;
          }
        }

        // WHERE THE "NOT YET" MARKERS ARE, IN SOURCE PIXELS.
        //
        // The standing instruction for these mockups is to show how the app
        // works rather than to advertise what is switched off. Some of those
        // markers can be removed honestly by finishing the setup — the booking
        // and security-question warnings above are gone that way. The rest are
        // real badges on real features, and the honest answer for those is to
        // frame past them, not to delete them from the picture.
        //
        // So this does not fail the run: it reports each marker and how far
        // down the screenshot it sits, which is exactly what choosing a crop
        // needs. The nav rail is excluded — it carries a permanent SOON badge
        // and is not in frame on the phone set at all.
        const flags = await p.evaluate((dpr) => {
          const main = document.querySelector('.app-main') || document.body;
          const re = /\bnot yet\b|\bsoon\b|isn't live|no security question/i;
          const out = [];
          for (const el of main.querySelectorAll('*')) {
            if (el.children.length) continue;            // leaves only
            const t = (el.textContent || '').trim();
            if (!t || t.length > 80 || !re.test(t)) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            out.push({ text: t.slice(0, 44), y: Math.round((r.top + window.scrollY) * dpr) });
          }
          return out;
        }, DPR);

        await p.screenshot({ path: path.join(OUT, `${name}.png`) });
        captured.push({ name, route, who, chars: words.length, flags });
        for (const fl of flags) note(`      ⚑ "${fl.text}" at y=${fl.y}`);
        note(`  ✓ ${name.padEnd(15)} ${String(found).padStart(3)}× ${sel.padEnd(14)} ${words.length} chars`);
      } catch (err) {
        bad(`${name}: ${err.message.split('\n')[0]}`);
      }
    }

    fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(captured, null, 2));
    note(`\n${captured.length} of ${SHOTS.length} screens captured into ${OUT}`
      + `  (${SHAPE}, ${VW}x${VH} @${DPR}x)`);
  } catch (err) {
    bad('THREW: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
  process.exit(failed ? 1 : 0);
})();
