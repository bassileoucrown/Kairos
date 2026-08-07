import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import {
  detectTimezone, listTimezones, dateKeyInZone, dayLabelInZone, timeLabelInZone,
} from '../lib/timezones.js';

const LOCATION_LABELS = { video: 'Video call', phone: 'Phone call', in_person: 'In person' };
const timezones = listTimezones();

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
                  <div className="meta">{mt.durationMinutes} min · {LOCATION_LABELS[mt.locationType]}</div>
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
  const [slots, setSlots] = useState(null);
  const [ownerTimezone, setOwnerTimezone] = useState('UTC');
  const [bookerTimezone, setBookerTimezone] = useState(detectTimezone());
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    api.get(`/public/${slug}/${meetingSlug}/slots`)
      .then((data) => {
        setSlots(data.slots);
        setOwnerTimezone(data.ownerTimezone);
      })
      .catch((err) => setError(err.message));
  }, [slug, meetingSlug]);

  const groupedByDay = useMemo(() => {
    if (!slots) return [];
    const groups = new Map();
    for (const slot of slots) {
      const key = dateKeyInZone(slot.startAt, bookerTimezone);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(slot);
    }
    return Array.from(groups.entries()).map(([key, daySlots]) => ({
      key,
      label: dayLabelInZone(daySlots[0].startAt, bookerTimezone),
      slots: daySlots,
    }));
  }, [slots, bookerTimezone]);

  async function handleConfirm(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = await api.post(`/public/${slug}/${meetingSlug}/book`, {
        name, email, timezone: bookerTimezone, startAt: selected.startAt,
      });
      setConfirmation(data.booking);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(err.message);
        setSelected(null);
        api.get(`/public/${slug}/${meetingSlug}/slots`).then((data) => setSlots(data.slots)).catch(() => {});
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
            <div className="check">✓</div>
            <h1>You're booked</h1>
            <p>
              {confirmation.meetingTypeName} with {confirmation.ownerName}
              <br />
              <strong>{dayLabelInZone(confirmation.startAt, confirmation.bookerTimezone)} · {timeLabelInZone(confirmation.startAt, confirmation.bookerTimezone)}</strong>
              <br />
              <span className="tz-note">({confirmation.bookerTimezone})</span>
            </p>
            <Link to={`/book/${slug}`} className="btn btn-secondary">Book another meeting</Link>
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
          <div className="meta">{meetingType.durationMinutes} min · {LOCATION_LABELS[meetingType.locationType]}</div>
          {meetingType.description && <p style={{ marginTop: 10 }}>{meetingType.description}</p>}
        </div>
        <div className="public-body">
          {error && <div className="alert alert-error">{error}</div>}

          <div className="field" style={{ maxWidth: 320 }}>
            <label htmlFor="tz">Your timezone</label>
            <select id="tz" value={bookerTimezone} onChange={(e) => setBookerTimezone(e.target.value)}>
              {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
            <p className="tz-note">Times shown below are in your local timezone. {owner.name} is in {ownerTimezone}.</p>
          </div>

          <div className="booking-layout">
            <div>
              {slots === null && <p className="hint">Loading available times…</p>}
              {slots && slots.length === 0 && <div className="empty-state">No open times in the next two weeks.</div>}
              {groupedByDay.map((group) => (
                <div className="day-group" key={group.key}>
                  <h3>{group.label}</h3>
                  <div className="slot-grid">
                    {group.slots.map((slot) => (
                      <button
                        key={slot.startAt}
                        type="button"
                        className={'slot-btn' + (selected?.startAt === slot.startAt ? ' is-selected' : '')}
                        onClick={() => setSelected(slot)}
                      >
                        {timeLabelInZone(slot.startAt, bookerTimezone)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

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
                  <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
                    {submitting ? 'Confirming…' : 'Confirm booking'}
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
