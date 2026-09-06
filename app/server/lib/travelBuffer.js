const db = require('./db');
const travelTime = require('./travelTime');
const tripPrivacy = require('./tripPrivacy');
const places = require('./places');

// How much room the day actually needs between two things, asked of the road.
//
// `travel_minutes` has always been a number somebody typed once. This works
// out what it ought to be for a specific pair of items on a specific day, by
// asking the maps provider how long that drive takes AT THE HOUR IT HAPPENS,
// and comparing the answer to the gap the diary currently leaves.
//
// ARITHMETIC, NOT JUDGEMENT. There is no model in this file and there should
// not be one. A language model asked how long Ikoyi to Victoria Island takes on
// a Thursday evening would be guessing at something an API answers exactly, and
// guessing differently each time it was asked. The provider returns minutes;
// the margin is a stated policy; the shortfall is a subtraction. Every number
// this produces can be checked by hand, which is the property that makes it
// safe to put in front of somebody arranging a principal's day.
//
// NOTHING IS WRITTEN. This returns suggestions. Applying one is a separate,
// explicit act by a person — same rule the per-item estimate already follows,
// and for the same reason: an assistant often knows something the road does
// not, like a closed gate or a convoy, and a schedule that reshuffles itself
// while nobody is looking is a schedule nobody trusts.
//
// WHAT IS NEVER ASKED ABOUT. Two things, and neither is a preference:
//
//   - anything on a PRIVATE trip. A private trip is absent from the office
//     entirely (see tripPrivacy.js), and sending its destination to a maps
//     provider would hand a third party the one thing the whole feature exists
//     to withhold — where a private person actually goes.
//   - anything whose kind is `personal`. The owner's instruction, plainly:
//     personal trip lookups are off.
//
// Both are refused for EVERY viewer including the principal themselves. Not
// because the principal has no right to it, but because "off" that has an
// exception is a setting somebody has to reason about, and this one is worth
// more as a rule than as a default. A per-trip opt-in is a small change if it
// is ever wanted; it is deliberately not here.

const PERSONAL_KIND = 'personal';

/**
 * The cushion on top of the drive itself.
 *
 * Deliberately a quarter, floored at five minutes and capped at twenty. The
 * cap is the part worth explaining: a two-hour drive does not need thirty
 * minutes of slack on top, because the provider's own estimate already widens
 * with distance — proportional padding on a long leg is paying twice for the
 * same uncertainty. The floor exists because every leg has a walk to the car
 * and a wait at a gate, and no leg has ever taken exactly its drive time.
 *
 * This is a policy, not a measurement, and it is the one number here somebody
 * may reasonably want to argue with. It is a single function so that argument
 * happens in one place.
 */
function marginFor(driveMinutes) {
  return Math.max(5, Math.min(20, Math.round(driveMinutes * 0.25)));
}

/**
 * Where a leg leaves from: where it ends up, or failing that where it was.
 *
 * Returns the words AND the id for whichever end was used, because they must
 * travel together — asking the road about the id while showing the person the
 * other end's words is exactly the mix-up this is meant to prevent.
 */
function originOf(item) {
  const dest = String(item.destination || '').trim();
  if (dest) return { text: dest, placeId: item.destination_place_id || null };
  return { text: String(item.location || '').trim(), placeId: item.location_place_id || null };
}

function endOf(item) {
  return Date.parse(item.end_at || item.start_at);
}

/**
 * Every adjacent pair on this account between `from` and `to`, with what the
 * road says about the gap between them.
 *
 * Returns `{ configured, provider, pairs }`. Each pair is either measured, or
 * carries a `skipped` reason — never silently dropped. A gap that vanished
 * from the list because an address was blank looks exactly like a gap that is
 * fine, and those are opposite facts.
 */
