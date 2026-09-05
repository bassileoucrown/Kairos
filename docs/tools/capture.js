// Seed a believable office, then photograph every screen of it.
//
// WHY REAL SCREENSHOTS AND NOT MOCKUPS. A training deck drawn by hand starts
// lying the first time a screen changes, and the reader cannot tell which parts
// are the product and which are the illustrator. These come out of the actual
// build, driven through the actual UI, so a screen that has moved shows as
// moved the next time this is run.
//
// WHY THE DATA IS SEEDED RATHER THAN EMPTY. An empty screen teaches nothing —
// "Nothing scheduled" is not a lesson in how a day works. So this builds a
// principal with a real week: a board trip, cars to the airport, an approval
// waiting, a room with a decision in it, a passport in the vault, a driver with
// instructions. Every shot below is of something that exists.
//
// OUTPUT: shots/*.jpg (JPEG at source, because there is no image library on
// this box and Chromium can compress better than we can) and clips/*.webm.
// Both derived from where this file sits, so the script runs from any clone.
// Override the output with KAIROS_DECK_OUT if you want it somewhere else.
const ROOT = require('path').join(__dirname, '..', '..');
const OUT = process.env.KAIROS_DECK_OUT || require('path').join(ROOT, 'docs', 'tools', 'build', 'deck');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4711, BASE = `http://127.0.0.1:${PORT}`;
const STORE_PORT = 4712;
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ID = 'demo';
const VIEW = { width: 1320, height: 860 };

const shots = [];
const notes = [];
const say = (s) => { console.log(s); notes.push(s); };

