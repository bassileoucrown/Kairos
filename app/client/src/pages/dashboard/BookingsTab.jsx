import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { dayLabelInZone, timeLabelInZone } from '../../lib/timezones.js';
import VideoJoinLink from '../../components/VideoJoinLink.jsx';
import FormatChoice from '../../components/FormatChoice.jsx';

const SCOPES = [
  { id: 'upcoming', label: 'Upcoming' },
  // Requests nobody has answered. The backend has always been able to list
  // these; this screen simply never asked. So an office with four people
  // waiting on a decision read "Nothing booked ahead. Share a meeting type
  // link to get the first one." — advice to go drum up the business it
  // already had, one tab away in the approval queue.
  { id: 'pending', label: 'Waiting' },
  { id: 'past', label: 'Past' },
  // Cancelled and declined together: to whoever is looking, both mean the
  // meeting is not happening, and splitting them would mean checking two
  // lists to answer one question.
  { id: 'cancelled', label: 'Cancelled' },
];

const EMPTY = {
  upcoming: 'Nothing booked ahead. Share a meeting type link to get the first one.',
  pending: 'Nothing is waiting on a decision.',
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
  // Which booking is having another format suggested, and what the suggestion
  // is. One at a time — two half-written suggestions on screen is a way to
  // send the wrong one.
  const [counterFor, setCounterFor] = useState(null);
  const [counterFormat, setCounterFormat] = useState('');
  const [counterNote, setCounterNote] = useState('');
  const [busyId, setBusyId] = useState(null);

  // The counter endpoint is scoped to a principal; on the principal's own
  // dashboard no ownerId is passed, so it is their own id.
  const subjectId = ownerId || user?.id;

  function openCounter(b) {
    setError('');
    setCounterFor(b.id);
    setCounterFormat(b.usualFormat && b.usualFormat !== b.format ? b.usualFormat : '');
    setCounterNote('');
  }
  function closeCounter() {
    setCounterFor(null);
    setCounterFormat('');
    setCounterNote('');
  }
  async function sendCounter(b) {
    setBusyId(b.id);
    setError('');
    try {
      await api.post(`/pa/${subjectId}/approvals/${b.id}/counter`, {
        format: counterFormat, formatNote: counterNote,
      });
      closeCounter();
      load(scope, query);
    } catch (err) { setError(err.message); } finally { setBusyId(null); }
  }

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
                {b.wasUnusual && ` — they chose this instead of ${b.usualFormatLabel.toLowerCase()}`}
                {b.formatNote && ` · “${b.formatNote}”`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {b.status === 'confirmed' && b.videoRoom && scope === 'upcoming' && <VideoJoinLink room={b.videoRoom} />}
              {b.trailLength > 0 && (
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => showTrail(b)}>
                  {openTrail === b.id ? 'Hide' : `History (${b.trailLength})`}
                </button>
              )}
              {/* The booker's format is allowed on arrival, so this is the
                  only place the office can say "actually, come in" about a
                  booking that never went to the approval queue. Without it,
                  suggesting another format would be possible only for the
                  bookings that were already being held — never for the ones
                  the booker's own choice now lets straight through. */}
              {scope === 'upcoming' && b.status === 'confirmed' && b.formatState !== 'countered' && (
                <button className="itin-tool" type="button" onClick={() => openCounter(b)}>
                  Suggest another format
                </button>
              )}
              {scope === 'upcoming' && (
                <button className="btn btn-danger btn-sm" type="button" onClick={() => handleCancel(b)}>
                  Cancel
                </button>
              )}
            </div>
          </div>

          {counterFor === b.id && (
            <div style={{ marginTop: 14 }}>
              <FormatChoice
                idPrefix={`bk-counter-${b.id}`}
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
                  <label htmlFor={`bk-counter-why-${b.id}`}>Why (optional)</label>
                  <input
                    id={`bk-counter-why-${b.id}`}
                    type="text"
                    maxLength={300}
                    value={counterNote}
                    onChange={(e) => setCounterNote(e.target.value)}
                    placeholder="The grounds are being resurfaced"
                  />
                  <p className="hint">Goes to them in the email. A reason turns a refusal into an arrangement.</p>
                </div>
              )}
              <p className="hint">
                Their time stays booked either way. They will be emailed, and can accept
                this or withdraw.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  disabled={busyId === b.id || !counterFormat}
                  onClick={() => sendCounter(b)}
                >
                  {busyId === b.id ? 'Sending…' : 'Send suggestion'}
                </button>
                <button className="btn btn-sm" type="button" onClick={closeCounter}>Cancel</button>
              </div>
            </div>
          )}

          {b.formatState === 'countered' && b.counterFormatLabel && (
            <div className="format-note-box" style={{ marginTop: 12 }}>
              <strong>You suggested {b.counterFormatLabel.toLowerCase()} — waiting on them</strong>
              {b.counterFormatNote && <span className="said">“{b.counterFormatNote}”</span>}
            </div>
          )}

          {openTrail === b.id && (
            <div className="trail">
              {trail === null && <p className="hint">Loading…</p>}
              {trail && trail.length === 0 && <p className="hint">Nothing is recorded against this one.</p>}
              {trail && trail.map((t) => (
                <div className={'trail-line' + (t.source === 'email' ? ' is-sent' : '')} key={t.id}>
                  <span className="trail-when">{dayLabelInZone(t.at, zone)} · {timeLabelInZone(t.at, zone)}</span>
                  <span className="trail-what">
                    <strong>
                      {/* What was done reads as itself; what was said is
                          marked as a letter, so the two are never confused. */}
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
          )}
        </div>
      ))}
    </div>
  );
}
