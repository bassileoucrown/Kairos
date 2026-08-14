const crypto = require('crypto');
const db = require('./db');

// Meeting a car without a name board.
//
// The ordinary way an executive is met at an airport is a stranger holding a
// placard with their name on it. That board publishes, to everyone standing in
// an arrivals hall, that this named person has just landed and is about to get
// into a car. For a principal in this market that is not an indignity, it is a
// targeting notice — and the people who read placards for a living are exactly
// the audience it is worst to have.
//
// So neither side displays anything. Both hold the same short phrase, agreed
// in advance:
//
//   The principal knows the car, the plate and the phrase.
//   The driver knows the flight, the meeting point and the phrase.
//   Whoever speaks first, the other answers, and nobody's name is said aloud.
//
// Three properties make this better than a placard rather than merely quieter.
//
// It is per-pickup. A phrase that stayed the same across trips would end up
// known by every driver a household has ever used, which is a standing
// credential with a rotation problem — the same mistake the pairing codes were
// redesigned to avoid.
//
// The driver's card carries no identity. A driver needs the flight, the time,
// where to stand and the phrase. They do not need the principal's name, and a
// link that leaks it would put the placard back on the internet, where it can
// be forwarded. The passenger appears as a first name at most, and only if the
// assistant chooses.
//
// The card expires. It is a link with no password on it, sent to somebody's
// phone over a channel Kairos does not control, and a link that works forever
// is a link that leaks eventually.

// Words that survive a bad phone line, an accent unfamiliar to the listener,
// and being read out in a noisy hall. No homophones, nothing that sounds like
// a number, nothing that could be misheard as an instruction.
const WORDS = [
  'ANCHOR', 'BRIDGE', 'CANDLE', 'DELTA', 'EMBER', 'FALCON', 'GARNET', 'HARBOUR',
  'INDIGO', 'JASMINE', 'KESTREL', 'LANTERN', 'MERIDIAN', 'NUTMEG', 'ORCHID',
  'PELICAN', 'QUARTZ', 'RIVER', 'SAFFRON', 'TEMPO', 'UMBER', 'VERDANT',
  'WILLOW', 'YONDER', 'ZENITH', 'COBALT', 'DRIFTWOOD', 'EVEREST',
];

/** Two words. Long enough not to be guessed in a hall, short enough to say. */
function generateCode() {
  const pick = () => WORDS[crypto.randomInt(0, WORDS.length)];
  let a = pick();
  let b = pick();
  while (b === a) b = pick();
  return `${a} ${b}`;
}

/** The card's address. Long and random: it is the only thing protecting it. */
function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

// How long after the pickup the card keeps working. Long enough for a delayed
// flight and a driver who reopens the link in the car park; short enough that a
// forwarded message is worthless by the time it travels.
const CARD_TTL_MS = Number(process.env.PICKUP_CARD_TTL_MS || 24 * 60 * 60 * 1000);

function isLive(item, now = Date.now()) {
  if (!item?.pickup_token) return false;
  const start = Date.parse(item.start_at);
  if (Number.isNaN(start)) return false;
  return now < start + CARD_TTL_MS;
}

/**
 * What the driver sees. Deliberately the smallest set of facts that lets
 * somebody stand in the right place at the right time and know who to greet.
 *
 * Not here, and not by omission: the principal's surname, their phone number,
 * their onward address, anything from the vault, or the identity of anyone
 * else travelling. A card that leaks is then worth nothing to whoever finds it.
 */
function driverCard(item, { flight, principalFirstName, assistantPhone } = {}) {
  return {
    meetingPoint: item.location || '',
    pickupCode: item.pickup_code,
    at: item.start_at,
    timezone: item.start_timezone || null,
    // The flight is the driver's actual instrument: it tells them when to
    // leave, and it is public information printed on every departure board.
    flightNumber: flight?.title || '',
    arrivingFrom: flight?.location || '',
    terminal: flight?.terminal || item.terminal || '',
    // A first name is enough to say hello with and useless to anybody else.
    passenger: principalFirstName || '',
    callIfDelayed: assistantPhone || '',
    vehicle: [item.provider, item.notes].filter(Boolean).join(' — '),
  };
}

/**
 * Arms a pickup: a fresh phrase and a fresh card address.
 *
 * Any earlier "found" is cleared with them. Re-arming means the driver
 * changed or the last link was forwarded, and carrying a handshake across
 * that boundary would tell a new driver he had already been recognised.
 */
async function arm(itemId) {
  const code = generateCode();
  const token = generateToken();
  await db.prepare(`
    UPDATE itinerary_items SET pickup_code = ?, pickup_token = ?, pickup_found_at = NULL
    WHERE id = ?
  `).run(code, token, itemId);
  return { code, token };
}

/** Takes the card down early — the driver changed, or the trip did. */
async function disarm(itemId) {
  await db.prepare(`
    UPDATE itinerary_items SET pickup_code = '', pickup_token = NULL, pickup_found_at = NULL
    WHERE id = ?
  `).run(itemId);
}

/** Resolves a card address, or null. Nothing distinguishes wrong from expired. */
async function byToken(token) {
  if (!token || String(token).length < 32) return null;
  const item = await db.prepare('SELECT * FROM itinerary_items WHERE pickup_token = ?').get(String(token));
  if (!item) return null;
  if (!isLive(item)) return null;
  return item;
}

module.exports = {
  WORDS, CARD_TTL_MS, generateCode, generateToken, driverCard, arm, disarm, byToken, isLive,
};
