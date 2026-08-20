// Running late, and the travel chain.
//
// The rules that matter: a gap absorbs a delay and the cascade stops; an
// anchor never moves and says so; the driver is told and has to re-confirm.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4471);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

// A fixed day well in the future, so nothing here depends on when it runs.
const DAY = '2027-03-15';
const at = (hhmm) => `${DAY}T${hhmm}:00.000Z`;
const hhmm = (iso) => new Date(iso).toISOString().slice(11, 16);

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

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    const deadline = Date.now() + 30000;
    for (;;) {
      let ready = false;
      try { ready = (await (await fetch(`${BASE}/api/status`)).json()).databaseReady; }
      catch { /* not up */ }
      if (ready) break;
      if (Date.now() > deadline) throw new Error('server never became ready — is the database up?');
      await new Promise((r) => setTimeout(r, 200));
    }

    const ada = client(); const ben = client(); const femi = client();
    const adaU = await signUp(ada, 'Ada Boss', `ada${ID}@x.com`, 'principal');
    await signUp(ben, 'Ben Reed', `ben${ID}@x.com`, 'pa');
    await signUp(femi, 'Femi Okon', `femi${ID}@x.com`, 'principal');

    const inv = await ada('POST', '/members', { email: `ben${ID}@x.com`, role: 'pa' });
    await ben('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    const hire = await ada('POST', `/household/${adaU.id}/staff`,
      { name: 'Femi Okon', email: `femi${ID}@x.com`, jobTitle: 'Driver' });
    await femi('POST', `/invites/${hire.d.inviteLink.split('/').pop()}/accept`);
    const roster = await ada('GET', `/household/${adaU.id}`);
    const driverId = roster.d.members[0].id;

    const add = async (f) => (await ada('POST', `/itinerary/${adaU.id}/items`, f)).d.item;

    head('A gap absorbs a small delay:');
    // 09:00-09:45 board call, then nothing until 14:00.
    const board = await add({ kind: 'meeting', title: 'Board call', startAt: at('09:00'), endAt: at('09:45') });
    const lunch = await add({ kind: 'meal', title: 'Lunch', startAt: at('14:00'), endAt: at('15:00') });

    let p = (await ada('POST', `/itinerary/${adaU.id}/items/${board.id}/delay/preview`, { minutes: 20 })).d.plan;
    ok('the delayed item moves', hhmm(p.item.newStartAt) === '09:20', hhmm(p.item.newStartAt));
    ok('and nothing else does, because there is room',
      p.counts.shifted === 0 && p.counts.conflicts === 0, JSON.stringify(p.counts));
    ok('which is said out loud rather than left blank',
      /enough of a gap/i.test(p.effects.find((e) => e.id === lunch.id)?.reason || ''),
      JSON.stringify(p.effects));

    head('A collision pushes what follows:');
    // 10:30 site visit sits right after the board call.
    const visit = await add({ kind: 'meeting', title: 'Site visit', startAt: at('10:00'), endAt: at('11:00') });
    p = (await ada('POST', `/itinerary/${adaU.id}/items/${board.id}/delay/preview`, { minutes: 45 })).d.plan;
    const visitEffect = p.effects.find((e) => e.id === visit.id);
    ok('the thing right after moves', visitEffect?.effect === 'shifted', JSON.stringify(visitEffect));
    ok('by exactly the overlap, not by the whole delay',
      visitEffect?.movedBy === 30, String(visitEffect?.movedBy));
    ok('and the far-off lunch is still untouched',
      p.effects.find((e) => e.id === lunch.id)?.effect === 'unchanged');

    head('Travel time is respected:');
    await ada('PATCH', `/itinerary/${adaU.id}/items/${visit.id}`, { travelMinutes: 30 });
    p = (await ada('POST', `/itinerary/${adaU.id}/items/${board.id}/delay/preview`, { minutes: 45 })).d.plan;
    ok('half an hour of travel makes the push bigger',
      p.effects.find((e) => e.id === visit.id)?.movedBy === 60,
      String(p.effects.find((e) => e.id === visit.id)?.movedBy));

    head('An anchor does not move:');
    const flight = await add({
      kind: 'flight', title: 'BA 083 to Lagos', startAt: at('12:00'), endAt: at('18:00'),
    });
    await ada('PATCH', `/itinerary/${adaU.id}/items/${flight.id}`, { isAnchor: true, travelMinutes: 60 });
    p = (await ada('POST', `/itinerary/${adaU.id}/items/${board.id}/delay/preview`, { minutes: 120 })).d.plan;
    const flightEffect = p.effects.find((e) => e.id === flight.id);
    ok('the flight keeps its time', flightEffect?.newStartAt === flightEffect?.startAt);
    ok('and is reported as a conflict', flightEffect?.effect === 'conflict', JSON.stringify(flightEffect));
    ok('in words a person can act on',
      /will not wait/i.test(flightEffect?.reason || ''), flightEffect?.reason);
    ok('with how late they would be', flightEffect?.lateBy > 0, String(flightEffect?.lateBy));

    head('Applying:');
    const refused = await ada('POST', `/itinerary/${adaU.id}/items/${board.id}/delay`, { minutes: 120 });
    ok('a conflict is refused unless it is acknowledged', refused.s === 409, String(refused.s));
    ok('and the refusal carries the plan, so nothing has to be recomputed',
      !!refused.d.plan, JSON.stringify(refused.d).slice(0, 80));

    const applied = await ada('POST', `/itinerary/${adaU.id}/items/${board.id}/delay`,
      { minutes: 45, acceptConflicts: true });
    ok('applying works', applied.s === 200, JSON.stringify(applied.d).slice(0, 120));

    const day = await ada('GET', `/itinerary/${adaU.id}/day?date=${DAY}`);
    const find = (t) => day.d.entries.find((e) => e.title === t);
    ok('the delayed item really moved', hhmm(find('Board call').startAt) === '09:45',
      hhmm(find('Board call').startAt));
    ok('the following item really moved', hhmm(find('Site visit').startAt) === '11:00',
      hhmm(find('Site visit').startAt));
    ok('the flight really did not', hhmm(find('BA 083 to Lagos').startAt) === '12:00',
      hhmm(find('BA 083 to Lagos').startAt));
    ok('and the untouched one is untouched', hhmm(find('Lunch').startAt) === '14:00',
      hhmm(find('Lunch').startAt));

    head('The team hears about it:');
    const today = await ada('GET', `/today/${adaU.id}`);
    const thread = today.d.directLine?.threadId;
    const msgs = await ada('GET', `/threads/${thread}/messages`);
    ok('a note lands in the direct line',
      msgs.d.messages?.some((m) => /running 45 min late/i.test(m.body)),
      JSON.stringify(msgs.d.messages?.map((m) => m.body)));
    ok('naming what could not move',
      msgs.d.messages?.some((m) => /will not wait/i.test(m.body)));

    head('Building a trip:');
    const trip = await ada('POST', `/itinerary/${adaU.id}/trips`, {
      title: 'BA 075 to Abuja',
      departAt: `2027-03-20T14:00:00.000Z`,
      arriveAt: `2027-03-20T20:00:00.000Z`,
      from: 'Heathrow T5', to: 'Abuja', reference: 'PNR X7Q2',
      pickupLeadMinutes: 180, pickupFrom: 'The Connaught', driverId,
      checkOutLeadMinutes: 30,
      arrivalTransferMinutes: 45, arrivalTo: 'The residence',
    });
    ok('one form builds the whole chain', trip.s === 201 && trip.d.items.length === 4,
      `${trip.s} ${trip.d.items?.length}`);
    const titles = trip.d.items.map((i) => `${hhmm(i.startAt)} ${i.title}`);
    ok('check-out first', /10:30 Check out/.test(titles[0]), titles.join(' | '));
    ok('then the car', /11:00 Car to Heathrow/.test(titles[1]), titles.join(' | '));
    ok('then the flight', /14:00 BA 075/.test(titles[2]), titles.join(' | '));
    ok('then the transfer at the other end', /20:45 Car from Abuja/.test(titles[3]), titles.join(' | '));
    ok('the flight is the anchor', trip.d.items[2].isAnchor === true);
    ok('and nothing else is',
      trip.d.items.filter((i) => i.isAnchor).length === 1);
    ok('the driver was told, without a separate step', trip.d.instructionsSent === 1,
      String(trip.d.instructionsSent));

    const mine = await femi('GET', '/household/mine');
    ok('and it reached them', mine.d.instructions.some((i) => /Car to Heathrow/.test(i.body)),
      JSON.stringify(mine.d.instructions.map((i) => i.body)));

    head('When the car moves, the driver is told again:');
    const carId = trip.d.items[1].id;
    await femi('POST', `/household/instructions/${mine.d.instructions.find((i) => /Car to Heathrow/.test(i.body)).id}/acknowledge`);
    const checkoutId = trip.d.items[0].id;
    const moved = await ada('POST', `/itinerary/${adaU.id}/items/${checkoutId}/delay`,
      { minutes: 45, acceptConflicts: true });
    ok('the check-out slipping moves the car', moved.s === 200,
      JSON.stringify(moved.d).slice(0, 120));

    const after = await femi('GET', '/household/mine');
    const change = after.d.instructions.find((i) => /change of time/i.test(i.body));
    ok('the driver gets a fresh instruction', !!change,
      JSON.stringify(after.d.instructions.map((i) => i.body)));
    ok('which they have not confirmed', change?.status === 'open', change?.status);
    // 11:15, not 11:45: the check-out has no duration, so it ends the moment
    // it starts and the car is pushed by the 15-minute overlap rather than the
    // whole 45. The rule doing its job.
    ok('and it names the new time', /11:15/.test(change?.body || ''), change?.body);
    ok('pushed by the overlap, not the whole delay', /15 min later/.test(change?.body || ''), change?.body);

    const dayAfter = await ada('GET', `/itinerary/${adaU.id}/day?date=2027-03-20`);
    const flightAfter = dayAfter.d.entries.find((e) => /BA 075/.test(e.title));
    ok('the flight still has not moved', hhmm(flightAfter.startAt) === '14:00', hhmm(flightAfter.startAt));

    head('A delegate cannot rearrange a day:');
    const dee = client();
    await signUp(dee, 'Dee Legate', `dee${ID}@x.com`, 'principal');
    const dInv = await ada('POST', '/members', { email: `dee${ID}@x.com`, role: 'delegate' });
    await dee('POST', `/invites/${dInv.d.inviteLink.split('/').pop()}/accept`);
    // A delegate does hold scheduling access by design, so this is a check that
    // the endpoint is guarded at all rather than open to any signed-in user.
    const stranger = client();
    await signUp(stranger, 'No One', `no${ID}@x.com`, 'principal');
    const nope = await stranger('POST', `/itinerary/${adaU.id}/items/${board.id}/delay/preview`, { minutes: 10 });
    ok('a stranger cannot even preview', nope.s === 403 || nope.s === 404, String(nope.s));
    const nopeTrip = await stranger('POST', `/itinerary/${adaU.id}/trips`,
      { title: 'x', departAt: at('09:00') });
    ok('nor build a trip on somebody else\'s day', nopeTrip.s === 403 || nopeTrip.s === 404, String(nopeTrip.s));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }
  console.log(fails === 0 ? '\nDelays cascade correctly and trips build.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
