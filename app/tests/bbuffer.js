// How much room the day needs, asked of the road rather than guessed once.
//
// Three claims, and the second is the one the owner asked for by name.
//
//   1. The arithmetic is arithmetic. Drive plus a stated margin, against the
//      gap the diary leaves, and the shortfall is the subtraction. No model,
//      and therefore the same answer twice.
//
//   2. A PRIVATE TRIP AND PERSONAL TIME ARE NEVER SENT TO THE PROVIDER. Not
//      merely absent from the answer — never asked about. Proved by counting
//      the requests the fake maps provider actually receives, because an
//      assertion that a suggestion is missing passes just as well when the
//      lookup happened and the result was dropped afterwards, which is the
//      version of this feature that leaks.
//
//   3. The answer is live per departure, not a rigid stored fact. A cache
//      keyed on hour-of-week would answer next Thursday with last Thursday's
//      traffic; a six-hour TTL answers a 6pm drive with the 9am guess. Both
//      are proved against here.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const http = require('http');

const PORT = 4611, BASE = `http://127.0.0.1:${PORT}`;
const MAPS_PORT = 4612;
const ID = Date.now().toString(36);
const PW = 'password123';

let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

// ---- A maps provider that keeps the receipts ---------------------------
//
// It answers in the Distance Matrix shape and, more importantly, records every
// origin and destination it was asked about. That log is the only way to prove
// a negative here: "was this address ever sent" is a different question from
// "did the address appear in the answer", and only the first one is privacy.
const asked = [];
const typed = [];
let minutesToReturn = 40;
const maps = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${MAPS_PORT}`);
  // Two logs, because they are two different exposures. `asked` is one route
  // for a leg that exists; `typed` is what somebody was in the middle of
  // writing. The second is the one a rule that only guards saved rows misses.
  if (u.pathname.startsWith('/places')) {
    typed.push({ input: u.searchParams.get('input'), sessiontoken: u.searchParams.get('sessiontoken') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'OK',
      predictions: [
        { place_id: 'PLACE_1', description: 'Radisson Blu, Ikeja',
          structured_formatting: { main_text: 'Radisson Blu', secondary_text: 'Ikeja, Lagos' } },
        { place_id: 'PLACE_2', description: 'Eko Hotel',
          structured_formatting: { main_text: 'Eko Hotel', secondary_text: 'Victoria Island, Lagos' } },
      ],
    }));
    return;
  }
  asked.push({
    origins: u.searchParams.get('origins'),
    destinations: u.searchParams.get('destinations'),
    departure_time: Number(u.searchParams.get('departure_time')),
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'OK',
    rows: [{ elements: [{
      status: 'OK',
      duration: { value: minutesToReturn * 60 },
      duration_in_traffic: { value: minutesToReturn * 60 },
      distance: { value: 12000 },
    }] }],
  }));
});

function boot() {
  return spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      MAPS_API_KEY: 'test-key',
      MAPS_BASE_URL: `http://127.0.0.1:${MAPS_PORT}/dm`,
      PLACES_BASE_URL: `http://127.0.0.1:${MAPS_PORT}/places`,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function ready() {
  for (let i = 0; i < 300; i += 1) {
    try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) return; }
    catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server never came up');
}

