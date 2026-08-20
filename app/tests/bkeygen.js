// Generating the encryption key from inside the app.
//
// The claims: a real key comes out, it is different every time, it never
// travels to the server, and the card disappears once a key is actually set.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4498, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

function boot(key) {
  return spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ENCRYPTION_KEY: key },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function waitReady() {
  const deadline = Date.now() + 30000;
  for (;;) {
    try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) return; }
    catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('never ready');
    await new Promise((r) => setTimeout(r, 200));
  }
}

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  }

  let proc = boot('');
  await waitReady();

  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];
  try {
    const ctx = await b.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));

    // Every request the page makes, so "it never leaves the browser" is
    // checked against the wire rather than trusted.
    const sentBodies = [];
    p.on('request', (r) => {
      const body = r.postData();
      if (body) sentBodies.push(body);
    });

    await p.goto(`${BASE}/signup`);
    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Ada Boss');
    await p.fill('#email', `ada${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 15000 });
    await p.fill('#slug', `ada${ID}`);
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/meeting-type', { timeout: 15000 });
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 15000 });

    await p.goto(`${BASE}/dashboard?tab=security`);
    await p.waitForSelector('.key-setup', { timeout: 15000 });
    ok('a deployment with no key is offered one on the security screen', true);
    ok('and told what is switched off until then',
      /identity|two-factor|voice/i.test(await p.locator('.key-unlocks').innerText()));
    ok('while being clear the rest still works',
      /everything else works normally/i.test(await p.locator('.key-setup').innerText()));

    await p.locator('.key-setup button:has-text("Generate a key")').click();
    await p.waitForSelector('.key-value code', { timeout: 15000 });
    const first = (await p.locator('.key-value code').innerText()).trim();
    ok('a key appears', !!first);
    ok('64 hex characters, which is what the server wants',
      /^[0-9a-f]{64}$/.test(first), `${first.length} chars: ${first.slice(0, 20)}…`);

    await p.locator('.key-setup button:has-text("Generate a different one")').click();
    await p.waitForFunction(
      (prev) => document.querySelector('.key-value code')?.textContent.trim() !== prev,
      first, { timeout: 15000 },
    );
    const second = (await p.locator('.key-value code').innerText()).trim();
    ok('generating again gives a different one', second !== first);
    ok('and that one is well-formed too', /^[0-9a-f]{64}$/.test(second));

    ok('the warning about losing it is unmissable',
      /cannot be recovered/i.test(await p.locator('.key-warning').innerText()));
    ok('and it says not to send it to anybody, including us',
      /including us/i.test(await p.locator('.key-warning').innerText()));

    const steps = await p.locator('.key-steps').innerText();
    ok('the steps name the variable exactly', /ENCRYPTION_KEY/.test(steps), steps.slice(0, 120));
    ok('and walk through the host rather than a terminal',
      /Render/.test(steps) && /Environment/.test(steps));

    // Copy must put the real thing on the clipboard. Scoped to the card:
    // has-text matches substrings, and the dashboard's own "Copy link" button
    // sits higher up the page — an unscoped selector copies the booking URL
    // and then passes on the wrong button's "Copied!".
    await p.locator('.key-setup button:has-text("Copy")').first().click();
    await p.waitForSelector('.key-setup button:has-text("Copied")', { timeout: 15000 });
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    ok('copying puts the key on the clipboard', clip === second, clip.slice(0, 24));

    // The claim that matters most.
    ok('the key was never sent to the server',
      !sentBodies.some((b2) => b2.includes(first) || b2.includes(second)),
      `${sentBodies.length} request bodies inspected`);
    const url = p.url();
    ok('and is not in the address bar either', !url.includes(second));

    // Reloading forgets it, which is what "we never stored it" looks like.
    await p.reload();
    await p.waitForSelector('.key-setup', { timeout: 15000 });
    ok('reloading forgets it, because nothing kept it',
      (await p.locator('.key-value').count()) === 0);

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));

    // --- and once a key is actually set, the card is gone ---
    proc.kill();
    await new Promise((r) => setTimeout(r, 700));
    proc = boot(KEY);
    await waitReady();

    await p.goto(`${BASE}/dashboard?tab=security`);
    await p.waitForSelector('.ess-heading', { timeout: 15000 });
    ok('with a key set the card no longer appears',
      (await p.locator('.key-setup').count()) === 0);
    ok('and two-factor is offered instead',
      await p.locator('button:has-text("Set up two-factor")').isEnabled());
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nThe key can be made without a terminal.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
