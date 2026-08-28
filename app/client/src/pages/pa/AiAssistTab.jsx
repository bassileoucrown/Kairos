import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { dayLabelInZone, timeLabelInZone } from '../../lib/timezones.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import Dictate from '../../components/Dictate.jsx';
import SoonButton from '../../components/SoonButton.jsx';

const EXAMPLES = [
  'Book a call with Jane next Tuesday afternoon',
  'Schedule 30 minutes tomorrow morning',
  'Set up a meeting Friday at 3pm',
];

const DRAFT_EXAMPLES = [
  'Reschedule with Jane, something came up',
  'Follow up thank-you after today\'s call with the board member',
  'Confirm tomorrow\'s meeting',
];

/** Appends dictated words to what is already in the box. */
function appendSpoken(setter) {
  return (text) => setter((current) => (current.trim() ? `${current.trim()} ${text}` : text));
}

function DraftMessageTab({ ownerId }) {
  const [instruction, setInstruction] = useState('');
  const [contacts, setContacts] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [contactId, setContactId] = useState('');
  const [bookingId, setBookingId] = useState('');
  const [draft, setDraft] = useState(null);
  const [toEmail, setToEmail] = useState('');
  const [error, setError] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    api.get(`/pa/${ownerId}/contacts`).then((data) => setContacts(data.contacts)).catch(() => {});
    api.get(`/pa/${ownerId}/bookings`).then((data) => setBookings(data.bookings)).catch(() => {});
  }, [ownerId]);

  async function handleDraft(e) {
    e.preventDefault();
    setError('');
    setSent(false);
    setDrafting(true);
    try {
      const data = await api.post(`/pa/${ownerId}/ai-assist/draft-message`, {
        instruction,
        contactId: contactId || undefined,
        bookingId: bookingId || undefined,
      });
      setDraft({ subject: data.subject, body: data.body });
      setToEmail(data.toEmail || '');
    } catch (err) {
      setError(err.message);
      setDraft(null);
    } finally {
      setDrafting(false);
    }
  }

  async function handleSend() {
    if (!toEmail.trim()) {
      setError("Enter the recipient's email before sending.");
      return;
    }
    setError('');
    setSending(true);
    try {
      await api.post(`/pa/${ownerId}/comms`, { toEmail, subject: draft.subject, body: draft.body });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      {/* SAID FIRST AND SAID PLAINLY, not in a parenthesis at the end. What
          this does is fill a template — a real and useful thing — and calling
          that "drafted" without saying so is the app taking credit for work it
          did not do. A product that will mislead about this has no standing to
          be believed about what it does with a passport. */}
      <p className="tz-note" style={{ marginBottom: 8 }}>
        <strong>These are templates, not writing.</strong> Kairos picks the closest one
        and fills in the real names and times, so you edit rather than start from a
        blank box. Nothing goes out until you press Send.
      </p>
      <div className="code-actions" style={{ marginBottom: 16 }}>
        <SoonButton feature="ai_compose" />
        <SoonButton feature="ai_rewrite" />
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {sent && <div className="alert alert-success">Sent.</div>}

      <form onSubmit={handleDraft} className="card" style={{ marginBottom: 16 }}>
        <div className="field">
          <label htmlFor="draft-instruction">What's the message about?</label>
          <textarea
            id="draft-instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={DRAFT_EXAMPLES[0]}
            required
            style={{ minHeight: 60 }}
          />
          <Dictate onText={appendSpoken(setInstruction)} label="Say it" />
          <p className="hint">Try: "{DRAFT_EXAMPLES.join('" · "')}"</p>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <select aria-label="Contact for draft" value={contactId} onChange={(e) => setContactId(e.target.value)} style={{ width: 'auto' }}>
            <option value="">No contact selected</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name || c.email}</option>
            ))}
          </select>
          <select aria-label="Booking for draft" value={bookingId} onChange={(e) => setBookingId(e.target.value)} style={{ width: 'auto' }}>
            <option value="">No booking selected</option>
            {bookings.map((b) => (
              <option key={b.id} value={b.id}>{b.meetingTypeName} with {b.bookerName} · {dayLabelInZone(b.startAt, 'UTC')}</option>
            ))}
          </select>
        </div>

        <button className="btn btn-primary" type="submit" disabled={drafting}>
          {drafting ? 'Drafting…' : 'Draft message'}
        </button>
      </form>

      {draft && (
        <div className="card">
          <div className="field">
            <label htmlFor="draft-to">To</label>
            <input id="draft-to" type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="recipient@example.com" />
          </div>
          <div className="field">
            <label htmlFor="draft-subject">Subject</label>
            <input id="draft-subject" type="text" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="draft-body">Body</label>
            <textarea id="draft-body" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} style={{ minHeight: 180 }} />
          </div>
          <button className="btn btn-primary" type="button" onClick={handleSend} disabled={sending}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AiAssistTab({ ownerId }) {
  const [mode, setMode] = useState('schedule');
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
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button type="button" className={'tab-btn' + (mode === 'schedule' ? ' is-active' : '')} onClick={() => setMode('schedule')}>
          Find a time
        </button>
        <button type="button" className={'tab-btn' + (mode === 'draft' ? ' is-active' : '')} onClick={() => setMode('draft')}>
          Draft a message
        </button>
      </div>

      {mode === 'draft' ? (
        <DraftMessageTab ownerId={ownerId} />
      ) : (
        <ScheduleTab
          ownerId={ownerId}
          user={user}
          message={message}
          setMessage={setMessage}
          result={result}
          error={error}
          setError={setError}
          parsing={parsing}
          contactName={contactName}
          setContactName={setContactName}
          contactEmail={contactEmail}
          setContactEmail={setContactEmail}
          booking={booking}
          busySlot={busySlot}
          handleParse={handleParse}
          handleBook={handleBook}
        />
      )}
    </div>
  );
}

function ScheduleTab({
  user, message, setMessage, result, error, parsing,
  contactName, setContactName, contactEmail, setContactEmail,
  booking, busySlot, handleParse, handleBook,
}) {
  return (
    <div>
      {/* THE RELIABLE HALF, AND IT IS RELIABLE BECAUSE IT IS NOT A MODEL.
          Kairos reads the words for a name, a day and a time of day, then
          filters the same computed openings the public booking page offers.
          It cannot invent a time that is not free, which is the property that
          matters most in a diary. */}
      <p className="tz-note" style={{ marginBottom: 16 }}>
        Say what you want to schedule in plain language. Kairos reads it for a name, a day
        and a time, then offers <strong>real open slots</strong> — it can only ever propose
        a time you are actually free, and it books nothing until you press it.
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
          <Dictate onText={appendSpoken(setMessage)} label="Say it" />
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
