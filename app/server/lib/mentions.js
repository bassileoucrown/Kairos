const db = require('./db');
const { normalizeHandle, resolveVisibleHandle } = require('./handles');
const { knock } = require('./knock');

/**
 * @ as two things, and the difference must survive all the way to the screen.
 *
 * AN ADDRESS is a connected user: someone with an account who can be told.
 * Writing @ada in a thread reaches Ada, and she can answer.
 *
 * A MENTION is one of the principal's contacts who turns out to be on Kairos,
 * written by the username THEY chose, but whom this reader cannot address —
 * no shared space, no accepted connection. Naming them points at the office's
 * record of them; it reaches nobody.
 *
 * Nobody else has a username here, and none is invented for them. A username
 * is made by the person it belongs to, so a contact with no Kairos account
 * cannot be written after an @ at all — @ada stays plain text, which is the
 * truth: there is no @ada.
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
 * A CONTACT DOES NOT GET A USERNAME OF ITS OWN.
 *
 * This used to derive one from the name — Tunde Bakare became @tunde-bakare —
 * so that any contact could be written after an @. That was wrong, and wrong
 * in a way worth naming: a username is made by the person it belongs to.
 * Minting one on somebody's behalf, from a record they never saw, in an office
 * they may not know exists, invents an identity for them. Two offices would
 * have coined two different names for the same person, and neither would be
 * what that person called themselves if they ever signed up.
 *
 * So a contact's handle is now looked up rather than made: if the address
 * belongs to a Kairos account, it is THAT account's handle, chosen by them. If
 * it belongs to nobody, there is no handle, and none is invented.
 */
async function contactHandle(ownerId, contactId) {
  const row = await db.prepare(`
    SELECT u.slug FROM contacts c
    JOIN users u ON lower(u.email) = lower(c.email)
    WHERE c.id = ? AND c.owner_id = ?
  `).get(contactId, ownerId);
  return row?.slug || null;
}

/**
 * What each handle in a body actually points at.
 *
 * `viewerId` decides which people are addressable — the same relationship rule
 * handles have always used, so this cannot become a directory. `ownerId` is
 * the principal whose contacts are in scope, because a contact belongs to an
 * office rather than to everyone.
 *
 * `audience`, when given, is the set of user ids who can actually see the
 * thing being written. Somebody outside it is still a real person and still
 * worth naming, but they are NOT told, because they cannot read what they
 * would be told about. Writing @ada in a space Ada has no access to must not
 * draw like a delivered address — that is the same lie as a contact drawn like
 * a user, arriving by a different road. Omit it where there is no such
 * boundary and everyone who resolves is reachable.
 */
async function resolve(viewerId, ownerId, handles, audience = null) {
  const out = [];
  for (const handle of handles) {
    // A person who can answer wins over a record about somebody, because the
    // stronger promise should not be silently downgraded.
    const person = await resolveVisibleHandle(viewerId, handle);
    if (person) {
      const reachable = !audience || audience.has(person.id);
      out.push({
        handle,
        kind: 'person',
        id: person.id,
        name: person.name,
        notified: reachable,
        // Only ever set when the answer is no, so a renderer that ignores it
        // simply draws the quieter form rather than inventing a reason.
        reason: reachable ? null : 'no-access',
      });
      continue;
    }
    // Not "a contact whose handle is this" — a contact whose ADDRESS belongs to
    // the account that owns this handle. The username is the account holder's;
    // the contact record is only this office's note about the same person.
    const contact = ownerId ? await db.prepare(`
      SELECT c.id, c.name, c.email FROM contacts c
      JOIN users u ON lower(u.email) = lower(c.email)
      WHERE c.owner_id = ? AND u.slug = ?
    `).get(ownerId, handle) : null;
    if (contact) {
      out.push({
        handle, kind: 'contact', id: contact.id,
        name: contact.name || contact.email,
        // Said explicitly rather than left to be inferred from the kind. Every
        // renderer has to make this distinction and none of them should have
        // to know the rule.
        notified: false,
        // They have an account — that is how the username exists at all. What
        // they do not have is any way to see this, so naming them tells them
        // nothing.
        reason: 'not-connected',
      });
      continue;
    }
    out.push({
      handle, kind: 'unknown', id: null, name: handle, notified: false, reason: null,
    });
  }
  return out;
}

/** Parse and resolve in one step, which is what every caller actually wants. */
async function of(body, { viewerId, ownerId, audience = null }) {
  const handles = parse(body);
  if (handles.length === 0) return [];
  return resolve(viewerId, ownerId, handles, audience);
}

/**
 * The same, for many bodies at once.
 *
 * A thread is read whole, and resolving each message on its own turns one
 * screen into a query per @ per message. The handles repeat heavily — a thread
 * about a trip says @tunde-bakare a dozen times — so they are gathered, looked
 * up once, and handed back per body.
 */
async function forBodies(bodies, { viewerId, ownerId, audience = null }) {
  const perBody = bodies.map((b) => parse(b));
  const all = [...new Set(perBody.flat())];
  if (all.length === 0) return perBody.map(() => []);
  const resolved = await resolve(viewerId, ownerId, all, audience);
  const byHandle = new Map(resolved.map((m) => [m.handle, m]));
  return perBody.map((handles) => handles.map((h) => byHandle.get(h)).filter(Boolean));
}

/**
 * Tell the people who were addressed.
 *
 * This is the entire difference between an address and a mention, so it lives
 * in one place rather than once per screen that has a text box. Four rules,
 * each of them a promise the rendering has already made on this function's
 * behalf:
 *
 *   - only people the resolver marked `notified`, which already means they can
 *     see the thing they were named in;
 *   - never the author, who does not need telling what they just wrote;
 *   - the text is NOT quoted. A thread, an instruction and a brief can each
 *     hold anything, and Kairos does not push their contents into an inbox. It
 *     says where to look;
 *   - failing here does not fail the write. The thing is already saved, and a
 *     mail provider having a bad afternoon is not a reason to reject a
 *     sentence somebody has written.
 */
async function notify({ found, author, ownerId, subject, where, url = '/today' }) {
  try {
    const addressed = (found || []).filter(
      (m) => m.kind === 'person' && m.notified && m.id !== author.id,
    );
    for (const person of addressed) {
      // Through lib/knock.js, which reaches an inbox AND a phone. This was an
      // email and only an email; being named in a thread is exactly the thing
      // somebody needs to hear about before tomorrow morning.
      await knock({
        toUserId: person.id,
        ownerId,
        author,
        subject,
        line: `wrote to you in ${where}.`,
        url,
      });
    }
  } catch { /* Said above: something already saved does not fail over its mail. */ }
}

module.exports = {
  parse, resolve, of, forBodies, notify, contactHandle, TOKEN_RE,
};
