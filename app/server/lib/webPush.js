const crypto = require('crypto');
const db = require('./db');

/**
 * Reaching a phone that is in a pocket.
 *
 * WHAT A PUSH ACTUALLY IS. A notification never travels from Kairos to a phone.
 * It goes to whichever push service that browser belongs to — Google's for
 * Chrome, Apple's for Safari, Mozilla's for Firefox — and that service carries
 * it the last mile. Two consequences run through everything below:
 *
 *   1. The service will not carry a message from a sender it cannot identify.
 *      VAPID is that identity: ONE keypair for the whole deployment, used to
 *      sign every push. Not per person, not per device.
 *
 *   2. The service is a third party that Kairos does not control, and every
 *      push passes through it. So the payload is encrypted end to end, to a key
 *      that only that browser holds, and Google can carry "Ngozi replied on the
 *      pad" without being able to read a word of it.
 *
 * WHY THIS IS WRITTEN OUT RATHER THAN INSTALLED. The usual answer is the
 * `web-push` package. This server has two dependencies — express and pg — and
 * that is a deliberate posture for a product holding passport numbers: every
 * dependency is code from strangers running beside the vault. The whole of Web
 * Push is a few hundred lines of standard primitives Node already ships, so it
 * is here, with the two RFCs named against the parts that implement them, and
 * the supply chain stays two packages long.
 *
 * WHAT IS DELIBERATELY NOT SENT. The notification carries who and where, never
 * the words. "Adaeze sent you something" and a link, not the message body —
 * because a notification lands on a lock screen, in front of whoever is holding
 * the phone, and this product's messages are about where a principal will be at
 * three o'clock. The body is read inside Kairos, behind a session.
 */

// ---- The keys ------------------------------------------------------------

function publicKey() {
  return String(process.env.VAPID_PUBLIC_KEY || '').trim();
}

function privateKey() {
  return String(process.env.VAPID_PRIVATE_KEY || '').trim();
}

function subject() {
  return String(process.env.VAPID_SUBJECT || '').trim();
}

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Both halves present and the right shape.
 *
 * Lengths rather than a regex on the contents: a P-256 public key is the
 * uncompressed point — 65 bytes, so 87 base64url characters — and the private
 * half is the 32-byte scalar, so 43. Anything else was pasted wrong, and saying
 * so here beats a push service silently dropping every message.
 */
function isConfigured() {
  return publicKey().length === 87 && privateKey().length === 43 && !!subject();
}

/**
 * The private key as something Node will sign with, and the public point it
 * actually implies.
 *
 * The scalar alone is not a key any API here accepts, so the point is derived
 * from it and the two are assembled into a JWK. Deriving it also answers a
 * question nothing else can: whether the two halves in the environment are
 * genuinely a pair. Two keys from two different generations both pass every
 * length check, sign perfectly, and are rejected by every push service —
 * a failure with no error anywhere near its cause.
 */
function keyMaterial() {
  const ec = crypto.createECDH('prime256v1');
  ec.setPrivateKey(unb64url(privateKey()));
  const point = ec.getPublicKey();
  return {
    derivedPublic: b64url(point),
    signingKey: crypto.createPrivateKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        d: privateKey(),
        x: b64url(point.subarray(1, 33)),
        y: b64url(point.subarray(33, 65)),
      },
      format: 'jwk',
    }),
  };
}

/** What is wrong, in words, or null. For an operator, not for a principal. */
function problem() {
  if (!publicKey() && !privateKey() && !subject()) return null; // Simply not set up.
  if (publicKey().length !== 87) {
    return 'VAPID_PUBLIC_KEY should be 87 characters. Generate the pair again rather than editing it.';
  }
  if (privateKey().length !== 43) {
    return 'VAPID_PRIVATE_KEY should be 43 characters. Generate the pair again rather than editing it.';
  }
  if (!subject()) {
    return 'VAPID_SUBJECT is missing — an address the push services can complain to, like mailto:you@yourdomain.com.';
  }
  if (!/^(mailto:|https:\/\/)/.test(subject())) {
    return 'VAPID_SUBJECT must start with mailto: or https://.';
  }
  try {
    if (keyMaterial().derivedPublic !== publicKey()) {
      return 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not two halves of the same pair — '
        + 'they look like they came from two different generations. Generate one pair and paste both.';
    }
  } catch {
    return 'VAPID_PRIVATE_KEY is not a valid P-256 key. Generate the pair again.';
  }
  return null;
}

// ---- Signing (RFC 8292) --------------------------------------------------

/**
 * The header that says who is sending.
 *
 * A short-lived JWT, signed with the private half, naming the push service it
 * is for. `aud` is the ORIGIN of the endpoint and not the endpoint itself,
 * which matters: an endpoint is per-device and a token scoped to one would
 * have to be minted per push instead of once per service.
 */
