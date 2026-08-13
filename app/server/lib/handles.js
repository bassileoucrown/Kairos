const db = require('./db');

// A person's handle.
//
// This is the existing `slug` column, promoted from "the last part of your
// booking URL" to "what you are called here". Same value, different standing:
// a principal is @ada, and their booking page happens to live at
// /book/@ada — not the other way round.
//
// Deliberately NOT a global directory. Kairos is built on compartments —
// drafts invisible to the principal, spaces that return 404 rather than 403 —
// and a handle that resolves for anyone would quietly undo that. A handle
// only means something inside a relationship that already exists; look one up
// that you have no connection to and you get nothing back, indistinguishable
// from a typo. Establishing a new relationship still goes through an email
// invitation, because that is an act and should feel like one.

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

// Names nobody may claim: the app's own paths, the ones people would
// impersonate, and the ones we may want later. Cheaper to reserve now than to
// take back from someone who has printed it on a card.
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'superuser', 'owner', 'system',
  'kairos', 'exousia', 'support', 'help', 'security', 'billing', 'legal',
  'api', 'app', 'www', 'mail', 'email', 'static', 'assets', 'public',
  'book', 'booking', 'bookings', 'login', 'logout', 'signup', 'signin',
  'today', 'itinerary', 'workspace', 'spaces', 'projects', 'tasks',
  'dashboard', 'settings', 'profile', 'account', 'accounts', 'team',
  'invite', 'invites', 'accept-invite', 'reset-password', 'forgot-password',
  'threads', 'members', 'essentials', 'pa', 'ea', 'me', 'you', 'null',
  'undefined', 'true', 'false', 'new', 'edit', 'delete',
]);

/** Accepts "@ada", "ada", " @Ada " — all the ways someone might type one. */
function normalizeHandle(input) {
  return String(input || '').trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Why a handle is unacceptable, or null if it is fine. Returns prose, since
 * every caller shows it to a person.
 */
function handleProblem(handle) {
  if (!handle) return 'Choose a handle.';
  if (handle.length < 3) return 'A handle needs at least 3 characters.';
  if (handle.length > 40) return 'A handle can be at most 40 characters.';
  if (!HANDLE_RE.test(handle)) {
    return 'Use letters, numbers and hyphens only, starting and ending with a letter or number.';
  }
  if (RESERVED.has(handle)) return 'That handle is reserved.';
  return null;
}

/**
 * Resolve a handle to a person the caller already has a relationship with.
 *
 * Returns null for a handle that exists but is a stranger, exactly as for one
 * that does not exist at all — so this can never be used to test whether
 * somebody is on Kairos.
 */
async function resolveVisibleHandle(viewerId, rawHandle) {
  const handle = normalizeHandle(rawHandle);
  if (handleProblem(handle)) return null;

  const person = await db.prepare('SELECT id, name, slug, account_category FROM users WHERE slug = ?')
    .get(handle);
  if (!person) return null;
  if (person.id === viewerId) return person;

  // Connected if either supports the other, they share a space, or they have
  // accepted a peer connection. The last one is the only route to a handle
  // resolving for someone outside your own principal's orbit, and it took
  // both of them agreeing to it.
  const related = await db.prepare(`
    SELECT 1 FROM memberships
     WHERE status = 'active'
       AND ((owner_id = ? AND member_user_id = ?) OR (owner_id = ? AND member_user_id = ?))
    UNION ALL
    SELECT 1 FROM space_members a
      JOIN space_members b ON a.space_id = b.space_id
     WHERE a.user_id = ? AND b.user_id = ?
    UNION ALL
    SELECT 1 FROM connections
     WHERE status = 'accepted'
       AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
    LIMIT 1
  `).get(
    viewerId, person.id, person.id, viewerId,
    viewerId, person.id,
    viewerId, person.id, person.id, viewerId,
  );

  return related ? person : null;
}

module.exports = { normalizeHandle, handleProblem, resolveVisibleHandle, RESERVED };
