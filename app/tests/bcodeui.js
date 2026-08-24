// The principal's side of pairing codes, on screen.
//
// The claim being tested is the one the user pushed back on: a principal can
// hold several codes at once, sees which grants what, and turning one off
// leaves the others alone.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4489, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

async function arm(p, code, roleText, uses) {
  await p.click('button:has-text("code")');           // "Set a code" / "Add another code"
  await p.waitForSelector('#code-word');
  await p.fill('#code-word', code);
  await p.selectOption('#code-role', { label: roleText });
  if (uses !== undefined) await p.fill('#code-uses', String(uses));
  await p.click('button:has-text("Arm it")');
  await p.waitForSelector(`.code-word:has-text("${code}")`, { timeout: 15000 });
}

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const deadline = Date.now() + 30000;
  for (;;) {
    try { const r = await (await fetch(`${BASE}/api/status`)).json(); if (r.databaseReady) break; }
    catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('never ready');
    await new Promise((r) => setTimeout(r, 200));
  }

  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];
  try {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));

    await p.goto(`${BASE}/signup`);
    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Ada Boss');
    await p.fill('#email', `ada${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile');
    await p.fill('#slug', `ada${ID}`);
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/connect', { timeout: 15000 });
    await p.click('button:has-text("Skip for now")');
    await p.waitForURL('**/onboarding/meeting-type');
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 15000 });

    await p.goto(`${BASE}/dashboard?tab=members`);
    await p.waitForSelector('.code-card', { timeout: 15000 });
    // The pill is uppercased in CSS, so innerText comes back rendered.
    ok('a principal with no codes is shown as off',
      /^off$/i.test((await p.locator('.code-card .pill.is-off').innerText()).trim()));

    const roles = await p.locator('.code-card').innerText();
    ok('and invited to set one', /Set a code/.test(roles), roles);

    await arm(p, 'CHIEF-ONE-11', undefined, 2);
    ok('the armed code shows with the handle beside it',
      (await p.locator('.code-value').innerText()).includes(`@ada${ID}`));

    await arm(p, 'DIARY-TWO-22', undefined, 2);
    ok('a second code arms alongside the first',
      (await p.locator('.code-live').count()) === 2);
    ok('and the count is shown',
      /^2 live$/i.test((await p.locator('.code-card .pill').first().innerText()).trim()));

    const facts = await p.locator('.code-facts').allInnerTexts();
    ok('each says what it grants and how long it has',
      facts.length === 2 && facts.every((f) => /Grants/.test(f) && /left/.test(f)),
      JSON.stringify(facts));

    // Turning one off must leave the other on screen and working.
    const first = p.locator('.code-live').filter({ hasText: 'CHIEF-ONE-11' });
    await first.locator('button:has-text("Turn off")').click();
    await p.waitForFunction(
      () => document.querySelectorAll('.code-live').length === 1,
      null, { timeout: 15000 },
    );
    const left = await p.locator('.code-live').innerText();
    ok('turning one off leaves the other alone', left.includes('DIARY-TWO-22'), left);
    ok('and the count follows',
      /^1 live$/i.test((await p.locator('.code-card .pill').first().innerText()).trim()));

    await p.reload();
    await p.waitForSelector('.code-word', { timeout: 15000 });
    ok('which survives a reload — it was a real revocation',
      (await p.locator('.code-word').allInnerTexts()).join() === 'DIARY-TWO-22');

    // The assistant's side: two fields, and the code that was turned off is dead.
    const ctxB = await b.newContext();
    const pb = await ctxB.newPage();
    pb.on('pageerror', (e) => errs.push('assistant: ' + e.message));
    await pb.goto(`${BASE}/signup`);
    await pb.click('.role-option:has-text("Personal Assistant")');
    await pb.fill('#name', 'Ben Reed');
    await pb.fill('#email', `ben${ID}@x.com`);
    await pb.fill('#password', PW);
    await pb.click('button:has-text("Create account")');
    await pb.waitForURL('**/onboarding/profile', { timeout: 15000 });
    await pb.fill('#slug', `ben${ID}`);
    await pb.click('button:has-text("Continue")');
    await pb.waitForURL('**/onboarding/connect', { timeout: 15000 });
    await pb.click('button:has-text("Skip for now")');
    await pb.waitForURL(/\/pa|\/workspace/, { timeout: 15000 });

    await pb.goto(`${BASE}/workspace`);
    await pb.waitForSelector('#join-handle', { timeout: 15000 });
    await pb.fill('#join-handle', `ada${ID}`);
    await pb.fill('#join-code', 'CHIEF-ONE-11');
    await pb.click('.join-code button:has-text("Join")');
    await pb.waitForSelector('.join-code .alert-error', { timeout: 15000 });
    ok('the turned-off code is refused on screen', true);

    await pb.fill('#join-code', 'DIARY-TWO-22');
    await pb.click('.join-code button:has-text("Join")');
    await pb.waitForSelector('.ws-principal', { timeout: 15000 });
    ok('the live one lets them in',
      (await pb.locator('.ws-principal').innerText()).includes('Ada Boss'));

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nAll access-code UI checks passed.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
