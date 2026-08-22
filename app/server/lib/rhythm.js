// When this principal is actually at their best, read from what they have
// already done rather than from what anybody says about themselves.
//
// WHAT THIS IS NOT. There is no model here and no call to one. It counts what
// is in the diary and reports the counts in sentences. That is a deliberate
// choice, not a shortcut: a suggestion about somebody's working day has to be
// something they can check against their own memory, and "you have taken
// eleven of your fourteen board meetings before noon" is checkable in a way
// that "our model suggests mornings" is not. If a model is added later it
// should produce this same shape and be held to the same standard.
//
// WHAT IT READS. Three signals, in descending order of how much they are
// worth:
//
//   WHERE A KIND OF THING LANDS. The hours a principal puts meetings in are
//   the hours they have chosen, over and over, with the full context of a
//   life this code cannot see. That choice is the strongest evidence there is.
//
//   WHAT GETS MOVED. booking_events records every reschedule with the hour it
//   moved from. An hour that meetings keep leaving is an hour that does not
//   hold, whatever the diary says about it. This is the signal that could not
//   exist before that table did.
//
//   WHAT GETS CALLED OFF. Cancelled and declined, by hour. Weaker — a
//   cancellation is often about the other person — so it is reported only
//   alongside the others and never on its own.
//
// AND WHEN IT SAYS NOTHING. Below a floor of history the honest answer is that
// there is not enough yet, and that is what it returns. A pattern drawn from
// four meetings is a coincidence with a chart.

const db = require('./db');

// Under this many items, any shape in the data is noise. Chosen so that a
// principal in their first fortnight is told to come back rather than being
// handed a confident sentence about themselves.
const ENOUGH = 12;
// How far back to look. Beyond a season, a working pattern is somebody else's.
const LOOKBACK_DAYS = 120;

const PARTS = [
  { id: 'early', label: 'first thing', from: 5, to: 9 },
  { id: 'morning', label: 'the morning', from: 9, to: 12 },
  { id: 'midday', label: 'the middle of the day', from: 12, to: 14 },
  { id: 'afternoon', label: 'the afternoon', from: 14, to: 17 },
  { id: 'evening', label: 'the evening', from: 17, to: 22 },
  { id: 'night', label: 'late', from: 22, to: 29 },
];

// The kinds worth reporting separately. Anything else is counted but not
// named, because "you do 'note' things at 3pm" is not advice.
const KIND_LABELS = {
  meeting: 'meetings',
  call: 'calls',
  meal: 'meals and dinners',
  flight: 'flights',
  car: 'cars and transfers',
  personal: 'personal time',
};

function partOf(hour) {
  return PARTS.find((p) => hour >= p.from && hour < p.to) || PARTS[PARTS.length - 1];
}

/** The hour of an instant, in the principal's own day rather than the server's. */
function hourInZone(iso, timeZone) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', hour12: false,
  }).format(new Date(iso)));
}

function pct(n, of) {
  return of === 0 ? 0 : Math.round((n / of) * 100);
}

/**
 * What the diary says about how this person works.
 *
 * Returns { enough, sampleSize, parts, findings } — findings being sentences
 * ready to show, each with the count behind it so nobody has to take it on
 * trust.
 */
