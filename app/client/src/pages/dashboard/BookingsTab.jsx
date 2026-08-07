import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { dayLabelInZone, timeLabelInZone } from '../../lib/timezones.js';
import VideoJoinLink from '../../components/VideoJoinLink.jsx';

export default function BookingsTab() {
  const { user } = useAuth();
  const [scope, setScope] = useState('upcoming');
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');

  async function load(currentScope) {
    setError('');
    try {
      const data = await api.get(`/bookings?scope=${currentScope}`);
      setBookings(data.bookings);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load(scope);
  }, [scope]);

  async function handleCancel(id) {
    if (!window.confirm('Cancel this booking?')) return;
    try {
      await api.post(`/bookings/${id}/cancel`);
      load(scope);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="tabs" style={{ borderBottom: 'none', marginBottom: 16 }}>
        <button
          className={'tab-btn' + (scope === 'upcoming' ? ' is-active' : '')}
          onClick={() => setScope('upcoming')}
          type="button"
        >
          Upcoming
        </button>
        <button
          className={'tab-btn' + (scope === 'past' ? ' is-active' : '')}
          onClick={() => setScope('past')}
          type="button"
        >
          Past
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {bookings === null && <p className="hint">Loading…</p>}
      {bookings && bookings.length === 0 && (
        <div className="empty-state">
          {scope === 'upcoming' ? "No upcoming bookings yet — share your booking link to get your first one." : 'No past bookings.'}
        </div>
      )}
      {bookings && bookings.length > 0 && (
        <div>
          {bookings.map((b) => (
            <div className="card" key={b.id}>
              <div className="booking-row">
                <div>
                  <div className="when">{dayLabelInZone(b.startAt, user.timezone)} · {timeLabelInZone(b.startAt, user.timezone)}</div>
                  <div className="meta">{b.meetingTypeName} with {b.bookerName} ({b.bookerEmail})</div>
                </div>
                {scope === 'upcoming' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {b.videoRoom && <VideoJoinLink room={b.videoRoom} />}
                    <button className="btn btn-danger btn-sm" onClick={() => handleCancel(b.id)} type="button">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
