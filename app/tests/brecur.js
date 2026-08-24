// Something that happens again, and lands on the right day when it does.
//
// Pure calendar logic, so this suite needs no server — which is the point.
// The failures worth catching here are arithmetic that looks right in the
// month you happen to test in: a meeting that drifts an hour when the clocks
// change, a "last Friday" that turns into a "fourth Friday" in the two months
// out of three where they coincide.
//
// Every date below is checked against a real calendar rather than against
// whatever the code returned.
const ROOT = require('path').join(__dirname, '..', '..');
const r = require(`${ROOT}/app/server/lib/recurrence`);
const { utcToZonedParts } = require(`${ROOT}/app/server/lib/timezone`);

let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (t) => console.log(`\n${t}`);

const days = (o) => o.map((x) => x.startAt.slice(0, 10)).join(' ');
const localTimes = (o, tz) => o.map((x) => {
  const p = utcToZonedParts(new Date(x.startAt), tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}).join(' ');

// --- The clocks changing -------------------------------------------------
head('A weekly meeting through a daylight-saving change:');
{
  // British Summer Time began on 29 March 2026.
  const o = r.expand({
    startAt: '2026-03-25T09:00:00Z',
    endAt: '2026-03-25T10:00:00Z',
    timeZone: 'Europe/London',
    freq: 'weekly',
    count: 3,
  });
  ok('stays at nine o\'clock for the people attending it',
    localTimes(o, 'Europe/London') === '09:00 09:00 09:00', localTimes(o, 'Europe/London'));
  // The instant has to move even though the wall clock does not — that is the
  // whole difference from adding 168 hours.
  ok('and the UTC instant shifts by the hour the clocks did',
    o[1].startAt === '2026-04-01T08:00:00.000Z', o[1].startAt);
  ok('an hour long is still an hour long',
    new Date(o[1].endAt) - new Date(o[1].startAt) === 3600000);
}

// --- Dates that do not exist ---------------------------------------------
head('A monthly on the 31st:');
{
  const o = r.expand({ startAt: '2026-01-31T12:00:00Z', timeZone: 'UTC', freq: 'monthly', count: 5 });
  // Skipped, never nudged onto the 30th or the 1st. February, April and June
  // simply do not have one.
  ok('lands only on real 31sts',
    days(o) === '2026-01-31 2026-03-31 2026-05-31 2026-07-31 2026-08-31', days(o));
  ok('and asking for five gets five, not five months', o.length === 5, String(o.length));
}

head('A yearly on the 29th of February:');
{
  const o = r.expand({ startAt: '2024-02-29T12:00:00Z', timeZone: 'UTC', freq: 'yearly', count: 3 });
  ok('is a leap-year series, not a 28th of February one',
    o.every((x) => x.startAt.slice(5, 10) === '02-29'), days(o));
}

// --- The two monthlies ---------------------------------------------------
//
// The distinction this suite exists for. May 2026 has five Fridays, so the
// fourth (22nd) and the last (29th) are different days, and a board that meets
// on one does not meet on the other.
head('"The fourth Friday" and "the last Friday" are not the same rule:');
{
  const fourth = r.expand({ startAt: '2026-03-27T09:00:00Z', timeZone: 'UTC', freq: 'monthly-weekday', count: 5 });
  const last = r.expand({ startAt: '2026-03-27T09:00:00Z', timeZone: 'UTC', freq: 'monthly-last-weekday', count: 5 });
  ok('the fourth Friday holds its position',
    days(fourth) === '2026-03-27 2026-04-24 2026-05-22 2026-06-26 2026-07-24', days(fourth));
  ok('the last Friday holds its position',
    days(last) === '2026-03-27 2026-04-24 2026-05-29 2026-06-26 2026-07-31', days(last));
  ok('and they disagree in the months with five Fridays',
    fourth[2].startAt !== last[2].startAt && fourth[4].startAt !== last[4].startAt);
  ok('each says which it is, in words', r.label('monthly-weekday', { year: 2026, month: 3, day: 27 })
    === 'The fourth Friday of every month');
  ok('so nobody has to guess from the date', r.label('monthly-last-weekday', { year: 2026, month: 3, day: 27 })
    === 'The last Friday of every month');
}

head('"The first Monday of the month":');
{
  const o = r.expand({ startAt: '2026-03-02T09:00:00Z', timeZone: 'UTC', freq: 'monthly-weekday', count: 4 });
  ok('is a Monday every time', o.every((x) => new Date(x.startAt).getUTCDay() === 1), days(o));
  ok('and the first one', days(o) === '2026-03-02 2026-04-06 2026-05-04 2026-06-01', days(o));
}

head('Same date versus same weekday:');
{
  const byDate = r.expand({ startAt: '2026-03-10T09:00:00Z', timeZone: 'UTC', freq: 'monthly', count: 3 });
  const byDay = r.expand({ startAt: '2026-03-10T09:00:00Z', timeZone: 'UTC', freq: 'monthly-weekday', count: 3 });
  ok('the 10th stays the 10th and wanders across the week',
    days(byDate) === '2026-03-10 2026-04-10 2026-05-10', days(byDate));
  ok('the second Tuesday stays a Tuesday and moves date',
    byDay.every((x) => new Date(x.startAt).getUTCDay() === 2), days(byDay));
}

// --- Every weekday --------------------------------------------------------
head('Every weekday:');
{
  const o = r.expand({ startAt: '2026-03-14T09:00:00Z', timeZone: 'UTC', freq: 'weekdays', count: 6 });
  ok('opens on the Monday when it was set up on a Saturday',
    o[0].startAt.slice(0, 10) === '2026-03-16', o[0].startAt);
  // The bug this catches: normalising the weekend away AFTER stepping made the
  // first two occurrences the same Monday.
  ok('does not sit on the same day twice', new Set(days(o).split(' ')).size === 6, days(o));
  ok('touches no weekend',
    o.every((x) => ![0, 6].includes(new Date(x.startAt).getUTCDay())), days(o));
  ok('and steps over the weekend rather than through it',
    days(o) === '2026-03-16 2026-03-17 2026-03-18 2026-03-19 2026-03-20 2026-03-23', days(o));
}

head('Every day, for contrast:');
{
  const o = r.expand({ startAt: '2026-03-14T09:00:00Z', timeZone: 'UTC', freq: 'daily', count: 4 });
  ok('includes the weekend, because that is what daily means',
    days(o) === '2026-03-14 2026-03-15 2026-03-16 2026-03-17', days(o));
}

// --- Bounds ---------------------------------------------------------------
head('A series knows when to stop:');
{
  const until = r.expand({
    startAt: '2026-03-02T09:00:00Z', timeZone: 'UTC', freq: 'weekly', until: '2026-03-24T00:00:00Z',
  });
  ok('an end date is respected', days(until) === '2026-03-02 2026-03-09 2026-03-16 2026-03-23', days(until));

  const open = r.expand({ startAt: '2026-03-02T09:00:00Z', timeZone: 'UTC', freq: 'weekly' });
  ok('and one with no end still stops at the horizon',
    open.length > 40 && open.length <= r.MAX_OCCURRENCES, String(open.length));

  ok('too many is refused', !!r.problem({ freq: 'daily', count: r.MAX_OCCURRENCES + 1 }));
  ok('repeating once is refused, because that is not repeating',
    !!r.problem({ freq: 'daily', count: 1 }));
  ok('an unknown frequency is refused', !!r.problem({ freq: 'hourly' }));
  ok('and a good one is accepted', r.problem({ freq: 'monthly-weekday', count: 12 }) === null);
}

console.log(fails === 0
  ? '\nA repeat lands on the day it should, whatever the clocks and the calendar do.'
  : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
