// The two things the user asked to see on screen: the direct line as a real
// door you can walk through from Today, and an honest word about uploads.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4432, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

async function onboard(p, name, email, roleLabel) {
  await p.goto(`${BASE}/signup`);
  if (roleLabel) await p.click(`.role-option:has-text("${roleLabel}")`);
  await p.fill('#name', name);
  await p.fill('#email', email);
  await p.fill('#password', PW);
  await p.click('button:has-text("Create account")');
}

// Every wait below follows a network round trip and a re-render, so the bound
// has to be one this machine can actually meet. Fifteen seconds was met on an
// idle box and missed on a board of a hundred and fourteen, where bconnect
// records a server needing more than a hundred and fifty seconds merely to
// start. Waiting longer costs nothing when the tree is green — each wait
// returns the instant its thing appears — and is only paid when something is
// genuinely broken, which is the right way round.
const UI_WAIT = 60000;

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  // Two and a half minutes. Twenty seconds was plenty on an idle machine and
  // not plenty on a loaded one; a minute went the same way, twice in one day,
  // on a box where a hundred suites run back to back and each one starts a
  // server and half of them start a browser. "No server" on a green tree is a
  // board crying wolf, and it costs an hour of hunting a product bug that was
  // never there.
  //
  // Waiting longer is free when the tree is green — the loop exits the instant
  // the server answers — and is only paid when something is genuinely broken,
  // which is the right way round for this trade.
  const deadline = Date.now() + 150000;
  for (;;) {
    try { const r = await (await fetch(`${BASE}/api/status`)).json(); if (r.databaseReady) break; }
    catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('never ready');
    await new Promise((r) => setTimeout(r, 200));
  }

  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];
  try {
    const ctxA = await b.newContext();
    const pa = await ctxA.newPage();
    pa.on('pageerror', (e) => errs.push('principal: ' + e.message));

    await onboard(pa, 'Ada Boss', `ada${ID}@x.com`, 'Principal');
    await pa.waitForURL('**/onboarding/profile');
    await pa.fill('#slug', `ada${ID}`);
    await pa.click('button:has-text("Continue")');
    await pa.waitForURL('**/onboarding/connect', { timeout: UI_WAIT });
    await pa.click('button:has-text("Skip for now")');
    await pa.waitForURL('**/onboarding/meeting-type');
    await pa.fill('#mt-name', 'Intro');
    await pa.click('button:has-text("Finish setup")');
    await pa.waitForURL('**/today', { timeout: UI_WAIT });

    // Anchored on something Today always draws before asking what it does not
    // draw. waitForURL fires on the URL changing, not on the page painting, so
    // an unpainted Today has no .direct-line for the boring reason and this
    // would have passed without testing anything.
    await pa.waitForSelector('.today-date', { timeout: UI_WAIT });
    ok('no direct line on Today while working alone',
      (await pa.locator('.direct-line').count()) === 0);

    // --- the uploads notice, where someone would go looking for it ---
    await pa.goto(`${BASE}/dashboard?tab=essentials`);
    await pa.waitForSelector('.ess-uploads', { timeout: UI_WAIT });
    const uploads = await pa.locator('.ess-uploads').innerText();
    ok('the app says plainly that uploads are not available yet',
      /upload/i.test(uploads) && /isn't available yet/i.test(uploads), uploads);

    // --- invite an assistant ---
    await pa.goto(`${BASE}/dashboard?tab=members`);
    await pa.waitForSelector('#invite-email', { timeout: UI_WAIT });
    await pa.fill('#invite-email', `ben${ID}@x.com`);
    await pa.click('button:has-text("Send invite")');
    await pa.waitForSelector('.alert-success code', { timeout: UI_WAIT });
    const link = await pa.locator('.alert-success code').first().innerText();

    const ctxB = await b.newContext();
    const pb = await ctxB.newPage();
    pb.on('pageerror', (e) => errs.push('assistant: ' + e.message));
    await onboard(pb, 'Ben Reed', `ben${ID}@x.com`, 'Personal Assistant');
    await pb.waitForURL('**/onboarding/profile', { timeout: UI_WAIT });
    await pb.fill('#slug', `ben${ID}`);
    await pb.click('button:has-text("Continue")');
    await pb.waitForURL('**/onboarding/connect', { timeout: UI_WAIT });
    await pb.click('button:has-text("Skip for now")');
    await pb.waitForURL(/\/pa|\/workspace/, { timeout: UI_WAIT });
    await pb.goto(link.startsWith('http') ? link : `${BASE}${link}`);
    await pb.click('button:has-text("Accept")');
    await pb.waitForSelector('h1:has-text("You\'re in")', { timeout: UI_WAIT });

    // --- the assistant's workspace card ---
    await pb.goto(`${BASE}/workspace`);
    await pb.waitForSelector('.ws-principal-line', { timeout: UI_WAIT });
    ok('the assistant gets a direct line on the principal card', true);

    await pb.click('.ws-principal-line');
    await pb.waitForURL('**/threads/**', { timeout: UI_WAIT });
    await pb.waitForSelector('textarea', { timeout: UI_WAIT });
    await pb.fill('textarea', 'Car is outside.');
    await pb.click('button:has-text("Send")');
    await pb.waitForSelector('.msg-bubble', { timeout: UI_WAIT });
    ok('and can say something in it',
      (await pb.locator('.msg-bubble').first().innerText()).includes('Car is outside.'));

    // --- the principal sees it on Today ---
    await pa.goto(`${BASE}/today`);
    await pa.waitForSelector('.direct-line', { timeout: UI_WAIT });
    const bar = await pa.locator('.direct-line').innerText();
    ok('the principal sees the message on Today',
      bar.includes('Ben Reed') && bar.includes('Car is outside.'), bar);
    ok('with an unread count', (await pa.locator('.direct-line .count-pill').innerText()) === '1');

    await pa.click('.direct-line');
    await pa.waitForURL('**/threads/**', { timeout: UI_WAIT });
    await pa.waitForSelector('textarea', { timeout: UI_WAIT });
    // TYPE AFTER THE THREAD HAS ARRIVED, not merely after the box exists. The
    // composer renders before the messages do, and the render that brings them
    // in wipes whatever has been typed in the meantime — so the fill landed,
    // the thread arrived, the box was cleared, and Send posted nothing. The
    // probe that found it showed an empty textarea and only the original
    // message on screen, sixty seconds later.
    //
    // Waiting for the message already in the thread is waiting for that second
    // render to have happened. It is also what a person does: they read what is
    // there before answering it.
    await pa.waitForSelector('.msg-bubble:has-text("Car is outside.")', { timeout: UI_WAIT });
    await pa.fill('textarea', 'On my way down.');
    await pa.click('button:has-text("Send")');
    await pa.waitForSelector('.msg-bubble:has-text("On my way down.")', { timeout: UI_WAIT });

    await pa.goto(`${BASE}/today`);
    await pa.waitForSelector('.direct-line', { timeout: UI_WAIT });
    ok('answering clears the badge', (await pa.locator('.direct-line .count-pill').count()) === 0);

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nAll direct-line UI checks passed.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
