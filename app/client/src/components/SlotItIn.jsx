import { useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Putting something in the diary without a booking link.
 *
 * WHAT THIS IS FOR. Every booking used to arrive through the public page — a
 * stranger picking from published hours against a meeting type with a
 * shareable link. That is the right front door and it is not how most of a
 * principal's diary is actually filled. A meeting gets agreed on a call, a
 * driver is told to come at six, a board member says "same time Thursday" in a
 * corridor. The office then had to either invent a bookable link for it or
 * keep it somewhere that is not the diary, and the day sheet showed a fraction
 * of the day while implying it was the day.
 *
 * DELIBERATELY FEW FIELDS. Who, when, how long. Everything else — the format,
 * a note, whether to tell them — is optional and stays out of the way, because
 * this gets used standing in a corridor between two other things. A form that
 * asks eight questions is a form somebody writes on paper instead.
 *
 * A CLASH IS OFFERED, NOT ENFORCED. A principal genuinely cannot be in two
 * places, so an overlap is refused and named. But a call taken during a car
 * journey is a real thing and only the office knows, so the refusal comes with
 * the way through rather than being the end of it.
 */
export default function SlotItIn({ ownerId = null, defaultDate = null, onAdded }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState(defaultDate || '');
  const [time, setTime] = useState('09:00');
  const [minutes, setMinutes] = useState(30);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clash, setClash] = useState(null);

  function reset() {
    setName(''); setEmail(''); setNote(''); setNotify(false);
    setError(''); setClash(null);
  }

  async function submit(allowOverlap) {
    if (!name.trim() || !date || !time) {
      setError('Say who it is with, and when.');
      return;
    }
    setBusy(true); setError(''); setClash(null);
    try {
      // Built from the fields as local wall-clock time, which is what the
      // person typing means: "half nine" is half nine where they are standing.
      const startAt = new Date(`${date}T${time}`).toISOString();
      await api.post('/bookings', {
        ownerId: ownerId || undefined,
        startAt,
        durationMinutes: Number(minutes),
        name: name.trim(),
        email: email.trim() || undefined,
        note: note.trim() || undefined,
        notify: notify && !!email.trim(),
        allowOverlap,
      });
      reset();
      setOpen(false);
      await onAdded?.();
    } catch (e) {
      // The server hands back what it clashes with, so the offer to keep both
      // can name the thing rather than asking in the abstract.
      if (e.data?.clashes?.length) {
        setClash(e.data.clashes);
        setError(e.message);
      } else {
        setError(e.message);
      }
    } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button className="btn btn-secondary btn-sm" type="button" onClick={() => { reset(); setOpen(true); }}>
        Put something in the diary
      </button>
    );
  }

  return (
    <form
      className="card slot-it-in"
      onSubmit={(e) => { e.preventDefault(); submit(false); }}
    >
      <div className="name">Put something in the diary</div>
      <p className="hint" style={{ marginTop: 4 }}>
        For a meeting already agreed. It goes straight on — no link, no approval,
        and published hours do not apply.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="slot-it-in-fields">
        <input
          type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Who it is with" aria-label="Who the meeting is with" required
        />
        <input
          type="date" value={date} onChange={(e) => setDate(e.target.value)}
          aria-label="Date" required
        />
        <input
          type="time" value={time} onChange={(e) => setTime(e.target.value)}
          aria-label="Start time" required
        />
        <select
          value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="How long"
        >
          {[15, 30, 45, 60, 90, 120, 180].map((m) => (
            <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr`}</option>
          ))}
        </select>
      </div>

      <div className="slot-it-in-fields" style={{ marginTop: 8 }}>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Their email (optional)" aria-label="Their email"
        />
        <input
          type="text" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Where, or anything to remember" aria-label="Note"
        />
      </div>

      {/* Off unless asked, and only offered once there is somewhere to send it.
          An unexpected confirmation to a board member because an assistant was
          tidying the calendar is worse than a missing one. */}
      {email.trim() && (
        <label className="hint" style={{ display: 'block', marginTop: 8 }}>
          <input
            type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Email them a confirmation
        </label>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add to the diary'}
        </button>
        {clash && (
          <button
            className="btn btn-danger btn-sm" type="button" disabled={busy}
            onClick={() => submit(true)}
          >
            Keep both anyway
          </button>
        )}
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
