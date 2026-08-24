// A standing arrangement, through the actual API.
//
// brecur proves the calendar arithmetic. This proves the part that arithmetic
// cannot: that each occurrence is a real entry with an id, that it shows up on
// the right day, and — the one that matters — that the three ways of
// cancelling a repeating thing are three different things and stay that way.
// Getting that wrong deletes a year of somebody's diary.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
const PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (t) => console.log(`\n${t}`);

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
    let d = null;
    try { d = text ? JSON.parse(text) : null; } catch { d = text; }
    return { s: r.status, d };
  };
}

// The range endpoint answers with days keyed by date, since that is what a
// calendar draws. Flattened here because this suite cares about the series,
// not the grid.
const flat = (d) => Object.values(d?.days || {}).flat();

// A fixed future Monday, so nothing here depends on the day it is run — the
// bug family this repo keeps meeting is the test that is green until eleven
// at night.
const MONDAY = '2027-03-01';

(async () => {
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL || '',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const deadline = Date.now() + 20000;
  for (;;) {
    try { const r = await (await fetch(`${BASE}/api/status`)).json(); if (r.databaseReady) break; } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('no server');
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    const boss = client();
    await boss('POST', '/auth/signup', { name: 'Adaeze Okonkwo', email: `boss${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const me = (await boss('GET', '/auth/me')).d.user;
    await boss('PATCH', '/profile', { slug: `adaeze-${ID}`, timezone: 'Africa/Lagos' });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const make = (body) => boss('POST', `/itinerary/${me.id}/items`, body);

    // --- A standing weekly meeting ---------------------------------------
    head('A standing Monday meeting:');
    let r = await make({
      kind: 'meeting',
      title: 'Leadership',
      startAt: `${MONDAY}T09:00:00Z`,
      endAt: `${MONDAY}T10:00:00Z`,
      startTimezone: 'Africa/Lagos',
      recurrence: { freq: 'weekly', count: 6 },
    });
    ok('is created', r.s === 201, JSON.stringify(r.d).slice(0, 200));
    ok('and says how many it made, rather than quietly making six',
      r.d.occurrences === 6, String(r.d.occurrences));
    ok('they share a series', !!r.d.seriesId);
    ok('and each one says what it is', r.d.item.recurrenceLabel === 'Every week',
      r.d.item.recurrenceLabel);
    const seriesId = r.d.seriesId;

    // Each occurrence is a real entry on a real day, not a rule redrawn.
    r = await boss('GET', `/itinerary/${me.id}/range?from=${MONDAY}&to=2027-04-12`);
    const mine = flat(r.d).filter((e) => e.title === 'Leadership');
    ok('every occurrence is a real entry with an id of its own',
      mine.length === 6 && new Set(mine.map((e) => e.id)).size === 6, String(mine.length));
    ok('a week apart each time',
      mine.map((e) => e.startAt.slice(0, 10)).join(' ')
        === '2027-03-01 2027-03-08 2027-03-15 2027-03-22 2027-03-29 2027-04-05',
      mine.map((e) => e.startAt.slice(0, 10)).join(' '));
    ok('and each carries the series it belongs to',
      mine.length === 6 && mine.every((e) => e.seriesId === seriesId),
      `${mine.length} entries`);

    // --- One of them is not like the others -------------------------------
    head('One occurrence can be changed without touching the rest:');
    const third = mine[2];
    r = await boss('PATCH', `/itinerary/${me.id}/items/${third.id}`, { title: 'Leadership — offsite' });
    ok('renaming one is accepted', r.s === 200, JSON.stringify(r.d).slice(0, 160));
    r = await boss('GET', `/itinerary/${me.id}/range?from=${MONDAY}&to=2027-04-12`);
    let still = flat(r.d).filter((e) => /^Leadership/.test(e.title));
    ok('and leaves the others alone',
      still.filter((e) => e.title === 'Leadership').length === 5, String(still.length));

    // --- The three cancellations ------------------------------------------
    head('Away next week — remove just that one:');
    r = await boss('DELETE', `/itinerary/${me.id}/items/${mine[1].id}?scope=one`);
    ok('one is removed', r.s === 200 && r.d.removed === 1, JSON.stringify(r.d));
    r = await boss('GET', `/itinerary/${me.id}/range?from=${MONDAY}&to=2027-04-12`);
    still = flat(r.d).filter((e) => /^Leadership/.test(e.title));
    ok('and the other five stand', still.length === 5, String(still.length));

    head('The arrangement ends — remove this one and every one after:');
    r = await boss('DELETE', `/itinerary/${me.id}/items/${mine[3].id}?scope=following`);
    ok('the rest go together', r.s === 200 && r.d.removed === 3, JSON.stringify(r.d));
    r = await boss('GET', `/itinerary/${me.id}/range?from=${MONDAY}&to=2027-04-12`);
    still = flat(r.d).filter((e) => /^Leadership/.test(e.title));
    // The one that proves "following" means following and not "everything".
    ok('what already happened is left alone', still.length === 2,
      still.map((e) => e.startAt.slice(0, 10)).join(' '));
    ok('and it is the earlier ones that survive',
      still.every((e) => e.startAt < mine[3].startAt),
      still.map((e) => e.startAt.slice(0, 10)).join(' '));

    head('Set up wrongly — remove the lot:');
    r = await boss('DELETE', `/itinerary/${me.id}/items/${mine[0].id}?scope=series`);
    ok('everything left in the series goes', r.s === 200 && r.d.removed === 2, JSON.stringify(r.d));
    r = await boss('GET', `/itinerary/${me.id}/range?from=${MONDAY}&to=2027-04-12`);
    ok('and nothing of it remains',
      flat(r.d).filter((e) => /^Leadership/.test(e.title)).length === 0);

    // --- The other rules, end to end --------------------------------------
    head('The board meets on the second Tuesday:');
    r = await make({
      kind: 'meeting',
      title: 'Board',
      startAt: '2027-03-09T14:00:00Z',
      startTimezone: 'Africa/Lagos',
      recurrence: { freq: 'monthly-weekday', count: 4 },
    });
    ok('created', r.s === 201, JSON.stringify(r.d).slice(0, 160));
    ok('and named as the rule it is, not just "monthly"',
      r.d.item.recurrenceLabel === 'The second Tuesday of every month',
      r.d.item.recurrenceLabel);
    r = await boss('GET', `/itinerary/${me.id}/range?from=2027-03-01&to=2027-06-30`);
    const board = flat(r.d).filter((e) => e.title === 'Board');
    ok('and lands on a Tuesday every month',
      board.length === 4 && board.every((e) => new Date(e.startAt).getUTCDay() === 2),
      board.map((e) => e.startAt.slice(0, 10)).join(' '));

    // --- A one-off is untouched by any of this ----------------------------
    head('A one-off is still a one-off:');
    r = await make({ kind: 'meal', title: 'Dinner', startAt: `${MONDAY}T19:00:00Z` });
    ok('created', r.s === 201, String(r.s));
    ok('with no series', r.d.seriesId === null, String(r.d.seriesId));
    ok('and one occurrence', r.d.occurrences === 1, String(r.d.occurrences));
    ok('saying nothing about repeating', r.d.item.recurrenceLabel === null,
      String(r.d.item.recurrenceLabel));
    // A plain delete on a one-off still means what it always meant.
    r = await boss('DELETE', `/itinerary/${me.id}/items/${r.d.item.id}`);
    ok('and a plain removal takes it', r.s === 200 && r.d.removed === 1, JSON.stringify(r.d));

    // --- Refusals ---------------------------------------------------------
    head('What is refused:');
    r = await make({ kind: 'meeting', title: 'Bad', startAt: `${MONDAY}T09:00:00Z`, recurrence: { freq: 'hourly' } });
    ok('an unknown frequency', r.s === 400, String(r.s));
    r = await make({ kind: 'meeting', title: 'Bad', startAt: `${MONDAY}T09:00:00Z`, recurrence: { freq: 'daily', count: 5000 } });
    ok('a series longer than the cap', r.s === 400, String(r.s));
    r = await boss('DELETE', `/itinerary/${me.id}/items/${board[0].id}?scope=everything`);
    ok('and a scope nobody defined', r.s === 400, String(r.s));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA standing arrangement is real entries, and cancelling one is not cancelling all.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
