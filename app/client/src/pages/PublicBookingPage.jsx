import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { detectTimezone, dayLabelInZone, timeLabelInZone } from '../lib/timezones.js';
import TimezonePicker from '../components/TimezonePicker.jsx';
import { useOpenSlots } from '../lib/useOpenSlots.js';
import SlotGrid from '../components/SlotGrid.jsx';
import VideoJoinLink from '../components/VideoJoinLink.jsx';
import FormatChoice from '../components/FormatChoice.jsx';

// The public page says nothing about format any more.
//
// It used to state it as a fact — "60 min · Video call" — and then, once the
// booker could ask for something else, as "usually a video call". Both were
// answering a question before it was asked, and both framed the booker's
// choice as a departure from somebody else's plan. The choice is theirs to
// make, so it is made where it is made: in the form, with the times and the
// name and the email. What the principal usually does is still what the
// picker opens on, and still what decides whether the office has to agree —
// it is simply no longer advertised on the way in.

function MeetingList({ owner, meetingTypes, slug }) {
  return (
    <div className="public-shell">
      <div className="public-card">
        <div className="public-header">
          <div className="owner-name">{owner.name}</div>
          <h1>Book a meeting</h1>
        </div>
        <div className="public-body">
          {meetingTypes.length === 0 && <div className="empty-state">No meeting types are open for booking right now.</div>}
          <div className="meeting-list">
            {meetingTypes.map((mt) => (
              <Link key={mt.id} to={`/book/${slug}/${mt.slug}`} className="meeting-list-item">
                <div>
                  <div className="name">{mt.name}</div>
                  <div className="meta">{mt.durationMinutes} min</div>
                </div>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SlotPicker({ slug, meetingSlug, owner, meetingType }) {
  const [bookerTimezone, setBookerTimezone] = useState(detectTimezone());
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  // Starts on the principal's own format, so a booker who has no opinion
  // submits exactly what they would have submitted before this existed.
  const [format, setFormat] = useState(meetingType.locationType);
  const [formatNote, setFormatNote] = useState('');

  const { slots, ownerTimezone, windowDays, reload } = useOpenSlots({ ownerSlug: slug, meetingSlug });

  // Whether this is the principal's usual format. It no longer changes what
  // happens — the choice is allowed and the tier alone decides whether the
  // booking is held — so it no longer changes what the button says either.
  // The page used to warn that choosing the telephone "goes across as a
  // request", which was true then and would be a lie now.
  const differs = format !== meetingType.locationType;
  // What the tier decides, which is the only thing that decides.
  const willBeHeld = !!meetingType.needsApproval;

  async function handleConfirm(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = await api.post(`/public/${slug}/${meetingSlug}/book`, {
        name, email, timezone: bookerTimezone, startAt: selected.startAt,
        format, formatNote,
      });
      setConfirmation(data.booking);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(err.message);
        setSelected(null);
        reload();
      } else {
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <div className="public-shell">
        <div className="public-card">
          <div className="public-body confirmation">
            <div className="check">{confirmation.status === 'pending' ? '…' : '✓'}</div>
            <h1>{confirmation.status === 'pending' ? 'Request sent' : "You're booked"}</h1>
            <p>
              {confirmation.meetingTypeName} with {confirmation.ownerName}
              <br />
              <strong>{dayLabelInZone(confirmation.startAt, confirmation.bookerTimezone)} · {timeLabelInZone(confirmation.startAt, confirmation.bookerTimezone)}</strong>
              <br />
              <span className="tz-note">({confirmation.bookerTimezone})</span>
              {confirmation.formatLabel && (
                <>
                  <br />
                  <span className="tz-note">
                    {confirmation.formatLabel}
                    {confirmation.formatNote ? ` — ${confirmation.formatNote}` : ''}
                  </span>
                </>
              )}
            </p>
            {/* Two different reasons a booking can be pending, and the booker
                is owed the one that actually applies to them. */}
            {confirmation.status === 'pending' && confirmation.formatState === 'proposed' && (
              <p className="tz-note">
                You asked to meet {confirmation.formatLabel.toLowerCase()} rather than
                the usual {confirmation.usualFormatLabel.toLowerCase()}, so {confirmation.ownerName}'s
                office has to agree. Your time is held while they do. You'll get an email either way.
              </p>
            )}
            {confirmation.status === 'pending' && confirmation.formatState !== 'proposed' && (
              <p className="tz-note">This meeting type requires approval — you'll get an email once it's confirmed.</p>
            )}
            {confirmation.status !== 'pending' && confirmation.videoRoom && (
              <div style={{ marginTop: 12 }}><VideoJoinLink room={confirmation.videoRoom} /></div>
            )}
            <p className="tz-note" style={{ marginTop: 16 }}>
              <Link to={`/book/manage/${confirmation.id}`}>Need to change or cancel this? Manage your booking</Link>
            </p>
            <Link to={`/book/${slug}`} className="btn btn-secondary" style={{ marginTop: 12 }}>Book another meeting</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="public-shell">
      <div className="public-card">
        <div className="public-header">
          <div className="owner-name">{owner.name}</div>
          <h1>{meetingType.name}</h1>
          <div className="meta">{meetingType.durationMinutes} min</div>
          {meetingType.description && <p style={{ marginTop: 10 }}>{meetingType.description}</p>}
        </div>
        <div className="public-body">
          {error && <div className="alert alert-error">{error}</div>}

          <div className="field" style={{ maxWidth: 320 }}>
            <label htmlFor="tz">Your timezone</label>
            <TimezonePicker id="tz" value={bookerTimezone} onChange={setBookerTimezone} />
            <p className="tz-note">Times shown below are in your local timezone. {owner.name} is in {ownerTimezone}.</p>
          </div>

          <div className="booking-layout">
            <SlotGrid slots={slots} timezone={bookerTimezone} selected={selected} onSelect={setSelected} windowDays={windowDays} />

            <div>
              {!selected && <p className="hint">Select a time to continue.</p>}
              {selected && (
                <form onSubmit={handleConfirm}>
                  <p style={{ marginBottom: 16 }}>
                    <strong>{dayLabelInZone(selected.startAt, bookerTimezone)}</strong>
                    <br />
                    {timeLabelInZone(selected.startAt, bookerTimezone)} ({bookerTimezone})
                  </p>
                  <div className="field">
                    <label htmlFor="booker-name">Your name</label>
                    <input id="booker-name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div className="field">
                    <label htmlFor="booker-email">Your email</label>
                    <input id="booker-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>

                  {/* Below the name and email rather than above them: those two
                      are what the booker came to type, and a question in front
                      of them reads as an obstacle. Here it is unmissable
                      anyway, because it sits between them and the button. */}
                  <FormatChoice
                    idPrefix="book"
                    formats={meetingType.formats}
                    value={format}
                    onChange={setFormat}
                    note={formatNote}
                    onNote={setFormatNote}
                    showUsual={false}
                  />

                  {differs && (
                    <p className="hint" style={{ marginBottom: 12 }}>
                      {owner.name} usually takes this one as a{' '}
                      {(meetingType.locationLabel || 'video call').toLowerCase()}, but that is
                      what you have asked for and it stands. They may write to suggest
                      otherwise.
                    </p>
                  )}

                  <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
                    {submitting
                      ? (willBeHeld ? 'Sending…' : 'Confirming…')
                      : (willBeHeld ? 'Send request' : 'Confirm booking')}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PublicBookingPage() {
  const { slug, meetingSlug } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/public/${slug}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [slug]);

  if (error) {
    return (
      <div className="public-shell">
        <div className="public-card">
          <div className="public-body empty-state">{error}</div>
        </div>
      </div>
    );
  }
  if (!data) return <div className="spinner-page">Loading…</div>;

  if (!meetingSlug) {
    return <MeetingList owner={data.owner} meetingTypes={data.meetingTypes} slug={slug} />;
  }

  const meetingType = data.meetingTypes.find((mt) => mt.slug === meetingSlug);
  if (!meetingType) {
    navigate(`/book/${slug}`, { replace: true });
    return null;
  }

  return <SlotPicker slug={slug} meetingSlug={meetingSlug} owner={data.owner} meetingType={meetingType} />;
}
