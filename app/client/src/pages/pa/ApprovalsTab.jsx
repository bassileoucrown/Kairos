import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { dayLabelInZone, timeLabelInZone } from '../../lib/timezones.js';

const TIER_LABELS = { 3: 'Priority', 4: 'Inner Circle' };

export default function ApprovalsTab({ ownerId }) {
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  function load() {
    api.get(`/pa/${ownerId}/approvals`).then((data) => setBookings(data.bookings)).catch((err) => setError(err.message));
  }

  useEffect(load, [ownerId]);

  async function act(id, action) {
    setBusyId(id);
    setError('');
    try {
      await api.post(`/pa/${ownerId}/approvals/${id}/${action}`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {bookings === null && <p className="hint">Loading…</p>}
      {bookings && bookings.length === 0 && (
        <div className="empty-state">No requests waiting on approval — Tier 3/4 bookings will show up here.</div>
      )}
      {bookings && bookings.map((b) => (
        <div className="card" key={b.id}>
          <div className="booking-row">
            <div>
              <div className="when">
                <span className="pill" style={{ marginRight: 8 }}>{TIER_LABELS[b.accessTier] || `Tier ${b.accessTier}`}</span>
                {dayLabelInZone(b.startAt, b.bookerTimezone)} · {timeLabelInZone(b.startAt, b.bookerTimezone)} ({b.bookerTimezone})
              </div>
              <div className="meta">{b.meetingTypeName} with {b.bookerName} ({b.bookerEmail})</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" type="button" disabled={busyId === b.id} onClick={() => act(b.id, 'approve')}>
                Approve
              </button>
              <button className="btn btn-danger btn-sm" type="button" disabled={busyId === b.id} onClick={() => act(b.id, 'decline')}>
                Decline
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
