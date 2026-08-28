const connectors = require('./connectors');
const travelTime = require('./travelTime');
const visas = require('./visas');
const concierge = require('./concierge');
const { isConfigured: encryptionConfigured } = require('./secretBox');
const aiModel = require('./aiModel');

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
  ai_assist: 'AI Assist',
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
    control: 'Travel time',
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
    control: 'Live status',
    screen: 'trips',
    label: 'Live flight status',
    what: 'The flight as it is rather than as it was booked, feeding the delay cascade.',
    available: connectors.isConfigured('flights'),
    needs: ['FLIGHT_DATA_KEY'],
    state: 'needs_key',
  });
  // Coverage is built and needs nothing. What stays unavailable is the other
  // half of the question — whether a visa is REQUIRED — which needs a
  // maintained ruleset and strands people when it is answered wrongly.
  add({
    id: 'visa_rules',
    control: 'Check requirement',
    screen: 'trips',
    label: 'Whether a visa is required',
    what: 'Nationality-by-destination rules. Checking the visas you hold already works; this is the lookup that says whether one is needed at all.',
    available: visas.rulesConfigured(),
    needs: ['VISA_RULES_KEY'],
    state: 'soon',
  });
  add({
    id: 'inbound_email',
    control: 'Forward a confirmation',
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
    control: 'Attach a scan',
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
    control: 'Transcribe',
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
    control: 'Make a request',
    screen: 'concierge',
    label: 'The concierge desk',
    what: 'Somebody who takes the request and comes back with it done.',
    available: concierge.isAvailable(),
    needs: ['CONCIERGE_PARTNER'],
    // Waiting on contracted people rather than on code, so it never carries a
    // date. See lib/concierge.js.
    state: 'soon',
  });

  // ---- AI Assist -----------------------------------------------------
  //
  // WHAT IS REAL HERE ALREADY. Finding a time is a keyword parser filtering
  // the same computed slots the public page uses — no model, entirely
  // deterministic, and reliable precisely because it cannot invent a time.
  // Drafting from a template is real too. Neither is generation, and neither
  // is listed here, because a working thing does not belong in a register of
  // things that are not working.
  //
  // WHAT IS LISTED is everything that needs a model, so it is visibly absent
  // in the place it will occupy rather than quietly missing. One key turns all
  // four on at once; they are separate entries because they will arrive
  // separately and somebody reading this should see what is coming.
  const aiReady = aiModel.isConfigured();
  const aiNeeds = ['ANTHROPIC_API_KEY'];
  add({
    id: 'ai_compose',
    control: 'Write it for me',
    screen: 'ai_assist',
    label: 'Compose in the principal\'s voice',
    what: 'A message written the way this principal writes, learned from what they have actually sent — not a template with a name dropped into it.',
    available: aiReady,
    needs: aiNeeds,
    state: 'needs_key',
  });
  add({
    id: 'ai_reply',
    control: 'Reply to this',
    screen: 'ai_assist',
    label: 'Reply to a message you paste in',
    what: 'Paste what arrived and get an answer that reads as though a person wrote it, in the principal\'s register.',
    available: aiReady,
    needs: aiNeeds,
    state: 'needs_key',
  });
  add({
    id: 'ai_rewrite',
    control: 'Shorter · Warmer · Firmer',
    screen: 'ai_assist',
    label: 'Rework what is already written',
    what: 'One tap on a draft you have: shorter, warmer, firmer, more formal.',
    available: aiReady,
    needs: aiNeeds,
    state: 'needs_key',
  });
  add({
    id: 'ai_summary',
    control: 'What was decided',
    screen: 'ai_assist',
    label: 'Summarise a long conversation',
    what: 'Sixty messages down to what was settled and what is still open. The records register already holds the formal half of this.',
    available: aiReady,
    needs: aiNeeds,
    state: 'needs_key',
  });

  // ---- Settings: where a session is signed in from ---------------------
  // The device, the address and the last-seen time are all real and shown.
  // Turning that address into a city is what is missing, and it stays missing
  // until there is a dataset on this machine to do it with — asking somebody
  // else's lookup service would hand a third party a running log of where a
  // principal has been, which is the one thing this screen exists to protect.
  add({
    id: 'session_location',
    control: 'Approximate location',
    screen: 'settings',
    label: 'Where a device signed in from',
    what: 'The city behind an address. The address itself, the device and the last-seen time are already shown.',
    available: !!process.env.GEOIP_DB,
    needs: ['GEOIP_DB'],
    state: 'soon',
  });

  // ---- Settings: the connectors, summarised ---------------------------
  const waiting = connectors.CONNECTORS.filter((c) => !connectors.isConfigured(c.id));
  add({
    id: 'connectors',
    control: 'Connectors',
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
