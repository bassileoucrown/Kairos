// Does the app fit on a phone?
//
// Two separate failures, and they need different measurements.
//
// SIDEWAYS SCROLL is the page being wider than the window. Somebody has to
// drag the whole layout left to reach a button, which on a phone means they
// usually do not reach it at all. Measured at the document.
//
// SPILLING is an element being wider than the box it was given, so its text
// runs out over whatever is beside it. That is what "details are overlapping"
// looks like from the inside. Measured per element, and only where the box is
// not allowed to scroll — a table inside a scroller is doing what it should.
//
// Both are reported with the offending element named, because "the page is too
// wide" is not something anybody can act on.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4589);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const EMAIL = `lay${ID}@x.com`;
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// The widths that matter. 360 is the small Android still in wide use; 390 is a
// current iPhone; 414 a large one. Anything narrower than 360 is a rounding
// error in the market, anything wider is a tablet and has room.
const WIDTHS = [
  [360, 780, 'small phone'],
  [390, 844, 'phone'],
  [414, 896, 'large phone'],
  [768, 1024, 'tablet'],
];

let fails = 0;
const problems = [];
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

function api(cookieJar) {
  return async (m, p, b) => {
    const r = await fetch(`${BASE}/api${p}`, {
      method: m,
      headers: { 'Content-Type': 'application/json', ...(cookieJar.c ? { Cookie: cookieJar.c } : {}) },
      body: b ? JSON.stringify(b) : undefined,
    });
    const sc = r.headers.get('set-cookie'); if (sc) cookieJar.c = sc.split(';')[0];
    let d = null; try { d = await r.json(); } catch { /* 204 */ }
    return { s: r.status, d };
  };
}

/**
 * What is too wide, and what is spilling out of its own box.
 *
 * Runs in the page. Deliberately ignores anything inside an element that is
 * allowed to scroll sideways — a wide table in an overflow-x container is the
 * intended answer to a wide table, not a bug.
 */
const MEASURE = () => {
  const de = document.documentElement;
  const limit = de.clientWidth;

  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
    return (el.tagName.toLowerCase() + id + cls).slice(0, 80);
  };

  const scrollsSideways = (el) => {
    const o = getComputedStyle(el).overflowX;
    return o === 'auto' || o === 'scroll';
  };

  const insideAScroller = (el) => {
    for (let p = el.parentElement; p && p !== de; p = p.parentElement) {
      if (scrollsSideways(p)) return true;
    }
    return false;
  };

  const wide = [];
  const spilling = [];

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    // Pushing the page wider than the window.
    if (r.right > limit + 1 && !insideAScroller(el)) {
      wide.push({ what: describe(el), right: Math.round(r.right), over: Math.round(r.right - limit) });
    }

    // Wider than its own box, with nowhere to scroll — this is the text that
    // runs over its neighbour.
    if (!scrollsSideways(el) && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      const text = (el.textContent || '').trim().slice(0, 40);
      if (text) {
        spilling.push({
          what: describe(el),
          by: el.scrollWidth - el.clientWidth,
          text,
        });
      }
    }
  }

  // Deepest offenders only: a parent is wide because its child is, and naming
  // twelve ancestors of one long word helps nobody.
  const deepest = (list) => list.filter((a, i) => !list.some((b, j) =>
    j !== i && b.what !== a.what && b.what.includes(a.what)));

  return {
    overflow: de.scrollWidth - limit,
    wide: deepest(wide).slice(0, 6),
    spilling: spilling.slice(0, 6),
  };
};

