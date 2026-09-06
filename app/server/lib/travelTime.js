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
//
// The bucket is an ABSOLUTE instant, not an hour-of-week, which matters: the
// same Thursday 6pm in two different weeks is two different buckets and two
// different lookups. A key that folded weekdays together would answer next
// Thursday with last Thursday's traffic, which is not a cache — it is a
// lookup table wearing a cache's clothes, and it would defeat the feature.
const BUCKET_MS = 15 * 60 * 1000;

/**
 * How long an answer stays good for, judged by how far off the departure is.
 *
 * This replaces a flat six-hour TTL, which was wrong in the one case that
 * matters most. A drive at 18:00 estimated at 09:00 was served from the cache
 * until 15:00 — so the assistant checking at 14:30, precisely because they
 * were about to commit to leaving, got the morning's guess. The number was
 * six hours old at the moment it needed to be current.
 *
 * Traffic is only knowable close to the event. Far out, the provider is
 * returning a historical model rather than live conditions, so re-asking every
 * ninety seconds buys nothing but invoice. Close in, it is the whole point.
 *
 * MAPS_CACHE_TTL_MS still works, but only as a CEILING — an operator can make
 * this fresher and cannot make it staler. Env vars that can quietly reintroduce
 * the defect they were meant to tune are not a setting, they are a trap.
 */
function freshnessMs(departAt) {
  const away = departAt - Date.now();
  let ms;
  if (away <= 2 * 60 * 60 * 1000) ms = 90 * 1000;            // imminent: live
  else if (away <= 24 * 60 * 60 * 1000) ms = 15 * 60 * 1000; // today-ish
  else ms = 6 * 60 * 60 * 1000;                              // a model anyway
  const ceiling = Number(process.env.MAPS_CACHE_TTL_MS);
  return Number.isFinite(ceiling) && ceiling > 0 ? Math.min(ms, ceiling) : ms;
}

function cacheKey(from, to, departAt) {
  const bucket = Math.floor(departAt / BUCKET_MS) * BUCKET_MS;
  return crypto.createHash('sha256')
    .update(`${providerName()}|${from.trim().toLowerCase()}|${to.trim().toLowerCase()}|${bucket}`)
    .digest('hex');
}

async function cached(key, departAt) {
  const row = await db.prepare('SELECT * FROM travel_estimates WHERE id = ?').get(key);
  if (!row) return null;
  const readAt = new Date(row.created_at).getTime();
  const age = Date.now() - readAt;
  if (age > freshnessMs(departAt)) return null;
  return {
    minutes: row.minutes,
    traffic: !!row.with_traffic,
    distanceKm: row.distance_km,
    cached: true,
    readAt: row.created_at,
    ageSeconds: Math.round(age / 1000),
  };
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
async function estimate({ from, to, departAt, fresh = false }) {
  if (!isConfigured()) {
    return { error: `Travel time is not configured on this deployment — it needs ${PROVIDERS[providerName()].keyVar}.`, unconfigured: true };
  }
  if (!String(from || '').trim() || !String(to || '').trim()) {
    return { error: 'This leg needs somewhere to leave from and somewhere to go.' };
  }
  const at = Number(departAt) || Date.now();
  const key = cacheKey(from, to, at);

  // `fresh` is somebody pressing "check again" because they are about to act
  // on the answer. That intent outranks the invoice.
  if (!fresh) {
    try {
      const hit = await cached(key, at);
      if (hit) return { ...hit, provider: label() };
    } catch { /* a cache miss and a cache failure are the same thing here */ }
  }

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

  const readAt = new Date().toISOString();
  try { await remember(key, from, to, at, read); } catch { /* the answer is still good */ }
  // readAt on every answer, cached or not, so a screen can say when the road
  // was actually asked instead of implying that a number on it is current.
  return { ...read, provider: label(), cached: false, readAt, ageSeconds: 0 };
}

module.exports = { estimate, isConfigured, label, providerName, BUCKET_MS, freshnessMs };
