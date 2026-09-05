const db = require('./db');
const essentials = require('./essentials');
const spaceAccess = require('./spaceAccess');
const tripPrivacy = require('./tripPrivacy');
const movement = require('./movement');

// One box that finds anything — asked as the person asking, not as the database.
//
// THE WHOLE RISK OF THIS FEATURE IS IN ONE SENTENCE. Every other screen in
// Kairos asks a narrow question of one table and the access rule sits beside
// it: the vault masks, the trip list drops what is private, a room 404s for
// somebody who is not in it. A search box asks EVERY table at once, and the
// obvious way to build one — query everything, filter the results afterwards —
// leaks by its shape even when it shows nothing. "3 results in Essentials" is
// itself the disclosure: it tells a scheduling delegate a passport exists.
//
// So there is no central query here and there never will be. Each source below
// is a small function that asks its own table THROUGH THE RULE THAT ALREADY
// GOVERNS IT — spaceAccess for rooms, tripPrivacy for trips, movement's own
// visibility clause for journeys, essentials' canSee for the vault. A source
// returns rows this viewer may see, and rows they may not see are absent
// rather than counted. That is the same rule the rest of the codebase follows,
// and this file's only job is to not be the exception.
//
// WHAT IS DELIBERATELY NOT SEARCHABLE:
//
//   The VALUE of anything in the vault. A search that returned
//   "Passport •••• 2347" would turn a deliberate act — one that costs a second
//   factor and is written to the principal's custody trail — into a side
//   effect of typing. Search finds the ENTRY and takes you to it; opening it
//   still costs what it costs. The same goes for a document: the filename is
//   findable, the bytes are not.
//
//   The contents of a document. Nothing here reads a PDF.
//
//   Anything at all for somebody with no standing on the account. The route
//   requires PA access before a single source runs.

/** Two characters is not a search, it is a load test. */
const MIN_TERM = 2;
/** Per source, so one noisy table cannot crowd out the rest of the answer. */
const PER_SOURCE = 6;

/**
 * LIKE, lower-cased on both sides.
 *
 * Postgres LIKE is case-sensitive and SQLite's is not, so a query written the
 * obvious way finds "Passport" on one backend and not the other — the exact
 * shape of difference that reaches main because only one board was run. Doing
 * it in SQL rather than with ILIKE keeps one statement for both.
 */
const like = (col) => `LOWER(${col}) LIKE ?`;
const term = (t) => `%${String(t).toLowerCase().trim()}%`;

/** Trim a body down to something that fits on one line of a result. */
function snippet(text, t, width = 90) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= width) return s;
  const at = s.toLowerCase().indexOf(String(t).toLowerCase().trim());
  if (at < 0) return `${s.slice(0, width)}…`;
  const from = Math.max(0, at - 25);
  return `${from > 0 ? '…' : ''}${s.slice(from, from + width)}…`;
}

// ── The sources ────────────────────────────────────────────────────────────
//
// Each one: an id, what to call the group on screen, and a find() that is
// handed { q, like, ownerId, viewerId, paRole, isOwner } and returns hits.
// A hit is { id, title, detail, href } — never a value, never a body that the
// screen it came from would have masked.

