// Verifies the login-screen storage warning in a real browser, both ways:
// it must appear on a production server backed by ephemeral SQLite, and must
// stay hidden on one backed by Postgres.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');
const http = require('http');

const WARN = 'storing accounts on temporary disk';

function waitForServer(port) {
  return new Promise((resolve, reject) => {
    // A minute. Twenty seconds is plenty on an idle machine and not plenty on a
  // loaded one, and "no server" on a green tree is a board crying wolf.
  const deadline = Date.now() + 60000;
    const tick = () => {
      http.get(`http://127.0.0.1:${port}/api/status`, (res) => { let b=''; res.on('data',(d)=>{b+=d}); res.on('end',()=>{ try { JSON.parse(b).databaseReady ? resolve() : setTimeout(tick,200); } catch { setTimeout(tick,200); } }); })
        .on('error', () => (Date.now() > deadline ? reject(new Error('server never came up')) : setTimeout(tick, 200)));
    };
    tick();
  });
}

async function startServer({ port, env }) {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => process.stdout.write(`    [:${port}] ${d}`));
  proc.stderr.on('data', (d) => process.stderr.write(`    [:${port}!] ${d}`));
  await waitForServer(port);
  return proc;
}

async function run(label, { port, env, expectWarning }) {
  const proc = await startServer({ port, env });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errors = [];
  try {
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    page.on('pageerror', (e) => errors.push(e.message));

    const status = await page.evaluate(() => null).catch(() => null);
    await page.goto(`http://127.0.0.1:${port}/login`, { waitUntil: 'networkidle' });

    // Before any failure the warning must not be on screen at all.
    if ((await page.content()).includes(WARN)) throw new Error(`${label}: warning shown before any login attempt`);
    console.log(`  ✓ ${label}: clean login screen, no warning up front`);

    await page.fill('#email', 'ghost@example.com');
    await page.fill('#password', 'not-the-password');
    await page.click('button[type=submit]');
    await page.waitForSelector('.alert-error');

    const shown = await page.locator('.alert-warning').count();
    if (expectWarning && shown !== 1) throw new Error(`${label}: expected the storage warning, saw ${shown}`);
    if (!expectWarning && shown !== 0) throw new Error(`${label}: expected no storage warning, saw ${shown}`);
    console.log(`  ✓ ${label}: after a failed login, warning ${expectWarning ? 'shown' : 'absent'} as expected`);

    if (errors.length) throw new Error(`${label}: JS errors: ${errors.join(', ')}`);
  } finally {
    await browser.close();
    proc.kill();
  }
}

(async () => {
  console.log('Ephemeral SQLite in production:');
  await run('sqlite', { port: 4111, env: { DATABASE_URL: '' }, expectWarning: true });

  console.log('Postgres in production:');
  await run('postgres', {
    port: 4112,
    env: { DATABASE_URL: 'postgres://kairos:kairos@127.0.0.1:5432/kairos' },
    expectWarning: false,
  });

  console.log('\nStorage warning behaves correctly on both backends.');
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
