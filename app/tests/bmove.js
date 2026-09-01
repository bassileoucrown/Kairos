// Moving a principal on the ground, and who is allowed to know how.
//
// A TRIP IS NOT ONLY A FLIGHT. In Lagos or Abuja the road is the part with
// risk in it: who is driving, in which car, with which escort, leaving when —
// and afterwards, whether they arrived. None of that had anywhere to live.
//
// THE ACCESS RULE IS THE VAULT'S, NOT THE DIARY'S, and that is what most of
// this file checks. An escort roster is a pattern of somebody's movements with
// names and numbers on it; leaked, it is a brief for whoever is planning
// against them. So: the principal, and whoever arranged it. Not the wider
// office. Not a Chief of Staff who can otherwise see everything — that rule is
// about work, and this is somebody's safety.
//
// AND ONE DOOR OUT OF IT, because a rule with no exception gets broken in the
// worst way — an arranger off sick and nobody able to ring the driver. So
// access opens ONCE, for ONE journey, expiring on its own, and the stand-in
// gets what they need to coordinate rather than the roster. The assertions
// about what they DO NOT get are the point of this file.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4617, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
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
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

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

    // The PA who arranges the movement.
    const pa = client();
    const paUp = await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    const paId = paUp.d.user.id;
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    let inv = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    // The Chief of Staff, who can otherwise see the whole office.
    const cos = client();
    const cosUp = await cos('POST', '/auth/signup',
      { name: 'Tunde Bakare', email: `tunde${ID}@x.com`, password: PW, accountCategory: 'pa' });
    const cosId = cosUp.d.user.id;
    await cos('POST', '/profile/onboarding-step', { step: 'done' });
    inv = await boss('POST', '/members', { email: `tunde${ID}@x.com`, role: 'chief_of_staff' });
    await cos('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    // ---- The fleet ----------------------------------------------------------
    head('The cars are things, not a line of text on a leg:');
    let r = await pa('POST', `/movement/${bossId}/vehicles`,
      { label: 'The Prado', plate: 'ABC-123-XY', makeModel: 'Toyota Land Cruiser Prado', colour: 'Black' });
    const carId = r.d.vehicle?.id;
    ok('a car can be put on the books', r.s === 201, `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);
    ok('with its plate', r.d.vehicle?.plate === 'ABC-123-XY', JSON.stringify(r.d.vehicle));

    // Papers that lapse, judged by the SAME engine as a passport.
    const soon = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const far = new Date(Date.now() + 900 * 86400000).toISOString().slice(0, 10);
    ok('insurance can be recorded against it',
      (await pa('POST', `/movement/${bossId}/vehicles/${carId}/papers`,
        { kind: 'insurance', reference: 'POL-9911', expiresOn: soon })).s === 201);
    await pa('POST', `/movement/${bossId}/vehicles/${carId}/papers`,
      { kind: 'roadworthiness', reference: 'RW-22', expiresOn: past });
    await pa('POST', `/movement/${bossId}/vehicles/${carId}/papers`,
      { kind: 'licence', reference: 'LIC-1', expiresOn: far });
    ok('an invented kind of paper is refused',
      (await pa('POST', `/movement/${bossId}/vehicles/${carId}/papers`,
        { kind: 'vibes', expiresOn: soon })).s === 400);

    r = await pa('GET', `/movement/${bossId}/vehicles`);
    const car = (r.d.vehicles || [])[0];
    const paper = (k) => (car?.papers || []).find((p) => p.kind === k);
    ok('the papers come back with the car', (car?.papers || []).length === 3,
      JSON.stringify(car?.papers));
    // THE POINT OF REUSING THE EXPIRY ENGINE: one idea of "nearly out of
    // date", not a second one that drifts from the first.
    ok('one already lapsed says so', paper('roadworthiness')?.state === 'expired',
      paper('roadworthiness')?.state);
    ok('one close to lapsing says so too', paper('insurance')?.state === 'expiring',
      paper('insurance')?.state);
    ok('and one with years on it says nothing', paper('licence')?.state === null,
      String(paper('licence')?.state));

    // ---- A movement ---------------------------------------------------------
    head('A movement is arranged, and it is not the office\'s business:');
    r = await pa('POST', `/movement/${bossId}/movements`, {
      title: 'To the Lekki site',
      departsFrom: 'Ikoyi residence',
      destination: 'Lekki Phase 1',
      departsAt: new Date(Date.now() + 3 * 3600000).toISOString(),
      bufferMinutes: 20,
      notes: 'Chairman prefers the coast road.',
    });
    const moveId = r.d.movement?.id;
    ok('the assistant arranges it', r.s === 201, `${r.s} ${JSON.stringify(r.d).slice(0, 140)}`);

    await pa('POST', `/movement/${bossId}/movements/${moveId}/vehicles`,
      { vehicleId: carId, role: 'principal' });
    await pa('POST', `/movement/${bossId}/movements/${moveId}/vehicles`,
      { role: 'backup', plate: 'XYZ-777-AA', description: 'Silver Hilux' });
    await pa('POST', `/movement/${bossId}/movements/${moveId}/people`,
      { role: 'driver', name: 'Sunday Eze', phone: '+2348030000001' });
    await pa('POST', `/movement/${bossId}/movements/${moveId}/people`,
      { role: 'escort_lead', name: 'Inspector Musa', phone: '+2348030000002' });

    r = await pa('GET', `/movement/${bossId}/movements/${moveId}`);
    ok('the arranger sees all of it', r.d.movement?.access === 'full', r.d.movement?.access);
    ok('with both cars and both people',
      r.d.movement.vehicles.length === 2 && r.d.movement.people.length === 2,
      JSON.stringify({ v: r.d.movement.vehicles.length, p: r.d.movement.people.length }));
    // The plate is copied on rather than joined, so the record survives the car
    // being sold.
    ok('the car\'s plate is copied onto the movement',
      r.d.movement.vehicles.some((v) => v.plate === 'ABC-123-XY'),
      JSON.stringify(r.d.movement.vehicles));
    ok('and the principal sees it too',
      (await boss('GET', `/movement/${bossId}/movements/${moveId}`)).d.movement?.access === 'full');

    // POSITIVE CONTROL FOR THE LIST, which is a SECOND query answering the same
    // question as the gate, and two queries answering one question drift. If the
    // list were simply broken, the emptiness asserted below would prove nothing.
    ok('the arranger\'s own list has it',
      ((await pa('GET', `/movement/${bossId}/movements`)).d.movements || [])
        .some((m) => m.id === moveId));

    // THE ASSERTION THIS FILE EXISTS FOR.
    ok('the Chief of Staff, who sees the whole office, does not see this',
      (await cos('GET', `/movement/${bossId}/movements/${moveId}`)).s === 404);
    ok('and it is not in their list',
      ((await cos('GET', `/movement/${bossId}/movements`)).d.movements || []).length === 0);
    // POSITIVE CONTROL: they can reach the office's cars, so the 404 above is
    // about the movement and not about them being shut out of everything.
    ok('though the fleet is ordinary office information to them',
      ((await cos('GET', `/movement/${bossId}/vehicles`)).d.vehicles || []).length === 1);

    // ---- Covering for somebody ----------------------------------------------
    head('And when the arranger is not there, it can be opened once:');
    ok('the Chief of Staff cannot open it for themselves',
      (await cos('POST', `/movement/${bossId}/movements/${moveId}/grants`,
        { userId: cosId })).s === 404);
    ok('a stranger to the office cannot be given it',
      (await pa('POST', `/movement/${bossId}/movements/${moveId}/grants`,
        { userId: 'nobody' })).s === 400);

    r = await pa('POST', `/movement/${bossId}/movements/${moveId}/grants`,
      { userId: cosId, reason: 'I am out on Thursday' });
    ok('the arranger can hand it over for one journey', r.s === 201,
      `${r.s} ${JSON.stringify(r.d).slice(0, 120)}`);

    r = await cos('GET', `/movement/${bossId}/movements/${moveId}`);
    const seen = r.d.movement;
    ok('and now they can open it', r.s === 200 && !!seen, String(r.s));
    ok('but only as far as coordinating it', seen?.access === 'coordination', seen?.access);
    // A grant nobody can find is not a grant. The stand-in was handed this
    // because the arranger is away — there is no colleague to send them a link.
    const covering = (await cos('GET', `/movement/${bossId}/movements`)).d.movements || [];
    ok('and it turns up in their list, where they will actually look for it',
      covering.length === 1 && covering[0].id === moveId, JSON.stringify(covering).slice(0, 200));
    ok('still only the coordinating half of it',
      covering[0]?.access === 'coordination' && !JSON.stringify(covering).includes('Musa'),
      JSON.stringify(covering).slice(0, 200));

    // WHAT THEY GET: enough to make the journey happen.
    ok('they get when and from where', seen?.departsFrom === 'Ikoyi residence'
      && !!seen?.departsAt, JSON.stringify({ f: seen?.departsFrom, a: seen?.departsAt }));
    ok('and the driver to ring',
      seen.people.length === 1 && seen.people[0].name === 'Sunday Eze',
      JSON.stringify(seen.people));
    ok('and the car the principal is in',
      seen.vehicles.length === 1 && seen.vehicles[0].role === 'principal',
      JSON.stringify(seen.vehicles));

    // WHAT THEY DO NOT GET, which is the half worth protecting.
    ok('the escort is not in it',
      !JSON.stringify(seen).includes('Musa'), JSON.stringify(seen).slice(0, 300));
    ok('nor the backup car', !JSON.stringify(seen).includes('XYZ-777-AA'));
    ok('nor the principal\'s own notes', !JSON.stringify(seen).includes('coast road'));
    // Silently redacted data is worse than none: the reader assumes they have
    // everything and tells somebody there is no escort.
    ok('and it says out loud that it is partial', seen?.partial === true);
    ok('naming how much was withheld', seen?.withheld === 2, String(seen?.withheld));

    // A stand-in coordinates; they do not rewrite.
    ok('they cannot add to it',
      (await cos('POST', `/movement/${bossId}/movements/${moveId}/people`,
        { role: 'driver', name: 'Somebody else' })).s === 403);
    ok('nor hand it on to anybody else',
      (await cos('POST', `/movement/${bossId}/movements/${moveId}/grants`,
        { userId: paId })).s === 403);
    // Except this: the person covering is the one most likely to know.
    r = await cos('POST', `/movement/${bossId}/movements/${moveId}/arrived`);
    ok('but they can say the principal arrived', r.s === 200 && !!r.d.movement?.arrivedAt,
      JSON.stringify(r.d.movement?.arrivedAt));

    // ---- The principal finds out ---------------------------------------------
    head('And the principal can see that it happened:');
    const logged = await require(`${ROOT}/app/server/lib/db`).prepare(
      "SELECT * FROM access_log WHERE subject_owner_id = ? AND action = 'grant'",
    ).all(bossId);
    ok('handing over sight of a movement is on the record',
      logged.some((l) => /Tunde/.test(l.field || '')),
      JSON.stringify(logged.map((l) => l.field)));

    // ---- Taking it back ------------------------------------------------------
    head('And it can be taken back before it lapses:');
    r = await pa('GET', `/movement/${bossId}/movements/${moveId}/grants`);
    const grantId = (r.d.grants || [])[0]?.id;
    ok('the arranger can see who holds it', !!grantId && r.d.grants[0].live === true,
      JSON.stringify(r.d.grants));
    ok('and take it back',
      (await pa('DELETE', `/movement/${bossId}/movements/${moveId}/grants/${grantId}`)).s === 204);
    ok('after which the room is shut again',
      (await cos('GET', `/movement/${bossId}/movements/${moveId}`)).s === 404);

    // ---- The arrival that did not happen -------------------------------------
    head('A journey that should have finished, and nobody said it did:');
    const { runReminderSweep } = require(`${ROOT}/app/server/lib/reminders`);

    // A journey with no expected duration is a logbook entry: it can be late
    // forever and nothing should fire, because nobody ever said when it was
    // due. THE POSITIVE CONTROL for everything below.
    // ANCHORED TO THE DAY THE APP IS SHOWING, not to "four hours ago".
    //
    // This used to be Date.now() - 4h, which is on today's sheet for
    // twenty-one hours out of twenty-four and on yesterday's for the other
    // three. The suite passed every evening and failed just after midnight —
    // and the failure said "the arranger cannot see their journeys", which is
    // an alarming and completely false claim about the access rule this
    // section exists to prove. A journey belongs to the day it departs on;
    // the fixture now says which day that is instead of hoping.
    const showing = (await pa('GET', `/today/${bossId}`)).d;
    const middayToday = new Date(`${showing.date}T12:00:00Z`).toISOString();
    let mk = await pa('POST', `/movement/${bossId}/movements`, {
      title: 'The school run', departsFrom: 'Ikoyi', destination: 'Falomo',
      departsAt: middayToday,
    });
    const openEnded = mk.d.movement.id;
    ok('a journey with no expected time is still recorded', mk.s === 201, String(mk.s));
    ok('and is never called late, because nobody said when it was due',
      mk.d.movement.lateByMinutes === null, String(mk.d.movement.lateByMinutes));

    // One that WAS given a duration, departed three hours ago, expected to
    // take 45 minutes. Well past the grace.
    mk = await pa('POST', `/movement/${bossId}/movements`, {
      title: 'To the airport', departsFrom: 'Ikoyi', destination: 'MMIA',
      departsAt: new Date(Date.now() - 3 * 3600000).toISOString(),
      expectedMinutes: 45,
    });
    const lateId = mk.d.movement.id;
    ok('one with an expected time knows when it should have landed',
      !!mk.d.movement.expectedArrival, JSON.stringify(mk.d.movement).slice(0, 200));
    ok('and says how late it is', mk.d.movement.lateByMinutes > 100,
      String(mk.d.movement.lateByMinutes));

    const swept = await runReminderSweep();
    ok('the sweep raises it', swept.movements > 0, JSON.stringify(swept));

    // WHO WAS TOLD is the movement's rule, not the office's. An alert saying
    // the principal has not arrived somewhere is a statement about their
    // whereabouts, which is exactly what the gate protects.
    // Read from the emails table, which is where knock leaves its trail — it
    // sends mail and pushes, and the mail is recorded whether or not a
    // provider is configured. See lib/email.js.
    const told = await require(`${ROOT}/app/server/lib/db`).prepare(
      "SELECT to_email FROM emails WHERE category = 'movement_overdue'",
    ).all();
    const toldTo = new Set(told.map((t) => t.to_email));
    ok('the principal is told', toldTo.has(`ada${ID}@x.com`), JSON.stringify([...toldTo]));
    ok('and whoever arranged it', toldTo.has(`ngozi${ID}@x.com`), JSON.stringify([...toldTo]));
    // THE ASSERTION THIS SECTION EXISTS FOR. "Adaeze has not arrived at the
    // airport" is a statement about a principal's whereabouts and their
    // failure to reach a place, which is precisely what the gate protects.
    ok('the Chief of Staff, who arranged nothing, is not',
      !toldTo.has(`tunde${ID}@x.com`), JSON.stringify([...toldTo]));

    // Once. A sweep every ten minutes must not become a message every ten
    // minutes for the rest of the day.
    const again = await runReminderSweep();
    ok('and it is raised once, not at every sweep', again.movements === 0, JSON.stringify(again));

    // Marking it arrived ends it.
    await pa('POST', `/movement/${bossId}/movements/${lateId}/arrived`);
    r = await pa('GET', `/movement/${bossId}/movements/${lateId}`);
    ok('once somebody says they arrived it stops being late',
      r.d.movement.lateByMinutes === null && !!r.d.movement.arrivedAt,
      JSON.stringify({ l: r.d.movement.lateByMinutes, a: r.d.movement.arrivedAt }));

    // ---- On the day sheet ----------------------------------------------------
    head('And the day sheet knows about the car:');
    const today = await pa('GET', `/today/${bossId}`);
    const ids = (today.d.movements || []).map((m) => m.id);
    ok('the arranger sees their journeys on Today',
      ids.includes(openEnded), JSON.stringify(ids));
    ok('and the principal does too',
      ((await boss('GET', `/today/${bossId}`)).d.movements || []).some((m) => m.id === openEnded));
    // THE SAME GATE AS EVERYWHERE ELSE. A day sheet that joined movements in
    // without the rule would put an escort roster in front of the whole office.
    ok('the Chief of Staff sees none of them on Today',
      ((await cos('GET', `/today/${bossId}`)).d.movements || []).length === 0,
      JSON.stringify((await cos('GET', `/today/${bossId}`)).d.movements));
    // POSITIVE CONTROL: their Today works, it is just movement-free.
    ok('though their Today is otherwise a working page',
      (await cos('GET', `/today/${bossId}`)).s === 200);

    // ---- The car that has not come back ------------------------------------
    head('A car that left last night and never arrived is still on Today:');
    // WHY THIS IS ITS OWN ASSERTION. A journey belongs to the day it departs
    // on, and the list above is right to be scoped that way. An unanswered
    // "where are they" is not a diary entry: at half past midnight it is the
    // most urgent thing the office has, and scoping it to the calendar day
    // made it disappear at the stroke of twelve — the exact hour it matters.
    //
    // ANCHORED TO MIDNIGHT, NOT TO A WALL-CLOCK OFFSET. This used to depart
    // "twenty-two hours ago", with a comment claiming that was unambiguously
    // yesterday however late the suite ran. It is not: after 22:00 the subtraction
    // lands back on today, the journey really is today's, and the day-scoped list
    // is right to carry it. The board went red at 22:33 and again at 22:42 for
    // exactly that reason — a fixture asserting something false about the clock,
    // not a defect.
    //
    // Three things have to hold at once, and only one departure time does it at
    // every hour: yesterday in the principal's zone, so it is off the day sheet;
    // inside the twenty-four hour alarm carry, so the arrival alarm still sounds;
    // and past its expected arrival, so it counts as unanswered. One minute
    // before today's midnight satisfies all three, and the expected ninety
    // minutes comes down to one so that it is overdue from the first minute of
    // the day rather than from half past one in the morning.
    //
    // The zone is the principal's and not this process's — the day sheet reads
    // it in theirs, and a suite that assumed UTC would go red for whoever runs
    // it from Lagos.
    const zone = (await pa('GET', `/today/${bossId}`)).d.timezone || 'UTC';
    const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
    const departsAt = new Date(new Date(`${todayKey}T00:00:00Z`).getTime() - 60000).toISOString();
    const overnight = (await pa('POST', `/movement/${bossId}/movements`, {
      title: 'Back from Abeokuta', departsFrom: 'Abeokuta', destination: 'Ikoyi',
      departsAt,
      expectedMinutes: 1,
    })).d.movement.id;

    let sheet = (await pa('GET', `/today/${bossId}`)).d;
    ok('it is not on the day\'s journeys, because it is not today\'s journey',
      !(sheet.movements || []).some((m) => m.id === overnight),
      JSON.stringify((sheet.movements || []).map((m) => m.id)));
    ok('but the office is still told nobody has confirmed the arrival',
      (sheet.needsYou?.movementsLate || []).some((m) => m.id === overnight),
      JSON.stringify(sheet.needsYou?.movementsLate));

    // AND IT STOPS WHEN THE THING IS RESOLVED, not when the date changes.
    // Without this the assertion above would pass just as well on a screen
    // that never lets go of an alarm at all.
    await pa('POST', `/movement/${bossId}/movements/${overnight}/arrived`);
    sheet = (await pa('GET', `/today/${bossId}`)).d;
    ok('and it goes the moment somebody says they got there',
      !(sheet.needsYou?.movementsLate || []).some((m) => m.id === overnight),
      JSON.stringify(sheet.needsYou?.movementsLate));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA movement is arranged, guarded like the vault, and opened once when somebody has to cover.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
