import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { dayLabelInZone, timeLabelInZone } from '../lib/timezones.js';
import { useOpenSlots } from '../lib/useOpenSlots.js';
import SlotGrid from '../components/SlotGrid.jsx';
import VideoJoinLink from '../components/VideoJoinLink.jsx';

function RescheduleForm({ booking, onDone, onError }) {
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { slots, windowDays, reload } = useOpenSlots({
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
      <SlotGrid slots={slots} timezone={booking.bookerTimezone} selected={selected} onSelect={setSelected} windowDays={windowDays} />
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
  const [notes, setNotes] = useState([]);
  const [saying, setSaying] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('view'); // view | reschedule
  const [justUpdated, setJustUpdated] = useState(false);

  function load() {
    api.get(`/public/bookings/${id}`)
      .then((data) => { setBooking(data.booking); setNotes(data.notes || []); })
      .catch((err) => setError(err.message));
  }

  useEffect(load, [id]);

  async function say(e) {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      await api.post(`/public/bookings/${id}/notes`, { body: saying });
      setSaying('');
      load();
    } catch (err) { setError(err.message); } finally { setSending(false); }
  }

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

  // Accepting what the office suggested. Withdrawing is the cancel above —
  // there was never a reason to invent a second verb for it.
  async function handleAcceptFormat() {
    setError('');
    setJustUpdated(false);
    try {
      const data = await api.post(`/public/bookings/${id}/accept-format`);
      setBooking(data.booking);
      setJustUpdated(true);
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
          {/* The format as this booking actually stands, not as the meeting
              type describes it — those are no longer the same thing. */}
          <div className="meta">{booking.durationMinutes} min · {booking.formatLabel}</div>
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
                {/* Pending on the format is a different thing from pending on
                    the tier, and the box below says which. Only say "awaiting
                    approval" when that is genuinely all that is happening. */}
                {booking.status === 'pending' && booking.formatState === 'agreed' && (
                  <><br /><span className="tz-note">Awaiting {booking.ownerName}'s approval.</span></>
                )}
              </p>

              {booking.formatState === 'proposed' && (
                <div className="format-note-box">
                  <strong>You asked to meet {booking.formatLabel.toLowerCase()}</strong>
                  {booking.formatNote && <span className="said">“{booking.formatNote}”</span>}
                  <span className="said">
                    {booking.ownerName}'s office has to agree to that, so this is a request rather
                    than a confirmed booking. Your time is held while they decide.
                  </span>
                </div>
              )}

              {booking.formatState === 'countered' && (
                <div className="format-note-box">
                  <strong>{booking.ownerName}'s office suggests {booking.counterFormatLabel.toLowerCase()}</strong>
                  {booking.counterFormatNote && <span className="said">“{booking.counterFormatNote}”</span>}
                  <span className="said">
                    You asked to meet {booking.formatLabel.toLowerCase()}
                    {booking.formatNote ? ` (${booking.formatNote})` : ''}. Your time is still held —
                    accept the suggestion, or withdraw and pick something else.
                  </span>
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    style={{ marginTop: 10 }}
                    onClick={handleAcceptFormat}
                  >
                    Accept {booking.counterFormatLabel.toLowerCase()}
                  </button>
                </div>
              )}

              {booking.status === 'confirmed' && booking.videoRoom && (
                <div style={{ marginBottom: 16 }}><VideoJoinLink room={booking.videoRoom} /></div>
              )}
              {/* Once it has happened there is nothing to reschedule and
                  nothing to cancel — and the server refuses both, so offering
                  them here would only be a button that fails. The message box
                  below stays open, because "thank you, and here is the thing
                  you asked for" is written after a meeting, not before it. */}
              {booking.over ? (
                <p className="tz-note">
                  This meeting has already taken place. If you need another,
                  {' '}<Link to={`/book/${booking.ownerSlug}`}>pick a new time</Link>.
                </p>
              ) : (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary" type="button" onClick={() => setMode('reschedule')}>
                    Reschedule
                  </button>
                  <button className="btn btn-danger" type="button" onClick={handleCancel}>
                    {booking.status === 'pending' ? 'Withdraw request' : 'Cancel booking'}
                  </button>
                </div>
              )}
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

          {/* A line to the office, open for as long as the appointment is.
              Shown once there is something to read or something to say — a
              booking nobody has written on should not carry an empty box. */}
          {booking.status !== 'cancelled' && booking.status !== 'declined' && (
            <div className="booking-line">
              <h3>Messages</h3>
              {notes.length === 0 && (
                <p className="hint">
                  Anything you need {booking.ownerName}'s office to know before the meeting —
                  or afterwards — can go here.
                </p>
              )}
              {notes.map((n) => (
                <div key={n.id} className={'note-line' + (n.fromBooker ? ' is-mine' : '')}>
                  <div className="note-who">
                    {n.fromBooker ? 'You' : (n.authorName || `${booking.ownerName}'s office`)}
                  </div>
                  <div className="note-body">{n.body}</div>
                </div>
              ))}
              <form onSubmit={say}>
                <textarea
                  aria-label="A note to the office"
                  value={saying}
                  onChange={(e) => setSaying(e.target.value)}
                  placeholder="Anything they should know…"
                />
                <button className="btn btn-secondary btn-sm" type="submit" disabled={sending || !saying.trim()}>
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