async function suggest({ ownerId, viewerId, from, to, fresh = false }) {
  const configured = travelTime.isConfigured();

  const items = await db.prepare(`
    SELECT id, kind, title, start_at, end_at, location, destination, travel_minutes, trip_id, status,
           location_place_id, destination_place_id
    FROM itinerary_items
    WHERE owner_id = ? AND status = 'confirmed' AND start_at >= ? AND start_at <= ?
    ORDER BY start_at ASC
  `).all(ownerId, from, to);

  // The same gate every other read path uses, rather than a second query that
  // answers the same question slightly differently.
  const hidden = await tripPrivacy.hiddenTripIds(ownerId, viewerId);

  // A private trip's legs are not merely unmeasured, they are not here at all:
  // a viewer who cannot see the trip must not learn its shape from a list of
  // gaps that skips over it. Refused-for-privacy is reported only for legs the
  // viewer can already see.
  const visible = items.filter((i) => !(i.trip_id && hidden.has(i.trip_id)));

  const privateTrips = new Set(
    (await db.prepare('SELECT id FROM trips WHERE owner_id = ? AND visibility = ?')
      .all(ownerId, tripPrivacy.PRIVATE)).map((t) => t.id),
  );

  const pairs = [];
  for (let i = 0; i < visible.length - 1; i += 1) {
    const a = visible[i];
    const b = visible[i + 1];
    const leaves = endOf(a);
    const arrives = Date.parse(b.start_at);
    if (!Number.isFinite(leaves) || !Number.isFinite(arrives)) continue;

    const base = {
      afterId: a.id,
      afterTitle: a.title,
      beforeId: b.id,
      beforeTitle: b.title,
      gapMinutes: Math.round((arrives - leaves) / 60000),
      currentTravelMinutes: Number(b.travel_minutes || 0),
    };

    const isPersonal = a.kind === PERSONAL_KIND || b.kind === PERSONAL_KIND;
    const onPrivateTrip = privateTrips.has(a.trip_id) || privateTrips.has(b.trip_id);
    if (isPersonal || onPrivateTrip) {
      pairs.push({
        ...base,
        skipped: 'private',
        why: onPrivateTrip
          ? 'This leg is on a private trip, so its route is never sent to the maps provider.'
          : 'This is personal time, so its route is never sent to the maps provider.',
      });
      continue;
    }

    const origin = originOf(a);
    const dest = { text: String(b.location || '').trim(), placeId: b.location_place_id || null };
    if (!origin.text || !dest.text) {
      pairs.push({
        ...base,
        skipped: 'no-place',
        why: !origin.text
          ? `“${a.title}” has no location to leave from.`
          : `“${b.title}” has no location to travel to.`,
      });
      continue;
    }
    if (!configured) {
      pairs.push({ ...base, skipped: 'unconfigured', why: 'Travel time is not configured on this deployment.' });
      continue;
    }

    // Asked for the moment of departure, not for "now" and not for a typical
    // Thursday. That instant is the whole feature.
    // `place_id:…` when the place was picked from the map, the typed words
    // when it was not. Same call either way; the first is simply unambiguous.
    const road = await travelTime.estimate({
      from: places.asQuery(origin.text, origin.placeId),
      to: places.asQuery(dest.text, dest.placeId),
      departAt: leaves,
      fresh,
    });
    if (road.error) {
      pairs.push({ ...base, skipped: 'error', why: road.error });
      continue;
    }

    const margin = marginFor(road.minutes);
    const needed = road.minutes + margin;
    pairs.push({
      ...base,
      // The words, always — a screen shows a person what they wrote.
      from: origin.text,
      to: dest.text,
      // Whether the road was asked about an exact place or about a phrase.
      // The difference is the whole reason the id is stored, so it is said
      // rather than left for somebody to assume.
      exact: !!(origin.placeId && dest.placeId),
      departAt: new Date(leaves).toISOString(),
      driveMinutes: road.minutes,
      marginMinutes: margin,
      suggestedMinutes: needed,
      // Positive means the diary does not leave enough room. This is the one
      // number an assistant is actually looking for.
      shortfallMinutes: needed - base.gapMinutes,
      tight: needed > base.gapMinutes,
      withTraffic: !!road.traffic,
      distanceKm: road.distanceKm ?? null,
      // When the road was asked, so a screen can say so rather than implying
      // that a number sitting on it is current.
      readAt: road.readAt || null,
      ageSeconds: road.ageSeconds ?? null,
      cached: !!road.cached,
    });
  }

  return { configured, provider: travelTime.label(), pairs };
}

module.exports = { suggest, marginFor, PERSONAL_KIND };
