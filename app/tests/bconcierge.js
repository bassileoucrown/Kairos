// The concierge desk, declared before it opens.
//
// A placeholder is easy to get wrong in exactly one way: by being encouraging.
// So what this proves is mostly restraint — that the screen says it is shut in
// words rather than only in styling, that it does not offer to "connect" as
// though a credential were the problem, that there is nowhere to type a
// request that nobody would read, and that the one thing it does accept says
// on its face where it goes.
//
// It also checks the switch works, since a feature declared unavailable that
// cannot become available is not a placeholder, it is decoration.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const { spawn } = require('child_process');

const PORT = 4541, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { s: r.status, d: json };
  };
}

function boot(port, env = {}) {
  return spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ...env },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
async function ready(base) {
  for (;;) {
    try { if ((await (await fetch(`${base}/api/status`)).json()).databaseReady) break; }
    catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }
}

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }
  const proc = boot(PORT);
  let b = null;
  let partnerProc = null;
  try {
    await ready(BASE);

    const ada = client();
    const up = await ada('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const adaId = up.d.user.id;
    await ada('POST', '/profile/onboarding-step', { step: 'done' });

    head('The desk, asked about directly:');
    const got = await ada('GET', `/concierge/${adaId}`);
    ok('answers', got.s === 200, JSON.stringify(got.d).slice(0, 120));
    ok('and says plainly that it is not open', got.d.available === false);
    ok('giving a reason a person can read',
      /not open yet/i.test(got.d.reason || ''), got.d.reason);
    ok('which is honest that the blocker is people, not a setting',
      /contracted|vetted|2am/i.test(got.d.reason || ''), got.d.reason);
    ok('while still describing what it will cover',
      got.d.services.length >= 6, String(got.d.services?.length));
    ok('specifically, rather than as "lifestyle management"',
      got.d.services.some((s) => /aviation/i.test(s.label))
      && got.d.services.some((s) => /gifting/i.test(s.label)),
      got.d.services.map((s) => s.label).join(', '));

    head('A request, which is the thing that must not be quietly swallowed:');
    const req = await ada('POST', `/concierge/${adaId}/requests`, { text: 'Table for four at 8' });
    ok('is refused, not accepted and dropped', req.s === 501, String(req.s));
    ok('with the same reason the screen gives', /not open yet/i.test(req.d.error || ''));

    head('Saying you want it, which is real:');
    const marked = await ada('POST', `/concierge/${adaId}/interest`, { service: 'dining' });
    ok('is recorded', marked.s === 201 && marked.d.interest.length === 1, JSON.stringify(marked.d));
    const again = await ada('POST', `/concierge/${adaId}/interest`, { service: 'dining' });
    ok('saying it twice is not a second want', again.d.interest.length === 1);
    const bogus = await ada('POST', `/concierge/${adaId}/interest`, { service: 'yacht' });
    ok('and something not on the list is refused', bogus.s === 400);
    const dropped = await ada('DELETE', `/concierge/${adaId}/interest/dining`);
    ok('it can be taken back', dropped.d.interest.length === 0);

    head('Somebody else\'s concierge:');
    const bola = client();
    await bola('POST', '/auth/signup',
      { name: 'Bola Ade', email: `bola${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await bola('POST', '/profile/onboarding-step', { step: 'done' });
    const nosey = await bola('GET', `/concierge/${adaId}`);
    // 403 from requirePaAccess, which is what every principal-scoped route in
    // the app answers. The 404-not-403 rule belongs to spaces, where the
    // existence of the space is itself the thing being disclosed; a principal's
    // id is already known to anyone holding it.
    ok('is refused', nosey.s === 403 || nosey.s === 404, String(nosey.s));
    ok('and a stranger cannot register a want on it either',
      [403, 404].includes((await bola('POST', `/concierge/${adaId}/interest`, { service: 'dining' })).s));

    head('The switch is a real switch:');
    partnerProc = boot(PORT + 1, { CONCIERGE_PARTNER: 'exousia-desk' });
    const OPEN = `http://127.0.0.1:${PORT + 1}`;
    await ready(OPEN);
    const partnered = client();
    // Same database file, so the account made above is already there.
    const login = await (async () => {
      const r = await fetch(`${OPEN}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `ada${ID}@x.com`, password: PW }),
      });
      return { cookie: r.headers.get('set-cookie')?.split(';')[0], s: r.status };
    })();
    const openGot = await (await fetch(`${OPEN}/api/concierge/${adaId}`, {
      headers: { cookie: login.cookie },
    })).json();
    ok('with a partner set, it stops saying it is shut',
      openGot.available === true, JSON.stringify(openGot).slice(0, 120));
    ok('and the reason disappears with it', openGot.reason === null);
    const openReq = await fetch(`${OPEN}/api/concierge/${adaId}/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: login.cookie },
      body: JSON.stringify({ text: 'Table for four' }),
    });
    ok('though a request is still honest about not being built',
      openReq.status === 501, String(openReq.status));
    ok('and says so differently, rather than repeating the closed message',
      /not built yet/i.test((await openReq.json()).error || ''));
    partnerProc.kill();
    partnerProc = null;

    // --- The screen ------------------------------------------------------
    head('On screen:');
    b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
    const errs = [];
    const p = await (await b.newContext()).newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}/login`);
    await p.fill('#email', `ada${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Log in")');
    await p.waitForURL('**/today', { timeout: 20000 });

    ok('the rail marks it before you click',
      /soon/i.test(await p.locator('.app-nav a:has-text("Concierge")').innerText()),
      await p.locator('.app-nav a:has-text("Concierge")').innerText());

    await p.click('.app-nav a:has-text("Concierge")');
    await p.waitForSelector('.soon-banner', { timeout: 15000 });
    const banner = await p.locator('.soon-banner').innerText();
    ok('the page says it in words, not only in styling', /not open yet/i.test(banner), banner.slice(0, 120));
    ok('and that nothing on it reaches anybody', /reaches anybody/i.test(banner), banner);

    const page = await p.locator('.app-body').innerText();
    ok('it never offers to "connect", because no credential would fix it',
      !/connect/i.test(page), page.slice(0, 200));
    ok('and there is nowhere to type a request nobody would read',
      (await p.locator('textarea').count()) === 0);
    ok('the services are described', /Private aviation/.test(page), page.slice(0, 300));

    head('Registering interest, from the screen:');
    await p.click('.soon-service:has-text("Dining") button');
    await p.waitForFunction(
      () => /wanted/i.test(document.querySelector('.soon-service button')?.textContent || ''),
      null, { timeout: 15000 },
    );
    ok('is marked back', true);
    ok('and the screen says where it goes and where it does not',
      /does not raise a request/i.test(await p.locator('.app-body').innerText()));

    await p.reload();
    await p.waitForSelector('.soon-service', { timeout: 15000 });
    ok('and it survives a reload, because it was really recorded',
      /wanted/i.test(await p.locator('.soon-service:has-text("Dining") button').innerText()));

    ok('no page errors anywhere', errs.length === 0, errs.join(' | '));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (b) await b.close();
    if (partnerProc) partnerProc.kill();
    proc.kill();
  }
  console.log(fails === 0 ? '\nThe desk is declared, and honest about being shut.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
