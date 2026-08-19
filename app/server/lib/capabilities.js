const connectors = require('./connectors');
const travelTime = require('./travelTime');
const concierge = require('./concierge');
const { isConfigured: encryptionConfigured } = require('./secretBox');

// Everything that is designed but not yet working, and exactly where in the
// app somebody will look for it.
//
// This exists so no screen decides for itself whether a thing works. A page
// that hardcodes "coming soon" keeps saying it after the credential is set,
// and a page that hardcodes nothing quietly offers a button that does nothing.
// Both are how a product loses the right to be believed about anything else.
//
// So availability is computed from the same environment the feature itself
// reads. Set MAPS_API_KEY and the travel-time notice disappears from the
// itinerary by itself, because the notice and the feature are asking the same
// question.
//
// TWO STATES, SAID DIFFERENTLY, because they are different promises:
//
//   'soon'      — the work is ours and it is coming. A credential we have to
//                 go and buy, or code we have to go and write.
//   'needs_key' — the work is done and the deployment is missing something
//                 specific, which the operator can set today.
//
// The distinction matters to whoever is reading. A principal seeing "coming
// soon" is being asked to wait. An operator seeing "needs MAPS_API_KEY" is
// being handed a task.

/**
 * Where each unbuilt thing lives, so a screen can ask for its own list rather
 * than importing the whole registry and filtering by hand.
 */
const SCREENS = {
  itinerary: 'Itinerary',
  trips: 'Trips',
  vault: 'Essentials',
  direct_line: 'Direct line',
  settings: 'Settings',
  concierge: 'Concierge',
};

function build() {
  const out = [];

  const add = (c) => out.push(c);

  // ---- Itinerary -----------------------------------------------------
  add({
    id: 'travel_time',
    screen: 'itinerary',
    label: 'Travel time with live traffic',
    what: 'Ask the road how long this leg takes, at the hour it happens.',
    available: travelTime.isConfigured(),
    needs: ['MAPS_API_KEY'],
    state: 'needs_key',
  });

  // ---- Trips ---------------------------------------------------------
  add({
    id: 'flight_status',
    screen: 'trips',
    label: 'Live flight status',
    what: 'The flight as it is rather than as it was booked, feeding the delay cascade.',
    available: connectors.isConfigured('flights'),
    needs: ['FLIGHT_DATA_KEY'],
    state: 'needs_key',
  });
  add({
    id: 'visa_check',
    screen: 'trips',
    label: 'Visa requirements',
    what: 'Whether this passport needs a visa for this destination, and how long it takes to get.',
    available: false,
    needs: [],
    // Not a credential: it needs a rules dataset somebody maintains, and being
    // wrong here is worse than being absent.
    state: 'soon',
  });
  add({
    id: 'inbound_email',
    screen: 'trips',
    label: 'Forward a confirmation',
    what: 'Send an airline or hotel email to your trips address and the journey builds itself.',
    available: connectors.isConfigured('inbound_email'),
    needs: ['INBOUND_EMAIL_DOMAIN', 'INBOUND_EMAIL_SECRET'],
    state: 'soon',
  });

  // ---- The vault -----------------------------------------------------
  add({
    id: 'document_scans',
    screen: 'vault',
    label: 'Attach a scan',
    what: 'The passport page itself, encrypted, when the number alone is not enough.',
    available: connectors.isConfigured('storage') && encryptionConfigured(),
    needs: ['STORAGE_BUCKET', 'STORAGE_KEY'],
    state: 'soon',
  });

  // ---- The direct line -----------------------------------------------
  add({
    id: 'transcription',
    screen: 'direct_line',
    label: 'Transcribe a voice note',
    what: 'Voice made searchable, through a route that does not hand the audio to anybody else.',
    available: connectors.isConfigured('transcription'),
    needs: ['TRANSCRIPTION_ENDPOINT', 'TRANSCRIPTION_KEY'],
    state: 'soon',
  });

  // ---- The desk ------------------------------------------------------
  add({
    id: 'concierge_desk',
    screen: 'concierge',
    label: 'The concierge desk',
    what: 'Somebody who takes the request and comes back with it done.',
    available: concierge.isAvailable(),
    needs: ['CONCIERGE_PARTNER'],
    // Waiting on contracted people rather than on code, so it never carries a
    // date. See lib/concierge.js.
    state: 'soon',
  });

  // ---- Settings: the connectors, summarised ---------------------------
  const waiting = connectors.CONNECTORS.filter((c) => !connectors.isConfigured(c.id));
  add({
    id: 'connectors',
    screen: 'settings',
    label: 'Connectors',
    what: `${waiting.length} of ${connectors.CONNECTORS.length} are still waiting on a credential.`,
    available: waiting.length === 0,
    needs: [],
    state: 'needs_key',
  });

  return out;
}

/** Everything, or everything on one screen. */
function list(screen) {
  const all = build();
  return screen ? all.filter((c) => c.screen === screen) : all;
}

module.exports = { list, SCREENS };
