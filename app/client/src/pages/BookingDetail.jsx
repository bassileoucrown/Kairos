import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import AppShell from '../components/AppShell.jsx';
import BookingNotes from '../components/BookingNotes.jsx';
import VideoJoinLink from '../components/VideoJoinLink.jsx';
import MoveAppointment from '../components/MoveAppointment.jsx';
import QuickJot from '../components/QuickJot.jsx';
import { dayLabelInZone, timeLabelInZone } from '../lib/timezones.js';

/**
 * One appointment, and everything you can do about it.
 *
 * WHY THIS PAGE EXISTS. Every verb an office needs for a booking already
 * worked, and none of them was in the same place: cancelling lived in the
 * Bookings tab, moving on the day sheet, notes in a panel on Today, the length
 * nowhere at all. So "edit this appointment" meant knowing which screen
 * happened to carry the verb you wanted — and someone who clicked the meeting
 * itself, which is what a person does, got nothing. Clicking an appointment
 * now lands here, and here holds all of it.
 *
 * WHAT CANNOT BE EDITED, AND WHY. Not the booker, not their address, not the
 * meeting type. Those are the terms somebody agreed to; changing them would
 * rewrite what a person consented to without telling them. Time, length and
 * whether it happens at all are different — they are arrangements, they are
 * renegotiable, and each one emails the booker and lands in the trail with a
 * name against it. Nothing here changes quietly.
 */

const STATUS = {
  confirmed: { label: 'Confirmed', cls: '' },
  pending: { label: 'Waiting on a decision', cls: ' is-warn' },
  cancelled: { label: 'Cancelled', cls: ' is-off' },
  declined: { label: 'Declined', cls: ' is-off' },
};

function minutesBetween(startAt, endAt) {
  return Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60000);
}

