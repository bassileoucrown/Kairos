import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { dayLabelInZone, timeLabelInZone } from '../lib/timezones.js';

/**
 * The account of what happened, for a principal who was not in the room.
 *
 * WHY IT IS NOT A NOTE. A note is preparation — which car, what he likes, what
 * was agreed internally beforehand. Minutes are the record afterwards, and they
 * are the single most valuable thing an assistant produces: "he agreed to fund
 * the second tranche, subject to the audit" is the sentence a principal will
 * still be relying on in six months. Filed among the notes it would sit under
 * "he prefers the corner table", and be read with the same weight.
 *
 * NEVER REACHES THE PERSON MINUTED. Minutes are office-only by construction —
 * the server forces it rather than offering it, so there is no dropdown here to
 * get wrong. That matters because minutes are candid by nature, and the booker
 * holds a link they can forward to anybody.
 *
 * THE PRINCIPAL IS TOLD. Filing minutes knocks — an alert and an email — since
 * a record on a page nobody has cause to open has informed nobody. That is the
 * whole of "for the principal's information".
 */
export default function BookingMinutes({ ownerId, bookingId, startAt, timezone, onChanged }) {
  const [minutes, setMinutes] = useState(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const base = `/pa/${ownerId}/bookings/${bookingId}`;

  function load() {
    api.get(`${base}/notes`)
      .then((d) => setMinutes((d.notes || []).filter((n) => n.kind === 'minute')))
      .catch((err) => setError(err.message));
  }
  useEffect(load, [ownerId, bookingId]);

  async function file(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post(`${base}/minutes`, { body });
      setBody('');
      load();
      onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  // Before it starts there is nothing to minute. Said rather than disabled: a
  // greyed box with no reason beside it is a thing people click twice and then
  // give up on.
  const started = !startAt || Date.parse(startAt) <= Date.now();

  return (
    <div className="booking-minutes">
      {error && <div className="alert alert-error">{error}</div>}
      {minutes === null && <p className="hint">Loading…</p>}

      {minutes?.length === 0 && started && (
        <p className="hint">
          Nothing minuted yet. What was agreed, what was asked for, what happens next.
        </p>
      )}

      {minutes?.map((m) => (
        <div className="minute-line" key={m.id}>
          <div className="minute-who">
            {m.authorName || 'The office'}
            {' · '}
            <span className="minute-when">
              {dayLabelInZone(m.createdAt, timezone || 'UTC')}
              {' · '}{timeLabelInZone(m.createdAt, timezone || 'UTC')}
            </span>
          </div>
          <div className="minute-body">{m.body}</div>
        </div>
      ))}

      {started ? (
        <form onSubmit={file}>
          <textarea
            aria-label="Minutes of this meeting"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What was agreed, what was asked for, what happens next…"
          />
          <p className="hint">
            Office only — the person you met never sees this. Filing it tells the principal.
          </p>
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !body.trim()}>
            {busy ? 'Filing…' : 'File the minutes'}
          </button>
        </form>
      ) : (
        <p className="hint">
          Minutes can be written once the meeting has started. Until then, an office
          note is the right place for anything to prepare.
        </p>
      )}
    </div>
  );
}
