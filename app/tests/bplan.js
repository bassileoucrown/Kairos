// What a plan includes, and the four things no plan may ever withhold.
//
// WHY THIS SUITE MATTERS MORE THAN A PRICE SHEET USUALLY WOULD. Entitlement
// code sits next to access-control code and looks like it, and the day the two
// are confused a billing bug becomes a data breach. lib/plans.js states three
// rules to stop that; this file is what keeps them true after somebody adds a
// feature at four in the afternoon.
//
//   1. Entitlement is never access control.
//   2. It fails open — unknown plan, unreadable row, missing column ⇒ allow.
//   3. Safety is never gated.
//
// RULE 3 IS THE ONE WITH TEETH HERE, and it has a specific trap in it. An
// arrival alarm and a duress signal only exist for a movement that exists, so
// gating "create a movement" would silence a panic button while the sheet
// still said movements were merely a paid feature. The fleet is charged for;
// the journey is not. That is asserted directly rather than trusted.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4651, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
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

(async () => {
  const fs = require('fs');
  const { spawn } = require('child_process');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }
  // ENFORCEMENT ON, which no deployment currently runs with. That is the
  // point: the refusals only become visible with the switch thrown, and a
  // suite that ran with it off would prove the sheet compiles and nothing
  // else. Everything asserted here is what an office would experience the day
  // somebody turns it on — which is exactly when a mistake would be found.
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      PLAN_ENFORCEMENT: 'on', DEFAULT_PLAN: 'free',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const db = require(`${ROOT}/app/server/lib/db`);
  const plans = require(`${ROOT}/app/server/lib/plans`);

  try {
    const deadline = Date.now() + 150000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    // ---- The shape of the sheet ------------------------------------------------
    head('The sheet holds together on its own terms:');
    // A feature pointing at a rung that does not exist would allow everything,
    // by rule 2, and look like a deliberate decision.
    ok('every feature names a plan that exists',
      Object.values(plans.FEATURES).every((f) => !!plans.PLANS[f.plan]),
      JSON.stringify(Object.entries(plans.FEATURES)
        .filter(([, f]) => !plans.PLANS[f.plan]).map(([k]) => k)));
    ok('every retired plan name maps to one that exists',
      Object.values(plans.ALIASES).every((v) => !!plans.PLANS[v]),
      JSON.stringify(plans.ALIASES));
    // An alias that mapped DOWNWARDS would quietly re-price existing accounts
    // on deploy, which is the one thing a rename must not do.
    ok('and none of them maps to a lower rung',
      Object.entries(plans.ALIASES).every(([, to]) => plans.PLANS[to].rank >= 1),
      JSON.stringify(plans.ALIASES));
    ok('every metered thing has an allowance for every plan',
      Object.values(plans.METERED).every((m) => Object.keys(plans.PLANS)
        .filter((p) => p !== 'founding')
        .every((p) => Number.isFinite(m.allowance[p]))),
      JSON.stringify(Object.entries(plans.METERED)
        .map(([k, m]) => [k, Object.keys(m.allowance)])));

    // ---- RULE 3, asserted rather than believed -----------------------------------
    head('Nothing that keeps somebody safe is on the sheet at all:');
    for (const key of Object.keys(plans.NEVER_GATED)) {
      ok(`${key} is not a gated feature`, !plans.FEATURES[key],
        JSON.stringify(plans.FEATURES[key]));
    }
    // THE TRAP THIS SUITE EXISTS FOR. The fleet may be charged for; the
    // journey the alarm hangs off may not. A feature literally named
    // "movements" would be the easy, wrong thing to add back.
    ok('and there is no feature that gates a journey itself',
      !plans.FEATURES.movements && !!plans.FEATURES.movement_fleet,
      JSON.stringify(Object.keys(plans.FEATURES)));

    // ---- On the lowest plan there is -----------------------------------------------
    const free = client();
    const freeId = (await free('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' })).d.user.id;
    await free('POST', '/profile/onboarding-step', { step: 'done' });
    await db.prepare("UPDATE users SET plan = 'free' WHERE id = ?").run(freeId);

    head('A free account is refused the things that are charged for:');
    let r = await free('POST', `/movement/${freeId}/vehicles`, { label: 'The black Prado' });
    ok('a car on the roster is refused', r.s === 402, `${r.s} ${JSON.stringify(r.d).slice(0, 140)}`);
    ok('and it says which plan it belongs to',
      r.d.needsPlan === 'principal', JSON.stringify(r.d));
    ok('a space is refused', (await free('POST', '/spaces',
      { name: 'The board', context: 'work' })).s === 402);
    ok('and an assistant is refused',
      (await free('POST', '/members', { email: `x${ID}@y.com`, role: 'pa' })).s === 402);

    head('But never the things that keep somebody safe:');
    // THE ASSERTION THE WHOLE FILE IS FOR. On the lowest plan there is, with
    // enforcement on, a journey can still be recorded — because the arrival
    // alarm and the duress signal hang off it.
    r = await free('POST', `/movement/${freeId}/movements`, {
      title: 'To the airport', departsFrom: 'Ikoyi', destination: 'MMIA',
      departsAt: new Date(Date.now() + 3600000).toISOString(), expectedMinutes: 45,
    });
    ok('a journey can still be recorded', r.s === 201, `${r.s} ${JSON.stringify(r.d).slice(0, 160)}`);
    const movementId = r.d.movement?.id;
    ok('and confirming the arrival still works',
      (await free('POST', `/movement/${freeId}/movements/${movementId}/arrived`)).s === 200);

    // Security, and reading back what is already there.
    ok('the device list is not behind a plan',
      (await free('GET', '/security/sessions')).s === 200);
    ok('and neither is reading the vault',
      (await free('GET', `/essentials/${freeId}`)).s === 200);
    // Taking your own records out. A product that is hard to leave has stopped
    // competing on being good.
    ok('nor taking the week away as a file',
      (await free('GET', `/report/${freeId}/export`)).s === 200);

    // ---- The rung that covers it ----------------------------------------------------
    head('And the plan that covers it lets it through:');
    await db.prepare("UPDATE users SET plan = 'principal' WHERE id = ?").run(freeId);
    ok('the same car is accepted on Principal',
      (await free('POST', `/movement/${freeId}/vehicles`, { label: 'The black Prado' })).s === 201);
    // POSITIVE CONTROL in the other direction: Principal does NOT reach Office.
    ok('though a space is still one rung up',
      (await free('POST', '/spaces', { name: 'The board', context: 'work' })).s === 402);
    await db.prepare("UPDATE users SET plan = 'office' WHERE id = ?").run(freeId);
    ok('and Office reaches it', (await free('POST', '/spaces',
      { name: 'The board', context: 'work' })).s === 201);

    // ---- The old names still mean something -------------------------------------------
    head('An account created before the rename is not quietly re-priced:');
    await db.prepare("UPDATE users SET plan = 'plus' WHERE id = ?").run(freeId);
    ok('a row still saying "plus" reaches everything Office reaches',
      (await free('POST', '/spaces', { name: 'Another', context: 'work' })).s === 201);
    await db.prepare("UPDATE users SET plan = 'standard' WHERE id = ?").run(freeId);
    ok('and "standard" reaches everything Principal reaches',
      (await free('POST', `/movement/${freeId}/vehicles`, { label: 'The silver one' })).s === 201);
    ok('while stopping where Principal stops',
      (await free('POST', '/spaces', { name: 'Third', context: 'work' })).s === 402);

    // ---- Rule 2 ------------------------------------------------------------------------
    head('And an account with no plan at all is allowed, not refused:');
    // THE FAILURE MODE THIS PREVENTS is somebody at an airport unable to read
    // their own visa number because a database default did not apply.
    //
    // An empty string rather than NULL: users.plan is NOT NULL with a default,
    // so a genuine null cannot occur — asserting it would have been testing a
    // state the schema forbids. Empty is what a half-run migration or a bad
    // import actually leaves behind, and it is the case rule 2 is for.
    await db.prepare("UPDATE users SET plan = '' WHERE id = ?").run(freeId);
    ok('an empty plan falls back rather than refusing',
      (await free('POST', `/movement/${freeId}/vehicles`, { label: 'The unknown one' })).s === 201);
    await db.prepare("UPDATE users SET plan = 'gold_platinum_deluxe' WHERE id = ?").run(freeId);
    ok('and so does a plan name nobody has heard of',
      (await free('POST', `/movement/${freeId}/vehicles`, { label: 'The other one' })).s === 201);

    // ---- What was reached for is recorded ------------------------------------------------
    head('Every refusal left evidence behind:');
    const signals = await db.prepare('SELECT feature, times FROM plan_signals WHERE owner_id = ?')
      .all(freeId);
    ok('the reaches were counted',
      signals.some((s) => s.feature === 'spaces') && signals.some((s) => s.feature === 'movement_fleet'),
      JSON.stringify(signals));
    // Aggregated per feature rather than one row per press: the question is
    // "which boundary is in the wrong place", and a row per click is a log.
    ok('and counted per feature rather than per press',
      signals.every((s) => Number(s.times) >= 1)
      && new Set(signals.map((s) => s.feature)).size === signals.length,
      JSON.stringify(signals));

    // ---- What a screen is told ---------------------------------------------------------
    head('And a screen can say all of it before anybody presses:');
    await db.prepare("UPDATE users SET plan = 'principal' WHERE id = ?").run(freeId);
    r = await free('GET', '/plan');
    ok('the plan comes back with the question it answers',
      r.d.plan === 'principal' && /own day/i.test(r.d.question || ''), JSON.stringify(r.d).slice(0, 200));
    ok('with every feature resolved',
      Object.keys(r.d.features || {}).length === Object.keys(plans.FEATURES).length);
    ok('the metered things carry an allowance rather than a yes or no',
      Number.isFinite(r.d.metered?.ai_assist?.allowance), JSON.stringify(r.d.metered));
    // Worth as much to a nervous buyer as the list of what they get.
    ok('and it says what is never at risk',
      Object.keys(r.d.neverGated || {}).length === Object.keys(plans.NEVER_GATED).length,
      JSON.stringify(r.d.neverGated));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA plan decides what you can add, never what you can read, leave with, or be kept safe by.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
