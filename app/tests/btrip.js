// Trips: the journey as an object, the day drawn where you are, and being met
// without a name board.
//
// The claim about the card is the one worth proving from the wrong side: it is
// a link with no password on it, sent to a driver's phone over a channel
// Kairos does not control. So what matters is not that it works — it is what a
// stranger holding it gets, which must be a flight number, a meeting point and
// a phrase, and nothing that identifies the principal or reaches their account.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4523);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
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

const iso = (d) => new Date(d).toISOString();
const todayIn = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }

  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      // Travel identity is a sensitive category, so the document-expiry check
      // has nothing to check without a key.
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    const ada = client();
    const up = await ada('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const adaId = up.d.user.id;
    await ada('POST', '/profile/onboarding-step', { step: 'done' });
    await ada('PATCH', '/profile', { timezone: 'Africa/Lagos' });

    head('A trip exists as one thing:');
    const bad = await ada('POST', `/trips/${adaId}`,
      { name: 'London', startsOn: '2027-03-10', endsOn: '2027-03-04' });
    ok('a trip that ends before it starts is refused', bad.s === 400, JSON.stringify(bad.d));
    const badTz = await ada('POST', `/trips/${adaId}`,
      { name: 'London', startsOn: '2027-03-04', endsOn: '2027-03-10', destinationTimezone: 'Mars/Olympus' });
    ok('an invented timezone is refused at the door', badTz.s === 400, JSON.stringify(badTz.d));

    const made = await ada('POST', `/trips/${adaId}`, {
      name: 'London, board week',
      destination: 'London',
      destinationTimezone: 'Europe/London',
      startsOn: todayIn('Africa/Lagos'),
      endsOn: '2099-12-31',
      status: 'confirmed',
    });
    ok('a trip is created', made.s === 201, JSON.stringify(made.d).slice(0, 140));
    const tripId = made.d.trip.id;

    head('Who else is going, and who to call there:');
    const trav = await ada('POST', `/trips/${adaId}/${tripId}/travellers`,
      { name: 'Ngozi Okonkwo', role: 'spouse' });
    ok('a traveller is added', trav.s === 201);
    const contact = await ada('POST', `/trips/${adaId}/${tripId}/contacts`,
      { name: 'Ade Bello', role: 'London office', phone: '+44 20 7000 0000' });
    ok('a local contact is added', contact.s === 201);

    head('The day is drawn where the principal actually is:');
    const today = await ada('GET', `/today/${adaId}`);
    ok('the timezone follows the trip, not the profile',
      today.d.timezone === 'Europe/London', today.d.timezone);
    ok('and the home zone is still reported, so the difference is explicable',
      today.d.homeTimezone === 'Africa/Lagos', today.d.homeTimezone);
    ok('with the trip named', today.d.away?.destination === 'London', JSON.stringify(today.d.away));

    // A draft must not silently move somebody's clock.
    await ada('PATCH', `/trips/${adaId}/${tripId}`, { status: 'draft' });
    const drafted = await ada('GET', `/today/${adaId}`);
    ok('a draft trip leaves the day in the home zone',
      drafted.d.timezone === 'Africa/Lagos', drafted.d.timezone);
    ok('and says nothing about being away', !drafted.d.away);
    await ada('PATCH', `/trips/${adaId}/${tripId}`, { status: 'confirmed' });

    head('A car leg says how it is arranged:');
    const nope = await ada('POST', `/itinerary/${adaId}/items`, {
      kind: 'car', title: 'Car from Heathrow', startAt: iso(Date.now() + 86400000),
      arrangement: 'hired',
    });
    ok('a hired car with nobody to call is refused', nope.s === 400, JSON.stringify(nope.d));
    ok('and says why', /callable/.test(nope.d.error || ''), nope.d.error);

    const nonsense = await ada('POST', `/itinerary/${adaId}/items`, {
      kind: 'car', title: 'Car', startAt: iso(Date.now() + 86400000), arrangement: 'teleport',
    });
    ok('an unknown arrangement is refused', nonsense.s === 400);

    head('Building the trip end to end:');
    const depart = Date.now() + 3 * 86400000;
    const arrive = depart + 6.5 * 3600000;
    const built = await ada('POST', `/itinerary/${adaId}/trips`, {
      tripId,
      title: 'BA 075 Lagos → London',
      from: 'LOS', to: 'LHR',
      terminal: 'T5', seat: '2A', reference: 'PNR X7QK2M',
      departAt: iso(depart), arriveAt: iso(arrive),
      startTimezone: 'Africa/Lagos', endTimezone: 'Europe/London',
      pickupLeadMinutes: 210, checkInMinutes: 180,
      pickupFrom: 'Ikoyi residence',
      pickup: { arrangement: 'own_driver' },
      arrivalTransferMinutes: 75,
      arrivalMeetingPoint: 'T5 arrivals, costa coffee',
      arrivalTo: 'The Connaught',
      arrival: {
        arrangement: 'hired',
        provider: 'Addison Lee',
        contactName: 'Dispatch',
        contactPhone: '+44 20 7387 8888',
      },
    });
    ok('the trip builds', built.s === 201, JSON.stringify(built.d).slice(0, 160));
    const items = built.d.items;
    ok('with a flight, a departure car and an arrival car', items.length >= 3, String(items.length));

    const flight = items.find((i) => i.kind === 'flight');
    ok('the flight carries its terminal and seat',
      flight.terminal === 'T5' && flight.seat === '2A', JSON.stringify({ t: flight.terminal, s: flight.seat }));
    ok('and its booking reference', flight.reference === 'PNR X7QK2M');
    ok('and is the anchor', flight.isAnchor === true);

    const arrivalCar = items.filter((i) => i.kind === 'car')
      .find((i) => i.arrangement === 'hired');
    ok('the arrival car is a hired service, not the household driver',
      !!arrivalCar && !arrivalCar.householdMemberId, JSON.stringify(arrivalCar).slice(0, 160));
    ok('naming the company', arrivalCar.provider === 'Addison Lee');
    ok('with somebody to ring when the flight is late',
      arrivalCar.contactPhone === '+44 20 7387 8888');

    head('Met by a phrase rather than a name board:');
    ok('a pickup was armed on arrival', !!built.d.arrivalPickup, JSON.stringify(built.d.arrivalPickup));
    const { code, cardPath } = built.d.arrivalPickup;
    ok('the phrase is two sayable words', /^[A-Z]+ [A-Z]+$/.test(code), code);
    ok('and the card has a long random address',
      /^\/pickup\/[0-9a-f]{48}$/.test(cardPath), cardPath);
    ok('the principal sees the phrase on the leg', arrivalCar.pickupCode === code);
    ok('but the day sheet never carries the card address',
      !JSON.stringify(items).includes(cardPath.split('/').pop()));

    head('What a stranger holding the link actually gets:');
    const token = cardPath.split('/').pop();
    const card = await (await fetch(`${BASE}/api/trips/pickup/${token}`)).json();
    const asText = JSON.stringify(card);
    ok('it opens with no account at all', !!card.pickup, asText.slice(0, 120));
    ok('carrying the meeting point', /costa coffee/i.test(card.pickup.meetingPoint));
    ok('the phrase', card.pickup.pickupCode === code);
    ok('and the flight, which is public on any departure board',
      /BA 075/.test(card.pickup.flightNumber), card.pickup.flightNumber);
    ok('a first name to greet with', card.pickup.passenger === 'Adaeze');
    ok('and NOT the surname — that is the name board again, forwardable',
      !/Okonkwo/.test(asText), asText.slice(0, 200));
    ok('nor where they are going afterwards', !/Connaught/.test(asText));
    ok('nor anyone else travelling', !/Ngozi/.test(asText));
    ok('nor the principal’s email', !asText.includes(`ada${ID}@x.com`));

    head('And it reaches nothing else:');
    const asDriver = await (await fetch(`${BASE}/api/today/${adaId}`)).json();
    ok('the card grants no session', !asDriver.schedule, JSON.stringify(asDriver).slice(0, 100));
    const wrong = await fetch(`${BASE}/api/trips/pickup/${'0'.repeat(48)}`);
    ok('a wrong address is not found', wrong.status === 404);
    const short = await fetch(`${BASE}/api/trips/pickup/abc`);
    ok('and a guessy short one is refused the same way', short.status === 404);

    head('Re-arming replaces the phrase and the address:');
    const rearmed = await ada('POST', `/itinerary/${adaId}/items/${arrivalCar.id}/pickup`);
    ok('a fresh pickup is issued', rearmed.s === 201);
    ok('with a different phrase', rearmed.d.pickupCode !== code, rearmed.d.pickupCode);
    const oldCard = await fetch(`${BASE}/api/trips/pickup/${token}`);
    ok('and the forwarded old link stops working', oldCard.status === 404, String(oldCard.status));

    const disarmed = await ada('DELETE', `/itinerary/${adaId}/items/${arrivalCar.id}/pickup`);
    ok('a pickup can be taken down entirely', disarmed.s === 204);
    const newToken = rearmed.d.cardPath.split('/').pop();
    ok('and then even the fresh link is dead',
      (await fetch(`${BASE}/api/trips/pickup/${newToken}`)).status === 404);

    head('The trip gathers everything hanging off it:');
    const full = await ada('GET', `/trips/${adaId}/${tripId}`);
    ok('items belong to the trip', full.d.items.length >= 3, String(full.d.items.length));
    ok('so do the travellers', full.d.travellers.length === 1);
    ok('and the local contacts', full.d.contacts.length === 1);

    head('Documents are checked against the trip dates, not today:');
    await ada('POST', `/essentials/${adaId}`, {
      category: 'travel_identity', field: 'yellow_fever_card',
      value: 'YF-882134', expiresOn: '2028-01-01',
    });
    const warned = await ada('GET', `/trips/${adaId}/${tripId}`);
    if (!warned.d.documentWarnings.length) console.log('    (no warnings; stored?)');
    ok('something lapsing before a 2099 trip is flagged',
      warned.d.documentWarnings.some((w) => w.field === 'yellow_fever_card' && w.severity === 'expired'),
      JSON.stringify(warned.d.documentWarnings));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }
  console.log(fails === 0 ? '\nA trip is a thing, and nobody holds up a name.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
