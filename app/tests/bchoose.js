// Choosing your own handle, and nobody choosing one for you.
//
// Signing up used to take a handle made out of your name — @adaeze-okonkwo —
// write it into handle_history, where a handle stays FOR GOOD, and then offer
// it back on the profile screen as the value already in the box. Two separate
// faults, and this suite holds both shut.
//
//   A NAME NOBODY CHOSE WAS SPENT FOREVER. handle_history is the record that
//   stops a released handle being inherited by a stranger, which means a row
//   written into it is a name taken out of the world permanently. Writing one
//   on somebody's behalf, before they had said a word, burnt @adaeze-okonkwo
//   for every future Adaeze Okonkwo the moment this one chose @ada instead.
//
//   AND A FILLED BOX IS A DECISION ALREADY MADE. People accept what is in
//   front of them. The one field on that screen that has to be a choice was
//   the one arriving pre-answered.
//
// THE HARD PART IS THE NEGATIVE, and it is checked positively wherever it can
// be: that the provisional handle is not in the history is proved by showing a
// SECOND account can still claim the name the first one was carrying. An
// assertion that a row is absent passes just as well when the table was never
// written to at all.
//
// The gate is checked on the wire rather than in the browser. `required` on an
// input is a courtesy; the step is advanced by a request, and a request can be
// made without the form.
const ROOT = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4661, BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function client() {
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
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { s: r.status, d: json };
  };
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
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  let browser = null;
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    // ---- Nothing is chosen for you --------------------------------------
    head('Signing up chooses no handle on your behalf:');
    const a = client();
    let r = await a('POST', '/auth/signup', {
      name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal',
    });
    ok('the account is made', r.s === 201, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);

    const first = r.d.user;
    ok('and it says no handle has been chosen', first.handleChosen === false,
      JSON.stringify({ slug: first.slug, chosen: first.handleChosen }));
    // The specific thing that was wrong: the handle was their name.
    ok('the handle it is carrying is not made out of their name',
      !/adaeze|okonkwo/i.test(first.slug), first.slug);
    ok('and is visibly provisional', /^new-[0-9a-f]{8}$/.test(first.slug), first.slug);

    // ---- And it is not spent -------------------------------------------
    //
    // The positive control for "it was never written to handle_history": if it
    // had been, this second account could never take the name.
    head('The name they did not choose is still there for somebody else:');
    const b = client();
    r = await b('POST', '/auth/signup', {
      name: 'Adaeze Okonkwo', email: `ada2${ID}@x.com`, password: PW, accountCategory: 'principal',
    });
    ok('a second Adaeze Okonkwo can sign up', r.s === 201, String(r.s));
    r = await b('GET', `/profile/handle-available?handle=adaeze-okonkwo`);
    ok('and adaeze-okonkwo is free for her to take',
      r.d?.available === true, JSON.stringify(r.d));
    r = await b('PATCH', '/profile', { slug: 'adaeze-okonkwo' });
    ok('and she takes it', r.s === 200 && r.d.user.slug === 'adaeze-okonkwo',
      `${r.s} ${r.d?.user?.slug || r.d?.error}`);
    ok('which the account now calls chosen', r.d.user.handleChosen === true);

    // ---- Nobody may carry a provisional on purpose ----------------------
    head('The provisional shape is nobody\'s to keep:');
    r = await a('PATCH', '/profile', { slug: first.slug });
    ok('not even the account carrying one can claim it', r.s === 400 || r.s === 409,
      `${r.s} ${JSON.stringify(r.d)}`);
    r = await a('GET', '/profile/handle-available?handle=new-0123abcd');
    ok('and it is never reported free', r.d?.available === false, JSON.stringify(r.d));

    // ---- The check ------------------------------------------------------
    head('Whether a handle is free can be asked before pressing the button:');
    r = await a('GET', '/profile/handle-available?handle=adaeze-okonkwo');
    ok('a taken one comes back taken', r.d?.available === false, JSON.stringify(r.d));
    // The same sentence whether somebody holds it now or held it in 2023 —
    // "somebody used to have that" is a fact about a stranger's account.
    ok('in the words claimHandle uses, saying nothing about who',
      r.d?.problem === 'That handle is already taken.', String(r.d?.problem));
    r = await a('GET', '/profile/handle-available?handle=ada-o');
    ok('a free one comes back free', r.d?.available === true, JSON.stringify(r.d));
    r = await a('GET', '/profile/handle-available?handle=admin');
    ok('a reserved one is refused as reserved', r.d?.available === false, JSON.stringify(r.d));
    r = await a('GET', '/profile/handle-available?handle=x');
    ok('and one too short says so rather than "taken"',
      r.d?.available === false && /3 characters/.test(r.d?.problem || ''), String(r.d?.problem));

    // Never an open directory: it exists to be polite about a name somebody is
    // typing, not to let the world enumerate who is here.
    const anon = client();
    r = await anon('GET', '/profile/handle-available?handle=ada-o');
    ok('a stranger cannot ask at all', r.s === 401, String(r.s));

    // ---- The gate -------------------------------------------------------
    head('Registration does not go on without one:');
    r = await a('POST', '/profile/onboarding-step', { step: 'connect' });
    ok('the step is refused while the handle is still provisional',
      r.s === 400, `${r.s} ${JSON.stringify(r.d)}`);
    ok('and says what to do about it',
      /choose a handle/i.test(r.d?.error || ''), String(r.d?.error));

    r = await a('PATCH', '/profile', { slug: `ada-${ID}` });
    ok('choosing one is accepted', r.s === 200, `${r.s} ${JSON.stringify(r.d).slice(0, 100)}`);
    r = await a('POST', '/profile/onboarding-step', { step: 'connect' });
    ok('and then the step goes through', r.s === 200, `${r.s} ${JSON.stringify(r.d)}`);

    // ---- On the screen --------------------------------------------------
    head('And the box on the profile screen is empty:');
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const p = await (await browser.newContext()).newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));

    await p.goto(`${BASE}/signup`);
    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Chidinma Eze');
    await p.fill('#email', `chi${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 20000 });

    ok('the handle field starts empty', await p.inputValue('#slug') === '',
      await p.inputValue('#slug'));
    // The specific old behaviour, named: it is not that it is empty by
    // accident, it is that their name is not in it.
    ok('with nothing made out of their name in it',
      !/chidinma|eze/i.test(await p.inputValue('#slug')));
    ok('and Continue is not pressable yet',
      await p.locator('button:has-text("Continue")').isDisabled());

    await p.fill('#slug', 'adaeze-okonkwo');
    await p.waitForSelector('.handle-taken', { timeout: 10000 });
    ok('a taken handle says so while they type',
      /already taken/i.test(await p.locator('.handle-taken').innerText()));

    await p.fill('#slug', `chi-${ID}`);
    await p.waitForSelector('.handle-free', { timeout: 10000 });
    ok('and a free one says that instead',
      /is free/.test(await p.locator('.handle-free').innerText()));

    ok('now Continue is pressable', !await p.locator('button:has-text("Continue")').isDisabled());
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/connect', { timeout: 20000 });
    ok('and it goes on', true);
    ok('nothing threw', errs.length === 0, errs.join(' | '));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    proc.kill();
  }

  console.log(fails === 0
    ? '\nEverybody chooses their own handle, and nothing is chosen for them.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
