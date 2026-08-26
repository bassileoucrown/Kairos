// The widened essentials catalogue.
//
// The claim that matters is not "the fields exist" — it is that per-field
// sensitivity is real. Identity numbers deliberately mixes both: a BVN is a
// key to somebody's banking and a delegate must never see it; a TIN is printed
// on every invoice the company issues and withholding it would be theatre.
// Marking the whole group sensitive would have been easier and would have
// taught assistants that the marking means nothing.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4507);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
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

async function signUp(call, name, email, category) {
  const r = await call('POST', '/auth/signup', { name, email, password: PW, accountCategory: category });
  if (r.s !== 200 && r.s !== 201) throw new Error(`signup ${name}: ${r.s} ${JSON.stringify(r.d)}`);
  await call('POST', '/profile/onboarding-step', { step: 'done' });
  return r.d.user;
}

/**
 * Direct access to whichever store the app is using, so the at-rest claims
 * hold on SQLite and on Postgres alike. Placeholders are written $1-style and
 * rewritten for SQLite.
 */
async function rawStore() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Client } = require(`${ROOT}/app/server/node_modules/pg`);
    const c = new Client({ connectionString: url });
    await c.connect();
    const schema = process.env.DATABASE_SCHEMA;
    if (schema) await c.query(`SET search_path TO ${schema}`);
    return {
      query: async (sql, params = []) => (await c.query(sql, params)).rows,
      close: () => c.end(),
    };
  }
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(`${ROOT}/app/server/data/kairos.sqlite`);
  const toSqlite = (sql) => sql.replace(/\$\d+/g, '?');
  return {
    query: async (sql, params = []) => db.prepare(toSqlite(sql)).all(...params),
    close: async () => db.close(),
  };
}

