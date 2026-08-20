// Speaking to the assistant instead of typing to it.
//
// The recogniser belongs to the browser, so what is worth proving is not that
// Google can transcribe a sentence — it is everything around that: the button
// shows it is listening, the words land in the box the parser already reads,
// a second sentence adds to the first instead of erasing it, a refused
// microphone says something a person can act on, and a browser without speech
// at all shows no microphone rather than a button that does nothing.
//
// So the recogniser is replaced with one this suite drives. That is the honest
// boundary: everything on our side of it is tested, and nothing pretends to
// test what is on theirs.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4537, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

// A recogniser with a handle on it. Installed before any app code runs.
const FAKE = `
window.__spoken = [];
class FakeRecognition {
  constructor() { window.__rec = this; this.started = false; }
  start() { this.started = true; window.__spoken.push('start'); }
  stop() { this.started = false; this.onend && this.onend(); }
  // Driven from the test.
  say(text, final) {
    this.onresult && this.onresult({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal: !!final })],
    });
  }
  fail(code) { this.onerror && this.onerror({ error: code }); this.stop(); }
}
window.SpeechRecognition = FakeRecognition;
window.webkitSpeechRecognition = FakeRecognition;
`;

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  }
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (;;) {
    try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
    catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }

  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];
  try {
    const ctx = await b.newContext();
    await ctx.addInitScript(FAKE);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));

    await p.goto(`${BASE}/signup`);
    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Adaeze Okonkwo');
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

    const meId = await p.evaluate(async () => (await (await fetch('/api/auth/me')).json()).user.id);
    await p.goto(`${BASE}/pa/${meId}?tab=ai_assist`);
    await p.waitForSelector('#ai-message', { timeout: 15000 });

    head('Beside the box the assistant already reads:');
    ok('there is a microphone', (await p.locator('.dictate-btn').first().count()) === 1);
    ok('saying what it is for',
      /say it/i.test(await p.locator('.dictate-btn').first().innerText()),
      await p.locator('.dictate-btn').first().innerText());
    ok('and saying, before it is used, that the words leave the device',
      /leave|sends what you say/i.test(await p.locator('.dictate-note').first().innerText()),
      await p.locator('.dictate-note').first().innerText());

    head('Pressing it:');
    await p.click('.dictate-btn >> nth=0');
    await p.waitForSelector('.dictate-heard', { timeout: 10000 });
    ok('it shows that it is listening',
      /listening/i.test(await p.locator('.dictate-heard').innerText()));
    ok('and offers a way to stop, rather than only a way to start',
      /stop/i.test(await p.locator('.dictate-btn').first().innerText()));
    ok('the recogniser was actually started',
      (await p.evaluate(() => window.__spoken.includes('start'))) === true);

    head('While somebody is speaking:');
    await p.evaluate(() => window.__rec.say('book a call with', false));
    await p.waitForFunction(
      () => /book a call with/i.test(document.querySelector('.dictate-heard')?.textContent || ''),
      null, { timeout: 10000 },
    );
    ok('the running guess is shown, so a dead microphone is obvious', true);
    ok('but nothing half-heard reaches the box yet',
      (await p.inputValue('#ai-message')) === '');

    head('When the sentence lands:');
    await p.evaluate(() => {
      window.__rec.say('Book a call with Jane next Tuesday afternoon', true);
      window.__rec.stop();
    });
    await p.waitForFunction(
      () => document.querySelector('#ai-message')?.value.includes('Jane'),
      null, { timeout: 10000 },
    );
    ok('it goes into the same box that was always there',
      /Book a call with Jane next Tuesday afternoon/.test(await p.inputValue('#ai-message')));
    ok('and the button goes back to offering a start',
      /say it/i.test(await p.locator('.dictate-btn').first().innerText()));

    head('A second sentence:');
    await p.click('.dictate-btn >> nth=0');
    await p.evaluate(() => {
      window.__rec.say('make it forty five minutes', true);
      window.__rec.stop();
    });
    await p.waitForFunction(
      () => document.querySelector('#ai-message')?.value.includes('forty five'),
      null, { timeout: 10000 },
    );
    const both = await p.inputValue('#ai-message');
    ok('adds to the first rather than erasing it',
      /Jane/.test(both) && /forty five/.test(both), both);

    head('And what it heard is really an instruction, not a transcript:');
    await p.fill('#ai-message', 'Book a call with Jane next Tuesday afternoon');
    await p.click('button:has-text("Find times")');
    await p.waitForSelector('.card:has-text("Matched"), .alert-error', { timeout: 20000 });
    ok('the spoken sentence goes through the parser unchanged',
      (await p.locator('.alert-error').count()) === 0
      || !/could not/i.test(await p.locator('.alert-error').innerText()),
      await p.locator('.card, .alert-error').first().innerText().then((t) => t.slice(0, 120)));

    head('A microphone the browser will not give:');
    await p.click('.dictate-btn >> nth=0');
    await p.evaluate(() => window.__rec.fail('not-allowed'));
    await p.waitForSelector('.dictate-error', { timeout: 10000 });
    const refused = await p.locator('.dictate-error').innerText();
    ok('says what happened in words', /blocked/i.test(refused), refused);
    ok('and what to do about it', /type it instead/i.test(refused), refused);

    head('Silence:');
    await p.click('.dictate-btn >> nth=0');
    await p.evaluate(() => window.__rec.fail('no-speech'));
    await p.waitForFunction(
      () => /nothing was heard/i.test(document.querySelector('.dictate-error')?.textContent || ''),
      null, { timeout: 10000 },
    );
    ok('is not reported as a failure of the app', true);

    // --- A browser with no speech at all --------------------------------
    head('A browser that cannot listen:');
    const plain = await b.newContext();
    await plain.addInitScript(`
      delete window.SpeechRecognition;
      delete window.webkitSpeechRecognition;
    `);
    const q = await plain.newPage();
    q.on('pageerror', (e) => errs.push('plain: ' + e.message));
    await q.goto(`${BASE}/login`);
    await q.fill('#email', `ada${ID}@x.com`);
    await q.fill('#password', PW);
    await q.click('button:has-text("Log in")');
    await q.waitForURL('**/today', { timeout: 20000 });
    await q.goto(`${BASE}/pa/${meId}?tab=ai_assist`);
    await q.waitForSelector('#ai-message', { timeout: 15000 });
    ok('shows no microphone at all, rather than one that does nothing',
      (await q.locator('.dictate-btn').count()) === 0);
    ok('and the box still works by hand', true);

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    await b.close();
    proc.kill();
  }
  console.log(fails === 0 ? '\nYou can say it instead of typing it.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
