const crypto = require('crypto');
const db = require('./db');

// How long the drive will actually take, at the hour it actually happens.
//
// `travel_minutes` has been on every itinerary item since the day was first
// modelled as a chain, and the delay cascade already reasons from it — but it
// has always been a number somebody typed. In Lagos that number is the entire
// schedule. Ikoyi to Victoria Island is twelve minutes at eleven on a Sunday
// and eighty at six on a Thursday, and an assistant guessing it once and
// reusing it forever is the single most common way a principal is late through
// nobody's fault.
//
// So this asks a maps provider, at the departure time, with traffic.
//
// ONE SHAPE, MORE THAN ONE PROVIDER, for the same reason the email service has
// two: which maps API a deployment can get billing for is an operator's
// decision, not an architectural one.
//
// WHAT IT DOES NOT DO
//
// It does not silently rewrite the itinerary. An estimate is offered and a
// person accepts it. A schedule that reshuffles itself because traffic moved
// while nobody was looking is a schedule nobody trusts — and the assistant
// often knows something the road does not, like a closed gate or a convoy.
//
// It also never sends a principal's name, and it never sends a home address as
// anything but the same free text already typed into the itinerary. The
// provider learns that somebody is going from one place to another at a time.
// That is unavoidable for this feature to exist at all, and it is why the
// connector is listed as one an operator turns on deliberately.

const PROVIDERS = {
  google: {
    label: 'Google Distance Matrix',
    keyVar: 'MAPS_API_KEY',
    url({ from, to, departAt, key }) {
      const base = process.env.MAPS_BASE_URL
        || 'https://maps.googleapis.com/maps/api/distancematrix/json';
      const q = new URLSearchParams({
        origins: from,
        destinations: to,
        // Seconds since the epoch, which is what the API wants and also the
        // whole point: the same road at two different hours is two answers.
        departure_time: String(Math.floor(departAt / 1000)),
        traffic_model: 'best_guess',
        key,
      });
      return `${base}?${q}`;
    },
    read(body) {
      const el = body?.rows?.[0]?.elements?.[0];
      if (!el || el.status !== 'OK') {
        return { error: readableStatus(el?.status || body?.status || 'UNKNOWN') };
      }
      // duration_in_traffic is only present when a departure_time was sent and
      // the region has traffic data. Falling back to plain duration is better
      // than failing, but the caller is told which it got.
      const withTraffic = el.duration_in_traffic?.value;
      const plain = el.duration?.value;
      const seconds = withTraffic ?? plain;
      if (typeof seconds !== 'number') return { error: 'No duration came back.' };
      return {
        minutes: Math.round(seconds / 60),
        traffic: withTraffic !== undefined,
        distanceKm: el.distance?.value ? Math.round(el.distance.value / 100) / 10 : null,
      };
    },
  },
};

function readableStatus(code) {
  if (code === 'ZERO_RESULTS') return 'No route between those two places.';
  if (code === 'NOT_FOUND') return 'One of those addresses could not be found.';
  if (code === 'OVER_QUERY_LIMIT') return 'The maps account is over its quota.';
  if (code === 'REQUEST_DENIED') return 'The maps key was refused.';
  return `The maps provider answered ${code}.`;
}

function providerName() {
  const name = String(process.env.MAPS_PROVIDER || 'google').toLowerCase();
  return PROVIDERS[name] ? name : 'google';
}

function isConfigured() {
  const p = PROVIDERS[providerName()];
  return Boolean(process.env[p.keyVar]);
}

function label() {
  return PROVIDERS[providerName()].label;
}

// Quarter-hour buckets.
//
// Traffic does not change meaningfully between 09:01 and 09:07, and every one
// of these calls is billed per element. Bucketing means an assistant nudging a
// meeting by five minutes and re-estimating four times pays for one lookup.
const BUCKET_MS = 15 * 60 * 1000;
const CACHE_TTL_MS = Number(process.env.MAPS_CACHE_TTL_MS || 6 * 60 * 60 * 1000);

function cacheKey(from, to, departAt) {
  const bucket = Math.floor(departAt / BUCKET_MS) * BUCKET_MS;
  return crypto.createHash('sha256')
    .update(`${providerName()}|${from.trim().toLowerCase()}|${to.trim().toLowerCase()}|${bucket}`)
    .digest('hex');
}

async function cached(key) {
  const row = await db.prepare('SELECT * FROM travel_estimates WHERE id = ?').get(key);
  if (!row) return null;
  if (Date.now() - new Date(row.created_at).getTime() > CACHE_TTL_MS) return null;
  return { minutes: row.minutes, traffic: !!row.with_traffic, distanceKm: row.distance_km, cached: true };
}

async function remember(key, from, to, departAt, result) {
  await db.prepare(`
    INSERT INTO travel_estimates (id, origin, destination, depart_at, minutes, with_traffic, distance_km, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(key, from.slice(0, 300), to.slice(0, 300), new Date(departAt).toISOString(),
    result.minutes, result.traffic ? 1 : 0, result.distanceKm, new Date().toISOString());
}

/**
 * How long this leg will take.
 *
 * Returns `{ minutes, traffic, provider }`, or `{ error }` with something a
 * person can act on. Never throws: a maps outage must not take a day sheet
 * down with it, and the hand-typed number is still there.
 */
async function estimate({ from, to, departAt }) {
  if (!isConfigured()) {
    return { error: `Travel time is not configured on this deployment — it needs ${PROVIDERS[providerName()].keyVar}.`, unconfigured: true };
  }
  if (!String(from || '').trim() || !String(to || '').trim()) {
    return { error: 'This leg needs somewhere to leave from and somewhere to go.' };
  }
  const at = Number(departAt) || Date.now();
  const key = cacheKey(from, to, at);

  try {
    const hit = await cached(key);
    if (hit) return { ...hit, provider: label() };
  } catch { /* a cache miss and a cache failure are the same thing here */ }

  const p = PROVIDERS[providerName()];
  let res;
  try {
    res = await fetch(p.url({ from, to, departAt: at, key: process.env[p.keyVar] }), {
      signal: AbortSignal.timeout(Number(process.env.MAPS_TIMEOUT_MS || 8000)),
    });
  } catch (err) {
    return { error: `Could not reach ${p.label}: ${err.message}` };
  }
  if (!res.ok) return { error: `${p.label} answered ${res.status}.` };

  let body;
  try { body = await res.json(); } catch { return { error: `${p.label} returned something that is not JSON.` }; }

  const read = p.read(body);
  if (read.error) return read;

  try { await remember(key, from, to, at, read); } catch { /* the answer is still good */ }
  return { ...read, provider: label(), cached: false };
}

module.exports = { estimate, isConfigured, label, providerName, BUCKET_MS };
