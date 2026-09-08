// The tablet, upright and sideways.
//
// The phone fix is scoped to viewports under 460px tall, so a tablet is
// untouched by it on purpose. That leaves a question nobody has measured: does
// the app use a tablet's width when it is turned sideways, or does it leave
// half of it empty? .app-body carries max-width: 1100px, and a landscape
// tablet is wider than that.
const ROOT = '/home/user/Kairos';
const OUT = '/tmp/claude-0/-home-user-Kairos/7e78184d-9ae0-58d8-94a0-bd5eb2bf040e/scratchpad';
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = 4833, BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36), PW = 'password123';

// Real tablets, both ways up. The first pair is roughly the device in the
// screenshot: a rail showing permanently means the viewport reports wider
// than 860 CSS px.
const SIZES = [
  ['tablet upright   1066x1600', 1066, 1600],
  ['tablet sideways  1600x1066', 1600, 1066],
  ['tablet upright    800x1280', 800, 1280],
  ['tablet sideways  1280x800 ', 1280, 800],
];

async function ready() {
  for (let i = 0; i < 300; i += 1) {
    try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) return; }
    catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server never came up');
}

(async () => {
  const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  }
  const srv = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ENCRYPTION_KEY: '0'.repeat(64) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let b = null;
  const say = [];
  try {
    await ready();
    b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const setup = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await setup.goto(`${BASE}/signup`);
    await setup.click('.role-option:has-text("Principal")');
    await setup.fill('#name', 'Bassileou Crown');
    await setup.fill('#email', `b${ID}@x.com`);
    await setup.fill('#password', PW);
    await setup.click('button:has-text("Create account")');
    await setup.waitForURL('**/onboarding/profile', { timeout: 25000 });
    await setup.fill('#slug', `b${ID}`);
    await setup.click('button:has-text("Continue")');
    await setup.waitForURL('**/onboarding/connect', { timeout: 25000 });
    await setup.click('button:has-text("Skip for now")');
    await setup.waitForURL('**/onboarding/meeting-type', { timeout: 25000 });
    await setup.fill('#mt-name', 'Intro call');
    await setup.click('button:has-text("Finish setup")');
    await setup.waitForURL('**/today', { timeout: 25000 });
    const owner = (await setup.evaluate(async () =>
      (await (await fetch('/api/auth/me', { credentials: 'include' })).json()))).user.id;
    const now = new Date();
    const at = (h) => { const d = new Date(now); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    for (const it of [
      { kind: 'meeting', title: 'Appointments with Bassileou — Salami Habeeb', startAt: at(11), endAt: at(12), location: 'Video call' },
      { kind: 'meeting', title: 'Appointments with Bassileou — Popoola Opeyemi', startAt: at(13), endAt: at(14), location: 'Video call' },
      { kind: 'meeting', title: 'Appointments with Bassileou — Tabitha', startAt: at(16), endAt: at(17), location: '' },
    ]) {
      await setup.evaluate(async ([o, body]) => {
        await fetch(`/api/itinerary/${o}/items`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
      }, [owner, it]);
    }
    await setup.close();

    for (const [label, width, height] of SIZES) {
      const ctx = await b.newContext({ viewport: { width, height } });
      const p = await ctx.newPage();
      await p.goto(`${BASE}/login`);
      await p.fill('#email', `b${ID}@x.com`);
      await p.fill('#password', PW);
      await p.click('button:has-text("Log in")');
      await p.waitForURL('**/today', { timeout: 25000 });
      await p.waitForTimeout(900);

      const m = await p.evaluate(() => {
        const r = (el) => el ? el.getBoundingClientRect() : null;
        const nav = r(document.querySelector('.app-nav'));
        const main = r(document.querySelector('.app-main'));
        const body = r(document.querySelector('.app-body'));
        return {
          winW: window.innerWidth,
          navW: nav ? Math.round(nav.width) : 0,
          navFixed: nav ? getComputedStyle(document.querySelector('.app-nav')).position : null,
          mainW: main ? Math.round(main.width) : 0,
          bodyW: body ? Math.round(body.width) : 0,
          // The number this probe exists for: how much of the content column
          // is left blank to the right of the capped body.
          wasted: main && body ? Math.round(main.width - body.width) : 0,
          // Total leftover cannot tell a centred column from one hugging the
          // left — it is 104px either way. The asymmetry is the thing that
          // reads as broken, so measure that.
          leftGap: main && body ? Math.round(body.left - main.left) : 0,
          rightGap: main && body ? Math.round(main.right - body.right) : 0,
          hScroll: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      const pct = Math.round((m.wasted / m.winW) * 100);
      say.push(`${label}  win ${m.winW}  rail ${m.navW} (${m.navFixed})  main ${m.mainW}  `
        + `body ${m.bodyW}  leftover ${m.wasted}px (${pct}%)  `
        + `gaps L${m.leftGap}/R${m.rightGap}${m.leftGap !== m.rightGap ? '  ✗ LOPSIDED' : ''}`);
      await p.screenshot({ path: `${OUT}/tab-${width}x${height}.png` });
      await ctx.close();
    }
  } catch (err) {
    say.push('THREW: ' + (err.stack || err.message));
  } finally {
    if (b) await b.close();
    srv.kill();
  }
  console.log(say.join('\n'));
})();