async function read(ownerId) {
  const owner = await db.prepare('SELECT timezone FROM users WHERE id = ?').get(ownerId);
  const tz = owner?.timezone || 'UTC';
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const now = new Date().toISOString();

  // Only what has already happened. A diary full of next month's intentions
  // says what somebody plans, not what they do.
  const items = await db.prepare(`
    SELECT kind, start_at FROM itinerary_items
    WHERE owner_id = ? AND status = 'confirmed' AND start_at >= ? AND start_at < ?
  `).all(ownerId, since, now);

  const bookings = await db.prepare(`
    SELECT mt.name AS kind_name, b.start_at, b.status
    FROM bookings b JOIN meeting_types mt ON mt.id = b.meeting_type_id
    WHERE b.owner_id = ? AND b.start_at >= ? AND b.start_at < ?
  `).all(ownerId, since, now);

  const moved = await db.prepare(`
    SELECT from_value FROM booking_events
    WHERE owner_id = ? AND kind = 'rescheduled' AND at >= ? AND from_value IS NOT NULL
  `).all(ownerId, since);

  // ---- Count ------------------------------------------------------------
  const byPart = new Map(PARTS.map((p) => [p.id, { ...p, total: 0, kinds: new Map(), left: 0, off: 0 }]));
  const bump = (iso, kind) => {
    const slot = byPart.get(partOf(hourInZone(iso, tz)).id);
    if (!slot) return;
    slot.total += 1;
    if (kind) slot.kinds.set(kind, (slot.kinds.get(kind) || 0) + 1);
  };

  for (const it of items) bump(it.start_at, it.kind);
  for (const b of bookings) {
    bump(b.start_at, 'meeting');
    if (b.status === 'cancelled' || b.status === 'declined') {
      const slot = byPart.get(partOf(hourInZone(b.start_at, tz)).id);
      if (slot) slot.off += 1;
    }
  }
  for (const m of moved) {
    const slot = byPart.get(partOf(hourInZone(m.from_value, tz)).id);
    if (slot) slot.left += 1;
  }

  const sampleSize = items.length + bookings.length;
  const parts = PARTS.map((p) => {
    const s = byPart.get(p.id);
    const kinds = [...s.kinds.entries()]
      .filter(([k]) => KIND_LABELS[k])
      .sort((a, b) => b[1] - a[1]);
    return {
      id: p.id,
      label: p.label,
      from: p.from,
      count: s.total,
      share: pct(s.total, sampleSize),
      movedAway: s.left,
      calledOff: s.off,
      topKind: kinds[0] ? { kind: kinds[0][0], label: KIND_LABELS[kinds[0][0]], count: kinds[0][1] } : null,
    };
  });

  if (sampleSize < ENOUGH) {
    return {
      enough: false,
      sampleSize,
      needed: ENOUGH,
      parts,
      findings: [],
    };
  }

  // ---- Say it -------------------------------------------------------------
  const findings = [];
  const busiest = [...parts].sort((a, b) => b.count - a.count)[0];
  if (busiest && busiest.count > 0) {
    findings.push({
      id: 'busiest',
      weight: 'strong',
      text: `Most of your day happens in ${busiest.label} — ${busiest.share}% of everything in the last four months.`,
      evidence: `${busiest.count} of ${sampleSize}`,
    });
  }

  // Where each kind of thing actually lands, which is the useful half: it is
  // advice about *what* to put *where*, not just when you are busy.
  for (const kind of Object.keys(KIND_LABELS)) {
    const ranked = parts
      .map((p) => ({ p, n: byPart.get(p.id).kinds.get(kind) || 0 }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
    const total = ranked.reduce((sum, x) => sum + x.n, 0);
    if (total < 4 || !ranked[0]) continue;
    const top = ranked[0];
    // Only worth saying if it is actually concentrated. A kind spread evenly
    // across the day is a kind with nothing to report.
    if (pct(top.n, total) < 45) continue;
    findings.push({
      id: `kind-${kind}`,
      weight: 'strong',
      text: `You take ${KIND_LABELS[kind]} in ${top.p.label} more than anywhere else.`,
      evidence: `${top.n} of ${total}`,
    });
  }

  // The hour that does not hold. This is the finding the booking_events table
  // was built to make possible.
  const leaky = [...parts].filter((p) => p.movedAway >= 2)
    .sort((a, b) => b.movedAway - a.movedAway)[0];
  if (leaky) {
    findings.push({
      id: 'moved',
      weight: 'strong',
      text: `Meetings in ${leaky.label} get moved more than any others. It may be worth holding that time back.`,
      evidence: `${leaky.movedAway} moved`,
    });
  }

  const dropped = [...parts].filter((p) => p.calledOff >= 2 && p.count >= 4)
    .sort((a, b) => pct(b.calledOff, b.count) - pct(a.calledOff, a.count))[0];
  if (dropped) {
    findings.push({
      id: 'off',
      weight: 'weak',
      text: `A larger share of what is booked for ${dropped.label} ends up cancelled — often the other side, but worth watching.`,
      evidence: `${dropped.calledOff} of ${dropped.count}`,
    });
  }

  const empty = parts.filter((p) => p.count === 0 && p.id !== 'night' && p.id !== 'early');
  if (empty.length === 1) {
    findings.push({
      id: 'empty',
      weight: 'weak',
      text: `Nothing at all has been in ${empty[0].label} for four months. If that is deliberate, it is worth closing on your availability so nobody asks.`,
      evidence: 'no items',
    });
  }

  return { enough: true, sampleSize, needed: ENOUGH, parts, findings };
}

module.exports = { read, PARTS, KIND_LABELS, ENOUGH, LOOKBACK_DAYS };