const SOURCES = [
  {
    id: 'people',
    label: 'People',
    async find({ q, ownerId }) {
      const rows = await db.prepare(`
        SELECT id, name, email, relationship_tier FROM contacts
         WHERE owner_id = ? AND (${like('name')} OR ${like('email')} OR ${like('notes')})
         ORDER BY name LIMIT ${PER_SOURCE}
      `).all(ownerId, term(q), term(q), term(q));
      return rows.map((r) => ({
        id: r.id,
        title: r.name || r.email,
        detail: [r.email, String(r.relationship_tier || '').replace('_', ' ')]
          .filter(Boolean).join(' · '),
        href: '/dashboard?tab=contacts',
      }));
    },
  },
  {
    id: 'appointments',
    label: 'Appointments',
    async find({ q, ownerId }) {
      const rows = await db.prepare(`
        SELECT b.id, b.booker_name, b.booker_email, b.start_at, b.status, mt.name AS type_name
          FROM bookings b
          JOIN meeting_types mt ON mt.id = b.meeting_type_id
         WHERE b.owner_id = ?
           AND (${like('b.booker_name')} OR ${like('b.booker_email')} OR ${like('mt.name')})
         ORDER BY b.start_at DESC LIMIT ${PER_SOURCE}
      `).all(ownerId, term(q), term(q), term(q));
      return rows.map((r) => ({
        id: r.id,
        title: `${r.booker_name} · ${r.type_name}`,
        detail: `${r.start_at.slice(0, 16).replace('T', ' ')}${r.status === 'confirmed' ? '' : ` · ${r.status}`}`,
        href: `/appointments/${ownerId}/${r.id}`,
      }));
    },
  },
  {
    id: 'itinerary',
    label: 'The day',
    async find({ q, ownerId }) {
      const rows = await db.prepare(`
        SELECT id, title, location, start_at, kind FROM itinerary_items
         WHERE owner_id = ? AND (${like('title')} OR ${like('location')})
         ORDER BY start_at DESC LIMIT ${PER_SOURCE}
      `).all(ownerId, term(q), term(q));
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        detail: [r.start_at.slice(0, 10), r.location].filter(Boolean).join(' · '),
        href: '/itinerary',
      }));
    },
  },
  {
    id: 'trips',
    label: 'Trips',
    // A PERSONAL TRIP IS OFFLINE TO THE OFFICE. tripPrivacy decides that
    // everywhere else and decides it here; the ids it hides are dropped after
    // the query rather than counted, so a search for the city somebody is
    // quietly in comes back empty rather than "1 result you cannot open".
    async find({ q, ownerId, viewerId }) {
      const hidden = await tripPrivacy.hiddenTripIds(ownerId, viewerId);
      const rows = await db.prepare(`
        SELECT id, name, destination, starts_on, ends_on, status FROM trips
         WHERE owner_id = ? AND (${like('name')} OR ${like('destination')})
         ORDER BY starts_on DESC LIMIT ${PER_SOURCE * 3}
      `).all(ownerId, term(q), term(q));
      return rows.filter((r) => !hidden.has(r.id)).slice(0, PER_SOURCE).map((r) => ({
        id: r.id,
        title: r.name,
        detail: [r.destination, `${r.starts_on} → ${r.ends_on}`].filter(Boolean).join(' · '),
        href: `/trips?trip=${r.id}`,
      }));
    },
  },
  {
    id: 'movements',
    label: 'Movements',
    // The same clause the Movements list itself is built from, so a journey
    // that is not on that screen is not in this answer either.
    async find({ q, viewerId }) {
      const rows = await db.prepare(`
        SELECT m.id, m.title, m.destination, m.departs_at FROM movements m
         WHERE ${movement.visibleWhere('m')}
           AND (${like('m.title')} OR ${like('m.destination')})
         ORDER BY m.departs_at DESC LIMIT ${PER_SOURCE}
      `).all(...movement.visibleParams(viewerId), term(q), term(q));
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        detail: [r.destination, String(r.departs_at || '').slice(0, 16).replace('T', ' ')]
          .filter(Boolean).join(' · '),
        href: `/movements?tab=journeys&movement=${r.id}`,
      }));
    },
  },
  {
    id: 'rooms',
    label: 'Rooms',
    async find({ q, viewerId }) {
      const spaces = await spaceAccess.listVisibleSpaces(viewerId);
      if (!spaces.length) return [];
      const ids = spaces.map((s) => s.id);
      const holes = ids.map(() => '?').join(',');
      const rows = await db.prepare(`
        SELECT t.id, t.name, t.space_id, s.name AS space_name
          FROM threads t JOIN spaces s ON s.id = t.space_id
         WHERE t.space_id IN (${holes}) AND ${like('t.name')}
         ORDER BY t.created_at DESC LIMIT ${PER_SOURCE}
      `).all(...ids, term(q));
      return rows.map((r) => ({
        id: r.id,
        title: r.name,
        detail: r.space_name,
        href: `/threads/${r.id}`,
      }));
    },
  },
  {
    id: 'said',
    label: 'What was said',
    // MESSAGES ARE THE SHARPEST SOURCE HERE, because a room is where somebody
    // writes the thing they would not put in a field. Scoped to the spaces
    // this viewer is actually in — the same list the Spaces screen is drawn
    // from — and to nothing else.
    async find({ q, viewerId }) {
      const spaces = await spaceAccess.listVisibleSpaces(viewerId);
      if (!spaces.length) return [];
      const ids = spaces.map((s) => s.id);
      const holes = ids.map(() => '?').join(',');
      const rows = await db.prepare(`
        SELECT m.id, m.body, m.thread_id, m.created_at, t.name AS thread_name, t.space_id
          FROM messages m
          JOIN threads t ON t.id = m.thread_id
         WHERE t.space_id IN (${holes}) AND ${like('m.body')}
         ORDER BY m.created_at DESC LIMIT ${PER_SOURCE}
      `).all(...ids, term(q));
      return rows.map((r) => ({
        id: r.id,
        title: snippet(r.body, q),
        detail: `${r.thread_name} · ${String(r.created_at).slice(0, 10)}`,
        href: `/threads/${r.thread_id}#m-${r.id}`,
      }));
    },
  },
  {
    id: 'tasks',
    label: 'Tasks',
    async find({ q, viewerId }) {
      const spaces = await spaceAccess.listVisibleSpaces(viewerId);
      if (!spaces.length) return [];
      const ids = spaces.map((s) => s.id);
      const holes = ids.map(() => '?').join(',');
      const rows = await db.prepare(`
        SELECT k.id, k.title, k.status, k.due_at, k.space_id FROM tasks k
         WHERE k.space_id IN (${holes}) AND ${like('k.title')}
         ORDER BY k.created_at DESC LIMIT ${PER_SOURCE}
      `).all(...ids, term(q));
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        detail: [r.status, r.due_at ? `due ${String(r.due_at).slice(0, 10)}` : '']
          .filter(Boolean).join(' · '),
        href: '/tasks',
      }));
    },
  },
  {
    id: 'projects',
    label: 'Projects',
    async find({ q, viewerId }) {
      const spaces = await spaceAccess.listVisibleSpaces(viewerId);
      if (!spaces.length) return [];
      const ids = spaces.map((s) => s.id);
      const holes = ids.map(() => '?').join(',');
      const rows = await db.prepare(`
        SELECT p.id, p.name, p.status, p.space_id FROM projects p
         WHERE p.space_id IN (${holes}) AND ${like('p.name')}
         ORDER BY p.created_at DESC LIMIT ${PER_SOURCE}
      `).all(...ids, term(q));
      return rows.map((r) => ({
        id: r.id, title: r.name, detail: r.status, href: `/projects/${r.id}`,
      }));
    },
  },
  {
    id: 'pad',
    label: 'The pad',
    // A private line is the author's own. An office line is the principal's
    // desk. A line handed to somebody is theirs whatever the visibility says —
    // the same three rules pad.js applies, because a note found by search that
    // its own screen would not show is the leak in miniature.
    async find({ q, ownerId, viewerId }) {
      const rows = await db.prepare(`
        SELECT id, body, state, owner_id, visibility FROM pad_items
         WHERE ${like('body')}
           AND (
             author_user_id = ?
             OR assignee_id = ?
             OR (owner_id = ? AND visibility = 'office')
           )
         ORDER BY created_at DESC LIMIT ${PER_SOURCE}
      `).all(term(q), viewerId, viewerId, ownerId);
      return rows.map((r) => ({
        id: r.id,
        title: snippet(r.body, q),
        detail: r.visibility === 'office' ? 'On the office pad' : 'Private',
        href: '/pad',
      }));
    },
  },
  {
    id: 'essentials',
    label: 'Essentials',
    // THE LABEL, NEVER THE VALUE. Finding that a passport is on file is not
    // the same act as reading the number, and this returns only the first.
    // Filtered on the entry's own sensitivity by the vault's own function, so
    // a scheduling delegate searching "passport" finds nothing rather than
    // finding that there is something they cannot have.
    async find({ q, ownerId, paRole, isOwner }) {
      const rows = await db.prepare(`
        SELECT id, label, category, field, sensitivity, expires_on FROM essentials
         WHERE owner_id = ? AND archived_at IS NULL AND (${like('label')} OR ${like('notes')})
         ORDER BY label LIMIT ${PER_SOURCE * 3}
      `).all(ownerId, term(q), term(q));
      return rows
        .filter((r) => essentials.canSee(r.sensitivity, { isOwner, role: paRole }))
        .slice(0, PER_SOURCE)
        .map((r) => ({
          id: r.id,
          title: r.label,
          detail: r.expires_on ? `Expires ${r.expires_on}` : 'In the vault',
          href: `/dashboard?tab=essentials&essential=${r.id}`,
        }));
    },
  },
  {
    id: 'documents',
    label: 'Documents',
    // The filename, not the file. And filtered on the DOCUMENT'S sensitivity
    // rather than its entry's, because a scan can be stricter than the field
    // it hangs on — see flagFor in lib/documents.js.
    async find({ q, ownerId, paRole, isOwner }) {
      const rows = await db.prepare(`
        SELECT d.id, d.filename, d.format, d.sensitivity, d.essential_id, e.label
          FROM documents d
          JOIN essentials e ON e.id = d.essential_id
         WHERE d.owner_id = ? AND ${like('d.filename')}
         ORDER BY d.created_at DESC LIMIT ${PER_SOURCE * 3}
      `).all(ownerId, term(q));
      return rows
        .filter((r) => essentials.canSee(r.sensitivity, { isOwner, role: paRole }))
        .slice(0, PER_SOURCE)
        .map((r) => ({
          id: r.id,
          title: r.filename,
          detail: `On ${r.label}`,
          href: `/dashboard?tab=essentials&essential=${r.essential_id}`,
        }));
    },
  },
  {
    id: 'archive',
    label: 'The archive',
    // The same bar the archive route sets: what was saved out of a room about
    // to close arrives stripped of the membership that used to protect it, so
    // it sits behind the sensitive gate rather than behind nothing.
    async find({ q, ownerId, paRole, isOwner }) {
      if (!essentials.canSee('sensitive', { isOwner, role: paRole })) return [];
      const rows = await db.prepare(`
        SELECT id, body, note, thread_name, said_by_name FROM kept_items
         WHERE owner_id = ? AND (${like('body')} OR ${like('note')})
         ORDER BY kept_at DESC LIMIT ${PER_SOURCE}
      `).all(ownerId, term(q), term(q));
      return rows.map((r) => ({
        id: r.id,
        title: snippet(r.body, q),
        detail: [r.said_by_name, r.thread_name].filter(Boolean).join(' · '),
        href: '/archive',
      }));
    },
  },
];

