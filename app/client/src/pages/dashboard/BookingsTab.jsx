import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { dayLabelInZone, timeLabelInZone } from '../../lib/timezones.js';
import VideoJoinLink from '../../components/VideoJoinLink.jsx';

const SCOPES = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  // Cancelled and declined together: to whoever is looking, both mean the
  // meeting is not happening, and splitting them would mean checking two
  // lists to answer one question.
  { id: 'cancelled', label: 'Cancelled' },
];

const EMPTY = {
  upcoming: 'Nothing booked ahead. Share a meeting type link to get the first one.',
  past: 'No meetings behind you yet.',
  cancelled: 'Nothing has been cancelled or declined.',
};

const STATUS_LABEL = { cancelled: 'Cancelled', declined: 'Declined', pending: 'Waiting' };

// Serves both paths: the principal looking at their own, and an assistant
// looking at a principal's. Passing ownerId switches the endpoints; the
// questions somebody brings to this screen are the same either way.
export default function BookingsTab({ ownerId = null, timezone = null }) {
  const { user } = useAuth();
  const base = ownerId ? `/pa/${ownerId}` : '';
  const zone = timezone || user?.timezone || 'UTC';

  const [scope, setScope] = useState('upcoming');
  const [query, setQuery] = useState('');
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');
  // Which booking's correspondence is open, and what it holds.
  const [openTrail, setOpenTrail] = useState(null);
  const [trail, setTrail] = useState(null);

  async function load(currentScope, q) {
    setError('');
    try {
      const data = await api.get(`${base}/bookings?scope=${currentScope}&q=${encodeURIComponent(q)}`);
      setBookings(data.bookings);
    } catch (err) {
      setError(err.message);
    }
  }

  // Debounced so a search does not fire a request per keystroke, and so the
  // list is not redrawn under somebody halfway through a name.
  useEffect(() => {
    setBookings(null);
    const t = setTimeout(() => load(scope, query), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [scope, query, ownerId]);

  async function showTrail(b) {
    if (openTrail === b.id) { setOpenTrail(null); setTrail(null); return; }
    setOpenTrail(b.id);
    setTrail(null);
    try {
      const data = await api.get(`${base}/bookings/${b.id}/trail`);
      setTrail(data.trail);
    } catch (err) {
      setError(err.message);
      setOpenTrail(null);
    }
  }

  async function handleCancel(b) {
    if (!window.confirm(`Cancel ${b.bookerName}'s meeting? They will be emailed.`)) return;
    try {
      await api.post(`${base}/bookings/${b.id}/cancel`);
      load(scope, query);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="tabs" style={{ borderBottom: 'none', marginBottom: 12 }}>
        {SCOPES.map((s) => (
          <button
            key={s.id}
            className={'tab-btn' + (scope === s.id ? ' is-active' : '')}
            onClick={() => setScope(s.id)}
            type="button"
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="field" style={{ maxWidth: 340 }}>
        <label htmlFor="booking-search">Search</label>
        <input
          id="booking-search"
          type="search"
          value={query}
          placeholder="A name, an address, a meeting type"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {bookings === null && <p className="hint">Loading…</p>}
      {bookings && bookings.length === 0 && (
        <div className="empty-state">
          {query ? `Nothing matching “${query}” in ${scope} bookings.` : EMPTY[scope]}
        </div>
      )}

      {bookings && bookings.map((b) => (
        <div className="card" key={b.id}>
          <div className="booking-row">
            <div>
              <div className="when">
                {STATUS_LABEL[b.status] && (
                  <span className="pill is-off" style={{ marginRight: 8 }}>{STATUS_LABEL[b.status]}</span>
                )}
                {dayLabelInZone(b.startAt, zone)} · {timeLabelInZone(b.startAt, zone)}
              </div>
              <div className="meta">{b.meetingTypeName} with {b.bookerName} ({b.bookerEmail})</div>
              <div className="meta">
                {b.formatLabel}
                {/* The office is regularly asked whether somebody was given an
                    exception. This is where that is on the record. */}
                {b.wasUnusual && ` — they asked for this instead of ${b.usualFormatLabel.toLowerCase()}`}
                {b.formatNote && ` · “${b.formatNote}”`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {b.status === 'confirmed' && b.videoRoom && scope === 'upcoming' && <VideoJoinLink room={b.videoRoom} />}
              {b.letters > 0 && (
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => showTrail(b)}>
                  {openTrail === b.id ? 'Hide' : `What we sent (${b.letters})`}
                </button>
              )}
              {scope === 'upcoming' && (
                <button className="btn btn-danger btn-sm" type="button" onClick={() => handleCancel(b)}>
                  Cancel
                </button>
              )}
            </div>
          </div>

          {openTrail === b.id && (
            <div className="trail">
              {trail === null && <p className="hint">Loading…</p>}
              {trail && trail.length === 0 && <p className="hint">Nothing was sent about this one.</p>}
              {trail && trail.map((t) => (
                <div className="trail-line" key={t.id}>
                  <span className="trail-when">{dayLabelInZone(t.at, zone)} · {timeLabelInZone(t.at, zone)}</span>
                  <span className="trail-what">
                    <strong>{t.subject}</strong>
                    <span className="trail-who">to {t.toEmail} · {t.byPerson ? `sent by ${t.by}` : 'sent automatically'}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
