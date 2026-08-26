// The pad on screen.
//
// The API suite (bpad.js) proves the rules. This proves the thing is reachable
// and that the cheap path is actually cheap: you can write a line from the day
// you were already looking at, without navigating anywhere first. That is the
// whole feature — a capture box you have to go and find is a capture box that
// does not get used.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (t) => console.log(`\n${t}`);

async function onboard(p, name, email, roleLabel) {
  await p.goto(`${BASE}/signup`);
  if (roleLabel) await p.click(`.role-option:has-text("${roleLabel}")`);
  await p.fill('#name', name);
  await p.fill('#email', email);
  await p.fill('#password', PW);
  await p.click('button:has-text("Create account")');
  await p.waitForURL('**/onboarding/profile', { timeout: 20000 });
  await p.fill('#slug', email.split('@')[0]);
  await p.click('button:has-text("Continue")');
  await p.waitForURL('**/onboarding/connect', { timeout: 20000 });
  await p.click('button:has-text("Skip for now")');
  await p.waitForURL(/onboarding\/meeting-type|workspace|today/, { timeout: 20000 });
  if (p.url().includes('meeting-type')) {
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 20000 });
  }
}

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL || '',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let browser = null;
  try {
    // A minute. Twenty seconds is plenty on an idle machine and not plenty on a
    // loaded one, and "no server" on a green tree is a board crying wolf.
    const deadline = Date.now() + 60000;
    for (;;) {
      try { const r = await (await fetch(`${BASE}/api/status`)).json(); if (r.databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const page = await (await browser.newContext()).newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    await onboard(page, 'Adaeze Okonkwo', `boss${ID}@x.com`, 'Principal');

    head('You can write it down without leaving the day:');
    await page.waitForSelector('.pad-jot textarea', { timeout: 20000 });
    await page.fill('.pad-jot textarea', 'Ask the bank about the mandate.');
    await page.click('.pad-jot button:has-text("Note it")');
    await page.waitForSelector('.pad-jot .hint:has-text("On")', { timeout: 20000 });
    ok('a line written from Today is kept', true);

    head('And the pad has it:');
    await page.click('.nav-item:has-text("Pad")');
    await page.waitForURL('**/pad', { timeout: 20000 });
    await page.waitForSelector('.pad-line', { timeout: 20000 });
    const shown = await page.locator('.pad-line').first().innerText();
    ok('the line is on the pad', /mandate/.test(shown), shown.slice(0, 160));
    // The register is words, not a padlock: somebody has to know who can read
    // a line at a glance, and an icon does not answer that.
    ok('and says in words who can see it', /Only me/.test(shown), shown.slice(0, 160));

    head('Writing straight onto the pad works too:');
    await page.fill('.pad-write textarea', 'Call the lawyer about the estate.');
    await page.click('.pad-write button:has-text("Jot it")');
    await page.waitForSelector('.pad-line:has-text("lawyer")', { timeout: 20000 });
    ok('a second line appears', (await page.locator('.pad-line').count()) === 2,
      String(await page.locator('.pad-line').count()));

    head('The verbs are behind one button, not on every line:');
    await page.click('.pad-line:has-text("lawyer") button:has-text("Do something")');
    await page.waitForSelector('.pad-actions', { timeout: 20000 });
    const actions = await page.locator('.pad-actions').first().innerText();
    for (const verb of ['Tomorrow', 'A task', 'Something on the diary', "Somebody else's"]) {
      ok(`“${verb}” is offered`, actions.includes(verb), actions.slice(0, 240));
    }

    head('Coming back to it later:');
    await page.click('.pad-actions button:has-text("Tomorrow")');
    await page.waitForSelector('.pad-line:has-text("back ")', { timeout: 20000 });
    ok('the line says when it will resurface', true);

    head('And a line can be ticked off:');
    await page.click('.pad-line:has-text("mandate") .pad-tick');
    await page.waitForSelector('.pad-line:has-text("mandate")', { state: 'detached', timeout: 20000 });
    ok('it leaves the open list', true);
    await page.click('.tab-btn:has-text("Settled")');
    await page.waitForSelector('.pad-line:has-text("mandate")', { timeout: 20000 });
    ok('and is found under what is settled', true);


    head('Handing a line over actually works from the dropdown:');
    // TESTED THROUGH THE PICKER, NOT THE API. The API was right and the screen
    // was broken: the lookup returned no id, so every name in this list
    // rendered with an empty value — you could choose somebody and nothing was
    // selected, leaving the button dead. An API-only suite passed throughout.
    const mate = await (await browser.newContext()).newPage();
    await onboard(mate, 'Kit Staff', `pa${ID}@x.com`, 'Personal Assistant');

    // Principal invites them, and they accept, so they are genuinely reachable.
    await page.goto(`${BASE}/dashboard?tab=members`);
    await page.waitForSelector('#invite-email', { timeout: 20000 });
    await page.fill('#invite-email', `pa${ID}@x.com`);
    await page.click('button:has-text("Send invite")');
    await page.waitForSelector('.card:has-text("Hasn\'t accepted yet")', { timeout: 20000 });
    ok('the team screen says plainly that nothing is connected yet', true);

    await mate.goto(`${BASE}/today`);
    await mate.waitForSelector('.needs-card:has-text("You have been invited")', { timeout: 20000 });
    ok('and the invitation finds them in the app, not just by email', true);
    await mate.click('.needs-card:has-text("You have been invited") a:has-text("Look at it")');
    await mate.waitForSelector('button:has-text("Accept")', { timeout: 20000 });
    await mate.click('button:has-text("Accept")');
    // Confirms in place rather than navigating, so wait for the words.
    await mate.waitForSelector('h1:has-text("You\'re in")', { timeout: 20000 });

    await page.goto(`${BASE}/pad`);
    await page.waitForSelector('.pad-line', { timeout: 20000 });
    await page.click('.pad-line button:has-text("Do something")');
    await page.waitForSelector('.pad-actions', { timeout: 20000 });
    await page.click('.pad-actions button:has-text("Somebody else\'s")');
    await page.waitForSelector('.pad-action-form select[aria-label="Who it is for"]', { timeout: 20000 });

    const opts = await page.locator('.pad-action-form select[aria-label="Who it is for"] option').count();
    ok('the person is offered in the list', opts === 2, String(opts));
    // The assertion that would have caught it: the option must carry a value.
    const val = await page.locator('.pad-action-form select[aria-label="Who it is for"] option').nth(1).getAttribute('value');
    ok('and the option carries a real value, not an empty one', !!val, String(val));

    await page.selectOption('.pad-action-form select[aria-label="Who it is for"]', val);
    await page.click('.pad-action-form button:has-text("Hand it over")');
    await page.waitForSelector('.pad-line:has-text("handed to Kit Staff")', { timeout: 20000 });
    ok('and handing it over works end to end from the screen', true);

    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));
  } finally {
    if (browser) await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nThe pad is one field away from wherever you are, and the verbs are there when you want them.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
