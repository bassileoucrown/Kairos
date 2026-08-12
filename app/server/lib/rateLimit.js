// Throttling for the endpoints where guessing pays.
//
// Once this app holds passports, the password is the whole perimeter, and an
// unthrottled login is an offer to try a few million of them. Encryption at
// rest is irrelevant to an attacker who simply signs in.
//
// Keyed on both the account being attacked and the address attacking, so
// neither a single account being hammered nor one source spraying many
// accounts gets through. In memory, which is honest about its limits: it
// resets on restart and does not span instances. Adequate for one instance;
// replace with a shared store before running several.

const buckets = new Map();

function sweep(now) {
  for (const [key, hits] of buckets) {
    const live = hits.filter((t) => t > now);
    if (live.length) buckets.set(key, live);
    else buckets.delete(key);
  }
}

/**
 * Records an attempt and says whether this key is over its limit.
 * `windowMs` is how long each attempt counts for.
 */
function tooMany(key, { limit, windowMs }) {
  const now = Date.now();
  // Cheap opportunistic cleanup; there is no timer to leak.
  if (buckets.size > 5000) sweep(now);

  const expiry = now + windowMs;
  const hits = (buckets.get(key) || []).filter((t) => t > now);
  hits.push(expiry);
  buckets.set(key, hits);
  return hits.length > limit;
}

/** Forget a key — called on success, so a legitimate login clears the count. */
function clear(key) {
  buckets.delete(key);
}

/**
 * Express middleware. `keys` returns one or more strings to count against;
 * exceeding any of them refuses the request.
 */
function limit({ limit: max, windowMs, keys, message }) {
  return (req, res, next) => {
    const all = keys(req).filter(Boolean);
    const over = all.map((k) => tooMany(k, { limit: max, windowMs })).some(Boolean);
    if (over) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message });
    }
    req.rateLimitKeys = all;
    next();
  };
}

/** The address a request came from, trusting one proxy hop (the platform's). */
function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

module.exports = { limit, clear, tooMany, clientIp, _buckets: buckets };
