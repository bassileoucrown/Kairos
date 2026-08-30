// Recording a voice note on screen, with a real MediaRecorder.
//
// Chromium's fake capture device gives an actual audio track, so this exercises
// getUserMedia, MediaRecorder, the Blob, the base64 hop and the upload — not a
// mock of any of them. The one thing it cannot prove is that a human sounds
// like themselves afterwards.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4494, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };

async function onboard(p, name, email, roleLabel) {
  await p.goto(`${BASE}/signup`);
  await p.click(`.role-option:has-text("${roleLabel}")`);
  await p.fill('#name', name);
  await p.fill('#email', email);
  await p.fill('#password', PW);
  await p.click('button:has-text("Create account")');
  await p.waitForURL('**/onboarding/profile', { timeout: 15000 });
  await p.fill('#slug', email.split('@')[0]);
  await p.click('button:has-text("Continue")');
  await p.waitForURL('**/onboarding/connect', { timeout: 15000 });
  await p.click('button:has-text("Skip for now")');
  await p.waitForURL(/onboarding\/meeting-type|workspace|today|\/pa/, { timeout: 15000 });
  if (p.url().includes('meeting-type')) {
    await p.fill('#mt-name', 'Intro');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 15000 });
  }
}

function launch(withKey) {
  return spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      ENCRYPTION_KEY: withKey ? KEY : '',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function waitReady() {
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

  let proc = launch(true);
  await waitReady();

  // A fake microphone that produces a real, decodable track.
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const errs = [];
  try {
    const ctxA = await b.newContext({ permissions: ['microphone'] });
    const pa = await ctxA.newPage();
    pa.on('pageerror', (e) => errs.push('principal: ' + e.message));
    await onboard(pa, 'Ada Boss', `ada${ID}@x.com`, 'Principal');

    // An assistant, so the direct line exists.
    await pa.goto(`${BASE}/dashboard?tab=members`);
    await pa.waitForSelector('#invite-email', { timeout: 15000 });
    await pa.fill('#invite-email', `ben${ID}@x.com`);
    await pa.click('button:has-text("Send invite")');
    await pa.waitForSelector('.alert-success code', { timeout: 15000 });
    const link = await pa.locator('.alert-success code').first().innerText();

    const ctxB = await b.newContext({ permissions: ['microphone'] });
    const pb = await ctxB.newPage();
    pb.on('pageerror', (e) => errs.push('assistant: ' + e.message));
    await onboard(pb, 'Ben Reed', `ben${ID}@x.com`, 'Personal Assistant');
    await pb.goto(link.startsWith('http') ? link : `${BASE}${link}`);
    await pb.click('button:has-text("Accept")');
    await pb.waitForSelector('h1:has-text("You\'re in")', { timeout: 15000 });

    await pa.goto(`${BASE}/today`);
    await pa.waitForSelector('.direct-line', { timeout: 15000 });
    await pa.click('.direct-line');
    await pa.waitForURL('**/threads/**', { timeout: 15000 });
    const threadUrl = pa.url();

    await pa.waitForSelector('.voice-recorder', { timeout: 15000 });
    ok('the principal is offered a microphone',
      (await pa.locator('.voice-start').count()) === 1);

    // --- record for real ---
    await pa.click('.voice-start');
    await pa.waitForSelector('.voice-live', { timeout: 15000 });
    ok('recording shows a running clock', /\d:\d\d/.test(await pa.locator('.voice-clock').innerText()));

    await pa.waitForFunction(
      () => /0:0[2-9]/.test(document.querySelector('.voice-clock')?.textContent || ''),
      null, { timeout: 15000 },
    );
    await pa.click('.voice-live button:has-text("Stop")');

    await pa.waitForSelector('.voice-preview', { timeout: 15000 });
    ok('stopping offers a listen before anything is sent',
      (await pa.locator('.voice-preview .voice-audio').count()) === 1);
    ok('and says how long it will be kept',
      /removed after 30 days/i.test(await pa.locator('.voice-retention').innerText()));

    // --- discard really discards ---
    await pa.click('.voice-preview button:has-text("Discard")');
    await pa.waitForSelector('.voice-start', { timeout: 15000 });
    ok('discarding puts you back to the start',
      (await pa.locator('.voice-preview').count()) === 0);
    const beforeSend = await pa.locator('.msg-voice').count();
    ok('and sent nothing', beforeSend === 0);

    // --- record again and send ---
    await pa.click('.voice-start');
    await pa.waitForSelector('.voice-live', { timeout: 15000 });
    await pa.waitForFunction(
      () => /0:0[2-9]/.test(document.querySelector('.voice-clock')?.textContent || ''),
      null, { timeout: 15000 },
    );
    await pa.click('.voice-live button:has-text("Stop")');
    await pa.waitForSelector('.voice-preview', { timeout: 15000 });
    await pa.click('button:has-text("Send voice note")');

    await pa.waitForSelector('.msg-voice', { timeout: 20000 });
    ok('the sent note appears in the thread', true);
    ok('labelled as a voice note with its length',
      /Voice note · \d:\d\d/.test(await pa.locator('.msg-voice').innerText()),
      await pa.locator('.msg-voice').innerText());
    ok('and the composer is back to idle',
      (await pa.locator('.voice-start').count()) === 1);

    // --- it cannot be filed as a record while it has no words ---
    ok('no promote button on a note with nothing written',
      (await pa.locator('.msg-note button:has-text("Promote to record")').count()) === 0);
    ok('and it says what to do instead',
      /transcript|write out/i.test(await pa.locator('.msg-voice-hint').innerText()));

    // --- the assistant hears it ---
    await pb.goto(threadUrl);
    await pb.waitForSelector('.msg-voice audio', { timeout: 15000 });
    const played = await pb.evaluate(async () => {
      const el = document.querySelector('.msg-voice audio');
      el.load();
      await new Promise((res, rej) => {
        el.onloadedmetadata = res;
        el.onerror = () => rej(new Error('audio failed to load'));
        setTimeout(res, 8000);
      });
      return { ready: el.readyState > 0, src: el.getAttribute('src') };
    });
    ok('the other side can load the recording', played.ready, JSON.stringify(played));
    ok('fetched from the thread it belongs to',
      /\/api\/threads\/.+\/audio$/.test(played.src), played.src);

    // --- Today describes it rather than showing a blank line ---
    await pb.goto(`${BASE}/today`);
    await pb.waitForSelector('.direct-line', { timeout: 15000 });
    ok('the glance on Today names it',
      /Voice note/.test(await pb.locator('.direct-line').innerText()),
      await pb.locator('.direct-line').innerText());

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));

    // --- and with no key, the microphone is not offered at all ---
    proc.kill();
    await new Promise((r) => setTimeout(r, 600));
    proc = launch(false);
    await waitReady();

    await pa.goto(threadUrl);
    await pa.waitForSelector('.voice-unavailable', { timeout: 15000 });
    const why = await pa.locator('.voice-unavailable').innerText();
    ok('with no encryption key there is no microphone',
      (await pa.locator('.voice-start').count()) === 0);
    ok('and the app says why in its own words',
      /encryption key/i.test(why) && /not available yet/i.test(why), why);
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nVoice notes work on screen.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
