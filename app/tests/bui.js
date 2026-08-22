// The delegation story through the actual UI: separate landing screens, a
// draft that never appears on the principal's day, publishing, requesting,
// deciding, and closing an account.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4300;
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
let fails = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) { fails++; console.log('  ✗ ' + label + (extra ? ' — ' + extra : '')); }
  else console.log('  ✓ ' + label);
};

async function signup(browser, name, email, category, errors) {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => errors.push(`${email}: ${e.message}`));
  await page.goto(`${BASE}/signup`);
  if (category === 'chief_of_staff') await page.click('button:has-text("Chief of Staff")');
  await page.fill('#name', name);
  await page.fill('#email', email);
  await page.fill('#password', 'password123');
  await page.click('button:has-text("Create account")');
  await page.waitForURL('**/onboarding/profile');
  await page.fill('#slug', email.split('@')[0]);
  await page.click('button:has-text("Continue")');
  // Assistants have no bookable hours of their own to set, so onboarding ends
  // for them at the profile step — only principals continue to meeting types.
  await page.waitForURL((u) => !u.pathname.startsWith('/onboarding/profile'), { timeout: 20000 });
  if (page.url().includes('/onboarding/meeting-type')) {
    await page.fill('#mt-name', 'Intro');
    await page.click('button:has-text("Finish setup")');
  }
  return page;
}

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const deadline = Date.now() + 20000;
  for (;;) {
    try { const r = await (await fetch(`${BASE}/api/status`)).json(); if (r.databaseReady) break; }
    catch { if (Date.now() > deadline) throw new Error('no server'); await new Promise((r) => setTimeout(r, 200)); }
  }

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errors = [];
  try {
    const bossEmail = `boss${ID}@x.com`;
    const cosEmail = `cos${ID}@x.com`;

    const boss = await signup(browser, 'Ada Boss', bossEmail, 'principal', errors);
    await boss.waitForURL('**/today', { timeout: 15000 });
    ok('principal lands on Today', boss.url().endsWith('/today'));
    // The URL changes before the shell has painted. Counting nav items at that
    // instant is a race that a quiet machine always wins and a busy one
    // sometimes does not, so wait for the nav itself rather than for the URL.
    await boss.waitForSelector('.nav-item', { timeout: 15000 });
    ok('principal has a Team link in the nav', await boss.locator('.nav-item:has-text("Team")').count() === 1);
    ok('principal has no Workspace link', await boss.locator('.nav-item:has-text("Workspace")').count() === 0);

    // Appoint the Chief of Staff.
    const cos = await signup(browser, 'Kit Staff', cosEmail, 'chief_of_staff', errors);
    await cos.waitForURL('**/workspace', { timeout: 15000 });
    ok('assistant lands on their own Workspace, not Today', cos.url().endsWith('/workspace'));
    await cos.waitForSelector('.empty-state', { timeout: 15000 });
    ok('and is told nobody has added them yet',
      (await cos.locator('.app-main').innerText()).includes('supporting anyone yet'));

    await boss.goto(`${BASE}/dashboard?tab=members`);
    await boss.waitForSelector('#invite-email');
    await boss.fill('#invite-email', cosEmail);
    await boss.click('button:has-text("Send invite")');
    await boss.waitForSelector('.alert-success');
    const link = await boss.locator('.alert-success code').textContent();
    ok('invite offers Chief of Staff as a title',
      (await boss.locator('#invite-role').textContent()).includes('Chief of Staff'));
    // The role list is fetched, so the select is briefly empty; wait for it to
    // settle rather than racing the render.
    await boss.waitForFunction(
      () => document.querySelector('.role-select')?.value, null, { timeout: 15000 });
    ok('and the invitee is titled correctly, not "PA"',
      (await boss.locator('.role-select').first().inputValue()) === 'chief_of_staff');

    // MembersTab shows the link absolute already.
    await cos.goto(link.startsWith('http') ? link : BASE + link);
    await cos.click('button:has-text("Accept and become")');
    await cos.waitForSelector('button:has-text("Go to your workspace")', { timeout: 15000 });
    ok('acceptance names the real title', (await cos.locator('.auth-card').innerText()).includes('Chief of Staff'));
    await cos.click('button:has-text("Go to your workspace")');
    await cos.waitForURL('**/workspace', { timeout: 15000 });

    await cos.goto(`${BASE}/workspace`);
    await cos.waitForSelector('.ws-principal');
    ok('principal now appears in the workspace', (await cos.content()).includes('Ada Boss'));
    ok('with the right title shown', (await cos.content()).includes('Chief of Staff'));

    // --- Draft an itinerary item for the principal ---
    await cos.goto(`${BASE}/itinerary`);
    await cos.waitForSelector('button:has-text("Add item")', { timeout: 15000 });
    await cos.click('button:has-text("Add item")');
    await cos.fill('#itin-title', 'BA083 to JFK');
    await cos.click('.kind-option:has-text("Flight")');
    await cos.fill('#itin-start', '09:00');
    await cos.click('button:has-text("Add to the day")');
    await cos.waitForSelector('.itin-entry');
    ok('assistant sees their draft', (await cos.content()).includes('BA083 to JFK'));
    ok('marked as a draft', await cos.locator('.pill:has-text("Draft")').count() >= 1);
    ok('with a Publish action', await cos.locator('button:has-text("Publish")').count() >= 1);

    await boss.goto(`${BASE}/itinerary`);
    // Nothing to wait for when the expectation is absence, so wait for the
    // page to settle instead — otherwise this passes trivially.
    await boss.waitForSelector('.app-main', { timeout: 15000 });
    await boss.waitForLoadState('networkidle');
    ok('principal does NOT see the draft', !(await boss.content()).includes('BA083 to JFK'));

    // --- Publish it ---
    await cos.click('button:has-text("Publish")');
    await cos.waitForSelector('.pill:has-text("Draft")', { state: 'detached' }).catch(() => {});
    await boss.reload();
    // Itinerary resolves whose day it is, then fetches it — wait for a real
    // entry rather than the shell that renders before either finishes.
    await boss.waitForSelector('.itin-entry', { timeout: 15000 });
    ok('after publishing, principal DOES see it', (await boss.content()).includes('BA083 to JFK'));

    // --- Propose one instead ---
    await cos.goto(`${BASE}/itinerary`);
    await cos.waitForSelector('button:has-text("Add item")');
    await cos.click('button:has-text("Add item")');
    await cos.fill('#itin-title', 'Board dinner');
    await cos.fill('#itin-start', '19:00');
    await cos.click('button:has-text("Add to the day")');
    await cos.waitForSelector('button:has-text("Ask them")');
    cos.once('dialog', (d) => d.accept('Clashes with the flight home — your call.'));
    await cos.click('button:has-text("Ask them")');
    await cos.waitForSelector('.pill:has-text("Waiting on them")', { timeout: 15000 });
    ok('assistant can send it for approval', true);

    await boss.goto(`${BASE}/today`);
    await boss.waitForSelector('.needs-card', { timeout: 15000 });
    const bossHtml = await boss.content();
    ok('principal sees the request in what needs them', bossHtml.includes('Board dinner'));
    ok('with who asked', bossHtml.includes('Kit Staff is asking'));
    ok('and why', bossHtml.includes('Clashes with the flight home'));

    await boss.click('.needs-card:has-text("Board dinner") button:has-text("Approve")');
    await boss.waitForSelector('.needs-card:has-text("Board dinner")', { state: 'detached', timeout: 15000 });
    ok('principal approves it and the request clears', true);

    await cos.goto(`${BASE}/workspace`);
    await cos.waitForSelector('.ws-section');
    ok('assistant sees it was answered', (await cos.content()).includes('Approved'));

    // --- Close the assistant's account ---
    await cos.goto(`${BASE}/dashboard?tab=settings`);
    await cos.waitForSelector('button:has-text("Close account…")');
    await cos.click('button:has-text("Close account…")');
    await cos.waitForSelector('#delete-password');
    // The panel fetches what would be lost after it opens, so the text is
    // "Checking what this would remove…" for a moment. Asserting on it before
    // that resolves is a race, not a failure.
    await cos.waitForFunction(
      () => !/Checking what this would remove/.test(document.querySelector('.danger-zone')?.textContent || ''),
      null, { timeout: 15000 },
    );
    const danger = await cos.locator('.danger-zone').textContent();
    ok('deletion names the principal who would lose them', /support 1/.test(danger), danger.slice(0, 120));
    await cos.fill('#delete-password', 'password123');
    await cos.click('button:has-text("Delete my account permanently")');
    await cos.waitForURL('**/login', { timeout: 15000 });
    ok('account closes and returns to login', cos.url().includes('/login'));

    await cos.fill('#email', cosEmail);
    await cos.fill('#password', 'password123');
    await cos.click('button[type=submit]');
    await cos.waitForSelector('.alert-error');
    ok('the account is genuinely gone', true);

    await boss.goto(`${BASE}/today`);
    // The shell renders before the day is fetched — Today resolves which
    // principal it is acting for and then loads. Wait for the schedule itself.
    await boss.waitForSelector('.sched-row', { timeout: 15000 });
    ok('principal is unaffected by their assistant leaving', (await boss.content()).includes('BA083'));

    ok('no JS errors anywhere', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nDelegation works in the UI.' : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
