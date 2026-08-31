const crypto = require('crypto');
const db = require('./db');
const { sendEmail } = require('./email');
const { formatForEmail } = require('./format');
const { knock } = require('./knock');

/**
 * What is said about an appointment, and to whom.
 *
 * THE ONE RULE. A booking's manage link asks for no password — holding
 * /book/manage/<id> is what makes somebody the booker. So everything the
 * booker's side can reach is, in effect, public to anyone that link is
 * forwarded to. The office's own preparation must therefore never travel on
 * the same rail as a message written for the booker.
 *
 * The filter lives HERE, in one function, rather than in each route. A route
 * that forgets a WHERE clause leaks a principal's private prep to a stranger,
 * and that is not a mistake to leave available: `forBooker` cannot return an
 * office note, because it does not ask for one.
 */

const VISIBILITIES = new Set(['office', 'shared']);
// note     — preparation, written before: what the principal needs walking in.
// minute   — the account of what happened, written after, by whoever was there.
// dictation— what somebody said into their phone walking out of the room.
//
// A DICTATION IS NOT A MINUTE and is deliberately its own kind. It is raw: a
// half-sentence, a name mispronounced, "he'll come back to us on the second
// thing". It is material FOR a minute, and filing it as one would put an
// unedited ramble into the office's formal record of a meeting.
const KINDS = new Set(['note', 'minute', 'dictation']);

/** Everything about this appointment — both registers. Office eyes only. */
async function forOffice(ownerId, bookingId) {
  return db.prepare(`
    SELECT n.*, u.name AS author_name
      FROM booking_notes n
      LEFT JOIN users u ON u.id = n.author_user_id
     WHERE n.booking_id = ? AND n.owner_id = ?
     ORDER BY n.created_at ASC
  `).all(bookingId, ownerId);
}

/**
 * What the booker may see: shared notes only.
 *
 * Takes no ownerId, because the booking id is the whole credential on that
 * side and adding one would only invite a caller to pass the wrong thing.
 */
async function forBooker(bookingId) {
  return db.prepare(`
    SELECT n.id, n.body, n.created_at, n.author_user_id, u.name AS author_name
      FROM booking_notes n
      LEFT JOIN users u ON u.id = n.author_user_id
     WHERE n.booking_id = ? AND n.visibility = 'shared'
     ORDER BY n.created_at ASC
  `).all(bookingId);
}

function serialize(n) {
  return {
    id: n.id,
    body: n.body,
    visibility: n.visibility || 'shared',
    kind: n.kind || 'note',
    // Said on the note itself. Six months later "did a machine write this"
    // is a question about one specific document, and there is no way to work
    // it out after the fact if it was not recorded at the time.
    draftedByAi: !!n.drafted_by_ai,
    // The booker has no account, so an absent author is the booker rather than
    // an unknown. Said as a name so no screen has to work it out.
    authorName: n.author_name || null,
    fromBooker: !n.author_user_id,
    createdAt: n.created_at,
  };
}

async function add({ bookingId, ownerId, visibility, authorUserId = null, body, kind = 'note', draftedByAi = false }) {
  const text = String(body || '').trim();
  if (!text) return { ok: false, status: 400, error: 'Write something first.' };
  if (!VISIBILITIES.has(visibility)) {
    return { ok: false, status: 400, error: 'A note is either for the office or for the booker.' };
  }
  if (!KINDS.has(kind)) {
    return { ok: false, status: 400, error: 'That is not something that can be written on an appointment.' };
  }
  // THE INVARIANT forBooker RELIES ON. Minutes are the office's account of a
  // meeting, frequently candid about the person who was in it, and forBooker
  // returns shared notes — so a minute that was ever allowed to be shared would
  // be a minute handed to its subject through a link they can forward. Forced
  // here rather than validated, because the caller has no business having an
  // opinion about it.
  const seenBy = kind === 'minute' || kind === 'dictation' ? 'office' : visibility;
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO booking_notes
      (id, booking_id, owner_id, visibility, kind, author_user_id, body, drafted_by_ai, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, bookingId, ownerId, seenBy, kind, authorUserId, text.slice(0, 4000),
    draftedByAi ? 1 : 0, new Date().toISOString());
  const row = await db.prepare(`
    SELECT n.*, u.name AS author_name FROM booking_notes n
    LEFT JOIN users u ON u.id = n.author_user_id WHERE n.id = ?
  `).get(id);
  return { ok: true, note: serialize(row) };
}