function spanLabel(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h} hour${h === 1 ? '' : 's'}`;
}

export default function BookingDetail() {
  const { ownerId, bookingId } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Which of the three arrangements is being changed. One at a time: two
  // half-filled forms on screen is a way to send the wrong one.
  const [open, setOpen] = useState(null); // move | length | cancel
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');

  const base = `/pa/${ownerId}/bookings/${bookingId}`;

  function load() {
    return api.get(base).then(setData).catch((err) => setError(err.message));
  }
  useEffect(() => { setData(null); load(); }, [ownerId, bookingId]);

  const booking = data?.booking || null;
  const zone = data?.timezone || 'UTC';
  const runs = booking ? minutesBetween(booking.startAt, booking.endAt) : 0;

  function begin(which) {
    setError('');
    setNote('');
    if (which === 'length') setMinutes(String(runs));
    setOpen((o) => (o === which ? null : which));
  }

  // All three go through the same shape because all three are the same act
  // from the office's side: change something, tell the booker, write it down.
  async function act(path, body) {
    setBusy(true);
    setError('');
    try {
      await api.post(`${base}/${path}`, body);
      setOpen(null);
      setNote('');
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const status = booking ? (STATUS[booking.status] || STATUS.confirmed) : null;
  // Cancelled is the end of the road: there is nothing left to move, lengthen
  // or call off. The conversation stays open below, because it happened.
  const live = booking?.status === 'confirmed' || booking?.status === 'pending';

  return (
    <AppShell title="Appointment" active="today">
      {error && <div className="alert alert-error">{error}</div>}
      {data === null && !error && <p className="hint">Loading…</p>}

      {booking && (
        <>
          <div className="card">
            <div className="booking-row">
              <div>
                <div className="when">
                  <span className={`pill${status.cls}`} style={{ marginRight: 8 }}>{status.label}</span>
                  {dayLabelInZone(booking.startAt, zone)} · {timeLabelInZone(booking.startAt, zone)}
                  {' – '}{timeLabelInZone(booking.endAt, zone)}
                </div>
                <div className="meta">
                  {booking.meetingTypeName} with {booking.bookerName} ({booking.bookerEmail})
                </div>
                <div className="meta">
                  {spanLabel(runs)} · {booking.formatLabel}
                  {booking.wasUnusual && ` — instead of ${booking.usualFormatLabel.toLowerCase()}`}
                  {booking.formatNote && ` · “${booking.formatNote}”`}
                </div>
                {/* The booker read the time in their own zone, and that is the
                    number they will quote back at you on the phone. */}
                {booking.bookerTimezone && booking.bookerTimezone !== zone && (
                  <div className="meta">
                    They have it as {timeLabelInZone(booking.startAt, booking.bookerTimezone)}
                    {' '}({booking.bookerTimezone.replace(/_/g, ' ')})
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {booking.status === 'confirmed' && booking.videoRoom && <VideoJoinLink room={booking.videoRoom} />}
                <Link className="btn btn-secondary btn-sm" to="/today">Back to the day</Link>
              </div>
            </div>
          </div>

          {live && (
            <div className="card">
              <h2 className="section-head" style={{ marginTop: 0 }}>Change the arrangement</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => begin('move')}>
                  {open === 'move' ? 'Never mind' : 'Move it'}
                </button>
                {/* Its own action rather than a field inside the move form.
                    Running twenty minutes over is not the same decision as
                    moving to Thursday, and pairing them would mean retyping a
                    date to do the one you actually meant. */}
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => begin('length')}>
                  {open === 'length' ? 'Never mind' : 'Change the length'}
                </button>
                <button className="btn btn-danger btn-sm" type="button" onClick={() => begin('cancel')}>
                  {open === 'cancel' ? 'Never mind' : 'Call it off'}
                </button>
              </div>

              {open === 'move' && (
                <div style={{ marginTop: 14 }}>
                  <MoveAppointment
                    ownerId={ownerId}
                    bookingId={bookingId}
                    timezone={zone}
                    startAt={booking.startAt}
                    minutes={runs}
                    onMoved={() => { setOpen(null); load(); }}
                    onCancel={() => setOpen(null)}
                  />
                </div>
              )}

              {open === 'length' && (
                <div style={{ marginTop: 14 }}>
                  <div className="field" style={{ maxWidth: 220 }}>
                    <label htmlFor="bd-mins">Minutes</label>
                    <input id="bd-mins" type="number" min="5" max="480" step="5" value={minutes}
                      onChange={(e) => setMinutes(e.target.value)} />
                    <p className="hint">
                      It starts at the same time. Currently {spanLabel(runs)}.
                    </p>
                  </div>
                  <div className="field">
                    <label htmlFor="bd-len-why">Why (optional)</label>
                    <input id="bd-len-why" type="text" maxLength={280} value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="They are bringing two colleagues" />
                  </div>
                  <button className="btn btn-primary btn-sm" type="button"
                    disabled={busy || !minutes || Number(minutes) === runs}
                    onClick={() => act('duration', { minutes: Number(minutes), note })}>
                    {busy ? 'Saving…' : 'Change the length'}
                  </button>
                </div>
              )}

              {open === 'cancel' && (
                <div style={{ marginTop: 14 }}>
                  <div className="field">
                    <label htmlFor="bd-cancel-why">Why (optional)</label>
                    <input id="bd-cancel-why" type="text" maxLength={280} value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="He is travelling that week" />
                    <p className="hint">They will be emailed. This cannot be undone.</p>
                  </div>
                  <button className="btn btn-danger btn-sm" type="button" disabled={busy}
                    onClick={() => act('cancel', { note })}>
                    {busy ? 'Cancelling…' : 'Call it off'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="card">
            <h2 className="section-head" style={{ marginTop: 0 }}>Notes</h2>
            <BookingNotes ownerId={ownerId} bookingId={bookingId} onChanged={load} />
          </div>

          {/* Not the same thing as a note on the appointment, and worth the
              second box. A note here is ABOUT the meeting and stays with it; a
              line on the pad is something YOU have to do, which outlives the
              meeting and belongs on a list you actually work from. "Chase him
              for the draft" filed as a booking note is a sentence nobody ever
              reads again. */}
          <div className="card">
            <h2 className="section-head" style={{ marginTop: 0 }}>Something for you to do</h2>
            <QuickJot
              ownerId={ownerId}
              about={{ kind: 'booking', id: bookingId }}
              placeholder="Chase them for the draft…"
            />
          </div>

          <div className="card">
            <h2 className="section-head" style={{ marginTop: 0 }}>What has happened</h2>
            {(data.trail || []).length === 0 && (
              <p className="hint">Nothing is recorded against this one yet.</p>
            )}
            <div className="trail">
              {(data.trail || []).map((t) => (
                <div className={'trail-line' + (t.source === 'email' ? ' is-sent' : '')} key={t.id}>
                  <span className="trail-when">{dayLabelInZone(t.at, zone)} · {timeLabelInZone(t.at, zone)}</span>
                  <span className="trail-what">
                    <strong>
                      {t.source === 'email' && <span className="trail-tag">Sent</span>}
                      {t.headline}
                    </strong>
                    {t.detail && <span className="trail-detail">{t.detail}</span>}
                    <span className="trail-who">
                      {t.byPerson ? `by ${t.by}` : 'automatically'}
                      {t.byOffice ? ' · the office' : ''}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {error && data === null && (
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate('/today')}>
          Back to the day
        </button>
      )}
    </AppShell>
  );
}
