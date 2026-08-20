// The two new screens in a real browser: the household from the principal's
// end, and the one screen a driver actually gets.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4462, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

async function signup(p, name, email, roleLabel) {
  await p.goto(`${BASE}/signup`);
  if (roleLabel) await p.click(`.role-option:has-text("${roleLabel}")`);
  await p.fill('#name', name);
  await p.fill('#email', email);
  await p.fill('#password', PW);
  await p.click('button:has-text("Create account")');
  await p.waitForURL('**/onboarding/profile', { timeout: 15000 });
  await p.fill('#slug', email.split('@')[0]);
  await p.click('button:has-text("Continue")');
}

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];
  try {
    const deadline = Date.now() + 30000;
    for (;;) {
      let ready = false;
      try { ready = (await (await fetch(`${BASE}/api/status`)).json()).databaseReady; }
      catch { /* not up */ }
      if (ready) break;
      if (Date.now() > deadline) throw new Error('server never became ready');
      await new Promise((r) => setTimeout(r, 200));
    }

    const pa = await (await b.newContext()).newPage();
    pa.on('pageerror', (e) => errs.push('principal: ' + e.message));
    await signup(pa, 'Ada Boss', `ada${ID}@x.com`, 'Principal');
    await pa.waitForURL('**/onboarding/meeting-type', { timeout: 15000 });
    await pa.fill('#mt-name', 'Intro');
    await pa.click('button:has-text("Finish setup")');
    await pa.waitForURL('**/today', { timeout: 15000 });

    // --- Connections screen ---
    await pa.goto(`${BASE}/connections`);
    await pa.waitForSelector('#conn-handle', { timeout: 15000 });
    ok('the connections screen says there is no directory',
      /no directory to search/i.test(await pa.locator('.conn-ask').innerText()));
    await pa.fill('#conn-handle', 'someone-who-does-not-exist');
    await pa.click('button:has-text("Send request")');
    await pa.waitForSelector('.alert-success', { timeout: 15000 });
    ok('and a handle that does not exist is answered neutrally',
      /if that handle belongs/i.test(await pa.locator('.alert-success').innerText()));

    // --- Household: add a driver ---
    await pa.goto(`${BASE}/household`);
    await pa.waitForSelector('button:has-text("Add someone")', { timeout: 15000 });
    ok('the household screen states the limit of what staff see',
      /not the diary/i.test(await pa.locator('.hh-scope').innerText()));
    await pa.click('button:has-text("Add someone")');
    await pa.fill('#hh-name', 'Femi Okon');
    await pa.fill('#hh-email', `femi${ID}@x.com`);
    await pa.fill('#hh-title', 'Driver');
    await pa.click('button:has-text("Add them")');
    await pa.waitForSelector('.alert-success code', { timeout: 15000 });
    const link = await pa.locator('.alert-success code').first().innerText();

    // --- The driver accepts ---
    const dr = await (await b.newContext()).newPage();
    dr.on('pageerror', (e) => errs.push('driver: ' + e.message));
    await dr.goto(link.startsWith('http') ? link : `${BASE}${link}`);
    ok('the invite page says what they are joining before they agree',
      /will not see their calendar/i.test(await dr.locator('.auth-card').innerText()));
    await signup(dr, 'Femi Okon', `femi${ID}@x.com`, 'Principal');
    await dr.waitForURL(/onboarding|today|instructions/, { timeout: 15000 });
    await dr.goto(link.startsWith('http') ? link : `${BASE}${link}`);
    await dr.click('button:has-text("Accept")');
    await dr.waitForSelector("h1:has-text(\"You're in\")", { timeout: 15000 });
    // Accepting a household post finishes onboarding: a driver has no calendar
    // to set up, and being held at "name a meeting type" would be absurd.
    await dr.goto(`${BASE}/`);
    await dr.waitForURL('**/instructions', { timeout: 15000 });
    ok('a driver lands straight on their instructions, with no calendar setup', true);

    // --- The principal sends an instruction ---
    await pa.goto(`${BASE}/household`);
    await pa.waitForSelector('#hh-who', { timeout: 15000 });
    await pa.selectOption('#hh-who', { label: 'Femi Okon — Driver' });
    await pa.fill('#hh-body', 'Car at 7:15 for Heathrow Terminal 5.');
    await pa.click('button:has-text("Send it")');
    await pa.waitForSelector('.hh-instr', { timeout: 15000 });
    ok('it shows as not confirmed', /not confirmed/i.test(await pa.locator('.hh-instr').innerText()));

    const todayText = await (async () => {
      await pa.goto(`${BASE}/today`);
      await pa.waitForSelector('.needs-card', { timeout: 15000 });
      return pa.locator('.today-grid').innerText();
    })();
    ok('and the principal is told nobody has confirmed it',
      /hasn't confirmed/i.test(todayText) && todayText.includes('Heathrow'), todayText.slice(0, 200));

    // --- The driver's whole app ---
    await dr.goto(`${BASE}/instructions`);
    await dr.waitForSelector('.instr', { timeout: 15000 });
    const instrText = await dr.locator('.instr').innerText();
    ok('the driver sees the instruction', instrText.includes('Heathrow'), instrText);
    ok('with who it came from', instrText.includes('Ada Boss'));

    const nav = await dr.locator('.app-nav nav').innerText();
    ok('their rail carries Instructions', nav.includes('Instructions'));
    ok('and nothing about running a household', !nav.includes('Household'));

    await dr.click('button:has-text("Got it")');
    await dr.waitForSelector('.pill:has-text("Got it")', { timeout: 15000 });
    ok('one tap confirms it', true);

    await dr.click('button:has-text("Reply")');
    await dr.waitForSelector('.instr-reply-form input', { timeout: 15000 });
    await dr.fill('.instr-reply-form input', 'Traffic on the bridge — ten minutes behind.');
    await dr.click('.instr-reply-form button:has-text("Send")');
    await dr.waitForSelector('.instr-reply', { timeout: 15000 });
    ok('and they can say something back', true);

    await pa.goto(`${BASE}/household`);
    await pa.waitForSelector('.hh-instr', { timeout: 15000 });
    const after = await pa.locator('.hh-instr').first().innerText();
    ok('the principal sees it was confirmed',
      /confirmed/i.test(after) && !/not confirmed/i.test(after), after);
    ok('and that there is a reply', after.includes('1 reply'), after);

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nBoth screens work.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
