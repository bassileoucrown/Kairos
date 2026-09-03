// A principal who is not on Kairos, held by the assistant who works for them.
//
// WHAT THIS FILE IS ABOUT. A great many assistants work for somebody who will
// never open an app, and until now that person could not exist here at all:
// every owner-scoped query reads a users row, and memberships.owner_id
// references one. So a kept principal IS a users row, with a password nothing
// can match, and a membership written at the same moment — which is why the
// switcher, the day sheet and the approval queue need no special case.
//
// THE ASSERTIONS THAT MATTER are not that the record can be made. They are
// that it cannot be signed into, that the vault stays shut on it, and that
// nothing crosses to a real account except when the assistant moves it and
// only to a principal they actually work for.
//
// NO ADDRESS IS COLLECTED. An earlier version took the principal's email as
// the route back to them, which made the escrow real and was wrong anyway: an
// assistant typing their employer's address into a company that person has
// never agreed to deal with is disclosing somebody else's contact details at
// the first step. What replaces it is that the held record holds nothing worth
// stealing — the vault does not open — and that the principal, when they join,
// does so on their own terms and takes across only what is handed to them.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const fs = require('fs');
const DATA = `${ROOT}/app/server/data`;
for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
  if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
}

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}/api`;
const PW = 'password123';
const ID = Date.now().toString(36);
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (t) => console.log(`\n${t}`);

const server = spawn('node', ['--experimental-sqlite', 'index.js'], {
  cwd: `${ROOT}/app/server`,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: process.env.DATABASE_URL || '' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let boot = '';
server.stderr.on('data', (d) => { boot = (boot + d).slice(-4000); });
let died = null;
server.on('exit', (code, signal) => { died = signal ? `signal ${signal}` : `exit ${code}`; });
process.on('exit', () => server.kill());

function sess() {
  let c = '';
  return async (m, p, b) => {
    const r = await fetch(BASE + p, {
      method: m,
      headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) c = sc.split(';')[0];
    let d = null;
    try { d = await r.json(); } catch { /* 204 */ }
    return { s: r.status, d };
  };
}

async function waitReady() {
  const deadline = Date.now() + 150000;
  for (;;) {
    try { if ((await (await fetch(`${BASE}/status`)).json()).databaseReady) return; }
    catch { /* not up yet */ }
    if (died) throw new Error(`the server never became ready — server ${died}\n${boot.trim()}`);
    if (Date.now() > deadline) throw new Error(`the server never became ready\n${boot.trim()}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

