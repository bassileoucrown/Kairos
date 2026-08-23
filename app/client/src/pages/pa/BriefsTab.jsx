import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { dayLabelInZone, timeLabelInZone } from '../../lib/timezones.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { MentionPicker } from '../../components/Mention.jsx';

/**
 * One brief section, with its own picker.
 *
 * A component rather than seven refs in the parent: each textarea needs a ref
 * of its own for the picker to read the caret out of, and hooks cannot be
 * called in a loop.
 */
function SectionField({ field, ownerId, value, onChange }) {
  const ref = useRef(null);
  return (
    <div className="field">
      <label htmlFor={`brief-${field.key}`}>{field.label}</label>
      <div className="mention-anchor">
        <textarea
          id={`brief-${field.key}`}
          ref={ref}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <MentionPicker
          ownerId={ownerId}
          value={value}
          onChange={onChange}
          textareaRef={ref}
        />
      </div>
    </div>
  );
}

const SECTION_FIELDS = [
  { key: 'who', label: "Who you're meeting", placeholder: 'Role, company, how they connect to the principal…' },
  { key: 'why', label: 'Why this meeting', placeholder: 'What prompted this, what they want…' },
  { key: 'background', label: 'Background & context', placeholder: 'History, prior interactions, relevant context…' },
  { key: 'talkingPoints', label: 'Key talking points', placeholder: 'What to raise, questions to ask…' },
  { key: 'desiredOutcome', label: 'Desired outcome', placeholder: 'What a successful meeting looks like…' },
  { key: 'logistics', label: 'Logistics', placeholder: 'Location, link, dial-in, anything practical…' },
  { key: 'sensitiveNotes', label: 'Sensitive notes', placeholder: 'Anything the principal should know privately…' },
];

function BriefEditor({ ownerId, booking, onBack }) {
  const [sections, setSections] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    api.get(`/pa/${ownerId}/briefs/${booking.id}`).then((data) => setSections(data.sections)).catch((err) => setError(err.message));
  }, [ownerId, booking.id]);

  async function handleDraftWithAi() {
    setError('');
    setDrafting(true);
    try {
      const data = await api.post(`/pa/${ownerId}/briefs/${booking.id}/draft`);
      setSections(data.sections);
    } catch (err) {
      setError(err.message);
    } finally {
      setDrafting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const data = await api.put(`/pa/${ownerId}/briefs/${booking.id}`, { sections });
      setSections(data.sections);
      setSavedAt(data.updatedAt);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button className="btn btn-secondary btn-sm" type="button" onClick={onBack} style={{ marginBottom: 16 }}>← Back to list</button>
      <h3 style={{ marginBottom: 4 }}>{booking.meetingTypeName} with {booking.bookerName}</h3>
      <p className="tz-note" style={{ marginBottom: 16 }}>{new Date(booking.startAt).toLocaleString()}</p>

      {error && <div className="alert alert-error">{error}</div>}
      {sections === null && <p className="hint">Loading…</p>}

      {sections && (
        <div className="card">
          <button className="btn btn-secondary btn-sm" type="button" onClick={handleDraftWithAi} disabled={drafting} style={{ marginBottom: 16 }}>
            {drafting ? 'Drafting…' : 'Draft with AI'}
          </button>
          <p className="hint" style={{ marginTop: -12, marginBottom: 16 }}>
            Fills in Who, Background, and Logistics from contact history and notes — only for
            sections still empty. Talking points and outcomes are yours to write.
          </p>
          {SECTION_FIELDS.map((f) => (
            <SectionField
              key={f.key}
              field={f}
              ownerId={ownerId}
              value={sections[f.key]}
              onChange={(v) => setSections({ ...sections, [f.key]: v })}
            />
          ))}
          <button className="btn btn-primary" type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save brief'}
          </button>
          {savedAt && <span className="tz-note" style={{ marginLeft: 10 }}>Saved.</span>}
        </div>
      )}
    </div>
  );
}

export default function BriefsTab({ ownerId }) {
  const { user } = useAuth();
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  function load() {
    api.get(`/pa/${ownerId}/bookings`).then((data) => setBookings(data.bookings)).catch((err) => setError(err.message));
  }

  useEffect(load, [ownerId]);

  if (selected) {
    return <BriefEditor ownerId={ownerId} booking={selected} onBack={() => { setSelected(null); load(); }} />;
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {bookings === null && <p className="hint">Loading…</p>}
      {bookings && bookings.length === 0 && <div className="empty-state">No upcoming confirmed bookings to brief yet.</div>}
      {bookings && bookings.map((b) => (
        <div className="card" key={b.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(b)}>
          <div className="booking-row">
            <div>
              <div className="when">{dayLabelInZone(b.startAt, user.timezone)} · {timeLabelInZone(b.startAt, user.timezone)}</div>
              <div className="meta">{b.meetingTypeName} with {b.bookerName}</div>
            </div>
            <span className={'pill' + (b.hasBrief ? '' : ' is-off')}>{b.hasBrief ? 'Brief ready' : 'No brief yet'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
