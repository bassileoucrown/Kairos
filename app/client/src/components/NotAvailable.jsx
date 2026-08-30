import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { zonedToUtc, dateKeyInZone, formatInZone } from '../lib/timezones.js';

// "I am not available then."
//
// THE FEATURE EXISTED AND COULD NOT BE REACHED. The diary could already be
// told that a stretch of time was spoken for — for an hour, a day, a
// fortnight — and there was no screen anywhere that said so, which made "I can
// choose to be unavailable" true of the system and false of the person using
// it.
//
// PRESETS, BECAUSE THE ARITHMETIC IS THE WORK. "Block tomorrow" means midnight
// to midnight in the PRINCIPAL's zone, which from a phone in another country
// is a sum nobody should be asked to do in their head. The presets do it; the
// dates field is there for everything they do not cover.
//
// THE PRINCIPAL'S ZONE, NOT THE BROWSER'S. An assistant in London blocking
// "tomorrow" for a principal in Lagos must take out the principal's tomorrow.
// The server says which zone that is, because the browser cannot know.

/** Midnight at the start of a local date, as an instant. */
function startOfDay(dateKey, tz) {
  return zonedToUtc(dateKey, '00:00', tz);
}

/** A local date shifted by whole days, still a local date. */
function shiftDay(dateKey, days) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The choices, as a person would say them.
 *
 * Each returns a start and an end instant. "The next two hours" starts now
 * because that is what somebody means when they reach for it mid-morning;
 * everything else starts at a boundary, because "tomorrow" that begins at
 * 11:42 is not tomorrow.
 */
function presetsFor(tz, now = new Date()) {
  const today = dateKeyInZone(now.toISOString(), tz);
  const tomorrow = shiftDay(today, 1);
  return [
    {
      id: 'hours',
      label: 'The next 2 hours',
      range: () => [now.toISOString(), new Date(now.getTime() + 2 * 3600000).toISOString()],
    },
    {
      id: 'today',
      label: 'The rest of today',
      range: () => [now.toISOString(), startOfDay(tomorrow, tz)],
    },
    {
      id: 'tomorrow',
      label: 'All day tomorrow',
      range: () => [startOfDay(tomorrow, tz), startOfDay(shiftDay(today, 2), tz)],
    },
    {
      id: 'week',
      label: 'The next 7 days',
      range: () => [startOfDay(today, tz), startOfDay(shiftDay(today, 8), tz)],
    },
  ];
}

export default function NotAvailable({ ownerId, principalName = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [keepReason, setKeepReason] = useState(false);
  // Only for the "pick dates" path; the presets need neither.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(() => {
    if (!ownerId) return;
    api.get(`/itinerary/${ownerId}/unavailable`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [ownerId]);
  useEffect(load, [load]);

  if (!data) return <p className="hint">Loading…</p>;
  const tz = data.timezone || 'UTC';
  const blocks = data.blocks || [];

  async function set(startsAt, endsAt) {
    setBusy(true); setError('');
    try {
      await api.post(`/itinerary/${ownerId}/unavailable`, {
        startsAt,
        endsAt,
        reason,
        // Only the principal may hide a reason, and the server enforces it —
        // this is the request, not the decision.
        visibility: keepReason ? 'private' : 'office',
      });
      setReason(''); setKeepReason(false); setFrom(''); setTo('');
      load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function lift(id) {
    setBusy(true); setError('');
    try {
      await api.del(`/itinerary/${ownerId}/unavailable/${id}`);
      load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  function setFromDates() {
    if (!from || !to) return;
    // Whole days, inclusive: somebody picking the 4th to the 6th means the
    // whole of the 6th, not midnight at the start of it.
    set(startOfDay(from, tz), startOfDay(shiftDay(to, 1), tz));
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <h3>Not available</h3>
      <p className="hint">
        Time {principalName || 'you'} cannot be booked, for as long as you say — an hour,
        a day, a week, or longer. Nobody is offered it: not the office, and not anyone
        holding the booking link.
      </p>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="field">
        <label htmlFor="na-reason">Why (optional)</label>
        <input
          id="na-reason" type="text" maxLength={280} value={reason}
          placeholder="Funeral, medical appointment, away…"
          onChange={(e) => setReason(e.target.value)}
        />
        <label className="check-row" htmlFor="na-private" style={{ marginTop: 6 }}>
          <input
            id="na-private" type="checkbox" checked={keepReason}
            onChange={(e) => setKeepReason(e.target.checked)}
          />
          {' '}Keep the reason to myself
        </label>
        {/* Said plainly, because the alternative is somebody assuming the block
            itself is hidden. It is not, and it must not be — a block the office
            cannot see is a block they book over. */}
        <p className="hint">
          The office is always told the time is spoken for. Ticking this keeps only
          the reason between you and whoever set it.
        </p>
      </div>

      <div className="code-actions" style={{ flexWrap: 'wrap' }}>
        {presetsFor(tz).map((p) => (
          <button
            key={p.id} className="btn btn-secondary btn-sm" type="button" disabled={busy}
            onClick={() => { const [a, b] = p.range(); set(a, b); }}
          >{p.label}</button>
        ))}
      </div>

      {/* A div, not a form. This component is mounted inside the availability
          form, and a nested form is invalid HTML whose submit button drives
          the OUTER one — which here would save the working hours every time
          somebody blocked a fortnight. */}
      <div className="na-dates" style={{ marginTop: 12 }}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="na-from">From</label>
            <input id="na-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="na-to">To</label>
            <input id="na-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <button
          className="btn btn-primary btn-sm" type="button"
          disabled={busy || !from || !to} onClick={setFromDates}
        >
          Block these dates
        </button>
      </div>

      <h4 style={{ marginTop: 20, marginBottom: 6 }}>Already blocked</h4>
      {blocks.length === 0 ? (
        <p className="hint">Nothing blocked. The diary is as open as your hours allow.</p>
      ) : blocks.map((b) => (
        <div className="ess-row" key={b.id}>
          <div className="ess-main">
            <div className="ess-label">{b.label}</div>
            <div className="hint">
              {/* The helper's own defaults. Passing dateStyle alongside the
                  individual options it already sets is a TypeError in Intl,
                  not a nicer format. */}
              {formatInZone(b.startsAt, tz)}
              {' → '}
              {formatInZone(b.endsAt, tz)}
              {b.private ? ' · reason kept private' : ''}
            </div>
          </div>
          <div className="ess-buttons">
            <button className="btn btn-sm" type="button" disabled={busy} onClick={() => lift(b.id)}>
              Lift
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