/**
 * A word to the booker after the meeting.
 *
 * Deliberately its own function rather than "a shared note that happens to be
 * sent". A follow-up is the one note somebody is waiting on — what was agreed,
 * what is owed, who does what next — so it must actually reach them, which is
 * why it mails at all.
 *
 * THE WORDS STAY IN THE LINE; THE EMAIL IS THE KNOCK. An earlier version put
 * the text in the email, on the reasoning that the booker has no cause to
 * revisit a page. That was wrong twice over. It contradicts how the rest of
 * Kairos treats a conversation — a mention never quotes a thread into an
 * inbox — and, worse, an email carrying the message invites an email REPLY,
 * which lands in the owner's mailbox and leaves the product entirely. The
 * office then has half a conversation in Kairos and half in Outlook.
 *
 * A link keeps it in one place, in order, beside the appointment it is about,
 * and the booker's answer arrives where somebody will see it.
 */
async function followUp({ booking, owner, authorUserId, body }) {
  const added = await add({
    bookingId: booking.id,
    ownerId: owner.id,
    visibility: 'shared',
    authorUserId,
    body,
  });
  if (!added.ok) return added;

  const meetingType = await db.prepare('SELECT name FROM meeting_types WHERE id = ?')
    .get(booking.meeting_type_id);
  const when = formatForEmail(booking.start_at, booking.booker_timezone || owner.timezone);
  await sendEmail({
    ownerId: owner.id,
    sentByUserId: authorUserId,
    toEmail: booking.booker_email,
    relatedBookingId: booking.id,
    category: 'transactional',
    subject: `Following up: ${meetingType?.name || 'your meeting'} with ${owner.name}`,
    body: `Hi ${booking.booker_name},\n\n${owner.name}'s office has followed up on ${when}.`
      + `\n\nRead it and reply here: /book/manage/${booking.id}`,
  });
  return added;
}

/**
 * What actually happened, written down for the principal.
 *
 * THE GAP THIS FILLS. An assistant sits in a meeting the principal could not
 * take, or takes the notes in one the principal was in and was not writing
 * during. Until now that account had two places to go: an office note, where it
 * sank into a list that also holds "he prefers the corner table", or nowhere.
 * Nowhere is what usually happened, and the thing a principal most wants from
 * an office — a straight account of what was agreed — was the thing the product
 * had no word for.
 *
 * ONLY ONCE IT HAS STARTED. Minutes of a meeting that has not begun are not
 * minutes; they are a plan, and a plan is what the note register is for. The
 * bar is the start rather than the end, because the useful moment is often
 * while it is still going on — an assistant types up the first half in the
 * break.
 *
 * IT KNOCKS. "For the principal's information" is the entire point, and a
 * record filed on a page nobody has a reason to open has not informed anybody.
 * Through lib/knock.js, so it reaches an inbox and a phone by the same rule as
 * everything else that wants somebody. Never the words themselves — see that
 * file — and never a knock to yourself, which is what a principal minuting
 * their own meeting would otherwise get.
 *
 * NEVER TO THE BOOKER. Enforced in add() rather than here; see the note there.
 */
async function minute({ booking, owner, author, body, draftedByAi = false }) {
  if (Date.parse(booking.start_at) > Date.now()) {
    return {
      ok: false,
      status: 400,
      error: 'This meeting has not started yet. Minutes are the account of what happened — '
        + 'until then, an office note is the right place.',
    };
  }

  const added = await add({
    bookingId: booking.id,
    ownerId: owner.id,
    visibility: 'office',
    kind: 'minute',
    authorUserId: author.id,
    body,
    draftedByAi,
  });
  if (!added.ok) return added;

  const meetingType = await db.prepare('SELECT name FROM meeting_types WHERE id = ?')
    .get(booking.meeting_type_id);
  await knock({
    toUserId: owner.id,
    ownerId: owner.id,
    author,
    subject: `Minutes: ${meetingType?.name || 'your meeting'} with ${booking.booker_name}`,
    line: `has minuted your meeting with ${booking.booker_name}.`,
    url: `/appointments/${owner.id}/${booking.id}`,
  });

  return added;
}

module.exports = { forOffice, forBooker, add, followUp, minute, serialize, VISIBILITIES, KINDS };
