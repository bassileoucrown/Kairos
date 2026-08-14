const db = require('./db');

// The concierge, declared before it exists.
//
// This is deliberately built as a visible, honest placeholder rather than left
// out until the day it works, for the same reason calendar sync and WhatsApp
// are (lib/calendarSync.js, lib/whatsapp.js): a principal deciding whether
// Kairos is the place their life goes should be able to see the shape of what
// is coming, and should never be unable to tell the difference between a
// feature that works and one that does not.
//
// WHAT MAKES IT UNAVAILABLE IS NOT A CREDENTIAL.
//
// Calendar sync is gated on an OAuth client ID: somebody sets an environment
// variable and it goes live. This is not that, and pretending otherwise would
// be the dishonest part. A concierge is people — a vetted fulfilment network
// under contract, with agreed liability, who answer at 2am in the city the
// principal is actually in. There is no key that turns that on. So the gate
// here names a partner rather than a token, the screen says the blocker is
// commercial rather than technical, and nothing anywhere offers to "connect".
//
// WHY THERE IS NO REQUEST BOX.
//
// The obvious placeholder is a form that takes a request and shows a friendly
// message. That form would be a lie: somebody would eventually type "table for
// four at 8, my wife's birthday" into it, and nobody would be on the other
// end. The one thing this screen accepts is an expression of interest, which
// is a real thing that is really recorded, and it says in plain words that it
// reaches an inbox at Exousia and not a concierge.

/**
 * What a concierge desk is actually asked for.
 *
 * Named specifically rather than as "lifestyle management", because the list
 * is the product decision: it says what will be in scope, and a principal
 * reading it can tell at a glance whether it covers the things they currently
 * ring three different people about.
 */
const SERVICES = [
  {
    id: 'dining',
    label: 'Dining and venues',
    detail: 'Tables at short notice, private rooms, dietary and seating standing orders '
      + 'held once and applied every time.',
  },
  {
    id: 'travel_desk',
    label: 'Travel desk',
    detail: 'Flights, hotels and ground handling booked and re-cut when a meeting moves — '
      + 'the trip is already an object here, this is somebody to act on it.',
  },
  {
    id: 'aviation',
    label: 'Private aviation and charter',
    detail: 'Quotes, empty legs, handling agents and crew timings, against the same itinerary.',
  },
  {
    id: 'events',
    label: 'Events and access',
    detail: 'Tickets, boxes, invitations, and the seating and protocol that go with them.',
  },
  {
    id: 'gifting',
    label: 'Gifting and occasions',
    detail: 'Sourcing, wrapping and delivery, timed off the relationship calendar that '
      + 'already knows whose anniversary is on Thursday.',
  },
  {
    id: 'household',
    label: 'Household and staffing',
    detail: 'Vetted trades, temporary staff, and the follow-up that makes a repair actually '
      + 'happen rather than be reported.',
  },
  {
    id: 'medical',
    label: 'Medical and wellbeing',
    detail: 'Appointments, second opinions and travel-time cover. Held to the same custody '
      + 'rules as the vault, since it is the same class of information.',
  },
  {
    id: 'security',
    label: 'Security and logistics',
    detail: 'Close protection, secure transport, and advance work in an unfamiliar city.',
  },
];

function isService(id) {
  return SERVICES.some((s) => s.id === id);
}

/**
 * Whether a fulfilment partner is actually contracted for this deployment.
 *
 * Left as an environment variable so the switch exists and is testable, but
 * named for what it really is. Setting it on a deployment with no partner
 * behind it would put a promise on a principal's screen that nobody can keep.
 */
function isAvailable() {
  return Boolean(process.env.CONCIERGE_PARTNER);
}

const UNAVAILABLE_REASON =
  'The concierge desk is not open yet. What it needs is not a setting — it is a '
  + 'contracted network of vetted people who answer at 2am in the city you are '
  + 'actually in, and Exousia will not put that on your screen before it is real.';

/** What this principal has said they want, if anything. */
async function interestFor(ownerId) {
  const rows = await db.prepare(
    'SELECT * FROM concierge_interest WHERE owner_id = ? ORDER BY created_at ASC',
  ).all(ownerId);
  return rows.map((r) => ({
    id: r.id,
    service: r.service,
    note: r.note,
    createdAt: r.created_at,
  }));
}

module.exports = { SERVICES, isService, isAvailable, UNAVAILABLE_REASON, interestFor };
