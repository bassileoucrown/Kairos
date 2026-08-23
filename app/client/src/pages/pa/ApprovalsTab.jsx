import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { dayLabelInZone, timeLabelInZone } from '../../lib/timezones.js';
import FormatChoice from '../../components/FormatChoice.jsx';

const TIER_LABELS = { 3: 'Priority', 4: 'Inner Circle' };

// `timezone` is the principal's, passed down the same way BookingsTab and
// CalendarTab already take it, so every screen on the Desk states a time in
// one zone rather than each in whichever it happened to have to hand.
export default function ApprovalsTab({ ownerId, timezone = null }) {
  const zone = timezone || 'UTC';
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  // Which request is having a different format suggested, and what that
  // suggestion is. Only ever one open at a time — two half-written counters
  // on screen would be a way to send the wrong one.
  const [counterFor, setCounterFor] = useState(null);
  const [counterFormat, setCounterFormat] = useState('');
  const [counterNote, setCounterNote] = useState('');

  function load() {
    api.get(`/pa/${ownerId}/approvals`).then((data) => setBookings(data.bookings)).catch((err) => setError(err.message));
  }

  useEffect(load, [ownerId]);

  function openCounter(b) {
    setError('');
    setCounterFor(b.id);
    // Default to the principal's own format, which is the counter the office
    // makes nine times out of ten: "not in person, let's do the video call".
    setCounterFormat(b.usualFormat && b.usualFormat !== b.format ? b.usualFormat : '');
    setCounterNote('');
  }

  function closeCounter() {
    setCounterFor(null);
    setCounterFormat('');
    setCounterNote('');
  }

  async function act(id, action) {
    setBusyId(id);
    setError('');
    try {
      await api.post(`/pa/${ownerId}/approvals/${id}/${action}`);
      closeCounter();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function sendCounter(b) {
    setBusyId(b.id);
    setError('');
    try {
      await api.post(`/pa/${ownerId}/approvals/${b.id}/counter`, {
        format: counterFormat, formatNote: counterNote,
      });
      closeCounter();
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
      {bookings && bookings.map((b) => {
        // Three separate things the format can be doing, and the office needs
        // to be told which: nothing unusual, they asked for something else, or
        // we already answered and are waiting on them.
        const asked = b.formatState === 'proposed';
        const answered = b.formatState === 'countered';

        return (
          <div className="card" key={b.id}>
            <div className="booking-row">
              <div>
                <div className="when">
                  <span className="pill" style={{ marginRight: 8 }}>{TIER_LABELS[b.accessTier] || `Tier ${b.accessTier}`}</span>
                  {/* The principal's own time first. The question being
                      answered here is whether this fits their day, and it was
                      being asked in the booker's zone — so an assistant
                      deciding on a 9am Lagos meeting read "8:00 AM (UTC)" and
                      had to do the arithmetic themselves, on the one screen
                      where getting it wrong puts somebody in the wrong place.
                      The booker's time still follows when the two differ,
                      because "6:00 AM for them" is worth knowing before you
                      agree to it. */}
                  {dayLabelInZone(b.startAt, zone)} · {timeLabelInZone(b.startAt, zone)}
                  {b.bookerTimezone && b.bookerTimezone !== zone && (
                    <span className="when-theirs">
                      {' '}· {timeLabelInZone(b.startAt, b.bookerTimezone)} for them
                      ({b.bookerTimezone.replace('_', ' ')})
                    </span>
                  )}
                </div>
                <div className="meta">{b.meetingTypeName} with {b.bookerName} ({b.bookerEmail})</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" type="button" disabled={busyId === b.id} onClick={() => act(b.id, 'approve')}>
                  {asked ? 'Agree & approve' : 'Approve'}
                </button>
                {counterFor !== b.id && !answered && (
                  <button className="btn btn-secondary btn-sm" type="button" disabled={busyId === b.id} onClick={() => openCounter(b)}>
                    Suggest another format
                  </button>
                )}
                <button className="btn btn-danger btn-sm" type="button" disabled={busyId === b.id} onClick={() => act(b.id, 'decline')}>
                  Decline
                </button>
              </div>
            </div>

            {asked && (
              <div className="format-note-box" style={{ marginTop: 12, marginBottom: 0 }}>
                <strong>They asked to meet {b.formatLabel.toLowerCase()}</strong>
                {b.formatNote && <span className="said">“{b.formatNote}”</span>}
                {b.usualFormatLabel && (
                  <span className="said">
                    You usually take this one
                    {b.usualFormat === 'in_person' ? ' in person.' : ` as a ${b.usualFormatLabel.toLowerCase()}.`}
                  </span>
                )}
              </div>
            )}

            {answered && (
              <div className="format-note-box" style={{ marginTop: 12, marginBottom: 0 }}>
                <strong>You suggested {b.counterFormatLabel.toLowerCase()} — waiting on them</strong>
                {b.counterFormatNote && <span className="said">“{b.counterFormatNote}”</span>}
                <span className="said">
                  They asked for {b.formatLabel ? b.formatLabel.toLowerCase() : 'the usual'}. Their time
                  stays held until they accept or withdraw. Approving now takes what they asked for.
                </span>
              </div>
            )}

            {counterFor === b.id && (
              <div style={{ marginTop: 14 }}>
                <FormatChoice
                  idPrefix={`counter-${b.id}`}
                  formats={b.formats}
                  value={counterFormat}
                  onChange={setCounterFormat}
                  note={counterNote}
                  onNote={setCounterNote}
                  legend="Suggest instead:"
                  alreadyAskedId={b.format}
                  noteLabel="What are you suggesting?"
                />
                {counterFormat && counterFormat !== 'other' && (
                  <div className="field">
                    <label htmlFor={`counter-why-${b.id}`}>Why (optional)</label>
                    <input
                      id={`counter-why-${b.id}`}
                      type="text"
                      maxLength={300}
                      value={counterNote}
                      onChange={(e) => setCounterNote(e.target.value)}
                      placeholder="The grounds are being resurfaced"
                    />
                    <p className="hint">Goes to them in the email. A reason turns a refusal into an arrangement.</p>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    disabled={busyId === b.id || !counterFormat}
                    onClick={() => sendCounter(b)}
                  >
                    {busyId === b.id ? 'Sending…' : 'Send suggestion'}
                  </button>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={closeCounter}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
