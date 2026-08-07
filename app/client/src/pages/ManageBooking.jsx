import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { dayLabelInZone, timeLabelInZone } from '../lib/timezones.js';
import { useOpenSlots } from '../lib/useOpenSlots.js';
import SlotGrid from '../components/SlotGrid.jsx';
import VideoJoinLink from '../components/VideoJoinLink.jsx';

const LOCATION_LABELS = { video: 'Video call', phone: 'Phone call', in_person: 'In person' };

function RescheduleForm({ booking, onDone, onError }) {
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { slots, reload } = useOpenSlots({
    ownerSlug: booking.ownerSlug,
    meetingSlug: booking.meetingTypeSlug,
    excludeBookingId: booking.id,
  });

  async function handleConfirm() {
    setSubmitting(true);
    onError('');
    try {
      const data = await api.post(`/public/bookings/${booking.id}/reschedule`, { startAt: selected.startAt });
      onDone(data.booking);
    } catch (err) {
      onError(err.message);
      reload();
      setSelected(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="booking-layout">
      <SlotGrid slots={slots} timezone={booking.bookerTimezone} selected={selected} onSelect={setSelected} />
      <div>
        {!selected && <p className="hint">Select a new time.</p>}
        {selected && (
          <>
            <p style={{ marginBottom: 16 }}>
              <strong>{dayLabelInZone(selected.startAt, booking.bookerTimezone)}</strong>
              <br />
              {timeLabelInZone(selected.startAt, booking.bookerTimezone)} ({booking.bookerTimezone})
            </p>
            <button className="btn btn-primary btn-block" type="button" onClick={handleConfirm} disabled={submitting}>
              {submitting ? 'Saving…' : 'Confirm new time'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ManageBooking() {
  const { id } = useParams();
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('view'); // view | reschedule
  const [justUpdated, setJustUpdated] = useState(false);

  function load() {
    api.get(`/public/bookings/${id}`)
      .then((data) => setBooking(data.booking))
      .catch((err) => setError(err.message));
  }

  useEffect(load, [id]);

  async function handleCancel() {
    if (!window.confirm('Cancel this booking?')) return;
    setJustUpdated(false);
    try {
      const data = await api.post(`/public/bookings/${id}/cancel`);
      setBooking(data.booking);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleRescheduled(updated) {
    setBooking(updated);
    setMode('view');
    setJustUpdated(true);
  }

  if (error && !booking) {
    return (
      <div className="public-shell">
        <div className="public-card">
          <div className="public-body empty-state">{error}</div>
        </div>
      </div>
    );
  }
  if (!booking) return <div className="spinner-page">Loading…</div>;

  return (
    <div className="public-shell">
      <div className="public-card">
        <div className="public-header">
          <div className="owner-name">{booking.ownerName}</div>
          <h1>{booking.meetingTypeName}</h1>
          <div className="meta">{booking.durationMinutes} min · {LOCATION_LABELS[booking.locationType]}</div>
        </div>
        <div className="public-body">
          {error && <div className="alert alert-error">{error}</div>}
          {justUpdated && <div className="alert alert-success">Booking updated.</div>}

          {booking.status === 'cancelled' ? (
            <>
              <p>This booking has been cancelled.</p>
              <Link to={`/book/${booking.ownerSlug}`} className="btn btn-secondary">Book a new time</Link>
            </>
          ) : booking.status === 'declined' ? (
            <>
              <p>{booking.ownerName} wasn't able to accept this request.</p>
              <Link to={`/book/${booking.ownerSlug}`} className="btn btn-secondary">Book a different time</Link>
            </>
          ) : mode === 'view' ? (
            <>
              <p style={{ marginBottom: 20 }}>
                <strong>{dayLabelInZone(booking.startAt, booking.bookerTimezone)}</strong>
                <br />
                {timeLabelInZone(booking.startAt, booking.bookerTimezone)} ({booking.bookerTimezone})
                <br />
                <span className="tz-note">Booked as {booking.bookerName} ({booking.bookerEmail})</span>
                {booking.status === 'pending' && <><br /><span className="tz-note">Awaiting {booking.ownerName}'s approval.</span></>}
              </p>
              {booking.status === 'confirmed' && booking.videoRoom && (
                <div style={{ marginBottom: 16 }}><VideoJoinLink room={booking.videoRoom} /></div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-secondary" type="button" onClick={() => setMode('reschedule')}>
                  Reschedule
                </button>
                <button className="btn btn-danger" type="button" onClick={handleCancel}>
                  Cancel booking
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="tz-note" style={{ marginBottom: 16 }}>
                Currently: {dayLabelInZone(booking.startAt, booking.bookerTimezone)} · {timeLabelInZone(booking.startAt, booking.bookerTimezone)}
              </p>
              <RescheduleForm booking={booking} onDone={handleRescheduled} onError={setError} />
              <button className="btn btn-secondary" type="button" onClick={() => setMode('view')} style={{ marginTop: 16 }}>
                Cancel reschedule
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
