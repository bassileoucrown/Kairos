const db = require('./db');
const { clientIp } = require('./rateLimit');

// Where this account is signed in, and the ability to end any of it.
//
// Multi-device already worked: a session is a row, signing in on a second
// device writes a second row, and nothing ever limited how many. What did not
// exist was any way to SEE them or to END one. "Sign out" deleted the row for
// the browser it was pressed in, so a lost phone kept a live session for the
// remainder of its thirty days, and the only lever was a password reset —
// which is a sledgehammer, and which somebody in an airport will not think of.
//
// REVOCATION IS INSTANT, and that is a property of the existing design rather
// than anything added here. Every request re-reads the session row (see
// getUserBySession in lib/auth.js); there is no cache and no stateless token.
// Delete the row and the next request from that device is a 401. Had sessions
// been JWTs this would have needed a blocklist, and a stolen token would have
// stayed good until it expired.
//
// WHAT IS RECORDED, AND WHAT IS NOT
//
// The user agent, the address the request came from, and when it was last
// seen. That is what the request itself carries. There is deliberately no
// city: turning an address into a place needs either a geo-IP dataset we do
// not ship or a call to somebody else's lookup service, and the second one
// hands a third party a running log of where a principal has been — which is
// the opposite of what this application is for. It is registered as an unbuilt
// capability instead, awaiting GEOIP_DB. See lib/capabilities.js.

// Last-seen is written at most this often per session. Updating on every
// request would add a write to every single API call to buy a precision
// nobody reads — "last active 3 minutes ago" and "last active just now" mean
// the same thing to the person deciding whether to end a session.
const TOUCH_EVERY_MS = Number(process.env.SESSION_TOUCH_MS || 5 * 60 * 1000);

// How long a vouched-for device stays signed in, and the fact that it slides.
//
// An ordinary session gets thirty days from the moment it was created and then
// ends, whatever you were in the middle of. That is right for a borrowed laptop
// and wrong for the phone in somebody's pocket — which is why people tick the
// remember-me box on every site that offers one. Being signed out of your own
// diary every month is not security; it is an interruption you learn to resent.
//
// So a trusted session is renewed each time it is used. Stop using it and it
// still lapses; keep using it and it does not.
//
// The reason this is safe to offer at all is that revocation now exists and is
// instant. A longer life is only a liability when you cannot end it, and this
// one can be ended from any other device you are holding.
const TRUSTED_TTL_MS = Number(process.env.TRUSTED_SESSION_TTL_MS || 180 * 24 * 60 * 60 * 1000);

/**
 * A device in the words somebody would use for it, from the user agent.
 *
 * Deliberately coarse. The point is recognition — "that is my phone", "that is
 * not my laptop" — and a full version string helps nobody make that call.
 * Order matters in both lists: Edge and Chrome both say "Chrome", and iPadOS
 * says "Macintosh".
 */
function describe(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'Unknown device';

  const browser = ua.includes('Edg/') ? 'Edge'
    : ua.includes('OPR/') || ua.includes('Opera') ? 'Opera'
      : ua.includes('Firefox/') ? 'Firefox'
        : ua.includes('Chrome/') ? 'Chrome'
          : ua.includes('Safari/') ? 'Safari'
            : null;

  const platform = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
      : /Android/.test(ua) ? 'Android'
        : /Windows/.test(ua) ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
            : /Linux/.test(ua) ? 'Linux'
              : null;

  if (browser && platform) return `${browser} on ${platform}`;
  if (platform) return platform;
  if (browser) return browser;
  return 'Unknown device';
}

/** Stamp a session with what this request knows about it. Cheap and throttled. */
async function touch(sessionId, req) {
  if (!sessionId) return;
  try {
    const row = await db.prepare('SELECT last_seen_at, trusted_at FROM sessions WHERE id = ?').get(sessionId);
    if (!row) return;
    if (row.last_seen_at && Date.now() - new Date(row.last_seen_at).getTime() < TOUCH_EVERY_MS) {
      return;
    }
    const now = new Date();
    await db.prepare('UPDATE sessions SET last_seen_at = ?, last_ip = ?, user_agent = ? WHERE id = ?')
      .run(
        now.toISOString(),
        clientIp(req),
        String(req.headers['user-agent'] || '').slice(0, 400),
        sessionId,
      );

    // A trusted device's clock is pushed forward every time it is used, so it
    // lapses after it stops being used rather than on a fixed date.
    if (row.trusted_at) {
      await db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
        .run(new Date(now.getTime() + TRUSTED_TTL_MS).toISOString(), sessionId);
    }
  } catch {
    // Recording where somebody signed in is never worth failing their request
    // over. A missing last-seen is a cosmetic gap; a 500 on every page is not.
  }
}

