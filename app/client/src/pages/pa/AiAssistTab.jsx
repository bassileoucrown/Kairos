import { useState } from 'react';
import { api } from '../../lib/api.js';
import { dayLabelInZone, timeLabelInZone } from '../../lib/timezones.js';
import { useAuth } from '../../lib/AuthContext.jsx';

const EXAMPLES = [
  'Book a call with Jane next Tuesday afternoon',
  'Schedule 30 minutes tomorrow morning',
  'Set up a meeting Friday at 3pm',
];

export default function AiAssistTab({ ownerId }) {
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [booking, setBooking] = useState(null);
  const [busySlot, setBusySlot] = useState(null);

  async function handleParse(e) {
    e.preventDefault();
    setError('');
    setBooking(null);
    setParsing(true);
    try {
      const data = await api.post(`/pa/${ownerId}/ai-assist/parse`, { message });
      setResult(data);
      setContactName(data.contact?.name || '');
      setContactEmail(data.contact?.email || '');
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setParsing(false);
    }
  }

  async function handleBook(slot) {
    if (!contactEmail.trim()) {
      setError('Enter the contact\'s email before booking.');
      return;
    }
    setError('');
    setBusySlot(slot.startAt);
    try {
      const data = await api.post(`/pa/${ownerId}/ai-assist/book`, {
        meetingTypeId: result.meetingType.id,
        startAt: slot.startAt,
        contactEmail,
        contactName,
      });
      setBooking(data.booking);
      setResult(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <div>
      <p className="tz-note" style={{ marginBottom: 16 }}>
        Describe what you want to schedule in plain language. This proposes real open slots —
        it never books anything without you clicking. (Pattern-based matching in this environment,
        not a live model call — no LLM API key is configured here.)
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {booking && (
        <div className="alert alert-success">
          Booked {dayLabelInZone(booking.startAt, user.timezone)} · {timeLabelInZone(booking.startAt, user.timezone)}.
        </div>
      )}

      <form onSubmit={handleParse} className="card" style={{ marginBottom: 16 }}>
        <div className="field">
          <label htmlFor="ai-message">What do you need?</label>
          <textarea
            id="ai-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={EXAMPLES[0]}
            required
            style={{ minHeight: 60 }}
          />
          <p className="hint">Try: "{EXAMPLES.join('" · "')}"</p>
        </div>
        <button className="btn btn-primary" type="submit" disabled={parsing}>
          {parsing ? 'Thinking…' : 'Find times'}
        </button>
      </form>

      {result && (
        <div className="card">
          <p className="tz-note" style={{ marginBottom: 12 }}>
            Matched <strong>{result.meetingType.name}</strong>
            {result.contact ? <> with <strong>{result.contact.name || result.contact.email}</strong></> : ' — no contact matched, enter one below'}
            {!result.matchedFilter && ' (no exact time match — showing next available)'}.
          </p>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <input type="text" placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} style={{ maxWidth: 200 }} />
            <input type="email" placeholder="Contact email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required style={{ maxWidth: 240 }} />
          </div>

          {result.candidates.length === 0 && <div className="empty-state">No open slots found.</div>}
          <div className="slot-grid">
            {result.candidates.map((slot) => (
              <button
                key={slot.startAt}
                type="button"
                className="slot-btn"
                disabled={busySlot === slot.startAt}
                onClick={() => handleBook(slot)}
                style={{ height: 'auto', padding: '10px 8px' }}
              >
                {dayLabelInZone(slot.startAt, user.timezone)}
                <br />
                {timeLabelInZone(slot.startAt, user.timezone)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
