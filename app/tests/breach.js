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

    // ---- Saying you are not available ---------------------------------------
    //
    // The feature worked and had no screen, which made "I can choose to be
    // unavailable" true of the system and false of the person using it.
    head('And a principal can take time off the table, by hand:');
    await page.goto(`${BASE}/dashboard?tab=availability`);
    await page.waitForSelector('button:has-text("The next 2 hours")', { timeout: 20000 });
    ok('every length is offered, not just a date range',
      (await page.locator('button:has-text("All day tomorrow")').count()) === 1
      && (await page.locator('button:has-text("The next 7 days")').count()) === 1);

    await page.fill('#na-reason', 'Funeral');
    await page.click('button:has-text("All day tomorrow")');
    await page.waitForFunction(
      () => /Funeral/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('blocking a day says so afterwards, with the reason', true);

    // THE ASSERTION THAT MATTERS MOST HERE. A block that does not take the
    // time off the diary is a note to nobody.
    const blockedOut = await page.evaluate(async () => {
      const me = await (await fetch('/api/auth/me', { credentials: 'include' })).json();
      const r = await (await fetch(`/api/itinerary/${me.user.id}/unavailable`,
        { credentials: 'include' })).json();
      return (r.blocks || []).length;
    });
    ok('and the diary is holding it', blockedOut === 1, String(blockedOut));

    await page.locator('.ess-row', { hasText: 'Funeral' })
      .locator('button:has-text("Lift")').click();
    await page.waitForFunction(
      () => !/Funeral/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('and it can be lifted again', true);

    // ---- A journey that is nobody else's business ---------------------------
    head('And a principal can keep a journey to themselves:');
    await page.evaluate(async () => {
      const me = await (await fetch('/api/auth/me', { credentials: 'include' })).json();
      await fetch(`/api/trips/${me.user.id}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          name: 'Sallah with the family', destination: 'Kaduna',
          startsOn: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
          endsOn: new Date(Date.now() + 34 * 86400000).toISOString().slice(0, 10),
          status: 'confirmed',
        }),
      });
    });
    await page.goto(`${BASE}/trips`);
    await page.waitForSelector('.card', { timeout: 20000 });
    await page.locator('.card', { hasText: 'Sallah with the family' }).first().click();
    await page.waitForSelector('button:has-text("Make it private")', { timeout: 20000 });
    ok('the switch is on the trip, for the principal', true);

    await page.click('button:has-text("Make it private")');
    await page.waitForSelector('button:has-text("Let the office see it")', { timeout: 20000 });
    ok('making it private says what that means', true);
    // WAITED FOR, NOT READ INSTANTLY. The button above renders as soon as the
    // trip is private; the "Who knows" panel below it has two more requests to
    // make first. Reading the page between those two moments passed on SQLite
    // and failed roughly one run in three on Postgres, which is slower — the
    // recurring shape in this suite, where the thing waited on exists before
    // the thing asserted does.
    const asked = await page
      .waitForFunction(() => /Who knows/.test(document.body.innerText), null, { timeout: 20000 })
      .then(() => true).catch(() => false);
    ok('and asks who should be told anyway', asked,
      (await page.locator('body').innerText()).slice(0, 200));

    // ---- An open record on the report, followed to the record --------------
    //
    // The report said "1 record nobody has answered" and stopped there, which
    // told the reader they had a problem and left them to go hunting through
    // rooms for it — the exact work the screen exists to save.
    head('An unanswered record on the report leads to the record:');
    const room = await page.evaluate(async () => {
      const post = async (p, b) => (await fetch(`/api${p}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        credentials: 'include', body: JSON.stringify(b),
      })).json();
      const space = await post('/spaces', { name: 'The board', context: 'work' });
      const thread = await post(`/spaces/${space.space.id}/threads`, { name: 'Q3 budget' });
      // An approval opens as 'open' and nobody has answered it.
      await post(`/threads/${thread.thread.id}/messages`,
        { body: 'Approved: the Ikoyi overspend', register: 'note' });
      return { threadId: thread.thread.id };
    });

    await page.goto(`${BASE}/report`);
    await page.waitForSelector('.report-open', { timeout: 20000 });
    const openText = await page.locator('.report-open').innerText();
    ok('the report still says how many are open',
      /nobody has answered/.test(openText), openText.slice(0, 200));
    // THE ASSERTION THIS SECTION EXISTS FOR: the line itself, not just a count.
    ok('and shows the line rather than only a number',
      /Ikoyi overspend/.test(openText), openText.slice(0, 240));

    await page.locator('.report-open-list a').first().click();
    await page.waitForURL(`**/threads/${room.threadId}**`, { timeout: 20000 });
    ok('clicking it opens the room it is in', true);
    // Landing at the foot of a room with a hundred messages is not landing on
    // the record. The app already deep-links to a message; this proves the
    // report uses it.
    ok('at the record itself, not the top of the thread',
      page.url().includes('#m-'), page.url());
    await page.waitForFunction(
      () => /Ikoyi overspend/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('and the record is on the screen', true);

    // ---- Taking the report away ---------------------------------------------
    head('And the report can be taken away as a file:');
    await page.goto(`${BASE}/report`);
    await page.waitForSelector('.report-download', { timeout: 20000 });
    ok('the week ahead is on the screen',
      (await page.locator('.report-ahead').count()) === 1);
    ok('with what needs attention, or the fact that nothing does',
      /Needs attention|Nothing is sitting untouched/.test(
        await page.locator('.report-ahead').innerText()));

    // A link is not a download. Chrome will happily navigate to a URL that
    // returns an error page, and the assertion "the link is there" would pass
    // for a broken route — so this waits for the browser to actually save a
    // file and reads the name it was given.
    const [file] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('.report-download a:has-text("Document")'),
    ]);
    ok('clicking Document saves a file', !!file);
    ok('named for the principal and the week',
      /^kairos-.+-\d{4}-\d{2}-\d{2}\.html$/.test(file.suggestedFilename()),
      file.suggestedFilename());

    const [sheet] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('.report-download a:has-text("Spreadsheet")'),
    ]);
    ok('and Spreadsheet saves a csv', /\.csv$/.test(sheet.suggestedFilename()),
      sheet.suggestedFilename());

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
