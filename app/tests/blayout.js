// Does the app fit on a phone, and can it be read once it does?
//
// Three separate failures, and they need different measurements.
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
// SQUEEZING is the opposite of spilling, and it was invented by the fix for
// it. min-width:0 plus overflow-wrap:anywhere lets a box shrink and lets its
// text break anywhere; put that box in a row beside buttons that will not
// shrink, and it collapses instead of overflowing. The itinerary title was
// measured at eleven pixels holding forty-seven characters over thirty-nine
// lines — one letter per line. The page fitted the phone perfectly, so the two
// measurements above both passed it. Measured as text in a box too narrow to
// hold a word.
//
// All three are reported with the offending element named, because "the page is
// too wide" is not something anybody can act on.
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
  const squeezed = [];

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    // Pushing the page wider than the window.
    if (r.right > limit + 1 && !insideAScroller(el)) {
      wide.push({ what: describe(el), right: Math.round(r.right), over: Math.round(r.right - limit) });
    }

    // Crushed into a column too narrow to set a word in. Leaf elements only:
    // a wrapper is narrow because its child is, and naming both is noise.
    if (el.children.length === 0) {
      const words = (el.textContent || '').trim();
      if (words.length >= 12) {
        const size = parseFloat(cs.fontSize) || 14;
        // Roughly half the font size per character, which is close enough for
        // "is there room for a word here" and needs no font metrics.
        const perLine = r.width / (size * 0.5);
        const lines = Math.round(r.height / (parseFloat(cs.lineHeight) || size * 1.4));
        if (perLine < 6 && lines > 3) {
          squeezed.push({
            what: describe(el),
            width: Math.round(r.width),
            chars: words.length,
            lines,
            text: words.slice(0, 40),
          });
        }
      }
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
    squeezed: squeezed.slice(0, 6),
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
    // An empty page never overflows and never crushes anything either, so this
    // suite is worth exactly as much as its seeding. That is not a figure of
    // speech: every itinerary item below was being POSTed to /itinerary/:id
    // when the route is /itinerary/:id/items, so the calls 404ed, nobody
    // looked at the status, and the Itinerary and Today screens were measured
    // empty for months. The screen was catastrophically broken at every phone
    // width and the suite reported it green.
    //
    // So `must` now reads the status of every seeding call and throws. A suite
    // that cannot set up its own subject must fail loudly rather than quietly
    // measure nothing.
    const jar = {};
    const call = api(jar);
    const must = async (m, p, b) => {
      const r = await call(m, p, b);
      if (r.s >= 400) throw new Error(`seeding failed: ${m} ${p} → ${r.s} ${JSON.stringify(r.d)}`);
      return r;
    };
    const up = await call('POST', '/auth/signup', { name: 'Adaeze Okonkwo-Abubakar', email: EMAIL, password: PW });
    if (up.s !== 201) throw new Error('signup failed: ' + up.s + ' ' + JSON.stringify(up.d));
    const who = await call('GET', '/auth/me');
    if (!who.d?.user?.id) throw new Error('no session after signup: ' + who.s + ' ' + JSON.stringify(who.d));
    const me = who.d.user;
    await call('PATCH', '/profile', { slug: `adaeze-${ID}`, timezone: 'Africa/Lagos' });
    await call('POST', '/profile/onboarding-step', { step: 'done' });

    await must('PUT', '/availability', {
      rules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:30' })),
    });
    await must('POST', '/meeting-types', {
      name: 'Quarterly portfolio review with the investment committee',
      durationMinutes: 60, locationType: 'video',
      description: 'A long description of the sort somebody actually writes when they are explaining what the meeting is for.',
    });

    const soon = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
    for (const [title, place, kind, hrs] of [
      ['Board pre-read with the Chief Financial Officer', 'Ikoyi, Lagos — 14 Kingsway Road, 3rd floor', 'meeting', 2],
      ['Call with counsel about the Mauritius structure', 'Video — dial in from anywhere', 'call', 5],
      ['Lunch, Eko Hotel and Suites, Victoria Island', 'Plot 1415 Adetokunbo Ademola Street', 'meal', 8],
      ['Car to Murtala Muhammed International Airport', 'Departing from the Ikoyi residence', 'car', 26],
      ['BA75 to London Heathrow, Terminal 5', 'Murtala Muhammed International, Terminal 1', 'flight', 28],
    ]) {
      await must('POST', `/itinerary/${me.id}/items`, {
        title, kind, location: place,
        startAt: soon(hrs), endAt: soon(hrs + 1), status: 'confirmed',
      });
    }

    await must('POST', `/essentials/${me.id}`, {
      category: 'travel_identity', field: 'passport_number', value: 'A01234821', expiresOn: '2027-03-01',
    });
    await must('POST', `/essentials/${me.id}`, {
      category: 'preferences', field: 'seat_preference', value: 'Aisle, front of cabin, away from the galley',
    });
    await must('POST', `/pa/${me.id}/contacts`, {
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
      ['PA bookings', '/pa?tab=bookings'],
      ['PA calendar', '/pa?tab=calendar'],
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
        if (m.squeezed.length) {
          bad++;
          problems.push({ width: w, screen: name, kind: 'squeezed', who: m.squeezed });
          console.log(`  ✗ ${name} has text crushed too narrow to read`);
          for (const el of m.squeezed) {
            console.log(`      ${el.what}  ${el.width}px, ${el.chars} chars over ${el.lines} lines  "${el.text}"`);
          }
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
    ? '\nEvery screen fits the phone it is held in, and can be read on it.'
    : `\n${fails} FAILED — ${problems.length} problems listed above.`);
  process.exit(fails === 0 ? 0 : 1);
})();