(async () => {
  await waitReady();
  try {
    const pa = sess();
    const paEmail = `kit${ID}@x.com`;
    await pa('POST', '/auth/signup', { name: 'Kit Staff', email: paEmail, password: PW, timezone: 'UTC', accountCategory: 'chief_of_staff' });
    await pa('PATCH', '/profile', { slug: `h${ID}-1` });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });

    head('An assistant can take on somebody who is not on Kairos:');
    let r = await pa('POST', '/pa/kept', { name: 'Adaeze Okonkwo', timezone: 'Africa/Lagos' });
    ok('the record is made', r.s === 201, JSON.stringify(r.d));
    const kept = r.d?.principal;
    ok('it has a handle of its own', !!kept?.slug, kept?.slug);
    ok('and the principal\'s timezone, not the assistant\'s',
      kept?.timezone === 'Africa/Lagos', kept?.timezone);
    ok('and it says what happens when they join, rather than promising a claim',
      /connect to their handle/i.test(r.d?.holding?.whenTheyJoin || ''), r.d?.holding?.whenTheyJoin);
    ok('and says the vault is shut, which is the part people assume',
      /shut/i.test(r.d?.holding?.vault || ''), r.d?.holding?.vault);
    ok('no address of theirs was asked for or stored',
      !JSON.stringify(r.d).includes('@x.com'), JSON.stringify(r.d).slice(0, 160));

    head('It behaves like any other principal, with no special case:');
    r = await pa('GET', '/pa/principals');
    const mine = (r.d.principals || []).find((p) => p.id === kept.id);
    ok('it is in the switcher', !!mine, JSON.stringify((r.d.principals || []).map((p) => p.name)));
    ok('and marked as held rather than an account that appointed you',
      mine?.kept === true, JSON.stringify(mine));
    ok('the assistant\'s own account is not marked held',
      (r.d.principals || []).find((p) => p.role === 'owner')?.kept === false);
    ok('their day sheet opens', (await pa('GET', `/today/${kept.id}`)).s === 200);
    ok('and it is read in their zone, not the assistant\'s',
      (await pa('GET', `/today/${kept.id}`)).d.timezone === 'Africa/Lagos');
    // The day is read in the PRINCIPAL'S zone, so the key has to be derived
    // from the entry rather than from this process's idea of today. Three hours
    // from now in London is already tomorrow in Lagos for part of every day,
    // and asking for the wrong day would look exactly like the entry being lost.
    const entryAt = new Date(Date.now() + 3 * 3600000).toISOString();
    const entryDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' })
      .format(new Date(entryAt));
    const made = await pa('POST', `/itinerary/${kept.id}/items`, {
      kind: 'meeting', title: 'Board pre-read', startAt: entryAt,
    });
    ok('an itinerary entry can be put on it', made.s === 201, JSON.stringify(made.d).slice(0, 120));
    // An assistant's entry lands as a draft — their working, not the
    // principal's day — and is published when it is real. That rule is not
    // suspended for a kept principal, so the assistant publishes here exactly
    // as they would for somebody who signs in. Worth knowing when the Desk is
    // designed: on a held record a draft has no audience at all, so anything
    // left unpublished is invisible to the principal on the day they claim it.
    ok('and publishing it puts it on the principal\'s day',
      (await pa('POST', `/itinerary/${kept.id}/items/${made.d?.item?.id}/publish`)).s === 200);
    ok('and it appears on their day',
      (await pa('GET', '/attention/across')).d.principals.some((p) => p.id === kept.id));

    head('But it is a record, not an account anybody can get into:');
    const heldAddress = `kept-${kept.id}@kept.invalid`;
    r = await pa('POST', '/auth/login', { email: heldAddress, password: PW });
    ok('its own address plus a guessed password is refused', r.s === 401, String(r.s));
    r = await pa('POST', '/auth/login', { email: heldAddress, password: '!kept' });
    ok('and so is the sentinel that is actually in the column', r.s === 401, String(r.s));
    ok('the refusal does not admit the record exists',
      /incorrect email or password/i.test(r.d?.error || ''), r.d?.error);

    // AND THE GUARD ITSELF, not the sentinel that happens to sit in front of it.
    // Removing the kept_by check from login left every assertion above green,
    // because "!kept" is not a hash any password can match — so those were
    // passing on a library's behaviour rather than on the stated rule. Give the
    // held record a real, working password hash, the way a bug elsewhere or a
    // row from some future import might, and the rule is what is left standing.
    {
      const store = require(`${ROOT}/app/server/lib/db`);
      await store.ready();
      const { hashPassword } = require(`${ROOT}/app/server/lib/auth`);
      await store.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(hashPassword('averyrealpassword'), kept.id);
      const tryIt = await pa('POST', '/auth/login', { email: `kept-${kept.id}@kept.invalid`, password: 'averyrealpassword' });
      ok('a held record refuses a password that genuinely matches its hash',
        tryIt.s === 401, String(tryIt.s));
      // Put the sentinel back so the claim below is tested from the real state.
      await store.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run('!kept', kept.id);
    }

    head('The vault is shut while nobody has claimed the record:');
    const vault = await pa('GET', `/essentials/${kept.id}`);
    ok('essentials refuse to open', vault.s === 409, String(vault.s));
    ok('and say why rather than looking empty',
      /second factor of theirs/i.test(vault.d?.error || ''), vault.d?.error);
    // POSITIVE CONTROL: the same call on an ordinary principal works, so the
    // refusal above is about being held and not about the route being broken.
    const real = sess();
    await real('POST', '/auth/signup', { name: 'Real Boss', email: `real${ID}@x.com`, password: PW, timezone: 'UTC', accountCategory: 'principal' });
    await real('PATCH', '/profile', { slug: `h${ID}-2` });
    await real('POST', '/profile/onboarding-step', { step: 'done' });
    const realId = (await real('GET', '/auth/me')).d.user.id;
    ok('though an ordinary principal opens theirs perfectly well',
      (await real('GET', `/essentials/${realId}`)).s === 200);

    head('When the principal joins, things cross because somebody moved them:');
    // They join on their own terms, with their own address, and appoint the
    // assistant the ordinary way. Nothing about the held record is assumed.
    const inv = await real('POST', '/members', { email: paEmail });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    const before = await real('GET', `/itinerary/${realId}/day?date=${entryDay}`);
    ok('their own day starts without the assistant\'s working entry',
      !(before.d.entries || []).some((e) => e.title === 'Board pre-read'),
      JSON.stringify((before.d.entries || []).map((e) => e.title)));

    r = await pa('POST', `/pa/kept/${kept.id}/hand-over/${made.d.item.id}`, { toPrincipalId: realId });
    ok('the assistant can move one thing across', r.s === 200, JSON.stringify(r.d));
    const after = await real('GET', `/itinerary/${realId}/day?date=${entryDay}`);
    ok('and it is on the principal\'s own day now',
      (after.d.entries || []).some((e) => e.title === 'Board pre-read'),
      JSON.stringify((after.d.entries || []).map((e) => e.title)));
    ok('and no longer on the held record',
      !((await pa('GET', `/itinerary/${kept.id}/day?date=${entryDay}`)).d.entries || [])
        .some((e) => e.title === 'Board pre-read'));

    head('And it is not a way into anybody else\'s account:');
    const outsider = sess();
    await outsider('POST', '/auth/signup', { name: 'Someone Else', email: `else${ID}@x.com`, password: PW, timezone: 'UTC', accountCategory: 'principal' });
    await outsider('PATCH', '/profile', { slug: `h${ID}-3` });
    await outsider('POST', '/profile/onboarding-step', { step: 'done' });
    const outsiderId = (await outsider('GET', '/auth/me')).d.user.id;
    const second = await pa('POST', `/itinerary/${kept.id}/items`, {
      kind: 'meeting', title: 'Second thing', startAt: entryAt,
    });
    r = await pa('POST', `/pa/kept/${kept.id}/hand-over/${second.d.item.id}`, { toPrincipalId: outsiderId });
    ok('moving something to a principal you do not work for is refused',
      r.s === 403, String(r.s));
    ok('and the outsider\'s day is untouched',
      !((await outsider('GET', `/itinerary/${outsiderId}/day?date=${entryDay}`)).d.entries || [])
        .some((e) => e.title === 'Second thing'));

    // --- AND A PA CAN ACTUALLY DO IT, from a screen -----------------------
    // Everything above proves the server can hold a principal. This proves an
    // assistant can reach it: registering, saying their principal is not on
    // Kairos, and starting work. Without this the whole thing is an endpoint
    // nobody can call, which is not shipped.
    head('An assistant registering can say their principal is not on Kairos:'); {
      const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
      const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
      const page = await browser.newPage();
      const SITE = `http://127.0.0.1:${PORT}`;
      const N = `${ID}b`;
      await page.goto(`${SITE}/signup`);
      await page.fill('#name', 'Ngozi Bello');
      await page.fill('#email', `ngozi${N}@x.com`);
      await page.fill('#password', PW);
      // The role picker is buttons, not a select — and it must NOT be wrapped
      // in a catch. Swallowing this is how the first run of this test signed up
      // a principal, met the principal's wording, and reported the branch
      // missing when it was simply never asked for.
      await page.click('.role-option:has-text("Personal Assistant")');
      await page.click('button:has-text("Create account")');
      await page.waitForURL('**/onboarding/profile', { timeout: 60000 });
      await page.fill('#slug', `ngozi${N}`);
      await page.click('button:has-text("Continue")');
      await page.waitForURL('**/onboarding/connect', { timeout: 60000 });

      ok('the step offers a way out for a principal who is not on Kairos',
        (await page.locator('button:has-text("They are not on Kairos")').count()) === 1,
        (await page.locator('body').innerText()).slice(0, 200));

      await page.click('button:has-text("They are not on Kairos")');
      await page.waitForSelector('#kept-name', { timeout: 60000 });
      await page.fill('#kept-name', 'Emeka Obi');
      await page.click('button:has-text("Set them up")');
      // Wait for the confirmation itself, not for the button to stop spinning.
      await page.waitForFunction(
        () => /connect to their handle/i.test(document.body.innerText),
        null, { timeout: 60000 },
      );
      ok('setting them up says what happens when the principal joins',
        /connect to their handle/i.test(await page.locator('body').innerText()));
      ok('and the screen never asked for the principal\'s email',
        (await page.locator('#kept-email').count()) === 0);

      await page.click('button:has-text("Start working")');
      await page.waitForSelector('#principal-select', { timeout: 60000 });
      const opts = await page.locator('#principal-select option').allInnerTexts();
      ok('and the principal they just set up is theirs to work on',
        opts.some((t) => /Emeka Obi/.test(t)), JSON.stringify(opts));

      // --- The other thing that was built but could not be found ----------
      head('AI Assist names everything it does, not only finding a time:');
      await page.goto(`${SITE}/pa?tab=ai_assist`);
      await page.waitForFunction(
        () => /What else AI Assist does/i.test(document.body.innerText),
        null, { timeout: 60000 },
      );
      const shown = await page.locator('.assist-catalogue').innerText();
      for (const named of ['briefing note', 'Triage', 'reply', 'next week']) {
        ok(`it names ${named}`, new RegExp(named, 'i').test(shown), shown.slice(0, 200));
      }
      ok('and says where each one lives rather than putting it here',
        /While you were away|Correspondence|An appointment|A room/.test(shown), shown.slice(0, 200));
      ok('and marks the ones still waiting on a key',
        /ANTHROPIC_API_KEY/.test(shown) || !/Soon/.test(shown), shown.slice(0, 240));
      await browser.close();
    }

    head('A stranger cannot take on a principal on somebody else\'s behalf:');
    const nobody = await fetch(`${BASE}/pa/kept`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Someone', claimEmail: `x${ID}@x.com` }),
    });
    ok('signed out, it is a refusal rather than a record', nobody.status === 401, String(nobody.status));
  } catch (e) {
    fails++;
    console.log('  ✗ threw: ' + (e && e.stack ? e.stack : e));
  }

  server.kill();
  console.log(fails ? `\n${fails} FAILURES` : '\nA principal can be held for somebody not on Kairos, and joins on their own terms.');
  process.exit(fails ? 1 : 0);
})();