(async () => {
  const proc = spawn('node', ['index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ENCRYPTION_KEY: KEY },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let browser;

  try {
    const deadline = Date.now() + 30000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('the server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    // ---- Seed enough that the screens are not empty ----------------------
    // An empty page never overflows. Every screen measured below is given the
    // kind of content that makes it wide in real use: long names, long
    // locations, a full week of hours, several rows.
    const jar = {};
    const call = api(jar);
    const up = await call('POST', '/auth/signup', { name: 'Adaeze Okonkwo-Abubakar', email: EMAIL, password: PW });
    if (up.s !== 201) throw new Error('signup failed: ' + up.s + ' ' + JSON.stringify(up.d));
    const who = await call('GET', '/auth/me');
    if (!who.d?.user?.id) throw new Error('no session after signup: ' + who.s + ' ' + JSON.stringify(who.d));
    const me = who.d.user;
    await call('PATCH', '/profile', { slug: `adaeze-${ID}`, timezone: 'Africa/Lagos' });
    await call('POST', '/profile/onboarding-step', { step: 'done' });

    for (const day of [1, 2, 3, 4, 5]) {
      await call('POST', '/availability', { rules: [{ dayOfWeek: day, startTime: '09:00', endTime: '17:30' }] });
    }
    await call('POST', '/meeting-types', {
      name: 'Quarterly portfolio review with the investment committee',
      durationMinutes: 60, locationType: 'video',
      description: 'A long description of the sort somebody actually writes when they are explaining what the meeting is for.',
    });

    const soon = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
    for (const [title, place, hrs] of [
      ['Board pre-read with the Chief Financial Officer', 'Ikoyi, Lagos — 14 Kingsway Road, 3rd floor', 2],
      ['Call with counsel about the Mauritius structure', 'Video — dial in from anywhere', 5],
      ['Lunch, Eko Hotel and Suites, Victoria Island', 'Plot 1415 Adetokunbo Ademola Street', 8],
      ['Car to Murtala Muhammed International Airport', 'Departing from the Ikoyi residence', 26],
    ]) {
      await call('POST', `/itinerary/${me.id}`, {
        title, kind: 'meeting', location: place,
        startAt: soon(hrs), endAt: soon(hrs + 1), status: 'confirmed',
      });
    }

    await call('POST', `/essentials/${me.id}`, {
      category: 'travel_identity', field: 'passport_number', value: 'A01234821', expiresOn: '2027-03-01',
    });
    await call('POST', `/essentials/${me.id}`, {
      category: 'preferences', field: 'seat_preference', value: 'Aisle, front of cabin, away from the galley',
    });
    await call('POST', `/pa/${me.id}/contacts`, {
      name: 'Oluwaseun Adebayo-Williams', email: 'oluwaseun.adebayo.williams@averylongdomainname.com',
      company: 'Adebayo Williams Capital Partners Limited', tier: 'inner_circle',
    });

    // ---- Walk the screens -------------------------------------------------
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });

    const SCREENS = [
      ['Today', '/today'],
      ['Itinerary', '/itinerary'],
      ['Trips', '/trips'],
      ['Calendar', '/dashboard?tab=calendar'],
      ['Availability', '/dashboard?tab=availability'],
      ['Meeting types', '/dashboard?tab=meetingTypes'],
      ['Bookings', '/dashboard?tab=bookings'],
      ['Essentials', '/dashboard?tab=essentials'],
      ['Security', '/dashboard?tab=security'],
      ['Connectors', '/dashboard?tab=connectors'],
      ['Team', '/dashboard?tab=members'],
      ['Outbox', '/dashboard?tab=outbox'],
      ['Settings', '/dashboard?tab=settings'],
      ['Approvals', '/pa?tab=approvals'],
      ['Contacts', '/pa?tab=contacts'],
      ['Briefs', '/pa?tab=briefs'],
      ['Spaces', '/spaces'],
      ['Tasks', '/tasks'],
      ['Workspace', '/workspace'],
      ['Household', '/household'],
      ['Connections', '/connections'],
      ['Concierge', '/concierge'],
      ['Coming', '/coming'],
      ['Notices', '/notices'],
      ['Booking page', `/book/adaeze-${ID}`],
    ];

    for (const [w, h, label] of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      // Carry the signed-in session into the browser.
      await ctx.addCookies([{
        name: jar.c.split('=')[0], value: jar.c.split('=').slice(1).join('='),
        domain: '127.0.0.1', path: '/',
      }]);
      const page = await ctx.newPage();

      console.log(`\n${label} — ${w}px:`);
      let bad = 0;

      for (const [name, path] of SCREENS) {
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {});
        await page.waitForTimeout(250);
        const m = await page.evaluate(MEASURE);

        if (m.overflow > 1) {
          bad++;
          problems.push({ width: w, screen: name, kind: 'sideways', by: m.overflow, who: m.wide });
          console.log(`  ✗ ${name} scrolls sideways by ${m.overflow}px`);
          for (const el of m.wide) console.log(`      ${el.what}  (+${el.over}px)`);
        }
        if (m.spilling.length) {
          bad++;
          problems.push({ width: w, screen: name, kind: 'spilling', who: m.spilling });
          console.log(`  ✗ ${name} has content spilling its box`);
          for (const el of m.spilling) console.log(`      ${el.what}  (+${el.by}px)  "${el.text}"`);
        }
      }

      ok(`nothing overflows at ${w}px`, bad === 0, `${bad} screens`);
      await ctx.close();
    }
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nEvery screen fits the phone it is held in.'
    : `\n${fails} FAILED — ${problems.length} problems listed above.`);
  process.exit(fails === 0 ? 0 : 1);
})();
