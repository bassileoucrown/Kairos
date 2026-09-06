// Turning what somebody typed into a place the map actually knows.
//
// WHY THIS EXISTS. `location` and `destination` are free text, and the
// distance lookup passes that text straight to the provider. That works —
// Distance Matrix accepts an address string — but it is only ever as good as
// what was typed, and "Chief's office" resolves to whatever Google makes of
// it, silently, differently on different days. A place id resolves to one
// point on the earth and keeps resolving to it.
//
// WHAT IT DOES NOT REPLACE. The typed words. They stay exactly as written and
// remain what the day sheet shows: an assistant writes "the usual place on
// Awolowo Road" because that is what the principal recognises, and swapping it
// for a formatted address would make the screen worse to read while making the
// lookup better. The id is stored beside the text, not instead of it.
//
// TYPING IS THE EXPOSURE HERE, WHICH IS DIFFERENT FROM THE DISTANCE LOOKUP.
// A distance lookup happens once, for a leg that already exists. Autocomplete
// sends a request per keystroke, before anything has been saved — so a rule
// that only guards saved items would leak the very thing it was written to
// protect, one letter at a time. The caller must therefore say what this
// search is FOR, and a search for personal time or a private trip is refused
// here rather than filtered later. See routes/itinerary.js.

const PROVIDERS = {
  google: {
    label: 'Google Places',
    keyVar: 'MAPS_API_KEY',
    url({ query, key, sessionToken, region }) {
      const base = process.env.PLACES_BASE_URL
        || 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
      const q = new URLSearchParams({ input: query, key });
      // Billed as one lookup instead of one per keystroke when the caller
      // keeps a token for the life of a single edit.
      if (sessionToken) q.set('sessiontoken', sessionToken);
      // Nigeria first, because that is where the principals are. Not a filter:
      // a bias, so Lagos beats a same-named street elsewhere without making an
      // Accra trip unsearchable.
      if (region) q.set('components', `country:${region}`);
      return `${base}?${q}`;
    },
    read(body) {
      if (body?.status === 'ZERO_RESULTS') return { places: [] };
      if (body?.status && body.status !== 'OK') {
        return { error: readableStatus(body.status) };
      }
      const places = (body?.predictions || []).slice(0, 6).map((p) => ({
        placeId: p.place_id,
        description: p.description,
        // The bold half of what Google shows: "Radisson Blu" rather than the
        // whole line, so a list of six can be read at a glance.
        primary: p.structured_formatting?.main_text || p.description,
        secondary: p.structured_formatting?.secondary_text || '',
      })).filter((p) => p.placeId && p.description);
      return { places };
    },
  },
};

function readableStatus(code) {
  if (code === 'OVER_QUERY_LIMIT') return 'The maps account is over its quota.';
  if (code === 'REQUEST_DENIED') return 'The maps key was refused — Places may not be enabled on it.';
  if (code === 'INVALID_REQUEST') return 'That search was not something the provider could read.';
  return `The maps provider answered ${code}.`;
}

function providerName() {
  const name = String(process.env.MAPS_PROVIDER || 'google').toLowerCase();
  return PROVIDERS[name] ? name : 'google';
}

function isConfigured() {
  return Boolean(process.env[PROVIDERS[providerName()].keyVar]);
}

function label() {
  return PROVIDERS[providerName()].label;
}

/**
 * How a place should be named to the distance lookup.
 *
 * `place_id:ChIJ…` is the provider's own way of saying "this exact place, no
 * guessing", and it is what makes storing the id worth anything. Falls back to
 * the typed text, which is what every row has today.
 */
function asQuery(text, placeId) {
  return placeId ? `place_id:${placeId}` : String(text || '').trim();
}

/**
 * Places matching what has been typed so far.
 *
 * Returns `{ places: [...] }`, or `{ error }` with something a person can act
 * on. Never throws: a maps outage must leave somebody able to type an address
 * by hand, which is the behaviour that existed before this file.
 */
async function suggest({ query, sessionToken, region }) {
  if (!isConfigured()) {
    return {
      error: `Place search is not configured on this deployment — it needs ${PROVIDERS[providerName()].keyVar}.`,
      unconfigured: true,
    };
  }
  const text = String(query || '').trim();
  // Two letters, matching the Find box. One letter matches most of Lagos and
  // bills for the privilege.
  if (text.length < 2) return { places: [] };

  const p = PROVIDERS[providerName()];
  let res;
  try {
    res = await fetch(p.url({
      query: text,
      key: process.env[p.keyVar],
      sessionToken,
      region: region ?? (process.env.PLACES_REGION || 'ng'),
    }), { signal: AbortSignal.timeout(Number(process.env.MAPS_TIMEOUT_MS || 8000)) });
  } catch (err) {
    return { error: `Could not reach ${p.label}: ${err.message}` };
  }
  if (!res.ok) return { error: `${p.label} answered ${res.status}.` };

  let body;
  try { body = await res.json(); } catch { return { error: `${p.label} returned something that is not JSON.` }; }
  return p.read(body);
}

module.exports = { suggest, isConfigured, label, providerName, asQuery };