const IDS = SOURCES.map((s) => s.id);

/**
 * Ask every source, and hand back only what came out of them.
 *
 * ONE SOURCE FAILING IS NOT THE SEARCH FAILING. A table that does not exist
 * on an older database, or a query that throws on one backend, should cost
 * that group and not the whole answer — a search box that returns a 500
 * because the archive is empty teaches people to stop using it. What it must
 * NOT do is fail open, so a source that throws contributes nothing rather
 * than contributing unfiltered rows.
 */
async function run(q, ctx) {
  const clean = String(q || '').trim();
  if (clean.length < MIN_TERM) {
    return { term: clean, groups: [], total: 0, failed: [], tooShort: true };
  }

  const groups = [];
  const failed = [];
  let total = 0;
  for (const source of SOURCES) {
    let hits = [];
    try {
      hits = await source.find({ ...ctx, q: clean });
    } catch (err) {
      hits = [];
      // REPORTED, NOT ONLY LOGGED. Swallowing keeps one broken source from
      // taking down the whole answer, which is right — but a source that
      // silently contributes nothing is indistinguishable from a source with
      // nothing to contribute, and that is how a query broken by a renamed
      // column goes unnoticed for a month. A search that has quietly stopped
      // asking the vault is worse than one that says it could not.
      failed.push(source.id);
      console.error(`search: ${source.id} failed — ${err.message}`);
    }
    if (hits.length) {
      groups.push({ id: source.id, label: source.label, hits });
      total += hits.length;
    }
  }
  return { term: clean, groups, total, failed, tooShort: false };
}

module.exports = { SOURCES, IDS, MIN_TERM, PER_SOURCE, run, snippet };
