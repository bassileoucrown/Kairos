const db = require('./db');
const { normalizeHandle, resolveVisibleHandle } = require('./handles');

/**
 * @ as two things, and the difference must survive all the way to the screen.
 *
 * AN ADDRESS is a connected user: someone with an account who can be told.
 * Writing @ada in a thread reaches Ada, and she can answer.
 *
 * A MENTION is one of the principal's contacts: a person the office keeps a
 * record about, who usually has no account at all. "@tunde-bakare is bringing
 * the documents" is a reference in a sentence, exactly like writing the name,
 * except that it points at the record — so the reader can see who that is
 * without leaving the thread.
 *
 * THE RULE THAT MAKES BOTH SAFE: a mention must never look like an address.
 * Nobody is notified by one, and if the two rendered alike, an assistant would
 * write "@tunde will confirm" believing Tunde had been asked. So the two are
 * resolved separately here, marked separately, and drawn differently.
 *
 * A handle that resolves to neither stays as plain text. It is not an error —
 * people write "email me @ 9" — and it must not become a broken link.
 */

// Deliberately conservative at both ends.
//
// It ends at whitespace or ordinary punctuation, so "@ada," and "(@ada)" both
// find `ada`. And it must not START inside a word — without the lookbehind,
// "write to ada@example.com" finds `example`, so every email address in a
// message rendered a mention of whoever the domain happened to look like.
const TOKEN_RE = /(?<![\w.%+-])@([a-z0-9][a-z0-9-]{1,38}[a-z0-9])/gi;

/** Every @token in a body, in the order written, without duplicates. */
function parse(body) {
  const out = [];
  const seen = new Set();
  for (const m of String(body || '').matchAll(TOKEN_RE)) {
    const handle = normalizeHandle(m[1]);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    out.push(handle);
  }
  return out;
}

/**
 * A handle for a contact, derived from what the office already knows.
 *
 * Contacts are not users and have no slug of their own, so one is made from
 * the name — or the local part of the address when there is no name — and kept
 * unique within this principal's contacts. Not globally: two principals may
 * each know a different Tunde, and neither has any business colliding with the
 * other.
 */
function handleFrom(nameOrEmail) {
  const base = String(nameOrEmail || '')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 38);
  if (base.length < 3) return `c-${base}`.slice(0, 40);
  return base;
}

async function uniqueContactHandle(ownerId, desired, excludeId = null) {
  let candidate = handleFrom(desired);
  for (let n = 2; n < 200; n++) {
    const clash = await db.prepare(
      'SELECT id FROM contacts WHERE owner_id = ? AND handle = ? AND (? IS NULL OR id != ?)',
    ).get(ownerId, candidate, excludeId, excludeId);
    if (!clash) return candidate;
    candidate = `${handleFrom(desired)}-${n}`.slice(0, 40);
  }
  return `${handleFrom(desired)}-${Date.now().toString(36)}`.slice(0, 40);
}

/**
 * What each handle in a body actually points at.
 *
 * `viewerId` decides which people are addressable — the same relationship rule
 * handles have always used, so this cannot become a directory. `ownerId` is
 * the principal whose contacts are in scope, because a contact belongs to an
 * office rather than to everyone.
 */
async function resolve(viewerId, ownerId, handles) {
  const out = [];
  for (const handle of handles) {
    // A person who can answer wins over a record about somebody, because the
    // stronger promise should not be silently downgraded.
    const person = await resolveVisibleHandle(viewerId, handle);
    if (person) {
      out.push({
        handle, kind: 'person', id: person.id, name: person.name, notified: true,
      });
      continue;
    }
    const contact = ownerId ? await db.prepare(
      'SELECT id, name, email FROM contacts WHERE owner_id = ? AND handle = ?',
    ).get(ownerId, handle) : null;
    if (contact) {
      out.push({
        handle, kind: 'contact', id: contact.id,
        name: contact.name || contact.email,
        // Said explicitly rather than left to be inferred from the kind. Every
        // renderer has to make this distinction and none of them should have
        // to know the rule.
        notified: false,
      });
      continue;
    }
    out.push({ handle, kind: 'unknown', id: null, name: handle, notified: false });
  }
  return out;
}

/** Parse and resolve in one step, which is what every caller actually wants. */
async function of(body, { viewerId, ownerId }) {
  const handles = parse(body);
  if (handles.length === 0) return [];
  return resolve(viewerId, ownerId, handles);
}

module.exports = { parse, resolve, of, handleFrom, uniqueContactHandle, TOKEN_RE };