function client() {
  let cookie = '';
  return async function call(method, p, body) {
    const r = await fetch(`${BASE}/api${p}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    if (r.status >= 400) console.log(`   ! ${method} ${p} → ${r.status} ${String(text).slice(0, 120)}`);
    return { s: r.status, d: json, cookie };
  };
}

/** A day offset, as a local date. */
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
/** A wall time on a day offset, as an instant. */
const at = (n, hh, mm = 0) => `${day(n)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`;

async function shot(page, name, caption, opts = {}) {
  const file = path.join(OUT, 'shots', `${name}.jpg`);
  await page.waitForTimeout(opts.settle || 500);
  await page.screenshot({
    path: file, type: 'jpeg', quality: opts.quality || 62,
    fullPage: !!opts.full,
  });
  const kb = Math.round(fs.statSync(file).size / 1024);
  shots.push({ name, caption, kb });
  console.log(`  · ${name}  ${kb}KB`);
}

/** Wait for a screen to be finished loading, not merely mounted. */
async function ready(page, selector, timeout = 20000) {
  try {
    await page.waitForFunction(() => !/Loading…/.test(document.body.innerText), null, { timeout });
    if (selector) await page.waitForSelector(selector, { timeout });
  } catch { /* photograph whatever state it did reach — an honest shot */ }
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'clips'), { recursive: true });

  const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  }
  // Somewhere for a document to go. THE COURSE PHOTOGRAPHS A CONFIGURED
  // DEPLOYMENT, so the vault lesson shows the control rather than the notice
  // saying it needs a bucket — a tester reading the course has one, or is
  // about to. The store is this process, holding bytes in a Map; what reaches
  // it is already encrypted, exactly as it would be at Cloudflare.
  const objects = new Map();
  const store = require('http').createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'PUT') { objects.set(req.url, Buffer.concat(chunks)); res.writeHead(200); }
      else if (req.method === 'GET') {
        const v = objects.get(req.url);
        if (!v) { res.writeHead(404); res.end(); return; }
        res.writeHead(200); res.end(v); return;
      } else if (req.method === 'DELETE') { objects.delete(req.url); res.writeHead(204); }
      else res.writeHead(405);
      res.end();
    });
  });
  await new Promise((r) => store.listen(STORE_PORT, '127.0.0.1', r));

  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      ENCRYPTION_KEY: KEY,
      STORAGE_BUCKET: 'kairos-course',
      STORAGE_ENDPOINT: `http://127.0.0.1:${STORE_PORT}`,
      STORAGE_REGION: 'us-east-1',
      STORAGE_KEY: 'AKIAIOSFODNN7EXAMPLE',
      STORAGE_SECRET: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      // Named so the pilot screen is reachable for the operator shot.
      ANNOUNCEMENT_AUTHORS: `ada${ID}@x.com`,
      REMINDER_SWEEP_MS: String(60 * 60 * 1000),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  let browser = null;
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    say('server up');

    // ══ SEED ════════════════════════════════════════════════════════════
    const boss = client();
    await boss('POST', '/auth/signup', {
      name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW,
      accountCategory: 'principal', timezone: 'Africa/Lagos',
    });
    await boss('PATCH', '/profile', { slug: 'adaeze', timezone: 'Africa/Lagos' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });
    const me = (await boss('GET', '/auth/me')).d.user;
    say(`principal ${me.id}`);

    // Meeting types across the access tiers, so the booking page and the
    // approval queue both have something real to show.
    await boss('POST', '/meeting-types', {
      name: 'Introduction', durationMinutes: 30, locationType: 'video', accessTier: 1,
      description: 'A first conversation.', bufferAfterMinutes: 10,
    });
    await boss('POST', '/meeting-types', {
      name: 'Board matter', durationMinutes: 60, locationType: 'in_person', accessTier: 3,
      description: 'Held for the board and its counsel.', bufferAfterMinutes: 15,
    });
    await boss('PUT', '/availability', {
      windowDays: 45,
      rules: [1, 2, 3, 4, 5].flatMap((d) => ([
        { dayOfWeek: d, startTime: '09:00', endTime: '12:30' },
        { dayOfWeek: d, startTime: '14:00', endTime: '17:00' },
      ])),
    });

    // The assistant.
    const pa = client();
    await pa('POST', '/auth/signup', {
      name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW,
      accountCategory: 'pa', timezone: 'Africa/Lagos',
    });
    await pa('PATCH', '/profile', { slug: 'ngozi', timezone: 'Africa/Lagos' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    let r = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${String(r.d.inviteLink).split('/').pop()}/accept`);
    const paId = (await pa('GET', '/auth/me')).d.user.id;
    say('assistant joined');

    // A driver, with an account, so the household screen and the staff screen
    // both have somebody real on them.
    const driver = client();
    await driver('POST', '/auth/signup', {
      name: 'Tunde Bakare', email: `tunde${ID}@x.com`, password: PW, timezone: 'Africa/Lagos',
    });
    await driver('PATCH', '/profile', { slug: 'tunde-b' });
    await driver('POST', '/profile/onboarding-step', { step: 'done' });
    r = await boss('POST', `/household/${me.id}/staff`, {
      email: `tunde${ID}@x.com`, name: 'Tunde Bakare', jobTitle: 'Driver',
    });
    if (r.d?.inviteLink) {
      await driver('POST', `/invites/${String(r.d.inviteLink).split('/').pop()}/accept`);
    }
    const house = (await boss('GET', `/household/${me.id}`)).d;
    const staffId = (house?.members || house?.staff || [])[0]?.id;
    if (staffId) {
      await boss('POST', `/household/${me.id}/instructions`, {
        body: 'Collect madam from Ikoyi at 05:40 for the Abuja flight. Boot space for two cases.',
        memberId: staffId, dueAt: at(1, 5, 40),
      });
      await boss('POST', `/household/${me.id}/instructions`, {
        body: 'Prado in for its service on Friday morning. Use the Corolla for the school run.',
        memberId: staffId, dueAt: at(4, 8),
      });
    }

    // The day itself.
    const items = [
      { kind: 'car', title: 'Car to the office', startAt: at(0, 7, 30), endAt: at(0, 8, 10), location: 'Ikoyi residence', destination: 'Victoria Island' },
      { kind: 'meeting', title: 'Quarterly review with counsel', startAt: at(0, 9, 0), endAt: at(0, 10, 30), location: 'Boardroom, 12th floor' },
      { kind: 'call', title: 'Call — Lagos Free Zone', startAt: at(0, 11, 0), endAt: at(0, 11, 30) },
      { kind: 'meal', title: 'Lunch with the Ogunlesi family office', startAt: at(0, 13, 0), endAt: at(0, 14, 30), location: 'Ikoyi Club' },
      { kind: 'personal', title: 'School run', startAt: at(0, 15, 30), endAt: at(0, 16, 15) },
      { kind: 'meeting', title: 'Site walk — Lekki Phase 1', startAt: at(0, 17, 0), endAt: at(0, 18, 0), location: 'Lekki Phase 1' },
    ];
    for (const it of items) {
      await boss('POST', `/itinerary/${me.id}/items`, { ...it, startTimezone: 'Africa/Lagos' });
    }
    say(`${items.length} diary entries`);

    // A trip, and the cars that get her to it — the link built this session.
    r = await boss('POST', `/trips/${me.id}`, {
      name: 'Abuja board round', destination: 'Abuja', startsOn: day(1), endsOn: day(4),
    });
    const trip = r.d.trip;
    await boss('POST', `/trips/${me.id}/${trip.id}/travellers`, { name: 'Chidi Okonkwo', role: 'spouse' });
    await boss('POST', `/trips/${me.id}/${trip.id}/contacts`, {
      name: 'Bature Sani', role: 'Abuja office', phone: '+234 802 000 0000',
    });
    await boss('POST', `/itinerary/${me.id}/items`, {
      kind: 'flight', title: 'Lagos → Abuja', startAt: at(1, 7, 30), endAt: at(1, 8, 45),
      reference: 'P47291', terminal: 'MMIA D', seat: '2A', tripId: trip.id, startTimezone: 'Africa/Lagos',
    });
    await boss('POST', `/itinerary/${me.id}/items`, {
      kind: 'hotel', title: 'Transcorp Hilton', startAt: at(1, 14, 0), endAt: at(4, 11, 0),
      location: 'Abuja', tripId: trip.id, startTimezone: 'Africa/Lagos',
    });
    await boss('PATCH', `/trips/${me.id}/${trip.id}`, { status: 'confirmed' });

    // A second, private trip — so the visibility rule has something to be true
    // about in the shots.
    r = await boss('POST', `/trips/${me.id}`, {
      name: 'Family — Cape Town', destination: 'Cape Town', startsOn: day(28), endsOn: day(36),
    });
    await boss('PATCH', `/trips/${me.id}/${r.d.trip.id}/visibility`, { visibility: 'private' });

    // The fleet, and the journeys.
    r = await boss('POST', `/movement/${me.id}/vehicles`, {
      label: 'The Prado', plate: 'LSD-441-KJ', makeModel: 'Toyota Land Cruiser Prado', colour: 'Black',
    });
    const car = r.d.vehicle;
    await boss('POST', `/movement/${me.id}/vehicles/${car.id}/papers`, {
      kind: 'insurance', reference: 'AIICO/4471', expiresOn: day(40),
    }).catch(() => {});
    r = await boss('POST', `/movement/${me.id}/drivers`, {
      name: 'Tunde Bakare', phone: '+234 803 111 2222', notes: 'Knows the Lekki back route.',
    });
    const drv = r.d.driver;

    r = await boss('POST', `/movement/${me.id}/movements`, {
      title: 'To the airport', departsFrom: 'Ikoyi residence', destination: 'MMIA Terminal D',
      departsAt: at(1, 5, 40), expectedMinutes: 70, bufferMinutes: 20, tripId: trip.id,
      notes: 'Third Mainland closed northbound — take the bridge at Lekki.',
    });
    const airport = r.d.movement;
    await boss('POST', `/movement/${me.id}/movements/${airport.id}/vehicles`, {
      vehicleId: car.id, role: 'principal',
    });
    await boss('POST', `/movement/${me.id}/movements/${airport.id}/people`, {
      role: 'driver', driverId: drv.id, name: 'Tunde Bakare', phone: '+234 803 111 2222',
    });
    await boss('POST', `/movement/${me.id}/movements/${airport.id}/people`, {
      role: 'aide', name: 'Sade Ajayi', phone: '+234 805 333 4444',
    });
    await boss('POST', `/movement/${me.id}/movements`, {
      title: 'School run', departsFrom: 'Ikoyi residence', destination: 'Corona School',
      departsAt: at(0, 15, 30), expectedMinutes: 35,
    });
    say('trip, fleet and journeys');

    // Somebody books, and the tier-3 one waits for a yes.
    const anon = client();
    const slots = await anon('GET', `/public/adaeze/board-matter/slots?days=14`);
    const firstSlot = (slots.d?.days || []).flatMap((d) => d.slots || [])[3]
      || (slots.d?.slots || [])[3];
    if (firstSlot) {
      await anon('POST', '/public/adaeze/board-matter/book', {
        name: 'Emeka Nwosu', email: 'emeka@counsel.example', timezone: 'Africa/Lagos',
        startAt: firstSlot.startAt || firstSlot,
      });
    }
    const introSlots = await anon('GET', `/public/adaeze/introduction/slots?days=14`);
    const s2 = (introSlots.d?.days || []).flatMap((d) => d.slots || [])[5]
      || (introSlots.d?.slots || [])[5];
    if (s2) {
      await anon('POST', '/public/adaeze/introduction/book', {
        name: 'Fatima Bello', email: 'fatima@example.com', timezone: 'Europe/London',
        startAt: s2.startAt || s2,
      });
    }
    say('bookings made');

    // Contacts, briefs, instructions, the pad.
    await pa('PATCH', `/pa/${me.id}/contacts/emeka@counsel.example`, {}).catch(() => {});
    await pa('POST', `/pa/${me.id}/contacts`, {
      name: 'Ruth Adeleke', email: 'ruth@counsel.example', relationshipTier: 2,
      notes: 'Emeka’s assistant. Books on his behalf; always copy her.',
      birthday: day(9).slice(5),
    });
    await pa('POST', `/pa/${me.id}/contacts`, {
      name: 'Bature Sani', email: 'bature@abuja.example', relationshipTier: 2,
      notes: 'Runs the Abuja office. Prefers a call to an email.',
    });
    await pa('POST', `/pa/${me.id}/instructions`, {
      text: 'Never a meeting before 09:00. No dinners Monday to Wednesday.', priority: 'high',
    });
    await pa('POST', `/pa/${me.id}/instructions`, {
      text: 'Window seat, aisle side of the cabin. Always a car waiting, never a taxi rank.',
    });
    await pa('POST', '/pad', { ownerId: me.id, body: 'Ask about the school fees deadline', visibility: 'private' });
    await pa('POST', '/pad', { ownerId: me.id, body: 'Chase Bature for the Abuja lease redline', visibility: 'office' });

    // A space, a room with a real decision in it, a project.
    r = await boss('POST', '/spaces', { name: 'Lekki development', context: 'work' });
    const space = r.d.space;
    await boss('POST', `/spaces/${space.id}/members`, { handle: 'ngozi' });
    r = await boss('POST', `/spaces/${space.id}/threads`, { name: 'Site handover' });
    const thread = r.d.thread;
    await pa('POST', `/threads/${thread.id}/messages`, { body: 'Contractor wants the handover moved to the 14th.' });
    await boss('POST', `/threads/${thread.id}/messages`, { body: 'The 14th works if the survey is signed off first.' });
    await pa('POST', `/threads/${thread.id}/messages`, { body: 'Survey came back clean this morning.' });
    await boss('POST', `/threads/${thread.id}/messages`, {
      body: 'Handover moves to the 14th, subject to the signed survey.',
      register: 'record', recordType: 'decision',
    });
    r = await boss('POST', `/spaces/${space.id}/projects`, {
      name: 'Phase 2 fit-out', description: 'From survey to handover.',
    });
    const project = r.d.project;
    await boss('POST', '/tasks', {
      spaceId: space.id, projectId: project.id, title: 'Send the signed survey to counsel',
      assigneeId: paId, dueAt: at(2, 12), priority: 'high',
    });
    await boss('POST', '/tasks', {
      spaceId: space.id, title: 'Confirm the Abuja car for Thursday', assigneeId: paId, dueAt: at(3, 9),
    });
    say('space, room, project, tasks');

    // The vault.
    await boss('POST', `/essentials/${me.id}`, {
      category: 'travel_identity', field: 'passport_number', label: 'Passport (Nigeria)',
      value: 'A05512347', expiresOn: day(120), notes: 'Renewal booked for March.',
    });
    await boss('POST', `/essentials/${me.id}`, {
      category: 'identity_numbers', field: 'nin', label: 'NIN', value: '12345678901',
    });
    await boss('POST', `/essentials/${me.id}`, {
      category: 'loyalty', field: 'frequent_flyer', label: 'Miles & Smiles', value: 'TK 992 118 447',
    });
    await boss('POST', `/essentials/${me.id}`, {
      category: 'travel_identity', field: 'known_traveller_number',
      label: 'Global Entry', value: 'GE 55120987', expiresOn: day(400),
    });
    // An ordinary entry, which exists here so the flag below has somewhere to
    // be caught: a scheduling delegate can read an office address.
    const officeEntry = (await boss('POST', `/essentials/${me.id}`, {
      category: 'logistics', field: 'office_address', label: 'Office address',
      value: '12 Kingsway Road, Ikoyi, Lagos',
    })).d.essential;
    const passportEntry = (await boss('GET', `/essentials/${me.id}`)).d.essentials
      .find((e) => e.field === 'passport_number');

    // The documents behind the numbers. Real bytes rather than placeholders,
    // because the screen shows the format and the size and both would be a lie
    // otherwise — and the fourth one is the point of the lesson: a passport
    // filed under an ordinary field, which the vault marks sensitive anyway.
    const attach = (essId, filename, buf, mimeType) => boss(
      'POST', `/essentials/${me.id}/${essId}/documents`,
      { filename, mimeType, data: buf.toString('base64') },
    );
    const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(240 * 1024, 0x20)]);
    const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1900 * 1024, 7)]);
    const DOCX = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('word/document.xml'),
      Buffer.alloc(38 * 1024, 0)]);
    await attach(passportEntry.id, 'passport-page.jpg', JPEG, 'image/jpeg');
    await attach(officeEntry.id, 'lease-agreement.docx', DOCX,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    await attach(officeEntry.id, 'passport-scan.pdf', PDF, 'application/pdf');
    say('vault filled, documents attached');

    // A notice, so the notices screen is not empty.
    await boss('POST', '/announcements', {
      title: 'Kairos pilot — week two',
      body: 'Thank you for the reports last week. Trips and Movements are now linked: a car that '
        + 'leaves during a trip will offer to file itself under it.',
    }).catch(() => {});

    // ══ PHOTOGRAPH ══════════════════════════════════════════════════════
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });

    async function pageFor(call) {
      const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
      const login = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: call.email, password: PW }),
      });
      const ck = login.headers.get('set-cookie').split(';')[0].split('=');
      await ctx.addCookies([{ name: ck[0], value: ck[1], domain: '127.0.0.1', path: '/' }]);
      return ctx.newPage();
    }

    // ---- Before you are anybody ----------------------------------------
    const out = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
    let p = await out.newPage();
    await p.goto(`${BASE}/`); await ready(p);
    await shot(p, '01-landing', 'The public page, before anybody signs in.');

    await p.goto(`${BASE}/signup`); await ready(p, '.role-option');
    await shot(p, '02-signup', 'Signing up. The first question is which of the two you are, because the app is a different shape for each.');

    await p.click('.role-option:has-text("Principal")');
    await p.fill('#name', 'Chidinma Eze');
    await p.fill('#email', `chi${ID}@x.com`);
    await p.fill('#password', PW);
    await p.click('button:has-text("Create account")');
    await p.waitForURL('**/onboarding/profile', { timeout: 20000 });
    await shot(p, '03-onboarding-profile-empty', 'The handle field is empty on purpose. Nothing is derived from your name and nothing is filled in for you — a handle is yours for good.');

    await p.fill('#slug', 'adaeze');
    await p.waitForSelector('.handle-taken', { timeout: 10000 }).catch(() => {});
    await shot(p, '04-onboarding-handle-taken', 'It says whether a name is free while you type, in the same words the app uses when you press the button.');

    await p.fill('#slug', 'chidinma');
    await p.waitForSelector('.handle-free', { timeout: 10000 }).catch(() => {});
    await shot(p, '05-onboarding-handle-free', 'A free one. Continue is not pressable until there is something in the box.');

    await p.click('button:has-text("Continue")');
    await p.waitForURL('**/onboarding/connect', { timeout: 20000 });
    await shot(p, '06-onboarding-connect', 'Who you work with. An assistant can say their principal is not on Kairos at all — that is the Desk, and it opens the whole app to them anyway.');

    await p.click('button:has-text("Skip for now")');
    await p.waitForURL('**/onboarding/meeting-type', { timeout: 20000 });
    await shot(p, '07-onboarding-meeting-type', 'The first thing people can book. You can add more later; this one exists so the booking page is not empty on day one.');
    await p.fill('#mt-name', 'Introduction');
    await p.click('button:has-text("Finish setup")');
    await p.waitForURL('**/today', { timeout: 20000 });
    await shot(p, '08-first-day', 'A brand new account, before anything is in it. Every feature carries its own note saying what it does — open the first time, folded afterwards.');

    // ---- The principal's app --------------------------------------------
    p = await pageFor({ email: `ada${ID}@x.com` });
    await p.goto(`${BASE}/today`); await ready(p, '.day-spine, .today-head');
    await shot(p, '10-today', 'Today: a real day. The band says what is happening now, the spine below is the day in proportion, and the marker shows where now sits in it.');
    await shot(p, '10b-today-full', 'The whole of Today, including what is waiting on you in the right-hand column.', { full: true });

    await p.click('.what-this-toggle').catch(() => {});
    await shot(p, '11-today-folded', 'The same screen with the note folded. It stays one line, so it is findable again and easy to ignore.');

    await p.goto(`${BASE}/itinerary`); await ready(p);
    await shot(p, '12-itinerary', 'The Itinerary is where the day is built: meetings, cars, meals, the school run — not only bookings.', { full: true });

    await p.goto(`${BASE}/trips`); await ready(p);
    await shot(p, '13-trips', 'Trips. A confirmed trip redraws the whole day in the destination’s timezone.');

    await p.goto(`${BASE}/trips`); await ready(p);
    await p.click('text=Abuja board round').catch(() => {});
    await ready(p);
    await shot(p, '14-trip-detail', 'Inside a trip: the legs, who else is going, who to call there, the documents checked against the trip’s own dates — and the cars, under Getting there and around.', { full: true });

    await p.goto(`${BASE}/movements`); await ready(p);
    await shot(p, '15-movements', 'Movements: getting the principal there on the ground. Most journeys belong to no trip at all — the school run, the airport at 5am.', { full: true });

    await p.goto(`${BASE}/movements?tab=fleet`); await ready(p);
    await shot(p, '16-fleet', 'The cars, with their papers and when each runs out.');
    await p.goto(`${BASE}/movements?tab=drivers`); await ready(p);
    await shot(p, '17-drivers', 'The drivers.');

    await p.goto(`${BASE}/catch-up`); await ready(p);
    await shot(p, '18-catch-up', 'While you were away — ordered by what would be worst to have missed, not by time.', { full: true });

    await p.goto(`${BASE}/pad`); await ready(p);
    await shot(p, '19-pad', 'The Pad. One field and nothing in the way of it: a thought arrives walking out of a meeting, and if capturing it costs a form it is not captured.');

    await p.goto(`${BASE}/report`); await ready(p);
    await shot(p, '20-report', 'The Report: what the period actually held, for any dates you ask for.', { full: true });

    // Two parts chosen, so the shot teaches the picker rather than merely
    // showing that it exists. Waited on the note the client draws from its own
    // state — .report-parts is there before and after, which would photograph
    // the previous document.
    await p.click('.report-parts button:has-text("Still open now")').catch(() => {});
    await p.click('.report-parts button:has-text("Needs attention")').catch(() => {});
    await p.waitForSelector('.report-parts-note', { timeout: 10000 }).catch(() => {});
    await shot(p, '20b-report-parts', 'Choosing which parts of the report you want. Name nothing and you get the whole thing, segmented; name two and the document says on its first line that it is a part.', { full: true });

    await p.goto(`${BASE}/dashboard?tab=essentials`); await ready(p, '.ess-docs');
    await shot(p, '21-essentials', 'Essentials. Encrypted, and every reveal is asked for and written down. AI never reads or writes here, under any instruction.', { full: true });

    // The flag, in a picture: the badge sits on the passport filed under an
    // ordinary field, and on nothing else on the screen.
    await p.click('.ess-docs button:has-text("Open passport-page.jpg")').catch(() => {});
    await p.waitForTimeout(700);
    await shot(p, '21b-vault-open-document', 'Opening a document costs exactly what revealing the number beside it costs — the same second factor, and the same line in the principal’s trail.');

    await p.goto(`${BASE}/dashboard?tab=security`); await ready(p);
    await shot(p, '22-security', 'Security: who is signed in as you, and the codes that guard the sensitive parts. No code is ever asked for at the front door.', { full: true });

    await p.goto(`${BASE}/dashboard?tab=members`); await ready(p);
    await shot(p, '23-team', 'Appointing the people who work for you, and deciding what each of them can reach.', { full: true });

    await p.goto(`${BASE}/dashboard?tab=meeting_types`); await ready(p);
    await shot(p, '24-meeting-types', 'What you offer: a length, a format, and which tier may book it. A higher tier means the request waits for a yes.', { full: true });

    await p.goto(`${BASE}/dashboard?tab=availability`); await ready(p);
    await shot(p, '25-availability', 'When you can be booked, how much of a block can be taken, and the breather after each appointment.', { full: true });

    await p.goto(`${BASE}/dashboard?tab=calendar`); await ready(p);
    await shot(p, '26-calendar', 'The month at once, colour-coded by meeting type.');

    await p.goto(`${BASE}/household`); await ready(p);
    await shot(p, '27-household', 'The household: what each member of staff was told, and whether they have said they got it.', { full: true });

    await p.goto(`${BASE}/spaces`); await ready(p);
    await shot(p, '28-spaces', 'Spaces. One per piece of work, sealed from each other — being in one tells you nothing about any other.');

    await p.click('text=Lekki development').catch(() => {});
    await ready(p);
    await shot(p, '29-space', 'Inside a space: its rooms, its projects and the people allowed in it.', { full: true });

    await p.goto(`${BASE}/tasks`); await ready(p);
    await shot(p, '30-tasks', 'Everything assigned to you, across every space and every principal.');

    await p.goto(`${BASE}/archive`); await ready(p);
    await shot(p, '31-archive', 'The Archive: what the office decided was worth keeping after the rooms it was said in had finished.');

    await p.goto(`${BASE}/connections`); await ready(p);
    await shot(p, '32-connections', 'Reaching the assistant on the other side. There is no search here and there never will be — a directory of who runs whom is itself the sensitive thing.');

    await p.goto(`${BASE}/coming`); await ready(p);
    await shot(p, '33-coming', 'Everything designed but not working yet, and exactly what each one is waiting on. Nothing in Kairos pretends.', { full: true });

    await p.goto(`${BASE}/notices`); await ready(p);
    await shot(p, '34-notices', 'Notices from whoever is running the pilot, kept out of your inbox.');

    await p.goto(`${BASE}/concierge`); await ready(p);
    await shot(p, '35-concierge', 'The concierge desk, shown before it opens rather than hidden. It is waiting on contracted people, not on code, so it carries no date.');

    // The room, with both registers.
    await p.goto(`${BASE}/threads/${thread.id}`); await ready(p);
    await shot(p, '36-thread', 'A room has two registers: what was said, and what was decided. Promoting a line into the record is deliberate, and it then cannot be edited.', { full: true });

    await p.goto(`${BASE}/projects/${project.id}`); await ready(p);
    await shot(p, '37-project', 'A project in stages, where the stage moves on what was actually decided in the rooms rather than on a dropdown anyone can set.', { full: true });

    // ---- The assistant's app ---------------------------------------------
    const q = await pageFor({ email: `ngozi${ID}@x.com` });
    await q.goto(`${BASE}/workspace`); await ready(q);
    await shot(q, '40-workspace', 'The assistant opens here: what is outstanding across every principal they run, without picking one first.', { full: true });

    await q.goto(`${BASE}/pa`); await ready(q);
    await shot(q, '41-desk', 'The Desk. Every section of the work for one principal, with what is waiting in each — rather than opening on one of nine and saying nothing about the other eight.', { full: true });

    await q.goto(`${BASE}/pa?tab=approvals`); await ready(q);
    await shot(q, '42-approvals', 'Approvals: requests for the principal’s time. Accept, decline, or counter with a different time — nothing lands in the diary until somebody says yes.', { full: true });

    await q.goto(`${BASE}/pa?tab=contacts`); await ready(q);
    await shot(q, '43-contacts', 'Contacts, with the things nobody writes down — and the birthdays band, because those are the same records read one tab away.', { full: true });

    await q.goto(`${BASE}/pa?tab=instructions`); await ready(q);
    await shot(q, '44-instructions', 'Standing instructions: what this principal always wants, written once so it is not asked twice.', { full: true });

    await q.goto(`${BASE}/pa?tab=briefs`); await ready(q);
    await shot(q, '45-briefs', 'The brief the principal reads in the car — assembled from what is already held rather than retyped.', { full: true });

    await q.goto(`${BASE}/pa?tab=ai_assist`); await ready(q);
    await shot(q, '46-assist', 'AI Assist. Finding a time uses no model at all — it filters the same real open slots the booking page uses, so it cannot invent one.', { full: true });

    await q.goto(`${BASE}/pa?tab=comms`); await ready(q);
    await shot(q, '47-comms', 'Drafts on the principal’s behalf. Nothing is ever sent by anything but a person.', { full: true });

    await q.goto(`${BASE}/mail`); await ready(q);
    await shot(q, '48-correspondence', 'Correspondence: what has come in, and what each thing needs.', { full: true });

    await q.goto(`${BASE}/pa?tab=bookings`); await ready(q);
    await shot(q, '49-bookings', 'Everything already agreed, and what has been asked to change.', { full: true });

    // ---- The staff member -------------------------------------------------
    const d = await pageFor({ email: `tunde${ID}@x.com` });
    await d.goto(`${BASE}/instructions`); await ready(d);
    await shot(d, '50-staff', 'The driver’s whole app: what they are doing, and one tap to say they have got it. Nothing else is reachable from their account at all.', { full: true });

    // ---- The visitor ------------------------------------------------------
    const v = await out.newPage();
    await v.goto(`${BASE}/book/adaeze`); await ready(v);
    await shot(v, '60-booking-page', 'What an outsider sees: the booking page at your handle, with the meeting types you offer.', { full: true });

    await v.goto(`${BASE}/book/adaeze/introduction`); await ready(v);
    await shot(v, '61-booking-slots', 'They pick their own timezone, see your times in it, and yours is shown alongside — so nobody does the arithmetic in their head.', { full: true });

    // ---- Video: two flows that stills cannot carry -------------------------
    async function clip(name, email, run) {
      const ctx = await browser.newContext({
        viewport: VIEW, deviceScaleFactor: 1,
        recordVideo: { dir: path.join(OUT, 'clips', name), size: { width: 1100, height: 700 } },
      });
      if (email) {
        const login = await fetch(`${BASE}/api/auth/login`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: PW }),
        });
        const ck = login.headers.get('set-cookie').split(';')[0].split('=');
        await ctx.addCookies([{ name: ck[0], value: ck[1], domain: '127.0.0.1', path: '/' }]);
      }
      const pg = await ctx.newPage();
      try { await run(pg); } catch (e) { console.log(`   ! clip ${name}: ${e.message}`); }
      await ctx.close();
      const dir = path.join(OUT, 'clips', name);
      const f = fs.readdirSync(dir).find((x) => x.endsWith('.webm'));
      if (f) {
        fs.renameSync(path.join(dir, f), path.join(OUT, 'clips', `${name}.webm`));
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`  ▶ ${name}.webm  ${Math.round(fs.statSync(path.join(OUT, 'clips', `${name}.webm`)).size / 1024)}KB`);
      }
    }

    await clip('booking', null, async (pg) => {
      await pg.goto(`${BASE}/book/adaeze`); await ready(pg); await pg.waitForTimeout(1200);
      await pg.click('text=Introduction').catch(() => {});
      await ready(pg); await pg.waitForTimeout(1500);
      const slot = pg.locator('.slot-grid button, button.slot').first();
      await slot.click({ timeout: 5000 }).catch(() => {});
      await pg.waitForTimeout(1200);
      await pg.fill('#booker-name', 'Kemi Adeyemi').catch(() => {});
      await pg.fill('#booker-email', 'kemi@example.com').catch(() => {});
      await pg.waitForTimeout(1500);
    });

    await clip('guidance', `ada${ID}@x.com`, async (pg) => {
      await pg.goto(`${BASE}/today`); await ready(pg, '.what-this-does'); await pg.waitForTimeout(1500);
      await pg.click('.what-this-toggle'); await pg.waitForTimeout(1200);
      await pg.click('.what-this-toggle'); await pg.waitForTimeout(1200);
      await pg.goto(`${BASE}/trips`); await ready(pg, '.what-this-does'); await pg.waitForTimeout(2000);
      await pg.goto(`${BASE}/movements`); await ready(pg, '.what-this-does'); await pg.waitForTimeout(2000);
    });

    await clip('desk', `ngozi${ID}@x.com`, async (pg) => {
      await pg.goto(`${BASE}/pa`); await ready(pg); await pg.waitForTimeout(1800);
      await pg.click('text=Approvals').catch(() => {});
      await ready(pg); await pg.waitForTimeout(1800);
      await pg.click('text=The whole desk').catch(() => {});
      await ready(pg); await pg.waitForTimeout(1200);
      await pg.click('text=Contacts').catch(() => {});
      await ready(pg); await pg.waitForTimeout(1800);
    });

    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ shots, notes }, null, 2));
    const total = shots.reduce((a, s) => a + s.kb, 0);
    console.log(`\n${shots.length} shots, ${total}KB total`);

  } catch (err) {
    console.log('THREW: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close().catch(() => {});
    proc.kill();
    store.close();
  }
})();
