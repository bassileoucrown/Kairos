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
  const items = await db.prepare(`
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

  // APPOINTMENTS SOMEBODY BOOKED COUNT AS PART OF THE DAY.
  //
  // This read itinerary_items alone, which made the delay cascade blind to
  // exactly the commitments a principal is least able to be late for. Somebody
  // pressed "running 30 minutes late" on the morning and was told the day
  // absorbed it — while the 4pm with the chairman, which is a booking and not
  // an itinerary item, sat in the gap the cascade had just decided was empty.
  // A cascade that cannot see half the day is worse than no cascade, because
  // it is believed.
  //
  // AND THEY ARE ANCHORS. A booking is somebody else's time: moving it emails
  // them and changes a commitment they made. So the cascade reports running
  // into one as a conflict and stops there, rather than shunting it quietly —
  // which is also what an assistant would say out loud. Moving it stays the
  // deliberate act it already is, on the appointment or from the day sheet.
  const mirrored = new Set(items.map((i) => i.booking_id).filter(Boolean));
  const bookings = await db.prepare(`
    SELECT * FROM bookings
     WHERE owner_id = ? AND status = 'confirmed'
       AND start_at >= ? AND start_at <= ?
     ORDER BY start_at ASC
  `).all(ownerId, fromIso, until);

  const asItems = bookings
    // One that has been copied onto the itinerary is already in the list
    // above, and counting it twice would have the day collide with itself.
    .filter((b) => !mirrored.has(b.id))
    .map((b) => ({
      id: b.id,
      source: 'booking',
      kind: 'meeting',
      title: `${b.booker_name}`,
      start_at: b.start_at,
      end_at: b.end_at,
      is_anchor: 1,
      travel_minutes: 0,
      booker_name: b.booker_name,
      booker_email: b.booker_email,
    }));

  return [...items.map((i) => ({ ...i, source: 'item' })), ...asItems]
    .sort((a, b) => (a.start_at < b.start_at ? -1 : a.start_at > b.start_at ? 1 : 0));
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
async function planDelay({ ownerId, itemId, bookingId, minutes }) {
  // The thing running late is either an entry this office put on the day or an
  // appointment somebody booked. Both are things a principal is physically at
  // and can therefore overrun; only the second one has a person on the other
  // end of it who has to be told.
  let target;
  if (bookingId) {
    const b = await db.prepare(
      "SELECT * FROM bookings WHERE id = ? AND owner_id = ? AND status = 'confirmed'",
    ).get(bookingId, ownerId);
    if (!b) return null;
    target = {
      id: b.id, source: 'booking', kind: 'meeting', title: b.booker_name,
      start_at: b.start_at, end_at: b.end_at,
      booker_name: b.booker_name, booker_email: b.booker_email,
    };
  } else {
    const row = await db.prepare('SELECT * FROM itinerary_items WHERE id = ? AND owner_id = ?')
      .get(itemId, ownerId);
    if (!row) return null;
    target = { ...row, source: 'item' };
  }

  const delay = Math.round(Number(minutes) || 0);
  const rest = (await itemsFrom(ownerId, target.start_at))
    // Matched on source as well as id, because an itinerary item and a booking
    // could in principle share neither namespace nor uniqueness guarantee.
    .filter((i) => !(i.id === target.id && (i.source || 'item') === target.source));

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
        source: item.source || 'item',
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
        source: item.source || 'item',
        startAt: item.start_at, newStartAt: item.start_at,
        effect: 'conflict',
        lateBy: late,
        // A booking says who has to be asked. "This cannot be moved" is true
        // of a plane and misleading of an appointment: the appointment CAN be
        // moved, by a person, after asking — and the useful thing to hand back
        // is the name of whoever would have to agree.
        reason: item.source === 'booking'
          ? `You would arrive ${late} min late. Moving this means telling ${item.booker_name}.`
          : item.kind === 'flight' || item.kind === 'train'
            ? `You would reach this ${late} min after it leaves. It will not wait.`
            : `You would arrive ${late} min late, and this cannot be moved.`,
        isAnchor: true,
        staff: item.staff_user_id && item.staff_status === 'active'
          ? { name: item.staff_name, jobTitle: item.staff_title } : null,
        attendee: item.booker_email ? { name: item.booker_name, email: item.booker_email } : null,
      });
      stillCascading = false;
      continue;
    }

    const newStart = shift(item.start_at, late);
    effects.push({
      id: item.id, title: item.title, kind: item.kind,
      // Always 'item' here: a booking is an anchor and never reaches this
      // branch. Carried anyway so the apply step never has to assume.
      source: item.source || 'item',
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
      source: target.source,
      startAt: target.start_at, newStartAt: newTargetStart,
      newEndAt: newTargetEnd,
      // Whoever has to be told that the thing itself moved. Only a booking has
      // one, and it is the difference between a row changing and a person
      // being sent a message.
      attendee: target.booker_email
        ? { name: target.booker_name, email: target.booker_email } : null,
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
