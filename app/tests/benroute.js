// A journey while it is happening: check calls, the driver's card, and duress.
//
// ONE ARRIVAL IS NOT ENOUGH. A ninety-minute run with no contact until the end
// means that if something happens twenty minutes in, nobody learns of it for
// over an hour. So a long journey is laid out with check calls, and a check
// call nobody answered raises the same kind of alarm a missing arrival does —
// only earlier, inside a window somebody can act in.
//
// THE CARD IS THE HALF THAT CLOSES THE LOOP. The office's alarm fires because
// nobody pressed arrived; the person who actually knows is the driver, who has
// no account and never will. So the token in the URL is the whole credential.
//
// AND THAT IS ONLY SAFE BECAUSE THE CARD IS THIN, which is what most of this
// file checks. The link has no password and can be forwarded. It must show a
// journey between two places in a car with a plate — and nothing that says
// WHOSE journey it is. No principal's name, no escort, no notes. The
// assertions about what is NOT on the card are the point of this suite.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4620, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
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
    return { s: r.status, d: json, text };
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
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const db = require(`${ROOT}/app/server/lib/db`);

  try {
    const deadline = Date.now() + 150000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const pa = client();
    await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    let inv = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    const cos = client();
    await cos('POST', '/auth/signup',
      { name: 'Tunde Bakare', email: `tunde${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await cos('POST', '/profile/onboarding-step', { step: 'done' });
    inv = await boss('POST', '/members', { email: `tunde${ID}@x.com`, role: 'chief_of_staff' });
    await cos('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    // ---- Check calls ---------------------------------------------------------
    head('A long journey is laid out with check calls:');
    // A short hop. Nothing to check in the middle of.
    let r = await pa('POST', `/movement/${bossId}/movements`, {
      title: 'To the office', departsFrom: 'Ikoyi', destination: 'Victoria Island',
      departsAt: new Date(Date.now() + 3600000).toISOString(), expectedMinutes: 20,
    });
    const shortId = r.d.movement.id;
    let route = await pa('GET', `/movement/${bossId}/movements/${shortId}/route`);
    // THE POSITIVE CONTROL FOR THE WHOLE IDEA. Ceremony on short journeys is
    // how an office learns to ignore the ceremony.
    ok('a twenty-minute hop gets none', (route.d.checks || []).length === 0,
      JSON.stringify(route.d.checks));

    r = await pa('POST', `/movement/${bossId}/movements`, {
      title: 'To the airport', departsFrom: 'Ikoyi', destination: 'MMIA',
      departsAt: new Date(Date.now() - 2 * 3600000).toISOString(), expectedMinutes: 90,
    });
    const longId = r.d.movement.id;
    route = await pa('GET', `/movement/${bossId}/movements/${longId}/route`);
    const checks = route.d.checks || [];
    ok('a ninety-minute run gets them every half hour', checks.length === 2,
      JSON.stringify(checks.map((c) => c.dueAt)));
    ok('and they are already missed, being two hours old',
      checks.every((c) => c.missed === true), JSON.stringify(checks));

    const { runReminderSweep } = require(`${ROOT}/app/server/lib/reminders`);
    const swept = await runReminderSweep();
    ok('the sweep raises the missed ones', swept.checks > 0, JSON.stringify(swept));

    const told = await db.prepare(
      "SELECT to_email FROM emails WHERE category = 'movement_check_missed'",
    ).all();
    const toldTo = new Set(told.map((t) => t.to_email));
    ok('the principal and the arranger are told',
      toldTo.has(`ada${ID}@x.com`) && toldTo.has(`ngozi${ID}@x.com`), JSON.stringify([...toldTo]));
    // Losing contact with a principal is the most sensitive thing this product
    // will say about a person.
    ok('and the Chief of Staff is not', !toldTo.has(`tunde${ID}@x.com`),
      JSON.stringify([...toldTo]));
    const again = await runReminderSweep();
    ok('raised once, not at every sweep', again.checks === 0, JSON.stringify(again));

    // ---- The driver's card ---------------------------------------------------
    head('The driver gets a card, and it names nobody:');
    // Something on the journey that must NOT reach the card.
    await pa('POST', `/movement/${bossId}/movements/${longId}/vehicles`,
      { role: 'principal', plate: 'ABC-123-XY', description: 'Black Prado' });
    await pa('POST', `/movement/${bossId}/movements/${longId}/vehicles`,
      { role: 'backup', plate: 'XYZ-777-AA', description: 'Silver Hilux' });
    await pa('POST', `/movement/${bossId}/movements/${longId}/people`,
      { role: 'escort_lead', name: 'Inspector Musa', phone: '+2348030000002' });

    r = await pa('POST', `/movement/${bossId}/movements/${longId}/card`);
    const token = (r.d.url || '').split('/').pop();
    ok('a card can be armed', r.s === 201 && !!token, `${r.s} ${JSON.stringify(r.d)}`);

    // Fetched with NO session at all — a fresh client that never signed in.
    const anon = client();
    let cardR = await anon('GET', `/drive/${token}`);
    const card = cardR.d.card;
    ok('and opens with no account', cardR.s === 200 && !!card, String(cardR.s));
    ok('carrying the journey', card.departsFrom === 'Ikoyi' && card.destination === 'MMIA',
      JSON.stringify(card).slice(0, 200));
    ok('and the car to drive', /ABC-123-XY/.test(JSON.stringify(card.car)),
      JSON.stringify(card.car));

    // THE ASSERTIONS THIS FILE EXISTS FOR. This link has no password.
    const seen = JSON.stringify(card);
    ok('but not whose journey it is', !/Adaeze|Okonkwo/.test(seen), seen.slice(0, 300));
    ok('nor the escort', !/Musa/.test(seen), seen.slice(0, 300));
    ok('nor the backup car', !/XYZ-777-AA/.test(seen));
    // POSITIVE CONTROL: all three ARE on the arranger's view, so their absence
    // above is redaction and not an empty card.
    const full = JSON.stringify((await pa('GET', `/movement/${bossId}/movements/${longId}`)).d);
    ok('though all three are on the office\'s own view',
      /Musa/.test(full) && /XYZ-777-AA/.test(full), full.slice(0, 200));

    // ---- Closing the loop ----------------------------------------------------
    head('And the person who knows can say so:');
    cardR = await anon('POST', `/drive/${token}/checks/${checks[0].id}`);
    ok('the driver can answer a check call',
      cardR.d.card?.checks?.[0]?.checkedAt, JSON.stringify(cardR.d.card?.checks));
    // Nobody signed in did it, and recording the office's last reader would be
    // a lie on a safety record.
    const row = await db.prepare('SELECT checked_by FROM movement_checks WHERE id = ?')
      .get(checks[0].id);
    ok('and it is not recorded as somebody in the office', !row.checked_by,
      String(row.checked_by));

    cardR = await anon('POST', `/drive/${token}/arrived`);
    ok('the driver can say they arrived', !!cardR.d.card?.arrivedAt, JSON.stringify(cardR.d.card));
    r = await pa('GET', `/movement/${bossId}/movements/${longId}`);
    ok('and the office sees it', !!r.d.movement.arrivedAt);
    ok('so it stops being late', r.d.movement.lateByMinutes === null,
      String(r.d.movement.lateByMinutes));

    // ---- Duress --------------------------------------------------------------
    head('And the one button nobody wants to need:');
    r = await pa('POST', `/movement/${bossId}/movements`, {
      title: 'The evening run', departsFrom: 'Ikoyi', destination: 'Lekki',
      departsAt: new Date(Date.now() - 600000).toISOString(), expectedMinutes: 60,
    });
    const runId = r.d.movement.id;
    const runToken = (await pa('POST', `/movement/${bossId}/movements/${runId}/card`)).d.url
      .split('/').pop();

    const before = (await db.prepare(
      "SELECT COUNT(*) AS n FROM emails WHERE category = 'movement_duress'",
    ).get()).n;
    r = await anon('POST', `/drive/${runToken}/duress`, { note: 'Two cars following us' });
    ok('it can be raised from the car', r.s === 200, String(r.s));
    // NOT at the next sweep. Ten minutes is the wrong number for this one.
    const after = (await db.prepare(
      "SELECT COUNT(*) AS n FROM emails WHERE category = 'movement_duress'",
    ).get()).n;
    ok('and the office is told at once, not at the next sweep', after > before,
      `${before} → ${after}`);

    const duressTold = new Set((await db.prepare(
      "SELECT to_email FROM emails WHERE category = 'movement_duress'",
    ).all()).map((t) => t.to_email));
    ok('the principal and the arranger are told',
      duressTold.has(`ada${ID}@x.com`) && duressTold.has(`ngozi${ID}@x.com`),
      JSON.stringify([...duressTold]));
    ok('and nobody else', !duressTold.has(`tunde${ID}@x.com`), JSON.stringify([...duressTold]));

    // The card says only that it was received. Telling whoever holds the phone
    // "we have alerted four people" is telling the wrong person about the office.
    ok('the card does not report back who was told',
      !/ada|ngozi|Okonkwo/i.test(JSON.stringify(r.d)), JSON.stringify(r.d));

    // ONE DIRECTION ONLY from the card.
    r = await anon('DELETE', `/drive/${runToken}/duress`);
    ok('and it cannot be stood down from the same phone that raised it',
      r.s === 404 || r.s === 405, String(r.s));
    // But somebody signed in can.
    ok('though the office can stand it down',
      (await pa('DELETE', `/movement/${bossId}/movements/${runId}/duress`)).s === 204);
    // And the fact that it happened stays on the record.
    const logged = await db.prepare(
      "SELECT COUNT(*) AS n FROM access_log WHERE action = 'duress_cleared'",
    ).get();
    ok('and standing it down is itself on the record', Number(logged.n) === 1, JSON.stringify(logged));

    // ---- Taking the card down ------------------------------------------------
    head('And a card can be taken down:');
    ok('the office takes it down',
      (await pa('DELETE', `/movement/${bossId}/movements/${longId}/card`)).s === 204);
    ok('after which the link is dead',
      (await anon('GET', `/drive/${token}`)).s === 404);
    // A guessed token answers the same way an expired one does.
    ok('and a guessed one says nothing different',
      (await anon('GET', '/drive/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).s === 404);

    // ---- What it cost --------------------------------------------------------
    head('And what the journey cost stays inside the office:');
    r = await pa('POST', `/movement/${bossId}/movements/${runId}/costs`,
      { kind: 'fuel', amountMinor: 4500000, currency: 'NGN', note: 'Full tank' });
    ok('a cost can be recorded', r.s === 201, `${r.s} ${JSON.stringify(r.d).slice(0, 140)}`);
    ok('and totalled in its own currency', r.d.costs.totals.NGN === 4500000,
      JSON.stringify(r.d.costs.totals));
    ok('an invented kind is refused',
      (await pa('POST', `/movement/${bossId}/movements/${runId}/costs`,
        { kind: 'vibes', amountMinor: 100 })).s === 400);

    // ---- The drivers ---------------------------------------------------------
    head('The people who drive have papers too:');
    r = await pa('POST', `/movement/${bossId}/drivers`,
      { name: 'Sunday Eze', phone: '+2348030000001' });
    const driverId = r.d.driver?.id;
    ok('a driver goes on the books', r.s === 201 && !!driverId, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);

    const gone = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const near = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    ok('a licence can be recorded',
      (await pa('POST', `/movement/${bossId}/drivers/${driverId}/papers`,
        { kind: 'licence', reference: 'LIC-9', expiresOn: near })).s === 201);
    ok('an invented kind is refused',
      (await pa('POST', `/movement/${bossId}/drivers/${driverId}/papers`,
        { kind: 'vibes', expiresOn: near })).s === 400);

    r = await pa('GET', `/movement/${bossId}/drivers`);
    let driver = (r.d.drivers || []).find((d) => d.id === driverId);
    // THE SAME ENGINE AS A PASSPORT AND A CAR'S INSURANCE. A third idea of
    // "nearly out of date" would drift from the other two.
    ok('and is judged by the same expiry engine',
      driver?.papers?.[0]?.state === 'expiring', JSON.stringify(driver?.papers));
    // POSITIVE CONTROL for the flag below: a driver with a valid licence is
    // not flagged, so the flag means something when it appears.
    ok('a driver whose papers are current is not flagged', driver?.lapsed === false,
      String(driver?.lapsed));

    await pa('POST', `/movement/${bossId}/drivers/${driverId}/papers`,
      { kind: 'permit', reference: 'P-1', expiresOn: gone });
    driver = ((await pa('GET', `/movement/${bossId}/drivers`)).d.drivers || [])
      .find((d) => d.id === driverId);
    ok('one with a lapsed paper is', driver?.lapsed === true, String(driver?.lapsed));

    // It reaches the day sheet, where a passport's expiry already goes.
    const today = await pa('GET', `/today/${bossId}`);
    ok('and it turns up on Today',
      (today.d.needsYou?.driversLapsed || []).some((d) => d.id === driverId),
      JSON.stringify(today.d.needsYou?.driversLapsed));

    // Putting a driver on a journey copies their details rather than joining,
    // so the record survives them leaving the office.
    r = await pa('POST', `/movement/${bossId}/movements/${runId}/people`,
      { role: 'driver', driverId });
    ok('a movement can take a driver from the roster', r.s === 201, String(r.s));
    ok('and their name comes with them',
      (r.d.movement.people || []).some((x) => x.name === 'Sunday Eze'),
      JSON.stringify(r.d.movement.people));
    ok('a driver from another office is refused',
      (await pa('POST', `/movement/${bossId}/movements/${runId}/people`,
        { role: 'driver', driverId: 'nobody' })).s === 400);

    // ---- A journey that repeats ----------------------------------------------
    head('A journey that repeats is laid down, not retyped:');
    r = await pa('POST', `/movement/${bossId}/series`, {
      title: 'The school run', departsFrom: 'Ikoyi', destination: 'Grange',
      timeOfDay: '06:40', days: [1, 2, 3, 4, 5], expectedMinutes: 35,
    });
    const seriesId = r.d.seriesId;
    ok('a pattern lays down four weeks of journeys', r.s === 201 && r.d.made >= 18,
      `${r.s} ${JSON.stringify(r.d)}`);
    ok('a pattern with no days is refused',
      (await pa('POST', `/movement/${bossId}/series`,
        { title: 'x', timeOfDay: '06:40', days: [] })).s === 400);
    ok('and one with no time',
      (await pa('POST', `/movement/${bossId}/series`,
        { title: 'x', days: [1], timeOfDay: 'soon' })).s === 400);

    // Run twice, and the week does not double.
    const before2 = (await db.prepare(
      'SELECT COUNT(*) AS n FROM movements WHERE series_id = ?',
    ).get(seriesId)).n;
    await pa('POST', `/movement/${bossId}/series`, {
      title: 'The school run', departsFrom: 'Ikoyi', destination: 'Grange',
      timeOfDay: '06:40', days: [1, 2, 3, 4, 5], expectedMinutes: 35,
    });
    const sameSeries = (await db.prepare(
      'SELECT COUNT(*) AS n FROM movements WHERE series_id = ?',
    ).get(seriesId)).n;
    ok('laying the same pattern again does not double it',
      Number(sameSeries) === Number(before2), `${before2} → ${sameSeries}`);

    // Each occurrence is a real journey with its own access rule and its own
    // arrival — not a rule evaluated at read time.
    const one = await db.prepare(
      'SELECT * FROM movements WHERE series_id = ? ORDER BY departs_at LIMIT 1',
    ).get(seriesId);
    ok('each occurrence is a real journey', !!one?.id);
    ok('with its own expected arrival', one.expected_minutes === 35, String(one.expected_minutes));
    ok('and the Chief of Staff sees none of them',
      (await cos('GET', `/movement/${bossId}/movements/${one.id}`)).s === 404);

    // Stopping the pattern leaves the past alone.
    await db.prepare('UPDATE movements SET arrived_at = ? WHERE id = ?')
      .run(new Date().toISOString(), one.id);
    r = await pa('DELETE', `/movement/${bossId}/series/${seriesId}`);
    ok('stopping it removes what has not happened', r.d.removed > 0, JSON.stringify(r.d));
    // THE ASSERTION THIS SECTION EXISTS FOR. A movement is a safety record and
    // cancelling a pattern must never erase a journey that took place.
    const kept = await db.prepare('SELECT id FROM movements WHERE id = ?').get(one.id);
    ok('but never one that already happened', !!kept, JSON.stringify(kept));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA journey is watched while it happens, and the card the driver holds names nobody.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
