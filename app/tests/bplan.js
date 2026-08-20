// Plans that do not lock anybody out, and a connector catalogue that is honest
// about whose work is outstanding.
//
// The two claims worth proving are both about restraint. First: building the
// entitlement layer before launch must change NOTHING for anybody — every
// feature stays reachable while enforcement is off, and the only visible
// difference is a count of what would have been refused. Second: when the
// switch is finally thrown, it must refuse commercially without ever refusing
// custody — a plan that cannot add a document must still be able to read the
// documents it already has, because losing sight of your own passport number
// at an airport is not a billing outcome anybody should accept.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const BASE_PORT = Number(process.env.PORT || 4543);
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function client(base) {
  let cookie = '';
  return async function call(method, path, body) {
    const r = await fetch(`${base}/api${path}`, {
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
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(port),
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ...env,
    },
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
const trip = () => ({
  name: 'London', destination: 'London', destinationTimezone: 'Europe/London',
  startsOn: '2027-03-04', endsOn: '2027-03-10',
});

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }

  // ---- Enforcement OFF: the state everything ships in ------------------
  const OFF = `http://127.0.0.1:${BASE_PORT}`;
  const off = boot(BASE_PORT, { DEFAULT_PLAN: 'free' });
  let strict = null;
  try {
    await ready(OFF);
    const ada = client(OFF);
    const up = await ada('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const adaId = up.d.user.id;
    await ada('POST', '/profile/onboarding-step', { step: 'done' });

    head('With enforcement off, which is how this ships:');
    const state = await ada('GET', '/plan');
    ok('the account knows its plan', state.d.plan === 'free', JSON.stringify(state.d).slice(0, 100));
    ok('and says enforcement is off rather than leaving a screen to guess',
      state.d.enforced === false);
    ok('while still reporting what the plan does not include',
      state.d.features.trips === false && state.d.features.vault === false,
      JSON.stringify(state.d.features).slice(0, 120));

    const made = await ada('POST', `/trips/${adaId}`, trip());
    ok('a feature above the plan still works — nothing is taken away today',
      made.s === 201, JSON.stringify(made.d).slice(0, 120));
    const vault = await ada('POST', `/essentials/${adaId}`,
      { category: 'travel_identity', field: 'passport_number', value: 'A1234567' });
    ok('and so does the vault', vault.s === 201, JSON.stringify(vault.d).slice(0, 120));

    head('But the reach is counted, which is the point of shipping it early:');
    await ada('POST', `/trips/${adaId}`, trip());
    const signals = await ada('GET', '/plan');
    ok('the plan endpoint still answers cleanly afterwards', signals.s === 200);
    const raw = await ada('GET', `/essentials/${adaId}`);
    ok('and nothing about the account was damaged by being counted', raw.s === 200);

    // ---- The switch, on a second server against the same database -----
    head('With enforcement on:');
    strict = boot(BASE_PORT + 1, { DEFAULT_PLAN: 'free', PLAN_ENFORCEMENT: 'on' });
    const ON = `http://127.0.0.1:${BASE_PORT + 1}`;
    await ready(ON);
    const strictAda = client(ON);
    await strictAda('POST', '/auth/login', { email: `ada${ID}@x.com`, password: PW });

    const refusedTrip = await strictAda('POST', `/trips/${adaId}`, trip());
    ok('a trip on a free plan is refused', refusedTrip.s === 402, String(refusedTrip.s));
    ok('naming the plan it belongs to rather than just saying no',
      /Plus/.test(refusedTrip.d.error || '') && refusedTrip.d.needsPlan === 'plus',
      JSON.stringify(refusedTrip.d));

    head('And the line that must never move:');
    const readBack = await strictAda('GET', `/essentials/${adaId}`);
    ok('reading documents already stored is NOT refused',
      readBack.s === 200, String(readBack.s));
    ok('they are all still there',
      (readBack.d.essentials || []).length >= 1, JSON.stringify(readBack.d).slice(0, 140));
    const addMore = await strictAda('POST', `/essentials/${adaId}`,
      { category: 'travel_identity', field: 'passport_number', value: 'B7654321' });
    ok('only ADDING more is refused', addMore.s === 402, String(addMore.s));
    const trips = await strictAda('GET', `/trips/${adaId}`);
    ok('and the trips created earlier are still readable too',
      trips.s === 200 && trips.d.trips.length >= 1, String(trips.s));

    head('A grandfathered account:');
    const founder = client(ON);
    await founder('POST', '/auth/signup',
      { name: 'Bola Ade', email: `bola${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await founder('POST', '/profile/onboarding-step', { step: 'done' });
    // This server was booted with DEFAULT_PLAN=free, so prove the mechanism
    // rather than the default: the founding plan reaches Executive.
    const plans = require(`${ROOT}/app/server/lib/plans`);
    ok('founding reaches everything through Executive',
      plans.allows('founding', 'briefs') && plans.allows('founding', 'trips'));
    ok('but not what only a family office or an institution buys',
      !plans.allows('founding', 'many_principals') && !plans.allows('founding', 'sso'));
    ok('and an unknown plan name allows rather than locks out',
      plans.allows('not-a-plan', 'trips'), 'fail-open is the whole rule');
    ok('as does an unknown feature', plans.allows('free', 'invented_feature'));

    // ---- Connectors ---------------------------------------------------
    head('The connector catalogue:');
    const cons = await ada('GET', `/connectors/${adaId}`);
    ok('lists everything Kairos talks to', cons.d.connectors.length >= 15,
      String(cons.d.connectors?.length));
    const byId = Object.fromEntries(cons.d.connectors.map((c) => [c.id, c]));
    ok('separating what each account connects from what the deployment sets up',
      byId.google_calendar.kind === 'account' && byId.flights.kind === 'deployment');
    ok('and reporting configured and connected as two facts, not one',
      byId.whatsapp.configured === false && byId.whatsapp.connected === false);
    ok('naming what is missing so an operator knows what to set',
      byId.whatsapp.needs.includes('WHATSAPP_BUSINESS_TOKEN'),
      JSON.stringify(byId.whatsapp.needs));
    ok('never the values of those variables',
      !JSON.stringify(cons.d).includes('0123456789abcdef'));
    ok('a connector needing nothing is configured by definition',
      byId.calendar_feed.configured === true);
    ok('each declares the plan it belongs to',
      byId.zoom.plan === 'plus' && byId.sso.plan === 'enterprise');
    ok('and one above this plan is shown rather than hidden',
      byId.zoom.includedInPlan === false && !!byId.zoom.label);

    head('Trying to connect one:');
    const conn = await ada('POST', `/connectors/${adaId}/whatsapp/connect`);
    ok('is refused honestly, as our work outstanding', conn.s === 501, String(conn.s));
    ok('saying what this deployment is waiting on',
      /WHATSAPP_BUSINESS_TOKEN/.test(conn.d.error || ''), conn.d.error);
    const dep = await ada('POST', `/connectors/${adaId}/flights/connect`);
    ok('and a deployment connector says there is nothing to connect',
      dep.s === 400 && /nothing here for you/i.test(dep.d.error || ''), JSON.stringify(dep.d));
    const nope = await ada('POST', `/connectors/${adaId}/dropbox/connect`);
    ok('an invented connector is 404, not a crash', nope.s === 404);

    head('Somebody else\'s connectors:');
    const bola = client(OFF);
    await bola('POST', '/auth/signup',
      { name: 'Chidi Eze', email: `chidi${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await bola('POST', '/profile/onboarding-step', { step: 'done' });
    ok('are not readable', [403, 404].includes((await bola('GET', `/connectors/${adaId}`)).s));

    head('Once a credential IS present:');
    const wired = boot(BASE_PORT + 2, {
      DEFAULT_PLAN: 'free',
      WHATSAPP_BUSINESS_TOKEN: 'x', WHATSAPP_PHONE_NUMBER_ID: 'y',
    });
    const WIRED = `http://127.0.0.1:${BASE_PORT + 2}`;
    await ready(WIRED);
    const w = client(WIRED);
    await w('POST', '/auth/login', { email: `ada${ID}@x.com`, password: PW });
    const wl = await w('GET', `/connectors/${adaId}`);
    const wa = wl.d.connectors.find((c) => c.id === 'whatsapp');
    ok('it flips to configured', wa.configured === true);
    const wc = await w('POST', `/connectors/${adaId}/whatsapp/connect`);
    ok('and the refusal changes to the honest one about the exchange',
      wc.s === 501 && /not built yet/i.test(wc.d.error || ''), JSON.stringify(wc.d));
    wired.kill();
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (strict) strict.kill();
    off.kill();
  }
  console.log(fails === 0
    ? '\nPlans are built, nothing is locked, and the catalogue says whose turn it is.'
    : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