const jar = {};
async function call(method, path, body, who = 'pa') {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(jar[who] ? { Cookie: jar[who] } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const setC = res.headers.get('set-cookie');
  if (setC) jar[who] = setC.split(';')[0];
  let json = null;
  try { json = await res.json(); } catch { /* some routes return nothing */ }
  return { status: res.status, d: json };
}

async function signup(who, name, email) {
  const up = await call('POST', '/api/auth/signup',
    { name, email, password: PW, accountCategory: 'principal' }, who);
  return up.d?.user?.id;
}

(async () => {
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  // Guarded, unlike most of the board: on a Postgres run there is no file to
  // delete, and deleting one anyway is how a suite unlinks the database out
  // from under a server that is still using it.
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }
  await new Promise((r) => maps.listen(MAPS_PORT, r));
  const srv = boot();
  try {
    await ready();

    // ---- One principal, one day, three places ---------------------------
    const owner = await signup('p', 'Adaeze Okonkwo', `ada${ID}@x.com`);
    ok('the principal has an account', !!owner, 'signup returned no user');

    // A day far enough out that the freshness window is the "today-ish" one
    // rather than the imminent one, so the reuse assertions are stable.
    const day = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    day.setUTCHours(9, 0, 0, 0);
    const at = (h, m = 0) => {
      const d = new Date(day);
      d.setUTCHours(h, m, 0, 0);
      return d.toISOString();
    };

    const mk = async (body) => (await call('POST', `/api/itinerary/${owner}/items`, body, 'p')).d;

    // 09:00–10:00 in Ikoyi, then 10:30 in Victoria Island. Half an hour of gap
    // against a forty-minute drive: the case the feature exists for.
    await mk({ kind: 'meeting', title: 'Board', startAt: at(9), endAt: at(10), location: 'Ikoyi, Lagos' });
    await mk({ kind: 'meeting', title: 'Bank', startAt: at(10, 30), endAt: at(11, 30), location: 'Victoria Island, Lagos' });

    const from = at(0);
    const to = at(23, 59);

    head('The gap is measured against the road, not against a typed number:');
    asked.length = 0;
    const r1 = await call('GET', `/api/itinerary/${owner}/travel-buffers?from=${from}&to=${to}`, null, 'p');
    ok('the day answers', r1.status === 200, JSON.stringify(r1.d).slice(0, 200));
    const gap = (r1.d.pairs || []).find((p) => p.beforeTitle === 'Bank');
    ok('the pair is there', !!gap, JSON.stringify(r1.d.pairs));
    ok('and it asked the provider about the real two places', asked.length === 1
      && /Ikoyi/.test(asked[0].origins) && /Victoria Island/.test(asked[0].destinations),
      JSON.stringify(asked));
    ok('at the departure instant, not at "now"',
      Math.abs(asked[0].departure_time * 1000 - Date.parse(at(10))) < 1000,
      `${asked[0].departure_time} vs ${Date.parse(at(10)) / 1000}`);
    ok('the drive is what the road said', gap && gap.driveMinutes === 40, JSON.stringify(gap));
    ok('the margin is a quarter, capped at twenty', gap && gap.marginMinutes === 10, String(gap?.marginMinutes));
    ok('so the day needs fifty minutes', gap && gap.suggestedMinutes === 50, String(gap?.suggestedMinutes));
    ok('and leaves thirty', gap && gap.gapMinutes === 30, String(gap?.gapMinutes));
    ok('which is twenty minutes short, and said so', gap && gap.shortfallMinutes === 20 && gap.tight === true,
      JSON.stringify(gap));

    head('Nothing was written — a suggestion is not a decision:');
    const after = (await call('GET', `/api/itinerary/${owner}/day?date=${at(9).slice(0, 10)}`, null, 'p')).d;
    const bank = (after.entries || []).find((e) => e.title === 'Bank');
    ok('the item still carries the travel minutes it always had',
      bank && Number(bank.travelMinutes || 0) === 0, JSON.stringify(bank).slice(0, 160));

    // ---- The claim the owner asked for by name --------------------------
    head('Personal time is never sent to the provider:');
    await mk({ kind: 'personal', title: 'School run', startAt: at(14), endAt: at(15), location: 'Lekki Phase 1' });
    await mk({ kind: 'meeting', title: 'Dinner', startAt: at(16), endAt: at(17), location: 'Ikeja GRA' });
    asked.length = 0;
    const r2 = await call('GET', `/api/itinerary/${owner}/travel-buffers?from=${from}&to=${to}`, null, 'p');
    const personalPairs = (r2.d.pairs || []).filter((p) => /School run/.test(`${p.afterTitle} ${p.beforeTitle}`));
    ok('the pairs touching it are reported, not silently dropped', personalPairs.length === 2,
      JSON.stringify(r2.d.pairs.map((p) => `${p.afterTitle}->${p.beforeTitle}`)));
    ok('and every one of them is refused as private',
      personalPairs.every((p) => p.skipped === 'private'), JSON.stringify(personalPairs));
    // THE ASSERTION THAT MATTERS. Not "is it missing from the answer" — that
    // passes when the lookup happened and the result was thrown away.
    ok('and the provider was never told where the school run goes',
      !asked.some((a) => /Lekki/.test(`${a.origins} ${a.destinations}`)), JSON.stringify(asked));

    head('A private trip is never sent to the provider either:');
    const trip = (await call('POST', `/api/trips/${owner}`, {
      name: 'Family', destination: 'Accra', startsOn: at(9).slice(0, 10), endsOn: at(9).slice(0, 10),
      visibility: 'private',
    }, 'p')).d;
    const tripId = trip?.trip?.id;
    ok('the private trip was made', !!tripId, JSON.stringify(trip).slice(0, 200));
    await mk({
      kind: 'meeting', title: 'Villa', startAt: at(19), endAt: at(20),
      location: 'Banana Island', tripId,
    });
    await mk({ kind: 'meeting', title: 'Late call', startAt: at(21), endAt: at(22), location: 'Ikoyi, Lagos' });
    asked.length = 0;
    const r3 = await call('GET', `/api/itinerary/${owner}/travel-buffers?from=${from}&to=${to}`, null, 'p');
    const villa = (r3.d.pairs || []).filter((p) => /Villa/.test(`${p.afterTitle} ${p.beforeTitle}`));
    ok('its legs are refused', villa.length > 0 && villa.every((p) => p.skipped === 'private'),
      JSON.stringify(villa));
    ok('and Banana Island never reached the provider',
      !asked.some((a) => /Banana/.test(`${a.origins} ${a.destinations}`)), JSON.stringify(asked));

    head('The per-item estimate refuses the same two things:');
    const items = (await call('GET', `/api/itinerary/${owner}/day?date=${at(9).slice(0, 10)}`, null, 'p')).d;
    const school = (items.entries || []).find((e) => e.title === 'School run');
    asked.length = 0;
    const direct = await call('POST', `/api/itinerary/${owner}/items/${school.id}/travel-time`,
      { from: 'Lekki Phase 1', to: 'Ikeja GRA' }, 'p');
    ok('personal time is refused outright', direct.status === 403, `${direct.status} ${JSON.stringify(direct.d)}`);
    ok('and nothing was asked of the provider', asked.length === 0, JSON.stringify(asked));

    // ---- Live per departure, not a rigid stored fact --------------------
    head('The answer is per departure instant, not per weekday:');
    asked.length = 0;
    minutesToReturn = 75;
    // Same two places, same hour, SEVEN DAYS LATER. A key folded on
    // hour-of-week would serve the first answer and never ask again.
    const nextWeek = new Date(day.getTime() + 7 * 24 * 3600 * 1000);
    const nw = (h) => { const d = new Date(nextWeek); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
    await mk({ kind: 'meeting', title: 'Board wk2', startAt: nw(9), endAt: nw(10), location: 'Ikoyi, Lagos' });
    await mk({ kind: 'meeting', title: 'Bank wk2', startAt: nw(11), endAt: nw(12), location: 'Victoria Island, Lagos' });
    const r4 = await call('GET',
      `/api/itinerary/${owner}/travel-buffers?from=${nw(0)}&to=${nw(23)}`, null, 'p');
    const wk2 = (r4.d.pairs || []).find((p) => p.beforeTitle === 'Bank wk2');
    ok('the same weekday a week later asks the road again',
      asked.some((a) => /Ikoyi/.test(a.origins)), JSON.stringify(asked));
    ok('and gets that week\'s answer, not last week\'s',
      wk2 && wk2.driveMinutes === 75, JSON.stringify(wk2));

    head('Every answer says when the road was actually asked:');
    ok('a fresh one is stamped', gap && typeof gap.readAt === 'string' && gap.ageSeconds === 0,
      JSON.stringify({ readAt: gap?.readAt, age: gap?.ageSeconds }));

    head('A repeat within the window is reused, and says it was:');
    asked.length = 0;
    const r5 = await call('GET',
      `/api/itinerary/${owner}/travel-buffers?from=${nw(0)}&to=${nw(23)}`, null, 'p');
    const again = (r5.d.pairs || []).find((p) => p.beforeTitle === 'Bank wk2');
    ok('the provider was not asked twice for the same instant', asked.length === 0, JSON.stringify(asked));
    ok('and the answer admits it is not a fresh read', again && again.cached === true,
      JSON.stringify(again));

    head('…but asking for fresh goes back to the road:');
    asked.length = 0;
    minutesToReturn = 95;
    const r6 = await call('GET',
      `/api/itinerary/${owner}/travel-buffers?from=${nw(0)}&to=${nw(23)}&fresh=1`, null, 'p');
    const forced = (r6.d.pairs || []).find((p) => p.beforeTitle === 'Bank wk2');
    ok('the road was asked again', asked.length >= 1, JSON.stringify(asked));
    ok('and the new number came back', forced && forced.driveMinutes === 95, JSON.stringify(forced));

    // ---- A place, rather than a phrase ----------------------------------
    head('What was typed can be resolved to a place the map knows:');
    typed.length = 0;
    const found = await call('GET',
      `/api/itinerary/${owner}/places?q=Radisson&kind=meeting&session=abc`, null, 'p');
    ok('the search answers', found.status === 200, JSON.stringify(found.d));
    ok('with places carrying an id', (found.d.places || []).length > 0
      && found.d.places[0].placeId === 'PLACE_1', JSON.stringify(found.d.places));
    ok('and the session token was passed on, so it bills once per edit',
      typed[0]?.sessiontoken === 'abc', JSON.stringify(typed));

    head('A pinned place is asked about exactly, not as words:');
    const pinned = await mk({
      kind: 'meeting', title: 'Pinned start', startAt: nw(16), endAt: nw(17),
      location: 'Radisson Blu, Ikeja', locationPlaceId: 'PLACE_1',
    });
    await mk({
      kind: 'meeting', title: 'Pinned end', startAt: nw(19), endAt: nw(20),
      location: 'Eko Hotel', locationPlaceId: 'PLACE_2',
    });
    asked.length = 0;
    const rp = await call('GET',
      `/api/itinerary/${owner}/travel-buffers?from=${nw(0)}&to=${nw(23)}&fresh=1`, null, 'p');
    const leg = (rp.d.pairs || []).find((p) => p.beforeTitle === 'Pinned end');
    const pinnedCall = asked.find((a) => /PLACE_1/.test(a.origins));
    ok('the road was asked about the place id', !!pinnedCall
      && pinnedCall.origins === 'place_id:PLACE_1' && pinnedCall.destinations === 'place_id:PLACE_2',
      JSON.stringify(asked));
    ok('but the screen is still told the words somebody wrote',
      leg && leg.from === 'Radisson Blu, Ikeja' && leg.to === 'Eko Hotel', JSON.stringify(leg));
    ok('and it says the lookup was exact', leg && leg.exact === true, JSON.stringify(leg));

    head('Editing the words unpins the place, so the two cannot disagree:');
    await call('PATCH', `/api/itinerary/${owner}/items/${pinned.item.id}`,
      { location: 'the other Radisson' }, 'p');
    const reread = (await call('GET', `/api/itinerary/${owner}/items/${pinned.item.id}`, null, 'p')).d;
    ok('the id is gone', (reread.item.locationPlaceId ?? null) === null, JSON.stringify(reread.item?.locationPlaceId));
    asked.length = 0;
    const rq = await call('GET',
      `/api/itinerary/${owner}/travel-buffers?from=${nw(0)}&to=${nw(23)}&fresh=1`, null, 'p');
    ok('and the road is asked about the new words instead',
      asked.some((a) => a.origins === 'the other Radisson'), JSON.stringify(asked));
    const unpinned = (rq.d.pairs || []).find((p) => p.beforeTitle === 'Pinned end');
    ok('which is no longer an exact lookup, and says so',
      unpinned && unpinned.exact === false, JSON.stringify(unpinned));

    // THE KEYSTROKE LEAK. The distance rule guards a saved item; this guards
    // the search box, which sends the beginning of a private destination and
    // then a bit more of it, before anything has been saved at all.
    head('Personal time is never even typed into the provider:');
    typed.length = 0;
    const noSearch = await call('GET',
      `/api/itinerary/${owner}/places?q=Lekki&kind=personal`, null, 'p');
    ok('the search is refused', noSearch.status === 403, `${noSearch.status} ${JSON.stringify(noSearch.d)}`);
    ok('and nothing was typed at the provider', typed.length === 0, JSON.stringify(typed));

    head('Nor is a private trip:');
    typed.length = 0;
    const noTrip = await call('GET',
      `/api/itinerary/${owner}/places?q=Banana&kind=meeting&tripId=${tripId}`, null, 'p');
    ok('the search is refused', noTrip.status === 403, `${noTrip.status} ${JSON.stringify(noTrip.d)}`);
    ok('and nothing was typed at the provider', typed.length === 0, JSON.stringify(typed));

    // ---- The freshness policy itself ------------------------------------
    //
    // Asserted directly rather than through the server, because the tiers are
    // minutes and hours apart and a suite cannot wait them out. Requiring the
    // module is safe: lib/db.js connects lazily, so nothing opens a database.
    head('How long an answer stays good for depends on how close the departure is:');
    const tt = require(`${ROOT}/app/server/lib/travelTime`);
    const H = 60 * 60 * 1000;
    ok('a departure inside two hours is essentially live',
      tt.freshnessMs(Date.now() + 1 * H) === 90 * 1000, String(tt.freshnessMs(Date.now() + 1 * H)));
    ok('later today is reused for a quarter of an hour',
      tt.freshnessMs(Date.now() + 12 * H) === 15 * 60 * 1000, String(tt.freshnessMs(Date.now() + 12 * H)));
    ok('days out, where the provider is modelling rather than watching, for six hours',
      tt.freshnessMs(Date.now() + 72 * H) === 6 * H, String(tt.freshnessMs(Date.now() + 72 * H)));

    head('And the operator dial only ever tightens it:');
    process.env.MAPS_CACHE_TTL_MS = '5000';
    ok('a lower ceiling wins', tt.freshnessMs(Date.now() + 72 * H) === 5000,
      String(tt.freshnessMs(Date.now() + 72 * H)));
    // THE ONE THAT GUARDS THE DEFECT. The old flat six-hour TTL answered a
    // 6pm drive with the 9am guess. An env var that could put that back is not
    // a setting, it is the same bug behind a name somebody has to know about.
    process.env.MAPS_CACHE_TTL_MS = String(48 * H);
    ok('a higher one cannot make an imminent departure stale again',
      tt.freshnessMs(Date.now() + 1 * H) === 90 * 1000, String(tt.freshnessMs(Date.now() + 1 * H)));
    delete process.env.MAPS_CACHE_TTL_MS;

    head('A leg with nowhere to go says so rather than vanishing:');
    minutesToReturn = 40;
    await mk({ kind: 'meeting', title: 'Somewhere', startAt: nw(14), endAt: nw(15), location: '' });
    const r7 = await call('GET',
      `/api/itinerary/${owner}/travel-buffers?from=${nw(0)}&to=${nw(23)}`, null, 'p');
    const blank = (r7.d.pairs || []).find((p) => p.beforeTitle === 'Somewhere');
    ok('it is listed as skipped with a reason', blank && blank.skipped === 'no-place' && /location/.test(blank.why),
      JSON.stringify(blank));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    srv.kill();
    await new Promise((r) => maps.close(r));
  }
  console.log(fails === 0
    ? '\nThe day is measured against the road at the hour it happens, and what is private is never asked about.'
    : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
