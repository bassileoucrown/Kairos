// A stage that holds work, and a task you can break into steps.
//
// TWO COMPLAINTS, ONE SHAPE. "What is the function of a stage if it stands
// alone?" — it never did stand alone in the data, but the project screen drew
// the stages in one box and every task in a second flat one, so nothing on
// screen showed a task belonging to a stage. Worse, the box that added tasks
// on that very screen sent no stage at all, so tasks made there belonged to
// none of them. The model supported it; the product did not offer it.
//
// And a task had no way to say how it was going to get done, which is what
// steps are for.
//
// The three worth watching hardest are the ones that widen or lose access:
//
//   A STAGE ID IS A WAY INTO A PROJECT. Naming a stage decides the task's
//   space, so a stage in a space the caller cannot reach must be refused —
//   otherwise a stage id is a door into somebody else's office.
//
//   ONE LEVEL. A step cannot have steps, or a list of work becomes a tree
//   nobody can see the shape of.
//
//   A DONE TASK MUST NOT LIE. A task ticked done with three steps still open
//   is two records of one fact, and two records of one fact always disagree.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4581, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

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
    return { s: r.status, d: json, cookie };
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

  let browser;
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    const bossCookie = up.cookie;
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const pa = client();
    const paUp = await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    const paId = paUp.d.user.id;
    await pa('PATCH', '/profile', { slug: `ngozi-${ID}` });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    const invite = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${invite.d.inviteLink.split('/').pop()}/accept`);

    const space = await boss('POST', '/spaces', { name: `Office ${ID}`, context: 'work' });
    const spaceId = space.d.space.id;
    const project = await boss('POST', `/spaces/${spaceId}/projects`, { name: 'Lagos office move' });
    const projectId = project.d.project.id;
    const lease = await boss('POST', `/projects/${projectId}/stages`, { name: 'Lease' });
    const fitOut = await boss('POST', `/projects/${projectId}/stages`, { name: 'Fit-out' });
    const leaseId = lease.d.stages?.find((s) => s.name === 'Lease')?.id
      || lease.d.stage?.id;
    const fitOutId = fitOut.d.stages?.find((s) => s.name === 'Fit-out')?.id
      || fitOut.d.stage?.id;
    ok('a project with two stages exists', !!leaseId && !!fitOutId,
      `${leaseId} / ${fitOutId}`);

    // ---- A task belongs to a stage ----------------------------------------
    head('A task added to a stage belongs to it:');
    let r = await boss('POST', '/tasks', { stageId: leaseId, title: 'Get the survey back' });
    ok('naming the stage is enough', r.s === 201, JSON.stringify(r.d).slice(0, 160));
    const surveyId = r.d.task.id;
    ok('and it is on that stage', r.d.task.stageId === leaseId, r.d.task.stageId);
    // The stage names its own project, so asking for both is asking for two
    // answers to one question — and the pair can disagree.
    ok('and on the stage\'s project without being told',
      r.d.task.projectId === projectId, r.d.task.projectId);
    ok('and in the stage\'s space without being told',
      r.d.task.spaceId === spaceId, r.d.task.spaceId);

    // THE ONE THAT WIDENS ACCESS. Naming a stage decides the task's space, so
    // a stage in a space the caller cannot reach is a door into it.
    const stranger = client();
    await stranger('POST', '/auth/signup',
      { name: 'Chidi Eze', email: `chidi${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await stranger('POST', '/profile/onboarding-step', { step: 'done' });
    r = await stranger('POST', '/tasks', { stageId: leaseId, title: 'Slip this in' });
    ok('a stranger cannot file work on somebody else\'s stage',
      r.s === 404, `${r.s} ${JSON.stringify(r.d)}`);
    // Their own space plus another office's stage: the pair must be refused
    // rather than one of them quietly winning.
    const theirs = await stranger('POST', '/spaces', { name: `Theirs ${ID}`, context: 'work' });
    r = await stranger('POST', '/tasks',
      { spaceId: theirs.d.space.id, stageId: leaseId, title: 'Nor this way' });
    ok('nor by naming their own space alongside it', r.s === 400 || r.s === 404,
      `${r.s} ${JSON.stringify(r.d)}`);

    head('And it can be moved to another stage:');
    r = await boss('PATCH', `/tasks/${surveyId}`, { stageId: fitOutId });
    ok('the move is accepted', r.s === 200, JSON.stringify(r.d).slice(0, 120));
    ok('and it lands on the other stage', r.d.task.stageId === fitOutId, r.d.task.stageId);
    r = await boss('PATCH', `/tasks/${surveyId}`, { stageId: leaseId });
    ok('and back', r.d.task.stageId === leaseId);
    r = await boss('PATCH', `/tasks/${surveyId}`, { stageId: null });
    ok('and off every stage, which is a real answer', r.d.task.stageId === null);
    await boss('PATCH', `/tasks/${surveyId}`, { stageId: leaseId });

    // ---- Steps ------------------------------------------------------------
    head('A task can be broken into steps:');
    r = await boss('POST', '/tasks', { parentTaskId: surveyId, title: 'Email the surveyor' });
    ok('a step is accepted', r.s === 201, JSON.stringify(r.d).slice(0, 160));
    const step1 = r.d.task.id;
    ok('and knows whose step it is', r.d.task.parentTaskId === surveyId);
    // A step belongs where its task belongs. Two rows answering "which stage
    // is this work on" is two rows that will disagree.
    ok('and inherits the stage rather than being asked for one',
      r.d.task.stageId === leaseId, r.d.task.stageId);

    // A STEP IS A TASK. It gets given to somebody the same way anything else
    // does — which is the whole reason this is not a checklist row.
    r = await boss('POST', '/tasks',
      { parentTaskId: surveyId, title: `Chase them @ngozi-${ID}` });
    const step2 = r.d.task.id;
    ok('and can be handed to somebody by name',
      r.d.task.assigneeId === paId, JSON.stringify(r.d.task.assigneeId));

    head('The stage\'s list shows tasks, not a flat pile of steps:');
    r = await boss('GET', `/tasks?stageId=${leaseId}`);
    ok('one row, not three', r.d.tasks.length === 1,
      JSON.stringify(r.d.tasks.map((t) => t.title)));
    ok('with its steps hanging under it', r.d.tasks[0].subtasks.length === 2,
      JSON.stringify(r.d.tasks[0].subtasks.map((t) => t.title)));
    ok('and a count to read at a glance',
      r.d.tasks[0].steps.total === 2 && r.d.tasks[0].steps.done === 0,
      JSON.stringify(r.d.tasks[0].steps));

    // MY TASKS DOES THE OPPOSITE, deliberately. A step assigned to you IS your
    // work, and the one list that answers "what have I got" must not hide it
    // because somebody filed it inside something.
    head('But the list of what you personally have does show them:');
    r = await pa('GET', '/tasks/mine');
    const mine = r.d.tasks.find((t) => t.id === step2);
    ok('a step you were given is on your list', !!mine,
      JSON.stringify(r.d.tasks.map((t) => t.title)));
    ok('and says what it is part of', mine?.parentTitle === 'Get the survey back',
      mine?.parentTitle);

    head('One level, and no deeper:');
    r = await boss('POST', '/tasks', { parentTaskId: step1, title: 'A step of a step' });
    ok('a step cannot have steps of its own', r.s === 400, `${r.s} ${JSON.stringify(r.d)}`);
    ok('and says what to do instead', /task of its own/i.test(r.d?.error || ''), r.d?.error);
    r = await boss('PATCH', `/tasks/${step1}`, { stageId: fitOutId });
    ok('nor can a step wander onto another stage alone', r.s === 400, String(r.s));

    head('Finishing the task finishes its steps:');
    r = await boss('PATCH', `/tasks/${surveyId}`, { status: 'done' });
    ok('the task closes', r.d.task.status === 'done');
    // A task ticked done with steps still open is two records of one fact.
    ok('and says how many steps went with it', r.d.closedSteps === 2, String(r.d.closedSteps));
    r = await boss('GET', `/tasks?stageId=${leaseId}`);
    ok('none of them are left open',
      r.d.tasks[0].subtasks.every((k) => k.status === 'done'),
      JSON.stringify(r.d.tasks[0].subtasks.map((k) => k.status)));
    // NOT THE REVERSE. Which steps came undone is a thing only the person
    // reopening it knows, and guessing hands back work genuinely completed.
    r = await boss('PATCH', `/tasks/${surveyId}`, { status: 'open' });
    r = await boss('GET', `/tasks?stageId=${leaseId}`);
    ok('but reopening the task does not reopen them',
      r.d.tasks[0].subtasks.every((k) => k.status === 'done'),
      JSON.stringify(r.d.tasks[0].subtasks.map((k) => k.status)));

    head('Deleting the task takes its steps with it:');
    await boss('DELETE', `/tasks/${surveyId}`);
    r = await boss('GET', `/tasks?spaceId=${spaceId}`);
    const loose = r.d.tasks.filter((t) => /surveyor|Chase them/.test(t.title));
    ok('no orphans left loose in the space', loose.length === 0,
      JSON.stringify(r.d.tasks.map((t) => t.title)));

    // ---- On screen --------------------------------------------------------
    head('And the project screen files the work under the stage:');
    const keep = await boss('POST', '/tasks', { stageId: leaseId, title: 'Read the lease' });
    await boss('POST', '/tasks', { parentTaskId: keep.d.task.id, title: 'Ask about the break clause' });
    // Deliberately stageless: a task made from a message in the project's own
    // thread arrives with none, and the screen must not hide it or guess.
    await boss('POST', '/tasks', { spaceId, projectId, title: 'Something nobody has placed' });

    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const [k, v] = bossCookie.split(';')[0].split('=');
    await ctx.addCookies([{ name: k, value: v, domain: '127.0.0.1', path: '/' }]);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    await page.goto(`${BASE}/projects/${projectId}`);
    await page.waitForSelector('.stage-row', { timeout: 20000 });
    // BY THE STAGE'S OWN NAME, not by the row's text. Every task row now
    // carries a dropdown listing every stage in the project, and a <select>'s
    // options count as text — so hasText: 'Fit-out' matched the Lease row,
    // which is a measurement error that would have read as the grouping being
    // broken.
    const stageRow = (name) => page.locator('.stage-row')
      .filter({ has: page.locator('.stage-name', { hasText: name }) }).first();
    const leaseRow = stageRow('Lease');
    await leaseRow.locator('.task-row').first().waitFor({ timeout: 20000 });
    ok('the task is inside its stage, not in a list of its own',
      /Read the lease/.test(await leaseRow.innerText()),
      (await leaseRow.innerText()).slice(0, 120));
    ok('and its step is under it',
      /break clause/.test(await leaseRow.innerText()));
    ok('and the count is on the task',
      /0 of 1 step/.test(await leaseRow.innerText()),
      (await leaseRow.innerText()).slice(0, 200));
    // The other stage must not have inherited it.
    const fitRow = stageRow('Fit-out');
    ok('and the other stage does not show it',
      !/Read the lease/.test(await fitRow.innerText()),
      (await fitRow.innerText()).slice(0, 120));

    const body = await page.locator('body').innerText();
    ok('a task on no stage is neither hidden nor filed by guess',
      /Not yet on a stage/.test(body) && /Something nobody has placed/.test(body),
      body.slice(0, 200));

    head('A step can be added and ticked without leaving the page:');
    await leaseRow.locator('.task-step-add input').first().fill('Check the service charge');
    await leaseRow.locator('.task-step-add button').first().click();
    await leaseRow.locator('.task-step', { hasText: 'service charge' })
      .waitFor({ timeout: 20000 });
    ok('the step appears where it belongs', true);
    await leaseRow.locator('.task-step', { hasText: 'service charge' })
      .locator('input[type=checkbox]').check();
    await page.waitForFunction(
      () => /1 of 2 steps done/.test(document.body.innerText), null, { timeout: 20000 },
    );
    ok('and ticking it moves the count', true);

    // Anything that opens over the page needs measuring open, and anything
    // that grows a row needs measuring grown — see tests/measure.js.
    head('And none of it runs off a phone:');
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(300);
    const spill = await page.evaluate(() => {
      const doc = document.documentElement;
      const sideways = doc.scrollWidth > doc.clientWidth + 1;
      const wide = [...document.querySelectorAll('.stage-tasks, .task-steps, .task-step-add')]
        .filter((el) => el.scrollWidth > el.clientWidth + 2)
        .map((el) => el.className);
      return { sideways, wide };
    });
    ok('the page does not scroll sideways', !spill.sideways);
    ok('and nothing inside a stage spills its box', spill.wide.length === 0,
      JSON.stringify(spill.wide));
    ok('nothing threw while doing any of it', errs.length === 0, errs.join(' | '));
  } finally {
    if (browser) await browser.close().catch(() => {});
    proc.kill();
  }

  console.log(fails === 0
    ? '\nWork sits on the stage it belongs to, and a task can say how it gets done.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
