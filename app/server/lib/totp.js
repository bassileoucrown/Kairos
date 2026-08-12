const crypto = require('crypto');

// Time-based one-time passwords (RFC 6238), the six digits an authenticator
// app shows. Written out rather than pulled from a package because it is
// thirty lines of HMAC and base32, and a dependency in the authentication
// path is a dependency you have to trust forever.

const DIGITS = 6;
const PERIOD = 30; // seconds
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase().replace(/[=\s]/g, '')) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('Not a valid base32 secret.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh secret, in the base32 form authenticator apps expect. */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function codeAt(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Checks a code, allowing one step either side so a phone clock a few seconds
 * out doesn't lock somebody out of their own account. Compared in constant
 * time — a timing side channel here would leak the code digit by digit.
 */
function verify(secret, token, { at = Date.now(), window = 1 } = {}) {
  const clean = String(token || '').replace(/\D/g, '');
  if (clean.length !== DIGITS) return false;
  const counter = Math.floor(at / 1000 / PERIOD);
  for (let drift = -window; drift <= window; drift += 1) {
    const expected = codeAt(secret, counter + drift);
    const a = Buffer.from(expected);
    const b = Buffer.from(clean);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** The otpauth:// URI an authenticator app scans as a QR code. */
function provisioningUri({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Recovery codes, for the phone that goes in a river. Stored hashed, like
 * passwords — a stolen database must not yield a way in.
 */
function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString('hex');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(String(code).trim().toLowerCase()).digest('hex');
}

module.exports = {
  generateSecret, verify, provisioningUri, codeAt,
  generateRecoveryCodes, hashRecoveryCode, PERIOD, DIGITS,
};
