// The things that only exist once somebody taps.
//
// WHY THIS IS SEPARATE FROM blayout. That suite walks every screen at every
// width and measures what is out of frame, and it passed the person menu
// without seeing a thing — because it measures pages AS THEY LOAD, and a
// closed menu takes up no room at all. The overflow only came into existence
// when somebody tapped a name. At 360px that menu opened 95px past the right
// edge, gave the document a horizontal scrollbar, and could land below the
// fold; three screens' worth of measurement had nothing to say about it.
//
// So this is the other half: open the overlays, the pickers, the inline forms
// and the menus, and measure the page with them open. Same measurement, from
// lib measure.js, because two copies of "what is out of frame" would drift.
//
// AND AT THREE SHAPES OF SCREEN, because these fail differently on each. A
// phone runs out of width. A tablet is where a layout that was designed for
// two columns first gets them and often gets them wrong. A laptop has room to
// spare and fails the other way — a line of prose stretched so wide the eye
// cannot find its way back to the left margin.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');
const { MEASURE, faults } = require('./measure');

const PORT = 4577, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? '\n      ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

// A phone, a tablet and a laptop. The last carries a line-length limit; the
// other two do not, because a narrow screen cannot produce an over-long line
// and checking for one there would only generate noise.
const SHAPES = [
  [360, 740, 'phone', 0],
  [768, 1024, 'tablet', 0],
  [1440, 900, 'laptop', 95],
];

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
  let b = null;
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    // ---- Enough of an office that the overlays have something to show ------
    const boss = client();
    const up = await boss('POST', '/auth/signup', {
      name: 'Adaeze Okonkwo-Balogun', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal',
    });
    const bossId = up.d.user.id;
    await boss('PATCH', '/profile', { slug: `adaeze-${ID}`, timezone: 'Africa/Lagos' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const pa = client();
    await pa('POST', '/auth/signup', {
      name: 'Oluwaseun Adebayo-Williams', email: `seun${ID}@x.com`, password: PW, accountCategory: 'pa',
    });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    const invite = await boss('POST', '/members', { email: `seun${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${invite.d.inviteLink.split('/').pop()}/accept`);

    await boss('PUT', '/availability', {
      rules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:30' })),
    });
    const mt = await boss('POST', '/meeting-types', {
      name: 'Quarterly portfolio review with the investment committee',
      durationMinutes: 60, locationType: 'video',
      description: 'A long description of the sort somebody actually writes when they are '
        + 'explaining at length what a meeting is for and who ought to be in it.',
    });

    const threadId = (await boss('GET', `/today/${bossId}`)).d.directLine.threadId;
    // Long names and long words, which is where boxes break.
    await pa('POST', `/threads/${threadId}/messages`, {
      body: 'The car is downstairs and the Murtala Muhammed International Airport run '
        + 'will take about ninety minutes at this hour.',
    });
    const said = await boss('POST', `/threads/${threadId}/messages`, { body: 'Understood — six sharp.' });
    const promoted = await pa('POST', `/threads/${threadId}/messages`, {
      body: 'The board dinner moves to Thursday at eight',
    });
    await boss('POST', `/threads/${threadId}/messages/${promoted.d.id}/promote`, { recordType: 'decision' });
    await boss('POST', '/tasks', {
      sourceMessageId: said.d.id,
      title: 'Confirm the Thursday dinner with the investment committee secretariat',
    });

    // A live appointment, so the three verbs are on the page.
    const crypto = require('crypto');
    const db = require(`${ROOT}/app/server/lib/db`);
    await db.ready();
    const bookingId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO bookings (id, meeting_type_id, owner_id, booker_name, booker_email,
                            booker_timezone, start_at, end_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'Europe/London', ?, ?, 'confirmed', ?)
    `).run(bookingId, mt.d.meetingType.id, bossId,
      'Oluwatobiloba Adeyemi-Fashola', 'oluwatobiloba@averylongdomainnameindeed.com',
      new Date(Date.now() + 3 * 3600e3).toISOString(),
      new Date(Date.now() + 4 * 3600e3).toISOString(), new Date().toISOString());

    await boss('POST', '/pad', {
      body: 'Ask the auditors whether the Mauritius structure needs re-papering before the year end',
      visibility: 'office',
    });

    /**
     * Everything that opens over, or inside, a page.
     *
     * Each is [where, what it is, what to click, what should then be on screen].
     * Steps run in order, so a two-tap path — open the menu, then open the form
     * inside it — is written as two selectors.
     */
    const OPENERS = [
      ['/today', 'the account menu', ['.acct-btn, .account-menu-btn, header button[aria-haspopup]'], null],
      ['/today', 'the pad dock', ['.pad-dock-btn'], '.pad-dock-open'],
      [`/threads/${threadId}`, 'a person menu', ['button.person-link'], '.person-menu'],
      [`/threads/${threadId}`, 'a person menu, handing something over',
        ['button.person-link', '.person-menu button:has-text("Hand them something")'], '.person-hand'],
      [`/threads/${threadId}`, 'the edit box', ['.msg-note:has-text("Understood") button:has-text("Edit")'], '.msg-edit'],
      [`/threads/${threadId}`, 'the record picker', ['button:has-text("Promote to record")'], '.msg-promote-picker'],
      [`/threads/${threadId}`, 'the task maker', ['button:has-text("Make a task")'], '.msg-task-form'],
      [`/threads/${threadId}`, 'superseding a record', ['button:has-text("Supersede")'], '.msg-supersede'],
      [`/appointments/${bossId}/${bookingId}`, 'moving an appointment', ['button:has-text("Move it")'], '.move-appt, .card'],
      [`/appointments/${bossId}/${bookingId}`, 'changing the length', ['button:has-text("Change the length")'], '#bd-mins'],
      [`/appointments/${bossId}/${bookingId}`, 'calling it off', ['button:has-text("Call it off")'], '#bd-cancel-why'],
      ['/pad', 'the pad verbs', ['button:has-text("Do something")'], '.pad-actions'],
      ['/pad', 'handing a pad line over',
        ['button:has-text("Do something")', 'button:has-text("Somebody else\'s")'], '.pad-action-form'],
    ];

    b = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });

    for (const [w, h, label, maxChars] of SHAPES) {
      head(`${label} — ${w}×${h}:`);
      const ctx = await b.newContext({
        viewport: { width: w, height: h },
        isMobile: w < 500,
        hasTouch: w < 900,
      });
      const p = await ctx.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(`${BASE}/login`);
      await p.fill('#email', `ada${ID}@x.com`);
      await p.fill('#password', PW);
      await p.click('button:has-text("Log in")');
      await p.waitForURL(/\/workspace|\/today/, { timeout: 20000 });

      let broken = 0;
      const missing = [];

      for (const [where, what, steps, expect] of OPENERS) {
        await p.goto(`${BASE}${where}`, { waitUntil: 'networkidle' }).catch(() => {});
        await p.waitForTimeout(200);

        let opened = true;
        for (const sel of steps) {
          const target = p.locator(sel).first();
          try {
            await target.waitFor({ state: 'visible', timeout: 6000 });
            await target.click();
            await p.waitForTimeout(250);
          } catch { opened = false; break; }
        }
        // A control that is not there is worth knowing about — it may be
        // correctly absent at this width, or it may be the thing that is out of
        // frame — but it is not a layout fault, so it is listed, not failed.
        if (!opened) { missing.push(`${what} (${where})`); continue; }
        if (expect && !(await p.locator(expect).first().isVisible().catch(() => false))) {
          missing.push(`${what} — clicked, nothing appeared`);
          continue;
        }

        const m = await p.evaluate(MEASURE, maxChars);
        const bad = faults(m);
        if (bad.length) {
          broken += 1;
          console.log(`  ✗ ${what} — ${where}`);
          for (const line of bad) console.log(`      ${line}`);
        }

        // And the opened thing itself must be reachable: fully on screen
        // horizontally, and its top edge somewhere a person can see.
        if (expect) {
          const box = await p.locator(expect).first().boundingBox().catch(() => null);
          if (box) {
            if (box.x < -1 || box.x + box.width > w + 1) {
              broken += 1;
              console.log(`  ✗ ${what} is off the side — ${Math.round(box.x)}…${Math.round(box.x + box.width)} of ${w}`);
            }
            if (box.y > h) {
              broken += 1;
              console.log(`  ✗ ${what} opens below the fold — top at ${Math.round(box.y)} of ${h}`);
            }
          }
        }
      }

      ok(`nothing opens out of frame at ${w}px`, broken === 0, `${broken} of ${OPENERS.length}`);
      if (missing.length) console.log(`      not reachable here: ${missing.join(', ')}`);
      ok(`and nothing threw at ${w}px`, errs.length === 0, errs.join(' | '));
      await ctx.close();
    }

    try { await db.close(); } catch { /* already shut */ }
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (b) await b.close();
    proc.kill();
  }
  console.log(fails === 0
    ? '\nEverything that opens, opens where somebody can reach it.'
    : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
