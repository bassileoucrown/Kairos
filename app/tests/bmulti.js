// Building a multi-leg trip as drafts, in one sitting, and confirming they
// all land as drafts across the assistant's workspace.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');
const PORT = 4310, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

async function signup(b, name, email, cat, errs) {
  const p = await (await b.newContext()).newPage();
  p.on('pageerror', (e) => errs.push(`${email}: ${e.message}`));
  await p.goto(`${BASE}/signup`);
  if (cat) await p.click(`button:has-text("${cat}")`);
  await p.fill('#name', name); await p.fill('#email', email); await p.fill('#password', 'password123');
  await p.click('button:has-text("Create account")');
  await p.waitForURL('**/onboarding/profile');
  await p.fill('#slug', email.split('@')[0]);
  await p.click('button:has-text("Continue")');
  await p.waitForURL((u) => !u.pathname.startsWith('/onboarding/profile'), { timeout: 20000 });
  if (p.url().includes('/onboarding/meeting-type')) {
    await p.fill('#mt-name', 'Intro'); await p.click('button:has-text("Finish setup")');
  }
  return p;
}

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (;;) { try { const r = await (await fetch(`${BASE}/api/status`)).json(); if (r.databaseReady) break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];
  try {
    const boss = await signup(b, 'Ada Boss', `b${ID}@x.com`, null, errs);
    await boss.waitForURL('**/today');
    const pa = await signup(b, 'Kit Staff', `p${ID}@x.com`, 'Personal Assistant', errs);
    await pa.waitForURL('**/workspace');

    await boss.goto(`${BASE}/dashboard?tab=members`);
    await boss.waitForSelector('#invite-email');
    await boss.fill('#invite-email', `p${ID}@x.com`);
    await boss.click('button:has-text("Send invite")');
    await boss.waitForSelector('.alert-success');
    const link = await boss.locator('.alert-success code').textContent();
    await pa.goto(link.startsWith('http') ? link : BASE + link);
    await pa.click('button:has-text("Accept and become")');
    await pa.waitForSelector('button:has-text("Go to your workspace")');

    // Build a four-leg day without reopening the form.
    await pa.goto(`${BASE}/itinerary`);
    await pa.waitForSelector('button:has-text("Add item")', { timeout: 15000 });
    await pa.click('button:has-text("Add item")');

    const legs = [
      ['Flight', 'BA083 to JFK', '08:00'],
      ['Car', 'Car to midtown', '12:30'],
      ['Hotel', 'Check in at The Mark', '14:00'],
      ['Meal', 'Dinner with counsel', '19:30'],
    ];
    for (const [kind, title, time] of legs) {
      await pa.click(`.kind-option:has-text("${kind}")`);
      await pa.fill('#itin-title', title);
      await pa.fill('#itin-start', time);
      await pa.click('button:has-text("Add to the day")');
      await pa.waitForSelector(`.alert-success:has-text("${title}")`, { timeout: 15000 });
      ok(`added "${title}" without reopening the form`, await pa.locator('#itin-title').count() === 1);
    }
    ok('the title field was cleared for the next one', (await pa.locator('#itin-title').inputValue()) === '');
    ok('and the button became Done', await pa.locator('button:has-text("Done")').count() === 1);

    await pa.click('button:has-text("Done")');
    await pa.waitForSelector('.itin-entry', { timeout: 15000 });
    const shown = await pa.locator('.itin-entry').count();
    ok('all four are on the assistant day view', shown === 4, `saw ${shown}`);
    ok('all four are drafts', await pa.locator('.pill:has-text("Draft")').count() === 4);

    await boss.goto(`${BASE}/itinerary`);
    await boss.waitForSelector('.app-main');
    const bossText = await boss.locator('.app-main').innerText();
    ok('none of them reached the principal', !legs.some(([, t]) => bossText.includes(t)));

    await pa.goto(`${BASE}/workspace`);
    await pa.waitForSelector('.ws-section');
    const wsText = await pa.locator('.app-main').innerText();
    ok('all four are listed on the workspace', legs.every(([, t]) => wsText.includes(t)));
    ok('counted as four drafts', /Your drafts\s*4/.test(wsText), wsText.slice(0, 80));

    ok('no JS errors', errs.length === 0, errs.join(' | '));
  } finally { await b.close(); proc.kill(); }
  console.log(fails === 0 ? '\nMulti-draft entry works.' : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