/** Record what we know at the moment a session is created. */
async function stamp(sessionId, req) {
  if (!sessionId || !req) return;
  try {
    await db.prepare('UPDATE sessions SET last_seen_at = ?, last_ip = ?, user_agent = ? WHERE id = ?')
      .run(
        new Date().toISOString(),
        clientIp(req),
        String(req.headers['user-agent'] || '').slice(0, 400),
        sessionId,
      );
  } catch { /* as above */ }
}

/** Every live session on this account, the current one marked and first. */
async function list(userId, currentSessionId) {
  const rows = await db.prepare(`
    SELECT id, created_at, expires_at, last_seen_at, last_ip, user_agent, trusted_at
    FROM sessions
    WHERE user_id = ? AND expires_at > ?
    ORDER BY COALESCE(last_seen_at, created_at) DESC
  `).all(userId, new Date().toISOString());

  return rows.map((r) => ({
    // The session id IS the bearer credential in the cookie, so it never
    // leaves the server. A short opaque handle is enough to revoke by, and is
    // useless to anybody who intercepts this list.
    id: handleFor(r.id),
    isCurrent: r.id === currentSessionId,
    device: describe(r.user_agent),
    address: r.last_ip || null,
    lastSeenAt: r.last_seen_at || r.created_at,
    signedInAt: r.created_at,
    expiresAt: r.expires_at,
    trusted: !!r.trusted_at,
  })).sort((a, b) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0));
}

/**
 * A stable, non-secret handle for a session.
 *
 * Listing raw session ids would put a working credential for every one of the
 * principal's devices into a JSON response — which is then in a browser cache,
 * a proxy log, and whatever else reads it. The first twelve characters
 * identify a row without being usable as one.
 */
function handleFor(sessionId) {
  return String(sessionId).slice(0, 12);
}

async function findByHandle(userId, handle) {
  const rows = await db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(userId);
  return rows.find((r) => handleFor(r.id) === String(handle)) || null;
}

/** End one session. Returns false when it is not this account's to end. */
async function revoke(userId, handle) {
  const row = await findByHandle(userId, handle);
  if (!row) return false;
  await db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(row.id, userId);
  return true;
}

/** End every session except the one asking. Returns how many went. */
async function revokeOthers(userId, keepSessionId) {
  const before = await db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND id != ?')
    .get(userId, keepSessionId || '');
  await db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
    .run(userId, keepSessionId || '');
  return before?.n || 0;
}

/**
 * Vouch for the device in your hand, or stop vouching for it.
 *
 * Only ever the current session. You cannot declare somebody else's device
 * trustworthy, and the phone you have lost is not there to be untrusted from —
 * that one gets revoked instead, which is stronger.
 */
async function setTrust(userId, sessionId, trusted) {
  if (!sessionId) return false;
  const row = await db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, userId);
  if (!row) return false;

  if (trusted) {
    await db.prepare('UPDATE sessions SET trusted_at = ?, expires_at = ? WHERE id = ?')
      .run(
        new Date().toISOString(),
        new Date(Date.now() + TRUSTED_TTL_MS).toISOString(),
        sessionId,
      );
  } else {
    // Withdrawing trust does not end the session — it puts it back on the
    // ordinary clock. Ending it is Sign out, and that is a different button.
    await db.prepare('UPDATE sessions SET trusted_at = NULL WHERE id = ?').run(sessionId);
  }
  return true;
}

module.exports = {
  describe, touch, stamp, list, revoke, revokeOthers, handleFor, findByHandle, setTrust,
  TRUSTED_TTL_MS,
};
