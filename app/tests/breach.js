// Everything a tester has to be able to REACH.
//
// WHY THIS FILE EXISTS SEPARATELY FROM bputaway. That suite proves the rules
// hold — what archiving does, what deleting takes, who may do which. Every one
// of its assertions passed while the buttons for half of it did not exist on
// any screen, which is a suite proving a feature that nobody can use.
//
// This one only asks: can a person sitting in front of the app do it. It
// clicks, it types into the confirmations, and it reads the screen afterwards.
// A rule with no way in is not shipped, and a green board that says otherwise
// is the board lying.
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

async function onboard(p, name, email) {
  await p.goto(`${BASE}/signup`);
  await p.click('.role-option:has-text("Principal")');
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

/** Answer the confirmation dialog, which is the same one everywhere. */
async function confirmWith(page, text) {
  await page.waitForSelector('#ask-input', { timeout: 20000 });
  await page.fill('#ask-input', text);
  await page.click('.ask-actions button[type="submit"]');
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
    const deadline = Date.now() + 150000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await onboard(page, 'Adaeze Okonkwo', `ada${ID}@x.com`);

    // A room with something in it, built through the API so this file spends
    // its time on the controls rather than on setup.
    const made = await page.evaluate(async () => {
      const post = async (p, b) => (await fetch(`/api${p}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        credentials: 'include', body: JSON.stringify(b),
      })).json();
      const space = await post('/spaces', { name: 'The office', context: 'work' });
      const spaceId = space.space.id;
      const thread = await post(`/spaces/${spaceId}/threads`, { name: 'Board pack' });
      await post(`/threads/${thread.thread.id}/messages`, { body: 'Printer confirmed', register: 'note' });
      await post(`/threads/${thread.thread.id}/messages`,
        { body: 'The board approved the agenda', register: 'record', recordType: 'decision' });
      const project = await post(`/spaces/${spaceId}/projects`, { name: 'Ikoyi refurbishment' });
      await post(`/projects/${project.project.id}/stages`, { name: 'Design' });
      // Assigned to the principal, because My Tasks is "everything assigned to
      // me" — an unassigned task would simply not be on the screen under test.
      const me = await (await fetch('/api/auth/me', { credentials: 'include' })).json();
      const task = await post('/tasks',
        { spaceId, title: 'Circulate the pack', assigneeId: me.user.id });
      await post('/tasks', { spaceId, title: 'Print two copies', parentTaskId: task.task.id });
      return { spaceId, threadId: thread.thread.id, projectId: project.project.id };
    });

    // ---- A task -------------------------------------------------------------
    head('A task can be put away and thrown out, from the list it is on:');
    // My Tasks: the one list an assistant lives in, and the one that had no
    // way to archive or delete anything on it.
    await page.goto(`${BASE}/tasks`);
    await page.waitForSelector('.task-list', { timeout: 20000 });
    ok('the archive button is on the row',
      (await page.locator('button[aria-label="Archive Circulate the pack"]').count()) === 1);
    await page.click('button[aria-label="Archive Circulate the pack"]');
    await page.waitForFunction(
      () => !/Circulate the pack/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('pressing it takes the task off the list', true);

    await page.goto(`${BASE}/archive`);
    await page.waitForSelector('.ess-row', { timeout: 20000 });
    ok('and it is on the shelf, where a person would look',
      /Circulate the pack/.test(await page.locator('body').innerText()));
    // THE WAY BACK. A shelf you cannot reach onto is a bin.
    await page.locator('.ess-row', { hasText: 'Circulate the pack' })
      .locator('button:has-text("Take back out")').click();
    await page.waitForFunction(
      () => !/Circulate the pack/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('and it can be taken back out from there', true);

    // THE REGRESSION THIS FILE WOULD HAVE CAUGHT. Deleting a task with steps
    // began refusing without a count, and this button sent none — so it did
    // nothing at all, silently, for exactly the tasks with work underneath.
    await page.goto(`${BASE}/tasks`);
    await page.waitForSelector('.task-list', { timeout: 20000 });
    await page.click('button[aria-label="Delete Circulate the pack"]');
    await page.waitForSelector('#ask-input', { timeout: 20000 });
    const askedAbout = await page.locator('.ask-card').innerText();
    ok('deleting one with steps says how many go', /1 step/.test(askedAbout), askedAbout.slice(0, 160));
    await confirmWith(page, '1');
    await page.waitForFunction(
      () => !/Circulate the pack/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('and naming the count goes through', true);

    // ---- A conversation -----------------------------------------------------
    head('A conversation can be destroyed, and says what survives first:');
    await page.goto(`${BASE}/spaces/${made.spaceId}`);
    await page.waitForSelector('.thread-row, .space-card', { timeout: 20000 });
    await page.click('button[aria-label="Delete Board pack"]');
    await page.waitForSelector('#ask-input', { timeout: 20000 });
    const threadAsk = await page.locator('.ask-card').innerText();
    // THE SENTENCE THAT MAKES THIS SAFE TO PRESS.
    ok('it says the records are kept', /kept in the Archive/i.test(threadAsk), threadAsk.slice(0, 200));
    ok('and how many messages go', /2 messages/.test(threadAsk), threadAsk.slice(0, 200));
    // The wrong name is refused, by the server as well as the screen.
    await confirmWith(page, 'board pack');
    await page.waitForTimeout(400);
    ok('the wrong name does not delete it',
      /Board pack/.test(await page.locator('body').innerText()));

    await page.click('button[aria-label="Delete Board pack"]');
    await confirmWith(page, 'Board pack');
    await page.waitForFunction(
      () => !/Board pack/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('the name typed exactly does', true);

    await page.goto(`${BASE}/archive`);
    await page.waitForSelector('.card', { timeout: 20000 });
    ok('and the decision outlived the room, on the shelf',
      /approved the agenda/.test(await page.locator('body').innerText()));

    // ---- A project ----------------------------------------------------------
    head('A project can be put away and removed:');
    await page.goto(`${BASE}/projects/${made.projectId}`);
    await page.waitForSelector('button:has-text("Archive")', { timeout: 20000 });
    await page.click('button:has-text("Archive")');
    await page.waitForSelector('button:has-text("Take out of the archive")', { timeout: 20000 });
    ok('archiving it offers the way back rather than a dead end', true);
    await page.click('button:has-text("Take out of the archive")');
    await page.waitForSelector('button:has-text("Delete")', { timeout: 20000 });

    await page.click('button:has-text("Delete")');
    await page.waitForSelector('#ask-input', { timeout: 20000 });
    const projectAsk = await page.locator('.ask-card').innerText();
    ok('deleting says what goes with it', /1 stage/.test(projectAsk), projectAsk.slice(0, 200));
    await confirmWith(page, '1');
    await page.waitForURL(`**/spaces/${made.spaceId}`, { timeout: 20000 });
    ok('and it lands back in the room it was in', true);

    // ---- A room -------------------------------------------------------------
    head('And the room itself can be put away rather than burned down:');
    await page.waitForSelector('button:has-text("Put away")', { timeout: 20000 });
    ok('the gentle verb is offered beside the destructive one',
      (await page.locator('button:has-text("Close space")').count()) === 1);
    await page.click('button:has-text("Put away")');
    await page.waitForSelector('button:has-text("Bring back")', { timeout: 20000 });
    ok('and putting it away offers to bring it back', true);

    await page.goto(`${BASE}/spaces`);
    await page.waitForSelector('.app-body', { timeout: 20000 });
    await page.waitForFunction(
      () => !/The office/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('it leaves the rooms list', true);

    await page.goto(`${BASE}/archive`);
    await page.waitForSelector('.ess-row', { timeout: 20000 });
    ok('and is findable on the shelf',
      /The office/.test(await page.locator('body').innerText()));

    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    proc.kill();
  }

  console.log(fails === 0
    ? '\nEverything that can be put away or thrown out can be reached by hand.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
