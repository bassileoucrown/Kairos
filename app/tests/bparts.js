// Choosing which parts of the report you want.
//
// The report was one fixed document: everything, every time. Now it can be
// asked for a part — and the whole risk of that is in two places.
//
//   ASKING FOR A SECTION CANNOT GRANT IT. The custody trail says WHICH
//   document was revealed and when, and it belongs to the account holder
//   alone. `?sections=trail` must not be a way round that, and it must not be
//   a way to find out the section exists either: an unavailable part is
//   ignored exactly as a made-up one is, because "that part exists but is not
//   for you" is itself the disclosure the gate prevents.
//
//   AND A PARTIAL DOCUMENT MUST SAY SO. The export hands somebody a file they
//   can forward. A reader given "Still open now" on its own must be able to
//   tell that the rest was omitted rather than empty, or the file misleads by
//   its shape — the same rule as the partial view of a movement.
//
// The third thing, and the one the owner asked for: naming nothing gets the
// WHOLE report, segmented. An empty selection is the one reading nobody means.
const ROOT = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4664, BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function client() {
  let cookie = '';
  return async function call(method, p, body, raw = false) {
    const r = await fetch(`${BASE}/api${p}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    if (raw) return { s: r.status, t: text, h: r.headers };
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { s: r.status, d: json };
  };
}

/**
 * Press the chips named, then wait for the DOCUMENT THOSE CHIPS DESCRIBE.
 *
 * The chips are client state and redraw at once; the sections under them come
 * from a fetch. Waiting on the chip, on the note, or on `.report-ahead` —
 * which is present both before and after the fetch — reads the previous
 * document and reddens an assertion about the parts for a reason that is
 * really about timing. So this waits for the report request carrying exactly
 * these sections to come back, and then for React to have committed it.
 */
async function choose(page, labels, wanted) {
  const landed = page.waitForResponse(
    (r) => /\/api\/report\//.test(r.url())
      && new URLSearchParams(r.url().split('?')[1] || '').get('sections') === wanted
      && r.status() === 200,
    { timeout: 20000 },
  );
  for (const l of labels) await page.click(`.report-parts button:has-text("${l}")`);
  await landed;
  // The response is not the render. Swallowed rather than thrown so that a
  // document which genuinely never changes still fails on the assertion
  // itself, with the text it actually had.
  await page.waitForFunction(
    (n) => {
      const note = document.querySelector('.report-parts-note');
      return !!note && note.textContent.includes(`Showing ${n} of`);
    },
    wanted.split(',').length,
    { timeout: 5000 },
  ).catch(() => {});
  await page.waitForTimeout(120);
}

async function signUp(call, name, email, category, handle) {
  await call('POST', '/auth/signup', { name, email, password: PW, accountCategory: category });
  await call('PATCH', '/profile', { slug: handle });
  await call('POST', '/profile/onboarding-step', { step: 'done' });
  return (await call('GET', '/auth/me')).d.user;
}

(async () => {
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
    const me = await signUp(boss, 'Adaeze Okonkwo', `boss${ID}@x.com`, 'principal', `boss-${ID}`);

    const cos = client();
    await signUp(cos, 'Ngozi Bello', `ngozi${ID}@x.com`, 'pa', `ngozi-${ID}`);
    let r = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'chief_of_staff' });
    await cos('POST', `/invites/${String(r.d.inviteLink).split('/').pop()}/accept`);

    // Something in the vault, so the trail has a subject to be about.
    await boss('POST', `/essentials/${me.id}`, {
      category: 'travel_identity', field: 'passport_number',
      label: 'Passport', value: 'A05512347',
    });

    // ---- Naming nothing gets everything ---------------------------------
    head('Asking for no particular part gets the whole report:');
    r = await boss('GET', `/report/${me.id}?week=1`);
    ok('the report comes back', r.s === 200, String(r.s));
    ok('and says it is the whole thing', r.d.sectionsWhole === true, String(r.d.sectionsWhole));
    ok('with every part named', Array.isArray(r.d.sections) && r.d.sections.length === 5,
      JSON.stringify(r.d.sections));
    ok('including the trail, for the account holder',
      r.d.sections.includes('trail'), JSON.stringify(r.d.sections));
    ok('and it lists what could be chosen',
      (r.d.sectionsAvailable || []).length === 5,
      JSON.stringify((r.d.sectionsAvailable || []).map((s) => s.id)));
    // The point of the whole feature: the parts are in the document, not
    // merely listed.
    ok('the week ahead is actually built', !!r.d.ahead, String(!!r.d.ahead));

    // ---- Naming one gets one --------------------------------------------
    head('Asking for one part gets that part:');
    r = await boss('GET', `/report/${me.id}?week=1&sections=open`);
    ok('the chosen part is what comes back',
      JSON.stringify(r.d.sections) === JSON.stringify(['open']), JSON.stringify(r.d.sections));
    ok('and it does not claim to be the whole report', r.d.sectionsWhole === false,
      String(r.d.sectionsWhole));
    // Not built, not merely hidden: a section nobody asked for should not cost
    // the queries behind it.
    ok('the week ahead was not built at all', r.d.ahead === null, JSON.stringify(r.d.ahead));
    ok('nor the trail', !r.d.accessTrail, JSON.stringify(r.d.accessTrail));

    r = await boss('GET', `/report/${me.id}?week=1&sections=ahead,office`);
    ok('two parts come back in the report\'s own order, not the order typed',
      JSON.stringify(r.d.sections) === JSON.stringify(['office', 'ahead']),
      JSON.stringify(r.d.sections));

    // Ticking every box by hand is the whole report, and says so.
    r = await boss('GET', `/report/${me.id}?week=1&sections=office,open,trail,ahead,attention`);
    ok('and choosing all of them is the whole report again',
      r.d.sectionsWhole === true, String(r.d.sectionsWhole));

    // ---- The part that must not be a way in ------------------------------
    head('Asking for the trail is not a way to get the trail:');
    r = await cos('GET', `/report/${me.id}?week=1`);
    ok('a chief of staff sees the office', r.s === 200 && r.d.canSeeEveryone === true,
      `${r.s} ${r.d?.canSeeEveryone}`);
    ok('but the trail is not among the parts offered to them',
      !(r.d.sectionsAvailable || []).some((s) => s.id === 'trail'),
      JSON.stringify((r.d.sectionsAvailable || []).map((s) => s.id)));
    ok('nor among the parts of their document',
      !r.d.sections.includes('trail'), JSON.stringify(r.d.sections));

    r = await cos('GET', `/report/${me.id}?week=1&sections=trail`);
    ok('asking for it outright does not deliver it',
      !r.d.accessTrail, JSON.stringify(r.d.accessTrail));
    ok('and it is not named as a part of what they got',
      !r.d.sections.includes('trail'), JSON.stringify(r.d.sections));
    // THE SHAPE MATTERS AS MUCH AS THE CONTENT. A document with nothing in it
    // announces the refusal; falling back to everything they may have does not.
    ok('they get the report they are entitled to rather than an empty one',
      r.d.sections.length === 4, JSON.stringify(r.d.sections));
    // Indistinguishable from a section that does not exist — which is the rule.
    const madeUp = await cos('GET', `/report/${me.id}?week=1&sections=nonsense`);
    ok('and a made-up section is treated identically',
      JSON.stringify(madeUp.d.sections) === JSON.stringify(r.d.sections),
      `${JSON.stringify(madeUp.d.sections)} vs ${JSON.stringify(r.d.sections)}`);

    // ---- Nor is a title a way in ------------------------------------------
    //
    // Accepting an invitation lets somebody correct their own title, which was
    // safe while pa, ea and chief_of_staff carried identical access. They do
    // not any more: a Chief of Staff reads the whole office's line. So the
    // adoption must not be able to change what the title CARRIES, in either
    // direction — account_category is typed at signup and verified by nobody.
    head('A title somebody typed about themselves is not a way into the office:');
    const climber = client();
    await signUp(climber, 'Tunde Bakare', `tunde${ID}@x.com`, 'chief_of_staff', `tunde-${ID}`);
    r = await boss('POST', '/members', { email: `tunde${ID}@x.com`, role: 'pa' });
    ok('somebody is invited as a PA', r.s === 201 && r.d.member.role === 'pa',
      `${r.s} ${r.d?.member?.role}`);
    await climber('POST', `/invites/${String(r.d.inviteLink).split('/').pop()}/accept`);
    r = await climber('GET', `/report/${me.id}?week=1`);
    ok('and describing themselves as chief of staff does not widen what they see',
      r.d.canSeeEveryone === false, String(r.d.canSeeEveryone));
    ok('nor hand them the trail',
      !(r.d.sectionsAvailable || []).some((x) => x.id === 'trail'),
      JSON.stringify((r.d.sectionsAvailable || []).map((x) => x.id)));
    // The other direction is not a leak but it is a decision being discarded:
    // a principal appointed a Chief of Staff and would find a PA.
    const named = (await boss('GET', '/members')).d.members
      .find((m) => m.invitedEmail === `ngozi${ID}@x.com`);
    ok('and an appointment the principal made survives being accepted',
      named && named.role === 'chief_of_staff', JSON.stringify(named && named.role));

    // ---- The file ---------------------------------------------------------
    head('The document carries the same choice, and says what it is:');
    let f = await boss('GET', `/report/${me.id}/export?week=1`, undefined, true);
    ok('the whole document exports', f.s === 200, String(f.s));
    ok('and heads itself as the whole report',
      /The whole report, in 5 sections/.test(f.t), f.t.slice(0, 0) || 'no contents line');
    ok('carrying the office section', /What the office did/.test(f.t));
    ok('and the trail section', /Who looked at what/.test(f.t));

    f = await boss('GET', `/report/${me.id}/export?week=1&sections=open`, undefined, true);
    ok('a part exports', f.s === 200, String(f.s));
    ok('and says on its face that it is a part',
      /Part of the report/.test(f.t), 'no part line');
    ok('with the section it carries', /Still open now/.test(f.t));
    ok('and without the ones it does not', !/What the office did/.test(f.t));
    ok('nor the trail', !/Who looked at what/.test(f.t));
    // A downloads folder full of identically-named files is its own problem.
    ok('the file names itself after the part',
      /filename="kairos-[^"]*-open\.html"/.test(f.h.get('content-disposition') || ''),
      f.h.get('content-disposition'));

    f = await boss('GET', `/report/${me.id}/export?week=1&sections=open&format=csv`, undefined, true);
    ok('the spreadsheet honours it too',
      /Still open now/.test(f.t) && !/Appointments made/.test(f.t), f.t.slice(0, 120));
    ok('and heads itself the same way', /Part of the report/.test(f.t));

    // The export is where a copied access rule would do the most damage.
    // ASSERTED ON THE TRAIL'S OWN COLUMNS, not on its heading. The heading also
    // appears in the contents line that every document carries, so matching on
    // it conflates "the section is here" with "the section is listed" — a
    // sabotage run reddened this for the wrong one of those two reasons, which
    // is exactly how an assertion passes for the wrong reason later.
    f = await cos('GET', `/report/${me.id}/export?week=1&sections=trail`, undefined, true);
    ok('and a chief of staff cannot export the trail by naming it',
      !/Did what/.test(f.t) && !/<h2>Who looked at what<\/h2>/.test(f.t),
      'trail content present in their file');

    // ---- The screen -------------------------------------------------------
    //
    // Everything above would pass with no picker anywhere in the client — a
    // feature that works and that nobody can reach. This half only asks
    // whether the chips are on the screen the register says they are on, and
    // whether the document under them tells the truth about itself.
    //
    // THE HEADING IS PART OF THE DOCUMENT. Two of the five parts are drawn by
    // one component, because one fetch computes both. A heading that outlives
    // the section under it — "The week ahead" over an omitted week — is the
    // same defect as an export that drops a section silently, and it reads as
    // a week with nothing in it rather than a week nobody asked about. The
    // other direction is worse: "Nothing is sitting untouched" is a verdict,
    // and a report that was not asked to look has not earned one.
    head('The picker is on the screen, and the document under it says what it is:');
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } }))
      .newPage();
    const threw = [];
    page.on('pageerror', (e) => threw.push(e.message));

    await page.goto(`${BASE}/login`);
    await page.fill('input[type=email]', `boss${ID}@x.com`);
    await page.fill('input[type=password]', PW);
    await page.click('button[type=submit]');
    await page.waitForSelector('nav', { timeout: 20000 });
    await page.goto(`${BASE}/report`);
    await page.waitForSelector('.report-parts button', { timeout: 20000 });

    const chips = await page.locator('.report-parts button').allInnerTexts();
    ok('every part the account holder may have is offered, and the whole with them',
      chips.length === 6 && chips[0] === 'All of it'
      && chips.includes('Who looked at what'), JSON.stringify(chips));
    ok('and the whole report is what is chosen before anybody touches it',
      (await page.locator('.report-parts button[aria-pressed="true"]').innerText()) === 'All of it',
      await page.locator('.report-parts button[aria-pressed="true"]').innerText());

    // POSITIVE CONTROL for the two negatives below: both headings are here
    // when the whole report is, so their absence later is the gating rather
    // than a section that never rendered.
    const ahead = page.locator('.report-ahead');
    await ahead.waitFor({ timeout: 20000 });
    ok('the whole report carries the week ahead heading',
      /The week ahead/.test(await ahead.innerText()), (await ahead.innerText()).slice(0, 80));
    ok('and the attention line under it',
      /sitting untouched|Needs attention/.test(await ahead.innerText()),
      (await ahead.innerText()).slice(0, 160));

    // ONE PART, ON SCREEN.
    await choose(page, ['Still open now'], 'open');
    ok('picking one part says how many of how many',
      /Showing 1 of 5 parts/.test(await page.locator('.report-parts-note').innerText()),
      await page.locator('.report-parts-note').innerText());
    ok('and the week ahead leaves the screen with it',
      (await page.locator('.report-ahead').count()) === 0,
      `report-ahead still drawn ${await page.locator('.report-ahead').count()}×`);
    ok('as does the trail',
      (await page.locator('.report-trail').count()) === 0,
      `report-trail still drawn ${await page.locator('.report-trail').count()}×`);

    // THE HEADING THAT MUST NOT OUTLIVE ITS SECTION.
    await choose(page, ['Still open now', 'Needs attention'], 'attention');
    let face = await page.locator('.report-ahead').innerText();
    ok('asking for attention alone puts no week-ahead heading over it',
      !/The week ahead/.test(face), face.slice(0, 200));
    ok('and still says what it found, headed as itself',
      /Needs attention/.test(face), face.slice(0, 200));

    // AND THE VERDICT THAT MUST NOT BE VOLUNTEERED.
    await choose(page, ['Needs attention', 'The week ahead'], 'ahead');
    face = await page.locator('.report-ahead').innerText();
    ok('asking for the week alone delivers no verdict on what is untouched',
      !/sitting untouched/.test(face) && !/Needs attention/.test(face), face.slice(0, 200));
    ok('though the week itself is there',
      /The week ahead/.test(face), face.slice(0, 120));

    ok('and nothing threw while the parts were being picked',
      threw.length === 0, JSON.stringify(threw));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nThe report can be asked for in parts, and a part says that it is one.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
