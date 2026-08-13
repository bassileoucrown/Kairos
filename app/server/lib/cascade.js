const db = require('./db');

// What a delay actually does.
//
// A day is not a list of independent appointments, it is a chain: the 11:00
// only works because the 10:00 ends at 10:45 and the car takes twenty minutes.
// Until now moving one item moved one row — the 11:00 stayed exactly where it
// was, sitting on top of the meeting that had just overrun, the driver was
// still waiting at the old time, and nothing anywhere said so. The person the
// app is for would have found out by being late.
//
// So a delay is computed against the whole rest of the day and presented
// before it is applied. Two rules carry most of the weight:
//
//   A gap absorbs. If the next thing does not start until an hour later, a
//   twenty-minute overrun changes nothing and the cascade stops there. This is
//   what a good assistant does in their head, and a system that shunts the
//   entire afternoon regardless is worse than useless — it cries wolf.
//
//   An anchor does not move. A flight departs when it departs. If the day
//   would overrun one, that is a conflict to be told about in plain words,
//   never a time to quietly rewrite. The most expensive thing this can do is
//   let somebody believe a plane will wait.

const MS = 60000;

function iso(d) { return new Date(d).toISOString(); }
function mins(a, b) { return Math.round((new Date(a) - new Date(b)) / MS); }
function shift(at, minutes) { return iso(new Date(at).getTime() + minutes * MS); }

/**
 * Everything on the principal's schedule from this item onward, within the
 * window. Confirmed and proposed only: a draft is the assistant's working
 * copy and is not part of the real day yet.
 */
async function itemsFrom(ownerId, fromIso, windowHours = 36) {
  const until = iso(new Date(fromIso).getTime() + windowHours * 3600 * 1000);
  return db.prepare(`
    SELECT i.*, hm.name AS staff_name, hm.job_title AS staff_title,
           hm.member_user_id AS staff_user_id, hm.status AS staff_status,
           b.booker_name, b.booker_email
    FROM itinerary_items i
    LEFT JOIN household_members hm ON hm.id = i.household_member_id
    LEFT JOIN bookings b ON b.id = i.booking_id
    WHERE i.owner_id = ? AND i.status IN ('confirmed', 'proposed')
      AND i.start_at >= ? AND i.start_at <= ?
    ORDER BY i.start_at ASC
  `).all(ownerId, fromIso, until);
}

/** End of an item, treating one with no end as instantaneous. */
function endOf(item, startOverride) {
  const start = startOverride || item.start_at;
  if (!item.end_at) return start;
  const duration = mins(item.end_at, item.start_at);
  return shift(start, duration);
}

/**
 * Work out what a delay does, without doing it.
 *
 * Returns one entry per item after the delayed one, each saying plainly what
 * happens to it and why — because "three things moved" is not something an
 * assistant can act on, and "the 15:30 car would now leave at 16:15, which
 * misses the 17:40" is.
 */
async function planDelay({ ownerId, itemId, minutes }) {
  const target = await db.prepare('SELECT * FROM itinerary_items WHERE id = ? AND owner_id = ?')
    .get(itemId, ownerId);
  if (!target) return null;

  const delay = Math.round(Number(minutes) || 0);
  const rest = (await itemsFrom(ownerId, target.start_at))
    .filter((i) => i.id !== target.id);

  const newTargetStart = shift(target.start_at, delay);
  const newTargetEnd = endOf(target, newTargetStart);

  const effects = [];
  // Where the principal actually is once the delayed thing finishes. Each
  // following item is measured against this rather than against the original
  // delay, which is what makes a gap absorb.
  let cursor = newTargetEnd;
  let stillCascading = delay > 0;

  for (const item of rest) {
    const travel = Number(item.travel_minutes || 0);
    const earliest = shift(cursor, travel);
    const late = mins(earliest, item.start_at);

    if (!stillCascading || late <= 0) {
      // The gap swallowed it. Everything from here is untouched, and saying so
      // is worth as much as the warnings.
      effects.push({
        id: item.id, title: item.title, kind: item.kind,
        startAt: item.start_at, newStartAt: item.start_at,
        effect: 'unchanged',
        reason: stillCascading ? 'There is enough of a gap before this.' : null,
        isAnchor: !!item.is_anchor,
      });
      stillCascading = false;
      continue;
    }

    if (item.is_anchor) {
      // The one case where the answer is "no". Nothing after an anchor moves
      // either — the anchor pins the rest of the day back to its own clock.
      effects.push({
        id: item.id, title: item.title, kind: item.kind,
        startAt: item.start_at, newStartAt: item.start_at,
        effect: 'conflict',
        lateBy: late,
        reason: item.kind === 'flight' || item.kind === 'train'
          ? `You would reach this ${late} min after it leaves. It will not wait.`
          : `You would arrive ${late} min late, and this cannot be moved.`,
        isAnchor: true,
        staff: item.staff_user_id && item.staff_status === 'active'
          ? { name: item.staff_name, jobTitle: item.staff_title } : null,
      });
      stillCascading = false;
      continue;
    }

    const newStart = shift(item.start_at, late);
    effects.push({
      id: item.id, title: item.title, kind: item.kind,
      startAt: item.start_at, newStartAt: newStart,
      effect: 'shifted',
      movedBy: late,
      reason: travel > 0 ? `Allowing ${travel} min to get there.` : null,
      isAnchor: false,
      staff: item.staff_user_id && item.staff_status === 'active'
        ? { name: item.staff_name, jobTitle: item.staff_title } : null,
      // An external attendee cannot be moved by us writing a row. Flagged so
      // somebody sends the message; never sent automatically, because the
      // wording of "we are running late" is a judgement call.
      attendee: item.booker_email ? { name: item.booker_name, email: item.booker_email } : null,
    });
    cursor = endOf(item, newStart);
  }

  const shifted = effects.filter((e) => e.effect === 'shifted');
  const conflicts = effects.filter((e) => e.effect === 'conflict');

  return {
    item: {
      id: target.id, title: target.title, kind: target.kind,
      startAt: target.start_at, newStartAt: newTargetStart,
    },
    minutes: delay,
    effects,
    counts: {
      shifted: shifted.length,
      conflicts: conflicts.length,
      unchanged: effects.filter((e) => e.effect === 'unchanged').length,
    },
    // Deduplicated: one person told once, however many of their legs moved.
    peopleToTell: [
      ...new Map(shifted.filter((e) => e.staff)
        .map((e) => [e.staff.name, e.staff])).values(),
    ],
    attendeesToTell: [
      ...new Map(shifted.filter((e) => e.attendee)
        .map((e) => [e.attendee.email, e.attendee])).values(),
    ],
  };
}

module.exports = { planDelay, itemsFrom, endOf, shift, mins };
