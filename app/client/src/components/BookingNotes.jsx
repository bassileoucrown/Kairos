import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Everything said about one appointment, from the office's side.
 *
 * TWO REGISTERS, DRAWN APART. An office note is the principal's preparation —
 * what they need before they walk in, which car, what was agreed internally.
 * A shared note went to the person they are meeting. Confusing the two is the
 * failure this whole feature has to avoid, so the composer makes you say which
 * before you can send, and every line on screen is marked with what it is.
 *
 * The default is the office's own, and that asymmetry is deliberate: a private
 * note shown by mistake is embarrassing and recoverable, a private note SENT
 * is neither.
 *
 * MINUTES ARE THE THIRD THING, AND THEY GET THEIR OWN BOX. A note is
 * preparation and a shared note is a message; minutes are the account of what
 * happened, written after, for a principal who was not in the room. Putting
 * them in the same dropdown would mean the most consequential line an office
 * writes — "he agreed to fund the second tranche" — is one mis-click away from
 * being filed as "he prefers the corner table", and one further mis-click from
 * being sent to him.
 */
export default function BookingNotes({ ownerId, bookingId, onChanged }) {
  const [notes, setNotes] = useState(null);
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState('office');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const base = `/pa/${ownerId}/bookings/${bookingId}`;

  function load() {
    api.get(`${base}/notes`)
      .then((d) => setNotes(d.notes || []))
      .catch((err) => setError(err.message));
  }
  useEffect(load, [ownerId, bookingId]);

  async function submit(e, asFollowUp = false) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post(asFollowUp ? `${base}/follow-up` : `${base}/notes`,
        asFollowUp ? { body } : { body, visibility });
      setBody('');
      load();
      onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  // Minutes live in their own box on the page — see components/BookingMinutes
  // — so they are filtered out of this one rather than mixed in. Two registers
  // is already the most this list can carry and stay readable.
  const said = (notes || []).filter((n) => n.kind !== 'minute');

  return (
    <div className="booking-notes">
      {error && <div className="alert alert-error">{error}</div>}
      {notes === null && <p className="hint">Loading…</p>}

      {said.map((n) => (
        <div key={n.id} className={`note-line is-${n.visibility}`}>
          <div className="note-who">
            {n.fromBooker ? 'From them' : (n.authorName || 'The office')}
            {' · '}
            <span className="note-tag">
              {n.visibility === 'office' ? 'Office only' : 'They can see this'}
            </span>
          </div>
          <div className="note-body">{n.body}</div>
        </div>
      ))}

      <form onSubmit={submit}>
        <textarea
          aria-label="A note about this appointment"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What the principal needs to know, or something to tell them."
        />
        <div className="note-actions">
          <select
            aria-label="Who this is for"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="office">Office only</option>
            <option value="shared">Send to them</option>
          </select>
          <button className="btn btn-secondary btn-sm" type="submit" disabled={busy || !body.trim()}>
            {busy ? 'Saving…' : 'Add'}
          </button>
          {/* Its own button rather than a third option in the dropdown: a
              follow-up is emailed with the words in it, and that is a bigger
              act than adding a line to a page. It should not be reachable by
              picking the wrong item in a list. */}
          <button className="btn btn-secondary btn-sm" type="button"
            disabled={busy || !body.trim()}
            onClick={(e) => submit(e, true)}>
            Send as follow-up
          </button>
        </div>
      </form>
    </div>
  );
}