function boot(key, port) {
  return spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ENCRYPTION_KEY: key },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function waitReady(base) {
  // A minute. Twenty seconds is plenty on an idle machine and not plenty on a
  // loaded one, and "no server" on a green tree is a board crying wolf.
  const deadline = Date.now() + 60000;
  for (;;) {
    try { if ((await (await fetch(`${base}/api/status`)).json()).databaseReady) return; }
    catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('never ready');
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

  let proc = boot(KEY, PORT);
  try {
    await waitReady(BASE);

    const ada = client();
    const adaU = await signUp(ada, 'Ada Boss', `ada${ID}@x.com`, 'principal');
    await ada('PATCH', '/profile', { slug: `ada${ID}` });

    head('The numbers institutions actually ask for:');
    const cat = await ada('GET', '/essentials/catalogue').then((r) => r.d)
      .catch(() => null) || (await ada('GET', `/essentials/${adaU.id}`)).d;
    const all = JSON.stringify(cat);
    for (const f of ['bvn', 'nin', 'tin', 'rc_number', 'voters_card']) {
      ok(`${f} is in the catalogue`, all.includes(`"${f}"`), '');
    }
    for (const f of ['genotype', 'hmo_provider', 'medications', 'doctor', 'yellow_fever_card']) {
      ok(`${f} is in the catalogue`, all.includes(`"${f}"`), '');
    }
    for (const f of ['vehicle_plate', 'office_address', 'lawyer', 'accountant', 'social_handles']) {
      ok(`${f} is in the catalogue`, all.includes(`"${f}"`), '');
    }

    head('Storing them:');
    const bvn = await ada('POST', `/essentials/${adaU.id}`,
      { category: 'identity_numbers', field: 'bvn', value: '22190283746' });
    ok('a BVN saves', bvn.s === 201, JSON.stringify(bvn.d).slice(0, 140));

    const tin = await ada('POST', `/essentials/${adaU.id}`,
      { category: 'identity_numbers', field: 'tin', value: 'TIN-9081726354' });
    ok('a TIN saves', tin.s === 201);

    const geno = await ada('POST', `/essentials/${adaU.id}`,
      { category: 'protection', field: 'genotype', value: 'AA' });
    ok('a genotype saves', geno.s === 201);

    const plate = await ada('POST', `/essentials/${adaU.id}`,
      { category: 'logistics', field: 'vehicle_plate', value: 'LAG-471-KJA' });
    ok('a plate number saves', plate.s === 201);

    const own = await ada('GET', `/essentials/${adaU.id}`);
    const body = JSON.stringify(own.d);
    ok('the BVN comes back masked to its own owner',
      body.includes('3746') && !body.includes('22190283746'), body.slice(0, 200));
    ok('while the TIN comes back in the open, because it is on every invoice',
      body.includes('TIN-9081726354'));

    head('A delegate sees the letterhead numbers and not the banking ones:');
    await ada('POST', '/access-codes', { code: 'DELEGATE-ONE-1', role: 'delegate', uses: 2 });
    const dee = client();
    await signUp(dee, 'Dee Scheduler', `dee${ID}@x.com`, 'pa');
    const joinedD = await dee('POST', '/access-codes/redeem',
      { handle: `ada${ID}`, code: 'DELEGATE-ONE-1' });
    ok('the delegate joins', joinedD.s === 201 && joinedD.d.role === 'delegate', JSON.stringify(joinedD.d));

    const asDelegate = JSON.stringify((await dee('GET', `/essentials/${adaU.id}`)).d);
    ok('the TIN is there for them', asDelegate.includes('TIN-9081726354'));
    ok('the plate is there for them', asDelegate.includes('LAG-471-KJA'));
    // Withheld fields are absent rather than refused — the same 404-not-403
    // reasoning as everywhere else. A masked BVN would still confirm one exists.
    ok('the BVN is absent entirely, not merely masked',
      !asDelegate.includes('bvn') && !asDelegate.includes('3746'), asDelegate.slice(0, 240));
    ok('and so is the genotype', !asDelegate.includes('genotype'));

    head('A Chief of Staff sees them:');
    await ada('POST', '/access-codes', { code: 'CHIEF-TWO-22', role: 'chief_of_staff', uses: 2 });
    const cos = client();
    await signUp(cos, 'Cos Full', `cos${ID}@x.com`, 'ea');
    await cos('POST', '/access-codes/redeem', { handle: `ada${ID}`, code: 'CHIEF-TWO-22' });
    const asChief = JSON.stringify((await cos('GET', `/essentials/${adaU.id}`)).d);
    ok('the BVN is listed for them', asChief.includes('bvn'));
    ok('still masked until deliberately revealed',
      asChief.includes('3746') && !asChief.includes('22190283746'));

    head('Stored as ciphertext, like every sensitive field:');
    const raw = await rawStore();
    // Scoped to this run's principal: a Postgres database carries rows from
    // every earlier run, and an unscoped lookup would inspect somebody else's.
    const bvnRow = (await raw.query(
      "SELECT value, value_enc, sensitivity FROM essentials WHERE field = 'bvn' AND owner_id = $1",
      [adaU.id]))[0];
    ok('the BVN plaintext column is empty', !bvnRow.value);
    ok('and its ciphertext holds nothing that looks like the number',
      /^v1:/.test(bvnRow.value_enc) && !String(bvnRow.value_enc).includes('22190283746'));
    ok('recorded as sensitive', bvnRow.sensitivity === 'sensitive', bvnRow.sensitivity);

    const tinRow = (await raw.query(
      "SELECT value, value_enc, sensitivity FROM essentials WHERE field = 'tin' AND owner_id = $1",
      [adaU.id]))[0];
    ok('the TIN is recorded as ordinary', tinRow.sensitivity === 'ordinary', tinRow.sensitivity);
    ok('and kept readable rather than encrypted', tinRow.value === 'TIN-9081726354' && !tinRow.value_enc);
    await raw.close();

    proc.kill();
    await new Promise((r) => setTimeout(r, 700));

    head('With no encryption key, the mixed group is still half-usable:');
    proc = boot('', PORT + 1);
    const NOKEY = `http://127.0.0.1:${PORT + 1}`;
    await waitReady(NOKEY);

    const nk = async (method, path, body, cookie) => {
      const r = await fetch(`${NOKEY}/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { s: r.status, d: await r.json().catch(() => null), set: r.headers.get('set-cookie') };
    };
    const up = await nk('POST', '/auth/signup',
      { name: 'Ben Reed', email: `ben${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const c = up.set.split(';')[0];
    await nk('POST', '/profile/onboarding-step', { step: 'done' }, c);

    const noKeyTin = await nk('POST', `/essentials/${up.d.user.id}`,
      { category: 'identity_numbers', field: 'tin', value: 'TIN-1122334455' }, c);
    ok('a TIN saves without a key, needing none', noKeyTin.s === 201, JSON.stringify(noKeyTin.d));
    const noKeyBvn = await nk('POST', `/essentials/${up.d.user.id}`,
      { category: 'identity_numbers', field: 'bvn', value: '22190283746' }, c);
    ok('a BVN in the same group is refused rather than stored in the clear',
      noKeyBvn.s === 503, JSON.stringify(noKeyBvn.d));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }
  console.log(fails === 0 ? '\nThe catalogue is wider, and sensitivity is decided per field.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