function authorizationFor(endpoint) {
  const { signingKey } = keyMaterial();
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(Buffer.from(JSON.stringify({
    aud: new URL(endpoint).origin,
    // Twelve hours. The standard's ceiling is twenty-four; well inside it
    // leaves room for a clock that is a little out without anything failing.
    exp: Math.floor(Date.now() / 1000) + (12 * 60 * 60),
    sub: subject(),
  })));
  const signingInput = `${header}.${claims}`;
  // ieee-p1363 rather than DER: a JWS signature is the raw r‖s pair, and Node's
  // default DER wrapper is silently the wrong shape here.
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: signingKey, dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${signingInput}.${b64url(signature)}, k=${publicKey()}`;
}

// ---- Encryption (RFC 8291) -----------------------------------------------

/** HKDF, one block. Everything derived here is 32 bytes or fewer. */
function hkdf(salt, ikm, info, length) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  return crypto.createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, length);
}

/**
 * The payload, sealed to one browser.
 *
 * The subscription carries two secrets the browser generated and Kairos never
 * chose: p256dh, its public key, and auth, sixteen bytes of salt. An ephemeral
 * keypair is made for THIS message, agreed with p256dh, and thrown away — so
 * even the deployment's own private key cannot reopen a push it sent yesterday.
 *
 * The wire format is aes128gcm (RFC 8188): salt, record size, the length of the
 * sender's key, that key, then the sealed record. The 0x02 byte glued to the
 * end of the plaintext is the standard's "this is the last record" marker, not
 * padding.
 */
function seal(plaintext, p256dh, auth) {
  const uaPublic = unb64url(p256dh);
  const authSecret = unb64url(auth);

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);

  const ikm = hkdf(
    authSecret,
    shared,
    Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]),
    32,
  );

  const salt = crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(plaintext, 'utf8'), Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([
    salt, recordSize, Buffer.from([asPublic.length]), asPublic, sealed,
  ]);
}

const RECORD_SIZE = 4096;
// One record's worth, less the GCM tag and the last-record marker. A payload
// longer than this would need splitting across records, which nothing here
// sends — the notification is a name and a line, by design.
const MAX_PLAINTEXT = RECORD_SIZE - 16 - 1;

// ---- Sending -------------------------------------------------------------

/**
 * One push to one subscription.
 *
 * Answers rather than throws, because the caller is always in the middle of
 * something that has already succeeded — a message is saved, a note is handed
 * over — and a push service having a bad afternoon must not undo any of it.
 *
 * `gone` is the answer that matters. 404 and 410 are the push service saying
 * this subscription is dead: the app was uninstalled, permission was revoked,
 * the browser rotated it. Those rows are deleted rather than retried, because a
 * dead subscription retried forever is how a table of them grows without bound.
 */
// How long a push service gets before Kairos stops waiting for it.
//
// NOT OPTIONAL, AND THE REASON IS THE WHOLE POINT OF THIS MODULE. Sending is
// on the path of saving a message: somebody presses Send, the message is
// written, and then the office is told. A push service that accepts the
// connection and never answers would hold that request open — and with a
// handful of devices subscribed, one unreachable service turns "the car is
// outside" into a spinner. The notification is the least important thing
// happening in that request and must never be the slowest.
const SEND_TIMEOUT_MS = 5000;

async function sendTo(subscription, payload, { ttlSeconds = 86400 } = {}) {
  if (!isConfigured()) return { ok: false, error: 'not configured' };
  const text = String(payload || '');
  if (Buffer.byteLength(text, 'utf8') > MAX_PLAINTEXT) {
    return { ok: false, error: 'payload too large' };
  }
  try {
    const body = seal(text, subscription.p256dh, subscription.auth);
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorizationFor(subscription.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
        TTL: String(ttlSeconds),
      },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 410) return { ok: false, gone: true };
    if (!res.ok) return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Tell one person, on every device they have said yes on.
 *
 * WHAT TRAVELS. A title, a line, and where to go — never the message itself.
 * See the note at the top of this file: a notification is read by whoever is
 * holding the phone, and this product's messages are about where somebody will
 * be at three o'clock.
 *
 * Never throws and never blocks the thing that caused it. A push that fails is
 * a push that fails; the fact itself is already saved, and Kairos will still be
 * showing it the next time the person opens the app.
 */
async function notify(userId, { title, body, url = '/', tag = null }) {
  if (!isConfigured() || !userId) return { sent: 0 };
  let sent = 0;
  try {
    const subs = await db.prepare(
      'SELECT * FROM push_subscriptions WHERE user_id = ?',
    ).all(userId);
    const payload = JSON.stringify({
      title: String(title || 'Kairos').slice(0, 120),
      body: String(body || '').slice(0, 200),
      url,
      tag,
    });

    // All of somebody's devices at once, not one after another. This runs on
    // the path of saving a message, so the cost of a push service that has
    // stopped answering has to be ONE timeout however many phones are on the
    // account — three devices behind a dead service would otherwise be fifteen
    // seconds of somebody staring at a spinner after saying "car's outside".
    const results = await Promise.all(subs.map((sub) => sendTo(sub, payload)));

    for (let i = 0; i < subs.length; i += 1) {
      const sub = subs[i];
      const result = results[i];
      if (result.gone) {
        await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      } else if (result.ok) {
        sent += 1;
        await db.prepare('UPDATE push_subscriptions SET last_ok_at = ? WHERE id = ?')
          .run(new Date().toISOString(), sub.id);
      } else {
        await db.prepare('UPDATE push_subscriptions SET last_error = ? WHERE id = ?')
          .run(String(result.error || '').slice(0, 300), sub.id);
      }
    }
  } catch { /* Something already saved does not fail over its notification. */ }
  return { sent };
}

module.exports = {
  isConfigured, problem, publicKey, subject, notify, sendTo,
  // Exported for the suite, which proves the sealed record can be opened again
  // with the browser's half of the agreement. There is no other way to check
  // this short of owning a phone.
  seal, authorizationFor, MAX_PLAINTEXT,
};
