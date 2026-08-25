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

  return (
    <div className="booking-notes">
      {error && <div className="alert alert-error">{error}</div>}
      {notes === null && <p className="hint">Loading…</p>}

      {notes?.map((n) => (
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
