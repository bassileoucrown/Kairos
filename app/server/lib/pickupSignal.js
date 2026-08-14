const crypto = require('crypto');
const db = require('./db');

// Finding the driver, rather than being found by him.
//
// lib/pickup.js solved half of an arrivals hall: the driver knows who to greet
// without a placard publishing the principal's name. The other half was left
// open, and it is the half the principal actually experiences — they walk out
// of customs into forty strangers holding forty boards, and they have nothing
// to look for. The phrase only works once two people are already facing each
// other. Somebody still has to close the distance, and until now that somebody
// was the principal, guessing.
//
// So both screens show the same thing at the same second. The driver holds his
// phone up, screen outward. The principal is looking for orange with a
// triangle on it, not for their own name in a stranger's hands. It is a name
// board with the name taken out — which is the only part of a name board that
// was ever a problem.
//
// Four properties make this worth building rather than just telling the driver
// to wear a red tie.
//
// IT SAYS NOTHING TO THE ROOM. A coloured square with a shape on it identifies
// nobody. The people who read placards for a living learn that somebody is
// meeting somebody, which they could already see.
//
// IT ROTATES. A photograph of the driver's screen is worthless a minute later,
// so a forwarded card cannot be used to hold up a matching panel. This is the
// same reasoning as the authenticator code, applied to a picture.
//
// IT IS SAYABLE. Two plain words — "orange, triangle". That matters more than
// it looks: on the phone, before either can see the other, the principal can
// ask what the driver is showing and get an answer that cannot be guessed from
// outside. The palette is deliberately small and plainly named for this, and
// not enlarged for entropy it does not need.
//
// IT CLOSES. The principal taps once and the driver's screen changes in his
// hands, so he knows he has been seen and stays where he is. Nobody crosses a
// hall twice, and nobody says a name out loud in public.
//
// What this is NOT: a tracker. Nothing here reports where anybody is. A live
// position for a principal is the most dangerous row this database could hold,
// and this feature does its whole job without one.

// One minute. Long enough to glance down, look up, and scan a hall without the
// answer changing underneath; short enough that a screenshot ages out before
// it can be forwarded and acted on.
const WINDOW_MS = Number(process.env.PICKUP_SIGNAL_WINDOW_MS || 60 * 1000);

// Plain names, said the same way in Lagos, London and Dubai over a bad line.
// Not the register of the phrase list — that one is chosen to survive being
// spelled out, this one is chosen to survive being shouted.
const COLOURS = [
  { id: 'orange', name: 'Orange', hex: '#F08A24', ink: '#1B1206' },
  { id: 'red', name: 'Red', hex: '#D33A34', ink: '#FFFFFF' },
  { id: 'blue', name: 'Blue', hex: '#2563C9', ink: '#FFFFFF' },
  { id: 'green', name: 'Green', hex: '#1E9E63', ink: '#FFFFFF' },
  { id: 'purple', name: 'Purple', hex: '#7145CC', ink: '#FFFFFF' },
  { id: 'pink', name: 'Pink', hex: '#D6459B', ink: '#FFFFFF' },
  { id: 'teal', name: 'Teal', hex: '#0E93A8', ink: '#FFFFFF' },
  { id: 'yellow', name: 'Yellow', hex: '#E9C227', ink: '#1B1206' },
];

// The second channel, and the reason colour alone is not the signal. A
// colour-blind principal, a phone on minimum brightness, a hall lit orange by
// sodium lamps — in all three the shape still reads, and in the last one so
// does the fact that there are two things to match rather than one.
const SHAPES = [
  { id: 'circle', name: 'Circle' },
  { id: 'square', name: 'Square' },
  { id: 'triangle', name: 'Triangle' },
  { id: 'diamond', name: 'Diamond' },
  { id: 'cross', name: 'Cross' },
  { id: 'star', name: 'Star' },
];

// Forty-eight combinations, which is not a lot, and does not need to be.
//
// The signal narrows a crowd; the phrase is what proves it. If two Kairos
// pickups ever stood in the same hall showing the same colour and shape, the
// two parties would walk up, exchange a phrase, get the wrong answer and move
// on — no worse than approaching the wrong board. Trading that for a palette
// nobody could name out loud would cost the property that makes this work on
// the phone.

/**
 * The signal for a card at a moment.
 *
 * Derived from the card's own address, so it cannot be computed by anyone who
 * does not already hold the card — and computed on the server for both sides,
 * so the two screens agree without either phone's clock being trusted.
 */
function signalAt(token, at = Date.now()) {
  const window = Math.floor(at / WINDOW_MS);
  const mac = crypto.createHmac('sha256', String(token))
    .update(`pickup-signal:${window}`)
    .digest();
  return {
    colour: COLOURS[mac[0] % COLOURS.length],
    shape: SHAPES[mac[1] % SHAPES.length],
    // When it next changes, so both screens can refetch at that instant rather
    // than drift apart by however long their polling happens to be.
    changesAt: new Date((window + 1) * WINDOW_MS).toISOString(),
  };
}

/**
 * The signal to show for a pickup right now.
 *
 * Once the principal has said "that is them", the signal freezes at whatever
 * it was in that moment. Otherwise it would rotate while they are still
 * walking over, and the thing they identified would stop being true halfway
 * across the hall.
 */
async function currentFor(item, now = Date.now()) {
  const found = item.pickup_found_at ? Date.parse(item.pickup_found_at) : null;
  const signal = signalAt(item.pickup_token, found || now);
  return {
    ...signal,
    ...(found ? { changesAt: null } : {}),
    found: !!found,
    foundAt: item.pickup_found_at || null,
  };
}

/** The principal has picked this driver out of the crowd. */
async function markFound(itemId) {
  const at = new Date().toISOString();
  await db.prepare('UPDATE itinerary_items SET pickup_found_at = ? WHERE id = ?').run(at, itemId);
  return at;
}

/** Undo — the wrong phone in the wrong hand, which happens. */
async function clearFound(itemId) {
  await db.prepare('UPDATE itinerary_items SET pickup_found_at = NULL WHERE id = ?').run(itemId);
}

module.exports = {
  COLOURS, SHAPES, WINDOW_MS, signalAt, currentFor, markFound, clearFound,
};
