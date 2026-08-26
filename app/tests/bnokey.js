// Running without an encryption key, which is how the live deployment is set
// up for now. The vault must be honest about it rather than failing late.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4475, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

(async () => {
  // Deliberately NO ENCRYPTION_KEY.
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(PORT) };
  delete env.ENCRYPTION_KEY;
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`, env, stdio: ['ignore', 'ignore', 'inherit'],
  });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];
  try {
    // A minute. Twenty seconds is plenty on an idle machine and not plenty on a
    // loaded one, and "no server" on a green tree is a board crying wolf.
    const deadline = Date.now() + 60000;
    for (;;) {
      let ready = false;
      try { ready = (await (await fetch(`${BASE}/api/status`)).json()).databaseReady; }
      catch { /* not up */ }
      if (ready) break;
      if (Date.now() > deadline) throw new Error('server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    const p = await (await b.newContext()).newPage();
    p.on('pageerror', (e) => errs.push(e.message));

    await p.goto(`${BASE}/signup`);
    await p.fill('#name', 'Ada Boss');
    await p.fill('#email', `ada${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 15000 });
    await p.fill('#slug', `ada${ID}`);
    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/connect', { timeout: 15000 });
    await p.click('button:has-text("Skip for now")');
    await p.waitForURL('**/onboarding/meeting-type', { timeout: 15000 });
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 15000 });

    await p.goto(`${BASE}/dashboard?tab=essentials`);
    await p.waitForSelector('.alert-warning:not(.sq-prompt)', { timeout: 15000 });

    const notice = await p.locator('.alert-warning:not(.sq-prompt)').innerText();
    ok('the screen says identity documents are not available yet',
      /identity documents aren't available yet/i.test(notice), notice);
    ok('and says why, without jargon', /encryption key/i.test(notice));
    ok('and says what still works', /preferences/i.test(notice) && /allergies/i.test(notice));

    await p.click('button:has-text("Add a detail")');
    await p.waitForSelector('#ess-category', { timeout: 15000 });

    const labels = await p.locator('#ess-category option').allInnerTexts();
    ok('sensitive categories are labelled as unavailable',
      labels.some((l) => /travel identity — not available yet/i.test(l)), labels.join(' | '));
    ok('ordinary ones are not', labels.some((l) => /^Preferences$/.test(l.trim())), labels.join(' | '));

    const disabled = await p.locator('#ess-category option[disabled]').allInnerTexts();
    ok('and they cannot be chosen at all',
      disabled.some((l) => /travel identity/i.test(l)), disabled.join(' | '));
    ok('while nothing ordinary is disabled',
      !disabled.some((l) => /preferences|loyalty|sizes/i.test(l)), disabled.join(' | '));

    // The whole point: an ordinary detail still works end to end.
    await p.selectOption('#ess-category', 'preferences');
    await p.selectOption('#ess-field', 'allergies');
    await p.fill('#ess-value', 'Shellfish');
    await p.click('button:has-text("Save")');
    await p.waitForSelector('.ess-row', { timeout: 15000 });
    const row = await p.locator('.ess-row').innerText();
    ok('an ordinary detail saves as normal', /shellfish/i.test(row), row);
    ok('and is not masked', !/••••/.test(row), row);

    ok('no page errors', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nThe vault is honest with no key set.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
