const crypto = require('crypto');

// Where a thing too big for a database row is kept.
//
// WHAT THIS IS FOR. A scanned passport page, and now an hour of meeting audio.
// Both are large, both are the most sensitive material this product touches,
// and neither belongs in a column — a database row is replicated into every
// backup and every read replica, and a principal's voice should not be in any
// of those places by accident.
//
// S3-COMPATIBLE OVER PLAIN HTTP, WITH NO SDK. The signature below is AWS
// Signature Version 4, written out because the alternative is a dependency
// that pulls in a hundred more, and because an S3-compatible endpoint is the
// one interface every object store agrees on — AWS, Cloudflare R2, Backblaze,
// DigitalOcean Spaces, MinIO on somebody's own hardware. An office that will
// not put a principal's audio in another company's cloud can point
// STORAGE_ENDPOINT at a box in their own building and nothing else changes.
//
// THE SIGNING IS TESTED AGAINST AWS'S OWN PUBLISHED VECTOR. Nothing else here
// can be verified without a live bucket, so the one part that CAN be proved
// correct offline is proved — see bkeep.js. A signature that is subtly wrong
// fails at the worst moment, in a way that looks like a network problem.

const ALGO = 'AWS4-HMAC-SHA256';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

/** The five environment variables this needs, and which are missing. */
function config() {
  const bucket = (process.env.STORAGE_BUCKET || '').trim();
  const endpoint = (process.env.STORAGE_ENDPOINT || '').trim().replace(/\/+$/, '');
  const region = (process.env.STORAGE_REGION || 'us-east-1').trim();
  const key = (process.env.STORAGE_KEY || '').trim();
  const secret = (process.env.STORAGE_SECRET || '').trim();
  const missing = [];
  if (!bucket) missing.push('STORAGE_BUCKET');
  if (!endpoint) missing.push('STORAGE_ENDPOINT');
  if (!key) missing.push('STORAGE_KEY');
  if (!secret) missing.push('STORAGE_SECRET');
  return { bucket, endpoint, region, key, secret, missing };
}

function isConfigured() {
  return config().missing.length === 0;
}

/**
 * Sign one request, the way AWS specifies it.
 *
 * Exported so it can be tested against the published vector rather than only
 * against a live endpoint. Every argument is explicit — including the clock —
 * because a signer that reads the time itself cannot be checked against a
 * fixture written in 2015.
 */
function sign({
  method, host, path, region, service = 's3',
  key, secret, payloadHash, at = new Date(), headers = {},
}) {
  const stamp = at.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);

  const all = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp, ...headers };
  // Lower-cased, sorted, trimmed — the canonical form is not a suggestion, and
  // getting the order wrong produces a signature that is valid-looking and
  // rejected.
  const names = Object.keys(all).map((h) => h.toLowerCase()).sort();
  const lower = {};
  for (const [k, v] of Object.entries(all)) lower[k.toLowerCase()] = String(v).trim();

  const canonicalHeaders = `${names.map((n) => `${n}:${lower[n]}`).join('\n')}\n`;
  const signedHeaders = names.join(';');
  const canonical = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = [ALGO, stamp, scope, sha256Hex(canonical)].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(toSign).digest('hex');

  return {
    signature,
    stamp,
    headers: {
      ...headers,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': stamp,
      authorization: `${ALGO} Credential=${key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/** One request to the store, signed and sent. */
async function call(method, objectKey, body = null, extraHeaders = {}) {
  const c = config();
  if (c.missing.length) {
    throw Object.assign(new Error(`Object storage is not configured: ${c.missing.join(', ')}.`), {
      code: 'not_configured', missing: c.missing,
    });
  }
  const url = new URL(`${c.endpoint}/${c.bucket}/${objectKey}`);
  const payloadHash = sha256Hex(body || '');
  const { headers } = sign({
    method,
    host: url.host,
    path: url.pathname,
    region: c.region,
    key: c.key,
    secret: c.secret,
    payloadHash,
    headers: extraHeaders,
  });

  const res = await fetch(url, { method, headers, body: body || undefined });
  if (!res.ok && res.status !== 404) {
    // The provider's own words, truncated. "Storage failed" tells an operator
    // nothing; "SignatureDoesNotMatch" tells them exactly which of the five
    // variables is wrong.
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw Object.assign(new Error(`Object storage refused (${res.status}): ${text}`), {
      code: 'storage_failed', status: res.status,
    });
  }
  return res;
}

/** Put bytes. Returns the key they were stored under. */
async function put(objectKey, bytes, contentType = 'application/octet-stream') {
  await call('PUT', objectKey, bytes, {
    'content-type': contentType,
    'content-length': String(bytes.length),
  });
  return objectKey;
}

/** Get bytes back, or null when there is nothing there. */
async function get(objectKey) {
  const res = await call('GET', objectKey);
  if (res.status === 404) return null;
  return Buffer.from(await res.arrayBuffer());
}

/** Remove it. Absent is success — this is called to make sure a thing is gone. */
async function del(objectKey) {
  await call('DELETE', objectKey);
  return true;
}

module.exports = { isConfigured, config, sign, put, get, del, sha256Hex };
