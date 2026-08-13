const db = require('./db');
const { isHouseholdStaff } = require('./household');

// Who may write to everyone.
//
// Read from the environment, not from a column. There is deliberately no way
// to grant yourself this from inside the app and nothing in the database to
// flip — the same reasoning as ENCRYPTION_KEY living outside the data it
// protects. Unset means nobody can post, and the app says so rather than
// pretending the feature is there.
const AUTHORS = new Set(
  String(process.env.ANNOUNCEMENT_AUTHORS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

const AUDIENCES = {
  everyone: 'Everyone',
  assistants: 'Assistants only',
  principals: 'Principals only',
  household: 'Household staff only',
};

const ASSISTANT_CATEGORIES = new Set(['pa', 'ea', 'chief_of_staff']);

function canPublish(user) {
  return !!user && AUTHORS.has(String(user.email || '').toLowerCase());
}

function isConfigured() {
  return AUTHORS.size > 0;
}

/**
 * Which audiences this person is in.
 *
 * Aimed rather than blasted. A notice for assistants is the thing a PA
 * actually wanted out of a community, and a principal does not need to read
 * it — so a channel nobody can mute stays worth reading.
 */
async function audiencesFor(user) {
  const list = ['everyone'];
  if (ASSISTANT_CATEGORIES.has(user.account_category)) list.push('assistants');
  if (user.account_category === 'principal') list.push('principals');
  if (await isHouseholdStaff(user.id)) list.push('household');
  return list;
}

function serialize(a, { read = false, isAuthor = false } = {}) {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    audience: a.audience,
    audienceLabel: AUDIENCES[a.audience] || a.audience,
    publishedAt: a.published_at,
    createdAt: a.created_at,
    authorName: a.author_name || null,
    read,
    ...(isAuthor ? { readCount: Number(a.read_count || 0) } : {}),
  };
}

/** Published notices this person is meant to see, newest first. */
async function listFor(user) {
  const audiences = await audiencesFor(user);
  const placeholders = audiences.map(() => '?').join(',');

  const rows = await db.prepare(`
    SELECT a.*, u.name AS author_name,
      (SELECT COUNT(*) FROM announcement_reads r
        WHERE r.announcement_id = a.id AND r.user_id = ?) AS read_by_me
    FROM announcements a
    JOIN users u ON u.id = a.author_id
    WHERE a.published_at IS NOT NULL AND a.audience IN (${placeholders})
    ORDER BY a.published_at DESC
    LIMIT 50
  `).all(user.id, ...audiences);

  return rows.map((a) => serialize(a, { read: Number(a.read_by_me) > 0 }));
}

/** The nav badge. Counting is cheap; making people hunt for what is new is not. */
async function unreadCount(user) {
  const audiences = await audiencesFor(user);
  const placeholders = audiences.map(() => '?').join(',');
  const row = await db.prepare(`
    SELECT COUNT(*) AS n FROM announcements a
    WHERE a.published_at IS NOT NULL AND a.audience IN (${placeholders})
      AND NOT EXISTS (
        SELECT 1 FROM announcement_reads r
        WHERE r.announcement_id = a.id AND r.user_id = ?
      )
  `).get(...audiences, user.id);
  return Number(row?.n || 0);
}

module.exports = {
  AUDIENCES, canPublish, isConfigured, audiencesFor, listFor, unreadCount, serialize,
};
